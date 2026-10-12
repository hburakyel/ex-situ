#!/usr/bin/env python3
"""
scrape_europeana.py — Europeana resolver for Ex Situ

Europeana is an aggregator, not a collection: every record is attributed to
its dataProvider (the holding institution) and links to that institution's
own page (edmIsShownAt). "Europeana" never appears as institution_name.

Scope: only objects whose *origin* is outside Europe. Origin is read from the
provider's own spatial statements (dcterms:spatial, dc:coverage) and resolved
to a country by exact lookup only — no fuzzy matching:

  - GeoNames URI          → geonameid in the local gazetteer
                            (countryInfo / admin1 / cities500)
  - Europeana place URI   → Entity API sameAs → GeoNames id or EU country code
  - K-samsök country URI  → ISO 3166 code in the URI
  - plain text            → exact (case-insensitive) country name only;
                            a city name found in several countries is flagged

Continent comes from the GeoNames countryInfo table (EU = Europe; Turkey,
the Caucasus and Palestine are AS there). A record is kept only when every
resolved place is non-European. Records with both European and non-European
places, or with a place name that matches several countries, are flagged
for review and never kept. When the provider gives no resolvable place,
Europeana's own enrichment (edmPlace) is used and the record is marked
place_source = "europeana_enrichment" so it can be reviewed separately.

Objects held by SMB, the Met, the V&A or AIC are skipped — they are indexed
from those institutions directly.

Writes JSON only (no database, no Strapi). Dry run by default: prints counts
per dataProvider. --apply writes the output files for importData.js.

Usage:
    export EUROPEANA_API_KEY=...        # never commit it
    python scrape_europeana.py                       # dry run, full scan
    python scrape_europeana.py --max-pages 5         # dry run, sample
    python scrape_europeana.py --apply               # write JSON
"""

import argparse
import hashlib
import json
import logging
import os
import re
import sys
import time
from collections import Counter, defaultdict
from typing import Optional

import requests

ETL_DIR = os.path.dirname(os.path.abspath(__file__))
GAZETTEER_DIR = os.path.join(ETL_DIR, "data", "gazetteer")

SEARCH_URL = "https://api.europeana.eu/record/v2/search.json"
ENTITY_URL = "https://api.europeana.eu/entity/place/{id}.json"
ORG_URL = "https://api.europeana.eu/entity/organization/{id}.json"
PLACE_CACHE_FILE = os.path.join(ETL_DIR, "europeana_place_cache.json")
ORG_CACHE_FILE = os.path.join(ETL_DIR, "europeana_org_cache.json")
CHECKPOINT_FILE = os.path.join(ETL_DIR, "europeana_checkpoint.json")
RECORD_URL = "https://api.europeana.eu/record/v2{id}.json"
IDENTIFIER_CACHE_FILE = os.path.join(ETL_DIR, "europeana_identifier_cache.jsonl")
# Written by check_europeana_images.py: image URLs that do not load in a browser.
IMAGE_CHECK_FILE = os.path.join(ETL_DIR, "europeana_image_check.json")
IMAGE_HOSTS_FILE = os.path.join(ETL_DIR, "..", "frontend", "lib", "europeana-image-hosts.json")

REQUEST_DELAY_SECONDS = 0.25
MAX_RETRIES = 5

# Candidate narrowing on Europeana's side: at least one place coordinate
# outside a rough Europe box, or in Anatolia / the Levant / the Maghreb.
# This only reduces paging; the origin decision is made per record below.
CANDIDATE_QUERY = (
    "pl_wgs84_pos_lat:[-90 TO 35] OR pl_wgs84_pos_long:[45 TO 180] "
    "OR pl_wgs84_pos_long:[-180 TO -25] "
    "OR (pl_wgs84_pos_lat:[35 TO 43] AND pl_wgs84_pos_long:[26 TO 45]) "
    "OR (pl_wgs84_pos_lat:[35 TO 38] AND pl_wgs84_pos_long:[-10 TO 12])"
)

# Not artifacts, or records whose place is what is depicted rather than
# where the thing was made (photographs, postcards, maps, newsreels).
EXCLUDED_WHAT = [
    "specimen", "herbarium", "botany", "zoology", "fossil", "mineral",
    '"natural history"', "photograph", "photo", "postcard", "map",
    "newspaper",
]

# Natural-history providers: specimens, not cultural artifacts. The what:
# exclusion above misses records that are not typed as specimens.
NON_ARTIFACT_PROVIDERS = ["herbarium", "botanic", "natural history", "biodiversity", "life sciences"]

