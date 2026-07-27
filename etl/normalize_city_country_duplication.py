#!/usr/bin/env python3
"""One-off fix: collapse "<City>, <Country>" values in city_en down to "<City>"
when the country half is redundant with the country_en column and a clean
"<City>" row already exists for the same country_en.

Root cause (see docs/ETL.md and backend/src/api/museum-object/services/museum-object.js
`bulkGeocode`): the admin `/museum-objects/bulk-geocode` endpoint does
  UPDATE museum_objects SET city_en = :city_en, country_en = :country_en, ...
  WHERE place_name = :place_name
with no validation that city_en isn't just a copy of place_name (which, for
Met Museum records, is itself a comma-joined "city, state, county, country,
region, subregion" string built by scrape_met_api.py). A caller passed the
full place_name straight through as city_en for a batch of place_name groups
(e.g. every one of the 4075 rows with place_name = "Nishapur, Iran" got
city_en = "Nishapur, Iran" verbatim instead of "Nishapur"), which is why the
contamination shows up as a handful of exact-duplicate blobs rather than
scattered one-offs.

This script only touches pairs where:
  - city_en is exactly "<X>, <Y>" (or "<X>, present-day/probably/possibly <Y>")
  - <Y> matches country_en for that row
  - a row with city_en = <X> AND country_en = <Y> already exists (proof <X>
    is the genuine clean form, not a guess)

Ambiguous cases (multi-value "X or Y", disputed territories, region/country
pairs with no existing clean counterpart, etc.) are deliberately excluded —
see docs/DATA-AUDIT.md discussion / conversation notes for the 1455 other
comma-containing city_en values that were reviewed and are NOT touched here
because they encode real information (e.g. "Peru, Ica Valley" is a sub-region
of a country-level city_en, not a duplicate of it).

Usage:
    python normalize_city_country_duplication.py            # dry-run — prints diff, no writes
    python normalize_city_country_duplication.py --apply     # apply the UPDATE
"""

import argparse
import os

import psycopg2

DB_CONFIG = {
    "host": os.environ.get("DATABASE_HOST", "127.0.0.1"),
    "port": int(os.environ.get("DATABASE_PORT", 5432)),
    "database": os.environ.get("DATABASE_NAME", "museum_db"),
    "user": os.environ.get("DATABASE_USERNAME", "museum_user"),
    "password": os.environ.get("DATABASE_PASSWORD"),
}

