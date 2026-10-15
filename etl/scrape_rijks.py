#!/usr/bin/env python3
"""
scrape_rijks.py — Rijksmuseum resolver for Ex Situ

Source: the Rijksmuseum's open OAI-PMH feed (https://data.rijksmuseum.nl/oai,
metadataPrefix=edm, no API key). Each record is the museum's own EDM record.

Scope: only objects whose *origin* is outside Europe. Origin is the record's
dcterms:spatial, which the Rijksmuseum uses for the place of production (a 1669
view of Batavia printed in London has spatial = London; depicted places are in
dc:subject and are ignored). Each spatial place is resolved by exact lookup
only, using the same rules as scrape_europeana.py:

  - GeoNames sameAs URI   → geonameid in the local gazetteer
  - plain label           → exact English country name only

A record is kept only when every resolved place is non-European. Records with
both European and non-European places, or with an ambiguous label, go to the
flagged file for review. Records with no resolvable place are skipped and
counted, never guessed.

Licence: each record carries its own edm:rights. The record is always indexed
(it links back to the museum), but the image is hotlinked only under an open
licence (public domain mark, CC0, CC BY, CC BY-SA); it is never copied.

Writes JSON only (no database, no Strapi). Dry run by default.

Usage:
    python scrape_rijks.py --set 261132 --limit 20      # dry run, sample
    python scrape_rijks.py --set 261132 --apply         # one set, write JSON
    python scrape_rijks.py --apply                      # whole collection (~850k records, ~2 h)
    python scrape_rijks.py --apply --resume             # continue an interrupted run
"""

import argparse
import json
import logging
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
from collections import Counter
from typing import Optional

import requests

from scrape_europeana import (
    GAZETTEER_DIR, GEONAMES_RE, OPEN_RIGHTS, Gazetteer, place_labels, stable_object_id,
)
from institution_coords import get_institution_coords
from audit_places import COUNTRY_ALIASES, key as fold

ETL_DIR = os.path.dirname(os.path.abspath(__file__))
OAI_URL = "https://data.rijksmuseum.nl/oai"
CHECKPOINT_FILE = os.path.join(ETL_DIR, "rijks_checkpoint.json")
INSTITUTION = "Rijksmuseum"
REQUEST_DELAY_SECONDS = 0.3
MAX_RETRIES = 5
IMAGE_WIDTH = 1000

NS = {
    "oai": "http://www.openarchives.org/OAI/2.0/",
    "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "dc": "http://purl.org/dc/elements/1.1/",
    "dcterms": "http://purl.org/dc/terms/",
    "edm": "http://www.europeana.eu/schemas/edm/",
    "ore": "http://www.openarchives.org/ore/terms/",
    "owl": "http://www.w3.org/2002/07/owl#",
    "skos": "http://www.w3.org/2004/02/skos/core#",
}
RDF_ABOUT = "{%s}about" % NS["rdf"]
RDF_RESOURCE = "{%s}resource" % NS["rdf"]
XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"

# Former names and island labels the Rijksmuseum uses for a whole present-day
# country or territory. "Korea" (North or South) is deliberately not here.
HISTORICAL_COUNTRY_NAMES = {
    "persia": "IR", "perzie": "IR",
    "saba": "BQ", "sint eustatius": "BQ", "bonaire": "BQ",
}


def country_iso(name: Optional[str], gaz: Gazetteer) -> Optional[str]:
    """Exact country name, ignoring accents and case (GeoNames writes "Curacao")."""
    k = fold(name)
    if not k:
        return None
    if not hasattr(gaz, "_folded"):
        gaz._folded = {fold(n): iso for n, iso in gaz.country_by_name.items()}
        gaz._folded.update({fold(n): iso for n, iso in COUNTRY_ALIASES.items()})
        gaz._folded.update(HISTORICAL_COUNTRY_NAMES)
    iso2 = gaz._folded.get(k)
    return iso2 if iso2 in gaz.countries else None


logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s", datefmt="%H:%M:%S")
logger = logging.getLogger("rijks_scraper")


# ---------------------------------------------------------------------------
# OAI-PMH
# ---------------------------------------------------------------------------

