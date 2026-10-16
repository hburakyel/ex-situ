#!/usr/bin/env python3
"""
normalize_present_day_names.py — Label origins with the place's present-day name
(METHODOLOGY.md, "Place names"). The source's own name stays in place_name.

  rename   a historical, colonial or imperial name of a place that has a
           present-day name → that name ("Madras" → Chennai, "Pergamon" →
           Bergama, "Queen Charlotte Islands" → Haida Gwaii). Matched together
           with the country, so homonyms elsewhere (Madras, Oregon; Edo State,
           Nigeria) are left alone. A trailing "?" (uncertain attribution) is kept.
  label    labels that carried a colonial name for a country or a German tag
           ("Southwest Africa" → Namibia, "King (Papua Neuguinea)" → King).
  area     historical units spanning several present-day countries
           ("Rhodesia") → unlocated, origin_type 'cultural_area'.
  point    a point far from the named place → removed, flagged for review.

Present-day names are those in official use today, applied the same way
everywhere; where a rename is itself contested (Allahabad → Prayagraj, 2018),
METHODOLOGY.md says so. Palestine keeps its name (country labels).

Rows with review_status = 'verified' or a manual coordinate are never touched;
place_name is never changed. Each changed row gets a "[present-day] <date> …"
note in geocoding_notes with the old values.

Usage:
    python etl/normalize_present_day_names.py           # dry run: changes, rolled back
    python etl/normalize_present_day_names.py --apply   # write; then SELECT refresh_geospatial_views();
"""

import argparse
import sys
from datetime import date

from audit_places import get_conn

NOTE_TAG = "[present-day]"
LABEL = "COALESCE(NULLIF(BTRIM(place_name_normalized), ''), city_en)"
GUARD = "COALESCE(review_status, '') <> 'verified' AND manual_latitude IS NULL AND manual_longitude IS NULL"

# (current label, country_en) → present-day name. Sources: GeoNames primary names
# and the places' official names; checked by hand 2026-10-15.
RENAMES = {
    ("Madras", "India"): "Chennai",
    ("Calcutta", "India"): "Kolkata",
    ("Bombay", "India"): "Mumbai",
    ("Benares", "India"): "Varanasi",
    ("Baroda", "India"): "Vadodara",
    ("Trichinopoly", "India"): "Tiruchirappalli",
    ("Cambay", "India"): "Khambhat",
    ("Rajahmundry", "India"): "Rajamahendravaram",
    ("Allahabad", "India"): "Prayagraj",
    ("Edo", "Japan"): "Tokyo",
    ("Shahabad", "Iran"): "Eslamabad-e Gharb",
    ("Rayy", "Iran"): "Rey",
    ("Khotan", "China"): "Hotan",
    ("Hetian", "China"): "Hotan",
    ("Smyrna", "Turkey"): "İzmir",
    ("Antioch", "Turkey"): "Antakya",
    ("Pergamon", "Turkey"): "Bergama",
    ("Ephesus", "Turkey"): "Efes",
    ("Miletus", "Turkey"): "Milet",
    ("Sardis", "Turkey"): "Sart",
    ("Theben", "Greece"): "Thiva",
    ("Natal", "South Africa"): "KwaZulu-Natal",
    ("Natal Province", "South Africa"): "KwaZulu-Natal",
    # Rijksmuseum (Dutch colonial names and pre-1972 Indonesian spelling), 2026-10-15.
    ("Batavia", "Indonesia"): "Jakarta",
    ("Weltevreden", "Indonesia"): "Jakarta",
    ("Celebes", "Indonesia"): "Sulawesi",
    ("Jogjakarta", "Indonesia"): "Yogyakarta",
    ("Lampong", "Indonesia"): "Lampung",
    ("Bindjai", "Indonesia"): "Binjai",
    ("Soekaboemi", "Indonesia"): "Sukabumi",
    ("Atjeh", "Indonesia"): "Aceh",
    ("Soengeiliat", "Indonesia"): "Sungailiat",
    ("Soerakarta", "Indonesia"): "Surakarta",
    ("Tjibeber", "Indonesia"): "Cibeber",
    ("Djambi", "Indonesia"): "Jambi",
    ("Tjimahi", "Indonesia"): "Cimahi",
    ("Batoedjadjar", "Indonesia"): "Batujajar",
    ("Gadingredjo", "Indonesia"): "Gadingrejo",
    ("Tjipanas", "Indonesia"): "Cipanas",
    ("Modjokerto", "Indonesia"): "Mojokerto",
    ("Tandjong Poera", "Indonesia"): "Tanjung Pura",
    ("Constantinople", "Turkey"): "Istanbul",
    ("Kanton", "China"): "Guangzhou",
    ("Canton", "China"): "Guangzhou",
    ("South Celebes", "Indonesia"): "South Sulawesi",
    # French colonial divisions of Vietnam; Vietnamese regions Bắc Bộ and Trung Bộ.
    ("Tonkin", "Vietnam"): "Northern Vietnam",
    ("Annam", "Vietnam"): "Central Vietnam",
    ("Bône", "Algeria"): "Annaba",
    ("Thebes", "Egypt"): "Luxor",
    ("Aboe Simbel", "Egypt"): "Abu Simbel",
    ("Banda Atjeh", "Indonesia"): "Banda Aceh",
    ("Negapatnam", "India"): "Nagapattinam",
    ("Kotah", "India"): "Kota",
    ("Mysore", "India"): "Mysuru",
    ("Deshima", "Japan"): "Dejima",
    ("Elephantine", "Egypt"): "Aswan",
}

