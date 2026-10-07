#!/usr/bin/env python3
"""
translate_place_labels.py — English labels for places still named in German.

SMB records name places in German ("Kalifornien", "Sibirien", "Feuerland",
"Titicacasee"). When no curated place_name_normalized exists, the map falls back
to city_en, which for these rows is the German name too. This script proposes an
English label from Wikidata and, after review, writes it to
place_name_normalized (place_name and city_en stay as they are).

A translation is only proposed when all of these hold:
  - the label is not already a GeoNames name in that country (then it isn't German)
  - a Wikidata item has exactly this German label or alias
  - the item has coordinates (P625) — a place, not a concept ("Grasland")
  - the item is in the row's country (P17, or is that country) — so "Unterstadt"
    does not become a district of Prague
  - its English label differs from the German one
"Base (Tag)" labels are translated part by part ("San José (Kalifornien)" →
"San José (California)"). Anything else is left alone — no guessing.

Usage (from etl/):
    python translate_place_labels.py propose      # Wikidata lookups → reports/place_label_translations.csv
    python translate_place_labels.py apply --dry-run
    python translate_place_labels.py apply        # only rows still without place_name_normalized
Restart Strapi afterwards so the map views pick up the labels.
"""

import argparse
import csv
import json
import os
import re
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import audit_places as ap

HERE = os.path.dirname(os.path.abspath(__file__))
REPORT = os.path.join(HERE, "reports", "place_label_translations.csv")
CACHE = os.path.join(HERE, "reports", "wikidata_de_labels.json")
UA = {"User-Agent": "ExSitu/1.0 (+https://exsitu.app; place label translation)"}
NOTE_TAG = "[label-translate]"
API = "https://www.wikidata.org/w/api.php?"


def wd_get(params):
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(API + urllib.parse.urlencode(params), headers=UA),
                                        timeout=30) as resp:
                return json.load(resp)
        except Exception:
            time.sleep(5 * (attempt + 1))
    raise RuntimeError("Wikidata unreachable")


def lookup(label):
    """Wikidata places whose German label/alias is exactly `label`: [(qid, english, iso_codes)]."""
    found = wd_get({"action": "wbsearchentities", "search": label, "language": "de", "uselang": "de",
                    "type": "item", "limit": 7, "format": "json"}).get("search", [])
    ids = [h["id"] for h in found
           if h.get("match", {}).get("type") in ("label", "alias") and ap.key(h["match"]["text"]) == ap.key(label)]
    if not ids:
        return []
    ents = wd_get({"action": "wbgetentities", "ids": "|".join(ids[:5]), "props": "labels|claims",
                   "languages": "en", "format": "json"})["entities"]
    out, country_ids = [], set()
    for qid in ids[:5]:
        e = ents.get(qid, {})
        claims = e.get("claims", {})
        if "P625" not in claims:
            continue
        en = e.get("labels", {}).get("en", {}).get("value")
        own_iso = [c["mainsnak"]["datavalue"]["value"] for c in claims.get("P297", []) if "datavalue" in c["mainsnak"]]
        countries = [c["mainsnak"]["datavalue"]["value"]["id"] for c in claims.get("P17", []) if "datavalue" in c["mainsnak"]]
        country_ids.update(countries)
        out.append([qid, en, own_iso, countries])
    if country_ids:
        cents = wd_get({"action": "wbgetentities", "ids": "|".join(sorted(country_ids)[:50]), "props": "claims",
                        "format": "json"})["entities"]
        iso_of = {cid: [c["mainsnak"]["datavalue"]["value"] for c in cents.get(cid, {}).get("claims", {}).get("P297", [])
                        if "datavalue" in c["mainsnak"]] for cid in country_ids}
    else:
        iso_of = {}
    return [(qid, en, sorted(set(own + [i for c in cs for i in iso_of.get(c, [])]))) for qid, en, own, cs in out]


def translate(label, cc, cache):
    """English for one label part in country `cc`, or None."""
    if label not in cache:
        cache[label] = lookup(label)
        time.sleep(0.2)
    allowed = {cc, *ap.EXTRA_CODES.get(cc, [])}
    for qid, en, isos in cache[label]:
        if en and allowed & set(isos) and ap.key(en) != ap.key(label):
            return en, qid
    return None


