#!/usr/bin/env python3
"""
split_origin_places.py — Records that name two or more possible origins ("Egypt or
Syria", "Costa Rica or Panama", "Nishapur or Samarqand, Iran or present-day
Uzbekistan") get one point per named place in museum_object_origins (migration
019). The map draws the object on the arc from each of them; the record keeps its
own label, which the panel shows on every arc (METHODOLOGY.md, "Origins").

A part resolves to
  country  the country's centre point: the commonest point of the records labelled
           with the country itself, as audit_points.py finds it
  region   a region in region_points.py ("Central Asia", "North Africa")
  town     a GeoNames town (cities500) with that name, alone in the country the
           label names for it ("Nishapur … Iran") or, without one, the only town of
           that name with 15,000 people or more (in the record's own country, when it
           has one); labelled and placed as production already labels a site of that
           name within 25 km. An alternate GeoNames name counts only for such a site,
           and a name that is also a state or province only for a town inside it
           ("Wyoming or Montana" names no town).
A record is split only when every part resolves; the others are listed for review
with the parts that did not. Nothing is guessed: no fuzzy names, no first-place pick.

Split: unlocated records, and records whose point is a country centre or region
point (no place of its own). A record with a point of its own (the source's or a
reviewer's) keeps it and is listed as kept. Rows with review_status = 'verified'
are never touched, and museum_objects is never changed: place_name, the label and
the record's point stay as they are.

Usage:
    python etl/split_origin_places.py            # dry run: report, nothing written
    python etl/split_origin_places.py --apply    # write; then SELECT refresh_geospatial_views();

Undo: DELETE FROM museum_object_origins WHERE source LIKE '%[split-origins]%';
Reports: etl/reports/split_origin_places_{split,review,kept}.csv
"""

import argparse
import csv
import os
import re
from collections import Counter, defaultdict
from datetime import date

from audit_places import COUNTRY_ALIASES, GAZ, REPORTS, get_conn, key, km, strip_tag, tsv
from region_points import REGIONS, region_of

NOTE_TAG = "[split-origins]"
TOWN_MIN_POP = 15000
SITE_NEAR_KM = 25

# "or" between two places; a list's last item is ", or X".
OR = re.compile(r"\s+or\s+", re.IGNORECASE)
WHOLE_HEDGE = re.compile(r"^(?:probably|possibly)\s+", re.IGNORECASE)
TRAILING_HEDGE = re.compile(r"\s*(?:\(\?\)|\?)\s*$")
# "Iran (or Turkey?)" → "Iran or Turkey?"; "India (Golconda or Bidar)" → "India, Golconda or Bidar".
PAREN_OR = re.compile(r"^(?P<a>[^()]+?)\s*\(\s*or\s+(?P<b>[^()]+)\)$", re.IGNORECASE)
PAREN_LIST = re.compile(r"^(?P<a>[^()]+?)\s*\((?P<b>[^()]+\sor\s[^()]+)\)$", re.IGNORECASE)
DIRECTION = re.compile(r"^(?:north|south|east|west|central|upper|lower)(?:ern)?(?:\s*-?\s*(?:north|south|east|west|central)(?:ern)?)?\s+", re.IGNORECASE)
LEADING = re.compile(r"^(?:the|present[- ]day|modern)\s+", re.IGNORECASE)


def clean_part(text):
    """'present-day Uzbekistan?' → ('Uzbekistan', True)."""
    text = text.strip().strip(",").strip()
    hedged = bool(TRAILING_HEDGE.search(text))
    text = TRAILING_HEDGE.sub("", text).strip()
    while LEADING.match(text):
        text = LEADING.sub("", text, count=1).strip()
    return text, hedged


