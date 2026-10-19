#!/usr/bin/env python3
"""
backfill_acquisition_year.py — Year an object entered the holding museum, from the
museum's own API (METHODOLOGY.md, "Dates").

  met   The Met collection API `accessionYear` → exact year.
  aic   Art Institute of Chicago API `fiscal_year` (the museum's fiscal year, July–June).
        The accession number starts with the calendar year ("1999.526"); when that year
        is the fiscal year or the one before it, it is the exact year. Otherwise the year
        is left empty: the public API shows one year, and a fiscal year spans two.

  rijks Rijksmuseum object numbers carry the acquisition year after the department prefix
        ("NG-1994-65-4-20-1": purchase 1994; checked against the museum's pages). Not for
        AK-MAK (the Asian art society's loans), whose numbers are serials ("AK-MAK-1742").
  smvk  Etnografiska museet / Världskulturmuseet inventory numbers start with the collection
        number "year.serial" ("1907.57.0012": collection received in 1907).
        Both read the inventory number already in the database; no API call.

Writes acquisition_year_earliest / _latest / acquisition_date_precision ('exact') /
acquisition_date_confidence ('confirmed'). Only rows without an acquisition
year are filled; rows with review_status = 'verified' are never touched.

Usage:
    python etl/backfill_acquisition_year.py met            # dry run: fetch, report, roll back
    python etl/backfill_acquisition_year.py aic --apply    # write
Then: SELECT refresh_geospatial_views();
"""

import argparse
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import psycopg2.extras
import requests

from audit_places import get_conn

UA = {"User-Agent": "ExSitu-resolver (https://exsitu.app; open-source spatial index)"}
INSTITUTIONS = {"met": "The Metropolitan Museum of Art", "aic": "Art Institute of Chicago",
                "rijks": ("Rijksmuseum",), "smvk": ("Museum of Ethnography", "Museum of World Culture")}
INVENTORY_YEAR = {"rijks": r"^[A-Z]+(?:-[A-Z]+)*-(1[6-9]\d\d|20[0-2]\d)-",
                  "smvk": r"^(1[89]\d\d|20[0-2]\d)\.\d+"}
INVENTORY_SERIALS = {"rijks": "AK-MAK-%", "smvk": ""}


def get_json(session, url, params=None):
    for attempt in range(5):
        try:
            r = session.get(url, params=params, timeout=30)
            if r.status_code == 200:
                return r.json()
            if r.status_code in (403, 429, 500, 502, 503):
                time.sleep(2 ** attempt)
                continue
            return None
        except requests.RequestException:
            time.sleep(2 ** attempt)
    return None


def year(v):
    try:
        y = int(str(v).strip())
    except (TypeError, ValueError):
        return None
    return y if 1500 <= y <= 2100 else None


def fetch_met(rows):
    session = requests.Session(); session.headers.update(UA)

    def one(row):
        oid, _inv = row
        d = get_json(session, f"https://collectionapi.metmuseum.org/public/collection/v1/objects/{oid}")
        y = year(d.get("accessionYear")) if d else None
        return (oid, y, y, "exact") if y else None

    with ThreadPoolExecutor(8) as ex:
        return [r for r in ex.map(one, rows) if r]


