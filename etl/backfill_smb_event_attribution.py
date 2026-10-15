#!/usr/bin/env python3
"""
backfill_smb_event_attribution.py — Give SMB museum_objects rows that have no
coordinates the findspot / production place museum-digital records today,
using the event-type-aware selection in smb_event_selection.py instead of the
original scrapers' object_events[0] positional pick.

Many SMB rows were scraped (2023) with only a country or "N/A" as origin and
no coordinates, while museum-digital now has a precise event place, e.g.
Museum für Islamische Kunst "Ta 1148" (museum-digital 132255): stored as
"Israel", no lat/lon; today a "Gefunden" event at Khirbat al-Minya.

Data rules (CLAUDE.md, METHODOLOGY.md):
  - place_name is raw source data. This script only replaces it with the raw
    place name museum-digital gives today for the selected event (a re-read of
    the source, not a normalization). The old value is kept in geocoding_notes.
  - Coordinates come only from the source event; never invented. A row is
    written only when the selected event has a real (non 0,0) coordinate and
    its place is not a whole country (museum-digital gives "Irak" the
    country's centre point: false precision).
  - Rows with review_status = 'verified', rows with manual coordinates and
    rows that already have coordinates are never written.
  - The modern country is read from the GeoNames gazetteer (cities500): the
    country of a town within 5 km of the findspot, else of every town within
    25 km (60 km where there is none closer). If the row already
    names a country (country_en, or a place_name that is a country) and the
    findspot lies in another one, the row is held back for review instead of
    written. Otherwise country_en is the named country, else the single
    country of the nearby towns, else left empty (and noted). Occupation is
    not sovereignty: the UN-usage rule of normalize_origin_points.py is
    applied to the findspot (Palestine incl. East Jerusalem and Gaza, Golan,
    Crimea, Western Sahara), and a conflict that is only about occupation is
    not held back. Jerusalem itself keeps the source's country.

Resumable via a JSONL cache: re-running `fetch` skips row ids already in the
cache. `fetch` never writes to the database; `apply` reads the cache and
writes. Each cache line keeps the row's old values, and `apply` only updates
a row that still has them.

After --apply, run the place pipeline (CLAUDE.md "Data rules"):
normalize_place_names.py → normalize_country_names.py →
fill_place_name_normalized.py → normalize_place_labels.py → audit_places.py,
then SELECT refresh_geospatial_views();

Usage:
    # Rows from the DB (no coordinates, not verified, no manual coordinates):
    python backfill_smb_event_attribution.py fetch --cache smb_islamische.jsonl \\
        --institution "Museum für Islamische Kunst"
    # …or from a JSON list exported from the public API (same fields as ROW_FIELDS):
    python backfill_smb_event_attribution.py fetch --cache smb_islamische.jsonl --rows-json rows.json
    python backfill_smb_event_attribution.py fetch --object-ids 132255     # spot check, no cache write
    python backfill_smb_event_attribution.py report --cache smb_islamische.jsonl [--csv out.csv]
    python backfill_smb_event_attribution.py apply  --cache smb_islamische.jsonl            # dry run
    python backfill_smb_event_attribution.py apply  --cache smb_islamische.jsonl --apply

The July 2026 cache (smb_event_attribution_cache.jsonl: all rows, never
applied) predates these rules; `apply` skips cache lines without the old_*
values it needs to check that a row is unchanged.
"""

import argparse
import csv
import json
import math
import os
import sys
import time
from collections import Counter, defaultdict
from datetime import date

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from smb_event_selection import select_origin_event  # noqa: E402
from normalize_origin_points import un_country  # noqa: E402

SMB_INSTITUTIONS = [
    "Ethnologisches Museum",
    "Museum für Islamische Kunst",
    "Ägyptisches Museum und Papyrussammlung",
    "Antikensammlung",
    "Vorderasiatisches Museum",
    "Museum für Asiatische Kunst",
]

