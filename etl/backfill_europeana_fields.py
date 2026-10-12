#!/usr/bin/env python3
"""
backfill_europeana_fields.py — Fill the columns importData.js does not set for
Europeana records, from etl/europeana_objects.json.

importData.js only writes the core fields. The map, place pages and MCP tools
also read country_en / city_en, institution locality and the object_date_*
columns, which the other institutions got from their own backfills. This does
the same for Europeana rows, matched on (institution_name, object_id):

  place_name, latitude/longitude  re-synced from the resolver output, so the
                                 row matches the JSON after a resolver fix
  image_rights                   licence URI of the image (edm:rights), for the credit line
  inventory_number               provider's dc:identifier (Record API), for the
                                 image grid's fallback tile
  country_en, geocoded_country   country resolved by exact GeoNames/Europeana id
  city_en                        only when the provider pointed at one GeoNames
                                 town (coordinates from that town); otherwise
                                 NULL, so the map groups the row under its country
  geocoder_source / geocoding_status / geocoding_notes
  institution_*                  from the dataProvider's Europeana organisation
  object_date_*                  always 'unknown'. Europeana's normalised year is
                                 not an object date: "18th century" becomes 1701,
                                 and many are photo/digitisation years (2014, 2019).

Rows with review_status = 'verified' are never touched.

Usage:
    python etl/backfill_europeana_fields.py           # dry run: counts, rolled back
    python etl/backfill_europeana_fields.py --apply   # commit
Then restart Strapi so the materialized views pick up the new values.
"""

import argparse
import json
import os

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "../backend/.env"))

DEFAULT_INPUT = os.path.join(os.path.dirname(__file__), "europeana_objects.json")

COLUMNS = [
    "institution_name", "object_id", "place_name", "latitude", "longitude", "inventory_number", "image_rights", "country_en", "city_en", "geocoded_country",
    "geocoder_source", "geocoding_status", "geocoding_notes",
    "institution_latitude", "institution_longitude", "institution_place",
    "institution_city_en", "institution_country_en", "institution_country",
    "object_date_display", "object_date_earliest", "object_date_latest", "object_date_precision",
]


def row_for(r: dict) -> tuple:
    city = r["place_name"] if r["geocoder_source"] == "geonames_exact" else None
    display, earliest, latest, precision = None, None, None, "unknown"
    return (
        r["institution_name"], r["object_id"], r["place_name"], r["latitude"], r["longitude"],
        r.get("inventory_number"), r.get("image_rights"),
        r["geocoded_country"], city, r["geocoded_country"],
        r["geocoder_source"], r["geocoding_status"], r["geocoding_notes"],
        r["institution_latitude"], r["institution_longitude"], r["institution_place"],
        r.get("institution_city_en"), r.get("institution_country_en"), r.get("institution_country"),
        display, earliest, latest, precision,
    )


def main():
    parser = argparse.ArgumentParser(description="Backfill Europeana fields importData.js skips")
    parser.add_argument("--input", default=DEFAULT_INPUT)
    parser.add_argument("--apply", action="store_true", help="Commit (default: dry run, rolled back)")
    args = parser.parse_args()

    with open(args.input, encoding="utf-8") as f:
        records = json.load(f)
    rows = [row_for(r) for r in records]
    print(f"{len(rows):,} records in {args.input}")

    conn = psycopg2.connect(
        host=os.environ.get("DATABASE_HOST", "127.0.0.1"),
        port=int(os.environ.get("DATABASE_PORT", 5432)),
        dbname=os.environ.get("DATABASE_NAME", ""),
        user=os.environ.get("DATABASE_USERNAME", ""),
        password=os.environ.get("DATABASE_PASSWORD", ""),
    )
    try:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TEMP TABLE europeana_fields (
                    institution_name text, object_id bigint, place_name text,
                    latitude float8, longitude float8, inventory_number text, image_rights text, country_en text, city_en text,
                    geocoded_country text, geocoder_source text, geocoding_status text,
                    geocoding_notes text, institution_latitude float8, institution_longitude float8,
                    institution_place text, institution_city_en text, institution_country_en text,
                    institution_country text, object_date_display text, object_date_earliest int,
                    object_date_latest int, object_date_precision text
                ) ON COMMIT DROP
            """)
            psycopg2.extras.execute_values(
                cur, f"INSERT INTO europeana_fields ({', '.join(COLUMNS)}) VALUES %s", rows, page_size=5000)
            cur.execute("""
                UPDATE museum_objects m SET
                    place_name             = t.place_name,
                    latitude               = t.latitude,
                    longitude              = t.longitude,
                    inventory_number       = t.inventory_number,
                    image_rights           = t.image_rights,
                    country_en             = t.country_en,
                    city_en                = t.city_en,
                    geocoded_country       = t.geocoded_country,
                    geocoder_source        = t.geocoder_source,
                    geocoding_status       = t.geocoding_status,
                    geocoding_notes        = t.geocoding_notes,
                    review_status          = COALESCE(m.review_status, 'pending'),
                    institution_latitude   = t.institution_latitude,
                    institution_longitude  = t.institution_longitude,
                    institution_place      = t.institution_place,
                    institution_city_en    = t.institution_city_en,
                    institution_country_en = t.institution_country_en,
                    institution_country    = t.institution_country,
                    object_date_display    = t.object_date_display,
                    object_date_earliest   = t.object_date_earliest,
                    object_date_latest     = t.object_date_latest,
                    object_date_precision  = t.object_date_precision
                FROM europeana_fields t
                WHERE m.institution_name = t.institution_name
                  AND m.object_id = t.object_id
                  AND m.review_status IS DISTINCT FROM 'verified'
            """)
            print(f"{cur.rowcount:,} museum_objects rows updated")
            cur.execute("""
                SELECT count(*) FROM europeana_fields t
                WHERE NOT EXISTS (SELECT 1 FROM museum_objects m
                                  WHERE m.institution_name = t.institution_name AND m.object_id = t.object_id)
            """)
            print(f"{cur.fetchone()[0]:,} records not found in the database (not imported yet?)")
        if args.apply:
            conn.commit()
            print("Committed. Restart Strapi to refresh the materialized views.")
        else:
            conn.rollback()
            print("Dry run — rolled back (re-run with --apply)")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