# Desk review, 2026-10-12: providers whose Europeana records here show a place
# rather than come from it (maps, photo archives, book illustrations, European
# paintings of "oriental" scenes) or are modern manufactured goods (printers,
# radios, SIM cards). Not displaced heritage. Exact dataProvider names.
OUT_OF_SCOPE_PROVIDERS = {
    "Cartographic and Geological Institute of Catalonia": "maps",
    "Rippl-Rónai Municipal Museum with County Scope - Kaposvár": "nature/travel photographs",
    "Fortepan": "photo archive",
    "Hungarian Slide-film Collection": "slide films / projectors",
    "Netherlands Institute for Military History": "photographs",
    "Gävleborg County Museum": "portrait photographs",
    "TIB - Leibniz Information Centre for Science and Technology and University Library": "architecture photographs",
    "National Library of Portugal": "photographs",
    "The British Library": "book illustrations",
    "Virtual Library of Bibliographical Heritage": "maps/plans",
    "Galiciana: Digital Library of Galicia": "printed matter",
    "Freies Deutsches Hochstift / Frankfurter Goethe-Museum": "books by European authors",
    "International Institute of Social History": "postcards",
    "Metropolitan Organisation of Museums of Visual Arts of Thessaloniki – MOMus": "European artworks about the place",
    "Bucharest Municipality Museum": "European paintings of the place",
    "Royal Court National Museum Complex": "European painting of the place",
    "Museum of Art Cluj-Napoca": "European painting of the place",
    "Värmland Museum": "watercolour of the place",
    "Roscheider Hof Open Air Museum": "modern consumer goods",
    "Science Center and Technology Museum (NOESIS)": "modern electronics",
    # Origin only from Europeana's automatic place tagging, not from the museum's
    # own records (e.g. 3,441 objects tagged "Türkiye"); a tagged place is often
    # one depicted or mentioned. Left out until checked against RMO's own data.
    "National Museum of Antiquities": "origin from Europeana enrichment only",
    "Moldova National Museum Complex": "modern manufactured goods",
    "Petroleum Museum": "industrial tools",
    "Netherlands Institute for Sound & Vision": "consumer electronics",
    "Swedish National Museum of Science and Technology": "modern products",
}

# Indexed directly from the institution — never via Europeana.
HELD_ELSEWHERE = [
    "staatliche museen zu berlin", "berlin state museums",
    "metropolitan museum of art",
    "victoria and albert museum", "v&a",
    "art institute of chicago",
]

# Image hosts reached by redirect (the browser checks CSP on the target too).
IMAGE_REDIRECT_HOSTS = [
    "access.iisg.amsterdam",        # hdl.handle.net/10622/...
    "collectie.wereldmuseum.nl",    # collectie.wereldculturen.nl
]

OPEN_RIGHTS = (
    "creativecommons.org/publicdomain/zero/",
    "creativecommons.org/publicdomain/mark/",
    "creativecommons.org/licenses/by/",
    "creativecommons.org/licenses/by-sa/",
)

GEONAMES_RE = re.compile(r"^https?://(?:sws\.|www\.)?geonames\.org/(\d+)")
EUROPEANA_ORG_RE = re.compile(r"^https?://data\.europeana\.eu/organization/(\d+)")
EUROPEANA_PLACE_RE = re.compile(r"^https?://data\.europeana\.eu/place/(\d+)")
KSAMSOK_COUNTRY_RE = re.compile(r"^https?://kulturarvsdata\.se/resurser/aukt/geo/country#([a-z]{2})$", re.I)
EU_COUNTRY_RE = re.compile(r"^https?://publications\.europa\.eu/resource/authority/country/([A-Z]{3})$")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("europeana_scraper")


# ---------------------------------------------------------------------------
# Gazetteer (exact lookups only)
# ---------------------------------------------------------------------------

class Gazetteer:
    def __init__(self, directory: str):
        self.countries = {}          # ISO2 → {name, iso3, continent}
        self.iso3 = {}               # ISO3 → ISO2
        self.country_by_name = {}    # lower name → ISO2
        self.geonameid = {}          # geonameid → (name, ISO2, lat, lon, level)
        self.city_names = defaultdict(set)  # lower name → {ISO2}
        self.towns = []                     # (lat, lon, population, ISO2, name, {lower names})

        with open(os.path.join(directory, "countryInfo.txt"), encoding="utf-8") as f:
            for line in f:
                if line.startswith("#"):
                    continue
                c = line.rstrip("\n").split("\t")
                if len(c) < 17:
                    continue
                iso2, iso3, name, continent, gid = c[0], c[1], c[4], c[8], c[16]
                self.countries[iso2] = {"name": name, "iso3": iso3, "continent": continent}
                self.iso3[iso3] = iso2
                self.country_by_name[name.lower()] = iso2
                if gid:
                    self.geonameid[gid] = (name, iso2, None, None, "country")

        with open(os.path.join(directory, "admin1CodesASCII.txt"), encoding="utf-8") as f:
            for line in f:
                c = line.rstrip("\n").split("\t")
                if len(c) == 4:
                    self.geonameid.setdefault(c[3], (c[1], c[0].split(".")[0], None, None, "region"))

        with open(os.path.join(directory, "cities500.txt"), encoding="utf-8") as f:
            for line in f:
                c = line.rstrip("\n").split("\t")
                gid, name, ascii_name, lat, lon, iso2 = c[0], c[1], c[2], c[4], c[5], c[8]
                self.geonameid.setdefault(gid, (name, iso2, float(lat), float(lon), "city"))
                names = {name.lower(), ascii_name.lower()} | {a.lower() for a in c[3].split(",") if a}
                self.towns.append((float(lat), float(lon), int(c[14] or 0), iso2, name, names))
                self.city_names[name.lower()].add(iso2)
                self.city_names[ascii_name.lower()].add(iso2)

    def institution_city(self, lat: float, lon: float, iso2: Optional[str],
                         locality: Optional[str], radius_km: float = 15) -> Optional[str]:
        """
        City of a museum point. Europeana's locality text is kept when a town
        of that name lies within radius_km; otherwise (e.g. Malmö Museum listed
        as "Copenhagen") the most populous nearby town in the same country.
        """
        import math
        near = []
        for tlat, tlon, pop, cc, name, names in self.towns:
            if iso2 and cc != iso2:
                continue
            if abs(tlat - lat) > 0.3 or abs(tlon - lon) > 0.5:
                continue
            d = 6371 * math.acos(min(1, math.sin(math.radians(lat)) * math.sin(math.radians(tlat))
                + math.cos(math.radians(lat)) * math.cos(math.radians(tlat)) * math.cos(math.radians(tlon - lon))))
            if d <= radius_km:
                near.append((pop, name, names))
        if locality and any(locality.lower() in names for _, _, names in near):
            return locality
        if near:
            return max(near)[1]
        return locality

    def is_european(self, iso2: str) -> bool:
        return self.countries.get(iso2, {}).get("continent") == "EU"

    def country_name(self, iso2: str) -> Optional[str]:
        return self.countries.get(iso2, {}).get("name")