# (old city_en, country_en, new city_en) — old != new by construction.
# Generated from a one-off audit query; see conversation/PR description for
# the query that produced this list.
PAIRS: list[tuple[str, str, str]] = [
    ("Nishapur, Iran", "Iran", "Nishapur"),
    ("Olympia, Greece", "Greece", "Olympia"),
    ("Cairo, Egypt", "Egypt", "Cairo"),
    ("Bali, Indonesia", "Indonesia", "Bali"),
    ("Fustat, Egypt", "Egypt", "Fustat"),
    ("Bukhara, present-day Uzbekistan", "Uzbekistan", "Bukhara"),
    ("Samarra, Iraq", "Iraq", "Samarra"),
    ("Rayy, Iran", "Iran", "Rayy"),
    ("Herat, present-day Afghanistan", "Afghanistan", "Herat"),
    ("Shiraz, Iran", "Iran", "Shiraz"),
    ("Samarqand, present-day Uzbekistan", "Uzbekistan", "Samarqand"),
    ("Isfahan, Iran", "Iran", "Isfahan"),
    ("Basra, Iraq", "Iraq", "Basra"),
    ("Lomé, Togo", "Togo", "Lomé"),
    ("British Columbia, Canada", "Canada", "British Columbia"),
    ("Damascus, Syria", "Syria", "Damascus"),
    ("Assam, India", "India", "Assam"),
    ("Varanasi, India", "India", "Varanasi"),
    ("Konya, Turkey", "Turkey", "Konya"),
    ("Toledo, Spain", "Spain", "Toledo"),
    ("Dhaka, present-day Bangladesh", "Bangladesh", "Dhaka"),
    ("Kirman, Iran", "Iran", "Kirman"),
    ("Hyderabad, India", "India", "Hyderabad"),
    ("Thessaloniki, present-day Greece", "Greece", "Thessaloniki"),
    ("Kashmir, India", "India", "Kashmir"),
    ("Ahmadabad, India", "India", "Ahmadabad"),
    ("Rabat, Morocco", "Morocco", "Rabat"),
    ("Ahmedabad, India", "India", "Ahmedabad"),
    ("Ghazni, Afghanistan", "Afghanistan", "Ghazni"),
    ("Mashhad, Iran", "Iran", "Mashhad"),
    ("Baghdad, Iraq", "Iraq", "Baghdad"),
    ("Calcutta, India", "India", "Calcutta"),
    ("Granada, Spain", "Spain", "Granada"),
    ("Jaipur, India", "India", "Jaipur"),
    ("Tehran, Iran", "Iran", "Tehran"),
    ("Ancash, Peru", "Peru", "Ancash"),
    ("Agra, India", "India", "Agra"),
    ("Gujarat, India", "India", "Gujarat"),
    ("Fars, Iran", "Iran", "Fars"),
    ("Izmir, Turkey", "Turkey", "Izmir"),
    ("Lucknow, India", "India", "Lucknow"),
    ("Yazd, Iran", "Iran", "Yazd"),
    ("Lahore, present-day Pakistan", "Pakistan", "Lahore"),
    ("Delhi, India", "India", "Delhi"),
    ("Mumbai, India", "India", "Mumbai"),
    ("Auckland, New Zealand", "New Zealand", "Auckland"),
    ("Bahnasa, Egypt", "Egypt", "Bahnasa"),
    ("Ibadan, Nigeria", "Nigeria", "Ibadan"),
    ("Thanjavur, India", "India", "Thanjavur"),
    ("Fars, probably Iran", "Iran", "Fars"),
    ("Multan, present-day Pakistan", "Pakistan", "Multan"),
    ("New South Wales, Australia", "Australia", "New South Wales"),
    ("Burhanpur, India", "India", "Burhanpur"),
    ("Surat, India", "India", "Surat"),
    ("Nayarit, Mexico", "Mexico", "Nayarit"),
    ("Medinet Habu, Egypt", "Egypt", "Medinet Habu"),
    ("Tamil Nadu, India", "India", "Tamil Nadu"),
    ("Kinshasa, Democratic Republic of the Congo", "Democratic Republic of the Congo", "Kinshasa"),
    ("Paris, France", "France", "Paris"),
    ("New Ireland, Papua New Guinea", "Papua New Guinea", "New Ireland"),
    ("Bukhara, Uzbekistan", "Uzbekistan", "Bukhara"),
    ("Benares, India", "India", "Benares"),
    ("Herat, Afghanistan", "Afghanistan", "Herat"),
    ("Western Australia, Australia", "Australia", "Western Australia"),
    ("Murshidabad, India", "India", "Murshidabad"),
    ("Multan, Present-day Pakistan", "Pakistan", "Multan"),
    ("Mosul, Iraq", "Iraq", "Mosul"),
    ("Darjeeling, India", "India", "Darjeeling"),
    ("Samarkand, present-day Uzbekistan", "Uzbekistan", "Samarkand"),
    ("Peshawar, present-day Pakistan", "Pakistan", "Peshawar"),
    ("Khotan, present-day China", "China", "Khotan"),
    ("Yarkand, China", "China", "Yarkand"),
    ("Madras, India", "India", "Madras"),
    ("Astar Abad, Iran", "Iran", "Astar Abad"),
    ("Veracruz, Mexico", "Mexico", "Veracruz"),
    ("Vancouver, Canada", "Canada", "Vancouver"),
    ("Veraguas, Panama", "Panama", "Veraguas"),
    ("Bukhara, Present-day Uzbekistan", "Uzbekistan", "Bukhara"),
    ("Garrus, Iran", "Iran", "Garrus"),
    ("Chamba, India", "India", "Chamba"),
    ("Kumasi, Ghana", "Ghana", "Kumasi"),
    ("Lima, Peru", "Peru", "Lima"),
    ("Bikaner, India", "India", "Bikaner"),
    ("South Sumatra, Indonesia", "Indonesia", "South Sumatra"),
    ("Rajasthan, India", "India", "Rajasthan"),
    ("Farrukhabad, India", "India", "Farrukhabad"),
    ("Alexandria, Egypt", "Egypt", "Alexandria"),
    ("Milas, Turkey", "Turkey", "Milas"),
    ("Karachi, Pakistan", "Pakistan", "Karachi"),
    ("Wasit, Iraq", "Iraq", "Wasit"),
    ("Ajmer, India", "India", "Ajmer"),
    ("Timbuktu, Mali", "Mali", "Timbuktu"),
    ("Aleppo, Syria", "Syria", "Aleppo"),
    ("Biskra, Algeria", "Algeria", "Biskra"),
    ("Bonwire, Ghana", "Ghana", "Bonwire"),
    ("Puebla, Mexico", "Mexico", "Puebla"),
    ("Lahore, Pakistan", "Pakistan", "Lahore"),
    ("Brazzaville, Democratic Republic of the Congo", "Democratic Republic of the Congo", "Brazzaville"),
    ("Marrakesh, Morocco", "Morocco", "Marrakesh"),
    ("Ankara, Turkey", "Turkey", "Ankara"),
    ("Nairobi, Kenya", "Kenya", "Nairobi"),
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Apply the UPDATE (default: dry-run diff only)")
    args = parser.parse_args()

    conn = psycopg2.connect(**DB_CONFIG)
    conn.autocommit = False
    cur = conn.cursor()

    total_contaminated = 0
    total_existing_clean = 0
    print(f"{'city_en (before)':55} {'country_en':20} {'-> city_en (after)':25} {'rows':>6} {'existing':>8}")
    print("-" * 120)
    for old, country, new in PAIRS:
        cur.execute(
            "SELECT COUNT(*) FROM museum_objects WHERE city_en = %s AND country_en = %s",
            (old, country),
        )
        contaminated_count = cur.fetchone()[0]
        cur.execute(
            "SELECT COUNT(*) FROM museum_objects WHERE city_en = %s AND country_en = %s",
            (new, country),
        )
        existing_count = cur.fetchone()[0]
        total_contaminated += contaminated_count
        total_existing_clean += existing_count
        print(f"{old:55} {country:20} -> {new:25} {contaminated_count:>6} {existing_count:>8}")

    print("-" * 120)
    print(f"Rows to change: {total_contaminated}")
    print(f"Rows already clean (will be merged into): {total_existing_clean}")
    print(f"Resulting row count per merged city after fix: {total_contaminated + total_existing_clean} (combined)")

    if not args.apply:
        print("\nDry-run only — no writes made. Re-run with --apply to commit.")
        cur.close()
        conn.close()
        return

    case_sql = "UPDATE museum_objects SET city_en = CASE\n"
    case_sql += "".join(
        "  WHEN city_en = %s AND country_en = %s THEN %s\n" for _ in PAIRS
    )
    case_sql += "  ELSE city_en\nEND\n"
    case_sql += "WHERE (city_en, country_en) IN ({})".format(
        ", ".join(["(%s, %s)"] * len(PAIRS))
    )

    flat_params: list = []
    for old, country, new in PAIRS:
        flat_params.extend([old, country, new])
    for old, country, _new in PAIRS:
        flat_params.extend([old, country])

    cur.execute(case_sql, flat_params)
    updated = cur.rowcount
    print(f"\nRows updated: {updated}")
    conn.commit()
    print("Committed.")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