def fetch_page(session: requests.Session, params: dict) -> ET.Element:
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = session.get(OAI_URL, params=params, timeout=120)
            if r.status_code == 200:
                return ET.fromstring(r.content)
            logger.warning("HTTP %d (attempt %d)", r.status_code, attempt)
        except (requests.RequestException, ET.ParseError) as e:
            logger.warning("%s (attempt %d)", e, attempt)
        time.sleep(2 ** attempt)
    raise SystemExit("OAI-PMH request kept failing; rerun with --resume to continue.")


def _text(el: ET.Element, path: str, lang: Optional[str] = None) -> Optional[str]:
    """First non-empty value at path, preferring the given language."""
    values = [e for e in el.findall(path, NS) if (e.text or "").strip()]
    if lang:
        for e in values:
            if e.get(XML_LANG) == lang:
                return e.text.strip()
    return values[0].text.strip() if values else None


def _label(el: ET.Element) -> Optional[str]:
    return _text(el, "skos:prefLabel", "en") or _text(el, "skos:prefLabel")


# ---------------------------------------------------------------------------
# Mapping
# ---------------------------------------------------------------------------

class PlaceHierarchy:
    """
    Places without a GeoNames link (Batavia, Kanton, Ambon … often only have a
    Getty TGN link) are resolved through the Rijksmuseum's own place thesaurus:
    follow part_of upwards until a place has a GeoNames link. Batavia → Jakarta
    (provincie) → West-Java (GeoNames 1642672) → Indonesia. An ancestor whose
    name is exactly an English country name ("Indonesia"), or whose Wikidata
    item has an ISO 3166 code (P297), also counts. The
    place itself then gets that country; city coordinates only when exactly one
    GeoNames town of that name lies in the same first-level region or, for a
    place the museum classifies as an inhabited place, in the same country.
    """

    MAX_DEPTH = 8

    def __init__(self, session: requests.Session, gaz: Gazetteer, directory: str):
        self.session, self.gaz = session, gaz
        self.path = os.path.join(ETL_DIR, "rijks_place_cache.json")
        self.cache = json.load(open(self.path, encoding="utf-8")) if os.path.exists(self.path) else {}
        self.admin1_code = {}                     # admin1 geonameid → "ID.30"
        for line in open(os.path.join(directory, "admin1CodesASCII.txt"), encoding="utf-8"):
            c = line.rstrip("\n").split("\t")
            if len(c) == 4:
                self.admin1_code[c[3]] = c[0]
        self.towns = {}                           # (lower name, "ID.30" or "ID") → [(lat, lon)]
        for line in open(os.path.join(directory, "cities500.txt"), encoding="utf-8"):
            c = line.rstrip("\n").split("\t")
            code = f"{c[8]}.{c[10]}"
            for n in {c[1].lower(), c[2].lower()} | {a.lower() for a in c[3].split(",") if a}:
                self.towns.setdefault((n, code), []).append((float(c[4]), float(c[5])))
                self.towns.setdefault((n, c[8]), []).append((float(c[4]), float(c[5])))
        self.dirty = 0
        self.wd_path = os.path.join(ETL_DIR, "rijks_wikidata_iso.json")
        self.wd_iso = json.load(open(self.wd_path, encoding="utf-8")) if os.path.exists(self.wd_path) else {}

    def _country_code(self, qid: str) -> Optional[str]:
        """ISO 3166-1 alpha-2 (Wikidata P297) of a Wikidata item; None unless it is a country."""
        if qid not in self.wd_iso:
            code = None
            try:
                r = self.session.get("https://www.wikidata.org/w/api.php", timeout=60, params={
                    "action": "wbgetclaims", "entity": qid, "property": "P297", "format": "json"})
                claims = r.json().get("claims", {}).get("P297", [])
                code = claims[0]["mainsnak"]["datavalue"]["value"].upper() if claims else None
            except (requests.RequestException, ValueError, KeyError, IndexError) as e:
                logger.warning("wikidata %s: %s", qid, e)
                return None          # not cached: retried next time
            self.wd_iso[qid] = code
            json.dump(self.wd_iso, open(self.wd_path, "w", encoding="utf-8"))
        code = self.wd_iso[qid]
        return code if code in self.gaz.countries else None

    def _entity(self, uri: str) -> Optional[dict]:
        if uri in self.cache and (self.cache[uri] is None or "wikidata" in self.cache[uri]):
            return self.cache[uri]
        pid = uri.rstrip("/").rsplit("/", 1)[-1]
        entity = None
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                r = self.session.get(f"https://data.rijksmuseum.nl/{pid}",
                                     headers={"Accept": "application/ld+json"}, timeout=60)
                if r.status_code == 200:
                    d = r.json()
                    entity = {
                        "names": [n.get("content") for n in d.get("identified_by", []) if n.get("type") == "Name"],
                        "part_of": [p["id"] for p in d.get("part_of", []) if "id" in p],
                        # notation is usually [{"@language", "@value"}], sometimes a plain string
                        "types": [n.get("@value") if isinstance(n, dict) else n
                                  for c in d.get("classified_as", []) if isinstance(c, dict)
                                  for n in (c.get("notation") if isinstance(c.get("notation"), list) else [c.get("notation")])
                                  if n and (not isinstance(n, dict) or n.get("@language") in ("en", None))],
                        "wikidata": next((m.group(1) for m in (re.match(r"^https?://www\.wikidata\.org/entity/(Q\d+)$", e.get("id", ""))
                                          for e in d.get("equivalent", [])) if m), None),
                        "geonames": next((m.group(1) for m in (GEONAMES_RE.match(e.get("id", ""))
                                          for e in d.get("equivalent", [])) if m), None),
                    }
                    break
                if r.status_code == 404:
                    break
            except (requests.RequestException, ValueError) as e:
                logger.warning("place %s: %s (attempt %d)", pid, e, attempt)
            time.sleep(2 ** attempt)
        self.cache[uri] = entity
        self.dirty += 1
        if self.dirty >= 50:
            self.save()
        time.sleep(REQUEST_DELAY_SECONDS)
        return entity

    def save(self):
        json.dump(self.cache, open(self.path, "w", encoding="utf-8"), ensure_ascii=False)
        self.dirty = 0

    def _anchor(self, e: dict) -> Optional[tuple]:
        """(iso2, admin1 code or None, how) when this place is tied to a country."""
        if e["geonames"] in self.gaz.geonameid:
            _, iso2, _, _, level = self.gaz.geonameid[e["geonames"]]
            return iso2, self.admin1_code.get(e["geonames"]) if level == "region" else None, f"GeoNames {e['geonames']}"
        for n in e["names"]:
            iso2 = country_iso(n, self.gaz)
            if iso2:
                return iso2, None, n
        if e.get("wikidata"):
            iso2 = self._country_code(e["wikidata"])
            if iso2:
                return iso2, None, f"Wikidata {e['wikidata']}"
        return None

    def resolve(self, uri: str, label: Optional[str]) -> Optional[dict]:
        """
        Follow every part_of path to its nearest tied ancestor. Accepted only when
        all paths that reach a country reach the same one (Borneo under both
        Indonesia and Malaysia stays unresolved).
        """
        own = self._entity(uri)
        if not own:
            return None
        inhabited = "inhabited place" in own.get("types", [])
        hit = self._anchor(own)
        if hit:                              # the place is itself a country ("Tunesië")
            return {"iso2": hit[0], "lat": None, "lon": None, "level": "country", "via": hit[2]}
        name = re.sub(r"\s*\((stad|city)\)$", "", label or "", flags=re.I).lower()
        anchors, seen, frontier, depth = [], {uri}, list(own["part_of"]), 0
        while frontier and depth < self.MAX_DEPTH:
            nxt = []
            for u in frontier:
                if u in seen:
                    continue
                seen.add(u)
                e = self._entity(u)
                if not e:
                    continue
                hit = self._anchor(e)
                if hit:
                    anchors.append(hit)      # this path ends here
                else:
                    nxt.extend(e["part_of"])
            frontier, depth = nxt, depth + 1
        countries = {a[0] for a in anchors}
        if len(countries) != 1:
            return None
        iso2 = countries.pop()
        region = next((a[1] for a in anchors if a[1]), None)
        hits = self.towns.get((name, region), []) if region and name else []
        if len(hits) != 1 and inhabited and name:
            hits = self.towns.get((name, iso2), [])
        lat, lon = hits[0] if len(hits) == 1 else (None, None)
        return {"iso2": iso2, "lat": lat, "lon": lon, "level": "city" if lat is not None else "region",
                "via": "part_of → " + ", ".join(sorted({a[2] for a in anchors}))}


