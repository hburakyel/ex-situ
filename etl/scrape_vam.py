#!/usr/bin/env python3
"""
scrape_vam.py — Victoria and Albert Museum ETL scraper for Ex Situ.

Fetches objects from the V&A Collections API v2, geocodes the origin place
name via Nominatim (with persistent cache), filters out European origins,
and bulk-inserts into the museum_objects table.

Usage:
    python scrape_vam.py [options]

Options:
    --collection    One of: east-asia, south-asia, middle-east, all (default: all)
    --page-size     Records per API page, max 100 (default: 100)
    --max-pages     Maximum pages per collection (default: 0 = unlimited)
    --start-page    Page to start from, 1-based (default: 1)
    --dry-run       Print mapped records; do not insert into DB
    --output        Optional path to write a .jsonl dump
    --skip-geocode  Skip geocoding; only insert records that have a _primaryPlace
                    that is already in the geocode cache (useful for reruns)

Environment variables (DB connection):
    DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
"""

import argparse
import json
import logging
import os
import sys
import time
from typing import Optional

import psycopg2
import psycopg2.extras
import requests
from dotenv import load_dotenv

from geocode_cache import geocode, geocode_country, is_european
from institution_coords import INSTITUTION_COORDS

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

load_dotenv()

VAM_SEARCH_URL    = "https://api.vam.ac.uk/v2/objects/search"
VAM_OBJECT_BASE   = "https://collections.vam.ac.uk/item"
VAM_IMAGE_BASE    = "https://framemark.vam.ac.uk/collections"

INSTITUTION_NAME  = "Victoria and Albert Museum"

# V&A collection filters for non-European world-culture collections.
# Each value is a dict of API query params to select the collection.
COLLECTIONS = {
    "east-asia":       {"id_collection": "THES48596"},  # East Asia Collection    ~83k
    "south-asia":      {"id_collection": "THES48598"},  # South & South East Asia ~46k
    "middle-east":     {"id_collection": "THES48607"},  # Middle East Section     ~15k
    "africa":          {"q_place_name":  "Africa"},      # Africa (place search)   ~1.2k
    "south-america":   {"id_place":      "x29332"},      # South America            ~47
    "central-america": {"id_place":      "x32911"},      # Central America          ~30
}

# Delay between API pages (V&A has no explicit rate limit, but be polite).
REQUEST_DELAY_SECONDS = 0.3

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Scrape V&A Collections API and import into Ex Situ museum_objects."
    )
    parser.add_argument(
        "--collection",
        default="all",
        choices=[*COLLECTIONS.keys(), "all"],
        help=(
            "Which V&A collection to scrape (default: all). "
            "Options: east-asia, south-asia, middle-east, africa, "
            "south-america, central-america, all."
        ),
    )
    parser.add_argument(
        "--page-size",
        type=int,
        default=100,
        choices=range(1, 101),
        metavar="1-100",
        help="Records per API page (default: 100, max: 100).",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=0,
        help="Maximum pages per collection (default: 0 = unlimited).",
    )
    parser.add_argument(
        "--start-page",
        type=int,
        default=1,
        help="Page number to start from, 1-based (default: 1).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print records without inserting into the database.",
    )
    parser.add_argument(
        "--output",
        metavar="FILE",
        help="Optional path for a .jsonl dump of mapped records.",
    )
    parser.add_argument(
        "--skip-geocode",
        action="store_true",
        help="Skip live Nominatim calls; only use cached geocodes.",
    )
    return parser.parse_args()


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------


def get_db_connection() -> psycopg2.extensions.connection:
    return psycopg2.connect(
        host=os.environ.get("DB_HOST", "127.0.0.1"),
        port=int(os.environ.get("DB_PORT", 5432)),
        dbname=os.environ.get("DB_NAME", ""),
        user=os.environ.get("DB_USER", ""),
        password=os.environ.get("DB_PASSWORD", ""),
    )


INSERT_SQL = """
INSERT INTO museum_objects (
    title,
    inventory_number,
    institution_name,
    institution_place,
    place_name,
    latitude,
    longitude,
    institution_latitude,
    institution_longitude,
    country_en,
    city_en,
    source_link,
    img_url,
    place_name_normalized,
    published_at,
    created_at,
    updated_at
) VALUES (
    %(title)s,
    %(inventory_number)s,
    %(institution_name)s,
    %(institution_place)s,
    %(place_name)s,
    %(latitude)s,
    %(longitude)s,
    %(institution_latitude)s,
    %(institution_longitude)s,
    %(country_en)s,
    %(city_en)s,
    %(source_link)s,
    %(img_url)s,
    %(place_name_normalized)s,
    NOW(),
    NOW(),
    NOW()
)
ON CONFLICT (institution_name, inventory_number) WHERE inventory_number IS NOT NULL DO NOTHING
"""


