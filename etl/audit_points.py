#!/usr/bin/env python3
"""
audit_points.py — Read-only checks of the points the map draws, for review by hand.
Writes CSVs to etl/reports/points_*.csv and prints a summary; never writes the DB.

These are the after-import checks listed in CLAUDE.md ("Adding a collection") that
audit_places.py and audit_data_quality.py don't make. Points are
COALESCE(manual_latitude, latitude), rounded to 3 decimals, published rows only; a
`verified` column counts rows with review_status = 'verified' (scripts never touch those).

  centre       a label other than the country sits on the country's centre point (the
               commonest point of the rows labelled with the country's own name):
               "Tokyo" on Japan's centre. Hedged and multi-place labels are expected there.
  other_country  the nearest GeoNames town (within OTHER_KM) is in another country than
               country_en, and no town of country_en is within OWN_KM: "Malaysia" at sea
               off Indonesia, US Virgin Islands under "United States". Border sites show up too.
  far_from_town  the label is a GeoNames town name of country_en, but every town of that name
               is more than FAR_KM away ("Papeete" in the Tuamotus). GeoNames homonyms
               (a county seat named like a village) give false hits: check by hand.
  homonym      one label in one collection at points more than HOMONYM_KM apart ("Tokyo" also
               on Japan's centre). Distinct same-name towns (Rochester NY / MN) are often
               right: Rijksmuseum US places were decided per record.
  shared_point one point carries SHARED_LABELS or more labels (besides the country's own).
  europe       an Egyptian, Near-Eastern, Islamic or Asian collection located in Europe.
  remote       no GeoNames town within REMOTE_KM: islands, deserts, at sea, or a wrong sign
               (country-level rows on a centre point are left out). The point with its signs
               flipped (and the longitude brought back into ±180) is shown when it lands in
               country_en or the row has no country: "Cohani" at 15.87, 68.82 (Arabian Sea)
               → -15.87, -68.82 (Lake Titicaca).

Usage (from etl/):
    python3 audit_points.py
"""

import csv
import math
import os
from collections import Counter, defaultdict

from audit_places import get_conn, key, km, load_gazetteer, strip_tag, tsv

HERE = os.path.dirname(os.path.abspath(__file__))
REPORTS = os.path.join(HERE, "reports")
OTHER_KM, OWN_KM = 30, 15
FAR_KM = 25
HOMONYM_KM = 100
SHARED_LABELS = 5
REMOTE_KM = 100

NEAR_EAST_ASIA = {
    "Ägyptisches Museum und Papyrussammlung", "Vorderasiatisches Museum", "Museum für Islamische Kunst",
    "Museum für Asiatische Kunst", "Museum of Far Eastern Antiquities", "Chester Beatty",
    "The Museum of Mediterranean and Near Eastern Antiquities", "East Asian Collections in Slovenia",
}
# Countries in or next to the Europe box that these collections hold objects from.
EUROPE_EXPECTED = {"Greece", "Italy", "Cyprus", "Turkey", "Spain", "Malta", "Morocco", "Algeria", "Tunisia"}


class Towns:
    """GeoNames towns (cities500) on a 1° grid, for nearest-town lookups."""

    def __init__(self):
        self.grid = defaultdict(list)
        for f in tsv("cities500.txt"):
            lat, lon = float(f[4]), float(f[5])
            self.grid[(math.floor(lat), math.floor(lon))].append((lat, lon, f[8], f[1]))

    def nearest(self, lat, lon, cc=None, within=REMOTE_KM):
        best = None
        cells = math.ceil(within / 100) + 1
        for i in range(math.floor(lat) - cells, math.floor(lat) + cells + 1):
            for j in range(math.floor(lon) - cells, math.floor(lon) + cells + 1):
                for t in self.grid.get((i, ((j + 180) % 360) - 180), ()):
                    if cc and t[2] != cc:
                        continue
                    d = km((lat, lon), (t[0], t[1]))
                    if d <= within and (best is None or d < best[0]):
                        best = (d, t)
        return best


def wrap(lon):
    return round(((lon + 180) % 360) - 180, 3)


