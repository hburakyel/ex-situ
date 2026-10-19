#!/usr/bin/env python3
"""Snapshot of the index from the public API, for a citable data release.

Read-only: uses only the public GET endpoints in docs/API.md, never the database.
Writes, into --out (default release-<date>/):
  objects.csv      one row per record: the origin place as shown, as recorded, the holding
                   institution and the link to the institution's own page. No image files
                   or image URLs.
  manifest.json    date, git commit of this repository, API totals, per-institution counts
                   and the sha256 of objects.csv.

    python3 scripts/release/export_release.py --api https://exsitu.app/api
    python3 scripts/release/export_release.py --limit-institutions 1   # quick test
"""
import argparse
import csv
import hashlib
import json
import os
import subprocess
import time
import urllib.parse
import urllib.request
from datetime import date

FIELDS = [
    "id", "inventory_number", "title", "institution_name", "institution_city_en",
    "place_name", "place_name_normalized", "historical_name", "precise_place", "city_en", "country_en",
    "latitude", "longitude", "origin_event_type_en", "origin_is_findspot", "origin_person_name",
    "object_date", "acquisition_year", "source_link", "source_withdrawn",
]
PAGE_SIZE = 200  # the API's maximum


def get(url):
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "exsitu-release-export"})
            return json.load(urllib.request.urlopen(req, timeout=60))
        except Exception:
            if attempt == 4:
                raise
            time.sleep(3 * (attempt + 1))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--api", default="https://exsitu.app/api")
    ap.add_argument("--out", default=None)
    ap.add_argument("--limit-institutions", type=int, default=None)
    args = ap.parse_args()
    out = args.out or f"release-{date.today().isoformat()}"
    os.makedirs(out, exist_ok=True)

    stats = get(f"{args.api}/museum-objects/resolver-stats")
    institutions = [i["name"] for i in stats["institutions"]]
    if args.limit_institutions:
        institutions = institutions[: args.limit_institutions]

    path = os.path.join(out, "objects.csv")
    counts = {}
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(FIELDS)
        for inst in institutions:
            page, n = 1, 0
            while True:
                q = urllib.parse.urlencode({"institution": inst, "page": page, "pageSize": PAGE_SIZE})
                d = get(f"{args.api}/museum-objects/by-country?{q}")
                for r in d["data"]:
                    a = {"id": r["id"], **r["attributes"]}
                    w.writerow([a.get(k, "") if a.get(k) is not None else "" for k in FIELDS])
                    n += 1
                if page >= d["meta"]["pagination"]["pageCount"]:
                    break
                page += 1
            counts[inst] = n
            print(f"{inst}: {n}", flush=True)

    sha = hashlib.sha256(open(path, "rb").read()).hexdigest()
    try:
        commit = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        commit = None
    manifest = {
        "date": date.today().isoformat(),
        "api": args.api,
        "git_commit": commit,
        "api_totals": stats.get("totals"),
        "rows": sum(counts.values()),
        "rows_per_institution": counts,
        "objects_csv_sha256": sha,
    }
    with open(os.path.join(out, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f"{manifest['rows']} rows → {path}")


if __name__ == "__main__":
    main()