def bulk_insert(conn: psycopg2.extensions.connection, records: list[dict]) -> int:
    if not records:
        return 0
    with conn.cursor() as cur:
        psycopg2.extras.execute_batch(cur, INSERT_SQL, records, page_size=500)
    conn.commit()
    return len(records)


# ---------------------------------------------------------------------------
# V&A API
# ---------------------------------------------------------------------------


def fetch_page(
    filter_params: dict,
    page: int,
    page_size: int,
    session: requests.Session,
) -> dict:
    """Fetch one page of V&A objects using the given filter params dict."""
    params = {
        **filter_params,
        "page_size": page_size,
        "page": page,
        "fields": (
            "systemNumber,accessionNumber,_primaryTitle,"
            "_primaryPlace,_primaryDate,_primaryImageId,objectType"
        ),
    }
    resp = session.get(VAM_SEARCH_URL, params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
# Field mapping
# ---------------------------------------------------------------------------


# Place names known to be in Europe — skip geocoding, drop immediately.
_EUROPEAN_PLACE_NAMES = {
    "london", "england", "britain", "great britain", "united kingdom", "uk",
    "scotland", "wales", "ireland", "france", "paris", "germany", "berlin",
    "munich", "austria", "vienna", "netherlands", "amsterdam", "belgium",
    "brussels", "italy", "rome", "milan", "florence", "venice", "naples",
    "spain", "madrid", "barcelona", "portugal", "lisbon", "greece", "athens",
    "russia", "moscow", "sweden", "denmark", "norway", "finland", "poland",
    "warsaw", "czech republic", "prague", "hungary", "budapest", "romania",
    "bucharest", "switzerland", "zurich", "europe", "european",
}


def _image_url(image_id: str) -> Optional[str]:
    if not image_id:
        return None
    return f"{VAM_IMAGE_BASE}/{image_id}/full/!800,800/0/default.jpg"


def map_record(
    item: dict,
    institution_lat: float,
    institution_lon: float,
    skip_geocode: bool,
) -> Optional[dict]:
    """
    Map a V&A API record to the museum_objects insert schema.

    Returns None if:
    - the place name is empty
    - the place name looks European
    - geocoding returns None (place not found)
    - geocoding places the origin in Europe
    """
    place_name = (item.get("_primaryPlace") or "").strip()
    if not place_name:
        return None  # no origin data

    # Fast path: well-known European place names.
    if place_name.lower() in _EUROPEAN_PLACE_NAMES:
        return None

    # Geocode origin place.
    if skip_geocode:
        # Only proceed if the place is already in the cache.
        from geocode_cache import _load_cache, _cache
        _load_cache()
        coords = _cache.get(place_name.strip().lower())
        if coords is None:
            # None means either a cache miss (None key absent) or a known miss.
            # Don't attempt live lookup.
            if place_name.strip().lower() not in _cache:
                return None
    else:
        coords = geocode(place_name)

    if coords is None:
        return None  # geocoding failed

    lat, lon = coords
    if is_european(lat, lon, place_name):
        return None  # origin is in Europe — not relevant for Ex Situ

    system_number   = item.get("systemNumber", "")
    accession_number = item.get("accessionNumber", "")
    inventory_number = accession_number or system_number

    title      = (item.get("_primaryTitle") or "").strip() or None
    object_date = (item.get("_primaryDate") or "").strip() or None
    image_id   = item.get("_primaryImageId", "")

    country = geocode_country(place_name) or place_name
    city_en = None if country.lower() == place_name.lower() else place_name

    return {
        "title":                 title,
        "inventory_number":      inventory_number,
        "institution_name":      INSTITUTION_NAME,
        "institution_place":     "London, United Kingdom",
        "place_name":            place_name,
        "latitude":              lat,
        "longitude":             lon,
        "institution_latitude":  institution_lat,
        "institution_longitude": institution_lon,
        "country_en":            country,
        "city_en":               city_en,
        "source_link":           f"{VAM_OBJECT_BASE}/{system_number}/",
        "img_url":               _image_url(image_id),
        "place_name_normalized": place_name,
    }


# ---------------------------------------------------------------------------
# Per-collection scrape loop
# ---------------------------------------------------------------------------


def scrape_collection(
    collection_key: str,
    filter_params: dict,
    args: argparse.Namespace,
    conn: Optional[psycopg2.extensions.connection],
    session: requests.Session,
    output_fh,
    inst_lat: float,
    inst_lon: float,
) -> dict:
    """Scrape a single V&A collection and return counters dict."""
    log.info("=== Scraping V&A collection: %s (%s) ===", collection_key, filter_params)

    counters = {
        "fetched":    0,
        "inserted":   0,
        "no_place":   0,
        "european":   0,
        "geocode_miss": 0,
        "dup":        0,
    }

    page      = args.start_page
    max_pages = args.max_pages or 10_000

    while page <= args.start_page + max_pages - 1:
        try:
            data = fetch_page(filter_params, page, args.page_size, session)
        except requests.HTTPError as exc:
            log.error("HTTP error on page %d: %s", page, exc)
            break
        except requests.RequestException as exc:
            log.error("Request error on page %d: %s", page, exc)
            break

        records_raw = data.get("records") or []
        info        = data.get("info", {})
        total_pages = info.get("pages", 0)

        if not records_raw:
            log.info("No more records on page %d — done.", page)
            break

        counters["fetched"] += len(records_raw)

        mapped_batch = []
        for item in records_raw:
            mapped = map_record(item, inst_lat, inst_lon, args.skip_geocode)
            if mapped is None:
                place = (item.get("_primaryPlace") or "").strip()
                if not place:
                    counters["no_place"] += 1
                elif place.lower() in _EUROPEAN_PLACE_NAMES:
                    counters["european"] += 1
                else:
                    counters["geocode_miss"] += 1
                continue

            # Quick European check already done inside map_record.
            mapped_batch.append(mapped)

            if output_fh:
                output_fh.write(json.dumps(mapped, ensure_ascii=False) + "\n")

            if args.dry_run:
                print(json.dumps(mapped, ensure_ascii=False))

        if not args.dry_run and conn and mapped_batch:
            inserted = bulk_insert(conn, mapped_batch)
            counters["inserted"] += inserted
        else:
            counters["inserted"] += len(mapped_batch)

        log.info(
            "  Page %d/%d | fetched=%d batch_mapped=%d | "
            "total_inserted=%d no_place=%d european=%d geocode_miss=%d",
            page, total_pages, len(records_raw), len(mapped_batch),
            counters["inserted"], counters["no_place"],
            counters["european"], counters["geocode_miss"],
        )

        if page >= total_pages:
            log.info("Reached last page (%d) for collection %s.", total_pages, collection_key)
            break

        page += 1
        time.sleep(REQUEST_DELAY_SECONDS)

    return counters


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    args = parse_args()

    # Institution coordinates.
    inst_info = INSTITUTION_COORDS.get(INSTITUTION_NAME)
    if inst_info is None:
        log.error("Institution %r not found in institution_coords.py", INSTITUTION_NAME)
        sys.exit(1)
    inst_lat = inst_info["lat"]
    inst_lon = inst_info["lon"]

    output_fh = None
    if args.output:
        output_fh = open(args.output, "w", encoding="utf-8")  # noqa: WPS515

    conn = None
    if not args.dry_run:
        try:
            conn = get_db_connection()
            log.info("Connected to database '%s'.", os.environ.get("DB_NAME", ""))
        except psycopg2.OperationalError as exc:
            log.error("Cannot connect to database: %s", exc)
            sys.exit(1)

    session = requests.Session()
    session.headers.update({
        "User-Agent": "ExSituPublic/1.0 (research project)",
        "Accept": "application/json",
    })

    # Which collections to scrape.
    if args.collection == "all":
        to_scrape = list(COLLECTIONS.items())
    else:
        to_scrape = [(args.collection, COLLECTIONS[args.collection])]

    grand_total = {"fetched": 0, "inserted": 0, "no_place": 0, "european": 0, "geocode_miss": 0}

    for coll_key, coll_filter in to_scrape:
        result = scrape_collection(
            coll_key, coll_filter, args, conn, session, output_fh, inst_lat, inst_lon
        )
        for k in grand_total:
            grand_total[k] += result.get(k, 0)

    log.info(
        "=== DONE | fetched=%d inserted=%d no_place=%d european=%d geocode_miss=%d ===",
        grand_total["fetched"], grand_total["inserted"],
        grand_total["no_place"], grand_total["european"], grand_total["geocode_miss"],
    )

    if output_fh:
        output_fh.close()

    if conn and not args.dry_run:
        log.info("Refreshing materialized views...")
        with conn.cursor() as cur:
            cur.execute("REFRESH MATERIALIZED VIEW mv_country_institution_stats")
            cur.execute("REFRESH MATERIALIZED VIEW mv_city_institution_stats")
        conn.commit()
        log.info("Views refreshed.")
        conn.close()


if __name__ == "__main__":
    main()
