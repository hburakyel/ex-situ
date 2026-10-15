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
  area     a cultural area spanning several countries stored as a point
           ("Middle East", "Polynesien", "Caucasus") → no coordinates, no
           country, origin_type 'cultural_area', geocoding_status 'ambiguous'.

Reported by the audit but not changed here: no_country (a country inferred from
the nearest town would carry a wrong geocode further) and present_day names.

Rows with review_status = 'verified' or a manual coordinate are never touched;
place_name is never changed. Each changed row gets an
"[origin-audit] <date> …" note in geocoding_notes with the old values.

Usage:
    python etl/normalize_origin_points.py           # dry run: changes, rolled back
    python etl/normalize_origin_points.py --apply   # write; then SELECT refresh_geospatial_views();
"""

import argparse
import sys
from collections import Counter, defaultdict
from datetime import date

from audit_data_quality import Classifier, effective
from audit_places import get_conn

NOTE_TAG = "[origin-audit]"

# Checked by hand (2026-10-15, every "outside" finding): the rule would be wrong
# for these place_name values, mostly because the point is right.
SKIP = {
    "Cook Islands, Cook Islands",  # point in the Cook Islands; GeoNames' town extent is too small
    "New Caledonia",               # likewise (outlying islands)
    "Niger (Fluss)",               # the Niger river, not the country; left for review
    "Sbaita, Palestine",           # Shivta in the Negev; the source uses the historical region name
    "Herat, Iran",                 # Herat (Afghanistan); a historical Khurasan attribution
    "Laos",                        # country point near the Mekong border
    "Jordan",                      # country point near the Saudi border
    "Lago de Güija (Guatemala)",   # the lake lies on the Guatemala–El Salvador border
    "Costa Rica, Burica Peninsula",  # the peninsula is shared with Panama
    "Puerto González Víquez, Costa Rica, Burica Peninsula",
    "Kailahun (Liberia)",          # Kailahun is in Sierra Leone; source and point disagree — for review
}
SKIP_PREFIXES = (
    "Republic of the Congo or Cabinda",        # Chiloango river, on the border
    "Northwest Territories and Nunavut, Canada",  # Melville Island; beyond GeoNames' town extent
)
COUNTRY = {
    "Bahrain (Swat)": "Pakistan",  # Bahrain, a town in the Swat valley; the point is right
    "Faras (Sudan)": "Sudan",      # Faras, on the Sudanese side of the border; the point is right
    "Malaysia": "Malaysia",        # country point at sea between Malaya and Borneo
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
        """SELECT id, place_name, place_name_normalized, country_en, latitude, longitude
           FROM museum_objects
           WHERE published_at IS NOT NULL AND COALESCE(review_status, '') <> 'verified'
             AND manual_latitude IS NULL AND manual_longitude IS NULL
             AND latitude IS NOT NULL AND longitude IS NOT NULL"""
    )
    actions = defaultdict(list)
    examples = defaultdict(Counter)
    cache = {}
    for oid, raw, label, country, lat, lon in cur.fetchall():
        raw = raw or ""
        if raw in SKIP or raw.startswith(SKIP_PREFIXES):
            continue
        if raw in AREA:
            actions[("area", None)].append(oid)
            examples["area"][raw] += 1
            continue
        if raw in COUNTRY:
            if country != COUNTRY[raw]:
                actions[("country", COUNTRY[raw])].append(oid)
                examples["country"][raw] += 1
            continue
        k = (raw, label, country, round(lat, 3), round(lon, 3))
        if k not in cache:
            cache[k] = classifier.classify(raw, label, country, effective(*k[3:]))
        found = {check: (finding, named) for check, finding, named in cache[k]}
        if "supranational" in found:
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
        elif action == "area":
            cur.execute(
                f"""UPDATE museum_objects SET {note('latitude', 'longitude', 'country_en')},
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
            for action, title in (("outside", "coordinates outside the named country → removed"),
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
