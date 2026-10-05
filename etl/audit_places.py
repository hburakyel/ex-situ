#!/usr/bin/env python3
"""
audit_places.py — Check stored place names and coordinates against the raw
source and the GeoNames files in etl/data/gazetteer/.

Names (fixable):
  place_name_normalized is only allowed to *clean* place_name. It is wrong when
  it names a different place — e.g. an old fuzzy match turned "Lagos" into
  "Laos" and "Borno" into "Borneo". A label is reported as wrong when:
    - it is a country name different from the row's country_en, or
    - the raw place_name is a real place in that country (GeoNames town within
      NEAR_KM of the objects, or an admin-1 region of that country) and the
      label is not the same place.
  Fix: the label becomes the cleaned raw name (same rules as
  fill_place_name_normalized.py). place_name is never changed.

Coordinates (flag only — never invented or moved):
  outside_country  outside the country's extent (GeoNames towns + MARGIN_DEG)
  swapped          lat/lon swapped would fall inside the country
  null_island      exactly 0, 0
  at_museum        identical to the holding museum's coordinates
  Flagged rows get geocoding_status = 'ambiguous', a [place-audit] note and
  review_status = 'pending'. Rows with review_status = 'verified' are skipped.

Usage:
    python etl/audit_places.py report              # CSVs in etl/reports/, no DB writes
    python etl/audit_places.py apply --dry-run     # transaction + counts, rolled back
    python etl/audit_places.py apply
"""

import argparse
import csv
import math
import os
import unicodedata
from collections import defaultdict

from fill_place_name_normalized import normalize_display
from normalize_place_labels import classify, english_countries

HERE = os.path.dirname(os.path.abspath(__file__))
GAZ = os.path.join(HERE, "data", "gazetteer")
REPORTS = os.path.join(HERE, "reports")
NEAR_KM = 60
MARGIN_DEG = 1.5
NOTE_TAG = "[place-audit]"

# country_en values that differ from GeoNames countryInfo names.
COUNTRY_ALIASES = {
    "united states of america": "US", "democratic republic of the congo": "CD", "republic of the congo": "CG",
    "ivory coast": "CI", "côte d'ivoire": "CI", "czechia": "CZ", "the netherlands": "NL", "russia": "RU",
    "turkish republic of northern cyprus": "CY", "northern cyprus": "CY", "palestine": "PS",
    "east timor": "TL", "timor-leste": "TL", "eswatini": "SZ", "north macedonia": "MK", "macedonia": "MK",
    "burma": "MM", "vatican city": "VA", "micronesia": "FM", "cape verde": "CV", "south korea": "KR",
    "north korea": "KP", "laos": "LA", "syria": "SY", "iran": "IR", "vietnam": "VN", "taiwan": "TW",
    "bolivia": "BO", "venezuela": "VE", "tanzania": "TZ", "moldova": "MD", "brunei": "BN",
    "netherlands": "NL", "the gambia": "GM", "czech republic": "CZ",
}
# Territories GeoNames files separately that country_en records under the parent state.
EXTRA_CODES = {
    "FR": ["GF", "GP", "MQ", "RE", "YT", "NC", "PF", "PM", "WF", "BL", "MF"],
    "NL": ["AW", "CW", "SX", "BQ"], "DK": ["GL", "FO"], "US": ["PR", "GU", "VI", "AS", "MP"],
    "GB": ["GI", "FK", "BM", "KY", "VG", "TC", "MS", "SH", "PN", "IO"],
}
GENERIC_WORDS = {"region", "state", "province", "district", "city", "area", "island", "islands", "river"}
CLEAN_COUNTRIES = None


def key(value):
    decomposed = unicodedata.normalize("NFKD", value or "")
    return " ".join("".join(c for c in decomposed if not unicodedata.category(c).startswith("M")).lower().split())


def km(a, b):
    p = math.pi / 180
    h = math.sin((b[0] - a[0]) * p / 2) ** 2 + math.cos(a[0] * p) * math.cos(b[0] * p) * math.sin((b[1] - a[1]) * p / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(min(1, h)))


def tsv(name):
    with open(os.path.join(GAZ, name), encoding="utf-8") as f:
        for line in f:
            if line.strip() and not line.startswith("#"):
                yield line.rstrip("\n").split("\t")