def resolve_place(place: ET.Element, gaz: Gazetteer, hierarchy: Optional[PlaceHierarchy] = None) -> dict:
    """Resolve one edm:Place: its GeoNames sameAs, an exact English country name, or the museum's place hierarchy."""
    label = _label(place)
    for same in place.findall("owl:sameAs", NS):
        m = GEONAMES_RE.match(same.get(RDF_RESOURCE, ""))
        if m and m.group(1) in gaz.geonameid:
            name, iso2, lat, lon, level = gaz.geonameid[m.group(1)]
            return {"status": "resolved", "iso2": iso2, "label": label or name,
                    "lat": lat, "lon": lon, "level": level, "raw": label or m.group(0)}
    iso2 = country_iso(label, gaz)
    if iso2:
        return {"status": "resolved", "iso2": iso2, "label": label, "lat": None, "lon": None,
                "level": "country", "raw": label}
    if hierarchy:
        hit = hierarchy.resolve(place.get(RDF_ABOUT), label)
        if hit:
            return {"status": "resolved", "iso2": hit["iso2"], "label": label, "lat": hit["lat"], "lon": hit["lon"],
                    "level": hit["level"], "raw": label, "via": hit["via"]}
    return {"status": "unresolved", "raw": label}


def classify(resolved: list, unresolved: list, gaz: Gazetteer) -> str:
    if not resolved:
        return "unresolved"
    european = {r["iso2"] for r in resolved if gaz.is_european(r["iso2"])}
    non_european = {r["iso2"] for r in resolved if not gaz.is_european(r["iso2"])}
    if european and non_european:
        return "mixed"
    if european:
        return "european"
    if unresolved:
        return "partly_unresolved"   # e.g. "Japan" + an unknown place: review, don't guess
    return "non_european"


