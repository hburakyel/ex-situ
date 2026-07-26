#!/usr/bin/env python3
"""
normalize_place_names.py — Normalize place_name → place_name_normalized in museum_objects

Applies normalization in priority order per value:
  a. Lookup table (German forms, historical names, spelling variants → canonical English)
  b. Language detection — if German, attempt lookup; fall through to fuzzy if unresolved
  c. Historical → modern mapping  (covered by lookup table in a single pass)
  d. Fuzzy deduplication via rapidfuzz token_sort_ratio ≥ 88 against existing
     place_name_normalized values in the DB
  e. Descriptive phrase / stopword / length filter → sets normalized = NULL

Usage:
    python normalize_place_names.py            # dry-run (default) — prints report, no DB writes
    python normalize_place_names.py --apply    # apply updates to the database

Environment variables (DB connection):
    DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD

Output:
    etl/reports/place_name_normalization_report.csv
"""

import argparse
import csv
import logging
import os
import re
import sys
from pathlib import Path

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Optional dependencies — graceful degradation if absent
# ---------------------------------------------------------------------------
try:
    from langdetect import detect as _langdetect
    from langdetect import LangDetectException

    def detect_lang(s: str) -> str | None:
        try:
            return _langdetect(s)
        except LangDetectException:
            return None

except ImportError:
    def detect_lang(s: str) -> str | None:  # type: ignore[misc]
        return None


try:
    from rapidfuzz.fuzz import token_sort_ratio
    HAS_RAPIDFUZZ = True
except ImportError:
    HAS_RAPIDFUZZ = False
    logging.warning("rapidfuzz not available; fuzzy deduplication disabled")

# ---------------------------------------------------------------------------
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger(__name__)

REPORT_PATH = Path(__file__).parent / "reports" / "place_name_normalization_report.csv"

