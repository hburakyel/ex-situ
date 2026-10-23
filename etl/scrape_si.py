#!/usr/bin/env python3
"""
scrape_si.py — Smithsonian Open Access resolver for Ex Situ

Source: the Smithsonian's Open Access bulk metadata on AWS
(s3://smithsonian-open-access/metadata/edan/<unit>/00.txt … ff.txt, one EDAN
JSON record per line, no API key). Only CC0 records are in it: all of NMNH
Anthropology, ~60% of the American Indian museum, ~4% of Asian Art. The rest of
the Smithsonian's catalogue is not open access and is not indexed.

Units:
    fsg         National Museum of Asian Art (Freer|Sackler)
    nmai        National Museum of the American Indian
    nmnhanthro  National Museum of Natural History, Anthropology

Origin: the record's indexedStructured.geoLocation (L2 country, L3 state,
L4 county, L5 city), which the museum derives from its place field
(freetext.place, kept in original_place_variants). Resolved by exact lookup
only, against the local GeoNames gazetteer:

  - country  → exact English country name (accents and case ignored);
               "Korea" (North or South) stays unresolved and goes to review
  - city     → a point only when exactly one GeoNames town of that name lies in
               the record's state, or (without a state) in its country

The label is the most specific level the record names (city, county, state,
else the country's GeoNames English name); a point only for a resolved city.

Scope (user decisions, 2026-10-22 and 2026-10-23): NMAI and NMNH Anthropology,
including Native American material from the United States and Canada, except:
  - objects each museum attributes to non-Native makers: NMAI Culture/People
    "Non-Indian", NMNH cultures such as "Euro-American" or "Colonial"
    (NON_NATIVE_NMAI_RE, NON_NATIVE_NMNH_RE)
  - NMNH archaeology from Europe (Russia excepted: mostly Siberian material)
  - records the museum has no photograph of at all (indexedStructured
    online_media_type without "Images"), and records whose photographs are not
    CC0 (the open data has no link to them): kept aside as read, in
    si_no_photo.jsonl and si_photo_not_cc0.jsonl, not imported
In Asian Art, objects of United States or European origin are left out: those
are the Freer's American paintings (Whistler …), whose "Origin" is the artist's
nationality, not where they were made.

No people names: credit lines, provenance and maker names are not read (the
American Indian museum's Culture/People field is, for the scope rule above).
Migration is a year only (NMNH "Accession Date"; Asian Art accession number
F1907.115 → 1907).

Images: only CC0 media from the record, hotlinked from ids.si.edu, never copied.
Most photographs are under the Smithsonian's usage conditions and have no link in
the open data (nor in its API): those records are kept aside (see Scope).

Writes JSON only (no database, no Strapi). Dry run by default.

Usage:
    python scrape_si.py --unit fsg --limit 20            # dry run, sample
    python scrape_si.py --unit fsg --apply               # one unit, write JSON
    python scrape_si.py --apply                          # all three units (~1.9 GB download, cached)
"""

import argparse
import json
import logging
import os
import re
import sys
import time
from collections import Counter, defaultdict
from typing import Optional

import requests

from scrape_europeana import GAZETTEER_DIR, Gazetteer, stable_object_id
from scrape_rijks import country_iso
from institution_coords import get_institution_coords
from audit_places import key as fold

ETL_DIR = os.path.dirname(os.path.abspath(__file__))
BUCKET_URL = "https://smithsonian-open-access.s3-us-west-2.amazonaws.com/metadata/edan"
CACHE_DIR = os.path.join(ETL_DIR, "si_cache")
SHARDS = [f"{i:02x}" for i in range(256)]
MAX_RETRIES = 5
CC0_URI = "http://creativecommons.org/publicdomain/zero/1.0/"

UNITS = {
    "fsg": {
        "institution": "National Museum of Asian Art",
        "inventory": ["Accession Number"],
        "date": ["Date"],
    },
    "nmai": {
        "institution": "National Museum of the American Indian",
        "inventory": ["Catalog Number"],
        "date": ["Date created"],
    },
    "nmnhanthro": {
        "institution": "National Museum of Natural History",
        "inventory": ["USNM Number", "Catalog Number"],
        "date": [],                      # NMNH Anthropology records no production date
    },
}

