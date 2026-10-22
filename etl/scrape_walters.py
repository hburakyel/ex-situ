#!/usr/bin/env python3
"""
scrape_walters.py — Walters Art Museum resolver for Ex Situ

Sources (all CC0, no key, no scraping of art.thewalters.org):

  - The museum's open data files on GitHub (WaltersArtMuseum/api-thewalters-org,
    art.csv): title, accession number, dates, the purl.thewalters.org link.
    The files have no place of origin (GeographyID is empty in every row).
  - The museum's own upload to Wikimedia Commons (2011–12): each file carries
    {{Walters Art Museum artwork}} with "id" (= art.csv ObjectID) and
    "place of origin" in the museum's words ("Kyoto, Japan", "Iran (?)",
    "Edo (present-day Tokyo, Japan)"). That is the place used here.
    About half of art.csv has a Commons file; objects without one have no
    place and are skipped, never guessed.

art.thewalters.org challenges every non-browser client (Cloudflare) and its
images do not load on other sites, so the image is the museum's own Commons
upload, hotlinked from upload.wikimedia.org (never copied).

Scope: non-European origins only (as the AIC and Rijksmuseum imports).
"Place of origin" is parsed as "Place, …, Country" with exact lookups only:

  - Country    exact English country name (GeoNames, audit_places aliases)
  - Place      a GeoNames town of that exact name in that country (one match,
               or one clearly dominant town) → city point; a name that is
               also a first-level region ("Oaxaca", "Kyoto") keeps the city
               point with a note when the town has 100,000 people or more,
               and is a region otherwise ("Michoacán"); else an exact
               first-level region name → region; else the label is kept with
               no point and flagged for review
  - "X (present-day Y, C)"   → Y in C, historical_name X
  - "X (in present-day C)"   → X, a region in C, no point
  - "(?)" / "?"              → the label keeps a trailing "?"

Objects made in the United States (the museum's own country) are left out.
Records whose place has no exact country ("Mesopotamia", "Roman Empire",
"Korea", "Arabian Peninsula") are skipped and counted.

Writes JSON only (no database, no Strapi). Dry run by default.

Usage:
    python scrape_walters.py --limit 40               # dry run, sample
    python scrape_walters.py --apply                  # write walters_objects.json
    python scrape_walters.py --apply --refresh        # re-download CSV and Commons data first
"""

import argparse
import csv
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

from scrape_europeana import GAZETTEER_DIR, Gazetteer
from scrape_rijks import country_iso
from audit_places import key as fold, km
from institution_coords import get_institution_coords

ETL_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(ETL_DIR, "walters_cache")
CSV_URL = "https://raw.githubusercontent.com/WaltersArtMuseum/api-thewalters-org/main/art.csv"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
TEMPLATE = "Template:Walters Art Museum artwork"
INSTITUTION = "The Walters Art Museum"
IMAGE_WIDTH = 960          # Wikimedia serves only standard thumbnail widths (960, 1280 …); 1000 → HTTP 400
REQUEST_DELAY_SECONDS = 0.2

# Country words in the Walters' place strings that GeoNames names differently.
# "Korea" (North or South) is deliberately not here.
EXTRA_COUNTRY_NAMES = {"usa": "US", "u.s.a.": "US", "bharat": "IN", "persia": "IR"}
# Plain misspellings in the Commons text.
SPELLING = {"Toyko": "Tokyo"}
# Spellings production already uses for country_en.
COUNTRY_EN = {"PS": "Palestine"}

# "north India", "north central Thailand", "Upper Egypt": a part of one country, no point.
DIRECTION = re.compile(r"^((?:(?:north|south)(?:east|west)?(?:ern)?|east(?:ern)?|west(?:ern)?|central|upper|lower)"
                       r"(?:\s+(?:central|(?:north|south|east|west)(?:ern)?))?)\s+(.+)$", re.I)

# Commons view suffixes, best first; files without a suffix are the main view.
VIEW_RANK = ["", "Full Page", "Front", "Obverse", "Three Quarter", "View A"]

