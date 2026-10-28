#!/usr/bin/env python3
"""
import_wmw.py — load wmw_objects.json (scrape_wmw.py map) into museum_objects

Upserts the rows with institution_name = 'Weltmuseum Wien' by object_id in one
transaction: existing rows keep their id (so artifact links stay), new objects are
inserted, objects no longer in the data are deleted; time / link components are
rebuilt. Rows with review_status = 'verified' are never touched. Rows marked [wmw]
in geocoding_notes (scrape_wmw.py writes the tag).

Only the mapped records are imported; wmw_flagged.json (no country, no point, a
European country under a non-European branch) stays out for review.

"Entry date" on the museum's page is the year the object entered the museum: stored as
the acquisition year (exact, confirmed), as for the Met's accessionYear.

Reads DB credentials from backend/.env. Dry run by default.

Usage:
    python import_wmw.py                 # dry run: counts, nothing written
    python import_wmw.py --apply         # replace the Weltmuseum rows
Then run the place pipeline (CLAUDE.md, "After a data import") and
SELECT refresh_geospatial_views();
"""

import argparse
import json
import os
import re

from audit_places import get_conn

HERE = os.path.dirname(os.path.abspath(__file__))
INSTITUTION = "Weltmuseum Wien"

COLUMNS = [
    "object_id", "title", "img_url", "image_rights", "latitude", "longitude",
    "institution_name", "institution_place", "institution_latitude", "institution_longitude",
    "institution_city_en", "institution_country_en", "source_link",
    "place_name", "place_name_normalized", "country_en", "origin_event_type_en", "origin_is_findspot",
    "geocoder_source", "geocoding_status", "geocoding_notes", "review_status",
    "object_date", "object_date_earliest", "object_date_latest", "object_date_precision", "object_date_display",
    "acquisition_year", "acquisition_year_earliest", "acquisition_year_latest",
    "acquisition_date_precision", "acquisition_date_confidence",
    "inventory_number",
]


def date_precision(text, start, end):
    if start is None and end is None:
        return "unknown"
    if re.search(r"\b(ca|c|um)\.?\s|circa|about", text or "", re.I):
        return "circa"
    return "exact" if start == end else "range"


def row_values(r: dict) -> dict:
    t = (r.get("time") or [{}])[0]
    v = {k: r.get(k) for k in COLUMNS}
    v["object_date_earliest"] = t.get("time_start")
    v["object_date_latest"] = t.get("time_end")
    v["object_date_precision"] = date_precision(r.get("object_date"), t.get("time_start"), t.get("time_end"))
    v["object_date_display"] = r.get("object_date")
    year = r.get("acquisition_year")
    v["acquisition_year_earliest"] = v["acquisition_year_latest"] = year
    v["acquisition_date_precision"] = "exact" if year else None
    v["acquisition_date_confidence"] = "confirmed" if year else None
    return v