# Smithsonian country spellings the gazetteer doesn't know as such.
SI_COUNTRY_NAMES = {
    "usa": "US", "u.s.a.": "US", "us virgin islands": "VI", "st. kitts": "KN",
    "federated states of micronesia": "FM", "england": "GB", "scotland": "GB", "wales": "GB",
    "hong kong special administrative region": "HK",
}
NO_PLACE_RE = re.compile(r"^(not given|unknown|not determined|undetermined)\b", re.I)
# The museum's own doubt about a place ("USA (inferred)"); the label keeps it as a trailing "?".
HEDGE_RE = re.compile(r"\((inferred|not certain|\?)\)|\b(probably|possibly)\b|\?", re.I)
# A note the American Indian museum appends to titles; not part of the object's name.
WITHHELD_RE = re.compile(r"\s*\(Image withheld[^)]*\)\s*$", re.I)
# A state's type word, which SI and GeoNames write differently ("Chiriquí Province" / "Chiriqui",
# "Aragua State" / "Aragua", "Provincia de Lima").
STATE_WORD_RE = re.compile(
    r"\s+(state|province|department|region|prefecture|district|governorate|liwa|indigenous territory|comarca)$"
    r"|^(provincia de|provincia del|departamento de|departamento del|estado de|estado|state of|province of|comarca)\s+")
# SI state names GeoNames knows only by another name.
STATE_ALIASES = {("HN", "islas de la bahia"): "HN.11", ("MX", "federal district"): "MX.09",
                 ("MX", "distrito federal"): "MX.09"}
HEDGE_PARENS_RE = re.compile(r"\s*\((not certain|inferred|\?)\)", re.I)
# Scope (user decision, 2026-10-23): Ex Situ indexes objects made by the peoples whose
# material these museums hold, not the colonial and settler material catalogued beside
# it. Each museum's own maker attribution decides: NMAI's Culture/People "Non-Indian"
# (also "probably …", and "… (archaeological); probably used by the Seneca": made by
# non-Native makers, used by Native people), and these NMNH Anthropology cultures.
NON_NATIVE_NMAI_RE = re.compile(r"\bNon-Indian\b")
NON_NATIVE_NMNH_RE = re.compile(
    r"^(Euro-American|European|Colonial|American|Historic American|Anglo-Roman|Spanish|English|German"
    r"|Historic White|Early White|Historic Dwelling, Anglo-American)$", re.I)
QUALIFIER_RE = re.compile(r"\s*\((near|vicinity|\?)\)\s*$", re.I)

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s", datefmt="%H:%M:%S")
logger = logging.getLogger("si_scraper")


# ---------------------------------------------------------------------------
# Bulk files
# ---------------------------------------------------------------------------

def shard_path(session: requests.Session, unit: str, shard: str) -> str:
    """Local copy of one bulk file, downloaded once into si_cache/."""
    path = os.path.join(CACHE_DIR, unit, f"{shard}.txt")
    if os.path.exists(path):
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    url = f"{BUCKET_URL}/{unit}/{shard}.txt"
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            with session.get(url, stream=True, timeout=120) as r:
                if r.status_code == 200:
                    part = f"{path}.{os.getpid()}.part"
                    with open(part, "wb") as f:
                        for chunk in r.iter_content(1 << 20):
                            f.write(chunk)
                    os.replace(part, path)
                    return path
                logger.warning("HTTP %d for %s (attempt %d)", r.status_code, url, attempt)
        except requests.RequestException as e:
            logger.warning("%s (attempt %d)", e, attempt)
        time.sleep(2 ** attempt)
    raise SystemExit(f"Download kept failing: {url}")


# ---------------------------------------------------------------------------
# Places
# ---------------------------------------------------------------------------

def place_key(name: Optional[str]) -> str:
    """fold() plus the spelling differences between SI and GeoNames: "St. Vallier" = "Saint-Vallier",
    "Prince Georges" = "Prince George's"."""
    k = re.sub(r"['’ʻ`]", "", fold(name)).replace("-", " ").replace("&", " and ")
    return " ".join(re.sub(r"^st\.? ", "saint ", k).split())


