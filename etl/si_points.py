#!/usr/bin/env python3
"""
si_points.py — Points for the Smithsonian records (etl/si_objects.json from
scrape_si.py): most NMNH Anthropology and American Indian origins name a county
or a state ("Stanley County, South Dakota"), a reservation or an island, not a
town in cities500. Every record is placed here, the resolver's city points
included (they get the county check below).

Each record's place levels (si_place: country, state → admin1 code, county,
city) are looked up by exact name in GeoNames allCountries
(data/gazetteer/allcountries/allCountries.zip), inside the record's own state
(or its country when the record names no state), in this order:

  1. city text   → a populated place (P), else a reservation, island, ancient
                   site, cave or lake of that name; when the county is a known
                   ADM2 the place must lie in it ("Benton, Modoc County" is not
                   the Benton in Mono County)
  2. county text → an ADM2 (else ADM3) of that name ("Catron County")
  3. state       → its ADM1 feature (the geonameid admin1CodesASCII gives); a
                   state text that is no GeoNames state may be a territory filed
                   as a country (Puerto Rico), a county (Dordogne) or an island or
                   region (Java, Upper Egypt)
  4. otherwise   → no point here: the record names only a country, and the
                   import gives it the country point production already uses

A name counts only with one match (GeoNames rows of one place within 5 km of each
other count as one); a populated place also when it is the most populous at ten
times the next. A record whose state text matches no GeoNames state gets no finer
point (a homonym elsewhere in the country is not risked), unless the state is a
region or county GeoNames knows and the town's name has a single match in the
whole country (Tasiilaq, "Tunu (East Greenland)"), in the record's county when that
is a known ADM2, within REGION_TOWN_KM of the region's point (COUNTY_RADIUS_KM of
a county's).

The label follows the point, so it claims no precision the point lacks: it is
the matched GeoNames feature's name (a record whose city has no match but whose
county has is labelled with the county; "Irian Jaya" → "Papua"), the source's
hedge kept as "?". place_name (the record's own most specific place) is not
changed; the label goes to place_name_normalized. Each point names its GeoNames
id in geocoding_notes.

Writes JSON only. Dry run by default.

Usage (from etl/):
    python3 si_points.py                 # dry run: counts, samples, si_points_review.json
    python3 si_points.py --apply         # writes si_objects_points.json
"""

import argparse
import io
import json
import math
import os
import random
import re
import zipfile
from collections import Counter, defaultdict

from scrape_europeana import GAZETTEER_DIR, Gazetteer
from audit_places import EXTRA_CODES
from scrape_si import HEDGE_PARENS_RE, QUALIFIER_RE, Places, place_key

ETL_DIR = os.path.dirname(os.path.abspath(__file__))
GAZ_DIR = os.path.join(ETL_DIR, "data", "gazetteer")
ALL_COUNTRIES = os.path.join(GAZ_DIR, "allcountries", "allCountries.zip")

# Feature codes a city-level text may name besides a populated place.
SITE_CODES = {"RESV", "ISL", "ISLS", "ISLET", "ATOL", "PEN", "ANS", "RUIN", "CAVE", "LK", "LKS", "RSV", "LGN", "BAY"}
# A state-level text that is no GeoNames state may name an island or a region ("Java", "Upper Egypt");
# not a peninsula or lake of that name (Schwerin, the city, is also a peninsula).
REGION_CODES = {"ISL", "ISLS", "ATOL", "RGN", "RGNE"}
# Places GeoNames files as countries, under the country SI files them under ("Puerto Rico", United States).
# Taiwan and Hong Kong under China (user decision, 2026-10-22): their own point and towns, not
# China's centre point; country_en is left to normalize_origin_points.py like any other point.
TERRITORIES = dict(EXTRA_CODES, AN=["BQ", "CW", "SX"], CN=["TW", "HK"])
COUNTY_CODES = ("ADM2", "ADM3")
# County names with and without their type word: "Catron County" = "Catron", "Provincia de Napo" = "Napo".
COUNTY_WORD_RE = re.compile(
    r"\s+(county|parish|borough|census area|municipality|regional district|district|province|department|municipio)$"
    r"|^(municipio de|provincia de|departamento de|district of|county of)\s+")
