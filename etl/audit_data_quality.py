#!/usr/bin/env python3
"""
audit_data_quality.py — Read-only check of origin places across all collections.
Writes CSVs to etl/reports/dq_*.csv and prints a summary; never writes the DB.

Checks (rows with review_status = 'verified' are left out):
  named_country   the raw place_name names a country ("Peru, North Coast") but the
                  coordinates lie outside it, or country_en is missing or another
                  country while the coordinates are inside it.
  no_country      located (coordinates) but country_en empty and no country named;
                  the nearest GeoNames town within NEAR_KM gives the likely country.
  supranational   a cultural area spanning several countries ("Middle East",
                  "Ottoman Empire") stored as a point — false precision.
  present_day     the site label is an alternate name, in GeoNames, of a town within
                  NEAR_KM whose own name differs ("Pergamon" → Bergama): the
                  present-day name, sourced, for the label policy.
The coordinate checks of audit_places.py (outside_country, swapped, null_island,
at_museum) are run with `python etl/audit_places.py report`.

Usage:
    python etl/audit_data_quality.py
"""

import csv
import json
import math
import os
import re
from collections import Counter, defaultdict

from audit_places import get_conn, key, km, load_gazetteer, tsv, MARGIN_DEG
from build_country_labels import country_key

HERE = os.path.dirname(os.path.abspath(__file__))
REPORTS = os.path.join(HERE, "reports")
LABELS = os.path.join(HERE, "..", "frontend", "public", "country-labels.geojson")
NEAR_KM = 15

# Cultural or historical areas spanning several present-day countries (lower case).
SUPRANATIONAL = {
    "africa", "west africa", "western africa", "east africa", "central africa", "north africa",
    "southern africa", "asia", "central asia", "southeast asia", "east asia", "south asia",
    "europe", "middle east", "near east", "levant", "mediterranean", "mediterranean region",
    "eastern mediterranean", "eastern mediterranean region", "ancient mediterranean",
    "central america", "south america", "mesoamerica", "andes", "andean region", "oceania",
    "melanesia", "polynesia", "micronesia region", "caribbean", "balkans", "caucasus",
    "ottoman empire", "byzantine empire", "roman empire", "persian empire", "islamic world",
    "arabian peninsula", "anatolia or iran", "iran or turkey", "egypt or syria",
}


def effective(lat, lon):
    return (lat, lon) if lat is not None and lon is not None else None


def main():
    os.makedirs(REPORTS, exist_ok=True)
    country_code, _, _, extent, _ = load_gazetteer()
    label_names = {}
    for f in json.load(open(LABELS, encoding="utf-8"))["features"]:
        for k in f["properties"]["keys"].split("|"):
            label_names.setdefault(k, f["properties"]["name"])
    name_to_cc = {}
    for k, name in label_names.items():
        cc = country_code.get(key(name)) or country_code.get(k)
        if cc:
            name_to_cc[name] = cc

    def inside(cc, pt):
        e = extent.get(cc)
        return bool(e) and e[0] - MARGIN_DEG <= pt[0] <= e[1] + MARGIN_DEG and e[2] - MARGIN_DEG <= pt[1] <= e[3] + MARGIN_DEG

    # Towns by 1° cell, for nearest-town lookups; alternate names for the label check.
    cells = defaultdict(list)
    alt_index = defaultdict(list)  # key(alternate name) -> [(lat, lon, name, cc)]
    for f in tsv("cities500.txt"):
        lat, lon, cc = float(f[4]), float(f[5]), f[8]
        cells[(int(math.floor(lat)), int(math.floor(lon)))].append((lat, lon, f[1], cc))
        for alt in set(f[3].split(",")) | {f[2]}:
            if alt and key(alt) != key(f[1]):
                alt_index[key(alt)].append((lat, lon, f[1], cc))

    def nearest(pt):
        best = None
        for dl in (-1, 0, 1):
            for dn in (-1, 0, 1):
                for t in cells.get((int(math.floor(pt[0])) + dl, int(math.floor(pt[1])) + dn), []):
                    d = km(pt, (t[0], t[1]))
                    if best is None or d < best[0]:
                        best = (d, t)
        return best

    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """SELECT institution_name, place_name, place_name_normalized, country_en,
                  ROUND(COALESCE(manual_latitude, latitude)::numeric, 3)::float,
                  ROUND(COALESCE(manual_longitude, longitude)::numeric, 3)::float, COUNT(*)
           FROM museum_objects
           WHERE published_at IS NOT NULL AND COALESCE(review_status, '') <> 'verified'
           GROUP BY 1, 2, 3, 4, 5, 6"""
    )
    rows = cur.fetchall()
    conn.close()

    found = defaultdict(list)
    for inst, raw, label, country, lat, lon, n in rows:
        pt = effective(lat, lon)
        raw = raw or ""
        parts = [p.strip(" ?)").strip() for p in re.split(r"[,(;]", raw) if p.strip(" ?)").strip()]
        named = {label_names[country_key(p)] for p in parts if country_key(p) in label_names}
        have = label_names.get(country_key(country or "")) if country else None
        shown = (label or raw).strip()

        if pt and named:
            named_cc = {name_to_cc.get(c) for c in named} - {None}
            if named_cc and not any(inside(cc, pt) for cc in named_cc):
                found["named_country"].append((n, inst, raw, country, lat, lon, "coordinates outside " + "/".join(sorted(named))))
            elif have not in named:
                found["named_country"].append((n, inst, raw, country, lat, lon, "country_en should be " + "/".join(sorted(named))))
        elif pt and not country:
            near = nearest(pt)
            guess = f"{near[1][2]} ({near[1][3]}), {near[0]:.0f} km" if near and near[0] <= 50 else "no town within 50 km"
            found["no_country"].append((n, inst, raw, country, lat, lon, guess))

        if pt and (key(shown).rstrip("?") in SUPRANATIONAL or key(raw).rstrip("?") in SUPRANATIONAL):
            found["supranational"].append((n, inst, raw, country, lat, lon, shown))

        if pt and label:
            for t in alt_index.get(key(label.rstrip("?").strip()), []):
                if km(pt, (t[0], t[1])) <= NEAR_KM and key(t[2]) != key(label.rstrip("?")):
                    found["present_day"].append((n, inst, raw, country, lat, lon, f"{label} → {t[2]} ({t[3]})"))
                    break

    print("Origin data quality — rows grouped by (institution, place, label, country, point)\n")
    for check in ("named_country", "no_country", "supranational", "present_day"):
        items = sorted(found[check], reverse=True)
        with open(os.path.join(REPORTS, f"dq_{check}.csv"), "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(["artifacts", "institution", "place_name", "country_en", "lat", "lon", "finding"])
            w.writerows(items)
        by_inst = Counter()
        for it in items:
            by_inst[it[1]] += it[0]
        print(f"== {check}: {len(items)} values, {sum(i[0] for i in items)} artifacts  {dict(by_inst.most_common(4))}")
        for it in items[:12]:
            print(f"  {it[0]:>5}  {it[1][:22]:<22} {it[2][:42]:<42} {str(it[3])[:12]:<12} {it[6][:60]}")
        print()


if __name__ == "__main__":
    main()