def state_core(k: str) -> str:
    return STATE_WORD_RE.sub("", k).strip()


class Admin1:
    """A record's state text → GeoNames first-level region code ("US.NM"), or None."""

    def __init__(self, directory: str):
        self.exact, self.core = {}, defaultdict(set)     # (iso2, key) → code / {codes}
        for line in open(os.path.join(directory, "admin1CodesASCII.txt"), encoding="utf-8"):
            c = line.rstrip("\n").split("\t")
            if len(c) == 4:
                iso2 = c[0].split(".")[0]
                for n in (c[1], c[2]):
                    self.exact[(iso2, place_key(n))] = c[0]
                    self.core[(iso2, state_core(place_key(n)))].add(c[0])

    def _one(self, iso2: str, text: str) -> set:
        k = place_key(text)
        for a in ((iso2, k), (iso2, state_core(k))):
            if a in STATE_ALIASES:
                return {STATE_ALIASES[a]}
        if (iso2, k) in self.exact:
            return {self.exact[(iso2, k)]}
        return set(self.core.get((iso2, state_core(k)), ())) if state_core(k) else set()

    def code(self, iso2: str, state: Optional[str]) -> Optional[str]:
        """
        The text, else its parts: "Pará State, North Region" → Pará; "Khuzestan (Khuzistan)",
        "Erbil Governorate / Erbil Liwa" → one state. Parts naming different states
        ("Arizona or New Mexico", "Arizona, New Mexico") → None.
        """
        if not state:
            return None
        text = HEDGE_PARENS_RE.sub("", state).strip()
        codes = self._one(iso2, text)
        if len(codes) == 1:
            return codes.pop()
        if codes:
            return None
        parts = [p for p in re.split(r"\s*(?:/|,|;|\(|\)|\bor\b|&|\band\b)\s*", text) if p.strip()]
        found = set()
        for p in parts:
            found |= self._one(iso2, p)
        return found.pop() if len(found) == 1 else None


class Places:
    def __init__(self, gaz: Gazetteer, directory: str):
        self.gaz = gaz
        self.admin1 = Admin1(directory)
        # Main and ASCII names only: alternate names pick the wrong place (Manus → Manu Island).
        self.towns = {}                          # (key(name), "US.NM" or "US") → [(lat, lon)]
        for line in open(os.path.join(directory, "cities500.txt"), encoding="utf-8"):
            c = line.rstrip("\n").split("\t")
            for n in {place_key(c[1]), place_key(c[2])}:
                self.towns.setdefault((n, f"{c[8]}.{c[10]}"), []).append((float(c[4]), float(c[5])))
                self.towns.setdefault((n, c[8]), []).append((float(c[4]), float(c[5])))

    def country(self, name: Optional[str]) -> list:
        """ISO2 codes named by an L2 value: "USA" → [US]; "Turkey (Türkiye)" → [TR]; "USA, Canada" → [US, CA]."""
        name = re.sub(r"^(probably|possibly)\s+|\s*\?$", "", name or "", flags=re.I)   # "Syria?", "Probably Iran"
        k = fold(name)
        if k in SI_COUNTRY_NAMES:
            return [SI_COUNTRY_NAMES[k]]
        iso2 = country_iso(name, self.gaz) or country_iso(place_key(name), self.gaz)
        if iso2:
            return [iso2]
        m = re.match(r"^(.*?)\s*\((.*)\)$", name or "")
        if m:
            for part in m.groups():
                iso2 = country_iso(part, self.gaz)
                if iso2:
                    return [iso2]
        if "," in (name or ""):
            parts = [self.country(p.strip()) for p in name.split(",")]
            if all(len(p) == 1 for p in parts):
                return [p[0] for p in parts]
        return []

    def resolve(self, geo: dict) -> dict:
        """One geoLocation entry → {status, iso2, label, lat, lon, level, raw}."""
        def val(level):
            v = (geo.get(level) or {}).get("content") if isinstance(geo.get(level), dict) else None
            return None if not v or NO_PLACE_RE.match(v.strip()) else v.strip()
        country, state, county, city = val("L2"), val("L3"), val("L4"), val("L5")
        raw = ", ".join(v for v in (city, county, state, country) if v)
        if not country:
            return {"status": "none", "raw": raw}
        isos = self.country(country)
        if len(isos) != 1:
            return {"status": "unresolved" if not isos else "multi", "raw": raw, "countries": isos}
        iso2 = isos[0]
        region = self.admin1.code(iso2, state)
        # The levels as the record names them, for si_points.py (county and state points).
        parts = {"country": iso2, "admin1": region, "state": state, "county": county, "city": city}
        if city:
            name = place_key(QUALIFIER_RE.sub("", city))
            hits = self.towns.get((name, region), []) if region else self.towns.get((name, iso2), [])
            if len(hits) == 1:
                return {"status": "resolved", "iso2": iso2, "label": city, "lat": hits[0][0], "lon": hits[0][1],
                        "level": "city", "raw": raw, "parts": parts}
        label = city or county or state
        if label:
            return {"status": "resolved", "iso2": iso2, "label": label, "lat": None, "lon": None,
                    "level": "region", "raw": raw, "parts": parts}
        return {"status": "resolved", "iso2": iso2, "label": self.gaz.country_name(iso2), "lat": None, "lon": None,
                "level": "country", "raw": raw, "parts": parts}