# ---------------------------------------------------------------------------
# Europeana API
# ---------------------------------------------------------------------------

def api_get(session: requests.Session, url: str, params: dict) -> Optional[dict]:
    for attempt in range(MAX_RETRIES):
        try:
            resp = session.get(url, params=params, timeout=60)
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code == 404:
                return None
            logger.warning("HTTP %s for %s", resp.status_code, url)
        except requests.RequestException as exc:
            logger.warning("Request error: %s", exc)
        time.sleep(2 ** attempt)
    raise RuntimeError(f"Giving up on {url} after {MAX_RETRIES} attempts")


def candidate_query() -> str:
    excluded = " OR ".join(EXCLUDED_WHAT)
    return f"({CANDIDATE_QUERY}) AND NOT what:({excluded})"


def fetch_page(session: requests.Session, cursor: str, rows: int, providers: list) -> dict:
    qf = ["TYPE:(IMAGE OR 3D)"]
    if providers:
        qf.append(" OR ".join(f'DATA_PROVIDER:"{p}"' for p in providers))
    params = {
        "query": candidate_query(),
        "qf": qf,
        "rows": rows,
        "cursor": cursor,
        "profile": "rich",
    }
    data = api_get(session, SEARCH_URL, params)
    if data is None or not data.get("success", True):
        raise RuntimeError(f"Search failed: {data and data.get('error')}")
    return data


