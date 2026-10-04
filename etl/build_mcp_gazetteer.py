#!/usr/bin/env python3
"""
build_mcp_gazetteer.py — Build the place-name lookup the MCP server uses to
label each origin with a precision (country / region / city / site).

Reads the GeoNames files in etl/data/gazetteer/ and writes
frontend/lib/mcp/gazetteer.json.gz:

    {"countries": [...], "regions": [...], "cities": [...]}

Each list holds normalized names (see normalize() — must stay identical to
normalizePlaceName() in frontend/lib/mcp/origins.ts). A name found in none of
the lists is treated as a site by the MCP server: in this dataset those are
mostly archaeological sites, sanctuaries and tombs (Dodona, Pergamon, Priene…).

Usage:
    python etl/build_mcp_gazetteer.py
"""

import gzip
import json
import os
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "data", "gazetteer")
OUT = os.path.join(HERE, "..", "frontend", "lib", "mcp", "gazetteer.json.gz")


def normalize(name):
    """NFKD, drop combining marks, lowercase, collapse whitespace."""
    decomposed = unicodedata.normalize("NFKD", name)
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return " ".join(stripped.lower().split())


def read_tsv(filename):
    with open(os.path.join(SRC, filename), encoding="utf-8") as f:
        for line in f:
            if line.startswith("#") or not line.strip():
                continue
            yield line.rstrip("\n").split("\t")


def main():
    countries = {normalize(f[4]) for f in read_tsv("countryInfo.txt") if len(f) > 4}
    # admin1CodesASCII.txt: code, name, asciiname, geonameid
    regions = set()
    for f in read_tsv("admin1CodesASCII.txt"):
        regions.update(normalize(n) for n in f[1:3])
    # cities500.txt: geonameid, name, asciiname, alternatenames, …
    cities = set()
    for f in read_tsv("cities500.txt"):
        cities.update(normalize(n) for n in f[1:3])

    for s in (countries, regions, cities):
        s.discard("")

    data = {"countries": sorted(countries), "regions": sorted(regions), "cities": sorted(cities)}
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    # mtime=0 keeps the output byte-identical across rebuilds.
    with open(OUT, "wb") as f:
        f.write(gzip.compress(payload, mtime=0))
    print(f"countries={len(countries)} regions={len(regions)} cities={len(cities)} -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")


if __name__ == "__main__":
    main()