def geo_entries(content: dict) -> list:
    """geoLocation entries; a record without them may still name a country in freetext.place."""
    geo = content.get("indexedStructured", {}).get("geoLocation") or []
    if isinstance(geo, dict):                    # a single entry is sometimes not wrapped in a list
        geo = [geo]
    geo = [g for g in geo if isinstance(g, dict)]
    if geo:
        return geo
    out = []
    for p in content.get("freetext", {}).get("place", []):
        parts = [s.strip() for s in re.split(r"[;,]", p.get("content", "")) if s.strip()]
        if parts:
            out.append({"L2": {"type": "Country", "content": parts[-1] if len(parts) > 1 else parts[0]}})
    return out


# ---------------------------------------------------------------------------
# Dates
# ---------------------------------------------------------------------------

ERA = r"(BCE|B\.C\.E\.|BC|B\.C\.|CE|C\.E\.|AD|A\.D\.)"


def _sign(era: Optional[str]) -> int:
    return -1 if era and era.upper().startswith("B") else 1


def parse_years(text: Optional[str]) -> tuple:
    """
    Plain year ranges and centuries only; anything else (None, None).
      "1860-1861" → (1860, 1861)      "1550-1196 BCE" → (-1550, -1196)
      "AD 1400–1680 (Pueblo IV …)" → (1400, 1680)      "12th century" → (1100, 1199)
      "1883 or 1884" → (1883, 1884)   "5th century BCE" → (-500, -401)
    """
    if not text:
        return None, None
    t = re.sub(r"\s*\([^)]*\)\s*$", "", text).replace("–", "-").replace("—", "-").strip()
    t = re.sub(r"^(ca\.|circa|c\.|about)\s*", "", t, flags=re.I)
    m = re.fullmatch(rf"(\d{{1,2}})(?:st|nd|rd|th)(?:\s*-\s*(\d{{1,2}})(?:st|nd|rd|th))?\s+century(?:\s+{ERA})?", t, re.I)
    if m:
        a, b, s = int(m.group(1)), int(m.group(2) or m.group(1)), _sign(m.group(3))
        if s < 0:
            start, end = -a * 100, -(b - 1) * 100 - 1
        else:
            start, end = (a - 1) * 100, b * 100 - 1
        return (start, end) if start <= end else (None, None)
    m = re.fullmatch(rf"(?:{ERA}\s*)?(\d{{1,4}})(?:\s*{ERA})?(?:\s*(?:-|to|or)\s*(?:ca\.\s*)?(?:{ERA}\s*)?(\d{{1,4}})(?:\s*{ERA})?)?", t, re.I)
    if not m:
        return None, None
    pre1, y1, post1, pre2, y2, post2 = m.groups()
    e1, e2 = pre1 or post1, pre2 or post2
    if y2 is None:
        start = end = _sign(e1) * int(y1)
    else:
        if e2 and not e1:
            e1 = e2 if _sign(e2) < 0 else None     # "1550-1196 BCE": the era covers both years
        if e1 and not e2:
            e2 = e1
        start, end = _sign(e1) * int(y1), _sign(e2) * int(y2)
    return (start, end) if start <= end else (None, None)


