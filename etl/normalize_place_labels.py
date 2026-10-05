#!/usr/bin/env python3
"""
normalize_place_labels.py — Clean up site labels (place_name_normalized) without
losing source data or adding false precision.

Two columns only:
  place_name             raw source string — never changed (also the geocoder input)
  place_name_normalized  stored label: English, keeps disambiguating tags
                         ("Kano (State)"), drops tags that only repeat country_en
                         ("Owo (Nigeria)" -> "Owo")
The UI hides a remaining tag when no other place in the same list shares the
base name (frontend/lib/place-label.ts), so "Kano (State)" usually shows as "Kano".

Per current site label (COALESCE(place_name_normalized, city_en), per country):
  strip      trailing "(<country>)" that matches country_en
  translate  German generic term in a tag -> English (Bundesstaat -> State, Fluss -> River …)
  merge      result equals another label in the same country AND centroids ≤ MERGE_KM apart
  flag       anything that needs a human: country tag ≠ country_en, country missing,
             same name but different coordinates, German left in the label,
             historical/contested name, "?" (uncertain attribution)
Flags never change the label. Nothing here invents or moves coordinates.

Usage:
    python etl/normalize_place_labels.py propose [--institution NAME] [--country NAME]
        → etl/reports/place_label_proposal.csv (no DB writes)
    python etl/normalize_place_labels.py apply --dry-run   # transaction + counts, rolled back
    python etl/normalize_place_labels.py apply             # writes; then restart Strapi
Rows with review_status = 'verified' are never touched. Notes are appended with
a [label-review] tag (once), never overwritten. Approved 2026-10-05.
"""

import argparse
import csv
import math
import os
import re
import sys
import unicodedata
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
REPORT = os.path.join(HERE, "reports", "place_label_proposal.csv")
MISSING_COUNTRY_REPORT = os.path.join(HERE, "reports", "place_label_missing_country.csv")
COUNTRY_INFO = os.path.join(HERE, "data", "gazetteer", "countryInfo.txt")
MERGE_KM = 2.0

# German generic terms → English, only when they are the whole tag (or tag word).
GENERIC_TERMS = {
    "stadt": "City", "provinz": "Province", "distrikt": "District", "bezirk": "District",
    "kreis": "District", "bundesstaat": "State", "staat": "State", "region": "Region",
    "gebiet": "Area", "landschaft": "Region", "fluss": "River", "insel": "Island",
    "inseln": "Islands", "halbinsel": "Peninsula", "berg": "Mountain", "gebirge": "Mountains",
    "unterlauf": "Lower course", "oberlauf": "Upper course", "küste": "Coast", "see": "Lake",
    "tal": "Valley", "dorf": "Village", "hafen": "Harbour", "oase": "Oasis",
    "departement": "Department", "gouvernement": "Governorate", "königreich": "Kingdom",
}

# German country names seen in tags → English (as in country_en).
GERMAN_COUNTRIES = {
    "kolumbien": "Colombia", "tansania": "Tanzania", "bolivien": "Bolivia", "indonesien": "Indonesia",
    "papua neuguinea": "Papua New Guinea", "papua-neuguinea": "Papua New Guinea", "australien": "Australia",
    "indien": "India", "argentinien": "Argentina", "ägypten": "Egypt", "brasilien": "Brazil",
    "mexiko": "Mexico", "kamerun": "Cameroon", "kenia": "Kenya", "äthiopien": "Ethiopia",
    "südafrika": "South Africa", "kanada": "Canada", "vereinigte staaten": "United States", "usa": "United States",
    "türkei": "Turkey", "griechenland": "Greece", "italien": "Italy", "zypern": "Cyprus", "syrien": "Syria",
    "irak": "Iraq", "libanon": "Lebanon", "russland": "Russia", "spanien": "Spain", "frankreich": "France",
    "deutschland": "Germany", "kuba": "Cuba", "philippinen": "Philippines", "neuseeland": "New Zealand",
    "marokko": "Morocco", "tunesien": "Tunisia", "algerien": "Algeria", "libyen": "Libya",
    "elfenbeinküste": "Ivory Coast", "mosambik": "Mozambique", "sambia": "Zambia", "simbabwe": "Zimbabwe",
    "kambodscha": "Cambodia", "japan": "Japan", "china": "China", "jemen": "Yemen", "jordanien": "Jordan",
    "saudi-arabien": "Saudi Arabia", "afghanistan": "Afghanistan", "usbekistan": "Uzbekistan",
    "kasachstan": "Kazakhstan", "mongolei": "Mongolia", "tibet": "Tibet", "nepal": "Nepal",
    "sri lanka": "Sri Lanka", "thailand": "Thailand", "malaysia": "Malaysia", "paraguay": "Paraguay",
    "ecuador": "Ecuador", "chile": "Chile", "peru": "Peru", "guatemala": "Guatemala", "venezuela": "Venezuela",
}