def parse_years(created: Optional[str]) -> tuple:
    """'1669' → (1669, 1669); 'c. 800 - c. 900' → (800, 900). Anything else: (None, None)."""
    if not created:
        return None, None
    years = re.findall(r"(?<![\d-])(\d{3,4})(?!\d)", created)
    if re.search(r"\b(BC|BCE|v\.Chr)\b", created, re.I) or not years or len(years) > 2:
        return None, None
    start, end = int(years[0]), int(years[-1])
    return (start, end) if start <= end else (None, None)


def image_url(shown_by: Optional[str]) -> Optional[str]:
    """Ask the IIIF server for a web-sized image instead of the full-resolution master."""
    if not shown_by:
        return None
    return re.sub(r"/full/max/0/default\.jpg$", f"/full/{IMAGE_WIDTH},/0/default.jpg", shown_by)


def map_record(rdf: ET.Element, gaz: Gazetteer, institution: dict, hierarchy: Optional[PlaceHierarchy] = None) -> tuple:
    """Return (decision, record or None, unresolved place labels)."""
    agg = rdf.find("ore:Aggregation", NS)
    cho = rdf.find("edm:ProvidedCHO", NS)
    if agg is None or cho is None:
        return "no_metadata", None, []
    places = {p.get(RDF_ABOUT): p for p in rdf.findall("edm:Place", NS)}
    spatial = [s.get(RDF_RESOURCE) for s in cho.findall("dcterms:spatial", NS)]
    resolved, unresolved = [], []
    for uri in dict.fromkeys(spatial):
        place = places.get(uri)
        r = resolve_place(place, gaz, hierarchy) if place is not None else {"status": "unresolved", "raw": uri}
        (resolved if r["status"] == "resolved" else unresolved).append(r)
    decision = classify(resolved, unresolved, gaz)
    if decision in ("unresolved", "european"):
        return decision, None, [u["raw"] for u in unresolved]

    inventory = _text(cho, "dc:identifier")
    created = _text(cho, "dcterms:created", "en")
    start, end = parse_years(created)
    concepts = {c.get(RDF_ABOUT): _label(c) or "" for c in rdf.findall("skos:Concept", NS)}
    types = [concepts.get(t.get(RDF_RESOURCE), "") for t in cho.findall("dc:type", NS)]

    rid = cho.get(RDF_ABOUT, "")
    res = lambda el, tag: (el.find(tag, NS).get(RDF_RESOURCE) if el.find(tag, NS) is not None else None)
    rights = res(agg, "edm:rights") or ""
    image = image_url(res(agg, "edm:isShownBy")) if any(r in rights for r in OPEN_RIGHTS) else None
    shown_at = res(agg, "edm:isShownAt")

    labels = place_labels(resolved, gaz.country_name)
    countries = sorted({r["iso2"] for r in resolved})
    lat = lon = None
    cities = [r for r in resolved if r["level"] == "city"]
    if len(cities) == 1 and len(countries) == 1:
        lat, lon = cities[0]["lat"], cities[0]["lon"]
    flagged = decision != "non_european"
    notes = ["place_source=rijksmuseum dcterms:spatial"]
    notes += [f"{r['raw']}: {r['via']}" for r in resolved if r.get("via")]
    if unresolved:
        notes.append("unresolved: " + "; ".join(str(u["raw"]) for u in unresolved))

    record = {
        "object_id": stable_object_id(rid),
        "rijks_id": rid,
        "title": _text(cho, "dc:title", "en") or _text(cho, "dc:title"),
        "img_url": image,
        "image_rights": rights or None,
        "latitude": lat,
        "longitude": lon,
        "institution_name": INSTITUTION,
        "institution_place": f"{institution['city']}, {institution['country']}",
        "institution_latitude": institution["lat"],
        "institution_longitude": institution["lon"],
        "institution_city_en": institution["city"],
        "institution_country_en": institution["country"],
        "source_link": shown_at,
        "place_name": "; ".join(labels) if labels else None,
        "place_source": "provider",
        "original_place_variants": [
            {"label": r["raw"], "language": "und", "source": "rijksmuseum_spatial"} for r in resolved + unresolved
        ],
        "geocoded_country": gaz.country_name(countries[0]) if len(countries) == 1 else None,
        "geocoder_source": "geonames_exact",
        "geocoding_status": "ambiguous" if flagged else "ok",
        "geocoding_notes": " | ".join(notes),
        "review_status": "pending" if flagged else None,
        "object_date": created,
        "time": [{"time_name": created, "time_start": start, "time_end": end}] if created and start is not None else [],
        "inventory_number": inventory,
        "object_type": "; ".join(t for t in types if t) or None,
        "provenance": _text(cho, "dcterms:provenance", "en") or _text(cho, "dcterms:provenance"),
        "object_links": [{"link_text": shown_at, "link_display": "Institution object page"}] if shown_at else [],
        "decision": decision,
    }
    return decision, record, [u["raw"] for u in unresolved]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Rijksmuseum resolver (non-European origins only)")
    p.add_argument("--apply", action="store_true", help="Write the output files (default: dry run)")
    p.add_argument("--set", action="append", default=[], help="OAI set spec to harvest (repeatable); default: whole collection")
    p.add_argument("--limit", type=int, default=None, help="Stop after N harvested records")
    p.add_argument("--max-pages", type=int, default=None, help="Stop after N pages (50 records each)")
    p.add_argument("--resume", action="store_true", help="Continue from rijks_checkpoint.json (with --apply)")
    p.add_argument("--show", type=int, default=10, help="Mapped records to print in a dry run")
    p.add_argument("-o", "--output", default=os.path.join(ETL_DIR, "rijks_objects.json"))
    p.add_argument("--flagged-output", default=os.path.join(ETL_DIR, "rijks_flagged.json"))
    p.add_argument("-v", "--verbose", action="store_true")
    return p.parse_args()


