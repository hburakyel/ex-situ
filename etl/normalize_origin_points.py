#!/usr/bin/env python3
"""
normalize_origin_points.py — Apply the findings of audit_data_quality.py that
follow a fixed rule (METHODOLOGY.md, "Origins"):

  outside  the coordinates lie outside the country the source names ("Peru, North
           Coast" placed in Canada, "Gallipoli, Turkey" in Italy) → coordinates
           removed; country_en = the named country when the source names exactly
           one; geocoding_status 'ambiguous' for review.
  country  the coordinates lie inside the named country but country_en is empty
           or another country → country_en = the named country.
  region   a region spanning several countries ("Middle East", "Polynesien",
           "Caucasus"), stored as a point or unlocated → the region's point and
           English label from region_points.py, no country, origin_type
           'cultural_area' (one site per region in every collection).
  area     any other cultural area stored as a point (continents, empires, "Egypt
           or Syria") → no coordinates, no country, origin_type 'cultural_area',
           geocoding_status 'ambiguous'.

Reported by the audit but not changed here: no_country (a country inferred from
the nearest town would carry a wrong geocode further) and present_day names.

Rows with review_status = 'verified' are never touched; a manual coordinate is never
changed, though UN usage still sets its country; place_name is never changed. Each changed row gets an
"[origin-audit] <date> …" note in geocoding_notes with the old values.

Usage:
    python etl/normalize_origin_points.py           # dry run: changes, rolled back
    python etl/normalize_origin_points.py --apply   # write; then SELECT refresh_geospatial_views();
"""

import argparse
import json
import os
import sys
from collections import Counter, defaultdict
from datetime import date

from audit_data_quality import SOURCE_PLACE_SQL, Classifier, effective
from audit_places import get_conn
from region_points import WHOLE, region_of

NOTE_TAG = "[origin-audit]"

# Occupation is not recorded as sovereignty (METHODOLOGY.md, "Country labels";
# UN Security Council 242, 497, 2334, GA 68/262, ICJ 2004/2024): a point in the
# West Bank including East Jerusalem or in Gaza lies in Palestine, in the Golan
# Heights in Syria, in Crimea in Ukraine. A point in Western Sahara recorded as
# Morocco contradicts it either way and is removed for review. A point in the
# former princely state of Jammu and Kashmir, whose status the Security Council
# left to be settled (resolution 47, 1948), lies in Kashmir, not in India,
# Pakistan or China, the states that administer its parts.
UN = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "un_territories.json"), encoding="utf-8"))


def _in_ring(lon, lat, ring):
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def _in(geom, lat, lon):
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    return any(_in_ring(lon, lat, p[0]) and not any(_in_ring(lon, lat, h) for h in p[1:]) for p in polys)


def un_country(lat, lon, country, label=None):
    """For a point in an occupied territory, UN usage settles the country:
    ("country", X) to record X, ("keep", X) when it is already right — either way
    the record skips the other checks, which would read a source's "Israël" or
    "Morocco" as the country — ("outside", "Morocco") for Western Sahara points
    recorded as Morocco. None for points elsewhere."""

    def settle(c):
        return ("keep", c) if country == c else ("country", c)

    # Jerusalem: a record that names only the city carries its generic point,
    # which cannot tell East from West. Such records are listed under Palestine:
    # the historic city, the Old City, lies in East Jerusalem, occupied since
    # 1967, whose annexation the Security Council declared null and void
    # (resolution 478, 1980). Points inside the Old City walls or east of them
    # (Temple Mount, Holy Sepulchre, Mount of Olives, Gethsemane, Kidron Valley)
    # lie in East Jerusalem as well. Other points in the city are left as
    # recorded. The box ends north of Bethlehem (31.70), a West Bank city of its
    # own, which the Palestine polygon below decides.
    if 31.74 < lat < 31.88 and 35.13 < lon < 35.30:
        name = (label or "").strip().rstrip("?").strip().lower()
        old_city = 31.7735 < lat < 31.7820 and 35.2265 < lon < 35.2375
        east_of_old_city = 31.765 < lat < 31.80 and lon >= 35.2375
        if name == "jerusalem" or old_city or east_of_old_city:
            return settle("Palestine")
        return ("keep", country)
    if _in(UN["Palestine"], lat, lon):
        return settle("Palestine")
    if 32.2 < lat < 37.1 and 72.5 < lon < 80.4 and _in(UN["Kashmir"], lat, lon):
        return settle("Kashmir")
    # Golan Heights; the country condition keeps northern Jordan (Umm Qais) out.
    if country in ("Israel", "Syria", None, "") and 32.55 < lat < 33.35 and lon > 35.62:
        return settle("Syria")
    # Crimea; lon < 36.62 keeps Russia's Taman peninsula, across the Kerch strait, out.
    if country in ("Russia", "Ukraine", None, "") and 44.3 < lat < 46.25 and 32.4 < lon < 36.62:
        return settle("Ukraine")
    if lat < 27.67 and lon < -8.67 and country in ("Morocco", "Western Sahara"):
        return ("outside", "Morocco") if country == "Morocco" else ("keep", country)
    return None

