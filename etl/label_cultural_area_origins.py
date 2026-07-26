"""
label_cultural_area_origins.py — One-time patch: set origin_type='cultural_area'
for records whose place_name is a region/province/historical-kingdom/ethnic-group
name rather than a specific findspot or city, so the (previously unused)
origin_type column can flag false point-precision on the map/detail view.

Background: etl/fix_coordinates.py's KNOWN_COORDS table resolves broad names
(e.g. "Gujarat", "Owari Province", "Mughal Empire") to a single hard-coded
lat/lon point so they can be geocoded at all. That's necessary to plot them,
but it silently implies findspot-level precision for a region the size of a
country subdivision. This script does not touch any coordinates — it only
labels the existing rows so consumers can render/query around the distinction
(e.g. "shown at the center of a large region, not a precise findspot").

Scope: place_name values that are unambiguously a region/province/state,
historical empire or kingdom, ethnic/cultural group, or an island larger than
a plausible findspot — i.e. names for which there is no city of the same
name that the source could plausibly have meant instead. Ambiguous entries
(e.g. "Nagasaki", "Kyoto", "Oaxaca", "Kangra" — each also a real, specific
city) are deliberately excluded; a bare city name is left unlabeled even
where KNOWN_COORDS also carries a fix for it.

Restricted to Met and V&A: their scrapers write source geography text
directly into place_name (V&A: scrape_vam.py place_of_origin; Met:
scrape_met_api.py city/state/county/country/region/subregion), so an exact
match against place_name reliably reflects what the source called the
object's origin. AIC/SMB/Ethnologisches Museum populate place_name/city_en
through different paths (structured events, reverse-geocoded coordinates)
and are out of scope for this pass.

Usage:
    python label_cultural_area_origins.py            # dry-run — prints counts, no writes
    python label_cultural_area_origins.py --apply     # apply the UPDATE

Note: mv_country_institution_stats / mv_city_institution_stats don't expose
origin_type, so no materialized view refresh is needed after this update.

Environment variables (DB connection):
    DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
"""

import argparse
import logging
import os

import psycopg2

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger(__name__)

INSTITUTIONS = ["The Metropolitan Museum of Art", "Victoria and Albert Museum"]

# place_name values (case-insensitive) that denote a region/province/state,
# historical empire/kingdom, ethnic/cultural group, or large island — never
# a specific findspot, and never also the name of a real city.
CULTURAL_AREA_PLACE_NAMES = [
    # Japan — explicit "province"/"prefecture" only; bare names like
    # "Satsuma", "Nagasaki", "Kyoto" are excluded (also real cities).
    "owari province", "satsuma province", "shizuoka prefecture",

    # India — states, directional macro-regions, historical kingdoms/empire.
    "bengal", "south india", "deccan", "north india", "central india",
    "western india", "gujarat", "mughal", "mughal empire", "rajasthan",
    "awadh", "punjab", "punjab (india)", "himachal pradesh", "tamil nadu",
    "karnataka", "orissa", "odisha", "assam", "malwa", "coromandel coast",
    "north-east india", "travancore", "south east india",

    # Pakistan
    "sindh", "punjab (pakistan)", "baluchistan", "gandhara",

    # China — provinces/autonomous regions.
    "tibet", "xinjiang", "sichuan", "yunnan", "hunan", "zhejiang",

    # Explicitly ambiguous macro-regions.
    "middle east", "central asia",

    # Indonesia — islands, region-scale.
    "java", "sulawesi",

    # West Africa — ethnic groups / historical kingdoms, not places.
    "yoruba", "ashanti", "dahomey",

    # Mexico — peninsula/state, no city of the same name.
    "yucatan",

    # Myanmar — historical federation of states.
    "shan states", "shan state",
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--apply", action="store_true", default=False,
        help="Write updates to the database. Without this flag, runs in dry-run mode.",
    )
    args = parser.parse_args()
    dry_run = not args.apply

    conn = psycopg2.connect(
        host=os.environ["DB_HOST"],
        port=os.environ.get("DB_PORT", 5432),
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
    )
    cur = conn.cursor()

    names_lower = [n.lower() for n in CULTURAL_AREA_PLACE_NAMES]

    cur.execute(
        """
        SELECT institution_name, COUNT(*)
        FROM museum_objects
        WHERE institution_name = ANY(%s)
          AND lower(place_name) = ANY(%s)
          AND (origin_type IS NULL OR origin_type <> 'cultural_area')
        GROUP BY institution_name
        """,
        (INSTITUTIONS, names_lower),
    )
    rows = cur.fetchall()
    total = 0
    for institution_name, count in rows:
        log.info(f"  {institution_name}: {count} rows to label")
        total += count
    log.info(f"Total: {total} rows would be updated to origin_type='cultural_area'")

    if dry_run:
        log.info("[dry-run] Re-run with --apply to write to DB.")
        cur.close()
        conn.close()
        return

    cur.execute(
        """
        UPDATE museum_objects
        SET origin_type = 'cultural_area'
        WHERE institution_name = ANY(%s)
          AND lower(place_name) = ANY(%s)
          AND (origin_type IS NULL OR origin_type <> 'cultural_area')
        """,
        (INSTITUTIONS, names_lower),
    )
    log.info(f"Updated {cur.rowcount} rows.")
    conn.commit()
    log.info("Done.")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
