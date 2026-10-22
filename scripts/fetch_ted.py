#!/usr/bin/env python3
"""Hämtar svenska upphandlingsannonser från EU:s TED Search API (ingen nyckel krävs)
och skriver kompakta JSON-filer under data/ som webbsidan läser.

Körs dagligen av GitHub Actions. Endast standardbiblioteket används.

Miljövariabler:
  BACKFILL_MONTHS  antal månader bakåt vid första körningen (standard 12)
  TED_API          bas-URL (standard https://api.ted.europa.eu/v3/notices/search)
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
MONTHS = DATA / "months"
API = os.environ.get("TED_API", "https://api.ted.europa.eu/v3/notices/search")
BACKFILL_MONTHS = int(os.environ.get("BACKFILL_MONTHS", "12"))
KEEP_MONTHS = int(os.environ.get("KEEP_MONTHS", "24"))
PAGE_LIMIT = 250
MAX_RESULTS_PER_QUERY = 15000  # TED:s tak i sidnumreringsläge

# Fält vi ber om. TED avvisar okända fältnamn med HTTP 400; skriptet tar då bort
# det fält som nämns i felet och försöker igen, och loggar vad som togs bort.
FIELDS = [
    "publication-number",
    "publication-date",
    "notice-type",
    "form-type",
    "notice-title",
    "title-proc",
    "buyer-name",
    "buyer-country",
    "organisation-identifier-buyer",
    "buyer-city",
    "place-of-performance",
    "place-of-performance-subdiv-lot",
    "organisation-nuts-buyer",
    "classification-cpv",
    "main-classification-proc",
    "deadline-receipt-tender-date-lot",
    "deadline-receipt-request",
    "estimated-value-proc",
    "estimated-value-cur-proc",
    "estimated-value-lot",
    "estimated-value-cur-lot",
    "total-value",
    "total-value-cur",
    "tender-value",
    "tender-value-cur",
    "winner-name",
    "winner-identifier",
    "organisation-identifier-tenderer",
    "received-submissions-count",
    "received-submissions-type-val",
    "contract-conclusion-date",
    "description-proc",
]

LAN = {
    "SE110": "Stockholms län", "SE121": "Uppsala län", "SE122": "Södermanlands län",
    "SE123": "Östergötlands län", "SE124": "Örebro län", "SE125": "Västmanlands län",
    "SE211": "Jönköpings län", "SE212": "Kronobergs län", "SE213": "Kalmar län",
    "SE214": "Gotlands län", "SE221": "Blekinge län", "SE224": "Skåne län",
    "SE231": "Hallands län", "SE232": "Västra Götalands län", "SE311": "Värmlands län",
    "SE312": "Dalarnas län", "SE313": "Gävleborgs län", "SE321": "Västernorrlands län",
    "SE322": "Jämtlands län", "SE331": "Västerbottens län", "SE332": "Norrbottens län",
}

LANG_ORDER = ["swe", "SWE", "sv", "SV", "eng", "ENG", "en", "EN"]


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# ---------- HTTP ----------

def post(body):
    req = urllib.request.Request(
        API,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "application/json",
                 "User-Agent": "anbudslaget/1.0 (+github pages)"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode("utf-8"))


def search(query, fields):
    """Returnerar alla träffar för en fråga. Hanterar okända fält och omförsök."""
    out, page = [], 1
    while True:
        body = {"query": query, "fields": fields, "page": page, "limit": PAGE_LIMIT,
                "scope": "ALL", "paginationMode": "PAGE_NUMBER", "checkQuerySyntax": False}
        for attempt in range(5):
            try:
                res = post(body)
                break
            except urllib.error.HTTPError as e:
                msg = e.read().decode("utf-8", "replace")
                if e.code == 400:
                    log(f"  TED 400: {msg[:400]}{'…' if len(msg) > 400 else ''}")
                    mentioned = [f for f in fields if re.search(r"(?<![\w-])" + re.escape(f) + r"(?![\w-])", msg)]
                    # Långt svar som nämner de flesta fälten = TED listar tillåtna värden;
                    # då är det de fält som INTE nämns som är ogiltiga.
                    if len(mentioned) > len(fields) / 2:
                        bad = [f for f in fields if f not in mentioned]
                    else:
                        bad = mentioned
                    if bad and len(bad) < len(fields):
                        log(f"  TED känner inte igen fält {bad}; tar bort och försöker igen")
                        fields[:] = [f for f in fields if f not in bad]
                        body["fields"] = fields
                        continue
                    raise SystemExit(f"TED svarade 400: {msg[:800]}")
                if e.code in (429, 500, 502, 503, 504):
                    wait = 5 * (attempt + 1)
                    log(f"  HTTP {e.code}, väntar {wait}s")
                    time.sleep(wait)
                    continue
                raise SystemExit(f"TED svarade {e.code}: {msg[:800]}")
            except (urllib.error.URLError, TimeoutError) as e:
                log(f"  nätverksfel {e}, försöker igen")
                time.sleep(5 * (attempt + 1))
        else:
            raise SystemExit("TED svarar inte efter flera försök")
        notices = res.get("notices") or res.get("results") or []
        total = res.get("totalNoticeCount") or res.get("total") or 0
        out.extend(notices)
        if not notices or len(out) >= total or page * PAGE_LIMIT >= MAX_RESULTS_PER_QUERY:
            if total and len(out) < total:
                log(f"  OBS: {total} träffar men bara {len(out)} hämtade (för brett fönster)")
            return out
        page += 1
        time.sleep(0.4)


# ---------- normalisering ----------

def pick(v):
    """Plockar ett läsbart värde ur TED:s flerspråkiga/listformade fält."""
    if v is None:
        return None
    if isinstance(v, dict):
        for k in LANG_ORDER:
            if k in v and v[k] not in (None, "", []):
                return pick(v[k])
        for x in v.values():
            p = pick(x)
            if p not in (None, ""):
                return p
        return None
    if isinstance(v, list):
        for x in v:
            p = pick(x)
            if p not in (None, ""):
                return p
        return None
    return v


def pick_all(v):
    """Alla distinkta strängvärden (t.ex. flera vinnare eller CPV-koder)."""
    out = []
    def walk(x):
        if x is None:
            return
        if isinstance(x, dict):
            keys = [k for k in LANG_ORDER if k in x] or list(x.keys())
            # för språkobjekt: ta bara ett språk
            if any(k in x for k in LANG_ORDER):
                walk(x[keys[0]])
            else:
                for k in keys:
                    walk(x[k])
        elif isinstance(x, list):
            for y in x:
                walk(y)
        else:
            s = str(x).strip()
            if s and s not in out:
                out.append(s)
    walk(v)
    return out


def num(v):
    for s in pick_all(v):
        try:
            return float(str(s).replace(" ", "").replace(",", "."))
        except ValueError:
            continue
    return None


def day(v):
    s = pick(v)
    if not s:
        return None
    m = re.match(r"(\d{4})-?(\d{2})-?(\d{2})", str(s))
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else None


def find_nuts(n):
    codes = set()
    def walk(x):
        if isinstance(x, dict):
            for y in x.values():
                walk(y)
        elif isinstance(x, list):
            for y in x:
                walk(y)
        elif isinstance(x, str):
            for m in re.findall(r"\bSE\d{3}\b", x):
                codes.add(m)
    for k in ("place-of-performance-subdiv-lot", "place-of-performance", "organisation-nuts-buyer"):
        walk(n.get(k))
    return sorted(c for c in codes if c in LAN)


def slug(s):
    s = (s or "").lower()
    for a, b in (("å", "a"), ("ä", "a"), ("ö", "o"), ("é", "e"), ("ü", "u")):
        s = s.replace(a, b)
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:80]


def orgnr(s):
    if not s:
        return None
    d = re.sub(r"\D", "", str(s))
    if len(d) == 12 and d.startswith(("16", "19", "20")):
        d = d[2:]
    return d if len(d) == 10 else None


def is_result(n, ftype, ntype):
    t = f"{ftype} {ntype}".lower()
    return "result" in t or t.strip().startswith("can") or " can" in t or "award" in t


def normalize(n):
    pn = pick(n.get("publication-number"))
    if not pn:
        return None
    ftype = str(pick(n.get("form-type")) or "")
    ntype = str(pick(n.get("notice-type")) or "")
    cpv = [c[:8] for c in pick_all(n.get("main-classification-proc")) + pick_all(n.get("classification-cpv"))
           if re.match(r"\d{8}", c)]
    cpv = list(dict.fromkeys(cpv))
    buyer = pick(n.get("buyer-name"))
    winners_names = pick_all(n.get("winner-name"))
    winners_ids = [orgnr(x) for x in pick_all(n.get("winner-identifier")) or pick_all(n.get("organisation-identifier-tenderer"))]
    winners = []
    for i, name in enumerate(winners_names[:20]):
        oid = winners_ids[i] if i < len(winners_ids) else None
        winners.append({"n": name, "o": oid, "k": slug(name) + ("-" + oid if oid else "")})
    result = is_result(n, ftype, ntype)
    value = num(n.get("total-value")) if result else None
    if value is None:
        value = num(n.get("estimated-value-proc")) or num(n.get("estimated-value-lot"))
        if value is None and result:
            value = num(n.get("tender-value"))
    cur = pick(n.get("total-value-cur")) or pick(n.get("estimated-value-cur-proc")) or pick(n.get("estimated-value-cur-lot")) or pick(n.get("tender-value-cur"))
    bids = num(n.get("received-submissions-count")) or num(n.get("received-submissions-type-val"))
    deadline = day(n.get("deadline-receipt-tender-date-lot")) or day(n.get("deadline-receipt-request"))
    nuts = find_nuts(n)
    title = pick(n.get("notice-title")) or pick(n.get("title-proc")) or "(utan titel)"
    # TED-titlar har ofta formatet "Sverige – Kategori – Titel"
    t = str(title)
    parts = [p.strip() for p in re.split(r"\s[–-]\s", t)]
    if len(parts) >= 3 and parts[0].lower() in ("sverige", "sweden"):
        t = " – ".join(parts[2:])
    desc = pick(n.get("description-proc"))
    return {
        "id": pn,
        "t": t,
        "b": buyer,
        "bo": orgnr(pick(n.get("organisation-identifier-buyer"))),
        "bk": slug(buyer),
        "c": cpv[:6],
        "l": [LAN[x] for x in nuts],
        "p": day(n.get("publication-date")),
        "d": deadline,
        "r": 1 if result else 0,
        "v": value,
        "vc": cur,
        "nb": int(bids) if bids is not None else None,
        "w": winners,
        "cd": day(n.get("contract-conclusion-date")),
        "ty": ntype or ftype or None,
        "ds": (str(desc)[:600] if desc else None),
    }


# ---------- lagring ----------

def month_key(d):
    return d[:7] if d else "okänd"


def load_months():
    store = {}
    if MONTHS.exists():
        for f in MONTHS.glob("*.json"):
            for n in json.loads(f.read_text("utf-8")):
                store[n["id"]] = n
    return store


def save_months(store, keep_from):
    MONTHS.mkdir(parents=True, exist_ok=True)
    by = {}
    for n in store.values():
        k = month_key(n.get("p"))
        if k != "okänd" and k < keep_from:
            continue
        by.setdefault(k, []).append(n)
    for f in MONTHS.glob("*.json"):
        if f.stem not in by:
            f.unlink()
    for k, items in by.items():
        items.sort(key=lambda x: (x.get("p") or "", x["id"]), reverse=True)
        write(MONTHS / f"{k}.json", items)
    return sorted(by)


def write(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), "utf-8")


def windows(start, end, days=10):
    d = start
    while d <= end:
        e = min(d + timedelta(days=days - 1), end)
        yield d, e
        d = e + timedelta(days=1)


def fetch_range(start, end, fields):
    got = []
    for a, b in windows(start, end):
        q = f"buyer-country=SWE AND publication-date>={a:%Y%m%d} AND publication-date<={b:%Y%m%d}"
        log(f"Hämtar {a} – {b}")
        got.extend(search(q, fields))
    return got


# ---------- aggregat ----------

def aggregates(store, today):
    notices = list(store.values())
    iso = today.isoformat()
    open_ = [n for n in notices if not n["r"] and (
        (n.get("d") and n["d"] >= iso) or (not n.get("d") and n.get("p") and n["p"] >= (today - timedelta(days=45)).isoformat()))]
    open_.sort(key=lambda x: (x.get("p") or ""), reverse=True)
    recent_cut = (today - timedelta(days=120)).isoformat()
    awards = [n for n in notices if n["r"] and (n.get("p") or "") >= recent_cut]
    awards.sort(key=lambda x: (x.get("p") or ""), reverse=True)

    buyers, suppliers = {}, {}
    for n in notices:
        if n.get("b"):
            b = buyers.setdefault(n["bk"], {"k": n["bk"], "n": n["b"], "o": n.get("bo"), "open": 0, "res": 0, "bids": [], "won": {}, "val": 0.0, "l": set()})
            b["l"].update(n.get("l") or [])
            if n["r"]:
                b["res"] += 1
                if n.get("nb") is not None:
                    b["bids"].append(n["nb"])
                for w in n.get("w") or []:
                    b["won"][w["k"]] = b["won"].get(w["k"], 0) + 1
                if n.get("v") and (n.get("vc") or "SEK") == "SEK":
                    b["val"] += n["v"]
        for w in (n.get("w") or []) if n["r"] else []:
            s = suppliers.setdefault(w["k"], {"k": w["k"], "n": w["n"], "o": w.get("o"), "wins": 0, "val": 0.0, "buyers": {}, "bids": [], "last": ""})
            s["wins"] += 1
            if n.get("v") and (n.get("vc") or "SEK") == "SEK":
                s["val"] += n["v"] / max(1, len(n["w"]))
            if n.get("bk"):
                s["buyers"][n["bk"]] = s["buyers"].get(n["bk"], 0) + 1
            if n.get("nb") is not None:
                s["bids"].append(n["nb"])
            s["last"] = max(s["last"], n.get("p") or "")
    for b in buyers.values():
        b["open"] = sum(1 for n in open_ if n.get("bk") == b["k"])
        b["avgBids"] = round(sum(b["bids"]) / len(b["bids"]), 1) if b["bids"] else None
        b["topWin"] = sorted(b["won"].items(), key=lambda x: -x[1])[:8]
        b["l"] = sorted(b["l"])
        del b["bids"], b["won"]
    for s in suppliers.values():
        s["avgBids"] = round(sum(s["bids"]) / len(s["bids"]), 1) if s["bids"] else None
        s["topBuyers"] = sorted(s["buyers"].items(), key=lambda x: -x[1])[:8]
        del s["buyers"], s["bids"]
    return open_, awards, buyers, suppliers


# ---------- bevakningar ----------

def matches(n, w):
    text = f"{n.get('t') or ''} {n.get('b') or ''} {n.get('ds') or ''}".lower()
    terms = [t.lower() for t in w.get("terms", [])]
    cpvs = tuple(w.get("cpv") or [])
    if terms or cpvs:
        text_hit = any(t in text for t in terms)
        cpv_hit = bool(cpvs) and any(c.startswith(cpvs) for c in n.get("c") or [])
        if not (text_hit or cpv_hit):
            return False
    if w.get("lan") and not set(w["lan"]) & set(n.get("l") or []):
        return False
    if w.get("buyers") and n.get("bk") not in w["buyers"]:
        return False
    if w.get("onlyOpen", True) and n["r"]:
        return False
    return True


def digest(new_items, site_url):
    wf = ROOT / "watches.json"
    if not wf.exists() or not new_items:
        return None
    watches = json.loads(wf.read_text("utf-8"))
    lines = []
    for w in watches:
        hits = [n for n in new_items if matches(n, w)]
        if not hits:
            continue
        lines.append(f"### {w['name']} ({len(hits)})\n")
        for n in hits[:25]:
            dl = f" · sista dag {n['d']}" if n.get("d") else ""
            link = f"{site_url}#/u/{n['id']}" if site_url else f"https://ted.europa.eu/sv/notice/-/detail/{n['id']}"
            lines.append(f"- [{n['t']}]({link}) – {n.get('b') or 'okänd köpare'}{dl}")
        lines.append("")
    return "\n".join(lines) if lines else None


# ---------- main ----------

def main():
    today = datetime.now(timezone.utc).date()
    store = load_months()
    meta_path = DATA / "meta.json"
    meta = json.loads(meta_path.read_text("utf-8")) if meta_path.exists() else {}
    known = set(store)
    if meta.get("lastFetched") and store:
        start = date.fromisoformat(meta["lastFetched"]) - timedelta(days=3)
    else:
        start = (today.replace(day=1) - timedelta(days=31 * (BACKFILL_MONTHS - 1))).replace(day=1)
        log(f"Första körningen: hämtar från {start}")
    fields = list(FIELDS)
    raw = fetch_range(start, today, fields)
    dropped = [f for f in FIELDS if f not in fields]
    added = []
    for r in raw:
        n = normalize(r)
        if n:
            if n["id"] not in known:
                added.append(n)
            store[n["id"]] = n
    keep_from = (today.replace(day=1) - timedelta(days=31 * (KEEP_MONTHS - 1))).strftime("%Y-%m")
    months = save_months(store, keep_from)
    open_, awards, buyers, suppliers = aggregates(store, today)
    write(DATA / "open.json", open_)
    write(DATA / "awards.json", awards)
    write(DATA / "buyers.json", sorted(buyers.values(), key=lambda b: -(b["open"] * 10 + b["res"])))
    write(DATA / "suppliers.json", sorted(suppliers.values(), key=lambda s: -s["wins"]))
    meta = {
        "lastFetched": today.isoformat(),
        "updatedAt": datetime.now(timezone.utc).isoformat(timespec="minutes"),
        "months": months,
        "counts": {"notices": len(store), "open": len(open_), "new7": sum(1 for n in open_ if (n.get("p") or "") >= (today - timedelta(days=7)).isoformat()),
                   "buyers": len(buyers), "suppliers": len(suppliers), "addedThisRun": len(added)},
        "fieldsUsed": fields,
        "fieldsDropped": dropped,
    }
    write(meta_path, meta)
    log(f"Klart: {len(added)} nya, {len(store)} totalt, {len(open_)} öppna. Borttagna fält: {dropped or 'inga'}")
    is_first = not known
    d = None if is_first else digest(added, os.environ.get("SITE_URL", ""))
    if d:
        (ROOT / "digest.md").write_text(d, "utf-8")
        log("Bevakningsträffar skrivna till digest.md")


if __name__ == "__main__":
    main()