def parse(label):
    """The places a label names as alternatives: (parts, context, reason). parts is a
    list of (text, hedged, context) — context, a country the label names for that part.
    reason is set when the label is not one this script can split."""
    text = label.strip()
    hedged = bool(WHOLE_HEDGE.match(text))
    text = WHOLE_HEDGE.sub("", text)
    if TRAILING_HEDGE.search(text):
        hedged = True
        text = TRAILING_HEDGE.sub("", text)
    m = PAREN_OR.match(text)
    if m:
        text = f"{m['a']} or {m['b']}"
    m = PAREN_LIST.match(text)
    if m:
        text = f"{m['a']}, {m['b']}"
    if "(" in text or ")" in text:
        return [], [], "brackets"
    segments = [s.strip() for s in text.split(",") if s.strip()]

    # "Ecuador, Peru, Bolivia, Chile, or Argentina": every segment is an alternative.
    if len(segments) > 2 and re.match(r"^or\s", segments[-1], re.IGNORECASE):
        items = [re.sub(r"^or\s+", "", s, flags=re.IGNORECASE) for s in segments]
        if any(OR.search(s) for s in items):
            return [], [], "list with a nested or"
        return [(*clean_part(s), None) for s in items], [], None if len(items) > 1 else "one place"

    with_or = [i for i, s in enumerate(segments) if OR.search(s)]
    if len(with_or) == 1:
        i = with_or[0]
        alts = OR.split(segments[i])
        context = segments[:i] + segments[i + 1:]
        return [(*clean_part(a), None) for a in alts], context, None
    if len(with_or) == 2 and len(segments) == 2:
        # "Nishapur or Samarqand, Iran or present-day Uzbekistan": paired.
        places, countries = OR.split(segments[0]), OR.split(segments[1])
        if len(places) != len(countries):
            return [], [], "unpaired alternatives"
        return [(*clean_part(p), clean_part(c)[0]) for p, c in zip(places, countries)], [], None
    return [], [], "no single list of alternatives"


class Places:
    def __init__(self, cur):
        # Production's country spellings, keyed through the GeoNames code.
        code_of = {}
        for f in tsv("countryInfo.txt"):
            code_of[key(f[4])] = f[0]
        code_of.update({key(k): v for k, v in COUNTRY_ALIASES.items()})
        self.code_of = code_of

        cur.execute(
            """SELECT country_en, COUNT(*) FROM museum_objects
               WHERE published_at IS NOT NULL AND NULLIF(BTRIM(country_en), '') IS NOT NULL GROUP BY 1"""
        )
        spelling = {}  # code -> production spelling (the commonest)
        self.country_by_key = {}
        for country, n in sorted(cur.fetchall(), key=lambda r: -r[1]):
            self.country_by_key.setdefault(key(country), country)
            code = code_of.get(key(country))
            if code:
                spelling.setdefault(code, country)
        self.spelling = spelling

        # Centre points: the commonest point of the rows labelled with their country.
        cur.execute(
            """SELECT country_en, COALESCE(place_name_normalized, place_name),
                      COALESCE(manual_latitude, latitude), COALESCE(manual_longitude, longitude), COUNT(*)
               FROM museum_objects
               WHERE published_at IS NOT NULL AND COALESCE(manual_latitude, latitude) IS NOT NULL
                 AND COALESCE(manual_longitude, longitude) IS NOT NULL AND NULLIF(BTRIM(country_en), '') IS NOT NULL
               GROUP BY 1, 2, 3, 4"""
        )
        points = defaultdict(Counter)
        self.sites = defaultdict(Counter)  # key(label) -> {(label, country, lat, lon): n}
        for country, label, lat, lon, n in cur.fetchall():
            if label and key(strip_tag(label)) == key(country):
                points[country][(lat, lon)] += n
            if label:
                self.sites[key(strip_tag(label))][(strip_tag(label), country, lat, lon)] += n
        self.centre = {c: pts.most_common(1)[0][0] for c, pts in points.items()}
        # A country can have more than one such point (a Wikidata and a GeoNames one):
        # any point five or more records name the country at is a centre, not a place.
        self.centre_points = {p for pts in points.values() for p, n in pts.items() if n >= 5}
        self.centre_points |= set(self.centre.values()) | {(r[0], r[1]) for r in REGIONS.values()}

        # key(name) -> [(geonameid, name, lat, lon, cc, pop, by an alternate name, admin-1 code)]
        self.towns = defaultdict(list)
        for f in tsv("cities500.txt"):
            town = (f[0], f[1], float(f[4]), float(f[5]), f[8], int(f[14] or 0))
            names = {key(f[1]), key(f[2])}
            for n in names:
                self.towns[n].append((*town, False, f"{f[8]}.{f[10]}"))
            for n in {key(a) for a in f[3].split(",") if a} - names:
                self.towns[n].append((*town, True, f"{f[8]}.{f[10]}"))
        # Admin-1 names ("Wyoming", "Punjab", "Isfahan") -> their codes.
        self.admin1 = defaultdict(set)
        for f in tsv("admin1CodesASCII.txt"):
            for n in f[1:3]:
                self.admin1[key(n)].add(f[0])

    def country(self, text):
        """Production's spelling of a country name, else None."""
        k = key(text)
        if k in self.country_by_key:
            return self.country_by_key[k]
        code = self.code_of.get(k)
        return self.spelling.get(code) if code else None

    def context_country(self, text):
        """A country a label names as context: "Iran", "present-day Uzbekistan", and,
        for finding a town in it, "Northern India"."""
        text = clean_part(text)[0]
        return self.country(text) or self.country(DIRECTION.sub("", text))

    def resolve(self, text, context, prefer=None):
        """(label, country, lat, lon, source) or (None, reason). prefer: the record's
        own country, which settles a choice between towns of the same name."""
        country = self.country(text)
        if country:
            if country not in self.centre:
                return None, f"no centre point for {country}"
            lat, lon = self.centre[country]
            return (country, country, lat, lon, f"country centre ({country})"), None
        region = region_of(text)
        if region:
            label, lat, lon, source, rcountry = region
            if context and rcountry and rcountry != context:
                return None, f"region {label} is not in {context}"
            return (label, rcountry, lat, lon, f"region_points: {source}"), None

        def site(town):
            # The site production already has for this town: its label and commonest point.
            gid, name, lat, lon, cc = town[:5]
            country = self.spelling.get(cc)
            near = [(n, s) for k in {key(text), key(name)} for s, n in self.sites.get(k, {}).items()
                    if s[1] == country and km((lat, lon), (s[2], s[3])) <= SITE_NEAR_KM]
            return max(near)[1] if near else None

        # An alternate name ("Samarqand" for Samarkand, "Nishapur" for Neyshabur) counts
        # only for a town production already has a site at: alternate names also hold
        # homonyms ("Jazira" for Aş Şuwayrah in Iraq).
        found = [t for t in {t[0]: t for t in self.towns.get(key(text), [])}.values() if not t[6] or site(t)]
        # A name that is also a state or province is a town only inside it: Isfahan in
        # Isfahan province, not Wyoming in Michigan or Montana in Bulgaria for "Wyoming
        # or Montana".
        if key(text) in self.admin1:
            found = [t for t in found if t[7] in self.admin1[key(text)]]
        # Without a country named for it, a town lies in the record's own country, when
        # the record has one.
        if not context and prefer:
            found = [t for t in found if t[4] == self.code_of.get(key(prefer))]
        if context:
            cc = self.code_of.get(key(context))
            found = [t for t in found if t[4] == cc]
            if len(found) > 1:
                found = [t for t in found if t[5] >= TOWN_MIN_POP]
        else:
            found = [t for t in found if t[5] >= TOWN_MIN_POP]
        if len(found) != 1:
            return None, ("no GeoNames town" if not found else f"{len(found)} GeoNames towns") + (f" in {context}" if context else "")
        gid, name, lat, lon, cc = found[0][:5]
        country = self.spelling.get(cc)
        if not country:
            return None, f"GeoNames country {cc} not used in production"
        known = site(found[0])
        if known:
            label, _, slat, slon = known
            return (label, country, slat, slon, f"GeoNames {gid}, production's {label} point"), None
        return (name, country, lat, lon, f"GeoNames {gid}"), None