def load_gazetteer():
    country_code = {}  # key(name) -> ISO2
    for f in tsv("countryInfo.txt"):
        country_code[key(f[4])] = f[0]
    country_code.update(COUNTRY_ALIASES)
    country_names = set(country_code)

    towns = defaultdict(list)  # (key(name), cc) -> [(lat, lon)]
    extent = {}  # cc -> [minlat, maxlat, minlon, maxlon]
    for f in tsv("cities500.txt"):
        lat, lon, cc = float(f[4]), float(f[5]), f[8]
        for n in {f[1], f[2]}:
            towns[(key(n), cc)].append((lat, lon))
        e = extent.setdefault(cc, [lat, lat, lon, lon])
        e[0], e[1], e[2], e[3] = min(e[0], lat), max(e[1], lat), min(e[2], lon), max(e[3], lon)

    regions = set()  # (key(name), cc); also without a trailing type word ("Borno State" -> "borno")
    region_words = {"state", "region", "province", "governorate", "district", "prefecture", "oblast", "department", "county"}
    for f in tsv("admin1CodesASCII.txt"):
        cc = f[0].split(".")[0]
        for n in f[1:3]:
            k = key(n)
            regions.add((k, cc))
            words = k.split()
            if len(words) > 1 and words[-1] in region_words:
                regions.add((" ".join(words[:-1]), cc))
    return country_code, country_names, towns, extent, regions


def strip_tag(name):
    """'Kano (State)' -> 'Kano', 'Olympia?' -> 'Olympia' — for gazetteer lookups only."""
    base = name.split("(")[0] if "(" in name else name
    return base.strip().rstrip("?").strip()


def get_conn():
    import psycopg2
    from dotenv import load_dotenv

    load_dotenv(dotenv_path=os.path.join(HERE, "..", "backend", ".env"))
    return psycopg2.connect(
        host=os.environ.get("DATABASE_HOST", "127.0.0.1"), port=int(os.environ.get("DATABASE_PORT", 5432)),
        dbname=os.environ.get("DATABASE_NAME", ""), user=os.environ.get("DATABASE_USERNAME", ""),
        password=os.environ.get("DATABASE_PASSWORD", ""),
    )


def audit_names(cur, gaz):
    country_code, country_names, towns, _, regions = gaz
    cur.execute(
        """
        SELECT place_name, place_name_normalized, country_en, COUNT(*),
               AVG(COALESCE(manual_latitude, latitude)), AVG(COALESCE(manual_longitude, longitude))
        FROM museum_objects
        WHERE published_at IS NOT NULL
          AND NULLIF(BTRIM(place_name_normalized), '') IS NOT NULL AND NULLIF(BTRIM(place_name), '') IS NOT NULL
        GROUP BY 1, 2, 3
        """
    )
    global CLEAN_COUNTRIES
    CLEAN_COUNTRIES = CLEAN_COUNTRIES or english_countries()
    rows = cur.fetchall()
    # English/alternate town names (e.g. "Cologne" for Köln) for the labels we need to check.
    wanted = {key(strip_tag(r[1])) for r in rows}
    alt_towns = defaultdict(list)
    for f in tsv("cities500.txt"):
        for alt in f[3].split(","):
            k = key(alt)
            if k in wanted:
                alt_towns[(k, f[8])].append((float(f[4]), float(f[5])))

    def drop_generic(k):
        return " ".join(w for w in k.split() if w not in GENERIC_WORDS)

    out = []
    for raw, label, country, n, lat, lon in rows:
        raw_clean = normalize_display(raw, country)
        if key(strip_tag(label)) == key(strip_tag(raw_clean)):
            continue
        # "Lindi (Region)" vs "Lindi Region": same place, different spelling.
        if drop_generic(key(strip_tag(label))) == drop_generic(key(strip_tag(raw_clean).replace("(", " ").replace(")", " "))) \
                or drop_generic(key(label.replace("(", " ").replace(")", " "))) == drop_generic(key(raw_clean.replace("(", " ").replace(")", " "))):
            continue
        cc = country_code.get(key(country))
        reasons = []
        label_base, raw_base = key(strip_tag(label)), key(strip_tag(raw_clean))
        if label_base in country_names and country and label_base != key(country) and country_code.get(label_base) != cc:
            reasons.append(f"label is the country '{label}', but country_en is {country}")
        raw_is_place = False
        if cc and lat is not None:
            near = [p for p in towns.get((raw_base, cc), []) if km(p, (lat, lon)) <= NEAR_KM]
            if near:
                raw_is_place = True
                reasons.append(f"raw '{raw}' is a town in {country} {round(km(near[0], (lat, lon)))} km from the objects")
            elif (raw_base, cc) in regions:
                raw_is_place = True
                reasons.append(f"raw '{raw}' is a region of {country}")
        label_here = cc and lat is not None and (
            (label_base, cc) in regions
            or any(km(p, (lat, lon)) <= NEAR_KM for p in towns.get((label_base, cc), []) + alt_towns.get((label_base, cc), []))
        )
        if raw_is_place and label_here:
            continue  # both are real places here (e.g. an English exonym) — not an error
        if not reasons or (not raw_is_place and not reasons[0].startswith("label is the country")):
            continue
        proposed, *_ = classify(raw_clean, country, CLEAN_COUNTRIES)  # same tag rules as normalize_place_labels.py
        out.append({
            "place_name": raw, "current_label": label, "proposed_label": proposed, "country_en": country or "",
            "objects": n, "lat": round(lat, 4) if lat is not None else "", "lon": round(lon, 4) if lon is not None else "",
            "reason": "; ".join(reasons),
        })
    return sorted(out, key=lambda r: -r["objects"])


