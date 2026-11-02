#!/usr/bin/env python3
"""
place_unlocated.py — Give a point to published origins that have a place name but no point,
when the place can be found without guessing. Dry run by default; writes a review CSV.

Each row gets a set of context countries, from its own record:
  country    the row's country_en, when it has one
  path       Weltmuseum Wien: the country named in the Geography path the import noted
             ("Ostasien/VR China/Ostchina (hua dong)/Shanghai" → China); the import did not
             know German country names such as "VR China"
  inventory  Berlin State Museums: the countries of the located rows that share the
             inventory prefix ("V C" → Argentina, Chile), each with 2% of them or more

and is placed by the first rule that finds exactly one place:
  country    the label is a country ("Iraq", "Papua Neuguinea", "Egypt possibly") → the
             country's centre point, the commonest point of the rows labelled with it
  site       a site production already has: the same label in a context country, all its
             points within 25 km of each other → that site's label, country and point
  country,   a label "Country, part" ("Peru, North Coast"): the part, by the site and GeoNames
  part       rules inside that country; else the country's centre point, labelled with the
             country, the part as the precise place
  geonames   GeoNames (allCountries): a populated place, ancient site, island, hill or
             administrative area of that name (or alternate name) in a context country,
             every match within 25 km of each other → the most populous one's point. Not
             when a more prominent place of the name lies outside the context (a province
             or a town of 15,000: "Chiriqui" is Panama's, not a Guatemalan hamlet's), and an
             alternate name counts only from seven letters ("Paso" is not Juan José Paso).

Anything else is listed for review (reports/place_unlocated_review.csv): no match, or
matches far apart (Paso, La Toma), or no context. Regions spanning several countries are
left to normalize_origin_points.py; records that name two places to split_origin_places.py.

Rows with review_status = 'verified' are never touched; place_name is never changed. A
placed row gets latitude/longitude, country_en and geocoder_source, and a
"[place-unlocated] <date> …" note with the old label and country; the label changes only
for the country and site rules. Undo: the rows with that note get NULL coordinates again.

Usage (from etl/):
    python3 place_unlocated.py            # dry run: summary + reports, rolled back
    python3 place_unlocated.py --apply    # write; then SELECT refresh_geospatial_views();
"""

import argparse
import csv
import io
import os
import re
import zipfile
from collections import Counter, defaultdict
from datetime import date

from audit_places import COUNTRY_ALIASES, GAZ, REPORTS, get_conn, key, km, strip_tag, tsv
from region_points import region_of

NOTE_TAG = "[place-unlocated]"
NEAR_KM = 25
CONTEXT_SHARE = 0.02
WMW = "Weltmuseum Wien"
SMB = {"Ethnologisches Museum", "Museum für Asiatische Kunst", "Museum für Islamische Kunst",
       "Antikensammlung", "Ägyptisches Museum und Papyrussammlung", "Vorderasiatisches Museum"}
# GeoNames feature classes and codes that can be an origin.
FEATURES = {"P": None, "S": {"ANS", "RUIN", "HSTS", "CSTL", "FT", "MSTY", "TMPL", "PYR", "PYRS", "ARCH", "TMB"},
            "T": {"ISL", "ISLS", "HLL", "HLLS", "MT", "PEN", "VAL", "PLAT"}, "A": {"ADM1", "ADM2"}}
# German country names in the Weltmuseum's Geography paths that GeoNames does not list.
GERMAN = {"vr china": "CN", "papua neuguinea": "PG", "neuguinea": "PG", "turkei": "TR", "agypten": "EG",
          "vereinigte staaten": "US", "usa": "US", "russland": "RU", "suedafrika": "ZA", "sudafrika": "ZA",
          "elfenbeinkuste": "CI", "dr kongo": "CD", "demokratische republik kongo": "CD", "republik kongo": "CG",
          "salomonen": "SB", "marshallinseln": "MH", "osttimor": "TL", "taiwan (republik china)": "TW"}
WMW_PATH = re.compile(r'Geography "([^"]+)"')
HEDGE = re.compile(r"\s*(?:\(\?\)|\?|\bpossibly|\bprobably)\s*$", re.IGNORECASE)
NOT_PLACE = re.compile(r"^(?:n/a|unbekannt|unknown|unbestimmt|-)$", re.IGNORECASE)