SAME_PLACE_KM = 5
COUNTY_RADIUS_KM = 60          # a town without an ADM2 code in GeoNames still counts this close to the county's point
# A town found country-wide for a region-level state lies this close to the region's point: West
# Greenland's towns lie up to 860 km from Kitaa's; Weltevreden in Sulawesi (for Batavia's) and
# Ungava in Ontario (for Labrador's) lie farther.
REGION_TOWN_KM = 1000


def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def county_core(k: str) -> str:
    return COUNTY_WORD_RE.sub("", k).strip()


# NMNH's way of saying the place is near a town: "Bowie, Near", "Jacksonville Near", "Lahuistan (Region Of)".
NEAR_RE = re.compile(r"(?:,\s*|\s+)(?:near|vicinity|area)$|\s*\((?:off|region of|vicinity of)\)$", re.I)


def clean(text: str) -> str:
    return NEAR_RE.sub("", QUALIFIER_RE.sub("", HEDGE_PARENS_RE.sub("", text))).strip()


def city_keys(text: str) -> list:
    """'Hawikku (Hawikuh) Pueblo' → both spellings; 'Zuni Reservation' → also 'Zuni Indian Reservation'."""
    t = clean(text)
    out = [t]
    m = re.match(r"^(.*?)\s*\(([^)]+)\)\s*(.*)$", t)
    if m:
        out = [f"{m.group(1)} {m.group(3)}", f"{m.group(2)} {m.group(3)}"]
    keys = [place_key(o) for o in out if o.strip()]
    keys += [re.sub(r" reservation$", " indian reservation", k) for k in keys if k.endswith(" reservation")]
    return list(dict.fromkeys(keys))


def read_records(path: str):
    with open(path, encoding="utf-8") as f:
        f.readline()
        for line in f:
            line = line.strip().rstrip(",")
            if line and line != "]":
                yield json.loads(line)


def load_admin1_ids() -> dict:
    out = {}
    for line in open(os.path.join(GAZ_DIR, "admin1CodesASCII.txt"), encoding="utf-8"):
        c = line.rstrip("\n").split("\t")
        if len(c) == 4:
            out[c[3]] = (c[0], c[1])             # geonameid → ("MX.06", "Chihuahua"): the English name, not "Estado de Chihuahua"
    return out


def load_features(city_needed: set, county_needed: set, admin1_ids: dict, country_ids: dict):
    """One pass over allCountries, keeping only names some record asks for."""
    cities = defaultdict(list)      # (key, scope) → [(gid, name, fcode, lat, lon, pop, fclass)]; scope "US.NM" or "US"
    counties = defaultdict(list)
    admin1_point, country_point = {}, {}   # "US.NM" / "PR" → (gid, lat, lon)
    with zipfile.ZipFile(ALL_COUNTRIES) as z, z.open("allCountries.txt") as raw:
        for line in io.TextIOWrapper(raw, encoding="utf-8"):
            c = line.split("\t")
            gid, fclass, fcode = c[0], c[6], c[7]
            if gid in admin1_ids and fcode.startswith("ADM1"):
                code, name = admin1_ids[gid]
                admin1_point[code] = (gid, float(c[4]), float(c[5]), name)
                continue
            if gid in country_ids and fclass == "A":
                country_point[country_ids[gid]] = (gid, float(c[4]), float(c[5]))
                continue
            is_city = fclass == "P" or fcode in SITE_CODES or fcode in REGION_CODES
            is_county = fcode in COUNTY_CODES
            if not (is_city or is_county):
                continue
            keys = {place_key(c[1]), place_key(c[2])}
            row = (gid, c[1], fcode, float(c[4]), float(c[5]), int(c[14] or 0), fclass, f"{c[8]}.{c[10]}.{c[11]}")
            scopes = (f"{c[8]}.{c[10]}", c[8])
            if is_city:
                for k in keys & city_needed:
                    for s in scopes:
                        cities[(k, s)].append(row)
            if is_county:
                for k in keys | {county_core(k) for k in keys}:
                    if k in county_needed:
                        for s in scopes:
                            counties[(k, s)].append(row)
    return cities, counties, admin1_point, country_point