def main():
    args = parse_args()
    if args.verbose:
        logger.setLevel(logging.DEBUG)
    institution = get_institution_coords(INSTITUTION)
    if not institution:
        sys.exit(f"{INSTITUTION} missing from institution_coords.py")
    logger.info("Loading GeoNames gazetteer from %s", GAZETTEER_DIR)
    gaz = Gazetteer(GAZETTEER_DIR)
    session = requests.Session()
    session.headers.update({"User-Agent": "ExSitu-resolver (https://exsitu.app; open-source spatial index)"})
    hierarchy = PlaceHierarchy(session, gaz, GAZETTEER_DIR)

    # Each harvest is a queue of OAI sets ("" = whole collection); --apply streams
    # mapped records to JSONL and checkpoints the resumption token after each page.
    queue = args.set or [""]
    stats, unresolved_labels, kept_countries = Counter(), Counter(), Counter()
    token, done_sets, pages = None, [], 0
    partial_path = args.output + ".partial.jsonl"
    partial = None
    if args.apply:
        if args.resume and os.path.exists(CHECKPOINT_FILE):
            cp = json.load(open(CHECKPOINT_FILE, encoding="utf-8"))
            token, done_sets, pages = cp["token"], cp["done_sets"], cp["pages"]
            stats.update(cp["stats"]); unresolved_labels.update(cp["unresolved"]); kept_countries.update(cp["countries"])
            logger.info("Resuming after %d pages", pages)
            partial = open(partial_path, "a", encoding="utf-8")
        else:
            partial = open(partial_path, "w", encoding="utf-8")

    def checkpoint(next_token):
        if partial:
            partial.flush()
            json.dump({"token": next_token, "done_sets": done_sets, "pages": pages, "stats": stats,
                       "unresolved": dict(unresolved_labels.most_common(2000)), "countries": kept_countries},
                      open(CHECKPOINT_FILE, "w", encoding="utf-8"))

    shown = 0
    stop = False
    for set_spec in queue:
        if set_spec in done_sets or stop:
            continue
        while not stop:
            if token:
                params = {"verb": "ListRecords", "resumptionToken": token}
            else:
                params = {"verb": "ListRecords", "metadataPrefix": "edm"}
                if set_spec:
                    params["set"] = set_spec
            root = fetch_page(session, params)
            pages += 1
            err = root.find("oai:error", NS)
            if err is not None:
                if err.get("code") != "noRecordsMatch":
                    logger.warning("OAI error %s: %s", err.get("code"), err.text)
                token = None
                break
            for rec in root.findall("oai:ListRecords/oai:record", NS):
                stats["harvested"] += 1
                if rec.find("oai:header", NS).get("status") == "deleted":
                    stats["deleted"] += 1
                    continue
                rdf = rec.find("oai:metadata/rdf:RDF", NS)
                if rdf is None:
                    stats["no_metadata"] += 1
                    continue
                decision, record, unresolved = map_record(rdf, gaz, institution, hierarchy)
                stats[decision] += 1
                unresolved_labels.update(str(u) for u in unresolved)
                if record:
                    if decision == "non_european":
                        kept_countries[record["geocoded_country"] or record["place_name"]] += 1
                        stats["with_open_image"] += bool(record["img_url"])
                    if partial:
                        partial.write(json.dumps(record, ensure_ascii=False) + "\n")
                    elif shown < args.show and decision == "non_european":
                        shown += 1
                        print(json.dumps({k: record[k] for k in (
                            "inventory_number", "title", "place_name", "latitude", "longitude", "geocoding_notes",
                            "geocoded_country", "object_date", "time", "img_url", "image_rights", "source_link", "provenance",
                        )}, ensure_ascii=False, indent=1))
                if args.limit and stats["harvested"] >= args.limit:
                    stop = True
                    break
            rt = root.find("oai:ListRecords/oai:resumptionToken", NS)
            token = rt.text.strip() if rt is not None and (rt.text or "").strip() else None
            if args.max_pages and pages >= args.max_pages:
                stop = True
            checkpoint(token)
            if pages % 100 == 0:
                logger.info("%d pages, %d records, %d kept", pages, stats["harvested"], stats["non_european"])
            if not token:
                break
            time.sleep(REQUEST_DELAY_SECONDS)
        if not stop:
            done_sets.append(set_spec)
            token = None
            checkpoint(None)

    hierarchy.save()
    print("\nRecords:", dict(stats))
    print("Kept by country:", kept_countries.most_common(25))
    print("Most common unresolved places:", unresolved_labels.most_common(25))

    if partial:
        partial.close()
        kept, flagged, seen = [], [], set()
        for line in open(partial_path, encoding="utf-8"):
            r = json.loads(line)
            if r["object_id"] in seen:          # a record in several harvested sets
                continue
            seen.add(r["object_id"])
            (kept if r["decision"] == "non_european" else flagged).append(r)
        json.dump(kept, open(args.output, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        json.dump(flagged, open(args.flagged_output, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"Wrote {len(kept)} records to {args.output}, {len(flagged)} flagged to {args.flagged_output}")
        if not stop and os.path.exists(CHECKPOINT_FILE):
            os.remove(CHECKPOINT_FILE)


if __name__ == "__main__":
    main()