# German exonyms that show up inside tags; flagged as mixed language with a suggestion.
GERMAN_EXONYMS = {"rom": "Rome", "kalifornien": "California", "neapel": "Naples", "mailand": "Milan",
                  "venedig": "Venice", "florenz": "Florence", "athen": "Athens", "kairo": "Cairo"}

# Historical or contested names: never modernized silently — flagged with a note.
CONTESTED = {
    "persia": "historical name (Iran)", "persien": "historical name (Iran)", "ceylon": "historical name (Sri Lanka)",
    "siam": "historical name (Thailand)", "burma": "name in dispute (Myanmar)", "birma": "name in dispute (Myanmar)",
    "formosa": "historical name (Taiwan)", "zaire": "historical name (DR Congo)", "dahomey": "historical name (Benin)",
    "gold coast": "historical name (Ghana)", "goldküste": "historical name (Ghana)", "rhodesia": "historical name",
    "rhodesien": "historical name", "abessinien": "historical name (Ethiopia)", "abyssinia": "historical name (Ethiopia)",
    "mesopotamien": "historical region", "mesopotamia": "historical region", "konstantinopel": "historical name (Istanbul)",
    "constantinople": "historical name (Istanbul)", "smyrna": "historical name (İzmir)", "byzanz": "historical name",
    "preußen": "historical state", "prussia": "historical state", "böhmen": "historical region", "bohemia": "historical region",
    "jugoslawien": "former state", "yugoslavia": "former state", "sowjetunion": "former state", "soviet union": "former state",
    "tschechoslowakei": "former state", "czechoslovakia": "former state", "osmanisches reich": "former state",
    "ottoman empire": "former state", "deutsch-ostafrika": "colonial name", "deutsch-südwestafrika": "colonial name",
    "kaiser-wilhelmsland": "colonial name", "niederländisch-indien": "colonial name", "kurdistan": "contested region", "kaschmir": "contested region",
    "kashmir": "contested region", "krim": "contested territory", "crimea": "contested territory",
    "western sahara": "contested territory", "westsahara": "contested territory",
    # Palestine is treated as a country like any other (project decision, 2026-10-05).
    "taiwan": "partially recognized state", "kosovo": "partially recognized state",
    "northern cyprus": "disputed territory", "turkish republic of northern cyprus": "disputed territory",
}

GERMAN_IN_TEXT = re.compile(
    r"\b(bundesstaat|unterlauf|oberlauf|gebiet|provinz|bezirk|kreis|insel|fluss|küste|hochland|umgebung|bei|nahe|"
    r"nördlich|südlich|östlich|westlich|stadt|dorf|landschaft|mündung|gebirge)\b",
    re.IGNORECASE,
)
TRAILING_TAG = re.compile(r"^(?P<base>.*\S)\s*\((?P<tag>[^()]*)\)\s*$")


