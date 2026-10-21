#!/usr/bin/env python3
"""
backfill_met_object_dates.py — The Met's own date line for every Met record, and a check
for Met objects the index is missing.

  dates    For each Met row, reads the collection API object and writes
             object_date_display   ← objectDate ("ca. 1525–35", "A.H. 761/A.D. 1360",
                                     "late 13th–early 14th century"), as the museum writes it
             object_date_earliest / _latest ← objectBeginDate / objectEndDate
             object_date_precision ← 'circa' when objectDate says ca./about/circa,
                                     else 'exact' (one year) or 'range'
           Before this the site showed only the API's padded begin/end years
           (1974.294.2: "1500–1560" for the Met's "ca. 1525–35"): scrape_met_api.py
           stored `period` as the date name, and backfill_met_object_dates.sql found it empty.
           objectBeginDate 0 is a real year (1 BCE / 1 CE ranges); it used to be dropped.

  missing  Lists objects of one Met department that are not in the index, to
           met_missing_<department>.csv. Department 14 is Islamic Art. Nothing is written
           to the database.

Usage:
    python etl/backfill_met_object_dates.py dates            # dry run: fetch, report, roll back
    python etl/backfill_met_object_dates.py dates --apply    # write
    python etl/backfill_met_object_dates.py missing --department 14
Then (dates --apply): SELECT refresh_geospatial_views();

About 19,600 requests for `dates`; the Met asks for at most 80 a second, this sends fewer.
"""

import argparse
import csv
import re
import sys
from concurrent.futures import ThreadPoolExecutor

import psycopg2.extras
import requests

from audit_places import get_conn
from backfill_acquisition_year import UA, get_json

MET = "The Metropolitan Museum of Art"
API = "https://collectionapi.metmuseum.org/public/collection/v1"
CIRCA = re.compile(r"^\s*(ca\.?|c\.|about|circa)\s", re.I)
JUNK = {"", "n.d.", "n.d", "undated", "unknown", "?"}


def year(v):
    """objectBeginDate/EndDate as an int; 0 is a year, not a gap."""
    if v is None or isinstance(v, bool):
        return None
    try:
        y = int(str(v).strip())
    except ValueError:
        return None
    return y if -10000 <= y <= 2027 else None


def date_fields(obj):
    """(display, earliest, latest, precision) from one Met API object, or None."""
    display = (obj.get("objectDate") or "").strip()
    if display.lower() in JUNK:
        display = None
    begin, end = year(obj.get("objectBeginDate")), year(obj.get("objectEndDate"))
    if begin is not None and end is not None and begin > end:
        begin, end = end, begin
    if display is None and begin is None and end is None:
        return None
    if begin is None and end is None:
        precision = "unknown"
    elif begin is None:
        precision = "before"
    elif end is None:
        precision = "after"
    elif display and CIRCA.match(display):
        precision = "circa"
    else:
        precision = "exact" if begin == end else "range"
    return display, begin, end, precision


def fetch_dates(object_ids):
    session = requests.Session(); session.headers.update(UA)

    def one(oid):
        d = get_json(session, f"{API}/objects/{oid}")
        f = date_fields(d) if d else None
        return (oid, *f) if f else None

    with ThreadPoolExecutor(8) as ex:
        return [r for r in ex.map(one, object_ids) if r]


def dates(args):
    conn = get_conn()
    with conn.cursor() as cur:
        cur.execute("""SELECT DISTINCT object_id FROM museum_objects
            WHERE institution_name = %s AND published_at IS NOT NULL AND object_id IS NOT NULL""", (MET,))
        ids = [r[0] for r in cur.fetchall()]
        cur.execute("""SELECT count(*) FILTER (WHERE NULLIF(BTRIM(object_date_display), '') IS NOT NULL), count(*)
            FROM museum_objects WHERE institution_name = %s AND published_at IS NOT NULL""", (MET,))
        before, total = cur.fetchone()
    # End the read transaction before the API fetch: an idle open transaction holds a lock
    # on museum_objects for the whole fetch and blocks pre-strapi's DROP TRIGGER on a deploy.
    conn.rollback()
    print(f"{MET}: {total} rows, {before} with the museum's own date line")
    found = fetch_dates(ids)
    print(f"API gives a date for {len(found)} of {len(ids)} objects")
    with conn.cursor() as cur:
        cur.execute("""CREATE TEMP TABLE _met_dates (object_id bigint, display text, earliest int,
            latest int, precision text) ON COMMIT DROP""")
        psycopg2.extras.execute_values(cur, "INSERT INTO _met_dates VALUES %s", found, page_size=2000)
        cur.execute("""UPDATE museum_objects mo SET object_date_display = d.display,
                object_date_earliest = d.earliest, object_date_latest = d.latest,
                object_date_precision = d.precision
            FROM _met_dates d WHERE mo.institution_name = %s AND mo.object_id = d.object_id
              AND mo.review_status IS DISTINCT FROM 'verified'""", (MET,))
        print(f"{cur.rowcount} rows updated")
        cur.execute("""SELECT object_date_precision, count(*) FROM museum_objects
            WHERE institution_name = %s AND published_at IS NOT NULL GROUP BY 1 ORDER BY 2 DESC""", (MET,))
        print("precision:", ", ".join(f"{p} {n}" for p, n in cur.fetchall()))
        cur.execute("""SELECT inventory_number, object_date_display, object_date_earliest, object_date_latest
            FROM museum_objects WHERE institution_name = %s
              AND inventory_number IN ('57.51.37.3', '1974.294.2', '39.20', '10.218', '17.190.991')""", (MET,))
        for row in cur.fetchall():
            print("  ", *row)
    if args.apply:
        conn.commit(); print("Committed. SELECT refresh_geospatial_views(); to rebuild the views.")
    else:
        conn.rollback(); print("Dry run — rolled back. Re-run with --apply to write.")
    conn.close()


def missing(args):
    session = requests.Session(); session.headers.update(UA)
    listing = get_json(session, f"{API}/objects", {"departmentIds": args.department})
    dept_ids = set((listing or {}).get("objectIDs") or [])
    conn = get_conn()
    with conn.cursor() as cur:
        cur.execute("SELECT object_id FROM museum_objects WHERE institution_name = %s AND object_id IS NOT NULL", (MET,))
        indexed = {r[0] for r in cur.fetchall()}
    conn.close()
    absent = sorted(dept_ids - indexed)
    print(f"department {args.department}: {len(dept_ids)} objects, "
          f"{len(dept_ids & indexed)} indexed, {len(absent)} not indexed")
    out = f"met_missing_{args.department}.csv"
    with open(out, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["object_id", "museum_page"])
        for oid in absent:
            w.writerow([oid, f"https://www.metmuseum.org/art/collection/search/{oid}"])
    print(f"wrote {out}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("dates"); d.add_argument("--apply", action="store_true", help="write (default: dry run, rolled back)")
    m = sub.add_parser("missing"); m.add_argument("--department", type=int, required=True)
    args = p.parse_args()
    return dates(args) if args.cmd == "dates" else missing(args)


if __name__ == "__main__":
    sys.exit(main())