class EuropeanaPlaces:
    """Europeana place entities → GeoNames id / ISO3, cached on disk."""

    def __init__(self, session: requests.Session):
        self.session = session
        self.cache = {}
        self.dirty = False
        if os.path.exists(PLACE_CACHE_FILE):
            with open(PLACE_CACHE_FILE, encoding="utf-8") as f:
                self.cache = json.load(f)

    def get(self, place_id: str) -> dict:
        if place_id not in self.cache:
            data = api_get(self.session, ENTITY_URL.format(id=place_id), {}) or {}
            entry = {"label": (data.get("prefLabel") or {}).get("en"), "geonames": None, "iso3": None}
            for same in data.get("sameAs") or []:
                m = GEONAMES_RE.match(same)
                if m and not entry["geonames"]:
                    entry["geonames"] = m.group(1)
                m = EU_COUNTRY_RE.match(same)
                if m and not entry["iso3"]:
                    entry["iso3"] = m.group(1)
            self.cache[place_id] = entry
            self.dirty = True
            time.sleep(REQUEST_DELAY_SECONDS)
        return self.cache[place_id]

    def save(self):
        if self.dirty:
            with open(PLACE_CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump(self.cache, f, ensure_ascii=False, indent=1)
            self.dirty = False


class EuropeanaOrgs:
    """
    Europeana organisation entities: the holding institution's own address
    and coordinates (hasAddress.hasGeo), cached on disk.
    """

    def __init__(self, session: requests.Session):
        self.session = session
        self.cache = {}
        if os.path.exists(ORG_CACHE_FILE):
            with open(ORG_CACHE_FILE, encoding="utf-8") as f:
                self.cache = json.load(f)

    def get(self, org_id: str) -> dict:
        if org_id not in self.cache:
            data = api_get(self.session, ORG_URL.format(id=org_id), {}) or {}
            labels = set((data.get("prefLabel") or {}).values())
            for vals in (data.get("altLabel") or {}).values():
                labels.update(_list(vals))
            address = data.get("hasAddress") or {}
            geo = address.get("hasGeo")
            lat = lon = None
            if isinstance(geo, dict):
                lat, lon = geo.get("lat"), geo.get("long")
            elif isinstance(geo, str) and geo.startswith("geo:"):
                lat, _, lon = geo[4:].partition(",")
            try:
                lat, lon = float(lat), float(lon)
            except (TypeError, ValueError):
                lat = lon = None
            self.cache[org_id] = {
                "labels": sorted(labels), "lat": lat, "lon": lon,
                "locality": address.get("locality"), "country": address.get("countryName"),
            }
            time.sleep(REQUEST_DELAY_SECONDS)
        return self.cache[org_id]

    def save(self):
        with open(ORG_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(self.cache, f, ensure_ascii=False, indent=1)


# ---------------------------------------------------------------------------
# Origin resolution
# ---------------------------------------------------------------------------

def _list(value) -> list:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def _lang_value(value) -> Optional[str]:
    """Pick the English, then default, then any value from a LangAware dict."""
    if isinstance(value, dict):
        for lang in ("en", "def"):
            if value.get(lang):
                return _list(value[lang])[0]
        for vals in value.values():
            if vals:
                return _list(vals)[0]
        return None
    vals = _list(value)
    return vals[0] if vals else None


def resolve_value(value: str, gaz: Gazetteer, places: EuropeanaPlaces) -> dict:
    """
    Resolve one spatial value. Returns
      {"status": "resolved", "iso2", "label", "lat", "lon", "level", "raw"}
      {"status": "ambiguous", "candidates": [...], "raw"}
      {"status": "unresolved", "raw"}
    """
    raw = value.strip()

    def from_geonameid(gid: str, label: Optional[str] = None) -> Optional[dict]:
        hit = gaz.geonameid.get(gid)
        if not hit:
            return None
        name, iso2, lat, lon, level = hit
        return {"status": "resolved", "iso2": iso2, "label": label or name,
                "lat": lat, "lon": lon, "level": level, "raw": raw}

    m = GEONAMES_RE.match(raw)
    if m:
        return from_geonameid(m.group(1)) or {"status": "unresolved", "raw": raw}

    m = EUROPEANA_PLACE_RE.match(raw)
    if m:
        entity = places.get(m.group(1))
        if entity["geonames"]:
            hit = from_geonameid(entity["geonames"], entity["label"])
            if hit:
                return hit
        iso2 = gaz.iso3.get(entity["iso3"] or "")
        if iso2:
            return {"status": "resolved", "iso2": iso2, "label": entity["label"] or gaz.country_name(iso2),
                    "lat": None, "lon": None, "level": "country", "raw": raw}
        return {"status": "unresolved", "raw": raw}

    m = KSAMSOK_COUNTRY_RE.match(raw)
    if m and m.group(1).upper() in gaz.countries:
        iso2 = m.group(1).upper()
        return {"status": "resolved", "iso2": iso2, "label": gaz.country_name(iso2),
                "lat": None, "lon": None, "level": "country", "raw": raw}

    if re.match(r"^[a-z]+:", raw, re.I):
        return {"status": "unresolved", "raw": raw}   # other authority URIs

    key = raw.lower()
    if key in gaz.country_by_name:
        iso2 = gaz.country_by_name[key]
        return {"status": "resolved", "iso2": iso2, "label": raw,
                "lat": None, "lon": None, "level": "country", "raw": raw}

    # A plain-text name that is also a city name in several countries is
    # flagged. A name matching a single cities500 entry is still not trusted:
    # cities500 lists Greek Rhodes as "Rodos", so "Rhodes" alone would map
    # to Australia. Plain text only resolves as an exact country name.
    cities = gaz.city_names.get(key)
    if cities and len(cities) > 1:
        return {"status": "ambiguous", "candidates": sorted(cities), "raw": raw}

    return {"status": "unresolved", "raw": raw}


def classify(values: list, gaz: Gazetteer, places: EuropeanaPlaces) -> tuple:
    """Return (decision, resolved, ambiguous) for a list of spatial values."""
    seen = set()
    resolved, ambiguous = [], []
    for v in values:
        if not isinstance(v, str) or not v.strip() or v.strip() in seen:
            continue
        seen.add(v.strip())
        r = resolve_value(v, gaz, places)
        if r["status"] == "resolved":
            resolved.append(r)
        elif r["status"] == "ambiguous":
            ambiguous.append(r)

    if not resolved and not ambiguous:
        return "unresolved", resolved, ambiguous
    # "Alexandria" next to a URI for Alexandria, Egypt is not ambiguous.
    countries = {r["iso2"] for r in resolved}
    ambiguous = [a for a in ambiguous if not countries & set(a["candidates"])]
    european = {r["iso2"] for r in resolved if gaz.is_european(r["iso2"])}
    non_european = {r["iso2"] for r in resolved if not gaz.is_european(r["iso2"])}
    if european and non_european:
        return "mixed", resolved, ambiguous
    if european:
        return "european", resolved, ambiguous
    if ambiguous:
        return "ambiguous", resolved, ambiguous
    return "non_european", resolved, ambiguous


def resolve_origin(item: dict, gaz: Gazetteer, places: EuropeanaPlaces) -> tuple:
    """Provider statements first; Europeana enrichment only if those give nothing."""
    provider_values = _list(item.get("dctermsSpatial")) + _list(item.get("dcCoverage"))
    decision, resolved, ambiguous = classify(provider_values, gaz, places)
    if decision != "unresolved":
        return decision, "provider", resolved, ambiguous
    decision, resolved, ambiguous = classify(_list(item.get("edmPlace")), gaz, places)
    return decision, "europeana_enrichment", resolved, ambiguous


# ---------------------------------------------------------------------------
# Mapping
# ---------------------------------------------------------------------------

def held_elsewhere(provider: str) -> bool:
    p = provider.lower()
    return any(k in p for k in HELD_ELSEWHERE)


def stable_object_id(europeana_id: str) -> int:
    """
    object_id is a bigint, but importData.js parses JSON into JS numbers, which
    are exact only up to 2**53. Derive a stable 53-bit id from the Europeana id.
    """
    return int.from_bytes(hashlib.sha256(europeana_id.encode()).digest()[:8], "big") >> 11


def place_labels(resolved: list, country_name=None) -> list:
    """
    One label per country, from its most specific place: "Türkiye" and the
    Europeana entity "Turkey" for the same record become one name. A label that
    only names the country is the GeoNames English name (country_name(iso2)), the
    one every other collection uses — Europeana's own entity labels ("Türkiye",
    "Viet Nam") would list the same country twice.
    """
    rank = {"city": 0, "region": 1, "country": 2}
    best = {}
    for r in resolved:
        if r["label"] and (r["iso2"] not in best or rank[r["level"]] < rank[best[r["iso2"]]["level"]]):
            best[r["iso2"]] = r
    return [country_name(c) if country_name and best[c]["level"] == "country" else best[c]["label"] for c in sorted(best)]


def map_record(item: dict, decision: str, source: str, resolved: list,
               ambiguous: list, gaz: Gazetteer) -> dict:
    europeana_id = item.get("id", "")
    shown_at = _lang_value(item.get("edmIsShownAt"))
    rights = _lang_value(item.get("rights")) or ""
    image = _lang_value(item.get("edmIsShownBy"))
    if not any(r in rights for r in OPEN_RIGHTS):
        image = None   # hotlink only openly licensed images; never copied
    if image and image.startswith("http://"):
        image = "https://" + image[len("http://"):]   # CSP and production are https-only

    labels = place_labels(resolved, gaz.country_name)
    countries = sorted({r["iso2"] for r in resolved})

    # Coordinates only when the provider pointed at exactly one GeoNames
    # populated place; anything coarser is left for the geocoding pipeline.
    lat = lon = None
    cities = [r for r in resolved if r["level"] == "city"]
    if len(cities) == 1 and len(countries) == 1:
        lat, lon = cities[0]["lat"], cities[0]["lon"]

    flagged = decision != "non_european"
    notes = [f"place_source={source}"]
    if ambiguous:
        notes.append("ambiguous: " + "; ".join(f"{a['raw']} → {','.join(a['candidates'])}" for a in ambiguous))

    title = _lang_value(item.get("dcTitleLangAware")) or _lang_value(item.get("title"))

    return {
        "object_id": stable_object_id(europeana_id),
        "europeana_id": europeana_id,
        "title": title,
        "img_url": image,
        "image_rights": rights or None,
        "latitude": lat,
        "longitude": lon,
        "institution_name": _lang_value(item.get("dataProvider")),
        "institution_place": None,
        "institution_country": _lang_value(item.get("country")),
        "source_link": shown_at,
        "place_name": "; ".join(labels) if labels else None,
        "place_source": source,
        "original_place_variants": [
            {"label": r["raw"], "language": "und", "source": f"europeana_{source}"}
            for r in resolved + ambiguous
        ],
        "geocoded_country": gaz.country_name(countries[0]) if len(countries) == 1 else None,
        "geocoder_source": "geonames_exact",
        "geocoding_status": "ambiguous" if flagged else "ok",
        "geocoding_notes": " | ".join(notes),
        # Like the other collections: only flagged records wait for review.
        "review_status": "pending" if flagged else None,
        # Europeana's "year" is not an object date ("18th century" → 1701, and
        # often the photo/digitisation year), so no date is taken from it.
        "object_date": None,
        "inventory_number": None,
        "object_links": [
            {"link_text": shown_at, "link_display": "Institution object page"}
        ] if shown_at else [],
        "decision": decision,
        # organizations[0] is the dataProvider, [1] the aggregator
        "europeana_org": next((m.group(1) for m in [EUROPEANA_ORG_RE.match(o) for o in _list(item.get("organizations"))[:1]] if m), None),
    }


# ---------------------------------------------------------------------------
# Inventory numbers (--apply only)
# ---------------------------------------------------------------------------

def loadable_image(url: Optional[str]) -> bool:
    """An https image on a named host (the CSP cannot allow bare IPs or ports)."""
    from urllib.parse import urlparse
    if not url or not url.startswith("https://"):
        return False
    host = urlparse(url).netloc
    return ":" not in host and not re.fullmatch(r"[\d.]+", host)


def provider_identifier(record: dict) -> Optional[str]:
    """The provider's own dc:identifier (inventory number), skipping URLs."""
    for proxy in record.get("proxies") or []:
        if proxy.get("europeanaProxy"):
            continue
        ident = proxy.get("dcIdentifier") or {}
        values = [v for vals in ident.values() for v in _list(vals)] if isinstance(ident, dict) else _list(ident)
        for v in values:
            v = (v or "").strip()
            if v and not re.match(r"^[a-z]+:", v, re.I):
                return v
    return None


def add_inventory_numbers(records: list, api_key: str, workers: int = 4) -> None:
    """
    The search API does not return dc:identifier, so every kept object gets it
    from the Record API: the artifact view shows it as the ID, and an image that
    stops loading later (a museum withdraws it) falls back to it in the grid.
    One call per object, cached in europeana_identifier_cache.jsonl.
    """
    from concurrent.futures import ThreadPoolExecutor

    cache = {}
    if os.path.exists(IDENTIFIER_CACHE_FILE):
        with open(IDENTIFIER_CACHE_FILE, encoding="utf-8") as f:
            for line in f:
                e = json.loads(line)
                cache[e["id"]] = e["identifier"]
    todo = [r["europeana_id"] for r in records
            if r["europeana_id"] not in cache
            and r["decision"] == "non_european" and r["latitude"] is not None
            and r["institution_latitude"] is not None]
    logger.info("Inventory numbers: %d cached, %d to fetch", len(cache), len(todo))

    def fetch(eid):
        session = requests.Session()
        session.headers.update({"Accept": "application/json", "X-Api-Key": api_key})
        data = api_get(session, RECORD_URL.format(id=eid), {}) or {}
        return eid, provider_identifier(data.get("object") or {})

    with open(IDENTIFIER_CACHE_FILE, "a", encoding="utf-8") as out, ThreadPoolExecutor(workers) as pool:
        for i, (eid, ident) in enumerate(pool.map(fetch, todo), 1):
            cache[eid] = ident
            out.write(json.dumps({"id": eid, "identifier": ident}, ensure_ascii=False) + "\n")
            if i % 1000 == 0:
                out.flush()
                logger.info("Inventory numbers: %d / %d", i, len(todo))

    from urllib.parse import urlparse, parse_qs
    for r in records:
        r["inventory_number"] = cache.get(r["europeana_id"])
        # Spanish state museums (CER.ES) give only a link; the inventory number
        # is its "inventary" parameter: ceres.mcu.es/pages/Main?...&inventary=12652
        link = urlparse(r["source_link"] or "")
        if not r["inventory_number"] and link.hostname == "ceres.mcu.es":
            r["inventory_number"] = (parse_qs(link.query).get("inventary") or [None])[0]


# ---------------------------------------------------------------------------
# Coordinates (--apply only)
# ---------------------------------------------------------------------------

def add_coordinates(records: list, orgs: EuropeanaOrgs, gaz: Gazetteer) -> None:
    """
    Origin: records with one country and no GeoNames city get that country's
    point from the cached Nominatim geocoder (country precision, noted).
    Institution: the dataProvider's Europeana organisation address (only if
    its labels include the dataProvider name), else institution_coords.py.
    Misses stay null.
    """
    from geocode_cache import geocode
    from institution_coords import get_institution_coords

    institutions = {}
    for r in records:
        if r["latitude"] is None and r["geocoded_country"]:
            coords = geocode(r["geocoded_country"])
            if coords:
                r["latitude"], r["longitude"] = coords
                r["geocoder_source"] = "nominatim"
                r["geocoding_notes"] += " | country-level point"

        name, org_id = r["institution_name"], r.get("europeana_org")
        key = (name, org_id)
        if key not in institutions:
            loc = None
            if org_id:
                org = orgs.get(org_id)
                if name in org["labels"] and org["lat"] is not None:
                    iso2 = gaz.country_by_name.get((org["country"] or "").lower())
                    city = gaz.institution_city(org["lat"], org["lon"], iso2, org["locality"])
                    loc = (org["lat"], org["lon"], city, org["country"], "europeana_org")
            if loc is None:
                known = get_institution_coords(name)
                if known:
                    loc = (known["lat"], known["lon"], known["city"], known["country"], "institution_coords.py")
            institutions[key] = loc or (None, None, None, None, "not found")
        lat, lon, city, country, _ = institutions[key]
        r["institution_latitude"], r["institution_longitude"] = lat, lon
        r["institution_place"] = ", ".join(x for x in (city, country) if x) or None
        r["institution_city_en"], r["institution_country_en"] = city, country or r["institution_country"]
    orgs.save()

    missing = Counter(name for (name, _), loc in institutions.items() if loc[0] is None)
    found = sum(1 for loc in institutions.values() if loc[0] is not None)
    print(f"  Institution locations: {found} found, {len(missing)} not found")
    for name, _ in sorted(missing.items()):
        print(f"    not found: {name}")
    print()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Europeana resolver (non-European origins only)")
    parser.add_argument("--apply", action="store_true",
                        help="Write output JSON (default: dry run, counts only)")
    parser.add_argument("--max-pages", type=int, default=None,
                        help="Stop after N pages of 100 (default: all)")
    parser.add_argument("--rows", type=int, default=100, help="Records per page (max 100)")
    parser.add_argument("--top", type=int, default=50, help="Providers to list in the report")
    parser.add_argument("--provider", action="append", default=[],
                        help="Only fetch records from this dataProvider, exact name (repeatable)")
    parser.add_argument("-o", "--output", default=os.path.join(ETL_DIR, "europeana_objects.json"))
    parser.add_argument("--flagged-output", default=os.path.join(ETL_DIR, "europeana_flagged.json"))
    parser.add_argument("--finalize-only", action="store_true",
                        help="With --apply: skip fetching, rebuild the output from the last full scan")
    parser.add_argument("--resume", action="store_true",
                        help="With --apply: continue from the last checkpoint")
    parser.add_argument("-v", "--verbose", action="store_true")
    return parser.parse_args()


def print_report(stats: Counter, per_provider: dict, held: Counter, top: int):
    print()
    print("=" * 96)
    print("Europeana — non-European origin, per dataProvider" + ("" if stats["complete"] else "  [PARTIAL SCAN]"))
    print("=" * 96)
    for k in ("fetched", "held_elsewhere", "non_european", "non_european_enrichment",
              "european", "mixed", "ambiguous", "unresolved", "no_landing_page"):
        print(f"  {k:<26} {stats[k]:>10,}")
    print()
    print(f"  {'#':>3}  {'kept':>8}  {'provider':>8}  {'enrich.':>8}  {'flagged':>8}  dataProvider")
    ranked = sorted(per_provider.items(), key=lambda kv: -(kv[1]["provider"] + kv[1]["enrichment"]))
    for i, (name, c) in enumerate(ranked[:top], 1):
        kept = c["provider"] + c["enrichment"]
        print(f"  {i:>3}  {kept:>8,}  {c['provider']:>8,}  {c['enrichment']:>8,}  {c['flagged']:>8,}  {name}")
    if held:
        print()
        print("  Skipped (indexed directly):")
        for name, n in held.most_common():
            print(f"       {n:>8,}  {name}")
    print()


def main():
    args = parse_args()
    if args.verbose:
        logger.setLevel(logging.DEBUG)

    api_key = os.environ.get("EUROPEANA_API_KEY")
    if not api_key:
        sys.exit("Set EUROPEANA_API_KEY (never commit it).")

    logger.info("Loading GeoNames gazetteer from %s", GAZETTEER_DIR)
    gaz = Gazetteer(GAZETTEER_DIR)

    session = requests.Session()
    session.headers.update({"Accept": "application/json", "X-Api-Key": api_key})
    places = EuropeanaPlaces(session)
    orgs = EuropeanaOrgs(session)

    stats = Counter()
    per_provider = defaultdict(lambda: {"provider": 0, "enrichment": 0, "flagged": 0})
    held = Counter()
    seen_ids = set()
    cursor, page = "*", 0

    # --apply streams mapped records to a JSONL file and checkpoints the
    # cursor, so a long run can be resumed with --resume.
    partial_path = args.output + ".partial.jsonl"
    partial = None
    if args.apply and not args.finalize_only:
        if args.resume and os.path.exists(CHECKPOINT_FILE):
            with open(CHECKPOINT_FILE, encoding="utf-8") as f:
                cp = json.load(f)
            cursor, page = cp["cursor"], cp["page"]
            stats.update(cp["stats"])
            held.update(cp["held"])
            for name, c in cp["per_provider"].items():
                per_provider[name].update(c)
            logger.info("Resuming at page %d", page)
            partial = open(partial_path, "a", encoding="utf-8")
        else:
            partial = open(partial_path, "w", encoding="utf-8")

    def checkpoint():
        if partial:
            partial.flush()
            with open(CHECKPOINT_FILE, "w", encoding="utf-8") as f:
                json.dump({"cursor": cursor, "page": page, "stats": stats, "held": held,
                           "per_provider": per_provider}, f)
    t0 = time.time()
    try:
        if args.finalize_only:
            cursor = None
            with open(CHECKPOINT_FILE, encoding="utf-8") as f:
                stats.update(json.load(f)["stats"])
        while cursor and (args.max_pages is None or page < args.max_pages):
            data = fetch_page(session, cursor, min(args.rows, 100), args.provider)
            page += 1
            if page == 1:
                stats["candidates"] = data.get("totalResults", 0)
                logger.info("Candidates on Europeana's side: %s", f"{stats['candidates']:,}")

            for item in data.get("items") or []:
                eid = item.get("id")
                if not eid or eid in seen_ids:
                    continue
                seen_ids.add(eid)
                stats["fetched"] += 1

                provider = _lang_value(item.get("dataProvider")) or "(no dataProvider)"
                if held_elsewhere(provider):
                    stats["held_elsewhere"] += 1
                    held[provider] += 1
                    continue
                if not _lang_value(item.get("edmIsShownAt")):
                    stats["no_landing_page"] += 1   # nothing to link back to
                    continue

                decision, source, resolved, ambiguous = resolve_origin(item, gaz, places)
                logger.debug("%-12s %-20s %s | %s | %s", decision, source, provider,
                             [(r["raw"], r["iso2"]) for r in resolved],
                             [(a["raw"], a["candidates"]) for a in ambiguous])
                if decision == "non_european":
                    key = "provider" if source == "provider" else "enrichment"
                    stats["non_european" if key == "provider" else "non_european_enrichment"] += 1
                    per_provider[provider][key] += 1
                elif decision in ("mixed", "ambiguous"):
                    stats[decision] += 1
                    per_provider[provider]["flagged"] += 1
                else:
                    stats[decision] += 1

                if args.apply and decision in ("non_european", "mixed", "ambiguous"):
                    record = map_record(item, decision, source, resolved, ambiguous, gaz)
                    partial.write(json.dumps(record, ensure_ascii=False) + "\n")

            if page % 20 == 0:
                places.save()
                elapsed = time.time() - t0
                logger.info("Page %d | fetched %s | kept %s | flagged %s | %.1f min",
                            page, f"{stats['fetched']:,}",
                            f"{stats['non_european'] + stats['non_european_enrichment']:,}",
                            f"{stats['mixed'] + stats['ambiguous']:,}", elapsed / 60)

            cursor = data.get("nextCursor")
            if page % 50 == 0:
                checkpoint()
            time.sleep(REQUEST_DELAY_SECONDS)
        stats["complete"] = stats["complete"] or int(not cursor)
    except KeyboardInterrupt:
        logger.info("Interrupted — reporting what was scanned so far")
        stats["aborted"] = 1
    except RuntimeError as exc:
        stats["aborted"] = 1
        logger.error("%s — re-run with --apply --resume to continue", exc)
    finally:
        places.save()
        checkpoint()
        if partial:
            partial.close()

    print_report(stats, per_provider, held, args.top)

    if args.apply:
        if stats["aborted"]:
            logger.info("Scan incomplete — output not written; re-run with --apply --resume")
            return
        kept, flagged = [], []
        with open(partial_path, encoding="utf-8") as f:
            records = {}
            for line in f:
                r = json.loads(line)
                records[r["europeana_id"]] = r   # a resumed page may repeat
        # Re-derive labels from the stored raw values (cached lookups only), so
        # label rule changes apply without a new scan.
        for r in records.values():
            resolved = [x for x in (resolve_value(v["label"], gaz, places) for v in r["original_place_variants"])
                        if x["status"] == "resolved"]
            if resolved:
                r["place_name"] = "; ".join(place_labels(resolved, gaz.country_name))
            r["review_status"] = "pending" if r["decision"] != "non_european" else None
        add_coordinates(list(records.values()), orgs, gaz)
        add_inventory_numbers(list(records.values()), api_key)
        excluded = Counter()
        bad_images = set()
        if os.path.exists(IMAGE_CHECK_FILE):
            with open(IMAGE_CHECK_FILE, encoding="utf-8") as f:
                bad_images = set(json.load(f)["bad_urls"])
        for r in records.values():
            name = (r["institution_name"] or "").lower()
            inst_country = (r.get("institution_country_en") or "").lower()
            if any(k in name for k in NON_ARTIFACT_PROVIDERS):
                excluded["natural-history provider"] += 1
                continue
            if r["institution_name"] in OUT_OF_SCOPE_PROVIDERS:
                excluded["out of scope (desk review)"] += 1
                continue
            if r["decision"] == "non_european" and inst_country and inst_country == (r["geocoded_country"] or "").lower():
                excluded["held in its country of origin"] += 1   # not displaced
                continue
            if r["decision"] == "non_european" and (not loadable_image(r["img_url"]) or r["img_url"] in bad_images):
                excluded["no loadable image"] += 1   # Europeana only: image-less objects are left out
                continue
            if r["decision"] != "non_european":
                flagged.append(r)
            elif r["latitude"] is None or r["institution_latitude"] is None:
                r["unmapped_reason"] = "no origin point" if r["latitude"] is None else "no institution location"
                flagged.append(r)
            else:
                kept.append(r)
        # CSP img-src for the frontend (next.config.js): https hosts by name only
        from urllib.parse import urlparse
        hosts = sorted({urlparse(r["img_url"]).netloc for r in kept
                        if r["img_url"] and r["img_url"].startswith("https://")})
        hosts = [h for h in hosts if ":" not in h and not re.fullmatch(r"[\d.]+", h)]
        hosts = sorted(set(hosts) | set(IMAGE_REDIRECT_HOSTS))
        with open(IMAGE_HOSTS_FILE, "w", encoding="utf-8") as f:
            f.write(json.dumps(hosts, indent=2) + "\n")
        logger.info("Wrote %d image hosts to %s", len(hosts), IMAGE_HOSTS_FILE)
        for reason, n in excluded.items():
            logger.info("Excluded %s: %s", reason, f"{n:,}")
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(kept, f, ensure_ascii=False, indent=2)
        with open(args.flagged_output, "w", encoding="utf-8") as f:
            json.dump(flagged, f, ensure_ascii=False, indent=2)
        logger.info("Wrote %d records to %s and %d flagged to %s",
                    len(kept), args.output, len(flagged), args.flagged_output)
    else:
        logger.info("Dry run — nothing written (re-run with --apply)")


if __name__ == "__main__":
    main()
