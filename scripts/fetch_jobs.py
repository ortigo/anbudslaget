#!/usr/bin/env python3
"""Behovsradar: hämtar aktuella platsannonser från Arbetsförmedlingens öppna
JobSearch-API (JobTech) där rubriken pekar på ett säkerhets-, beredskaps- eller
dataskyddsbehov. Skriver data/jobs.json och lägger nya annonser i digest.md.

Endast standardbiblioteket. Miljövariabel JOBS_API kan peka om bas-URL:en.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
API = os.environ.get("JOBS_API", "https://jobsearch.api.jobtechdev.se/search")
KEEP_CLOSED_DAYS = 120

# Kategori -> sökord. Sökorden skickas som fritext till API:et; en annons räknas
# bara om något av kategorins ord finns i RUBRIKEN (hög precision).
CATEGORIES = {
    "Informations- och cybersäkerhet": ["informationssäkerhet", "cybersäkerhet", "it-säkerhet", "ciso", "säkerhetsarkitekt",
                                        "security", "soc-analytiker", "informationssäkerhetssamordnare"],
    "Säkerhetschef och säkerhetsskydd": ["säkerhetschef", "säkerhetsskydd", "säkerhetssamordnare", "säkerhetsstrateg",
                                         "säkerhetshandläggare", "säkerhetsspecialist", "säkerhetsansvarig"],
    "Beredskap och kris": ["beredskap", "krisberedskap", "civilt försvar", "totalförsvar", "kontinuitet", "krishantering"],
    "Dataskydd": ["dataskyddsombud", "dataskydd", "gdpr"],
    "Risk": ["riskchef", "riskanalytiker", "risk manager", "riskhantering"],
}
PUBLIC_HINTS = ("kommun", "region ", "regionen", "myndighet", "verket", "länsstyrelsen", "försäkringskassan",
                "polismyndigheten", "försvarsmakten", "universitet", "högskola", "domstol", "riksdag",
                "kammarkollegiet", "kriminalvård", "tullverket", "kustbevakning", "skatteverket", "inspektionen", "styrelsen", "landsting", "kommunalförbund", "räddningstjänst")


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def get(params):
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"accept": "application/json",
                                               "User-Agent": "anbudslaget/1.0 (+github pages)"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")[:400]
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(5 * (attempt + 1))
                continue
            raise SystemExit(f"JobSearch svarade {e.code}: {body}")
        except (urllib.error.URLError, TimeoutError) as e:
            log(f"  nätverksfel {e}, försöker igen")
            time.sleep(5 * (attempt + 1))
    raise SystemExit("JobSearch svarar inte")


def g(d, *path):
    for p in path:
        if not isinstance(d, dict):
            return None
        d = d.get(p)
    return d


def orgnr(s):
    d = re.sub(r"\D", "", str(s or ""))
    if len(d) == 12 and d.startswith(("16", "19", "20")):
        d = d[2:]
    return d if len(d) == 10 else None


def slug(s):
    s = (s or "").lower()
    for a, b in (("å", "a"), ("ä", "a"), ("ö", "o"), ("é", "e"), ("ü", "u")):
        s = s.replace(a, b)
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:80]


def categorize(headline):
    h = (headline or "").lower()
    cats = [c for c, terms in CATEGORIES.items() if any(re.search(r"(?<![a-zåäö])" + re.escape(t), h) for t in terms)]
    # "security" i rubrik utan säkerhetskontext (t.ex. väktare/"security officer") filtreras bort
    if cats == ["Informations- och cybersäkerhet"] and "security" in h and not re.search(r"cyber|information|it[- ]|soc|ciso|architect|engineer|analyst", h):
        return []
    return cats


def normalize(hit, cats):
    emp = g(hit, "employer", "name") or g(hit, "employer", "workplace") or "Okänd arbetsgivare"
    on = orgnr(g(hit, "employer", "organization_number"))
    name_l = emp.lower()
    desc = g(hit, "description", "text") or ""
    return {
        "id": str(hit.get("id")),
        "t": hit.get("headline") or "(utan rubrik)",
        "e": emp,
        "eo": on,
        "ek": slug(emp),
        "pub": 1 if (on and on.startswith("2")) or any(h in name_l for h in PUBLIC_HINTS) or re.search(r"verk(et)?\b|^statens ", name_l) else 0,
        "cat": cats,
        "l": g(hit, "workplace_address", "region"),
        "m": g(hit, "workplace_address", "municipality"),
        "occ": g(hit, "occupation", "label"),
        "p": (hit.get("publication_date") or "")[:10] or None,
        "d": (hit.get("application_deadline") or "")[:10] or None,
        "u": hit.get("webpage_url") or f"https://arbetsformedlingen.se/platsbanken/annonser/{hit.get('id')}",
        "et": g(hit, "employment_type", "label"),
        "du": g(hit, "duration", "label"),
        "ds": re.sub(r"\s+", " ", desc)[:500] or None,
    }


def main():
    today = datetime.now(timezone.utc).date()
    path = DATA / "jobs.json"
    old = {}
    if path.exists():
        for j in json.loads(path.read_text("utf-8")):
            old[j["id"]] = j
    first_run = not old
    found = {}
    terms = sorted({t for ts in CATEGORIES.values() for t in ts})
    for term in terms:
        offset = 0
        while True:
            res = get({"q": term, "limit": 100, "offset": offset})
            hits = res.get("hits") or []
            total = g(res, "total", "value") or 0
            for h in hits:
                cats = categorize(h.get("headline"))
                if cats and str(h.get("id")) not in found:
                    found[str(h.get("id"))] = normalize(h, cats)
            offset += 100
            if not hits or offset >= min(total, 1000):
                break
            time.sleep(0.3)
        log(f"  {term}: {total} träffar i fritext")
    iso = today.isoformat()
    out, new = [], []
    for jid, j in found.items():
        prev = old.get(jid)
        j["first"] = prev["first"] if prev else iso
        j["open"] = 1
        if not prev:
            new.append(j)
        out.append(j)
    cutoff = (today - timedelta(days=KEEP_CLOSED_DAYS)).isoformat()
    for jid, j in old.items():
        if jid not in found and j.get("first", iso) >= cutoff:
            j["open"] = 0
            out.append(j)
    out.sort(key=lambda x: (x["open"], x.get("p") or x.get("first") or ""), reverse=True)
    DATA.mkdir(exist_ok=True)
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), "utf-8")
    meta_p = DATA / "jobs-meta.json"
    meta_p.write_text(json.dumps({"updatedAt": datetime.now(timezone.utc).isoformat(timespec="minutes"),
                                  "open": sum(1 for j in out if j["open"]), "new": len(new)}, ensure_ascii=False), "utf-8")
    log(f"Behovsradar klar: {sum(1 for j in out if j['open'])} aktuella annonser, {len(new)} nya.")
    if new and not first_run:
        site = os.environ.get("SITE_URL", "")
        lines = [f"### Rekryteringssignaler ({len(new)} nya)\n"]
        for j in sorted(new, key=lambda x: x["cat"][0])[:40]:
            where = ", ".join(x for x in (j.get("m"), j.get("l")) if x)
            lines.append(f"- **{j['e']}** söker [{j['t']}]({j['u']}) – {', '.join(j['cat'])}{' · ' + where if where else ''}")
        if site:
            lines.append(f"\n[Alla signaler]({site}#/signaler)")
        d = ROOT / "digest.md"
        prev = d.read_text("utf-8") + "\n" if d.exists() else ""
        d.write_text(prev + "\n".join(lines) + "\n", "utf-8")


if __name__ == "__main__":
    main()
