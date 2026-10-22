#!/usr/bin/env python3
"""
import_walters.py — load walters_objects.json (scrape_walters.py) into museum_objects

Replaces every row with institution_name = 'The Walters Art Museum' (and their
time / link components) in one transaction, so a re-run gives the same result.
Only columns that exist in the target database are written: a local database
without historical_name still imports. Rows marked [walters] in geocoding_notes.

Reads DB credentials from backend/.env. Dry run by default.

Usage:
    python import_walters.py                 # dry run: counts, nothing written
    python import_walters.py --apply         # replace the Walters rows
    psql … -c "SELECT refresh_geospatial_views();"   # afterwards
"""

import argparse
import json
import os
import re

from audit_places import get_conn

HERE = os.path.dirname(os.path.abspath(__file__))
INSTITUTION = "The Walters Art Museum"

COLUMNS = [
    "object_id", "title", "img_url", "image_rights", "latitude", "longitude",
    "institution_name", "institution_place", "institution_latitude", "institution_longitude",
    "institution_city_en", "institution_country_en", "source_link",
    "place_name", "place_name_normalized", "historical_name", "city_en", "country_en",
    "geocoder_source", "geocoding_status", "geocoding_notes", "review_status",
    "object_date", "object_date_earliest", "object_date_latest", "object_date_precision", "object_date_display",
    "inventory_number",
]


def date_precision(text, start, end):
    if start is None:
        return "unknown"
    if re.search(r"\b(ca|c)\.|circa|about", text or "", re.I):
        return "circa"
    return "exact" if start == end else "range"


def row_values(r: dict) -> dict:
    t = r.get("time") or {}
    v = {k: r.get(k) for k in COLUMNS}
    v["object_date_earliest"] = t.get("time_start")
    v["object_date_latest"] = t.get("time_end")
    v["object_date_precision"] = date_precision(r.get("object_date"), t.get("time_start"), t.get("time_end"))
    v["object_date_display"] = r.get("object_date")
    v["geocoding_notes"] = "[walters] " + (r.get("geocoding_notes") or "")
    return v


def main():
    p = argparse.ArgumentParser(description="Import walters_objects.json into museum_objects")
    p.add_argument("--apply", action="store_true", help="Write to the database (default: dry run)")
    p.add_argument("-i", "--input", default=os.path.join(HERE, "walters_objects.json"))
    args = p.parse_args()

    records = json.load(open(args.input, encoding="utf-8"))
    ids = [r["object_id"] for r in records]
    assert len(ids) == len(set(ids)), "duplicate object_id in input"

    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'museum_objects'")
    existing = {c for (c,) in cur.fetchall()}
    cols = [c for c in COLUMNS if c in existing]
    skipped = [c for c in COLUMNS if c not in existing]
    cur.execute("SELECT COUNT(*) FROM museum_objects WHERE institution_name = %s", (INSTITUTION,))
    before = cur.fetchone()[0]
    print(f"{len(records)} records to import; {before} existing {INSTITUTION} rows will be replaced")
    if skipped:
        print("Columns not in this database (left out):", ", ".join(skipped))
    if not args.apply:
        print("Dry run: nothing written. Use --apply.")
        conn.rollback()
        return

    # Component rows are not deleted by the cascade on museum_objects_components.
    cur.execute("""
        WITH c AS (
            SELECT mc.component_id, mc.component_type FROM museum_objects_components mc
            JOIN museum_objects m ON m.id = mc.entity_id WHERE m.institution_name = %s)
        , t AS (DELETE FROM components_time_name_time_infos WHERE id IN
                (SELECT component_id FROM c WHERE component_type = 'time-name.time-info'))
        DELETE FROM components_object_links_object_link_infos WHERE id IN
                (SELECT component_id FROM c WHERE component_type = 'object-links.object-link-info')
    """, (INSTITUTION,))
    cur.execute("DELETE FROM museum_objects WHERE institution_name = %s", (INSTITUTION,))

    insert = (f"INSERT INTO museum_objects ({', '.join(cols)}, created_at, updated_at, published_at) "
              f"VALUES ({', '.join(['%s'] * len(cols))}, now(), now(), now()) RETURNING id")
    for r in records:
        v = row_values(r)
        cur.execute(insert, [v[c] for c in cols])
        mid = cur.fetchone()[0]
        t = r.get("time")
        if t:
            cur.execute("INSERT INTO components_time_name_time_infos (time_name, time_start, time_end) "
                        "VALUES (%s, %s, %s) RETURNING id",
                        (t.get("time_name"), str(t["time_start"]), str(t["time_end"])))
            cur.execute('INSERT INTO museum_objects_components (entity_id, component_id, component_type, field, "order") '
                        "VALUES (%s, %s, 'time-name.time-info', 'time', 1)", (mid, cur.fetchone()[0]))
        for i, link in enumerate(r.get("object_links") or [], 1):
            cur.execute("INSERT INTO components_object_links_object_link_infos (link_text, link_display) "
                        "VALUES (%s, %s) RETURNING id", (link["link_text"], link["link_display"]))
            cur.execute('INSERT INTO museum_objects_components (entity_id, component_id, component_type, field, "order") '
                        "VALUES (%s, %s, 'object-links.object-link-info', 'object_links', %s)", (mid, cur.fetchone()[0], i))
    # Country labels ("Egypt", "Iran?") get the point other collections already use for
    # that country label (the most common one), so they join the existing site. Region and
    # site labels do not: existing points for them are often wrong (Kashmir in Rajasthan,
    # Karnak in the Western Desert), so they stay unlocated and are flagged for review.
    cur.execute(r"""
        WITH sib AS (
            SELECT lower(place_name_normalized) AS label, country_en,
                   COALESCE(manual_latitude, latitude) AS lat, COALESCE(manual_longitude, longitude) AS lon,
                   COUNT(*) AS n,
                   ROW_NUMBER() OVER (PARTITION BY lower(place_name_normalized), country_en ORDER BY COUNT(*) DESC) AS rk
            FROM museum_objects
            WHERE institution_name <> %(inst)s AND published_at IS NOT NULL
              AND COALESCE(manual_latitude, latitude) IS NOT NULL AND place_name_normalized IS NOT NULL
            GROUP BY 1, 2, 3, 4)
        UPDATE museum_objects m
        SET latitude = sib.lat, longitude = sib.lon,
            geocoding_notes = m.geocoding_notes || ' | point of ' || sib.n || ' existing "' || sib.label || '" records'
        FROM sib
        WHERE m.institution_name = %(inst)s AND m.latitude IS NULL AND sib.rk = 1
          AND sib.label = lower(regexp_replace(m.place_name_normalized, '[' || CHR(63) || ']$', ''))
          AND sib.label = lower(m.country_en) AND sib.country_en = m.country_en
    """, {"inst": INSTITUTION})
    print(f"{cur.rowcount} country-level rows got the country point existing records use")
    cur.execute("""
        UPDATE museum_objects SET geocoding_status = 'ambiguous', review_status = 'pending',
               geocoding_notes = geocoding_notes || ' | no point: region or site label, review'
        WHERE institution_name = %s AND latitude IS NULL AND review_status IS NULL
    """, (INSTITUTION,))
    print(f"{cur.rowcount} rows without a point flagged for review")
    conn.commit()
    cur.execute("SELECT COUNT(*), COUNT(latitude) FROM museum_objects WHERE institution_name = %s", (INSTITUTION,))
    total, located = cur.fetchone()
    print(f"Imported {total} rows ({located} with a point). Now run: SELECT refresh_geospatial_views();")


if __name__ == "__main__":
    main()