csv.field_size_limit(10 ** 9)
logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s", datefmt="%H:%M:%S")
logger = logging.getLogger("walters_scraper")


# ---------------------------------------------------------------------------
# Sources
# ---------------------------------------------------------------------------

def session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": "ExSitu-resolver (https://exsitu.app; open-source spatial index)"})
    return s


def load_art_csv(s: requests.Session, refresh: bool) -> dict:
    path = os.path.join(CACHE_DIR, "art.csv")
    if refresh or not os.path.exists(path):
        logger.info("Downloading %s", CSV_URL)
        r = s.get(CSV_URL, timeout=300)
        r.raise_for_status()
        open(path, "wb").write(r.content)
    with open(path, encoding="utf-8") as f:
        return {row["ObjectID"]: row for row in csv.DictReader(f)}


def load_commons(s: requests.Session, refresh: bool) -> list:
    """Wikitext of every Commons file that uses the Walters artwork template."""
    path = os.path.join(CACHE_DIR, "commons.jsonl")
    if refresh or not os.path.exists(path):
        logger.info("Fetching %s transclusions from Commons", TEMPLATE)
        params = {"action": "query", "format": "json", "formatversion": "2", "generator": "embeddedin",
                  "geititle": TEMPLATE, "geinamespace": "6", "geilimit": "50",
                  "prop": "revisions", "rvprop": "content", "rvslots": "main"}
        cont, n = {}, 0
        with open(path + ".tmp", "w", encoding="utf-8") as out:
            while True:
                r = s.get(COMMONS_API, params={**params, **cont}, timeout=120)
                r.raise_for_status()
                d = r.json()
                for p in d.get("query", {}).get("pages", []):
                    revs = p.get("revisions") or []
                    if revs:
                        out.write(json.dumps({"title": p["title"], "pageid": p["pageid"],
                                              "text": revs[0]["slots"]["main"]["content"]}, ensure_ascii=False) + "\n")
                        n += 1
                if "continue" not in d:
                    break
                cont = d["continue"]
                time.sleep(REQUEST_DELAY_SECONDS)
        os.replace(path + ".tmp", path)
        logger.info("%d Commons files", n)
    return [json.loads(line) for line in open(path, encoding="utf-8")]


def template_field(text: str, name: str) -> Optional[str]:
    m = re.search(r"^\s*\|\s*" + re.escape(name) + r"\s*=(.*?)(?=^\s*\||^\}\})", text, re.M | re.S)
    return m.group(1).strip() if m else None


def view_rank(title: str) -> int:
    m = re.search(r" - Walters [^ ]+?(?: - (.+))?\.\w+$", title)
    view = (m.group(1) or "") if m else None
    return VIEW_RANK.index(view) if view in VIEW_RANK else len(VIEW_RANK)


def commons_by_object(files: list) -> dict:
    """ObjectID → {"places": {place strings}, "file": best file title}."""
    out = defaultdict(lambda: {"places": set(), "files": []})
    for f in files:
        oid = template_field(f["text"], "id")
        if not oid or not oid.isdigit():
            continue
        place = template_field(f["text"], "place of origin")
        if place:
            out[oid]["places"].add(place)
        out[oid]["files"].append((view_rank(f["title"]), f["pageid"], f["title"]))
    return {oid: {"places": v["places"], "file": min(v["files"])[2]} for oid, v in out.items()}


def load_widths(s: requests.Session, titles: list, refresh: bool) -> dict:
    """File title → original width in px (Commons imageinfo), cached."""
    path = os.path.join(CACHE_DIR, "commons_widths.json")
    widths = {} if refresh or not os.path.exists(path) else json.load(open(path, encoding="utf-8"))
    todo = [t for t in dict.fromkeys(titles) if t not in widths]
    for i in range(0, len(todo), 50):
        r = s.get(COMMONS_API, timeout=120, params={"action": "query", "format": "json", "formatversion": "2",
                                                     "prop": "imageinfo", "iiprop": "size", "titles": "|".join(todo[i:i + 50])})
        r.raise_for_status()
        for p in r.json().get("query", {}).get("pages", []):
            info = (p.get("imageinfo") or [{}])[0]
            widths[p["title"]] = info.get("width")
        time.sleep(REQUEST_DELAY_SECONDS)
    if todo:
        json.dump(widths, open(path, "w", encoding="utf-8"))
    return widths


def thumb_url(file_title: str, original_width: Optional[int], width: int = IMAGE_WIDTH) -> Optional[str]:
    """upload.wikimedia.org thumbnail (Commons hashes the file name with md5); the original when it is narrower."""
    if not original_width:
        return None                          # file missing on Commons
    name = file_title.split(":", 1)[1].replace(" ", "_")
    h = hashlib.md5(name.encode("utf-8")).hexdigest()
    q = requests.utils.quote(name)
    if original_width <= width and not re.search(r"\.tiff?$", name, re.I):
        return f"https://upload.wikimedia.org/wikipedia/commons/{h[0]}/{h[:2]}/{q}"
    suffix = ".jpg" if re.search(r"\.tiff?$", name, re.I) else ""
    prefix = "lossy-page1-" if suffix else ""
    return f"https://upload.wikimedia.org/wikipedia/commons/thumb/{h[0]}/{h[:2]}/{q}/{prefix}{width}px-{q}{suffix}"


# ---------------------------------------------------------------------------
# Places
# ---------------------------------------------------------------------------

class Places:
    def __init__(self, gaz: Gazetteer):
        self.gaz = gaz
        self.towns = defaultdict(list)            # (lower name, ISO2) → [(pop, lat, lon, own name?, GeoNames name)]
        for lat, lon, pop, iso2, own, names in gaz.towns:
            for n in names:
                # A town found only by an alternate name must be large: "Iwami" is an
                # alternate name of Iwai, "Garhwal" of Dugadda, "Aizu" of Ōtera.
                primary = fold(n) == fold(own)
                if primary or pop >= 50000:
                    self.towns[(n, iso2)].append((pop, lat, lon, primary, own))
        self.town_admin1 = {}                     # (lat, lon) → "JP.35"
        for line in open(os.path.join(GAZETTEER_DIR, "cities500.txt"), encoding="utf-8"):
            c = line.rstrip("\n").split("\t")
            self.town_admin1[(float(c[4]), float(c[5]))] = f"{c[8]}.{c[10]}"
        self.admin1_code = {}                     # (lower name, ISO2) → "JP.35"
        self.admin1 = {}                          # (lower name, ISO2) → name
        for line in open(os.path.join(GAZETTEER_DIR, "admin1CodesASCII.txt"), encoding="utf-8"):
            c = line.rstrip("\n").split("\t")
            if len(c) == 4:
                for n in {c[1], c[2]}:
                    self.admin1[(n.lower(), c[0].split(".")[0])] = c[1]
                    self.admin1_code[(n.lower(), c[0].split(".")[0])] = c[0]

    def country(self, name: str) -> Optional[str]:
        return EXTRA_COUNTRY_NAMES.get(name.strip().lower()) or country_iso(name, self.gaz)

    def country_en(self, iso2: str) -> Optional[str]:
        return COUNTRY_EN.get(iso2) or self.gaz.country_name(iso2)

    def town(self, name: str, iso2: str, within: Optional[str] = None) -> Optional[tuple]:
        # → (lat, lon, population, GeoNames name, matched by its own name?)
        """
        One exact town in the country; or the largest, when every town of that
        name at least a tenth its size lies within 15 km of it (GeoNames lists
        Kashan twice, 2 km apart) and it has 50,000 people or more.
        """
        hits = sorted(set(self.towns.get((name.lower(), iso2), [])
                          or self.towns.get((name.lower().replace("-", " "), iso2), [])), reverse=True)  # "Al-Qahirah"
        if any(h[3] for h in hits):          # "Shonai" is the town Shonai, not Matsumoto's alternate name
            hits = [h for h in hits if h[3]]
        if within:                           # "Shonai, Yamagata, Japan": only towns in Yamagata
            hits = [h for h in hits if self.town_admin1.get((h[1], h[2])) == within]
        if len(hits) == 1:
            return hits[0][1], hits[0][2], hits[0][0], hits[0][4], hits[0][3]
        if hits and hits[0][0] >= 50000:
            top = hits[0]
            rivals = [h for h in hits[1:] if 10 * h[0] >= top[0]]
            if all(km(top[1:3], h[1:3]) <= 15 for h in rivals):
                return top[1], top[2], top[0], top[4], top[3]
        return None


def clean_wikitext(value: str) -> str:
    """Template and link markup → plain text: {{city|Taranto}}, {{Italy}}, [[w:X|Y]]."""
    v = re.sub(r"\{\{\s*(?:city|country|w)\s*\|\s*([^|}]+?)\s*(?:\|[^}]*)?\}\}", r"\1", value, flags=re.I)
    v = re.sub(r"\{\{\s*([A-Z][^|{}]*?)\s*\}\}", r"\1", v)
    v = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]+)\]\]", r"\1", v)
    v = re.sub(r"<[^>]+>", "", v)
    return " ".join(v.split())