def prefix(inventory):
    m = re.match(r"^([IVX]+ [A-Za-z]+)", inventory or "")
    return m.group(1) if m else None


class Context:
    def __init__(self, cur):
        self.code_of = {}
        for f in tsv("countryInfo.txt"):
            self.code_of[key(f[4])] = f[0]
        self.code_of.update({key(k): v for k, v in COUNTRY_ALIASES.items()})
        self.code_of.update(GERMAN)

        cur.execute("""SELECT country_en, COUNT(*) FROM museum_objects
                       WHERE published_at IS NOT NULL AND NULLIF(BTRIM(country_en), '') IS NOT NULL GROUP BY 1""")
        self.spelling = {}
        for country, n in sorted(cur.fetchall(), key=lambda r: -r[1]):
            cc = self.code_of.get(key(country))
            if cc:
                self.spelling.setdefault(cc, country)
            self.code_of.setdefault(key(country), cc or country)

        # Located rows: country centre points and existing sites.
        cur.execute("""SELECT institution_name, inventory_number, country_en,
                              COALESCE(NULLIF(BTRIM(place_name_normalized), ''), NULLIF(BTRIM(city_en), '')),
                              COALESCE(manual_latitude, latitude)::float, COALESCE(manual_longitude, longitude)::float
                       FROM museum_objects
                       WHERE published_at IS NOT NULL AND COALESCE(manual_latitude, latitude) IS NOT NULL""")
        centre = defaultdict(Counter)
        self.sites = defaultdict(Counter)
        by_prefix = defaultdict(Counter)
        for inst, inv, country, label, lat, lon in cur.fetchall():
            cc = self.code_of.get(key(country)) if country else None
            if label and country and key(strip_tag(label)) == key(country):
                centre[cc][(lat, lon)] += 1
            elif label and cc:
                self.sites[key(strip_tag(label))][(strip_tag(label), cc, round(lat, 4), round(lon, 4))] += 1
            if inst in SMB and cc:
                by_prefix[(inst, prefix(inv))][cc] += 1
        self.centre = {cc: pts.most_common(1)[0][0] for cc, pts in centre.items() if cc}
        self.prefix = {}
        for k, ccs in by_prefix.items():
            total = sum(ccs.values())
            self.prefix[k] = {cc for cc, n in ccs.items() if n >= CONTEXT_SHARE * total}

    def country_code(self, name):
        if not name:
            return None
        k = key(HEDGE.sub("", strip_tag(name)))
        cc = self.code_of.get(k)
        return cc if cc and len(cc) == 2 else None

    def context(self, inst, inv, country, notes):
        if country:
            cc = self.country_code(country)
            return ({cc}, "country") if cc else (set(), "country unknown")
        if inst == WMW:
            m = WMW_PATH.search(notes or "")
            if m:
                ccs = {self.country_code(p) for p in m.group(1).split("/")} - {None}
                if ccs:
                    return ccs, "path"
        if inst in SMB:
            ccs = self.prefix.get((inst, prefix(inv)))
            if ccs:
                return set(ccs), "inventory"
        return set(), "none"


def load_geonames(names):
    """key(name) -> [(geonameid, name, lat, lon, cc, pop, fclass, fcode, by_alternate)] for the
    names asked, in every country; one pass over allCountries.zip."""
    found = defaultdict(list)

    def keys(values):
        # key() only for names that could match: plain ASCII names are compared lower-cased.
        out = set()
        for v in values:
            if not v:
                continue
            k = v.lower() if v.isascii() else key(v)
            if k in names:
                out.add(k)
        return out

    with zipfile.ZipFile(os.path.join(GAZ, "allcountries", "allCountries.zip")) as z:
        for line in io.TextIOWrapper(z.open("allCountries.txt"), encoding="utf-8"):
            f = line.rstrip("\n").split("\t")
            if f[6] not in FEATURES:
                continue
            codes = FEATURES[f[6]]
            if codes is not None and f[7] not in codes:
                continue
            primary = keys((f[1], f[2]))
            alternate = keys(f[3].split(",")) - primary
            for n, by_alt in [(n, False) for n in primary] + [(n, True) for n in alternate]:
                found[n].append((f[0], f[1], float(f[4]), float(f[5]), f[8], int(f[14] or 0), f[6], f[7], by_alt))
    return found