# Checked by hand (2026-10-15, every "outside" finding): the rule would be wrong
# for these place_name values, mostly because the point is right.
SKIP = {
    "Cook Islands, Cook Islands",  # point in the Cook Islands; GeoNames' town extent is too small
    "Niger (Fluss)",               # the Niger river, not the country; left for review
    "Sbaita, Palestine",           # Shivta in the Negev; the source uses the historical region name
    "Herat, Iran",                 # Herat (Afghanistan); a historical Khurasan attribution
    "Laos",                        # country point near the Mekong border
    "Jordan",                      # country point near the Saudi border
    "Lago de Güija (Guatemala)",   # the lake lies on the Guatemala–El Salvador border
    "Costa Rica, Burica Peninsula",  # the peninsula is shared with Panama
    "Puerto González Víquez, Costa Rica, Burica Peninsula",
    "Kailahun (Liberia)",          # Kailahun is in Sierra Leone; source and point disagree — for review
    "Benin",                       # Weltmuseum "Nigeria/Benin": the Benin Kingdom, Benin City (2026-10-28)
}
SKIP_PREFIXES = (
    "Republic of the Congo or Cabinda",        # Chiloango river, on the border
    "Northwest Territories and Nunavut, Canada",  # Melville Island; beyond GeoNames' town extent
)
COUNTRY = {
    "Bahrain (Swat)": "Pakistan",  # Bahrain, a town in the Swat valley; the point is right
    "Faras (Sudan)": "Sudan",      # Faras, on the Sudanese side of the border; the point is right
    "Malaysia": "Malaysia",        # country point at sea between Malaya and Borneo
    "New Caledonia": "New Caledonia",  # point in New Caledonia (outlying islands beyond GeoNames' town extent)
}
AREA = {
    "Guinea (Region)",             # the Guinea coast region, not the country Guinea
}


def note(*columns):
    today = date.today().isoformat()
    parts = " || ' ' || ".join(f"'{c} was ' || COALESCE(quote_literal({c}::text), 'NULL')" for c in columns)
    return f"geocoding_notes = concat_ws(' | ', NULLIF(geocoding_notes, ''), '{NOTE_TAG} {today} ' || {parts})"


def plan(cur, classifier):
    """{(action, value): [ids]} and example place names per action."""
    cur.execute(
        """SELECT id, place_name, place_name_normalized, country_en, latitude, longitude,
                  """ + SOURCE_PLACE_SQL + """
           FROM museum_objects
           WHERE published_at IS NOT NULL AND COALESCE(review_status, '') <> 'verified'
             AND manual_latitude IS NULL AND manual_longitude IS NULL
             AND latitude IS NOT NULL AND longitude IS NOT NULL"""
    )
    actions = defaultdict(list)
    examples = defaultdict(Counter)
    cache = {}

    def region(oid, raw, label, country, lat, lon, area=False):
        """A row naming a region gets its point. A row the collection filed under a country
        moves only when the region is a cultural area (area), lies in that country, or is WHOLE."""
        r = region_of(label) if (label or "").strip() else region_of(raw)
        if r and (country or "").strip() and not (area or r[4] == country or r[0].rstrip("?") in WHOLE):
            return None
        at = lat is not None and abs(float(lat) - r[1]) < 1e-3 and abs(float(lon) - r[2]) < 1e-3 if r else False
        if r and not ((label, country) == (r[0], r[4]) and at):
            actions[("region", r)].append(oid)
            examples["region"][f"{raw} → {r[0]}"] += 1
        return r

    for oid, raw, label, country, lat, lon, source in cur.fetchall():
        raw = raw or ""
        if region(oid, raw, label, country, lat, lon):
            continue
        un = un_country(lat, lon, country, label or raw)
        if un:
            if un[0] != "keep":
                actions[un].append(oid)
                examples[un[0]][f"{raw} → {un[1]} (UN usage)"] += 1
            continue
        if raw in SKIP or raw.startswith(SKIP_PREFIXES):
            continue
        if raw in AREA:
            if region(oid, raw, label, country, lat, lon, area=True):
                continue
            actions[("area", None)].append(oid)
            examples["area"][raw] += 1
            continue
        if raw in COUNTRY:
            if country != COUNTRY[raw]:
                actions[("country", COUNTRY[raw])].append(oid)
                examples["country"][raw] += 1
            continue
        k = (raw, label, country, round(lat, 3), round(lon, 3), source)
        if k not in cache:
            cache[k] = classifier.classify(raw, label, country, effective(*k[3:5]), source)
        found = {check: (finding, named) for check, finding, named in cache[k]}
        if "supranational" in found:
            if region(oid, raw, label, country, lat, lon, area=True):
                continue
            actions[("area", None)].append(oid)
            examples["area"][raw] += 1
        elif "named_country" in found:
            finding, named = found["named_country"]
            only = next(iter(named)) if len(named) == 1 else None
            if finding.startswith("coordinates outside"):
                actions[("outside", only)].append(oid)
                examples["outside"][raw] += 1
            elif only:
                actions[("country", only)].append(oid)
                examples["country"][raw] += 1

    # A hand-set point is kept, but UN usage still settles its country (Kashmir, Palestine).
    cur.execute(
        """SELECT id, place_name, place_name_normalized, country_en, manual_latitude, manual_longitude
           FROM museum_objects
           WHERE published_at IS NOT NULL AND COALESCE(review_status, '') <> 'verified'
             AND manual_latitude IS NOT NULL AND manual_longitude IS NOT NULL"""
    )
    for oid, raw, label, country, lat, lon in cur.fetchall():
        un = un_country(float(lat), float(lon), country, label or raw)
        if un and un[0] == "country":
            actions[un].append(oid)
            examples["country"][f"{raw} → {un[1]} (UN usage, hand-set point)"] += 1

    # Unlocated rows that name a region.
    cur.execute(
        """SELECT id, place_name, place_name_normalized, country_en FROM museum_objects
           WHERE published_at IS NOT NULL AND COALESCE(review_status, '') <> 'verified'
             AND manual_latitude IS NULL AND manual_longitude IS NULL
             AND (latitude IS NULL OR longitude IS NULL)"""
    )
    for oid, raw, label, country in cur.fetchall():
        region(oid, raw or "", label, country, None, None)
    return actions, examples