def resolve_place(raw: str, places: Places, gazetteer_label: bool = False) -> dict:
    """gazetteer_label: a town found by an alternate name takes its GeoNames name
    (TGN's "Al-Qahirah" → Cairo); the Commons text keeps the museum's own words."""
    text = clean_wikitext(raw)
    if re.search(r"\bor\b", text):            # "X or Y": several places, no guess
        return {"raw": raw, "text": text, "status": "unresolved"}
    hedged = bool(re.search(r"\(\?\)|\?$", text))
    core = re.sub(r"\s*\(\?\)\s*|\?$", " ", text).strip()
    base = {"raw": raw, "text": text, "hedged": hedged, "historical_name": None}

    m = re.match(r"^(.*?)\s*\(in present-day ([^)]+)\)$", core)
    if m:
        iso2 = places.country(m.group(2))
        if not iso2:
            return {**base, "status": "unresolved"}
        return {**base, "status": "resolved", "iso2": iso2, "label": m.group(1).strip(),
                "level": "region", "lat": None, "lon": None}
    m = re.match(r"^(.*?)\s*\(present-day (.+)\)$", core)    # "Edo (present-day Tokyo (Shiba), Japan)"
    if m:
        base["historical_name"] = m.group(1).strip()
        core = m.group(2).strip()

    flat = re.sub(r"\s*\([^()]*\)", "", core)     # "Tokyo (Otowa-cho, Koishikawa), Japan" → "Tokyo, Japan"
    parts = [SPELLING.get(p.strip(), p.strip()) for p in flat.split(",") if p.strip()]
    if not parts:
        return {**base, "status": "unresolved"}
    m = DIRECTION.match(core)
    if len(parts) == 1 and m and places.country(m.group(2)):   # "north India", "Upper Egypt"
        return {**base, "status": "resolved", "iso2": places.country(m.group(2)), "label": core[0].upper() + core[1:],
                "level": "region", "lat": None, "lon": None}
    iso2 = places.country(parts[-1])
    if not iso2:
        return {**base, "status": "unresolved"}
    if len(parts) == 1:
        if base["historical_name"]:              # "X (present-day Turkey)": X, no point
            return {**base, "status": "resolved", "iso2": iso2, "label": base.pop("historical_name"),
                    "historical_name": None, "level": "region", "lat": None, "lon": None}
        return {**base, "status": "resolved", "iso2": iso2, "label": places.country_en(iso2),
                "level": "country", "lat": None, "lon": None}
    name = parts[0]
    within = places.admin1_code.get((parts[1].lower(), iso2)) if len(parts) == 3 else None
    point = places.town(name, iso2, within)
    region = places.admin1.get((name.lower(), iso2))
    # "Michoacán, Mexico": the state, not a village of that name; "Nayarit" is also an
    # alternate name of Tepic, but the state is meant
    if point and region and (point[2] < 100000 or not point[4]):
        point = None
    if point:                                # "Oaxaca", "Kyoto", "Bihar": also a first-level region → review
        label = point[3] if gazetteer_label and not point[4] else name
        return {**base, "status": "resolved", "iso2": iso2, "label": label, "also_region": bool(region),
                "level": "city", "lat": point[0], "lon": point[1]}
    return {**base, "status": "resolved", "iso2": iso2, "label": region or parts[0],
            "level": "region" if region else "unmatched", "lat": None, "lon": None}


