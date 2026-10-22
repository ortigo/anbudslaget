#!/usr/bin/env python3
"""Kundkort: hämtar nyckeltal för alla kommuner och regioner från Koladas öppna
API (v3) och skriver data/kolada.json. Kör högst en gång i veckan (data ändras
sällan). Endast standardbiblioteket.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "kolada.json"
API = os.environ.get("KOLADA_API", "https://api.kolada.se/v3")
MAX_AGE_DAYS = int(os.environ.get("KOLADA_MAX_AGE_DAYS", "7"))

# Ordning = visningsordning. Titlar hämtas från Kolada vid körning, så det som
# visas är alltid Koladas egen benämning. Okända id:n hoppas över.
KPIS = {
    "K": ["N01951", "N00231", "N00901", "N03001", "N00090", "U00200", "U00202"],
    "L": ["N01951", "N60918", "N63056", "N60030", "U60200", "U60202"],
}
SHORT = {  # kort etikett i kortet; Koladas fulla titel visas som förklaring
    "N01951": "Invånare", "N00231": "Anställda i kommunen", "N00901": "Skattesats kommun",
    "N60918": "Skattesats region", "N03001": "Resultat, % av skatt och bidrag",
    "N63056": "Resultat, % av skatt och bidrag", "N00090": "Sjukfrånvaro anställda",
    "N60030": "Sjukfrånvaro anställda", "U00200": "Medarbetarengagemang (HME)",
    "U00202": "HME ledarskapsindex", "U60200": "Medarbetarengagemang (HME)", "U60202": "HME ledarskapsindex",
}


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def get(url):
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={"accept": "application/json", "User-Agent": "anbudslaget/1.0"})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(5 * (attempt + 1))
                continue
            raise SystemExit(f"Kolada svarade {e.code} för {url}: {e.read()[:300]!r}")
        except (urllib.error.URLError, TimeoutError) as e:
            log(f"  nätverksfel {e}")
            time.sleep(5 * (attempt + 1))
    raise SystemExit("Kolada svarar inte")


def get_all(url):
    out = []
    while url:
        res = get(url)
        out.extend(res.get("values") or [])
        url = res.get("next_url") or res.get("next_page")
        time.sleep(0.2)
    return out


def total(v):
    vals = v.get("values") or []
    for x in vals:
        if x.get("gender") == "T" and x.get("value") is not None:
            return x["value"]
    for x in vals:
        if x.get("value") is not None:
            return x["value"]
    return None


def main():
    if OUT.exists() and not os.environ.get("KOLADA_FORCE"):
        try:
            prev = json.loads(OUT.read_text("utf-8"))
            age = datetime.now(timezone.utc) - datetime.fromisoformat(prev["updatedAt"])
            if age < timedelta(days=MAX_AGE_DAYS):
                log(f"Kolada: senast hämtat för {age.days} dagar sedan, hoppar över.")
                return
        except Exception:
            pass
    munis = [m for m in get_all(f"{API}/municipality") if m.get("type") in ("K", "L")]
    log(f"Kolada: {len(munis)} kommuner och regioner")
    ids = sorted({k for ks in KPIS.values() for k in ks})
    meta = {}
    for k in get_all(f"{API}/kpi/{','.join(ids)}"):
        meta[k["id"]] = {"title": k.get("title"), "short": SHORT.get(k["id"], k.get("title")),
                         "desc": (k.get("description") or "")[:300]}
    missing = [k for k in ids if k not in meta]
    if missing:
        log(f"  Okända nyckeltal hoppas över: {missing}")
    year = datetime.now(timezone.utc).year
    years = ",".join(str(y) for y in range(year - 5, year + 1))
    values = {}
    for kid in [k for k in ids if k in meta]:
        rows = get_all(f"{API}/data/kpi/{kid}/year/{years}")
        per = {}
        for r in rows:
            v = total(r)
            if v is None:
                continue
            per.setdefault(r["municipality"], []).append((int(r["period"]), v))
        for mid, series in per.items():
            series.sort()
            values.setdefault(mid, {})[kid] = series[-3:]
        log(f"  {kid}: {len(rows)} rader")
    out = {
        "updatedAt": datetime.now(timezone.utc).isoformat(timespec="minutes"),
        "kpis": KPIS,
        "meta": meta,
        "munis": sorted(({"id": m["id"], "t": m["title"], "ty": m["type"]} for m in munis), key=lambda m: m["t"]),
        "values": values,
    }
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), "utf-8")
    log(f"Kolada klar: {len(values)} enheter med data")


if __name__ == "__main__":
    main()
