#!/usr/bin/env python3
"""
scrape_aic_api.py — Art Institute of Chicago ETL resolver for Ex Situ

Fetches from the AIC public REST API (api.artic.edu, CC0 data / CC-BY
description field, no key required), maps to the museum_objects schema,
and writes a local JSON file. Does not touch the database — see
docs/ETL.md for the import step.

Usage:
    python scrape_aic_api.py --dry-run --limit 20
    python scrape_aic_api.py --output aic_museum_objects.json

Scope filter:
    AIC's own `department_title` facet mixes in-scope and out-of-scope
    material (e.g. "Arts of the Americas" holds both an Aztec coronation
    stone and Grant Wood's "American Gothic" side by side), so it is not
    used as a gate. Instead every record's `place_of_origin` is geocoded
    and dropped post-fetch if it resolves to a country in
    WESTERN_EXCLUDE_COUNTRIES. Records with no place_of_origin are kept
    (unknown, not proven out of scope) — the frontend already skips arc
    rendering for those. Italy/Greece are deliberately NOT excluded (see
    WESTERN_EXCLUDE_COUNTRIES comment) — flag at the Stage 4/5 checkpoint
    if that's wrong for this collection.
"""

import argparse
import json
import logging
import os
import sys
import time
from typing import Any, Dict, List, Optional

import requests

# Geocoder backends (same contract as scrape_met_api.py)
GEOCODER_BACKEND = os.environ.get("GEOCODER_BACKEND", "postgis")

try:
    from postgis_geocoder import PostGISGeocoder
    HAS_POSTGIS = True
except ImportError:
    HAS_POSTGIS = False
    print("Warning: PostGIS geocoder not available, will use Nominatim")

try:
    from geopy.geocoders import Nominatim
    HAS_NOMINATIM = True
except ImportError:
    HAS_NOMINATIM = False

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("aic_scraper")

NOMINATIM_DELAY_SECONDS = 1.5
GEOCODE_CACHE_FILE = "geocode_cache.json"
geocode_cache: Dict[str, Any] = {}
geolocator = Nominatim(user_agent="aic_museum_scraper", timeout=10) if HAS_NOMINATIM else None
postgis_geocoder: Optional["PostGISGeocoder"] = None

API_BASE = "https://api.artic.edu/api/v1"
FIELDS = [
    "id", "title", "place_of_origin", "date_display", "date_start", "date_end",
    "artist_display", "main_reference_number", "image_id", "is_public_domain",
    "department_title",
]

INSTITUTION_NAME = "Art Institute of Chicago"
INSTITUTION_PLACE = "Chicago"
INSTITUTION_LAT = 41.8796
INSTITUTION_LON = -87.6237

# Countries treated as out-of-scope Western origin for this collection.
# Deliberately excludes Italy/Greece/Cyprus — AIC holds substantial ancient
# Mediterranean/Byzantine material (e.g. Roman antiquities) whose
# place_of_origin geocodes to modern Italy/Greece, and COLLECTIONS.md scope
# names "the Mediterranean" as in-scope. Flag this list if it's wrong.
WESTERN_EXCLUDE_COUNTRIES = {
    "united states", "canada", "united kingdom", "ireland", "france",
    "germany", "netherlands", "belgium", "luxembourg", "switzerland",
    "austria", "denmark", "norway", "sweden", "finland", "iceland",
    "poland", "czechia", "czech republic", "slovakia", "hungary",
    "spain", "portugal",
}


def load_geocode_cache():
    global geocode_cache
    if os.path.exists(GEOCODE_CACHE_FILE):
        try:
            with open(GEOCODE_CACHE_FILE, "r") as f:
                geocode_cache = json.load(f)
            logger.info(f"Loaded {len(geocode_cache)} cached geocode results.")
        except Exception as e:
            logger.error(f"Error loading geocode cache: {e}")
            geocode_cache = {}


def save_geocode_cache():
    try:
        with open(GEOCODE_CACHE_FILE, "w") as f:
            json.dump(geocode_cache, f, indent=2)
    except Exception as e:
        logger.error(f"Error saving geocode cache: {e}")


def geocode_candidates_with_cache(place: str) -> List[Dict[str, Any]]:
    """Return up to 5 Nominatim candidates for `place` (cached), ranked by importance."""
    if not place:
        return []
    if place in geocode_cache:
        return geocode_cache[place] or []

    time.sleep(NOMINATIM_DELAY_SECONDS)
    try:
        locations = geolocator.geocode(
            place, language="en", addressdetails=True, exactly_one=False, limit=5
        )
    except Exception as exc:
        geocode_cache[place] = None
        save_geocode_cache()
        raise exc

    candidates = []
    for loc in (locations or []):
        raw = loc.raw or {}
        candidates.append({
            "latitude": loc.latitude,
            "longitude": loc.longitude,
            "raw": raw,
        })
    geocode_cache[place] = candidates
    if len(geocode_cache) % 10 == 0:
        save_geocode_cache()
    return candidates