CITIES500 = os.path.join(HERE, "data", "gazetteer", "cities500.txt")
COUNTRY_INFO = os.path.join(HERE, "data", "gazetteer", "countryInfo.txt")
COUNTRY_LABELS = os.path.join(HERE, "..", "frontend", "public", "country-labels.geojson")
AT_TOWN_KM = 5        # a findspot this close to a GeoNames town takes its country
TOWN_RADIUS_KM = 25   # otherwise every town this close must be in one country
SPARSE_RADIUS_KM = 60 # …or, with no town within 25 km, every town within 60 km
# Conflicts that are only about occupation: not held back; the findspot's
# country under UN usage is recorded (normalize_origin_points.py rule).
OCCUPIED_PAIRS = {frozenset(p) for p in [("Israel", "Palestine"), ("Israel", "Syria"),
                                         ("Russia", "Ukraine"), ("Morocco", "Western Sahara")]}

MAX_RETRIES = 5
RETRY_SLEEP_SECONDS = 5
REQUEST_SLEEP_SECONDS = 0.3
REQUEST_TIMEOUT_SECONDS = 15
NOTE_TAG = "[smb-event]"


def get_conn():
    import psycopg2
    from dotenv import load_dotenv

    load_dotenv(dotenv_path=os.path.join(HERE, "../backend/.env"))
    return psycopg2.connect(
        host=os.environ.get("DATABASE_HOST", "127.0.0.1"),
        port=int(os.environ.get("DATABASE_PORT", 5432)),
        dbname=os.environ.get("DATABASE_NAME", ""),
        user=os.environ.get("DATABASE_USERNAME", ""),
        password=os.environ.get("DATABASE_PASSWORD", ""),
    )


def fetch_object_details(object_id, session=None):
    http = session or requests
    url = f"https://smb.museum-digital.de/json/object/{object_id}"
    last_error = None
    for _ in range(MAX_RETRIES):
        try:
            r = http.get(url, timeout=REQUEST_TIMEOUT_SECONDS)
        except requests.RequestException as e:
            last_error = f"request error: {e}"
            time.sleep(RETRY_SLEEP_SECONDS)
            continue
        if r.status_code == 200:
            try:
                return r.json(), None
            except json.JSONDecodeError:
                return None, "invalid JSON response"
        elif r.status_code in (429, 503):
            last_error = f"HTTP {r.status_code}"
            time.sleep(RETRY_SLEEP_SECONDS)
        else:
            return None, f"HTTP {r.status_code}"
    return None, f"exhausted retries: {last_error}"


ROW_FIELDS = """id, object_id, institution_name, place_name, place_name_normalized, city_en, country_en,
                latitude, longitude, manual_latitude, manual_longitude, review_status"""


def fetch_rows(conn, institutions, object_ids=None):
    """Rows this script may write: no coordinates, no manual coordinates, not verified."""
    import psycopg2.extras

    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    query = f"""
        SELECT {ROW_FIELDS}
        FROM museum_objects
        WHERE institution_name = ANY(%s)
          AND published_at IS NOT NULL
          AND (latitude IS NULL OR longitude IS NULL)
          AND manual_latitude IS NULL AND manual_longitude IS NULL
          AND COALESCE(review_status, '') <> 'verified'
    """
    params = [institutions]
    if object_ids:
        query += " AND object_id = ANY(%s)"
        params.append([str(x) for x in object_ids])
    query += " ORDER BY id"
    cur.execute(query, params)
    rows = cur.fetchall()
    cur.close()
    return rows


def rows_from_json(path, institutions):
    """Rows exported from the public API (GET /museum-objects with fields[]), same filter as fetch_rows."""
    with open(path, encoding="utf-8") as f:
        rows = json.load(f)
    return [
        r for r in rows
        if r.get("institution_name") in institutions
        and (r.get("latitude") is None or r.get("longitude") is None)
        and r.get("manual_latitude") is None and r.get("manual_longitude") is None
        and (r.get("review_status") or "") != "verified"
    ]


