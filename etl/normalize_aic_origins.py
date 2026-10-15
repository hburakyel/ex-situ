#!/usr/bin/env python3
"""
normalize_aic_origins.py — Art Institute of Chicago origins that the map showed
as a place they are not.

AIC records carry place_of_origin in place_name; city_en came from
reverse-geocoding the coordinates, and that returned administrative regions.
With place_name_normalized empty, the map labelled the origin by that region:
"Bergama" as "Aegean Region", "Corinth" as "Peloponnese Region". Worse, broad
attributions had been geocoded to a point: "Mediterranean Region", "Eastern
Mediterranean Region" and "Ancient Mediterranean" sat in southern Turkey with
country_en "Turkey", "Ottoman Empire" likewise, and "Venado Beach" (Panama) in
Chile.

Passes (one transaction):
  cultural  place_name names a cultural area, not a place → no coordinates, no
            country, origin_type 'cultural_area', geocoding_status 'ambiguous'.
            The artifact stays in the index as unlocated (METHODOLOGY: never
            invent coordinates or precision).
  wrong     coordinates in the wrong country → removed; country_en from the
            AIC record; flagged 'ambiguous' for review.
  label     place_name_normalized empty and city_en is a reverse-geocoded
            region → the source's own place name (LABELS for the few
            spellings the map uses differently).

Rows with review_status = 'verified' or a manual coordinate are never touched;
place_name is never changed. Each changed row gets one
"[aic-region] <date> <column> was …" note in geocoding_notes.

Usage (DB credentials from backend/.env, like the other place scripts):
    python etl/normalize_aic_origins.py           # dry run: changes, rolled back
    python etl/normalize_aic_origins.py --apply   # write; then SELECT refresh_geospatial_views();
"""

import argparse
import os
import sys
from datetime import date

AIC = "Art Institute of Chicago"
NOTE_TAG = "[aic-region]"

# place_name values (lower case) that name a cultural area, not a findspot or city.
CULTURAL_AREAS = {
    "mediterranean region",
    "eastern mediterranean region",
    "ancient mediterranean",
    "ottoman empire",
}

# place_name → country_en, from the AIC record, where the coordinates are in
# another country. Venado Beach: "Venado Beach, Coclé province, Panama"
# (api.artic.edu artwork 32555); no gazetteer entry, so no coordinates.
WRONG_COUNTRY = {
    "Venado Beach": "Panama",
}

# Site labels the map already uses under another spelling. Bergama is the
# modern town at ancient Pergamon; AIC's Bergama record is a Pergamene coin,
# and the Antikensammlung's Pergamon finds are labelled "Pergamon".
LABELS = {
    "Bergama": "Pergamon",
}

GUARD = "COALESCE(review_status, '') <> 'verified' AND manual_latitude IS NULL AND manual_longitude IS NULL"


def get_conn():
    import psycopg2
    from dotenv import load_dotenv

    here = os.path.dirname(os.path.abspath(__file__))
    load_dotenv(dotenv_path=os.path.join(here, "..", "backend", ".env"))
    return psycopg2.connect(
        host=os.environ.get("DATABASE_HOST", "127.0.0.1"),
        port=int(os.environ.get("DATABASE_PORT", 5432)),
        dbname=os.environ.get("DATABASE_NAME", ""),
        user=os.environ.get("DATABASE_USERNAME", ""),
        password=os.environ.get("DATABASE_PASSWORD", ""),
    )


def note(*columns):
    today = date.today().isoformat()
    parts = " || ' ' || ".join(f"'{c} was ' || COALESCE(quote_literal({c}::text), 'NULL')" for c in columns)
    return (
        f"geocoding_notes = concat_ws(' | ', NULLIF(geocoding_notes, ''), "
        f"'{NOTE_TAG} {today} ' || {parts})"
    )


def run(cur):
    located = "COALESCE(latitude, longitude) IS NOT NULL"

    print("cultural area → unlocated (no coordinates, no country)")
    cur.execute(
        f"""UPDATE museum_objects SET {note('latitude', 'longitude', 'country_en', 'city_en')},
              latitude = NULL, longitude = NULL, country_en = NULL, city_en = NULL,
              place_name_normalized = place_name, origin_type = 'cultural_area',
              geocoding_status = 'ambiguous'
            WHERE institution_name = %s AND lower(place_name) = ANY(%s) AND {located} AND {GUARD}
            RETURNING place_name""",
        (AIC, sorted(CULTURAL_AREAS)),
    )
    counts = {}
    for (name,) in cur.fetchall():
        counts[name] = counts.get(name, 0) + 1
    for name, n in sorted(counts.items(), key=lambda r: -r[1]):
        print(f"  {n:>5}  {name!r}")

    print("coordinates in the wrong country → removed, country from the AIC record")
    for name, country in WRONG_COUNTRY.items():
        cur.execute(
            f"""UPDATE museum_objects SET {note('latitude', 'longitude', 'country_en', 'city_en')},
                  latitude = NULL, longitude = NULL, country_en = %s, city_en = NULL,
                  place_name_normalized = place_name, geocoding_status = 'ambiguous'
                WHERE institution_name = %s AND place_name = %s AND {located} AND {GUARD}""",
            (country, AIC, name),
        )
        print(f"  {cur.rowcount:>5}  {name!r} → unlocated, {country}")

    print("site label: reverse-geocoded region → the source's place name")
    cur.execute(
        f"""SELECT place_name, city_en, country_en, COUNT(*),
                   MIN(object_date_earliest), MAX(object_date_latest)
            FROM museum_objects
            WHERE institution_name = %s AND NULLIF(place_name_normalized, '') IS NULL
              AND city_en ~* ' region$' AND lower(city_en) <> lower(place_name) AND {GUARD}
            GROUP BY 1, 2, 3 ORDER BY 4 DESC""",
        (AIC,),
    )
    for place, region, country, n, earliest, latest in cur.fetchall():
        label = LABELS.get(place, place)
        cur.execute(
            f"""UPDATE museum_objects SET {note('place_name_normalized')}, place_name_normalized = %s
                WHERE institution_name = %s AND place_name = %s AND city_en = %s
                  AND NULLIF(place_name_normalized, '') IS NULL AND {GUARD}""",
            (label, AIC, place, region),
        )
        dates = f"{earliest}…{latest}" if earliest is not None else "undated"
        print(f"  {cur.rowcount:>5}  {region!r} → {label!r}  ({country}; raw {place!r}; {dates})")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="write the changes (default: dry run, rolled back)")
    args = parser.parse_args()

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            run(cur)
        if args.apply:
            conn.commit()
            print("\nCommitted. SELECT refresh_geospatial_views(); to rebuild the map views.")
        else:
            conn.rollback()
            print("\nDry run — rolled back. Re-run with --apply to write.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