# ---------------------------------------------------------------------------
# Fallback: the museum's 2015 API records
# ---------------------------------------------------------------------------
# When the API closed (Feb 2015) the museum committed every object record to the
# same GitHub repository (objects/data/…/<ObjectID>.json, CC0). Each record has
# "Geographies": GeoType ("Place of Origin", "Place of Discovery", …), a Getty TGN
# term in its native form ("Misr", "Nihon", "Tokyo"), the TGN hierarchy and point.
# Used for objects whose Commons file has no place, or has two different ones.
API2015_COMMIT = "2437921"
API2015_TYPES = ("Place of Origin", "Place of Discovery")
TGN_NATIONS = {   # TGN nation (native form) → English name the gazetteer knows
    "Nihon": "Japan", "Italia": "Italy", "Italy": "Italy", "France": "France", "Îran": "Iran", "Türkiye": "Turkey",
    "Misr": "Egypt", "Egypt": "Egypt", "Deutschland": "Germany", "Germany": "Germany", "United States": "United States",
    "Bharat": "India", "Índia": "India", "Zhonghua": "China", "United Kingdom": "United Kingdom", "Ellás": "Greece",
    "Nederland": "Netherlands", "Rossiya": "Russia", "Russia": "Russia", "Afghanestan": "Afghanistan",
    "België": "Belgium", "Pakistan": "Pakistan", "Prathet Thai": "Thailand", "Ityop'iya": "Ethiopia",
    "España": "Spain", "Österreich": "Austria", "México": "Mexico", "Suriyah": "Syria", "Perú": "Peru",
    "Schweiz": "Switzerland", "România": "Romania", "Al-‘Iraq": "Iraq", "Kampuchea": "Cambodia",
    "Colombia": "Colombia", "Ukrayina": "Ukraine", "Hrvatska": "Croatia", "Panamá": "Panama",
    "Ceská Republika": "Czechia", "Al-Yaman": "Yemen", "Guatemala": "Guatemala", "Tunis": "Tunisia",
    "Hayastan": "Armenia", "Taehan Min'guk": "South Korea", "Yisra'el": "Israel", "Al-Jaza'ir": "Algeria",
    "Nepal": "Nepal", "Costa Rica": "Costa Rica", "Ecuador": "Ecuador", "Ozbekistan": "Uzbekistan",
    "Kípros": "Cyprus", "Honduras": "Honduras", "Belize": "Belize", "Choson Minjujuui In'min Konghwaguk": "North Korea",
    "Éire": "Ireland", "Libiya": "Libya", "Sakartvelo": "Georgia", "Pilipinas": "Philippines", "Al-Lubnan": "Lebanon",
    "Slovenija": "Slovenia", "Al-Magreb": "Morocco", "Indonesia": "Indonesia", "Sverige": "Sweden",
    "Sri Lanka": "Sri Lanka", "Norge": "Norway", "Magyarország": "Hungary", "Bangladesh": "Bangladesh",
    "Portugal": "Portugal", "Mongol Uls": "Mongolia", "Shqipëria": "Albania", "República Dominicana": "Dominican Republic",
    "Slovenská Republika": "Slovakia", "Lao": "Laos", "Polska": "Poland", "Santa Sede": "Vatican City",
    "Congo": "Republic of the Congo", "Viet Nam": "Vietnam", "Myanmar": "Myanmar", "As-Sudan": "Sudan",
    "Bulgaria": "Bulgaria", "Malta": "Malta", "Sierra Leone": "Sierra Leone",
}
# TGN files these as regions; Ex Situ treats Palestine as a country (CLAUDE.md).
TGN_REGION_COUNTRIES = {"Palestine": "Palestine"}