def state_texts(state: str) -> list:
    """A state text that is one place: "Sulawesi (Celebes)" → both names; "Arizona or New Mexico" → none."""
    t = HEDGE_PARENS_RE.sub("", state).strip()
    if re.search(r"/|,|;|\bor\b|&|\band\b", t):
        return []
    return city_keys(t)


def pick(cands: list, by_population: bool = True):
    """
    One place: a single match (rows within 5 km merged), or (populated places only)
    the most populous at ten times the next.
    """
    places = []
    for r in sorted(cands, key=lambda r: -r[5]):
        if not any(km((r[3], r[4]), (p[3], p[4])) <= SAME_PLACE_KM for p in places):
            places.append(r)
    if len(places) == 1:
        return places[0], "one match"
    if by_population and len(places) > 1 and places[0][5] > 0 and places[0][5] >= 10 * places[1][5]:
        return places[0], f"most populous of {len(places)}"
    return None, f"{len(places)} matches" if places else "no match"


class Locator:
    def __init__(self, cities, counties, admin1_point, country_point, places: Places):
        self.cities, self.counties = cities, counties
        self.admin1_point, self.country_point, self.places = admin1_point, country_point, places

    def city(self, text: str, scope: str, county=None, by_population: bool = True):
        """A town or site; when the record's county is a known ADM2, it must lie in that county."""
        keys = city_keys(text)
        cands = [r for k in keys for r in self.cities.get((k, scope), [])]
        if county is not None and county[2] == "ADM2":
            cands = [r for r in cands if r[7] == county[7]
                     or (r[7].endswith(".") and km((r[3], r[4]), (county[3], county[4])) <= COUNTY_RADIUS_KM)]
        populated = [r for r in cands if r[6] == "P"]
        if populated:
            return pick(populated, by_population)
        return pick([r for r in cands if r[2] in SITE_CODES], by_population=False)

    def county(self, text: str, scope: str):
        k = place_key(clean(text))
        cands = self.counties.get((k, scope)) or self.counties.get((county_core(k), scope), [])
        adm2 = [r for r in cands if r[2] == "ADM2"]
        return pick(adm2 or cands, by_population=False)

    def state_fallback(self, si: dict):
        """
        A state text that is no GeoNames state: a territory GeoNames files as a country
        ("Puerto Rico" under the United States: also the scope for its towns), a county
        ("Dordogne"), or an island or region ("Java", "Upper Egypt"), each inside the
        record's country and with one match.
        """
        texts = state_texts(si["state"])
        if not texts:
            return None, None, "several states named"
        for t in texts:
            isos = self.places.country(t)
            if len(isos) == 1 and isos[0] in TERRITORIES.get(si["country"], []) and isos[0] in self.country_point:
                gid, lat, lon = self.country_point[isos[0]]
                return (gid, self.places.gaz.country_name(isos[0]), "PCL", lat, lon, 0, "A", ""), isos[0], "territory"
        cc = si["country"]
        row, how = self.county(si["state"], cc)
        if row:
            return row, None, f"county ({how})"
        cands = [r for k in texts for r in self.cities.get((k, cc), []) if r[2] in REGION_CODES]
        row, how = pick(cands, by_population=False)
        if row:
            return row, None, f"island/region ({how})"
        return None, None, "no GeoNames state"

    def locate(self, si: dict) -> tuple:
        """(level, GeoNames row or None, how); the label is the row's GeoNames name."""
        scope = si.get("admin1") or (si["country"] if not si.get("state") else None)
        fallback = None
        if si.get("state") and not si.get("admin1"):
            row, territory, how = self.state_fallback(si)
            fallback = (row, how)
            scope = territory              # towns of Puerto Rico are filed under PR in GeoNames
            # A state GeoNames knows only as a region or county ("Tunu (East Greenland)"): the
            # record's town still counts when its name has a single match in the whole country,
            # inside the record's county when that is a known ADM2 (Jagnaya, Capiz is not the one
            # on Samar), and near the region's point (a homonym far off is not taken; for a county,
            # as near as a town without an ADM2 code must be).
            if row and not territory and si.get("city"):
                county = self.county(si["county"], si["country"])[0] if si.get("county") else None
                town, town_how = self.city(si["city"], si["country"], county, by_population=False)
                radius = COUNTY_RADIUS_KM if row[2] in COUNTY_CODES else REGION_TOWN_KM
                if town and km((town[3], town[4]), (row[3], row[4])) <= radius:
                    return "place", town, f"{town_how} in the country; state {how}"
        tried = []
        county, county_how = self.county(si["county"], scope) if scope and si.get("county") else (None, None)
        if scope and si.get("city"):
            # A county text that resolves to nothing ("Cape Vancouver") may say the town is elsewhere
            # than the most populous one of its name: then only a single match counts.
            row, how = self.city(si["city"], scope, county, by_population=county is not None or not si.get("county"))
            if row:
                return "place", row, how + (" in the record's county" if county is not None and county[2] == "ADM2" else "")
            tried.append(f"city {si['city']}: {how}")
        if county is not None:
            return "county", county, "; ".join([county_how] + tried)
        if county_how:
            tried.append(f"county {si['county']}: {county_how}")
            # The county slot sometimes holds a town or a reservation ("Neah Bay", "Red Lake Reservation").
            row, how = self.city(si["county"], scope)
            if row:
                return "place", row, "; ".join([f"county text as a place ({how})"] + tried)
        if si.get("admin1") in self.admin1_point:
            gid, lat, lon, name = self.admin1_point[si["admin1"]]
            return "state", (gid, name, "ADM1", lat, lon, 0, "A", ""), "; ".join(tried) or "state"
        if fallback:
            row, how = fallback
            if row:
                return "state", row, "; ".join([f"state {how}"] + tried)
            tried.append(f"state {si['state']}: {how}")
        return "country", None, "; ".join(tried)