def audit_coords(cur, gaz):
    country_code, _, _, extent, _ = gaz
    _, _, towns, _, _ = gaz
    cur.execute(
        """
        SELECT country_en, ROUND(COALESCE(manual_latitude, latitude)::numeric, 4) AS lat,
               ROUND(COALESCE(manual_longitude, longitude)::numeric, 4) AS lon,
               ROUND(institution_latitude::numeric, 4), ROUND(institution_longitude::numeric, 4),
               institution_name, place_name, COUNT(*)
        FROM museum_objects
        WHERE published_at IS NOT NULL AND COALESCE(manual_latitude, latitude) IS NOT NULL
        GROUP BY 1, 2, 3, 4, 5, 6, 7
        """
    )
    out, unmapped = [], defaultdict(int)
    for country, lat, lon, ilat, ilon, inst, raw, n in cur.fetchall():
        lat, lon = float(lat), float(lon)
        issue, cc = None, None
        if lat == 0 and lon == 0:
            issue = "null_island"
        elif ilat is not None and lat == float(ilat) and lon == float(ilon):
            issue = "at_museum"
        elif country:
            cc = country_code.get(key(country))
            boxes = [extent[c] for c in [cc] + EXTRA_CODES.get(cc, []) if c in extent] if cc else []
            if not boxes:
                unmapped[country] += n
                continue

            def inside(la, lo):
                for e in boxes:
                    # GeoNames towns are sparse near the poles: only check longitude there.
                    lat_ok = e[0] - MARGIN_DEG <= la <= e[1] + MARGIN_DEG or (abs(la) > 60 and abs(la) <= 90 and (la > 0) == (e[1] > 0))
                    if lat_ok and e[2] - MARGIN_DEG <= lo <= e[3] + MARGIN_DEG:
                        return True
                return False

            if not inside(lat, lon):
                issue = "swapped" if inside(lon, lat) else "outside_country"
        if not issue:
            continue
        fix = None
        if issue in ("outside_country", "swapped") and cc and raw:
            # Same name inside the recorded country, unique (all hits within 25 km) → GeoNames coordinates.
            name = key(strip_tag(normalize_display(raw, country)))
            hits = towns.get((name, cc), [])
            if hits and all(km(h, hits[0]) <= 25 for h in hits):
                fix = hits[0]
        out.append({"issue": issue, "country_en": country or "", "place_name": raw or "", "lat": lat, "lon": lon,
                    "objects": n, "museum": inst,
                    "fix_lat": fix[0] if fix else "", "fix_lon": fix[1] if fix else "",
                    "action": "set manual coords from GeoNames" if fix else "flag only"})
    return sorted(out, key=lambda r: (r["issue"], -r["objects"])), unmapped


def write_csv(name, rows):
    os.makedirs(REPORTS, exist_ok=True)
    path = os.path.join(REPORTS, name)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else ["none"])
        w.writeheader()
        w.writerows(rows)
    return path