def load_api2015(s: requests.Session, refresh: bool) -> dict:
    """ObjectID → list of Geographies from the 2015 bulk records (cached as JSONL)."""
    path = os.path.join(CACHE_DIR, "api2015_geographies.jsonl")
    if refresh or not os.path.exists(path):
        import io, tarfile
        url = f"https://codeload.github.com/WaltersArtMuseum/api-thewalters-org/tar.gz/{API2015_COMMIT}"
        logger.info("Downloading the 2015 object records (%s)", url)
        r = s.get(url, timeout=600)
        r.raise_for_status()
        with tarfile.open(fileobj=io.BytesIO(r.content), mode="r:gz") as tar, open(path + ".tmp", "w", encoding="utf-8") as out:
            for m in tar:
                if m.isfile() and "/objects/data/" in m.name and m.name.endswith(".json"):
                    d = json.load(tar.extractfile(m))
                    if isinstance(d, dict) and d.get("ObjectID"):
                        out.write(json.dumps({"id": str(d["ObjectID"]), "geographies": d.get("Geographies") or []},
                                             ensure_ascii=False) + "\n")
        os.replace(path + ".tmp", path)
    out = {}
    for line in open(path, encoding="utf-8"):
        d = json.loads(line)
        out[d["id"]] = d["geographies"]
    return out