def main():
    p = argparse.ArgumentParser(description="Import wmw_objects.json into museum_objects")
    p.add_argument("--apply", action="store_true", help="Write to the database (default: dry run)")
    p.add_argument("-i", "--input", default=os.path.join(HERE, "wmw_objects.json"))
    args = p.parse_args()

    records = json.load(open(args.input, encoding="utf-8"))
    ids = [r["object_id"] for r in records]
    assert len(ids) == len(set(ids)), "duplicate object_id in input"
    assert all(r["institution_name"] == INSTITUTION for r in records)

    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'museum_objects'")
    existing = {c for (c,) in cur.fetchall()}
    cols = [c for c in COLUMNS if c in existing]
    skipped = [c for c in COLUMNS if c not in existing]
    cur.execute("SELECT object_id, id, review_status FROM museum_objects WHERE institution_name = %s", (INSTITUTION,))
    existing_rows = {oid: (mid, status) for oid, mid, status in cur.fetchall()}
    cur.execute("SELECT COUNT(*) FROM museum_objects WHERE institution_name <> %s AND source_link = ANY(%s)",
                (INSTITUTION, [r["source_link"] for r in records]))
    elsewhere = cur.fetchone()[0]
    wanted = set(ids)
    gone = [mid for oid, (mid, status) in existing_rows.items() if oid not in wanted and status != "verified"]
    print(f"{len(records)} records: {sum(1 for i in ids if i in existing_rows)} update existing rows (ids and "
          f"artifact links kept), {sum(1 for i in ids if i not in existing_rows)} new; {len(gone)} rows no longer "
          f"in the data will be deleted; {elsewhere} source links already held by another institution's rows")
    if skipped:
        print("Columns not in this database (left out):", ", ".join(skipped))
    if not args.apply:
        print("Dry run: nothing written. Use --apply.")
        conn.rollback()
        return

    def drop_components(row_ids):
        # Component rows are not deleted by the cascade on museum_objects_components.
        if not row_ids:
            return
        cur.execute("""
            WITH c AS (DELETE FROM museum_objects_components WHERE entity_id = ANY(%s)
                       RETURNING component_id, component_type)
            , t AS (DELETE FROM components_time_name_time_infos WHERE id IN
                    (SELECT component_id FROM c WHERE component_type = 'time-name.time-info'))
            DELETE FROM components_object_links_object_link_infos WHERE id IN
                    (SELECT component_id FROM c WHERE component_type = 'object-links.object-link-info')
        """, (list(row_ids),))

    drop_components(gone)
    if gone:
        cur.execute("DELETE FROM museum_objects WHERE id = ANY(%s)", (gone,))

    insert = (f"INSERT INTO museum_objects ({', '.join(cols)}, created_at, updated_at, published_at) "
              f"VALUES ({', '.join(['%s'] * len(cols))}, now(), now(), now()) RETURNING id")
    update = (f"UPDATE museum_objects SET {', '.join(c + ' = %s' for c in cols)}, updated_at = now() "
              f"WHERE id = %s")
    updated, inserted, kept_verified = [], 0, 0
    for n, r in enumerate(records, 1):
        v = row_values(r)
        mid, status = existing_rows.get(r["object_id"], (None, None))
        if status == "verified":             # never touched by scripts
            kept_verified += 1
            continue
        if mid:
            cur.execute(update, [v[c] for c in cols] + [mid])
            updated.append(mid)
        else:
            cur.execute(insert, [v[c] for c in cols])
            mid = cur.fetchone()[0]
            inserted += 1
        r["_row_id"] = mid
        if n % 10000 == 0:
            print(f"  {n}/{len(records)}")
    drop_components(updated)
    for r in records:
        mid = r.get("_row_id")
        if not mid:
            continue
        for t in r.get("time") or []:
            cur.execute("INSERT INTO components_time_name_time_infos (time_name, time_start, time_end) "
                        "VALUES (%s, %s, %s) RETURNING id",
                        (t.get("time_name"),
                         None if t.get("time_start") is None else str(t["time_start"]),
                         None if t.get("time_end") is None else str(t["time_end"])))
            cur.execute('INSERT INTO museum_objects_components (entity_id, component_id, component_type, field, "order") '
                        "VALUES (%s, %s, 'time-name.time-info', 'time', 1)", (mid, cur.fetchone()[0]))
        # link_text is varchar(255); 7 page URLs carry longer slugs. Those rows get no link
        # component and the panel falls back to source_link, which holds the full URL.
        links = [l for l in r.get("object_links") or [] if len(l["link_text"]) <= 255]
        for i, link in enumerate(links, 1):
            cur.execute("INSERT INTO components_object_links_object_link_infos (link_text, link_display) "
                        "VALUES (%s, %s) RETURNING id", (link["link_text"], link["link_display"]))
            cur.execute('INSERT INTO museum_objects_components (entity_id, component_id, component_type, field, "order") '
                        "VALUES (%s, %s, 'object-links.object-link-info', 'object_links', %s)", (mid, cur.fetchone()[0], i))
    print(f"{len(updated)} rows updated, {inserted} inserted, {len(gone)} deleted, {kept_verified} verified rows left alone")
    conn.commit()
    cur.execute("SELECT COUNT(*), COUNT(latitude) FROM museum_objects WHERE institution_name = %s", (INSTITUTION,))
    total, located = cur.fetchone()
    print(f"Imported {total} rows ({located} with a point). Now run the place pipeline and "
          f"SELECT refresh_geospatial_views();")


if __name__ == "__main__":
    main()