def key(value):
    """Case/accent-insensitive comparison key (same as normalizePlaceName in origins.ts)."""
    decomposed = unicodedata.normalize("NFKD", value or "")
    return " ".join("".join(c for c in decomposed if not unicodedata.category(c).startswith("M")).lower().split())


def english_countries():
    names = set()
    with open(COUNTRY_INFO, encoding="utf-8") as f:
        for line in f:
            if not line.startswith("#") and line.strip():
                parts = line.split("\t")
                if len(parts) > 4:
                    names.add(key(parts[4]))
    return names


def haversine_km(a, b):
    (lat1, lon1), (lat2, lon2) = a, b
    p = math.pi / 180
    h = math.sin((lat2 - lat1) * p / 2) ** 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lon2 - lon1) * p / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def classify(label, country, en_countries):
    """Return (proposed_label, actions[], reasons[], flags[]) for one current label."""
    proposed, actions, reasons, flags = label, [], [], []
    m = TRAILING_TAG.match(label)
    if m:
        base, tag = m.group("base"), m.group("tag").strip()
        tag_key = key(tag)
        tag_country = GERMAN_COUNTRIES.get(tag.lower()) or (tag if tag_key in en_countries else None)
        if tag == "?" or tag_key == "?":
            flags.append("uncertain attribution '(?)' — left as is")
        elif tag_country:
            if not country:
                flags.append(f"country missing; tag says {tag_country}")
            elif key(tag_country) == key(country):
                proposed = base
                actions.append("strip")
                reasons.append(f"tag repeats country_en ({country})")
            else:
                flags.append(f"country mismatch: tag says {tag_country}, country_en is {country}")
        elif tag_key in GENERIC_TERMS and GENERIC_TERMS[tag_key] != tag:
            proposed = f"{base} ({GENERIC_TERMS[tag_key]})"
            actions.append("translate")
            reasons.append(f"'{tag}' → '{GENERIC_TERMS[tag_key]}'; tag kept (disambiguates)")
        elif tag_key in GERMAN_EXONYMS:
            flags.append(f"mixed language: tag '{tag}' (English: {GERMAN_EXONYMS[tag_key]})")
    if GERMAN_IN_TEXT.search(TRAILING_TAG.sub(r"\g<base>", proposed) if TRAILING_TAG.match(proposed) else proposed):
        flags.append("German words left in label — manual translation")
    # A bare "Congo"/"Kongo" can mean either country; full names and "(River)" can't.
    if key(label) in ("kongo", "congo"):
        flags.append("historical/contested: ambiguous (two Congos)")
    for name, note in CONTESTED.items():
        if re.search(rf"(^|[\s(,]){re.escape(name)}($|[\s),])", key(label)):
            flags.append(f"historical/contested: {note}")
            break
    if not country:
        if not any(f.startswith("country missing") for f in flags):
            flags.append("country missing")
    return proposed, actions, reasons, flags


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


LABEL_SQL = "COALESCE(NULLIF(BTRIM(place_name_normalized), ''), NULLIF(BTRIM(city_en), ''))"


def load_labels(cur, institution=None, country=None):
    where, params = ["published_at IS NOT NULL", f"{LABEL_SQL} IS NOT NULL"], []
    if institution:
        where.append("institution_name = %s"); params.append(institution)
    if country:
        where.append("country_en = %s"); params.append(country)
    cur.execute(
        f"""
        SELECT {LABEL_SQL} AS label, country_en, COUNT(*) AS n,
               AVG(COALESCE(manual_latitude, latitude)) AS lat, AVG(COALESCE(manual_longitude, longitude)) AS lon,
               array_agg(DISTINCT institution_name) AS museums,
               (array_agg(DISTINCT place_name))[1:3] AS raw_examples
        FROM museum_objects WHERE {' AND '.join(where)}
        GROUP BY {LABEL_SQL}, country_en
        """,
        params,
    )
    return cur.fetchall()