def run(args):
    gaz = load_gazetteer()
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            names = audit_names(cur, gaz)
            coords, unmapped = audit_coords(cur, gaz)
            print(f"Wrong labels: {len(names)} ({sum(r['objects'] for r in names)} objects) → {write_csv('place_audit_names.csv', names)}")
            by_issue = defaultdict(lambda: [0, 0])
            for r in coords:
                by_issue[r["issue"]][0] += 1
                by_issue[r["issue"]][1] += r["objects"]
            print(f"Coordinate issues → {write_csv('place_audit_coords.csv', coords)}")
            for issue, (groups, objs) in sorted(by_issue.items()):
                print(f"  {issue:<16} {groups:>5} groups  {objs:>6} objects")
            fixable = [r for r in coords if r["fix_lat"] != ""]
            print(f"  → {len(fixable)} groups ({sum(r['objects'] for r in fixable)} objects) have a unique GeoNames match in the right country")
            if unmapped:
                print(f"  (not checked: {sum(unmapped.values())} objects whose country_en has no GeoNames match: "
                      f"{', '.join(sorted(unmapped, key=lambda c: -unmapped[c])[:6])})")
            if args.command == "report":
                return

            fixed = flagged = moved = 0
            for r in names:
                cur.execute(
                    f"""
                    UPDATE museum_objects SET place_name_normalized = %s,
                      geocoding_notes = CASE WHEN COALESCE(geocoding_notes,'') LIKE '%%{NOTE_TAG}%%' THEN geocoding_notes
                        ELSE concat_ws(' | ', NULLIF(geocoding_notes,''), %s) END,
                      review_status = 'pending'
                    WHERE place_name = %s AND place_name_normalized = %s AND country_en IS NOT DISTINCT FROM %s
                      AND published_at IS NOT NULL AND COALESCE(review_status,'') <> 'verified'
                    """,
                    (r["proposed_label"], f"{NOTE_TAG} label '{r['current_label']}' → '{r['proposed_label']}': {r['reason']}",
                     r["place_name"], r["current_label"], r["country_en"] or None),
                )
                fixed += cur.rowcount
            for r in coords:
                cur.execute(
                    f"""
                    UPDATE museum_objects SET
                      geocoding_status = CASE WHEN geocoding_status = 'disputed' THEN geocoding_status ELSE 'ambiguous' END,
                      geocoding_notes = CASE WHEN COALESCE(geocoding_notes,'') LIKE '%%{NOTE_TAG}%%' THEN geocoding_notes
                        ELSE concat_ws(' | ', NULLIF(geocoding_notes,''), %s) END,
                      review_status = 'pending'
                    WHERE published_at IS NOT NULL AND COALESCE(review_status,'') <> 'verified'
                      AND country_en IS NOT DISTINCT FROM %s AND institution_name = %s
                      AND place_name IS NOT DISTINCT FROM %s
                      AND ROUND(COALESCE(manual_latitude, latitude)::numeric, 4) = %s
                      AND ROUND(COALESCE(manual_longitude, longitude)::numeric, 4) = %s
                    """,
                    (f"{NOTE_TAG} coordinates: {r['issue']}" + (f"; set to GeoNames match in {r['country_en']} "
                     f"({r['fix_lat']}, {r['fix_lon']}); original latitude/longitude kept" if r["fix_lat"] != "" else "; not moved"),
                     r["country_en"] or None, r["museum"], r["place_name"] or None, r["lat"], r["lon"]),
                )
                flagged += cur.rowcount
                if r["fix_lat"] != "":
                    cur.execute(
                        """
                        UPDATE museum_objects SET manual_latitude = %s, manual_longitude = %s,
                          geocoding_status = CASE WHEN geocoding_status = 'disputed' THEN geocoding_status ELSE NULL END
                        WHERE published_at IS NOT NULL AND COALESCE(review_status,'') <> 'verified'
                          AND country_en IS NOT DISTINCT FROM %s AND institution_name = %s
                          AND place_name IS NOT DISTINCT FROM %s
                          AND ROUND(COALESCE(manual_latitude, latitude)::numeric, 4) = %s
                          AND ROUND(COALESCE(manual_longitude, longitude)::numeric, 4) = %s
                        """,
                        (r["fix_lat"], r["fix_lon"], r["country_en"] or None, r["museum"], r["place_name"] or None, r["lat"], r["lon"]),
                    )
                    moved += cur.rowcount
            print(f"\nLabels corrected on {fixed} rows; coordinate issues flagged on {flagged} rows, "
                  f"of which {moved} got GeoNames coordinates in manual_latitude/longitude (originals kept).")
            if args.dry_run:
                conn.rollback()
                print("Dry run — rolled back, nothing written.")
            else:
                conn.commit()
                print("Committed. Restart Strapi to rebuild the map views.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("report", help="write CSVs to etl/reports/, no DB writes")
    a = sub.add_parser("apply", help="correct wrong labels, flag coordinate issues")
    a.add_argument("--dry-run", action="store_true")
    run(parser.parse_args())


if __name__ == "__main__":
    main()