def plan(cur):
    places = Places(cur)
    cur.execute(
        """SELECT id, institution_name, source_link, place_name, COALESCE(place_name_normalized, place_name),
                  country_en, COALESCE(manual_latitude, latitude), COALESCE(manual_longitude, longitude),
                  COALESCE(review_status, '') = 'verified'
           FROM museum_objects
           WHERE published_at IS NOT NULL AND COALESCE(place_name_normalized, place_name) ~* '\\mor\\M'
           ORDER BY id"""
    )
    split, review, kept = [], [], []
    for oid, inst, link, raw, label, country, lat, lon, verified in cur.fetchall():
        row = {"id": oid, "institution": inst, "source_link": link, "place_name": raw, "label": label,
               "country_en": country or "", "lat": lat, "lon": lon}
        if verified:
            kept.append({**row, "reason": "verified"})
            continue
        if region_of(label) or region_of(raw):
            kept.append({**row, "reason": "one region (region_points.py)"})
            continue
        parts, context, reason = parse(label)
        if reason:
            review.append({**row, "reason": reason, "parts": ""})
            continue
        # "Egypt, Iran or Syria": a list, when the leading segments are countries or
        # regions as the alternatives are.
        def is_area(text):
            text = clean_part(text)[0]
            return bool(places.country(text) or region_of(text))
        if context and all(is_area(c) for c in context) and all(is_area(p[0]) for p in parts) \
                and label.find(context[0]) < label.find(parts[0][0]):
            parts = [(*clean_part(c), None) for c in context] + parts
            context = []
        # Context: a country the parts lie in ("India, Punjab or Rajasthan"), or a region
        # around them ("El Salvador or Guatemala, Mesoamerica"), which adds nothing.
        countries = {places.context_country(c) for c in context}
        unknown = [c for c in context if not places.context_country(c) and not region_of(clean_part(c)[0])]
        if unknown:
            review.append({**row, "reason": f"context not a country or region: {', '.join(unknown)}", "parts": ""})
            continue
        countries = sorted(c for c in countries if c)
        if len(countries) > 1:
            review.append({**row, "reason": f"several countries as context: {', '.join(countries)}", "parts": ""})
            continue
        shared = countries[0] if countries else None
        resolved, missing = [], []
        for text, part_hedged, part_country in parts:
            ctx = places.context_country(part_country) if part_country else shared
            if part_country and not ctx:
                missing.append(f"{text} ({part_country}: not a country)")
                continue
            found, why = places.resolve(text, ctx, prefer=country)
            if not found:
                missing.append(f"{text} ({why})")
                continue
            plabel, pcountry, plat, plon, source = found
            if ctx and pcountry and pcountry != ctx:
                missing.append(f"{text} ({plabel} is in {pcountry}, not {ctx})")
                continue
            hedged = part_hedged or bool(WHOLE_HEDGE.match(label.strip())) or bool(TRAILING_HEDGE.search(label))
            if hedged and not plabel.endswith("?"):
                plabel += "?"
            resolved.append((plabel, pcountry, plat, plon, source))
        described = " | ".join(f"{p[0]} [{p[1] or 'no country'}] {p[2]:.4f},{p[3]:.4f} ({p[4]})" for p in resolved)
        if missing:
            review.append({**row, "reason": "unresolved: " + "; ".join(missing), "parts": described})
            continue
        if len({key(strip_tag(p[0])) for p in resolved}) < 2:
            review.append({**row, "reason": "parts resolve to one place", "parts": described})
            continue
        if lat is not None and lon is not None and (lat, lon) not in places.centre_points:
            kept.append({**row, "reason": "own point (not a country centre or region point)", "parts": described})
            continue
        split.append({**row, "parts": described, "origins": resolved,
                      "on": "unlocated" if lat is None or lon is None else "centre point"})
    return split, review, kept


