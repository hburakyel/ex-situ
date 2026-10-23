#!/usr/bin/env python3
"""
import_si.py — load si_objects_points.json (scrape_si.py → si_points.py) into museum_objects

Replaces every row of the three Smithsonian institutions (and their time / link
components) in one transaction, so a re-run gives the same result. Only columns
that exist in the target database are written. Rows marked [si] in
geocoding_notes. The records in si_flagged.json (Korea, Tibet, several countries)
are not imported.

  - place_name: the record's own most specific place; place_name_normalized:
    the label of its point (si_points.py); city_en only for a town or site
  - country_en: the map's country label name for the GeoNames country ("DR Congo"
    → "Democratic Republic of the Congo"), as normalize_country_names.py writes it;
    normalize_origin_points.py applies UN usage to the points afterwards
  - acquisition year: NMNH accession date / Asian Art accession number, year only
  - image_rights: the CC0 URI, only with an image

Country-only records get the point other collections already use for that
country label, as import_walters.py does.

Reads DB credentials from backend/.env. Dry run by default.

Usage (from etl/, with the etl virtualenv):
    .venv/bin/python import_si.py                 # dry run: counts, nothing written
    .venv/bin/python import_si.py --apply         # replace the Smithsonian rows
Then the place pipeline (CLAUDE.md) and SELECT refresh_geospatial_views();
"""

import argparse
import json
import os
import re

from psycopg2.extras import execute_values

from audit_places import get_conn
from import_walters import date_precision
from normalize_country_names import LABELS, country_key, load_labels

HERE = os.path.dirname(os.path.abspath(__file__))
INSTITUTIONS = ["National Museum of Asian Art", "National Museum of the American Indian",
                "National Museum of Natural History"]
CC0_URI = "http://creativecommons.org/publicdomain/zero/1.0/"
BATCH = 2000

COLUMNS = [
    "object_id", "title", "img_url", "image_rights", "latitude", "longitude",
    "institution_name", "institution_place", "institution_latitude", "institution_longitude",
    "institution_city_en", "institution_country_en", "source_link",
    "place_name", "place_name_normalized", "city_en", "country_en", "geocoded_country",
    "geocoder_source", "geocoding_status", "geocoding_notes", "review_status",
    "object_date", "object_date_earliest", "object_date_latest", "object_date_precision", "object_date_display",
    "acquisition_year_earliest", "acquisition_year_latest", "acquisition_date_precision", "acquisition_date_confidence",
    "inventory_number",
]


def read_records(path: str):
    with open(path, encoding="utf-8") as f:
        f.readline()
        for line in f:
            line = line.strip().rstrip(",")
            if line and line != "]":
                yield json.loads(line)


COUNTRY_LABELS = load_labels(LABELS)


def _labels_by_iso3() -> dict:
    """GeoNames English country name → the map label of the same ISO3 code ("DR Congo" → COD's name)."""
    with open(LABELS, encoding="utf-8") as f:
        by_id = {x["properties"]["id"]: x["properties"]["name"] for x in json.load(f)["features"]}
    out = {}
    for line in open(os.path.join(HERE, "data", "gazetteer", "countryInfo.txt"), encoding="utf-8"):
        c = line.rstrip("\n").split("\t")
        if not line.startswith("#") and len(c) > 4 and c[1] in by_id:
            out[c[4]] = by_id[c[1]]
    return out


LABEL_BY_GEONAMES_NAME = _labels_by_iso3()


def map_country(name):
    if not name:
        return name
    if name in LABEL_BY_GEONAMES_NAME:
        return LABEL_BY_GEONAMES_NAME[name]
    match = COUNTRY_LABELS.get(country_key(name))
    return match[1] if match else name


def row_values(r: dict) -> dict:
    t = (r.get("time") or [{}])[0]
    v = {k: r.get(k) for k in COLUMNS}
    v["image_rights"] = CC0_URI if r.get("img_url") else None
    v["country_en"] = map_country(r.get("geocoded_country"))
    if r.get("point_level") == "country" and v["place_name_normalized"]:
        hedge = "?" if v["place_name_normalized"].endswith("?") else ""
        v["place_name_normalized"] = (v["country_en"] or "") + hedge
    v["city_en"] = r.get("point_name") if r.get("point_level") == "place" else None
    v["object_date_earliest"] = t.get("time_start")
    v["object_date_latest"] = t.get("time_end")
    v["object_date_precision"] = date_precision(r.get("object_date"), t.get("time_start"), t.get("time_end"))
    v["object_date_display"] = r.get("object_date")
    if r.get("acquisition_year_earliest") is not None:
        v["acquisition_date_precision"], v["acquisition_date_confidence"] = "exact", "confirmed"
    v["geocoding_notes"] = "[si] " + (r.get("geocoding_notes") or "")
    return v


def batches(it, n):
    buf = []
    for x in it:
        buf.append(x)
        if len(buf) == n:
            yield buf
            buf = []
    if buf:
        yield buf