def build_proposal(rows):
    en_countries = english_countries()
    by_key = defaultdict(list)  # (country, label key) → rows, to detect merges
    for r in rows:
        by_key[(key(r[1] or ""), key(r[0]))].append(r)

    out, missing_country = [], []
    for label, country, n, lat, lon, museums, raw in rows:
        proposed, actions, reasons, flags = classify(label, country, en_countries)
        if proposed != label:
            targets = [t for t in by_key.get((key(country or ""), key(proposed)), []) if t[0] != label]
            if targets:
                t = max(targets, key=lambda x: x[2])
                if None not in (lat, lon, t[3], t[4]) and haversine_km((lat, lon), (t[3], t[4])) <= MERGE_KM:
                    actions.append("merge")
                    reasons.append(f"same place as '{t[0]}' ({t[2]} objects, ≤{MERGE_KM:g} km)")
                    proposed = t[0]
                else:
                    flags.append(f"would duplicate '{t[0]}' at different coordinates — keep separate")
                    proposed, actions, reasons = label, [], []
        if not actions and not flags:
            continue
        record = {
            "original": label,
            "proposed_label": proposed,
            "action": "+".join(actions) if actions else "flag",
            "reason": "; ".join(reasons + flags),
            "objects": n,
            "country_en": country or "",
            "museums": ", ".join(sorted(m for m in museums if m)),
            "raw_place_name_examples": " | ".join(x for x in (raw or []) if x),
            "_changes_label": proposed != label,
            "_flags": flags,
            "_reasons": reasons,
        }
        # A missing country_en with nothing else to say about the label is a data gap,
        # not a label decision — reported separately so it doesn't bury the table.
        (missing_country if not actions and flags == ["country missing"] else out).append(record)
    order = {"strip": 0, "translate": 1, "strip+merge": 2, "translate+merge": 3, "flag": 4}
    by_size = lambda r: (order.get(r["action"], 5), -r["objects"])
    return sorted(out, key=by_size), sorted(missing_country, key=by_size)


def cmd_propose(args):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            rows = load_labels(cur, args.institution, args.country)
    finally:
        conn.close()
    proposal, missing_country = build_proposal(rows)
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    for path, data in ((REPORT, proposal), (MISSING_COUNTRY_REPORT, missing_country)):
        with open(path, "w", newline="", encoding="utf-8") as f:
            fields = [k for k in data[0] if not k.startswith("_")] if data else ["original"]
            writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(data)
    summary = defaultdict(lambda: [0, 0])
    for p in proposal:
        summary[p["action"]][0] += 1
        summary[p["action"]][1] += p["objects"]
    print(f"{len(rows)} labels checked → {len(proposal)} need action or review. Written to {REPORT}")
    for action, (labels, objects) in sorted(summary.items()):
        print(f"  {action:<16} {labels:>5} labels  {objects:>6} objects")
    print(f"Plus {len(missing_country)} labels ({sum(r['objects'] for r in missing_country)} objects) whose only issue "
          f"is a missing country_en → {MISSING_COUNTRY_REPORT}")


DISPUTED_NOTES = {"contested region", "contested territory", "partially recognized state", "disputed territory"}
NOTE_TAG = "[label-review]"


def geocoding_status_for(flags):
    """disputed for contested places; ambiguous for location doubts; None for label-only issues (translation)."""
    status = None
    for flag in flags:
        if flag.startswith("historical/contested:"):
            note = flag.split(":", 1)[1].strip()
            if note in DISPUTED_NOTES:
                return "disputed"
            status = "ambiguous"
        elif flag.startswith(("country mismatch", "country missing", "would duplicate", "uncertain attribution")):
            status = "ambiguous"
    return status