def fetch_aic(rows):
    session = requests.Session(); session.headers.update(UA)
    inv = dict(rows)
    out = []
    ids = list(inv)
    for i in range(0, len(ids), 100):
        d = get_json(session, "https://api.artic.edu/api/v1/artworks",
                     {"ids": ",".join(map(str, ids[i:i + 100])), "fields": "id,fiscal_year", "limit": 100})
        for a in (d or {}).get("data", []):
            fy = year(a.get("fiscal_year"))
            if not fy:
                continue
            m = re.match(r"(\d{4})\.", inv.get(a["id"]) or "")
            acc = int(m.group(1)) if m else None
            if acc in (fy - 1, fy):
                out.append((a["id"], acc, acc, "exact"))
        time.sleep(0.2)
    return out


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("source", choices=INSTITUTIONS)
    p.add_argument("--apply", action="store_true", help="write (default: dry run, rolled back)")
    args = p.parse_args()
    if args.source in INVENTORY_YEAR:
        return from_inventory(args)
    inst = INSTITUTIONS[args.source]
    conn = get_conn()
    with conn.cursor() as cur:
        cur.execute("""SELECT DISTINCT object_id, inventory_number FROM museum_objects
            WHERE institution_name = %s AND object_id IS NOT NULL AND acquisition_year_earliest IS NULL
              AND acquisition_year IS NULL AND COALESCE(review_status, '') <> 'verified'""", (inst,))
        rows = cur.fetchall()
    print(f"{inst}: {len(rows)} objects without an acquisition year")
    found = (fetch_met if args.source == "met" else fetch_aic)(rows)
    print(f"source gives an exact year for {len(found)}")
    with conn.cursor() as cur:
        cur.execute("CREATE TEMP TABLE _acq (object_id bigint, earliest int, latest int, precision text) ON COMMIT DROP")
        psycopg2.extras.execute_values(cur, "INSERT INTO _acq VALUES %s", found, page_size=2000)
        cur.execute("""UPDATE museum_objects mo SET acquisition_year_earliest = a.earliest, acquisition_year_latest = a.latest,
                acquisition_date_precision = a.precision, acquisition_date_confidence = 'confirmed'
            FROM _acq a WHERE mo.institution_name = %s AND mo.object_id = a.object_id
              AND mo.acquisition_year_earliest IS NULL AND mo.acquisition_year IS NULL
              AND COALESCE(mo.review_status, '') <> 'verified'""", (inst,))
        print(f"{cur.rowcount} rows updated")
        cur.execute("""SELECT (acquisition_year_earliest / 10) * 10 AS decade, count(*) FROM museum_objects
            WHERE institution_name = %s AND acquisition_year_earliest IS NOT NULL GROUP BY 1 ORDER BY 1""", (inst,))
        print("by decade:", ", ".join(f"{d}s {n}" for d, n in cur.fetchall()))
    if args.apply:
        conn.commit(); print("Committed. SELECT refresh_geospatial_views(); to rebuild the views.")
    else:
        conn.rollback(); print("Dry run — rolled back. Re-run with --apply to write.")
    conn.close()


def from_inventory(args):
    insts = list(INSTITUTIONS[args.source])
    conn = get_conn()
    with conn.cursor() as cur:
        cur.execute("""UPDATE museum_objects SET
                acquisition_year_earliest = substring(inventory_number from %s)::int,
                acquisition_year_latest = substring(inventory_number from %s)::int,
                acquisition_date_precision = 'exact', acquisition_date_confidence = 'confirmed'
            WHERE institution_name = ANY(%s) AND inventory_number ~ %s AND inventory_number NOT LIKE %s
              AND substring(inventory_number from %s)::int <= extract(year from now())
              AND acquisition_year_earliest IS NULL AND acquisition_year IS NULL
              AND COALESCE(review_status, '') <> 'verified'""",
            (INVENTORY_YEAR[args.source],) * 2 + (insts, INVENTORY_YEAR[args.source], INVENTORY_SERIALS[args.source] or "-",
             INVENTORY_YEAR[args.source]))
        print(f"{', '.join(insts)}: {cur.rowcount} rows get the year from the inventory number")
        cur.execute("""SELECT institution_name, (acquisition_year_earliest / 10) * 10, count(*) FROM museum_objects
            WHERE institution_name = ANY(%s) AND acquisition_year_earliest IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2""", (insts,))
        for inst, d, n in cur.fetchall():
            print(f"  {inst[:28]:28} {d}s {n}")
    if args.apply:
        conn.commit(); print("Committed. SELECT refresh_geospatial_views(); to rebuild the views.")
    else:
        conn.rollback(); print("Dry run — rolled back. Re-run with --apply to write.")
    conn.close()


if __name__ == "__main__":
    sys.exit(main())