def prominent(g):
    return g[7] == "ADM1" or (g[6] == "P" and g[5] >= 15000)


def one_place(points):
    """True when every point lies within NEAR_KM of the first."""
    return all(km(points[0], p) <= NEAR_KM for p in points[1:])


def plan(cur):
    ctx = Context(cur)
    cur.execute("""SELECT id, institution_name, inventory_number, place_name,
                          COALESCE(NULLIF(BTRIM(place_name_normalized), ''), NULLIF(BTRIM(city_en), '')),
                          NULLIF(BTRIM(country_en), ''), geocoding_notes
                   FROM museum_objects
                   WHERE published_at IS NOT NULL AND COALESCE(review_status, '') <> 'verified'
                     AND COALESCE(manual_latitude, latitude) IS NULL
                     AND NULLIF(BTRIM(place_name), '') IS NOT NULL""")
    rows = []
    for oid, inst, inv, raw, label, country, notes in cur.fetchall():
        name = label or raw
        if NOT_PLACE.match(name.strip()) or re.search(r"\s(or|oder)\s", name, re.IGNORECASE) or region_of(name):
            continue
        ccs, why = ctx.context(inst, inv, country, notes)
        rows.append((oid, inst, raw, name, country, ccs, why))

    names = {key(HEDGE.sub("", strip_tag(r[3]))) for r in rows}
    names |= {key(strip_tag(HEDGE.sub("", r[3]).partition(",")[2].strip())) for r in rows if "," in r[3]}
    geonames = load_geonames(names)

    placed, review = [], []
    def resolve(k, ccs):
        """(label or None, country code, lat, lon, rule, source) for a name in the context
        countries, else (None, reason)."""
        sites = [s for s in ctx.sites.get(k, ()) if s[1] in ccs]
        if sites and one_place([(s[2], s[3]) for s in sites]):
            label, scc, lat, lon = max(sites, key=lambda s: ctx.sites[k][s])
            return label, scc, lat, lon, "site", f"production site {label} ({ctx.spelling.get(scc)})"
        found = [g for g in geonames.get(k, ()) if not (g[8] and len(k) < 7)]
        cands = [g for g in found if g[4] in ccs]
        # A prominent place of the name, by any name, outside the candidates: "Garua" is Garoua
        # (Cameroon), not a Nigerian hamlet.
        elsewhere = [g for g in geonames.get(k, ()) if g not in cands and prominent(g)]
        if cands and elsewhere and not any(prominent(g) for g in cands):
            return None, f"a more prominent {elsewhere[0][1]} in {elsewhere[0][4]}"
        if cands and one_place([(g[2], g[3]) for g in cands]):
            g = max(cands, key=lambda g: (g[6] == "P", g[5]))
            return None, g[4], g[2], g[3], "geonames", f"GeoNames {g[0]} {g[1]} ({g[7]}, {g[4]})"
        where = ", ".join(sorted(ctx.spelling.get(c, c) for c in ccs))
        return None, (f"{len(cands)} GeoNames places far apart" if cands else
                      f"{len(sites)} sites far apart" if sites else "not found") + f" in {where}"

    for oid, inst, raw, name, country, ccs, why in rows:
        hedge = "?" if HEDGE.search(name) else ""
        base = HEDGE.sub("", name).strip()
        k = key(strip_tag(base))
        cc = ctx.country_code(base)
        if cc and cc in ctx.centre and (not ccs or cc in ccs or why == "inventory"):
            lat, lon = ctx.centre[cc]
            placed.append((oid, inst, raw, name, ctx.spelling.get(cc, base) + hedge, ctx.spelling.get(cc),
                           lat, lon, "country", f"centre point of {ctx.spelling.get(cc)}", True, None))
            continue
        # "Peru, North Coast": the part after the country inside that country, else the country
        # itself with that part as the precise place ("Guatemala, Mesoamerica": no precise place).
        first, _, rest = base.partition(",")
        fcc = ctx.country_code(first) if rest.strip() else None
        if fcc and fcc in ctx.centre:
            rest = rest.strip()
            r = resolve(key(strip_tag(rest)), {fcc})
            if r[0] is not None or len(r) > 2:
                label, rcc, lat, lon, rule, source = r
                placed.append((oid, inst, raw, name, (label or rest) + hedge, ctx.spelling.get(rcc), lat, lon,
                               rule, source, True, None))
            else:
                lat, lon = ctx.centre[fcc]
                precise = None if region_of(rest) else rest
                placed.append((oid, inst, raw, name, ctx.spelling.get(fcc) + hedge, ctx.spelling.get(fcc), lat, lon,
                               "country", f"centre point of {ctx.spelling.get(fcc)}; {rest} not found", True, precise))
            continue
        if not ccs:
            review.append((oid, inst, raw, name, country, "", f"no context ({why})"))
            continue
        r = resolve(k, ccs)
        if len(r) > 2:
            label, rcc, lat, lon, rule, source = r
            placed.append((oid, inst, raw, name, (label + hedge) if label else None, ctx.spelling.get(rcc),
                           lat, lon, rule, source, label is not None, None))
            continue
        where = ", ".join(sorted(ctx.spelling.get(c, c) for c in ccs))
        review.append((oid, inst, raw, name, country, where, f"{r[1]} ({why})"))
    return placed, review


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="write the changes (default: dry run, rolled back)")
    args = ap.parse_args()
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            placed, review = plan(cur)
            os.makedirs(REPORTS, exist_ok=True)
            with open(os.path.join(REPORTS, "place_unlocated_placed.csv"), "w", newline="", encoding="utf-8") as fh:
                w = csv.writer(fh)
                w.writerow(["id", "institution", "place_name", "label", "new_label", "country", "lat", "lon", "rule", "source"])
                w.writerows(r[:10] for r in placed)
            with open(os.path.join(REPORTS, "place_unlocated_review.csv"), "w", newline="", encoding="utf-8") as fh:
                w = csv.writer(fh)
                w.writerow(["id", "institution", "place_name", "label", "country", "context", "reason"])
                w.writerows(review)
            by_rule = Counter(r[8] for r in placed)
            print(f"placed {len(placed)} objects: {dict(by_rule)}; review {len(review)}")
            for rule in ("country", "site", "geonames"):
                top = Counter((r[3], r[5], r[9]) for r in placed if r[8] == rule).most_common(25)
                print(f"\n== {rule}")
                for (name, country, src), n in top:
                    print(f"  {n:>5}  {name[:34]:<34} {str(country)[:18]:<18} {src[:70]}")
            print("\n== review (largest)")
            for (name, reason), n in Counter((r[3], r[6]) for r in review).most_common(40):
                print(f"  {n:>5}  {name[:34]:<34} {reason[:90]}")

            tag = f"{NOTE_TAG} {date.today().isoformat()}"
            for oid, inst, raw, name, new_label, country, lat, lon, rule, source, relabel, precise in placed:
                cur.execute(
                    f"""UPDATE museum_objects SET
                          geocoding_notes = concat_ws(' | ', NULLIF(geocoding_notes, ''), %s || ' ' || %s
                            || '; was label ' || COALESCE(quote_literal(COALESCE(NULLIF(BTRIM(place_name_normalized), ''), city_en)), 'NULL')
                            || ', country ' || COALESCE(quote_literal(country_en), 'NULL') || ', unlocated'),
                          latitude = %s, longitude = %s, country_en = %s, geocoder_source = %s,
                          place_name_normalized = COALESCE(%s, place_name_normalized),
                          precise_place = COALESCE(NULLIF(BTRIM(precise_place), ''), %s),
                          geocoding_status = 'ok'
                        WHERE id = %s AND COALESCE(manual_latitude, latitude) IS NULL""",
                    (tag, f"{rule}: {source}", lat, lon, country, source, new_label if relabel else None, precise, oid),
                )
        if args.apply:
            conn.commit()
            print("\nCommitted. SELECT refresh_geospatial_views(); to rebuild the map views.")
        else:
            conn.rollback()
            print("\nDry run — rolled back. Reports in", REPORTS)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