def write_reports(split, review, kept):
    os.makedirs(REPORTS, exist_ok=True)
    for name, rows, cols in (
        ("split", split, ["id", "institution", "source_link", "label", "country_en", "on", "parts"]),
        ("review", review, ["id", "institution", "source_link", "label", "country_en", "lat", "lon", "reason", "parts"]),
        ("kept", kept, ["id", "institution", "source_link", "label", "country_en", "lat", "lon", "reason", "parts"]),
    ):
        path = os.path.join(REPORTS, f"split_origin_places_{name}.csv")
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
            w.writeheader()
            w.writerows(rows)


def summary(title, rows, field):
    print(f"\n== {title}: {len(rows)} objects")
    groups = Counter((r["label"], r.get(field, "")) for r in rows)
    for (label, detail), n in groups.most_common():
        print(f"  {n:5d}  {label}  →  {detail}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="write museum_object_origins (default: dry run)")
    args = ap.parse_args()

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            split, review, kept = plan(cur)
            summary("split", split, "parts")
            summary("listed for review", review, "reason")
            summary("kept as they are", kept, "reason")
            write_reports(split, review, kept)
            n_points = sum(len(r["origins"]) for r in split)
            print(f"\nsplit {len(split)} objects into {n_points} points "
                  f"({sum(r['on'] == 'unlocated' for r in split)} unlocated today); "
                  f"review {len(review)}; kept {len(kept)}. Reports in {REPORTS}/split_origin_places_*.csv")
            if not args.apply:
                print("Dry run: nothing written. Run with --apply to write.")
                return
            tag = f"{NOTE_TAG} {date.today().isoformat()}"
            ids = [r["id"] for r in split]
            # Earlier runs' rows for these records go; rows from other sources stay.
            cur.execute("DELETE FROM museum_object_origins WHERE object_id = ANY(%s) AND source LIKE %s",
                        (ids, f"%{NOTE_TAG}%"))
            for r in split:
                for ordinal, (label, country, lat, lon, source) in enumerate(r["origins"], start=1):
                    cur.execute(
                        """INSERT INTO museum_object_origins (object_id, ordinal, label, country_en, latitude, longitude, source)
                           VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                        (r["id"], ordinal, label, country, lat, lon, f"{source} {tag}"),
                    )
        conn.commit()
        print(f"Wrote {n_points} points. Next: SELECT refresh_geospatial_views();")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