def api2015_place(geographies: list) -> tuple:
    """
    (place text for resolve_place, TGN point or None, note) from the 2015 record,
    or (None, None, reason). Place of Origin first, else Place of Discovery; places
    in different countries are not resolved (no guess).
    """
    for kind in API2015_TYPES:
        geos = [g for g in geographies if g.get("GeoType") == kind and g.get("GeographyTerm")]
        if geos:
            break
    else:
        return None, None, "no origin in 2015 record"
    found = {}
    for g in geos:
        h = (g.get("GeoHierarchy") or "").split("\\")
        term = g["GeographyTerm"].strip()
        if "nations" in h:
            i = h.index("nations")
            nation = h[i + 1] if i + 1 < len(h) and h[i + 1] else term
            country = TGN_NATIONS.get(nation)
            text = country if nation == term else f"{term}, {country}"
        elif term in TGN_REGION_COUNTRIES:
            country = text = nation = TGN_REGION_COUNTRIES[term]
        else:
            return None, None, f"2015 place without a country: {term}"
        if not country:
            return None, None, f"2015 place in an unknown TGN nation: {nation}"
        lat, lon = g.get("LatitudeNumber"), g.get("LongitudeNumber")
        point = (lat, lon) if lat and lon and nation != term else None
        depth = len([x for x in h if x])
        if country not in found or depth > found[country][0]:
            found[country] = (depth, text, point, f"{kind}: {term} (TGN {g.get('GeographyID')})")
    if len(found) > 1:
        return None, None, "2015 places in several countries: " + ", ".join(sorted(found))
    _, text, point, note = next(iter(found.values()))
    return text, point, note


REVIEW_FILE = os.path.join(ETL_DIR, "place_review_walters.json")


def load_review() -> dict:
    return json.load(open(REVIEW_FILE, encoding="utf-8")) if os.path.exists(REVIEW_FILE) else {}