def main():
    p = argparse.ArgumentParser(description="Import si_objects_points.json into museum_objects")
    p.add_argument("--apply", action="store_true", help="Write to the database (default: dry run)")
    p.add_argument("-i", "--input", default=os.path.join(HERE, "si_objects_points.json"))
    args = p.parse_args()

    ids, n, located = set(), 0, 0
    for r in read_records(args.input):
        assert r["institution_name"] in INSTITUTIONS, r["institution_name"]
        assert r["object_id"] not in ids, f"duplicate object_id {r['object_id']}"
        ids.add(r["object_id"])
        n += 1
        located += r["latitude"] is not None

    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'museum_objects'")
    existing = {c for (c,) in cur.fetchall()}
    cols = [c for c in COLUMNS if c in existing]
    skipped = [c for c in COLUMNS if c not in existing]
    cur.execute("SELECT COUNT(*) FROM museum_objects WHERE institution_name = ANY(%s)", (INSTITUTIONS,))
    before = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM museum_objects WHERE object_id = ANY(%s) AND NOT institution_name = ANY(%s)",
                (list(ids), INSTITUTIONS))
    clash = cur.fetchone()[0]
    print(f"{n} records to import ({located} with a point); {before} existing Smithsonian rows will be replaced")
    if clash:
        raise SystemExit(f"{clash} object_ids already belong to other institutions; stopping")
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
            JOIN museum_objects m ON m.id = mc.entity_id WHERE m.institution_name = ANY(%s))
        , t AS (DELETE FROM components_time_name_time_infos WHERE id IN
                (SELECT component_id FROM c WHERE component_type = 'time-name.time-info'))
        DELETE FROM components_object_links_object_link_infos WHERE id IN
                (SELECT component_id FROM c WHERE component_type = 'object-links.object-link-info')
    """, (INSTITUTIONS,))
    cur.execute("DELETE FROM museum_objects WHERE institution_name = ANY(%s)", (INSTITUTIONS,))

    insert = (f"INSERT INTO museum_objects ({', '.join(cols)}, created_at, updated_at, published_at) "
              f"VALUES %s RETURNING id")
    template = f"({', '.join(['%s'] * len(cols))}, now(), now(), now())"
    done = 0
    for chunk in batches(read_records(args.input), BATCH):
        # RETURNING keeps the VALUES order for a single multi-row INSERT.
        mids = [m for (m,) in execute_values(cur, insert, [[row_values(r)[c] for c in cols] for r in chunk],
                                             template=template, page_size=BATCH, fetch=True)]
        times = [(mid, r["time"][0]) for mid, r in zip(mids, chunk) if r.get("time")]
        if times:
            tids = execute_values(cur, "INSERT INTO components_time_name_time_infos (time_name, time_start, time_end) "
                                  "VALUES %s RETURNING id",
                                  [(t["time_name"], str(t["time_start"]), str(t["time_end"])) for _, t in times],
                                  page_size=BATCH, fetch=True)
            execute_values(cur, 'INSERT INTO museum_objects_components (entity_id, component_id, component_type, field, "order") VALUES %s',
                           [(mid, tid, "time-name.time-info", "time", 1) for (mid, _), (tid,) in zip(times, tids)],
                           page_size=BATCH)
        links = [(mid, i, l) for mid, r in zip(mids, chunk) for i, l in enumerate(r.get("object_links") or [], 1)]
        if links:
            lids = execute_values(cur, "INSERT INTO components_object_links_object_link_infos (link_text, link_display) "
                                  "VALUES %s RETURNING id", [(l["link_text"], l["link_display"]) for _, _, l in links],
                                  page_size=BATCH, fetch=True)
            execute_values(cur, 'INSERT INTO museum_objects_components (entity_id, component_id, component_type, field, "order") VALUES %s',
                           [(mid, lid, "object-links.object-link-info", "object_links", i)
                            for (mid, i, _), (lid,) in zip(links, lids)], page_size=BATCH)
        done += len(chunk)
        if done % 100000 < BATCH:
            print(f"  {done} rows")

    # Country labels ("Japan", "Peru?") get the point other collections already use for
    # that country label (the most common one), so they join the existing site. The points
    # go into a small table first: after 750k inserts in this transaction the planner's row
    # estimates are stale and it re-ran the grouped query once per row (hours).
    cur.execute(r"""
        CREATE TEMP TABLE si_country_point ON COMMIT DROP AS
        SELECT label, country_en, lat, lon, n FROM (
            SELECT lower(place_name_normalized) AS label, country_en,
                   COALESCE(manual_latitude, latitude) AS lat, COALESCE(manual_longitude, longitude) AS lon,
                   COUNT(*) AS n,
                   ROW_NUMBER() OVER (PARTITION BY lower(place_name_normalized), country_en ORDER BY COUNT(*) DESC) AS rk
            FROM museum_objects
            WHERE NOT institution_name = ANY(%(inst)s) AND published_at IS NOT NULL
              AND COALESCE(manual_latitude, latitude) IS NOT NULL
              AND lower(place_name_normalized) = lower(country_en)
            GROUP BY 1, 2, 3, 4) s
        WHERE rk = 1
    """, {"inst": INSTITUTIONS})
    cur.execute("ANALYZE si_country_point")
    cur.execute("ANALYZE museum_objects")
    cur.execute(r"""
        UPDATE museum_objects m
        SET latitude = cp.lat, longitude = cp.lon,
            geocoding_notes = m.geocoding_notes || ' | point of ' || cp.n || ' existing "' || cp.label || '" records'
        FROM si_country_point cp
        WHERE m.institution_name = ANY(%(inst)s) AND m.latitude IS NULL
          AND cp.country_en = m.country_en
          AND cp.label = lower(regexp_replace(m.place_name_normalized, '[' || CHR(63) || ']$', ''))
    """, {"inst": INSTITUTIONS})
    print(f"{cur.rowcount} country-level rows got the country point existing records use")
    conn.commit()
    cur.execute("SELECT institution_name, COUNT(*), COUNT(latitude) FROM museum_objects "
                "WHERE institution_name = ANY(%s) GROUP BY 1", (INSTITUTIONS,))
    for inst, total, pts in cur.fetchall():
        print(f"  {inst}: {total} rows, {pts} with a point")
    print("Now the place pipeline (CLAUDE.md), then SELECT refresh_geospatial_views();")


if __name__ == "__main__":
    main()