def _geocode_nominatim(place: str) -> Dict[str, Any]:
    base_result = {
        "latitude": None, "longitude": None, "geocoded_country": None,
        "geocoded_region": None, "geocoder_source": "nominatim",
        "geocoding_confidence": 0.0, "geocoding_status": "ok",
        "geocoding_notes": None, "review_status": "pending",
    }
    if not place:
        return base_result
    try:
        candidates = geocode_candidates_with_cache(place)
    except Exception as e:
        result = base_result.copy()
        result["geocoding_status"] = "ambiguous"
        result["geocoding_notes"] = f"Geocoder error: {e}"
        logger.warning(f"Nominatim error for {place}: {e}")
        return result
    if not candidates:
        result = base_result.copy()
        result["geocoding_status"] = "ambiguous"
        result["geocoding_notes"] = "No geocoding result"
        return result

    top = candidates[0]
    raw = top.get("raw") or {}
    address = raw.get("address", {})
    importance = raw.get("importance")
    confidence = min(1.0, float(importance)) if importance else 0.5

    # A single bare place name (no comma/qualifier from the source) that resolves
    # to more than one distinct country among Nominatim's top candidates is a
    # historical/ambiguous toponym (e.g. AIC's "Thebes" for an Egyptian coffin
    # matching both Thebes, Greece and Thebes/Luxor, Egypt) — flag rather than
    # silently trust the top-ranked guess.
    distinct_countries = {
        c["raw"].get("address", {}).get("country")
        for c in candidates
        if c.get("raw", {}).get("address", {}).get("country")
    }
    multi_country_ambiguous = len(distinct_countries) > 1 and "," not in place

    result = {
        **base_result,
        "latitude": top.get("latitude"),
        "longitude": top.get("longitude"),
        "geocoded_country": address.get("country"),
        "geocoded_region": address.get("state") or address.get("region") or address.get("county"),
        "geocoding_confidence": confidence,
        "geocoding_notes": raw.get("display_name", place),
    }
    if confidence < 0.6:
        result["geocoding_status"] = "ambiguous"
    if multi_country_ambiguous:
        result["geocoding_status"] = "ambiguous"
        countries_list = ", ".join(sorted(distinct_countries))
        result["geocoding_notes"] = (
            f"{result['geocoding_notes']} — multiple candidate countries for bare "
            f"name {place!r}: {countries_list}; needs manual review"
        )
    result["review_status"] = "verified" if (result["geocoding_status"] == "ok" and confidence >= 0.85) else "pending"
    return result


def geocode_place(place: Optional[str]) -> Dict[str, Any]:
    """Geocode a single place_of_origin string via PostGIS (preferred) or Nominatim."""
    if postgis_geocoder is not None:
        result = postgis_geocoder.geocode_place_details([place] if place else [])
        return result.to_dict() if hasattr(result, "to_dict") else result
    return _geocode_nominatim(place)


def fetch_page(session: requests.Session, page: int, limit: int, department: Optional[str]) -> Dict[str, Any]:
    params = {
        "page": page,
        "limit": limit,
        "fields": ",".join(FIELDS),
    }
    if department:
        # /search supports term-filtering; only safe for departments well under
        # the API's 10,000-result search cap (use for sampling, not full fetch).
        params["query[term][department_title.keyword]"] = department
        url = f"{API_BASE}/artworks/search"
    else:
        url = f"{API_BASE}/artworks"

    for attempt in range(5):
        try:
            resp = session.get(url, params=params, timeout=30)
            if resp.status_code == 200:
                return resp.json()
            logger.warning(f"HTTP {resp.status_code} on page {page}")
        except requests.RequestException as e:
            logger.warning(f"Request error on page {page}: {e}")
        time.sleep(1.0 * (2 ** attempt))
    return {}


def build_object_links(object_id) -> List[Dict[str, str]]:
    return [{
        "link_text": f"https://www.artic.edu/artworks/{object_id}",
        "link_display": "Art Institute of Chicago Object Page",
        "link_added_on": None,
    }]