def acquisition_year(unit: str, freetext: dict, inventory: Optional[str]) -> Optional[int]:
    if unit == "nmnhanthro":
        for d in freetext.get("date", []):
            if d.get("label") == "Accession Date":
                years = re.findall(r"\b(1[6-9]\d\d|20\d\d)\b", d.get("content", ""))
                if years:
                    return int(years[-1])
    if unit == "fsg" and inventory:
        m = re.match(r"^[FS](\d{4})\.", inventory)
        if m:
            return int(m.group(1))
    return None


# ---------------------------------------------------------------------------
# Mapping
# ---------------------------------------------------------------------------

def first(items: list, labels: list) -> Optional[str]:
    for label in labels:
        for i in items:
            if i.get("label") == label and (i.get("content") or "").strip():
                return i["content"].strip()
    return None


def labelled(items: list, label: Optional[str] = None) -> list:
    """The contents of freetext entries (with this label), split on the museum's ';'."""
    return [part for i in items if label is None or i.get("label") == label
            for part in (i.get("content") or "").split(";") if part.strip()]


def image_url(media: list) -> Optional[str]:
    """First CC0 image. The frontend adds &max=<width> for the size it shows."""
    for m in media:
        if m.get("type") == "Images" and (m.get("usage") or {}).get("access") == "CC0" and m.get("idsId"):
            return f"https://ids.si.edu/ids/deliveryService?id={m['idsId']}"
    return None