def apply_review(p: dict, places: Places, review: dict) -> dict:
    """
    Desk-review decisions (place_review_walters.json) for labels the exact lookup
    left without a point or placed on the wrong kind of place: a Wikidata point,
    the country point, a corrected label, or a rejection (stays unlocated).
    """
    text = re.sub(r"\s*\(\?\)\s*$|\?$", "", p["text"]).strip()
    key = f"{p['label']}|{places.country_en(p['iso2'])}"
    r = review.get("by_text", {}).get(text) or review.get("by_label", {}).get(key)
    if not r:
        return p
    p = dict(p, review=r["source"])
    if r.get("reject"):
        p["review_note"] = "desk review: not placed (" + r["reject"] + ")"
        return p
    if r.get("country"):
        p["iso2"] = places.country(r["country"]) or {"Palestine": "PS"}.get(r["country"], p["iso2"])
    p["label"] = r.get("label", p["label"])
    if "historical_name" in r:
        p["historical_name"] = r["historical_name"]
    p["precise_place"] = r.get("precise_place")
    if r.get("point") == "country":
        p.update(lat=None, lon=None, level="country_point")
    elif not r.get("keep_point"):
        p.update(lat=r["lat"], lon=r["lon"], level="reviewed")
    p["review_note"] = "desk review: " + r["source"]
    return p


# ---------------------------------------------------------------------------
# Mapping
# ---------------------------------------------------------------------------

def years(row: dict) -> tuple:
    try:
        start, end = int(row["DateBeginYear"]), int(row["DateEndYear"])
    except ValueError:
        return None, None
    if start == 0 and end == 0:
        return None, None
    return (start, end) if start <= end else (None, None)


def map_record(row: dict, commons: dict, places: Places, institution: dict, widths: dict, review: dict,
               api2015: dict) -> tuple:
    """Return (decision, record or None)."""
    entry = commons.get(row["ObjectID"]) or {"places": set(), "file": None}
    tgn_point, source = None, "walters commons upload"
    if len(entry["places"]) == 1:
        raw = next(iter(entry["places"]))
        p = resolve_place(raw, places)
        source_note = f"place_source=walters commons upload (place of origin: {raw})"
    else:
        text, tgn_point, note = api2015_place(api2015.get(row["ObjectID"], []))
        if not text:
            return ("conflicting_places" if entry["places"] else "no_place"), {"_reason": note}
        p = resolve_place(text, places, gazetteer_label=True)
        p["raw"] = note
        source, source_note = "walters api 2015", f"place_source=walters api 2015 record ({note})"
    if p["status"] != "resolved":
        return "unresolved", {"_unresolved": p["text"]}
    if places.gaz.is_european(p["iso2"]):
        return "european", None
    if p["iso2"] == "US":                    # made in the museum's own country: not a migration
        return "domestic", None
    p = apply_review(p, places, review)
    if p["lat"] is None and tgn_point and p["level"] in ("unmatched", "region"):
        p.update(lat=tgn_point[0], lon=tgn_point[1], level="tgn")   # the point in the museum's own record

    label = p["label"] + ("?" if p["hedged"] else "")
    flagged = p["level"] == "unmatched" or (p["lat"] is None and p["level"] not in ("country", "country_point"))
    start, end = years(row)
    date_text = (row["DateText"] or "").strip() or None
    link = row["ResourceURL"].strip()
    notes = [source_note, f"level={p['level']}"]
    if p["level"] == "unmatched":
        notes.append("place not found in GeoNames for this country: review")
    if p.get("also_region") and not p.get("review"):
        notes.append("name is also a first-level region of this country: city or region? review")
    if p.get("review_note"):
        notes.append(p["review_note"])
    if p["level"] == "country_point":
        notes.append("point=country")

    record = {
        "object_id": int(row["ObjectID"]),
        "title": row["Title"].strip(),
        "img_url": thumb_url(entry["file"], widths.get(entry["file"])) if entry["file"] else None,
        "image_rights": "http://creativecommons.org/publicdomain/zero/1.0/" if entry["file"] else None,
        "commons_file": entry["file"],
        "latitude": p["lat"],
        "longitude": p["lon"],
        "institution_name": INSTITUTION,
        "institution_place": f"{institution['city']}, {institution['country']}",
        "institution_latitude": institution["lat"],
        "institution_longitude": institution["lon"],
        "institution_city_en": institution["city"],
        "institution_country_en": institution["country"],
        "source_link": link,
        "place_name": p["text"] if source != "walters api 2015" else p["raw"].split(": ", 1)[1].rsplit(" (TGN", 1)[0],
        "place_name_normalized": label,
        "historical_name": p["historical_name"],
        "precise_place": p.get("precise_place"),
        "city_en": p["label"] if p["level"] == "city" else None,
        "country_en": places.country_en(p["iso2"]),
        "place_level": p["level"],
        "place_source": source,
        "geocoder_source": "desk_review" if p.get("review") and p["level"] == "reviewed" else "geonames_exact",
        "geocoding_status": "ambiguous" if flagged else "ok",
        "geocoding_notes": " | ".join(notes),
        "review_status": "pending" if flagged else None,
        "object_date": date_text,
        "time": {"time_name": date_text, "time_start": start, "time_end": end} if start is not None else None,
        "inventory_number": row["AccessionNumber"].strip(),
        "object_links": [{"link_text": link, "link_display": "Institution object page"}] if link else [],
    }
    return "non_european", record


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Walters Art Museum resolver (non-European origins only)")
    p.add_argument("--apply", action="store_true", help="Write the output file (default: dry run)")
    p.add_argument("--refresh", action="store_true", help="Re-download art.csv and the Commons wikitext")
    p.add_argument("--limit", type=int, default=None, help="Map only the first N objects of art.csv")
    p.add_argument("--sample", type=int, default=None, help="Map N objects spread evenly over art.csv")
    p.add_argument("--show", type=int, default=12, help="Mapped records to print in a dry run")
    p.add_argument("-o", "--output", default=os.path.join(ETL_DIR, "walters_objects.json"))
    p.add_argument("-v", "--verbose", action="store_true")
    return p.parse_args()