COUNTS_SQL = f"""
SELECT
  COUNT(DISTINCT ({LABEL_SQL}, country_en))                                        AS site_labels,
  COUNT(DISTINCT ({LABEL_SQL}, country_en)) FILTER (WHERE {LABEL_SQL} ~* '\\((stadt|provinz|distrikt|bezirk|kreis|bundesstaat|staat|gebiet|landschaft|fluss|insel|inseln|halbinsel|berg|gebirge|unterlauf|oberlauf|küste|see|tal|dorf|hafen|oase|departement|gouvernement|königreich)\\)\\s*$') AS labels_with_german_tag,
  COUNT(*) FILTER (WHERE geocoding_status = 'ambiguous')                          AS ambiguous,
  COUNT(*) FILTER (WHERE geocoding_status = 'disputed')                           AS disputed,
  COUNT(*) FILTER (WHERE review_status = 'pending')                               AS review_pending,
  COUNT(*) FILTER (WHERE review_status = 'verified')                              AS review_verified
FROM museum_objects WHERE published_at IS NOT NULL
"""


def read_counts(cur):
    cur.execute(COUNTS_SQL)
    names = [d[0] for d in cur.description]
    return dict(zip(names, cur.fetchone()))


def cmd_apply(args):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            proposal, _ = build_proposal(load_labels(cur, args.institution, args.country))
            before = read_counts(cur)
            touched = defaultdict(int)
            skipped_verified = 0
            for rec in proposal:
                status = geocoding_status_for(rec["_flags"])
                note = f"{NOTE_TAG} {'; '.join(rec['_reasons'] + rec['_flags'])}"
                where = f"""{LABEL_SQL} = %(original)s AND country_en IS NOT DISTINCT FROM %(country)s
                            AND published_at IS NOT NULL"""
                params = {"original": rec["original"], "country": rec["country_en"] or None,
                          "proposed": rec["proposed_label"], "status": status, "note": note}
                cur.execute(f"SELECT COUNT(*) FROM museum_objects WHERE {where} AND review_status = 'verified'", params)
                skipped_verified += cur.fetchone()[0]
                cur.execute(
                    f"""
                    UPDATE museum_objects SET
                      place_name_normalized = {"%(proposed)s" if rec["_changes_label"] else "place_name_normalized"},
                      geocoding_status = CASE
                        WHEN %(status)s::text IS NULL OR geocoding_status = 'disputed' THEN geocoding_status
                        ELSE %(status)s::text END,
                      geocoding_notes = CASE
                        WHEN COALESCE(geocoding_notes, '') LIKE '%%{NOTE_TAG}%%' THEN geocoding_notes
                        ELSE concat_ws(' | ', NULLIF(geocoding_notes, ''), %(note)s::text) END,
                      review_status = 'pending'
                    WHERE {where} AND COALESCE(review_status, '') <> 'verified'
                    """,
                    params,
                )
                touched[rec["action"]] += cur.rowcount
            after = read_counts(cur)

            print("Rows updated per action:")
            for action, n in sorted(touched.items()):
                print(f"  {action:<16} {n:>6}")
            print(f"Skipped (review_status = verified, left untouched): {skipped_verified}")
            print(f"\n{'':26}{'before':>9}{'after':>9}")
            for k in before:
                print(f"  {k:<24}{before[k]:>9}{after[k]:>9}")

            if args.dry_run:
                conn.rollback()
                print("\nDry run — rolled back, nothing written.")
            else:
                conn.commit()
                print("\nCommitted. Restart Strapi to rebuild the map views.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("propose", help="write the proposal CSV (no DB writes)")
    p.add_argument("--institution")
    p.add_argument("--country")
    a = sub.add_parser("apply", help="apply the approved proposal (review_status -> pending)")
    a.add_argument("--dry-run", action="store_true", help="run everything in a transaction, print counts, roll back")
    a.add_argument("--institution")
    a.add_argument("--country")
    args = parser.parse_args()
    if args.command == "propose":
        cmd_propose(args)
    else:
        cmd_apply(args)


if __name__ == "__main__":
    main()