# ---------------------------------------------------------------------------
# Lookup table: any raw/variant form (lower-cased) → canonical English name
#
# Priority groups are merged into one dict for a single O(1) lookup.
# Group A: German forms → English
# Group B: Historical → Modern
# Group C: Spelling variants → Canonical English
# ---------------------------------------------------------------------------
_LOOKUP_RAW: dict[str, str] = {
    # ── Group A: German forms → English ────────────────────────────────────
    "kleinasien": "Asia Minor",
    "westküste kleinasiens": "Asia Minor",
    "nordafrika": "North Africa",
    "südindien": "South India",
    "nordindien": "North India",
    "ostafrika": "East Africa",
    "westafrika": "West Africa",
    "zentralafrika": "Central Africa",
    "kalkutta": "Kolkata",
    "konstantinopel": "Istanbul",
    "persien": "Iran",
    "mesopotamien": "Iraq",
    "ägypten": "Egypt",
    "aegypten": "Egypt",
    "syrien": "Syria",
    "arabien": "Arabia",
    "nubien": "Nubia",
    "türkei": "Turkey",
    "griechenland": "Greece",
    "italien": "Italy",
    "frankreich": "France",
    "spanien": "Spain",
    "indien": "India",
    "russland": "Russia",
    "kamerun": "Cameroon",
    "kongo": "Congo",
    "elfenbeinküste": "Côte d'Ivoire",
    "sambia": "Zambia",
    "simbabwe": "Zimbabwe",
    "tansania": "Tanzania",
    "kenia": "Kenya",
    "äthiopien": "Ethiopia",
    "madagaskar": "Madagascar",
    "mosambik": "Mozambique",
    "algerien": "Algeria",
    "tunesien": "Tunisia",
    "libyen": "Libya",
    "marokko": "Morocco",
    "mexiko": "Mexico",
    "brasilien": "Brazil",
    "argentinien": "Argentina",
    "kolumbien": "Colombia",
    "bolivien": "Bolivia",
    "ecuadore": "Ecuador",
    "ekuador": "Ecuador",
    "karibik": "Caribbean",
    "südamerika": "South America",
    "nordamerika": "North America",
    "mittelamerika": "Central America",
    "zentralasien": "Central Asia",
    "südostasien": "Southeast Asia",
    "vorderindien": "India",
    "hinterindien": "Mainland Southeast Asia",
    "vorderer orient": "Middle East",
    "naher osten": "Middle East",
    "südpazifik": "South Pacific",
    "ozeanien": "Oceania",
    "melanesien": "Melanesia",
    "polynesien": "Polynesia",
    "mikronesien": "Micronesia",
    "philippinen": "Philippines",
    "bengalen": "Bengal",
    "birma": "Myanmar",
    "birmania": "Myanmar",
    "irak": "Iraq",
    "persischer golf": "Persian Gulf",
    "rotes meer": "Red Sea",
    "schwarzes meer": "Black Sea",
    "kaspisches meer": "Caspian Sea",
    "bengalischer meerbusen": "Bay of Bengal",
    "arabisches meer": "Arabian Sea",
    "mittelmeer": "Mediterranean",

    # ── Group B: Historical → Modern ───────────────────────────────────────
    "milet": "Miletus",
    "byzanz": "Istanbul",
    "ceylon": "Sri Lanka",
    "ceylan": "Sri Lanka",
    "abyssinia": "Ethiopia",
    "abyssinie": "Ethiopia",
    "dahomey": "Benin",
    "rhodesia": "Zimbabwe",
    "siam": "Thailand",
    "burma": "Myanmar",
    "formosa": "Taiwan",
    "dutch east indies": "Indonesia",
    "british india": "India",
    "french indochina": "Vietnam",
    "gold coast": "Ghana",
    "nyasaland": "Malawi",
    "southern rhodesia": "Zimbabwe",
    "northern rhodesia": "Zambia",
    "tanganyika": "Tanzania",
    "zanzibar": "Tanzania",
    "basutoland": "Lesotho",
    "bechuanaland": "Botswana",
    "swaziland": "Eswatini",
    "upper volta": "Burkina Faso",
    "french sudan": "Mali",
    "togoland": "Togo",
    "ubangi-shari": "Central African Republic",
    "belgian congo": "Democratic Republic of the Congo",
    "french congo": "Republic of the Congo",
    "congo free state": "Democratic Republic of the Congo",
    "mesopotamia": "Iraq",
    "persia": "Iran",
    "constantinople": "Istanbul",
    "asia minor": "Asia Minor",   # identity (already canonical)
    "anatolia": "Turkey",
    "nubia": "Sudan",
    "abyssinia": "Ethiopia",

    # ── Null sentinels — institutional placeholders, not place names ────────
    "n/a": None,
    "n.a.": None,
    "na": None,
    "unbekannt": None,
    "unknown": None,
    "nicht bekannt": None,

    # ── Group C: Spelling variants → Canonical English ─────────────────────
    "azerbaidjan": "Azerbaijan",
    "aserbaidschan": "Azerbaijan",
    "azerbeijan": "Azerbaijan",
    "azerbaïdjan": "Azerbaijan",
    # Mixed Latin/Cyrillic and pure Cyrillic forms for Iran
    "i\u0440\u0430\u043d": "Iran",    # Iран (Latin I + Cyrillic ран)
    "\u0418\u0440\u0430\u043d": "Iran",  # Иран  (pure Cyrillic)
    "egypte": "Egypt",
    "égypte": "Egypt",
    "algérie": "Algeria",
    "tunisie": "Tunisia",
    "maroc": "Morocco",
    "coree": "Korea",
    "corée": "Korea",
    "corea": "Korea",
    "afganistan": "Afghanistan",
    "afgahnistan": "Afghanistan",
    "filipinas": "Philippines",
    "filippines": "Philippines",
    "srilanka": "Sri Lanka",
    "sri-lanka": "Sri Lanka",
    "new guinea": "Papua New Guinea",
    "kongo (demokratische republik)": "Democratic Republic of the Congo",
    "kongo (republik)": "Republic of the Congo",
    "kongo-kinshasa": "Democratic Republic of the Congo",
    "kongo-brazzaville": "Republic of the Congo",
    "ussr": "Russia",
    "soviet union": "Russia",
    "jugoslawien": "Yugoslavia",  # historical — keep as-is or mark as region
    "tschechoslowakei": "Czechoslovakia",  # historical
    "ostpakistan": "Bangladesh",
    "bengladesh": "Bangladesh",
    "bangladesch": "Bangladesh",
    "cambodge": "Cambodia",
    "cambogia": "Cambodia",
    "laos": "Laos",  # identity
    "viet nam": "Vietnam",
    "viet-nam": "Vietnam",

    # ── Group D: German compound/directional forms → English ───────────────
    # Countries / regions with directional prefix
    "südmarokko": "Southern Morocco",
    "südafrika (republik)": "South Africa",
    "nordkorea": "North Korea",
    "südkorea": "South Korea",
    "osttimor": "East Timor",
    "westtimor": "West Timor",
    "südwest-timor": "Southwest Timor",
    "nordost-timor": "Northeast Timor",
    "nordluzon": "North Luzon",
    "südsudan": "South Sudan",
    "nordvietnam": "North Vietnam",
    "südvietnam": "South Vietnam",
    "süditalien": "South Italy",
    "südliches afrika": "Southern Africa",
    "südwestafrika (region)": "Southwest Africa",
    "süd-patagonien": "South Patagonia",
    "nordostafrika": "Northeast Africa",
    "nordwestafrika": "Northwest Africa",
    "rumänien": "Romania",
    "österreich": "Austria",
    "dänemark": "Denmark",
    "großbritannien": "Great Britain",
    "palästina": "Palestine",
    "palästinensische gebiete": "Palestinian Territories",
    "äquatorialguinea": "Equatorial Guinea",
    "russische föderation": "Russia",
    "böotien": "Boeotia",
    "attika (region)": "Attica",
    "peloponnes (region)": "Peloponnese",
    "piräus": "Piraeus",
    "große antillen": "Greater Antilles",
    "osterinsel": "Easter Island",
    "ostgrönland": "East Greenland",
    "südruβland": "South Russia",
    "nördliches china": "North China",
    "süd-china": "South China",
    "süd-sibirien": "South Siberia",
    "nordost-sibirien": "Northeast Siberia",
    "ostanatolien": "Eastern Anatolia",
    "südost-australien": "Southeast Australia",
    "süd-australien": "South Australia",
    "westmexiko": "West Mexico",
    "nordwestliches indien": "Northwest India",
    "nordwestliches pakistan": "Northwest Pakistan",
    "nordwest (mongolei)": "Northwest (Mongolia)",
    "süd-bali (indonesien)": "South Bali (Indonesia)",
    "süd-maprik": "South Maprik",
    "süd-usaramo": "South Usaramo",
    "süd-tunesien": "South Tunisia",
    "süd-malekula": "South Malekula",
    "süd-simbabwe": "South Zimbabwe",
    "südost-neuguinea": "Southeast New Guinea",
    "nordost-neuguinea": "Northeast New Guinea",
    "nordwestküste von neuirland": "Northwest Coast of New Ireland",
    "nordostküste von neuirland": "Northeast Coast of New Ireland",
    "süd-neuirland": "South New Ireland",
    "nordinsel": "North Island",

    # German city names with (country) qualifier
    "theben (ägypten)": "Thebes (Egypt)",
    "memphis (ägypten)": "Memphis (Egypt)",
    "abydos (ägypten)": "Abydos (Egypt)",
    "oberägypten": "Upper Egypt",
    "unterägypten": "Lower Egypt",
    "täbris": "Tabriz",
    "ürümqi": "Urumqi",
    "köln": "Cologne",
    "kanada (nordwestküste)": "Canada (Northwest Coast)",
    "nordamerika (nordwestküste)": "North America (Northwest Coast)",
    "golfküste (mexiko)": "Gulf Coast (Mexico)",
    "westküste kleinasiens (türkei)": "West Coast of Asia Minor (Turkey)",
    "kleinasien, westküste": "Asia Minor, West Coast",
    "magnesia am mäander": "Magnesia on the Meander",
    "burg greifenstein (südtirol)": "Greifenstein Castle (South Tyrol)",
    "east london (südafrika)": "East London (South Africa)",

    # Coasts / straits / geographic features
    "schwarzmeerküste": "Black Sea Coast",
    "miskitoküste": "Mosquito Coast",
    "sklavenküste": "Slave Coast",
    "loangoküste": "Loango Coast",
    "admiralitätsinseln": "Admiralty Islands",
    "torres-straße": "Torres Strait",
    "lenamündung": "Lena River Delta",
    "nordwestprovinz": "Northwest Province",
    "östlicher mittelmeerraum": "Eastern Mediterranean",
    "atacama-wüste": "Atacama Desert",
    "westufer des nördlichen nyassa": "West Shore of Northern Lake Nyasa",

    # Kingdoms
    "königreich benin": "Kingdom of Benin",
    "königreich loango": "Kingdom of Loango",
    "königreich bamum": "Kingdom of Bamum",
    "marion (königreich)": "Kingdom of Marion",

    # POW camps
    "kriegsgefangenenlager wünsdorf (wwi)": "POW Camp Wünsdorf (WWI)",
    "kriegsgefangenenlager göttingen (wwi)": "POW Camp Göttingen (WWI)",
    "kriegsgefangenenlager görlitz (wwi)": "POW Camp Görlitz (WWI)",

    # Thousand Buddha cave complexes
    "tausend-buddha-höhlen von kizil": "Kizil Thousand Buddha Caves",
    "tausend-buddha-höhlen von kumtura": "Kumtura Thousand Buddha Caves",
    "tausend-buddha-höhlen von senmusaimu": "Senmusaimu Thousand Buddha Caves",
    "tausend-buddha-höhlen von bäzäklik": "Bezeklik Thousand Buddha Caves",
    "höhlentempel von toyuq": "Toyuq Cave Temple",

    # Regions (with German qualifier)
    "lindi (region)": "Lindi Region",
    "arusha (region)": "Arusha Region",
    "tanga (region)": "Tanga Region",
    "mwanza (region)": "Mwanza Region",
    "rukwa (region)": "Rukwa Region",
    "sambesi (region)": "Zambezi Region",

    # Japanese prefectures
    "präfektur saga": "Saga Prefecture",
    "präfektur fukuoka": "Fukuoka Prefecture",
    "präfektur nara": "Nara Prefecture",
    "präfektur okinawa": "Okinawa Prefecture",
    "präfektur okayama": "Okayama Prefecture",
    "präfektur wakayama": "Wakayama Prefecture",
    "präfektur mie": "Mie Prefecture",
    "präfektur shimane": "Shimane Prefecture",
    "präfektur hyogo": "Hyogo Prefecture",
    "präfektur shiga": "Shiga Prefecture",
    "präfektur nagasaki": "Nagasaki Prefecture",
    "präfektur tochigi": "Tochigi Prefecture",
    "präfektur ōsaka": "Osaka Prefecture",
    "präfektur kumamoto": "Kumamoto Prefecture",
    "präfektur kyōto": "Kyoto Prefecture",
    "präfektur hiroshima": "Hiroshima Prefecture",
    "präfektur tottori": "Tottori Prefecture",
    "präfektur kagawa": "Kagawa Prefecture",
    "präfektur shizuoka": "Shizuoka Prefecture",
    "präfektur niigata": "Niigata Prefecture",
    "präfektur kōchi": "Kochi Prefecture",
    "präfektur kagoshima": "Kagoshima Prefecture",
    "präfektur gifu": "Gifu Prefecture",
    "anraku-ji (präfektur saitama)": "Anraku-ji (Saitama Prefecture)",

    # Waterfalls / kilns / rivers
    "kegon-fälle": "Kegon Falls",
    "ryūzu-fälle": "Ryuzu Falls",
    "yue-öfen": "Yue Kilns",
    "longquan-öfen": "Longquan Kilns",
    "keram (fluß)": "Keram River",
    "lunangwa (fluß)": "Lunangwa River",

    # ── Group E: German compound/prepositional place descriptions ──────────
    # These previously fell through to the descriptive-phrase filter, which
    # treated "der/des/von/und/bei" as disqualifying — but that's ordinary
    # German grammar inside a real place name ("Tal von Mexiko" = "Valley of
    # Mexico"), not a hedge. Covers the ~45 highest-frequency (~83% of 745
    # affected rows) values from the 2026-07-26 audit; the long tail of
    # one-off/low-count values is left for a future pass.
    "bei lima": "Near Lima",
    "zwischen ica und pisco": "Between Ica and Pisco",
    "gegend von la serena": "Near La Serena",
    "hacienda de casa grande (bei trujillo)": "Hacienda de Casa Grande (near Trujillo)",
    "kriegsgefangenenlager frankfurt (oder) (wwi)": "POW Camp Frankfurt (Oder) (WWI)",
    "hochland von guatemala": "Guatemalan Highlands",
    "san juanico bei tamba d.f.": "San Juanico (near Tamba, D.F.)",
    "san juanico bei tamba": "San Juanico (near Tamba)",
    "s. juanico bei tamba, d.f.": "San Juanico (near Tamba, D.F.)",
    "tal von mexiko": "Valley of Mexico",
    "temenos der aphrodite am dali-fluß (dali)": "Temenos of Aphrodite on the Dali River (Dali)",
    "temenos der aphrodite am dali-fluß": "Temenos of Aphrodite on the Dali River",
    "toksu bei kucha": "Toksu (near Kucha)",
    "bosnien und herzegowina": "Bosnia and Herzegovina",
    "st. kitts und nevis": "St. Kitts and Nevis",
    "tabuco bei tuxpam": "Tabuco (near Tuxpam)",
    "tabuco bei taxpam": "Tabuco (near Taxpam)",
    "paso bei fuerte quemado": "Paso (near Fuerte Quemado)",
    "pucarilla bei icla": "Pucarilla (near Icla)",
    "höhle der priesterweihe": "Cave of the Priestly Consecration",
    "tomates bei tarija": "Tomates (near Tarija)",
    "nördlich von rom": "North of Rome",
    "magdalena bei lima": "Magdalena (near Lima)",
    "cerro de s. pedro bei misantla": "Cerro de S. Pedro (near Misantla)",
    "zwischen tempel 12 und 25": "Between Temple 12 and 25",
    "bei arica": "Near Arica",
    "zwischen petschora und ob": "Between Pechora and Ob",
    "gegend von papantla": "Near Papantla",
    "höhle von campur": "Cave of Campur",
    "unterlauf des niger": "Lower Niger (river)",
    "jammu und kashmir": "Jammu and Kashmir",
    "grab des maja": "Grave of Maja",
    "umgebung von bugaba": "Vicinity of Bugaba",
    "lager bei kaulagu": "Camp (near Kaulagu)",
    "licerra bei arica": "Licerra (near Arica)",
    "moschee des amin khoja": "Mosque of Amin Khoja",
    "totentempel des sahure (abusir)": "Mortuary Temple of Sahure (Abusir)",
    "zwischen neuss und xanten": "Between Neuss and Xanten",
    "santiago anizotla bei azcapotzalco": "Santiago Anizotla (near Azcapotzalco)",
    "sistan und belutschistan": "Sistan and Baluchestan",
    "bamugong (bei batukam)": "Bamugong (near Batukam)",
}