def main():
    os.makedirs(REPORTS, exist_ok=True)
    country_code, _, towns, _, regions = load_gazetteer()
    grid = Towns()

    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """SELECT institution_name, NULLIF(BTRIM(place_name_normalized), ''), country_en,
                  ROUND(COALESCE(manual_latitude, latitude)::numeric, 3)::float,
                  ROUND(COALESCE(manual_longitude, longitude)::numeric, 3)::float,
                  COUNT(*), COUNT(*) FILTER (WHERE review_status = 'verified'),
                  (array_agg(place_name ORDER BY id))[1]
           FROM museum_objects
           WHERE published_at IS NOT NULL AND COALESCE(manual_latitude, latitude) IS NOT NULL
           GROUP BY 1, 2, 3, 4, 5"""
    )
    rows = cur.fetchall()
    conn.close()

    def cc_of(country):
        return country_code.get(key(country)) if country else None

    def base(label):
        return key(strip_tag(label or ""))

    found = defaultdict(list)
    header = ["objects", "verified", "institution", "label", "country_en", "lat", "lon", "sample_place_name", "finding"]

    # centre: the commonest point of the rows labelled with the country itself
    country_points = defaultdict(Counter)
    for inst, label, country, lat, lon, n, ver, raw in rows:
        if country and base(label or raw) == key(country):
            country_points[country][(lat, lon)] += n
    centre = {c: pts.most_common(1)[0][0] for c, pts in country_points.items()}
    for inst, label, country, lat, lon, n, ver, raw in rows:
        if label and centre.get(country) == (lat, lon) and base(label) != key(country):
            found["centre"].append((n, ver, inst, label, country, lat, lon, raw, f"on {country}'s centre point"))

    nearest = {}
    for inst, label, country, lat, lon, n, ver, raw in rows:
        p = (lat, lon)
        if p not in nearest:
            nearest[p] = grid.nearest(lat, lon) if abs(lat) <= 90 and abs(lon) <= 180 else None
        near, cc = nearest[p], cc_of(country)

        # other_country
        if cc and near and near[0] <= OTHER_KM and near[1][2] != cc and not grid.nearest(lat, lon, cc, OWN_KM):
            found["other_country"].append((n, ver, inst, label, country, lat, lon, raw,
                                           f"nearest town {near[1][3]} ({near[1][2]}) {near[0]:.0f} km"))

        # far_from_town
        k = base(label)
        if cc and k and k != key(country) and (k, cc) not in regions and (k, cc) in towns:
            d = min(km(p, t) for t in towns[(k, cc)])
            if d > FAR_KM:
                found["far_from_town"].append((n, ver, inst, label, country, lat, lon, raw,
                                               f"{d:.0f} km from the nearest of {len(towns[(k, cc)])} GeoNames '{label}'"))

        # europe
        if inst in NEAR_EAST_ASIA and 35 <= lat <= 72 and -11 <= lon <= 29.5 and country not in EUROPE_EXPECTED:
            found["europe"].append((n, ver, inst, label, country, lat, lon, raw, "located in Europe"))

        # remote, with the flipped-sign point as a hint; country-level rows sit on a centre point by design
        if near is None and not (country and (base(label or raw) == key(country) or centre.get(country) == p)):
            hint = ""
            for flat, flon in ((-lat, -lon), (lat, -lon), (-lat, lon), (lat, wrap(lon))):
                if (flat, flon) == (lat, lon) or abs(flat) > 90:
                    continue
                alt = grid.nearest(flat, wrap(flon), within=25)
                if alt and (not cc or alt[1][2] == cc):
                    hint = f"; at {flat}, {wrap(flon)}: {alt[1][3]} ({alt[1][2]}) {alt[0]:.0f} km"
                    break
            what = "out of range" if abs(lat) > 90 or abs(lon) > 180 else f"no town within {REMOTE_KM} km"
            found["remote"].append((n, ver, inst, label, country, lat, lon, raw, what + hint))

    # homonym
    by_label = defaultdict(list)
    for r in rows:
        if r[1] and base(r[1]) != key(r[2] or ""):
            by_label[(r[0], key(r[1]))].append(r)
    for (inst, _), rs in by_label.items():
        best = (0, None, None)
        for i in range(len(rs)):
            for j in range(i + 1, len(rs)):
                d = km((rs[i][3], rs[i][4]), (rs[j][3], rs[j][4]))
                if d > best[0]:
                    best = (d, rs[i], rs[j])
        if best[0] > HOMONYM_KM:
            a, b = sorted(best[1:], key=lambda r: -r[5])
            found["homonym"].append((sum(r[5] for r in rs), sum(r[6] for r in rs), inst, rs[0][1], b[2], b[3], b[4], b[7],
                                     f"{best[0]:.0f} km from {a[3]}, {a[4]} ({a[2]}, {a[5]} objects); {len(rs)} points"))

    # shared_point
    by_point = defaultdict(list)
    for r in rows:
        if r[1] and base(r[1]) != key(r[2] or ""):
            by_point[(r[3], r[4])].append(r)
    for (lat, lon), rs in by_point.items():
        labels = {base(r[1]) for r in rs}
        if len(labels) >= SHARED_LABELS:
            top = sorted(rs, key=lambda r: -r[5])
            centre_of = next((c for c, p in centre.items() if p == (lat, lon)), "")
            found["shared_point"].append((sum(r[5] for r in rs), sum(r[6] for r in rs), top[0][2], f"{len(labels)} labels",
                                          centre_of, lat, lon, "",
                                          "; ".join(f"{r[1]} x{r[5]}" for r in top[:8])))

    print("Map points — published rows grouped by (institution, label, country, point)\n")
    for check in ("centre", "other_country", "far_from_town", "homonym", "shared_point", "europe", "remote"):
        items = sorted(found[check], key=lambda r: -r[0])
        with open(os.path.join(REPORTS, f"points_{check}.csv"), "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(header)
            w.writerows(items)
        print(f"== {check}: {len(items)} groups, {sum(i[0] for i in items)} objects")
        for it in items[:10]:
            print(f"  {it[0]:>5}  {it[2][:22]:<22} {str(it[3] or it[7])[:30]:<30} {str(it[4])[:14]:<14} {it[8][:70]}")
        print()


if __name__ == "__main__":
    main()