def parse_args():
    p = argparse.ArgumentParser(description="County, state and place points for si_objects.json")
    p.add_argument("--apply", action="store_true", help="Write si_objects_points.json (default: dry run)")
    p.add_argument("-i", "--input", default=os.path.join(ETL_DIR, "si_objects.json"))
    p.add_argument("-o", "--output", default=os.path.join(ETL_DIR, "si_objects_points.json"))
    p.add_argument("--review", default=os.path.join(ETL_DIR, "si_points_review.json"),
                   help="Random sample of matches per level, for checking by hand")
    p.add_argument("--sample", type=int, default=40, help="Review sample size per level")
    return p.parse_args()


def main():
    args = parse_args()
    city_needed, county_needed = set(), set()
    for r in read_records(args.input):
        si = r.get("si_place")
        if not si:
            continue
        if si.get("city"):
            city_needed.update(city_keys(si["city"]))
        if si.get("county"):
            k = place_key(clean(si["county"]))
            county_needed.update({k, county_core(k)})
            city_needed.update(city_keys(si["county"]))
        if si.get("state") and not si.get("admin1"):
            for k in state_texts(si["state"]):
                city_needed.add(k)
                county_needed.update({k, county_core(k)})
    gaz = Gazetteer(GAZETTEER_DIR)
    country_ids = {}
    for line in open(os.path.join(GAZ_DIR, "countryInfo.txt"), encoding="utf-8"):
        c = line.rstrip("\n").split("\t")
        if not line.startswith("#") and len(c) > 16 and c[16]:
            country_ids[c[16]] = c[0]
    print(f"Looking up {len(city_needed)} city names and {len(county_needed)} county names in allCountries …")
    locator = Locator(*load_features(city_needed, county_needed, load_admin1_ids(), country_ids),
                      Places(gaz, GAZETTEER_DIR))

    stats, why, by_unit = Counter(), Counter(), defaultdict(Counter)
    samples = defaultdict(list)
    # Locate each distinct place once; then the same town or county name in several states of
    # one country gets the state, as production writes "Portland, Oregon" / "Portland, Maine"
    # (sites are grouped by label and country, so "Lincoln County" would merge 15 counties).
    memo = {}
    states_of = defaultdict(set)              # (country, label key) → {admin1}
    for r in read_records(args.input):
        si = r.get("si_place")
        if si:
            key = json.dumps(si, sort_keys=True)
            if key not in memo:
                memo[key] = locator.locate(si)
                level, row, _ = memo[key]
                if row and level in ("place", "county") and si.get("admin1"):
                    states_of[(si["country"], place_key(row[1]))].add(si["admin1"])
    admin1_name = {code: name for code, name in load_admin1_ids().values()}
    homonyms = {k for k, v in states_of.items() if len(v) > 1}
    print(f"{len(homonyms)} place/county names occur in several states of one country; the state is added")
    seen = set()
    out = open(args.output + ".part", "w", encoding="utf-8") if args.apply else None
    if out:
        out.write("[\n")
    n = 0
    random.seed(1)
    for r in read_records(args.input):
        si = r.get("si_place")
        hedge = "?" if (r.get("place_name") or "").endswith("?") else ""
        if si:
            key = json.dumps(si, sort_keys=True)
            first = key not in seen
            seen.add(key)
            level, row, how = memo[key]
            if row:
                r["latitude"], r["longitude"] = row[3], row[4]
                label = row[1]
                if level in ("place", "county") and si.get("admin1") and (si["country"], place_key(label)) in homonyms:
                    label = f"{label}, {admin1_name[si['admin1']]}"
                r["place_name_normalized"] = label + hedge
                r["point_name"] = row[1]                 # the GeoNames name alone (city_en for a place)
                r["geocoding_notes"] += f" | point: GeoNames {row[0]} {row[2]} '{row[1]}' ({level}, {how})"
                if first:                        # one sample per distinct place, not per record
                    samples[level].append({"si_id": r["si_id"], "si_place": si, "label": r["place_name_normalized"],
                                           "geonames": f"https://www.geonames.org/{row[0]}", "name": row[1],
                                           "fcode": row[2], "lat": row[3], "lon": row[4], "how": how})
            else:
                r["point_name"] = None
                r["latitude"] = r["longitude"] = None     # a resolver city point that fails the county check goes too
                r["place_name_normalized"] = r["geocoded_country"] + hedge if r.get("geocoded_country") else None
                if how:
                    r["geocoding_notes"] += f" | no finer point: {how}"
                    why[re.sub(r"^.*?: ", "", how.split("; ")[-1])] += 1
        else:
            level = "none"
        r["point_level"] = level
        stats[level] += 1
        by_unit[r["si_unit"]][level] += 1
        if out:
            out.write((",\n" if n else "") + json.dumps(r, ensure_ascii=False))
        n += 1

    print("\nPoint level of all records:", dict(stats))
    for unit, c in by_unit.items():
        print(f"  {unit}: {dict(c)}")
    print("Why no finer point (last step tried):", why.most_common(10))
    review = {lvl: random.sample(s, min(args.sample, len(s))) for lvl, s in samples.items()}
    json.dump(review, open(args.review, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"Review sample → {args.review}")
    if out:
        out.write("\n]\n")
        out.close()
        os.replace(args.output + ".part", args.output)
        print(f"Wrote {n} records to {args.output}")


if __name__ == "__main__":
    main()