def map_record(rec: dict, unit: str, places: Places, gaz: Gazetteer, institution: dict) -> tuple:
    """Return (decision, record or None, unresolved place labels)."""
    content = rec.get("content") or {}
    d = content.get("descriptiveNonRepeating") or {}
    ft = content.get("freetext") or {}
    if (d.get("metadata_usage") or {}).get("access") != "CC0":
        return "not_cc0", None, []

    resolved, other = [], []
    for g in geo_entries(content):
        r = places.resolve(g)
        if r["status"] == "resolved":
            resolved.append(r)
        elif r["status"] != "none":
            other.append(r)
    countries = sorted({r["iso2"] for r in resolved})
    if not resolved and not other:
        return "no_place", None, []
    if unit == "fsg" and any(c == "US" or gaz.is_european(c) for c in countries):
        return "out_of_scope", None, []
    # NMNH Anthropology's archaeology from Europe (French Palaeolithic, Swiss lake
    # dwellings …) is outside the same scope; Russia's records are mostly Siberian.
    if unit == "nmnhanthro" and any(gaz.is_european(c) and c != "RU" for c in countries):
        return "out_of_scope", None, []
    if unit == "nmai" and any(NON_NATIVE_NMAI_RE.search(v) for v in labelled(ft.get("name", []), "Culture/People")):
        return "non_native_maker", None, []
    if unit == "nmnhanthro" and any(NON_NATIVE_NMNH_RE.match(v.strip()) for v in labelled(ft.get("culture", []))):
        return "non_native_maker", None, []
    # A record the museum has no photograph of at all (not even one under its usage
    # conditions) is kept aside, outside the index (user decision, 2026-10-23).
    if "Images" not in ((content.get("indexedStructured") or {}).get("online_media_type") or []):
        return "no_photo", None, []
    if other:
        decision = "unresolved_country" if not resolved else "partly_unresolved"
    elif len(countries) > 1:
        decision = "multi_country"
    else:
        decision = "ok"

    cfg = UNITS[unit]
    inventory = first(ft.get("identifier", []), cfg["inventory"])
    created = first(ft.get("date", []), cfg["date"]) if cfg["date"] else None
    start, end = parse_years(created)
    acq = acquisition_year(unit, ft, inventory)
    title = WITHHELD_RE.sub("", (d.get("title") or {}).get("content") or rec.get("title") or "") or None
    source_link = d.get("record_link") or d.get("guid")
    image = image_url((d.get("online_media") or {}).get("media", []))
    # Photographed, but not under CC0: the open data (and its API) has no link to the
    # photograph. Kept aside rather than indexed as an inventory number (user decision,
    # 2026-10-23).
    if not image:
        return "photo_not_cc0", None, []

    # One label per record level: the most specific place of each country.
    rank = {"city": 0, "region": 1, "country": 2}
    best = {}
    for r in resolved:
        if r["iso2"] not in best or rank[r["level"]] < rank[best[r["iso2"]]["level"]]:
            best[r["iso2"]] = r
    raw_places = [p.get("content") for p in ft.get("place", []) if p.get("content")]
    hedged = any(HEDGE_RE.search(p) for p in raw_places)
    labels = [best[c]["label"].rstrip("?").strip() + ("?" if hedged else "") for c in countries]
    lat = lon = None
    if len(countries) == 1 and best[countries[0]]["level"] == "city":
        lat, lon = best[countries[0]]["lat"], best[countries[0]]["lon"]
    flagged = decision != "ok"
    notes = [f"place_source=si geoLocation ({unit})"]
    notes += [f"{r['raw']}: {r['level']}" for r in resolved]
    if other:
        notes.append("unresolved: " + "; ".join(o["raw"] for o in other))
    if hedged:
        notes.append("source hedge kept as '?'")
    record = {
        "object_id": stable_object_id(d.get("record_ID") or rec["id"]),
        "si_id": d.get("record_ID"),
        "si_unit": unit,
        "title": title,
        "img_url": image,
        "image_rights": CC0_URI if image else None,
        "latitude": lat,
        "longitude": lon,
        "institution_name": cfg["institution"],
        "institution_place": f"{institution['city']}, {institution['country']}",
        "institution_latitude": institution["lat"],
        "institution_longitude": institution["lon"],
        "institution_city_en": institution["city"],
        "institution_country_en": institution["country"],
        "source_link": source_link,
        "place_name": "; ".join(labels) if labels else None,
        "place_level": best[countries[0]]["level"] if len(countries) == 1 else None,
        "si_place": best[countries[0]]["parts"] if len(countries) == 1 else None,
        "place_source": "provider",
        "original_place_variants": [{"label": p, "language": "en", "source": "si_freetext_place"} for p in raw_places],
        "geocoded_country": gaz.country_name(countries[0]) if len(countries) == 1 else None,
        "geocoder_source": "geonames_exact",
        "geocoding_status": "ambiguous" if flagged else "ok",
        "geocoding_notes": " | ".join(notes),
        "review_status": "pending" if flagged else None,
        "object_date": created,
        "time": [{"time_name": created, "time_start": start, "time_end": end}] if created and start is not None else [],
        "acquisition_year_earliest": acq,
        "acquisition_year_latest": acq,
        "inventory_number": inventory,
        "object_links": [{"link_text": source_link, "link_display": "Institution object page"}] if source_link else [],
        "decision": decision,
    }
    return decision, record, [o["raw"] for o in other]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

SHOW_FIELDS = ("si_id", "inventory_number", "title", "place_name", "place_level", "si_place", "latitude", "longitude",
               "geocoded_country", "original_place_variants", "object_date", "time", "acquisition_year_earliest",
               "img_url", "source_link", "decision")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Smithsonian Open Access resolver (Asian Art, American Indian, NMNH Anthropology)")
    p.add_argument("--apply", action="store_true", help="Write the output files (default: dry run)")
    p.add_argument("--unit", action="append", choices=sorted(UNITS), default=[], help="Unit to read (repeatable); default: all")
    p.add_argument("--limit", type=int, default=None, help="Stop each unit after N records")
    p.add_argument("--max-shards", type=int, default=None, help="Read only the first N of the 256 bulk files per unit")
    p.add_argument("--show", type=int, default=5, help="Mapped records to print per unit in a dry run")
    p.add_argument("-o", "--output", default=os.path.join(ETL_DIR, "si_objects.json"))
    p.add_argument("--flagged-output", default=os.path.join(ETL_DIR, "si_flagged.json"))
    p.add_argument("--set-aside-dir", default=ETL_DIR,
                   help="Where records kept aside are written as read, one file per reason "
                        "(si_no_photo.jsonl, si_photo_not_cc0.jsonl); not imported")
    p.add_argument("-v", "--verbose", action="store_true")
    return p.parse_args()


