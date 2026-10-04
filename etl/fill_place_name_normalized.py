#!/usr/bin/env python3
"""
fill_place_name_normalized.py — Fill place_name_normalized from city_en where
it is still NULL, so the map / MCP group spelling variants of one place together.

The geospatial view (mv_city_institution_stats, backend/src/index.js) groups
origins on COALESCE(place_name_normalized, city_en) case-insensitively. city_en
often carries a ", <country>" suffix on some rows of a place but not others
("Olympia, Greece" vs "Olympia"), which split one place into several rows. This
script stores the display form without the suffix:

    normalize_display("Olympia, Greece", "Greece") == "Olympia"

Rules (must stay identical to normalizePlaceDisplay() / placeKey() in
frontend/lib/mcp/origins.ts — both are checked against
frontend/lib/mcp/place-normalization-cases.json):
  - strip a trailing ", <country_en>" (compared accent- and case-insensitively)
  - trim and collapse whitespace
  - keep the original casing (the view groups case-insensitively)
Nothing fuzzier: "Tarquinia" and "Tomba del Guerriero (Tarquinia)" stay apart.

Only rows where place_name_normalized is NULL/empty AND the rules change city_en
are written. Curated values (normalize_place_names.py, admin GeoCorrection) are
never touched, and place_name stays raw. Run this AFTER normalize_place_names.py:
that script only processes rows whose place_name_normalized is still NULL.

Usage:
    python etl/fill_place_name_normalized.py              # dry run: summary + sample, no writes
    python etl/fill_place_name_normalized.py --apply      # write in one transaction
    python etl/fill_place_name_normalized.py --self-test  # check the shared cases, no DB

After --apply, restart Strapi (or call PUT /api/museum-objects/refresh-views as an
admin) so the materialized views pick up the new values.
"""

import argparse
import json
import os
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
CASES = os.path.join(HERE, "..", "frontend", "lib", "mcp", "place-normalization-cases.json")


def normalize_key(value):
    """normalizePlaceName() in origins.ts: NFKD, drop marks, lowercase, collapse whitespace."""
    decomposed = unicodedata.normalize("NFKD", value)
    stripped = "".join(c for c in decomposed if not unicodedata.category(c).startswith("M"))
    return " ".join(stripped.lower().split())


def strip_country_suffix(name, country):
    if not country:
        return name.strip()
    head, sep, suffix = name.rpartition(",")
    if sep and normalize_key(suffix) == normalize_key(country):
        return head.strip()
    return name.strip()


def normalize_display(name, country):
    return " ".join(strip_country_suffix(name, country).split())


def place_key(name, country):
    return normalize_key(normalize_display(name, country))


def self_test():
    with open(CASES, encoding="utf-8") as f:
        cases = json.load(f)["cases"]
    failures = 0
    for case in cases:
        display = normalize_display(case["name"], case["country"])
        key = place_key(case["name"], case["country"])
        if display != case["display"] or key != case["key"]:
            failures += 1
            print(f"FAIL {case['name']!r}: display={display!r} key={key!r}, expected {case['display']!r} / {case['key']!r}")
    print(f"{len(cases) - failures}/{len(cases)} cases pass")
    return failures == 0


def get_conn():
    import psycopg2
    from dotenv import load_dotenv

    load_dotenv(dotenv_path=os.path.join(HERE, "..", "backend", ".env"))
    return psycopg2.connect(
        host=os.environ.get("DATABASE_HOST", "127.0.0.1"),
        port=int(os.environ.get("DATABASE_PORT", 5432)),
        dbname=os.environ.get("DATABASE_NAME", ""),
        user=os.environ.get("DATABASE_USERNAME", ""),
        password=os.environ.get("DATABASE_PASSWORD", ""),
    )


def find_updates(cur):
    """(city_en, country_en, normalized, row_count) for every pair the rules change."""
    cur.execute(
        """
        SELECT city_en, country_en, COUNT(*)
        FROM museum_objects
        WHERE NULLIF(BTRIM(COALESCE(place_name_normalized, '')), '') IS NULL
          AND NULLIF(BTRIM(COALESCE(city_en, '')), '') IS NOT NULL
        GROUP BY city_en, country_en
        """
    )
    updates = []
    for city, country, count in cur.fetchall():
        normalized = normalize_display(city, country)
        if normalized and normalized != city:
            updates.append((city, country, normalized, count))
    return sorted(updates, key=lambda u: -u[3])


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="write the updates (default: dry run)")
    parser.add_argument("--self-test", action="store_true", help="check the shared normalization cases and exit")
    parser.add_argument("--sample", type=int, default=15, help="rows to show in the dry-run sample")
    args = parser.parse_args()

    if args.self_test:
        sys.exit(0 if self_test() else 1)
    if not self_test():
        sys.exit("Normalization rules disagree with place-normalization-cases.json; not touching the DB.")

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            updates = find_updates(cur)
            total_rows = sum(u[3] for u in updates)
            print(f"{len(updates)} distinct (city_en, country_en) values → {total_rows} rows to fill")
            for city, country, normalized, count in updates[: args.sample]:
                print(f"  {count:>6}  {city!r} ({country}) → {normalized!r}")

            if not args.apply:
                print("Dry run — re-run with --apply to write.")
                return

            written = 0
            for city, country, normalized, _ in updates:
                cur.execute(
                    """
                    UPDATE museum_objects
                    SET place_name_normalized = %s
                    WHERE city_en = %s
                      AND country_en IS NOT DISTINCT FROM %s
                      AND NULLIF(BTRIM(COALESCE(place_name_normalized, '')), '') IS NULL
                    """,
                    (normalized, city, country),
                )
                written += cur.rowcount
        conn.commit()
        print(f"Wrote place_name_normalized on {written} rows. Restart Strapi to rebuild the map views.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