def main():
    args = parse_args()
    if args.verbose:
        logger.setLevel(logging.DEBUG)
    institution = get_institution_coords(INSTITUTION)
    if not institution:
        sys.exit(f"{INSTITUTION} missing from institution_coords.py")
    os.makedirs(CACHE_DIR, exist_ok=True)
    s = session()
    art = load_art_csv(s, args.refresh)
    commons = commons_by_object(load_commons(s, args.refresh))
    logger.info("art.csv: %d objects; Commons: %d objects", len(art), len(commons))
    logger.info("Loading GeoNames gazetteer from %s", GAZETTEER_DIR)
    places = Places(Gazetteer(GAZETTEER_DIR))
    review = load_review()
    api2015 = load_api2015(s, args.refresh)
    widths = load_widths(s, [c["file"] for oid, c in commons.items() if oid in art], args.refresh)

    rows = list(art.values())
    if args.sample:
        rows = rows[::max(1, len(rows) // args.sample)][:args.sample]
    elif args.limit:
        rows = rows[:args.limit]

    stats, unresolved, levels, countries, reasons = Counter(), Counter(), Counter(), Counter(), Counter()
    kept, shown = [], 0
    for row in rows:
        decision, record = map_record(row, commons, places, institution, widths, review, api2015)
        stats[decision] += 1
        if decision == "unresolved":
            unresolved[record["_unresolved"]] += 1
            continue
        if decision != "non_european":
            if record and record.get("_reason"):
                reasons[record["_reason"].split(":")[0]] += 1
            continue
        kept.append(record)
        levels[record["place_level"]] += 1
        countries[record["country_en"]] += 1
        stats["with_image"] += bool(record["img_url"])
        stats["source: " + record["place_source"]] += 1
        if not args.apply and shown < args.show:
            shown += 1
            print(json.dumps({k: record[k] for k in (
                "inventory_number", "title", "place_name", "place_name_normalized", "historical_name",
                "country_en", "place_level", "latitude", "longitude", "object_date", "time",
                "img_url", "source_link",
            )}, ensure_ascii=False, indent=1))

    print("\nObjects:", dict(stats))
    print("Kept by level:", dict(levels))
    print("Kept by country:", countries.most_common(30))
    print("Most common unresolved places:", unresolved.most_common(30))
    print("Not placed (no Commons place):", reasons.most_common(10))
    if args.apply:
        json.dump(kept, open(args.output, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"Wrote {len(kept)} records to {args.output}")


if __name__ == "__main__":
    main()