def map_record(item: Dict[str, Any]) -> Dict[str, Any]:
    object_id = item.get("id")
    place_of_origin = (item.get("place_of_origin") or "").strip() or None

    geo = geocode_place(place_of_origin)

    image_id = item.get("image_id")
    img_url = f"https://www.artic.edu/iiif/2/{image_id}/full/843,/0/default.jpg" if image_id else None

    return {
        "object_id": object_id,
        "title": item.get("title") or None,
        "img_url": img_url,
        "latitude": geo.get("latitude"),
        "longitude": geo.get("longitude"),
        "institution_place": INSTITUTION_PLACE,
        "object_date": item.get("date_display") or None,
        "source_link": f"https://www.artic.edu/artworks/{object_id}",
        "institution_latitude": INSTITUTION_LAT,
        "institution_longitude": INSTITUTION_LON,
        "institution_name": INSTITUTION_NAME,
        "place_name": place_of_origin,
        "geocoded_country": geo.get("geocoded_country"),
        "geocoded_region": geo.get("geocoded_region"),
        "geocoder_source": geo.get("geocoder_source"),
        "geocoding_confidence": geo.get("geocoding_confidence"),
        "geocoding_status": geo.get("geocoding_status"),
        "geocoding_notes": geo.get("geocoding_notes"),
        "review_status": geo.get("review_status"),
        "time": {
            "time_name": item.get("date_display") or None,
            "time_start": item.get("date_start"),
            "time_end": item.get("date_end"),
        },
        "inventory_number": item.get("main_reference_number") or None,
        "object_links": build_object_links(object_id),
        "_department_title": item.get("department_title"),  # dropped before final write; debug only
        "_is_public_domain": item.get("is_public_domain"),   # image rights differ from CC0 data license
    }


def is_out_of_scope(mapped: Dict[str, Any]) -> bool:
    country = (mapped.get("geocoded_country") or "").strip().lower()
    return country in WESTERN_EXCLUDE_COUNTRIES


def main(argv=None):
    global postgis_geocoder

    parser = argparse.ArgumentParser(description="Scrape the Art Institute of Chicago API")
    parser.add_argument("-d", "--department", type=str, default=None,
                         help="Restrict to one AIC department_title (sampling convenience only — "
                              "not a scope guarantee, see module docstring)")
    parser.add_argument("-l", "--limit", type=int, default=None,
                         help="Stop after fetching this many raw records (pre-filter)")
    parser.add_argument("--page-size", type=int, default=100,
                         help="Records per API page, max 100 (default: 100)")
    parser.add_argument("-o", "--output", type=str, default="aic_museum_objects.json",
                         help="Output JSON file")
    parser.add_argument("--dry-run", action="store_true",
                         help="Print mapped records instead of writing the output file")
    parser.add_argument("--backend", choices=["postgis", "nominatim"], default="postgis",
                         help="Geocoder backend (default: postgis)")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    if args.backend == "postgis" and HAS_POSTGIS:
        try:
            postgis_geocoder = PostGISGeocoder()
            logger.info("Using PostGIS geocoder (fast, no rate limits)")
        except Exception as e:
            logger.warning(f"PostGIS connection failed: {e}")
            logger.info("Falling back to Nominatim")
            postgis_geocoder = None
            load_geocode_cache()
    else:
        postgis_geocoder = None
        load_geocode_cache()
        logger.info("Using Nominatim geocoder (slow, rate limited)")

    session = requests.Session()
    session.headers.update({"AIC-User-Agent": "ExSitu/1.0 (ex-situ collections project)"})

    t0 = time.time()
    kept: List[Dict[str, Any]] = []
    total_fetched = 0
    total_dropped_scope = 0
    page = 1

    while True:
        data = fetch_page(session, page, args.page_size, args.department)
        items = data.get("data") or []
        if not items:
            logger.info("No more items — pagination complete.")
            break

        for item in items:
            total_fetched += 1
            mapped = map_record(item)
            if is_out_of_scope(mapped):
                total_dropped_scope += 1
                continue
            kept.append(mapped)

            if args.limit and total_fetched >= args.limit:
                break

        pagination = data.get("pagination", {})
        total_pages = pagination.get("total_pages", page)
        logger.info(
            f"Page {page}/{total_pages} | fetched: {total_fetched} | kept: {len(kept)} | "
            f"dropped (out of scope): {total_dropped_scope}"
        )

        if args.limit and total_fetched >= args.limit:
            logger.info(f"Reached --limit {args.limit}")
            break
        if page >= total_pages:
            break
        page += 1
        time.sleep(0.2)  # stay well under the 60 req/min anonymous rate limit

    # Strip debug-only keys before output
    for rec in kept:
        rec.pop("_department_title", None)
        rec.pop("_is_public_domain", None)

    if args.dry_run:
        for rec in kept:
            print(json.dumps(rec, indent=2, ensure_ascii=False))
        logger.info(f"[DRY RUN] {len(kept)} records mapped, nothing written to disk.")
    else:
        with open(args.output, "w") as f:
            json.dump(kept, f, indent=2, ensure_ascii=False)
        logger.info(f"Saved {len(kept)} objects to {args.output}")

    if postgis_geocoder:
        if hasattr(postgis_geocoder, "summary"):
            postgis_geocoder.summary()
        postgis_geocoder.close()
    else:
        save_geocode_cache()

    logger.info(
        f"Done in {(time.time() - t0)/60:.1f}m | fetched: {total_fetched} | "
        f"kept: {len(kept)} | dropped (scope): {total_dropped_scope}"
    )


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        logger.info("Interrupted by user")
        sys.exit(130)