# Exact labels → (new label, country_en or None to keep).
LABELS = {
    "Southwest Africa": ("Namibia", None),
    "Iran (Persia)": ("Iran", None),
    "Deutsche Demokratische Republik (DDR)": ("Germany", None),
    "Fernando Poó": ("Bioko", "Equatorial Guinea"),
    "Bismarck-Archipel": ("Bismarck Archipelago", "Papua New Guinea"),
    "King (Papua Neuguinea)": ("King", "Papua New Guinea"),
    "Kait (Papua Neuguinea)": ("Kait", "Papua New Guinea"),
    "British Columbia, Canada, Queen Charlotte Islands (?)": ("Haida Gwaii?", None),
    "Jerusalem District": ("Jerusalem", None),
    "Jerusalem, present-day Israel": ("Jerusalem", None),  # the Met's phrasing stays in place_name
    "Kertsch/Pantikapaion": ("Kerch", None),
    # German site labels from SMB records, translated (2026-10-15); no renaming of the site.
    "Artemistempel": ("Temple of Artemis", None),
    "Sepik-Gebiet": ("Sepik", None),
    "Sansibar-Stadt": ("Zanzibar City", None),
    "Idalion (Nekropolen)": ("Idalion necropoleis", None),
    "Esquilin-Nekropole": ("Esquiline necropolis", None),
    "Jiaohe (Ruinenstadt)": ("Jiaohe ruins", None),
    # Dutch labels from Rijksmuseum records, translated (2026-10-15).
    "Oost-Sumatra": ("East Sumatra", None),
    "Nikkō-shi": ("Nikkō", None),
    "Centraal-Molukken": ("Central Maluku", None),
    "Mentawai-eilanden": ("Mentawai Islands", None),
    "Aru-eilanden": ("Aru Islands", None),
    "Madiun (Oost-Java)": ("Madiun", None),
    "Kupang (Timor)": ("Kupang", None),
    "Yogyakarta (City)": ("Yogyakarta", None),
    "Sumba (Indonesia)": ("Sumba", None),
    "Nord-Bali": ("North Bali", None),
    "Kandy (voormalige natie)": ("Kingdom of Kandy", None),
    "Mariënburg (Suriname)": ("Mariënburg", None),
    "Tambaram (Madras Presidency)": ("Tambaram", None),
    "Rijswijk (Batavia)": ("Rijswijk (Jakarta)", None),
    "Waterlooplein (Batavia)": ("Waterlooplein (Jakarta)", None),
    "Zwischen Tanganyikasee und Kivusee": ("Between Lake Tanganyika and Lake Kivu", None),
    "Mantsjoerije": ("Manchuria", None),
    "USA": ("United States", None),
    "Guinea-Conakry": ("Guinea", None),
    "Zuid-China": ("South China", None),
    "Asia Minor": ("Anatolia", None),
    "West Coast of Asia Minor": ("Western Anatolia", None),
}

