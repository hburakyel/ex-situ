#!/usr/bin/env python3
"""
build_country_labels.py — Build the map's country labels
(frontend/public/country-labels.geojson).

Country names on the map follow UN and ICJ usage for every country (see
METHODOLOGY.md, "Country labels"). The basemap's own labels (Protomaps /
OpenStreetMap) treat neighbouring countries differently by zoom, e.g. Israel
from the world view on but Palestine only from zoom 6, as "Palestinian
Territories", so the map draws its country labels from this file and hides the
basemap's.

Source: Natural Earth 1:50m Admin 0 – Countries, release v5.1.2 (public domain),
pinned by URL and SHA-256 so the file can be rebuilt exactly:
    https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson

Natural Earth's label point (LABEL_X/LABEL_Y), English name (NAME_EN), population
rank and minimum label zoom are kept, with these changes:
  - Palestine (UN observer State, GA resolution 67/19) is labelled from the same
    zoom as Israel, and Western Sahara (UN Non-Self-Governing Territory) from the
    same zoom as Morocco, at the centre of the whole territory; both win label
    collisions so they stay in view.
  - Northern Cyprus gets no label (UN Security Council resolution 541).
  - Names a country asked to be called by, and UN spellings: Côte d'Ivoire,
    Timor-Leste, Cabo Verde, Czechia, Falkland Islands (Malvinas); Chagos
    Archipelago (ICJ advisory opinion, 2019; GA resolution 73/295).
  - Siachen Glacier is not a country and gets no country label.
Natural Earth's sovereignty and status fields are not copied.

Each label also carries `keys`: normalized names used to match the data's origin
names, so the map can leave origins that are countries to these labels.

Usage:
    python etl/build_country_labels.py SOURCE.geojson            # dry run: summary only
    python etl/build_country_labels.py SOURCE.geojson --apply    # write the file
    python etl/build_country_labels.py --self-test               # check the shared name-key cases

The name normalization must stay identical to countryKey() in
frontend/lib/country-labels.ts; both are checked against
frontend/lib/country-key-cases.json.
"""

import argparse
import hashlib
import json
import os
import sys
import unicodedata

SOURCE_SHA256 = "3e458fc036ad0a66411f2c1e6cac49c5d7bfb81cb1123bc513b22511a2b7fdeb"

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT = os.path.join(REPO, "frontend", "public", "country-labels.geojson")
CASES = os.path.join(REPO, "frontend", "lib", "country-key-cases.json")

NAME_FIELDS = ("ADMIN", "NAME", "NAME_LONG", "NAME_EN", "GEOUNIT", "SUBUNIT", "BRK_NAME", "NAME_CIAWF", "FORMAL_EN", "NAME_SORT")

# Units that get no country label (see the module docstring).
EXCLUDED = {"CYN", "KAS"}

# Display names that differ from Natural Earth's NAME_EN.
NAMES = {
    "CHN": "China",
    "USA": "United States",
    "CIV": "Côte d'Ivoire",
    "TLS": "Timor-Leste",
    "CPV": "Cabo Verde",
    "CZE": "Czechia",
    "IOT": "Chagos Archipelago",
    "FLK": "Falkland Islands (Malvinas)",
}

# Origin names in the data that differ from every Natural Earth name of the unit.
ALIASES = {
    "PSX": ["Palestinian Territories", "Palestinian Territory", "State of Palestine"],
    "COG": ["Congo-Brazzaville"],
    "CYP": ["Northern Cyprus", "Turkish Republic of Northern Cyprus"],
    "IOT": ["Chagos Archipelago"],
}

# Labelled from the same zoom as the neighbour Natural Earth labels earlier.
MIN_ZOOM_LIKE = {"PSX": "ISR", "SAH": "MAR"}
LABEL_POINT = {"SAH": (-13.0, 24.5)}  # Natural Earth's point sits in the eastern strip only
PRIORITY = {"PSX", "SAH"}  # win label collisions against neighbouring labels


def country_key(name: str) -> str:
    """Accent-, case- and punctuation-insensitive form of a country name."""
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    s = s.replace("-", " ").replace(".", "").replace("'", "").replace("’", "")
    return " ".join(s.split())


def build(source_path):
    raw = open(source_path, "rb").read()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != SOURCE_SHA256:
        sys.exit(f"Source checksum {digest} does not match Natural Earth v5.1.2 ({SOURCE_SHA256}).")
    units = {f["properties"]["ADM0_A3"]: f["properties"] for f in json.loads(raw)["features"]}
    if len(units) != len(json.loads(raw)["features"]):
        sys.exit("ADM0_A3 codes are not unique; cannot use them as label ids.")

    features = []
    for unit_id, p in units.items():
        if unit_id in EXCLUDED:
            continue
        names = [p[k] for k in NAME_FIELDS if p.get(k)] + ALIASES.get(unit_id, []) + [NAMES.get(unit_id, "")]
        keys = sorted({country_key(n) for n in names if country_key(n)})
        min_zoom = units[MIN_ZOOM_LIKE[unit_id]]["MIN_LABEL"] if unit_id in MIN_ZOOM_LIKE else p["MIN_LABEL"]
        x, y = LABEL_POINT.get(unit_id, (p["LABEL_X"], p["LABEL_Y"]))
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(x, 4), round(y, 4)]},
            "properties": {
                "id": unit_id,
                "name": NAMES.get(unit_id, p["NAME_EN"]),
                "keys": "|".join(keys),
                "population_rank": p["POP_RANK"],
                "min_zoom": min_zoom,
                # Lower sorts first and wins collisions.
                "sort_key": 0 if unit_id in PRIORITY else p["LABELRANK"],
            },
        })
    features.sort(key=lambda f: f["properties"]["id"])
    return {"type": "FeatureCollection", "features": features}


def self_test():
    cases = json.load(open(CASES))
    failed = [c for c in cases if country_key(c["name"]) != c["key"]]
    for c in failed:
        print(f"FAIL {c['name']!r}: {country_key(c['name'])!r} != {c['key']!r}")
    print(f"{len(cases) - len(failed)}/{len(cases)} cases pass")
    return not failed


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", nargs="?", help="ne_50m_admin_0_countries.geojson (v5.1.2)")
    parser.add_argument("--apply", action="store_true", help="write frontend/public/country-labels.geojson")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        sys.exit(0 if self_test() else 1)
    if not args.source:
        parser.error("SOURCE is required unless --self-test")
    collection = build(args.source)
    text = json.dumps(collection, separators=(",", ":"), ensure_ascii=False)
    print(f"{len(collection['features'])} labels, {len(text) / 1024:.0f} KB")
    for f in collection["features"]:
        p = f["properties"]
        if p["id"] in set(MIN_ZOOM_LIKE) | set(NAMES) | set(ALIASES):
            print(f"  {p['id']}: {p['name']!r} min_zoom={p['min_zoom']} sort_key={p['sort_key']} at {f['geometry']['coordinates']}")
    if not args.apply:
        print("Dry run; pass --apply to write", os.path.relpath(OUTPUT, REPO))
        return
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as fh:
        fh.write(text)
    print("Wrote", os.path.relpath(OUTPUT, REPO))


if __name__ == "__main__":
    main()