# Normalise lookup keys to lowercase + strip for O(1) match
LOOKUP: dict[str, str] = {k.lower().strip(): v for k, v in _LOOKUP_RAW.items()}

# ---------------------------------------------------------------------------
# Descriptive-phrase & hedge-word filter
# Any place_name matching these patterns is institutional prose (a hedged or
# uncertain attribution), not a confirmed place name. Normalised result for
# these is NULL.
#
# Deliberately does NOT include bare German connectors (der/des/von/und/aus/
# oder/bei/nach) — those are ordinary grammar inside real German place names
# ("Totentempel des Sahure" = "Mortuary Temple *of* Sahure", "Tal von Mexiko"
# = "Valley of Mexico"), not a signal of uncertainty. An earlier version of
# this regex treated them as disqualifying, which nulled out ~745 rows of
# perfectly good (if untranslated) German place names — see the 2026-07-26
# provenance-display audit. Only genuine German hedge/uncertainty words are
# listed here, mirroring the English hedge list above them.
# ---------------------------------------------------------------------------
_DESCRIPTIVE_RE = re.compile(
    r"\b("
    r"probably|possibly|perhaps|presumably|uncertain|unknown|unidentified|"
    r"based on|coast of|region of|area of|vicinity of|"
    r"near|attributed to|supposedly|"
    r"vermutlich|wahrscheinlich|möglicherweise|vielleicht|angeblich|"
    r"unsicher|ungewiss|unbestimmt"
    r")\b",
    re.IGNORECASE,
)
MAX_PLACE_NAME_LEN = 50

# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def get_conn() -> psycopg2.extensions.connection:
    return psycopg2.connect(
        host=os.environ["DB_HOST"],
        port=int(os.environ.get("DB_PORT", 5432)),
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
    )


def column_exists(cur: psycopg2.extensions.cursor, table: str, column: str) -> bool:
    cur.execute(
        """
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = %s AND column_name = %s
        """,
        (table, column),
    )
    return cur.fetchone() is not None


# ---------------------------------------------------------------------------
# Normalization engine
# ---------------------------------------------------------------------------

def normalize(
    raw: str,
    existing_normalized: set[str],
) -> tuple[str | None, str]:
    """
    Normalise a single raw place_name.

    Returns:
        (normalized_value, match_method)
        normalized_value = None  →  "descriptive" (institutional note, set DB col to NULL)
        normalized_value = raw   →  "unchanged" (no resolution found)
    """
    stripped = raw.strip()
    key = stripped.lower()

    # ── Step a: lookup table (checked first so explicit entries are never
    #    clobbered by the descriptive filter below) ───────────────────────────
    if key in LOOKUP:
        return LOOKUP[key], "lookup"

    # ── Step e: descriptive / too long / German stopword filter → NULL ──────
    if len(stripped) > MAX_PLACE_NAME_LEN or _DESCRIPTIVE_RE.search(stripped):
        return None, "descriptive"

    # ── Step b: language detection — German names not yet resolved ───────────
    lang = detect_lang(stripped)
    # If German but not in lookup, fall through to fuzzy.
    # Logging is intentionally omitted here to avoid noisy output on large datasets.

    # ── Step d: fuzzy deduplication against known normalised values ──────────
    if HAS_RAPIDFUZZ and existing_normalized:
        best_score = 0
        best_match: str | None = None
        for candidate in existing_normalized:
            score = token_sort_ratio(stripped, candidate)
            if score > best_score:
                best_score = score
                best_match = candidate
        if best_score >= 88 and best_match is not None:
            return best_match, f"fuzzy({best_score:.0f})"

    return stripped, "unchanged"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=(
            "Normalize place_name → place_name_normalized in museum_objects. "
            "Defaults to --dry-run (no DB writes)."
        )
    )
    p.add_argument(
        "--apply",
        action="store_true",
        default=False,
        help="Write normalized values to the database. Without this flag, runs in dry-run mode.",
    )
    return p.parse_args()