# Korea before 1945 lies in both present-day Koreas.
AREAS = {"Korea", "Rhodesia", "South Africa or Kingdom of Swaziland, Southern Africa"}

# (label, country_en, rounded lat, lon) of a wrong point → new label. The Met's
# "Khotan" sat at Aksu, 450 km from Hotan.
POINTS = {("Khotan", "China", 41.17, 80.26): "Hotan"}


def note(*columns):
    today = date.today().isoformat()
    parts = " || ' ' || ".join(f"'{c} was ' || COALESCE(quote_literal({c}::text), 'NULL')" for c in columns)
    return f"geocoding_notes = concat_ws(' | ', NULLIF(geocoding_notes, ''), '{NOTE_TAG} {today} ' || {parts})"


def run(cur):
    total = 0

    print("point far from the named place → removed, flagged")
    for (label, country, lat, lon), new in POINTS.items():
        cur.execute(
            f"""UPDATE museum_objects SET {note('place_name_normalized', 'latitude', 'longitude')},
                  place_name_normalized = %s, latitude = NULL, longitude = NULL, geocoding_status = 'ambiguous'
                WHERE {LABEL} = %s AND country_en = %s AND round(latitude::numeric, 2) = %s
                  AND round(longitude::numeric, 2) = %s AND {GUARD}""",
            (new, label, country, lat, lon),
        )
        print(f"  {cur.rowcount:>5}  {label!r} ({country}) → {new!r}, unlocated")
        total += cur.rowcount

    print("present-day name")
    for (old, country), new in RENAMES.items():
        for suffix in ("", "?"):
            cur.execute(
                f"""UPDATE museum_objects SET {note('place_name_normalized')}, place_name_normalized = %s
                    WHERE {LABEL} = %s AND country_en = %s AND {GUARD}""",
                (new + suffix, old + suffix, country),
            )
            if cur.rowcount:
                print(f"  {cur.rowcount:>5}  {old + suffix!r} → {new + suffix!r}  ({country})")
                total += cur.rowcount

    print("colonial country name or German tag in the label")
    for old, (new, country) in LABELS.items():
        cur.execute(
            f"""UPDATE museum_objects SET {note('place_name_normalized', 'country_en')},
                  place_name_normalized = %s, country_en = COALESCE(%s, country_en)
                WHERE {LABEL} = %s AND {GUARD}""",
            (new, country, old),
        )
        print(f"  {cur.rowcount:>5}  {old!r} → {new!r}" + (f", {country}" if country else ""))
        total += cur.rowcount

    print("historical unit spanning several present-day countries → unlocated")
    for old in sorted(AREAS):
        cur.execute(
            f"""UPDATE museum_objects SET {note('latitude', 'longitude', 'country_en')},
                  latitude = NULL, longitude = NULL, country_en = NULL,
                  origin_type = 'cultural_area', geocoding_status = 'ambiguous'
                WHERE {LABEL} = %s AND latitude IS NOT NULL AND {GUARD}""",
            (old,),
        )
        print(f"  {cur.rowcount:>5}  {old!r}")
        total += cur.rowcount
    return total


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="write the changes (default: dry run, rolled back)")
    args = parser.parse_args()
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            total = run(cur)
        print(f"\n{total} rows")
        if args.apply:
            conn.commit()
            print("Committed. SELECT refresh_geospatial_views(); to rebuild the map views.")
        else:
            conn.rollback()
            print("Dry run — rolled back. Re-run with --apply to write.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
