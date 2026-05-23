import asyncio
import aiohttp
import argparse
import json
import logging
import os
import sys
import time
from typing import List, Dict, Any, Optional

# Geocoder backends
GEOCODER_BACKEND = os.environ.get("GEOCODER_BACKEND", "postgis")  # "postgis" or "nominatim"

# PostGIS geocoder (preferred - fast, no rate limits)
try:
    from postgis_geocoder import PostGISGeocoder, GeocodingResult
    HAS_POSTGIS = True
except ImportError:
    HAS_POSTGIS = False
    print("Warning: PostGIS geocoder not available, will use Nominatim")

# Nominatim fallback (slow, rate limited)
try:
    from geopy.geocoders import Nominatim
    HAS_NOMINATIM = True
except ImportError:
    HAS_NOMINATIM = False

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("met_scraper")

# Nominatim settings (fallback)
NOMINATIM_DELAY_SECONDS = 1.5
GEOCODE_CACHE_FILE = "geocode_cache.json"
geocode_cache = {}
geolocator = Nominatim(user_agent="met_museum_scraper", timeout=10) if HAS_NOMINATIM else None

# PostGIS geocoder instance (initialized in main)
postgis_geocoder: Optional[PostGISGeocoder] = None


def load_geocode_cache():
    """Load cached geocode results from disk."""
    global geocode_cache
    if os.path.exists(GEOCODE_CACHE_FILE):
        try:
            with open(GEOCODE_CACHE_FILE, 'r') as f:
                geocode_cache = json.load(f)
            print(f"Loaded {len(geocode_cache)} cached geocode results.")
        except Exception as e:
            print(f"Error loading geocode cache: {e}")
            geocode_cache = {}


def save_geocode_cache():
    """Save geocode cache to disk."""
    try:
        with open(GEOCODE_CACHE_FILE, 'w') as f:
            json.dump(geocode_cache, f, indent=2)
    except Exception as e:
        print(f"Error saving geocode cache: {e}")

async def fetch_with_retries(session, url, retries=5, backoff_factor=1.0):
    for i in range(retries):
        try:
            async with session.get(url) as response:
                if response.status == 200:
                    return await response.json()
                elif response.status == 404:
                    print(f"Object not found: {url}")
                    return None
                else:
                    print(f"Error fetching data: {response.status}")
        except aiohttp.ClientError as e:
            print(f"Client error: {e}")
        await asyncio.sleep(backoff_factor * (2 ** i))
    return None

async def fetch_object_ids(session, department_id=3):
    url = f'https://collectionapi.metmuseum.org/public/collection/v1/objects?departmentIds={department_id}&hasImages=true'
    data = await fetch_with_retries(session, url)
    if data:
        print(f"Raw response data for department {department_id}: {data}")
        return data.get('objectIDs', [])
    else:
        print(f"Failed to fetch object IDs for department {department_id} after retries.")
        return []

async def fetch_object_details(session, object_id):
    url = f'https://collectionapi.metmuseum.org/public/collection/v1/objects/{object_id}'
    return await fetch_with_retries(session, url)

def build_original_place_variants(place_names, source_label="met_api"):
    variants = []
    for label in place_names:
        variants.append(
            {
                "label": label,
                "language": "und",
                "source": source_label,
            }
        )
    return variants


def geocode_with_cache(place):
    if not place:
        return None

    # Check in-memory cache first (includes file-loaded cache)
    if place in geocode_cache:
        cached = geocode_cache[place]
        # Convert dict back to a simple namespace for consistency
        if cached is None:
            return None
        if isinstance(cached, dict):
            # Return a simple object with the fields we need
            class CachedLocation:
                def __init__(self, data):
                    self.latitude = data.get('latitude')
                    self.longitude = data.get('longitude')
                    self.raw = data.get('raw', {})
            return CachedLocation(cached)
        return cached

    # Respect public Nominatim rate limits (~1 req/sec/IP)
    time.sleep(NOMINATIM_DELAY_SECONDS)
    try:
        location = geolocator.geocode(place, language="en", addressdetails=True)
    except Exception as exc:
        geocode_cache[place] = None
        save_geocode_cache()
        raise exc

    # Store serializable version in cache
    if location:
        geocode_cache[place] = {
            'latitude': location.latitude,
            'longitude': location.longitude,
            'raw': location.raw
        }
    else:
        geocode_cache[place] = None

    # Periodically save cache to disk
    if len(geocode_cache) % 10 == 0:
        save_geocode_cache()

    return location


