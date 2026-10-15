#!/usr/bin/env python3
"""
normalize_country_names.py — One spelling per origin country, the one the map's
country labels use, so each country is one entry in the map's Places list.

The world view and the Places list group on country_en exactly as stored, so
"China", "People's Republic of China" and "china" were three entries. The map's
country labels (frontend/public/country-labels.geojson, built by
build_country_labels.py) already match all of them through each label's `keys`;
this script writes the label's name back to the data.

Passes (all in one transaction):
  country   country_en whose country_key() is one of a label's keys → that label's
            name ("People's Republic of China" → "China", "Palestinian Territories"
            → "Palestine", "Ivory Coast" → "Côte d'Ivoire"). Values that match no
            label and differ from a more common value only by case take that
            spelling ("middle east" → "Middle East"). FIXES holds the few
            hand-checked values that are not country names.
  city      city_en that is only a copy of the raw place_name while
            place_name_normalized names the row's country ("Jordanien" with
            "Jordan") → NULL. The map shows city_en instead of a country-level
            label (backend place-group.js keeps city precision), so the German
            source name was shown. place_name keeps the raw value.
  label     place_name_normalized that names the row's own country under another
            spelling → the label's name ("East Timor" → "Timor-Leste").

Rows with review_status = 'verified' are never touched; place_name is never
changed. Each changed row gets one "[country-name] 2026-10-15 <column> was '…'"
note in geocoding_notes, so the change can be undone from the notes.

Usage:
    python etl/normalize_country_names.py           # dry run: changes + Places count, rolled back
    python etl/normalize_country_names.py --apply   # write; then restart Strapi (views rebuild)
"""

import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import date

from build_country_labels import country_key

HERE = os.path.dirname(os.path.abspath(__file__))
LABELS = os.path.join(HERE, "..", "frontend", "public", "country-labels.geojson")
NOTE_TAG = "[country-name]"

# country_en values that are not a country name; checked against place_name.
FIXES = {
    "Grassfields": "Cameroon",  # Met: place_name "Cameroon, Grassfields" (city_en and country_en swapped)
}

# Rows counted in the world view / Places list (mv_country_institution_stats).
PLACES_WHERE = """
    published_at IS NOT NULL
    AND (manual_latitude IS NOT NULL OR latitude IS NOT NULL)
    AND (manual_longitude IS NOT NULL OR longitude IS NOT NULL)
    AND institution_latitude IS NOT NULL AND institution_longitude IS NOT NULL
    AND institution_name IS NOT NULL
    AND NULLIF(country_en, '') IS NOT NULL
"""
NOT_VERIFIED = "COALESCE(review_status, '') <> 'verified'"


def load_labels(path):
    """country_key → (label id, label name)."""
    with open(path, encoding="utf-8") as f:
        features = json.load(f)["features"]
    index = {}
    for feature in features:
        props = feature["properties"]
        for key in props["keys"].split("|"):
            if key and key not in index:
                index[key] = (props["id"], props["name"])
    return index


def country_renames(values, index):
    """{old country_en: new} for the distinct (value, row count) pairs given."""
    renames = {}
    by_case = defaultdict(list)
    for value, count in values:
        by_case[value.strip().lower()].append((count, value))
    for value, count in values:
        if value in FIXES:
            renames[value] = FIXES[value]
            continue
        match = index.get(country_key(value))
        if match:
            if value != match[1]:
                renames[value] = match[1]
            continue
        top = max(by_case[value.strip().lower()])[1]
        if value != top:
            renames[value] = top
    return renames


def get_conn():
    import psycopg2
    from dotenv import load_dotenv

    load_dotenv(dotenv_path=os.path.join(HERE, "..", "backend", ".env"))
    return psycopg2.connect(
        host=os.environ.get("DATABASE_HOST", "127.0.0.1"),
        port=int(os.environ.get("DATABASE_PORT", 5432)),
        dbname=os.environ.get("DATABASE_NAME", ""),
        user=os.environ.get("DATABASE_USERNAME", ""),
        password=os.environ.get("DATABASE_PASSWORD", ""),
    )