def selected_place(object_events, origin):
    """The place dict of the event select_origin_event() chose (for its GeoNames id)."""
    for evt in object_events or []:
        place = evt.get("place") or {}
        if (evt.get("event_type") == origin["event_type_id"] and isinstance(place, dict)
                and place.get("place_name") == origin["place_name"]):
            return place
    return {}


def load_cache_records(cache_path):
    """Keep the last line seen per row id (a re-run only ever appends)."""
    by_id = {}
    if not os.path.exists(cache_path):
        return []
    with open(cache_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue  # tolerate a truncated last line from a killed process
            by_id[rec["id"]] = rec
    return list(by_id.values())


def cmd_fetch(args):
    institutions = [args.institution] if args.institution else SMB_INSTITUTIONS

    if args.object_ids:
        conn = get_conn()
        rows = fetch_rows(conn, institutions, object_ids=args.object_ids.split(","))
        conn.close()
        print(f"Spot check: {len(rows)} matching rows (not written to cache)")
        for row in rows:
            details, err = fetch_object_details(row["object_id"])
            time.sleep(REQUEST_SLEEP_SECONDS)
            origin = select_origin_event(details.get("object_events", [])) if details else None
            print(f"object_id={row['object_id']} institution={row['institution_name']!r}")
            print(f"    OLD: place_name={row['place_name']!r} lat={row['latitude']} lon={row['longitude']}")
            if origin:
                print(f"    NEW: place_name={origin['place_name']!r} lat={origin['latitude']} lon={origin['longitude']} "
                      f"event={origin['event_type_en']!r} is_findspot={origin['is_findspot']} person={origin['person_name']!r}")
            if err:
                print(f"    ERR: {err}")
        return

    if not args.cache:
        sys.exit("fetch needs --cache (a new file per run; the July 2026 cache is not reused)")

    if args.rows_json:
        all_rows = rows_from_json(args.rows_json, institutions)
    else:
        conn = get_conn()
        all_rows = fetch_rows(conn, institutions)
        conn.close()

    already_done = {r["id"] for r in load_cache_records(args.cache)}
    remaining = [r for r in all_rows if r["id"] not in already_done]

    print(f"Institutions:        {institutions}")
    print(f"Rows without coords: {len(all_rows)}")
    print(f"Already in cache:    {len(already_done)}")
    print(f"Remaining to fetch:  {len(remaining)}")
    print(f"Cache file:          {args.cache}")
    sys.stdout.flush()

    ok = gained = failed = 0
    start = time.time()
    session = requests.Session()
    session.headers["User-Agent"] = "ExSitu-ETL/1.0 (https://exsitu.app)"

    with open(args.cache, "a", buffering=1, encoding="utf-8") as cache_f:  # line-buffered
        for i, row in enumerate(remaining, 1):
            details, err = fetch_object_details(row["object_id"], session)
            base = {
                "id": row["id"], "object_id": row["object_id"], "institution_name": row["institution_name"],
                "old_place_name": row["place_name"],
                "old_place_name_normalized": row.get("place_name_normalized"),
                "old_city_en": row.get("city_en"),
                "old_country_en": row.get("country_en"),
                "old_review_status": row.get("review_status"),
            }
            if err:
                record = {**base, "status": "failed", "error": err}
                failed += 1
            else:
                events = details.get("object_events", [])
                origin = select_origin_event(events)
                place = selected_place(events, origin) if origin["place_name"] else {}
                record = {
                    **base, "status": "ok", "error": None,
                    "inventory_number": details.get("object_inventory_number"),
                    "new_place_name": origin["place_name"],
                    "new_latitude": origin["latitude"], "new_longitude": origin["longitude"],
                    "new_geonames_id": place.get("place_geonames") or None,
                    "event_type_id": origin["event_type_id"], "event_type_en": origin["event_type_en"],
                    "is_findspot": origin["is_findspot"], "person_name": origin["person_name"],
                    "fetched": date.today().isoformat(),
                }
                ok += 1
                if origin["latitude"] is not None:
                    gained += 1

            cache_f.write(json.dumps(record, ensure_ascii=False) + "\n")

            if i % 100 == 0 or i == len(remaining):
                elapsed = time.time() - start
                rate = i / elapsed if elapsed > 0 else 0
                eta_min = (len(remaining) - i) / rate / 60 if rate > 0 else float("nan")
                print(f"[{i}/{len(remaining)}] ok={ok} (gain coords={gained}) failed={failed} "
                      f"elapsed={elapsed/60:.1f}m eta={eta_min:.1f}m", flush=True)

            time.sleep(REQUEST_SLEEP_SECONDS)

    print(f"\nFetch complete. ok={ok} (gain coords={gained}) failed={failed} total_processed={len(remaining)}")


# ── Country check (GeoNames towns near the findspot) ────────────────────────

class Countries:
    """Map country labels (frontend/public/country-labels.geojson) and a GeoNames town grid."""

    def __init__(self):
        from build_country_labels import country_key
        self.key = country_key
        with open(COUNTRY_LABELS, encoding="utf-8") as f:
            features = json.load(f)["features"]
        self.by_key, by_iso3 = {}, {}
        for feat in features:
            p = feat["properties"]
            by_iso3[p["id"]] = p["name"]
            for k in p["keys"].split("|"):
                self.by_key[k] = p["name"]
            self.by_key[country_key(p["name"])] = p["name"]
        self.iso2_name = {}
        with open(COUNTRY_INFO, encoding="utf-8") as f:
            for line in f:
                cols = line.rstrip("\n").split("\t")
                if line.startswith("#") or len(cols) < 5:
                    continue
                iso2, iso3, name = cols[0], cols[1], cols[4]
                self.iso2_name[iso2] = by_iso3.get(iso3) or self.by_key.get(country_key(name)) or name
        self.grid = defaultdict(list)
        with open(CITIES500, encoding="utf-8") as f:
            for line in f:
                cols = line.split("\t")
                lat, lon = float(cols[4]), float(cols[5])
                self.grid[(math.floor(lat), math.floor(lon))].append((lat, lon, cols[8], cols[1]))
        from normalize_place_names import _LOOKUP_RAW  # German country names ("Syrien") → English
        self.german = {k.lower(): v for k, v in _LOOKUP_RAW.items() if v}

    def label_for_name(self, name):
        """Country label for a place_name/country_en that names a whole country, else None."""
        if not name:
            return None
        n = name.strip()
        english = self.german.get(n.lower(), n)
        return self.by_key.get(self.key(english)) or self.by_key.get(self.key(n))

    def findspot_country(self, lat, lon):
        """(country label or None, reason, nearest town)."""
        towns = []
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for tlat, tlon, cc, name in self.grid.get((math.floor(lat) + dy, math.floor(lon) + dx), []):
                    d = _haversine(lat, lon, tlat, tlon)
                    if d <= SPARSE_RADIUS_KM:
                        towns.append((d, cc, name))
        towns.sort()
        nearest = f"{towns[0][2]} ({towns[0][1]}, {towns[0][0]:.0f} km)" if towns else None
        radius = TOWN_RADIUS_KM if towns and towns[0][0] <= TOWN_RADIUS_KM else SPARSE_RADIUS_KM
        codes = {cc for d, cc, _ in towns if d <= radius}
        if towns and towns[0][0] <= AT_TOWN_KM:
            country, reason = self.iso2_name.get(towns[0][1]), f"GeoNames town within {AT_TOWN_KM} km"
        elif not towns:
            country, reason = None, f"no GeoNames town within {SPARSE_RADIUS_KM} km"
        elif len(codes) > 1:
            country, reason = None, f"towns of several countries within {radius} km: {', '.join(sorted(codes))}"
        else:
            country, reason = self.iso2_name.get(codes.pop()), f"GeoNames towns within {radius} km"
        if 31.70 < lat < 31.88 and 35.13 < lon < 35.30:
            # Left out of the UN rule in normalize_origin_points.py, pending the user's decision.
            return None, "Jerusalem: country left to review", nearest
        # Occupation is not sovereignty: same rule as normalize_origin_points.py
        # (Palestine incl. East Jerusalem and Gaza, Golan → Syria, Crimea → Ukraine).
        un = un_country(lat, lon, country)
        if un and un[0] == "country":
            return un[1], f"UN usage (GeoNames: {country or reason})", nearest
        if un:
            return None, "Western Sahara, not Morocco (UN usage)", nearest
        return country, reason, nearest


def _haversine(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(a))


def classify(records, countries):
    """What apply would do with each cached record ('action'), and why."""
    out = []
    for r in records:
        d = dict(r)
        out.append(d)
        if r["status"] != "ok":
            d["action"] = "skip: fetch failed"
        elif "old_city_en" not in r:
            d["action"] = "skip: old cache line (no old values to check against)"
        elif (r.get("old_review_status") or "") == "verified":
            d["action"] = "skip: verified"
        elif r["new_latitude"] is None or r["new_longitude"] is None:
            d["action"] = ("skip: event place has no coordinates" if r["new_place_name"]
                           else "skip: no Found/Created event with a place")
        elif countries.label_for_name(r["new_place_name"]):
            d["action"] = "skip: event place is a whole country (centre point, not a findspot)"
        else:
            country, reason, nearest = countries.findspot_country(r["new_latitude"], r["new_longitude"])
            claimed = r.get("old_country_en") or countries.label_for_name(r["old_place_name"])
            d.update(findspot_country=country, country_reason=reason, nearest_town=nearest, claimed_country=claimed)
            if claimed and country and claimed != country and frozenset((claimed, country)) in OCCUPIED_PAIRS:
                if r.get("old_country_en"):
                    d["action"] = "write (keep country)"  # normalize_origin_points.py applies UN usage
                else:
                    d["action"] = "write (set country)"
                    d["set_country"] = country
            elif claimed and country and claimed != country:
                d["action"] = "hold: findspot in another country"
            elif r.get("old_country_en"):
                d["action"] = "write (keep country)"
            elif claimed or country:
                d["action"] = "write (set country)"
                d["set_country"] = claimed or country
            else:
                d["action"] = "write (no country)"
    return out


def note_for(d):
    kind = "findspot" if d["is_findspot"] else f"{(d['event_type_en'] or 'event').lower()} place"
    gn = f", GeoNames {d['new_geonames_id']}" if d.get("new_geonames_id") else ""
    note = (f"{NOTE_TAG} {date.today().isoformat()} {kind} from museum-digital {d['object_id']}: "
            f"{d['new_place_name']} ({d['new_latitude']:.5f}, {d['new_longitude']:.5f}{gn}); "
            f"was place_name {d['old_place_name']!r}, city_en {d['old_city_en']!r}")
    if d.get("set_country"):
        note += f"; country_en set to {d['set_country']}"
    elif d["action"] == "write (no country)":
        note += f"; country_en not set: {d.get('country_reason')}"
    return note


def cmd_report(args):
    records = load_cache_records(args.cache)
    if not records:
        print(f"No cache records found at {args.cache}")
        return
    rows = classify(records, Countries())
    print(f"Cache file: {args.cache}  ({len(records)} rows)")
    for k, v in Counter(d["action"] for d in rows).most_common():
        print(f"  {v:>6}  {k}")
    writes = [d for d in rows if d["action"].startswith("write")]
    print(f"\nWould write {len(writes)} rows "
          f"({sum(1 for d in writes if d['is_findspot'])} findspots, "
          f"{sum(1 for d in writes if not d['is_findspot'])} production places).")
    print("Old place_name:", Counter(d["old_place_name"] for d in writes).most_common(12))
    print("Country:", Counter(d.get("set_country") or d.get("old_country_en") for d in writes).most_common(15))
    print("New place:", Counter(d["new_place_name"] for d in writes).most_common(25))
    held = [d for d in rows if d["action"].startswith("hold")]
    if held:
        print(f"\nHeld back ({len(held)}): the stored country differs from the findspot's")
        for d in held[: args.sample]:
            print(f"  {d['inventory_number']} ({d['object_id']}): {d['old_place_name']!r}/{d['claimed_country']} → "
                  f"{d['new_place_name']} in {d['findspot_country']} (nearest {d['nearest_town']})")
    if args.csv:
        cols = ["action", "id", "object_id", "inventory_number", "old_place_name", "old_city_en", "old_country_en",
                "new_place_name", "new_latitude", "new_longitude", "new_geonames_id", "event_type_en", "is_findspot",
                "claimed_country", "findspot_country", "set_country", "country_reason", "nearest_town"]
        with open(args.csv, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
            w.writeheader()
            w.writerows(rows)
        print(f"\nPer-row report → {args.csv}")


def cmd_apply(args):
    records = load_cache_records(args.cache)
    rows = [d for d in classify(records, Countries()) if d["action"].startswith("write")]
    print(f"{len(records)} cache rows; {len(rows)} to write (`report` shows what and why).")
    if not args.apply:
        print("Dry run — re-run with --apply to write.")
        return

    conn = get_conn()
    cur = conn.cursor()
    updated = stale = 0
    try:
        for d in rows:
            cur.execute(
                """
                UPDATE museum_objects SET
                    place_name = %(new_place_name)s,
                    latitude = %(new_latitude)s,
                    longitude = %(new_longitude)s,
                    city_en = %(new_place_name)s,
                    place_name_normalized = NULL,
                    country_en = COALESCE(country_en, %(set_country)s),
                    origin_event_type_id = %(event_type_id)s,
                    origin_event_type_en = %(event_type_en)s,
                    origin_is_findspot = %(is_findspot)s,
                    origin_person_name = %(person_name)s,
                    geocoding_notes = CONCAT_WS(E'\\n', NULLIF(geocoding_notes, ''), %(note)s)
                WHERE id = %(id)s
                  AND place_name IS NOT DISTINCT FROM %(old_place_name)s
                  AND city_en IS NOT DISTINCT FROM %(old_city_en)s
                  AND country_en IS NOT DISTINCT FROM %(old_country_en)s
                  AND latitude IS NULL AND longitude IS NULL
                  AND manual_latitude IS NULL AND manual_longitude IS NULL
                  AND COALESCE(review_status, '') <> 'verified'
                """,
                {**d, "set_country": d.get("set_country"), "note": note_for(d)},
            )
            if cur.rowcount:
                updated += 1
            else:
                stale += 1
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()
    print(f"Updated {updated} rows; {stale} skipped (row changed since fetch, or verified).")
    print(f"Old values are in geocoding_notes ('{NOTE_TAG} {date.today().isoformat()} …') for undo.")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p_fetch = sub.add_parser("fetch", help="Resumable crawl via museum-digital.de API (no DB writes)")
    p_fetch.add_argument("--cache", type=str, help="JSONL cache for this run (required except with --object-ids)")
    p_fetch.add_argument("--institution", type=str, default=None,
                         help="Limit to one institution (default: all 6 SMB institutions)")
    p_fetch.add_argument("--rows-json", type=str, default=None,
                         help="Read rows from a JSON list (public API export) instead of the DB")
    p_fetch.add_argument("--object-ids", type=str, default=None,
                         help="Comma-separated object_ids to spot-check (bypasses cache, no writes)")

    p_report = sub.add_parser("report", help="What apply would do, per row (no network/DB)")
    p_report.add_argument("--cache", type=str, required=True)
    p_report.add_argument("--sample", type=int, default=20)
    p_report.add_argument("--csv", type=str, default=None, help="Write the per-row decision to this CSV")

    p_apply = sub.add_parser("apply", help="Write the 'write' rows to the database (dry run by default)")
    p_apply.add_argument("--cache", type=str, required=True)
    p_apply.add_argument("--apply", action="store_true", help="Actually write")

    args = parser.parse_args()
    {"fetch": cmd_fetch, "report": cmd_report, "apply": cmd_apply}[args.command](args)


if __name__ == "__main__":
    main()