def geocode_place_details(place_names):
    """
    Geocode place names using PostGIS (fast) or Nominatim (fallback).
    
    Returns dict with:
        latitude, longitude, geocoded_country, geocoded_region,
        geocoder_source, geocoding_confidence, geocoding_status,
        geocoding_notes, review_status
    """
    global postgis_geocoder
    
    # Use PostGIS if available (fast, no rate limits)
    if postgis_geocoder is not None:
        result = postgis_geocoder.geocode_place_details(place_names)
        return result.to_dict() if hasattr(result, 'to_dict') else {
            "latitude": result.latitude,
            "longitude": result.longitude,
            "geocoded_country": result.geocoded_country,
            "geocoded_region": result.geocoded_region,
            "geocoder_source": result.geocoder_source,
            "geocoding_confidence": result.geocoding_confidence,
            "geocoding_status": result.geocoding_status,
            "geocoding_notes": result.geocoding_notes,
            "review_status": result.review_status,
        }
    
    # Fallback to Nominatim (slow, rate limited)
    return _geocode_nominatim(place_names)


def _geocode_nominatim(place_names):
    """Nominatim-based geocoding (fallback when PostGIS unavailable)."""
    base_result = {
        "latitude": None,
        "longitude": None,
        "geocoded_country": None,
        "geocoded_region": None,
        "geocoder_source": "nominatim",
        "geocoding_confidence": 0.0,
        "geocoding_status": "ok",
        "geocoding_notes": None,
        "review_status": "pending",
    }

    if not place_names:
        return base_result

    candidates = []
    palestine_flag = any("palestin" in part.lower() for part in place_names if part)

    for place in place_names:
        try:
            location = geocode_with_cache(place)
            if not location:
                continue

            raw = location.raw or {}
            address = raw.get("address", {})
            importance = raw.get("importance")
            confidence = min(1.0, float(importance)) if importance else 0.5

            candidate = {
                **base_result,
                "latitude": location.latitude,
                "longitude": location.longitude,
                "geocoded_country": address.get("country"),
                "geocoded_region": address.get("state") or address.get("region") or address.get("county"),
                "geocoding_confidence": confidence,
                "geocoding_notes": raw.get("display_name", place),
            }

            if confidence < 0.6:
                candidate["geocoding_status"] = "ambiguous"

            if palestine_flag and candidate.get("geocoded_country") and candidate["geocoded_country"].lower() == "israel":
                candidate["geocoding_status"] = "disputed"

            if candidate["geocoding_status"] == "ok" and confidence >= 0.85:
                candidate["review_status"] = "verified"
            else:
                candidate["review_status"] = "pending"

            candidates.append(candidate)
        except Exception as e:
            logger.warning(f"Nominatim error for {place}: {e}")

    if candidates:
        return max(
            candidates,
            key=lambda c: (c.get("geocoding_confidence", 0), len(c.get("geocoding_notes") or "")),
        )

    fallback = base_result.copy()
    fallback["geocoding_status"] = "ambiguous"
    fallback["geocoding_notes"] = "No geocoding result"
    fallback["review_status"] = "pending"
    return fallback