def cmd_propose(_args):
    country_code, _names, towns, _extent, regions = ap.load_gazetteer()
    conn = ap.get_conn()
    with conn.cursor() as cur:
        cur.execute("""SELECT city_en, country_en, COUNT(*) FROM museum_objects
                       WHERE published_at IS NOT NULL AND NULLIF(BTRIM(place_name_normalized), '') IS NULL
                         AND NULLIF(BTRIM(city_en), '') IS NOT NULL AND country_en IS NOT NULL
                       GROUP BY 1, 2 ORDER BY 3 DESC""")
        groups = cur.fetchall()
    conn.close()
    cache = json.load(open(CACHE, encoding="utf-8")) if os.path.exists(CACHE) else {}

    def known(name, cc):
        k = ap.key(name.strip().rstrip("?").strip())
        return (k, cc) in towns or (k, cc) in regions or k in country_code

    todo = []
    for label, country, n in groups:
        cc = country_code.get(ap.key(country))
        if cc and not known(label, cc):
            todo.append((label, country, n, cc))
    print(f"{len(groups)} label/country pairs without an English label; {len(todo)} aren't GeoNames names — looking up", flush=True)

    def work(item):
        label, country, n, cc = item
        m = re.fullmatch(r"\s*(.+?)\s*\(([^()]+)\)\s*", label)
        parts = [m.group(1), m.group(2)] if m else [label]
        results = []
        for part in parts:
            hit = None if known(part, cc) else translate(part, cc, cache)
            results.append(hit)
        if not any(results):
            return None
        english = [r[0] if r else p for p, r in zip(parts, results)]
        new = f"{english[0]} ({english[1]})" if m else english[0]
        return {"label": label, "country": country, "objects": n, "english": new,
                "wikidata": " ".join(r[1] for r in results if r)}

    rows = []
    with ThreadPoolExecutor(max_workers=3) as pool:
        for i, r in enumerate(pool.map(work, todo), 1):
            if r:
                rows.append(r)
            if i % 250 == 0:
                print(f"  {i}/{len(todo)} looked up, {len(rows)} translations", flush=True)
                json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
    json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    with open(REPORT, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["label", "country", "objects", "english", "wikidata"])
        w.writeheader()
        w.writerows(sorted(rows, key=lambda r: -r["objects"]))
    print(f"\n{len(rows)} translations for {sum(r['objects'] for r in rows)} objects → {REPORT}")
    for r in sorted(rows, key=lambda r: -r["objects"])[:40]:
        print(f"  {r['label']} → {r['english']}  ({r['country']}, {r['objects']}, {r['wikidata']})")


def cmd_apply(args):
    with open(REPORT, encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    conn = ap.get_conn()
    try:
        with conn.cursor() as cur:
            changed = 0
            for r in rows:
                cur.execute(
                    """UPDATE museum_objects SET
                         place_name_normalized = %s,
                         geocoding_notes = concat_ws(' | ', NULLIF(geocoding_notes, ''), %s)
                       WHERE published_at IS NOT NULL AND city_en = %s AND country_en = %s
                         AND NULLIF(BTRIM(place_name_normalized), '') IS NULL
                         AND COALESCE(review_status, '') <> 'verified'""",
                    (r["english"], f"{NOTE_TAG} {r['label']} → {r['english']} (Wikidata {r['wikidata']})",
                     r["label"], r["country"]),
                )
                changed += cur.rowcount
            print(f"English label set on {changed} objects ({len(rows)} place names).")
        if args.dry_run:
            conn.rollback()
            print("Dry run — rolled back, nothing written.")
        else:
            conn.commit()
            print("Committed. Restart Strapi so the map views pick it up.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="command", required=True)
    sub.add_parser("propose")
    a = sub.add_parser("apply")
    a.add_argument("--dry-run", action="store_true")
    args = p.parse_args()
    {"propose": cmd_propose, "apply": cmd_apply}[args.command](args)


if __name__ == "__main__":
    main()