def places(cur):
    """(distinct Places entries, objects) as the world view counts them."""
    cur.execute(f"SELECT COUNT(DISTINCT country_en), COUNT(*) FROM museum_objects WHERE {PLACES_WHERE}")
    return cur.fetchone()


def note_sql(column):
    today = date.today().isoformat()
    return (
        f"geocoding_notes = concat_ws(' | ', NULLIF(geocoding_notes, ''), "
        f"'{NOTE_TAG} {today} {column} was ' || quote_literal({column}))"
    )


def run(cur, index):
    cur.execute(
        f"""SELECT country_en, COUNT(*) FROM museum_objects
            WHERE NULLIF(country_en, '') IS NOT NULL AND {NOT_VERIFIED}
            GROUP BY country_en"""
    )
    renames = country_renames(cur.fetchall(), index)

    print("country_en")
    for old, new in sorted(renames.items(), key=lambda r: r[1].lower()):
        cur.execute(
            f"UPDATE museum_objects SET {note_sql('country_en')}, country_en = %s "
            f"WHERE country_en = %s AND {NOT_VERIFIED}",
            (new, old),
        )
        print(f"  {cur.rowcount:>6}  {old!r} → {new!r}")

    # city_en / place_name_normalized that only name the row's own country.
    cur.execute(
        f"""SELECT place_name_normalized, city_en, place_name, country_en, COUNT(*)
            FROM museum_objects
            WHERE NULLIF(country_en, '') IS NOT NULL AND NULLIF(place_name_normalized, '') IS NOT NULL
              AND {NOT_VERIFIED}
            GROUP BY 1, 2, 3, 4"""
    )
    label_updates, city_updates = defaultdict(int), defaultdict(int)
    for normalized, city, raw, country, count in cur.fetchall():
        own = index.get(country_key(country))
        if not own or index.get(country_key(normalized)) != own:
            continue
        if normalized != own[1]:
            label_updates[(normalized, country, own[1])] += count
        if city and raw and city.strip() == raw.strip() and city.strip() != own[1]:
            city_updates[(city, normalized, country)] += count

    print("city_en → NULL (copy of the raw place_name; the label already names the country)")
    for (city, normalized, country), _ in sorted(city_updates.items(), key=lambda r: -r[1]):
        cur.execute(
            f"""UPDATE museum_objects SET {note_sql('city_en')}, city_en = NULL
                WHERE city_en = %s AND BTRIM(place_name) = BTRIM(city_en)
                  AND place_name_normalized = %s AND country_en = %s AND {NOT_VERIFIED}""",
            (city, normalized, country),
        )
        print(f"  {cur.rowcount:>6}  {city!r}  (label {normalized!r}, {country})")

    print("place_name_normalized (names the row's country)")
    for (old, country, new), _ in sorted(label_updates.items(), key=lambda r: -r[1]):
        cur.execute(
            f"""UPDATE museum_objects SET {note_sql('place_name_normalized')}, place_name_normalized = %s
                WHERE place_name_normalized = %s AND country_en = %s AND {NOT_VERIFIED}""",
            (new, old, country),
        )
        print(f"  {cur.rowcount:>6}  {old!r} → {new!r}  ({country})")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="write the changes (default: dry run, rolled back)")
    parser.add_argument("--labels", default=LABELS, help="country-labels.geojson (default: frontend/public)")
    args = parser.parse_args()

    index = load_labels(args.labels)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM museum_objects WHERE review_status = 'verified'")
            verified = cur.fetchone()[0]
            before = places(cur)
            run(cur, index)
            after = places(cur)
        print(f"\nPlaces list (world view): {before[0]} → {after[0]} entries ({before[1]} → {after[1]} rows)")
        print(f"Rows with review_status = 'verified' (never touched): {verified}")
        if args.apply:
            conn.commit()
            print("Committed. Restart Strapi (or SELECT refresh_geospatial_views();) to rebuild the map views.")
        else:
            conn.rollback()
            print("Dry run — rolled back. Re-run with --apply to write.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