async def main(args=None):
    """Main ETL pipeline with configurable geocoder backend."""
    global postgis_geocoder
    
    # Parse CLI arguments
    parser = argparse.ArgumentParser(description="Scrape MET Museum API with geocoding")
    parser.add_argument("-d", "--department", type=int, default=5,
                        help="MET department ID (default: 5 = Arts of Africa)")
    parser.add_argument("-l", "--limit", type=int, default=None,
                        help="Limit number of objects to fetch")
    parser.add_argument("-o", "--output", type=str, default="met_museum_objects.json",
                        help="Output JSON file")
    parser.add_argument("--backend", choices=["postgis", "nominatim"], default="postgis",
                        help="Geocoder backend (default: postgis)")
    parser.add_argument("-v", "--verbose", action="store_true",
                        help="Enable verbose logging")
    
    if args is None:
        args = parser.parse_args()
    
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)
    
    # Initialize geocoder
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
    
    t0 = time.time()

    async with aiohttp.ClientSession() as session:
        department_id = args.department
        object_ids = await fetch_object_ids(session, department_id)

        if not object_ids:
            logger.error("No object IDs found.")
            return
        
        if args.limit:
            object_ids = object_ids[:args.limit]
            logger.info(f"Limited to {args.limit} objects")

        total_objects = len(object_ids)
        logger.info(f"Total objects to fetch: {total_objects}")

        all_objects = []
        batch_size = 10
        for start in range(0, total_objects, batch_size):
            batch_ids = object_ids[start:start + batch_size]
            results = []
            for object_id in batch_ids:
                result = await fetch_object_details(session, object_id)
                results.append(result)
                await asyncio.sleep(0.35)

            for result in results:
                if isinstance(result, Exception):
                    print(f"Error fetching object details: {result}")
                    continue
                if result:
                    place_name_parts = [
                        result.get('city', ''),
                        result.get('state', ''),
                        result.get('county', ''),
                        result.get('country', ''),
                        result.get('region', ''),
                        result.get('subregion', '')
                    ]
                    if not any(place_name_parts) and result.get('culture'):
                        place_name_parts = [result.get('culture', '')]

                    place_name_parts = [part for part in place_name_parts if part]
                    original_variants = build_original_place_variants(place_name_parts)
                    geocode_details = geocode_place_details(place_name_parts)
                    latitude = geocode_details.get('latitude')
                    longitude = geocode_details.get('longitude')
                    
                    # Ensure primaryImageSmall is checked if primaryImage is missing
                    img_url = result.get('primaryImage', result.get('primaryImageSmall', 'N/A'))

                    if img_url == 'N/A':
                        print(f"Image URL is missing for object ID {result.get('objectID', 'N/A')}")

                    # title: use objectName as fallback if title is blank
                    raw_title = result.get('title') or result.get('objectName') or ''

                    object_data = {
                        'object_id': result.get('objectID', 'N/A'),
                        'title': raw_title or 'N/A',
                        'img_url': img_url,
                        'latitude': latitude,
                        'longitude': longitude,
                        'institution_place': 'New York',
                        'object_date': result.get('objectDate') or None,
                        'acquisition_year': int(result['accessionYear']) if result.get('accessionYear') else None,
                        'source_link': f"https://www.metmuseum.org/art/collection/search/{result.get('objectID', 'N/A')}",
                        'institution_latitude': 40.779437,
                        'institution_longitude': -73.963244,
                        'institution_name': 'The Metropolitan Museum of Art',
                        'place_name': ', '.join(place_name_parts),
                        'original_place_variants': original_variants,
                        'geocoded_country': geocode_details.get('geocoded_country'),
                        'geocoded_region': geocode_details.get('geocoded_region'),
                        'geocoder_source': geocode_details.get('geocoder_source'),
                        'geocoding_confidence': geocode_details.get('geocoding_confidence'),
                        'geocoding_status': geocode_details.get('geocoding_status'),
                        'geocoding_notes': geocode_details.get('geocoding_notes'),
                        'review_status': geocode_details.get('review_status'),
                        'time': {
                            'time_name': result.get('period') or None,
                            'time_start': result.get('objectBeginDate') or None,
                            'time_end': result.get('objectEndDate') or None
                        },
                        'inventory_number': result.get('accessionNumber', 'N/A'),
                        'object_links': [
                            {
                                'link_text': f"https://www.metmuseum.org/art/collection/search/{result.get('objectID', 'N/A')}",
                                'link_display': 'Met Museum Object Page',
                                'link_added_on': 'N/A'  # No available date from API
                            }
                        ]
                    }
                    all_objects.append(object_data)

            done = min(start + batch_size, total_objects)
            elapsed = time.time() - t0
            eta = elapsed / done * (total_objects - done) if done > 0 else 0
            logger.info(f"Progress: {done}/{total_objects} ({done/total_objects*100:.1f}%)  ETA: {eta/60:.1f}m")
            await asyncio.sleep(3)  # Batch-level pause

            # Periodically save
            try:
                with open(args.output, 'w') as json_file:
                    json.dump(all_objects, json_file, indent=2)
            except Exception as e:
                logger.error(f"Error saving JSON: {e}")

    # Final save
    try:
        with open(args.output, 'w') as json_file:
            json.dump(all_objects, json_file, indent=2)
        logger.info(f"Saved {len(all_objects)} objects to {args.output}")
    except Exception as e:
        logger.error(f"Error saving JSON: {e}")

    # Cleanup and stats
    if postgis_geocoder:
        postgis_geocoder.summary()
        postgis_geocoder.close()
    else:
        save_geocode_cache()
        logger.info(f"Nominatim cache: {len(geocode_cache)} entries")
    
    logger.info(f"Total time: {(time.time() - t0)/60:.1f} minutes")

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Interrupted by user")
        sys.exit(130)