def apply(cur, actions):
    for (action, value), ids in actions.items():
        if action == "outside":
            cur.execute(
                f"""UPDATE museum_objects SET {note('latitude', 'longitude', 'country_en')},
                      latitude = NULL, longitude = NULL, country_en = COALESCE(%s, country_en),
                      geocoding_status = 'ambiguous'
                    WHERE id = ANY(%s)""",
                (value, ids),
            )
        elif action == "country":
            cur.execute(
                f"UPDATE museum_objects SET {note('country_en')}, country_en = %s WHERE id = ANY(%s)",
                (value, ids),
            )
        elif action == "region":
            label, lat, lon, source, country = value
            cur.execute(
                f"""UPDATE museum_objects SET {note('latitude', 'longitude', 'country_en', 'place_name_normalized')},
                      latitude = %s, longitude = %s, country_en = %s, place_name_normalized = %s,
                      origin_type = 'cultural_area', geocoding_status = 'ok', geocoder_source = %s
                    WHERE id = ANY(%s)""",
                (lat, lon, country, label, source, ids),
            )
        elif action == "area":
            cur.execute(
                # A label that names the row's country (an import labels a place it could not
                # locate with its country: "Caucasus" → "Russia") gives way to the area's own name.
                f"""UPDATE museum_objects SET {note('latitude', 'longitude', 'country_en', 'place_name_normalized')},
                      place_name_normalized = CASE
                        WHEN rtrim(place_name_normalized, CHR(63)) = country_en THEN place_name
                        ELSE place_name_normalized END,
                      latitude = NULL, longitude = NULL, country_en = NULL,
                      origin_type = 'cultural_area', geocoding_status = 'ambiguous'
                    WHERE id = ANY(%s)""",
                (ids,),
            )


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="write the changes (default: dry run, rolled back)")
    args = parser.parse_args()

    classifier = Classifier()
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            actions, examples = plan(cur, classifier)
            totals = Counter()
            for (action, _), ids in actions.items():
                totals[action] += len(ids)
            for action, title in (("region", "region → the region's point"),
                                  ("outside", "coordinates outside the named country → removed"),
                                  ("country", "country_en from the named country"),
                                  ("area", "cultural area → unlocated")):
                print(f"== {title}: {totals[action]} artifacts")
                for name, n in examples[action].most_common(10):
                    print(f"  {n:>5}  {name[:70]}")
            apply(cur, actions)
        if args.apply:
            conn.commit()
            print("\nCommitted. SELECT refresh_geospatial_views(); to rebuild the map views.")
        else:
            conn.rollback()
            print("\nDry run — rolled back. Re-run with --apply to write.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