# Records kept aside, outside the index, as the museum's raw records.
SET_ASIDE = ("no_photo", "photo_not_cc0")


class SetAside:
    """The raw bulk-file lines of records kept aside, one per line."""

    def __init__(self, path: str):
        self.f, self.n, self.path = open(path + ".part", "w", encoding="utf-8"), 0, path

    def write(self, line: str):
        self.f.write(line.rstrip("\n") + "\n")
        self.n += 1

    def close(self):
        self.f.close()
        os.replace(self.path + ".part", self.path)


class JsonArray:
    """Streams records into a JSON array file (a full run is several hundred MB)."""

    def __init__(self, path: str):
        self.f, self.n = open(path + ".part", "w", encoding="utf-8"), 0
        self.path = path
        self.f.write("[\n")

    def write(self, record: dict):
        self.f.write((",\n" if self.n else "") + json.dumps(record, ensure_ascii=False))
        self.n += 1

    def close(self):
        self.f.write("\n]\n")
        self.f.close()
        os.replace(self.path + ".part", self.path)


def main():
    args = parse_args()
    if args.verbose:
        logger.setLevel(logging.DEBUG)
    logger.info("Loading GeoNames gazetteer from %s", GAZETTEER_DIR)
    gaz = Gazetteer(GAZETTEER_DIR)
    places = Places(gaz, GAZETTEER_DIR)
    session = requests.Session()
    session.headers.update({"User-Agent": "ExSitu-resolver (https://exsitu.app; open-source spatial index)"})

    kept_out = JsonArray(args.output) if args.apply else None
    flagged_out = JsonArray(args.flagged_output) if args.apply else None
    set_aside = {reason: SetAside(os.path.join(args.set_aside_dir, f"si_{reason}.jsonl"))
                 for reason in SET_ASIDE} if args.apply else {}
    seen = set()
    for unit in args.unit or list(UNITS):
        institution = get_institution_coords(UNITS[unit]["institution"])
        if not institution:
            sys.exit(f"{UNITS[unit]['institution']} missing from institution_coords.py")
        stats, unresolved, kept_countries, levels = Counter(), Counter(), Counter(), Counter()
        shown = 0
        for shard in SHARDS[:args.max_shards]:
            path = shard_path(session, unit, shard)
            with open(path, encoding="utf-8") as f:
                for line in f:
                    if not line.strip():
                        continue
                    stats["read"] += 1
                    decision, record, other = map_record(json.loads(line), unit, places, gaz, institution)
                    stats[decision] += 1
                    if decision in set_aside:
                        set_aside[decision].write(line)
                    unresolved.update(other)
                    if record:
                        if record["object_id"] in seen:
                            stats["duplicate"] += 1
                            continue
                        seen.add(record["object_id"])
                        if decision == "ok":
                            kept_countries[record["geocoded_country"]] += 1
                            levels[record["place_level"]] += 1
                        stats["with_image"] += bool(record["img_url"])
                        stats["with_date"] += bool(record["time"])
                        stats["with_acquisition_year"] += record["acquisition_year_earliest"] is not None
                        if kept_out:
                            (kept_out if decision == "ok" else flagged_out).write(record)
                        elif shown < args.show:
                            shown += 1
                            print(json.dumps({k: record[k] for k in SHOW_FIELDS}, ensure_ascii=False, indent=1))
                    if args.limit and stats["read"] >= args.limit:
                        break
            if args.limit and stats["read"] >= args.limit:
                break
            if int(shard, 16) % 32 == 31:
                logger.info("%s: %s/ff, %d records, %d kept", unit, shard, stats["read"], stats["ok"])
        print(f"\n== {unit} ({UNITS[unit]['institution']})")
        print("Records:", dict(stats))
        print("Place level of kept records:", dict(levels))
        print("Kept by country:", kept_countries.most_common(25))
        print("Most common unresolved places:", unresolved.most_common(15))

    if kept_out:
        kept_out.close()
        flagged_out.close()
        print(f"Wrote {kept_out.n} records to {args.output}, {flagged_out.n} flagged to {args.flagged_output}")
        for out in set_aside.values():
            out.close()
            print(f"Kept aside {out.n} records in {out.path}")


if __name__ == "__main__":
    main()