def main() -> None:
    args = parse_args()
    dry_run = not args.apply

    required = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"]
    missing = [v for v in required if not os.environ.get(v)]
    if missing:
        log.error("Missing environment variables: %s", ", ".join(missing))
        sys.exit(1)

    conn = get_conn()
    log.info(
        "Connected to DB: %s@%s/%s",
        os.environ["DB_USER"],
        os.environ["DB_HOST"],
        os.environ["DB_NAME"],
    )
    mode_label = "DRY-RUN" if dry_run else "APPLY"
    log.info("Mode: %s", mode_label)

    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Check for manually-verified guard column
        has_verified_col = column_exists(
            cur, "museum_objects", "place_name_manually_verified"
        )
        log.info(
            "place_name_manually_verified column present: %s", has_verified_col
        )

        # ── 1. Load existing normalised values for fuzzy target set ─────────
        cur.execute(
            """
            SELECT DISTINCT place_name_normalized
            FROM museum_objects
            WHERE place_name_normalized IS NOT NULL
              AND place_name_normalized <> ''
            """
        )
        existing_normalized: set[str] = {
            row["place_name_normalized"] for row in cur.fetchall()
        }
        log.info(
            "Loaded %d existing normalised values for fuzzy dedup target set",
            len(existing_normalized),
        )

        # ── 2. Fetch distinct unresolved place_name values ───────────────────
        verified_clause = (
            "AND (place_name_manually_verified IS NULL "
            "     OR place_name_manually_verified = FALSE)"
            if has_verified_col
            else ""
        )
        cur.execute(
            f"""
            SELECT
                place_name,
                COUNT(*) AS row_count
            FROM museum_objects
            WHERE place_name IS NOT NULL
              AND (
                  place_name_normalized IS NULL
                  OR place_name_normalized = place_name
              )
              {verified_clause}
            GROUP BY place_name
            ORDER BY COUNT(*) DESC
            """
        )
        rows = cur.fetchall()
        log.info("Found %d distinct unresolved place_name values", len(rows))

        # ── 3. Normalise each value ──────────────────────────────────────────
        report: list[dict] = []
        # Only collect updates where the result differs from the raw value
        updates: list[tuple[str | None, str]] = []

        for row in rows:
            raw: str = row["place_name"]
            count: int = row["row_count"]

            normalized, method = normalize(raw, existing_normalized)

            needs_update = (
                normalized is None  # descriptive filter OR null sentinel in lookup
                or normalized != raw  # found a better canonical form
            )
            if needs_update:
                updates.append((normalized, raw))

            report.append(
                {
                    "original_place_name": raw,
                    "normalized_result": normalized
                    if normalized is not None
                    else "NULL",
                    "match_method": method,
                    "affected_row_count": count,
                }
            )

        # Report is already sorted DESC by row_count (query ORDER BY)

        # ── 4. Save CSV report ───────────────────────────────────────────────
        REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(REPORT_PATH, "w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(
                fh,
                fieldnames=[
                    "original_place_name",
                    "normalized_result",
                    "match_method",
                    "affected_row_count",
                ],
            )
            writer.writeheader()
            writer.writerows(report)
        log.info("Full report saved → %s", REPORT_PATH)

        # ── 5. Print first 30 rows ───────────────────────────────────────────
        header = (
            f"{'original_place_name':<46}"
            f"{'normalized_result':<36}"
            f"{'match_method':<20}"
            f"{'affected_row_count':>20}"
        )
        sep = "─" * len(header)
        print(f"\n{sep}")
        print(header)
        print(sep)
        for r in report[:30]:
            print(
                f"{r['original_place_name'][:45]:<46}"
                f"{r['normalized_result'][:35]:<36}"
                f"{r['match_method']:<20}"
                f"{r['affected_row_count']:>20}"
            )
        print(sep)
        print(
            f"  Total distinct unresolved values: {len(report)}"
            f"  |  Would update: {len(updates)}"
        )
        print()

        # ── 6. Apply updates (--apply only) ─────────────────────────────────
        if dry_run:
            log.info(
                "[dry-run] %d updates identified. Re-run with --apply to write to DB.",
                len(updates),
            )
            return

        log.info("Applying %d updates to museum_objects …", len(updates))
        verified_and = (
            "AND (place_name_manually_verified IS NULL "
            "     OR place_name_manually_verified = FALSE)"
            if has_verified_col
            else ""
        )
        try:
            cur.execute("ALTER TABLE museum_objects DISABLE TRIGGER ALL")
            total_rows = 0
            for normalized_val, original in updates:
                cur.execute(
                    f"""
                    UPDATE museum_objects
                    SET place_name_normalized = %s
                    WHERE place_name = %s
                      AND (
                          place_name_normalized IS NULL
                          OR place_name_normalized = place_name
                      )
                      {verified_and}
                    """,
                    (normalized_val, original),
                )
                total_rows += cur.rowcount
            cur.execute("ALTER TABLE museum_objects ENABLE TRIGGER ALL")
            conn.commit()
            log.info(
                "Committed. %d distinct values updated → %d total rows affected.",
                len(updates),
                total_rows,
            )
        except Exception:
            conn.rollback()
            # Re-enable triggers even on failure
            try:
                plain_cur = conn.cursor()
                plain_cur.execute(
                    "ALTER TABLE museum_objects ENABLE TRIGGER ALL"
                )
                conn.commit()
            except Exception:
                pass
            log.exception("Update failed — transaction rolled back.")
            sys.exit(1)

    finally:
        conn.close()

    log.info("Done.")


if __name__ == "__main__":
    main()
