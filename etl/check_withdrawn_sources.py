#!/usr/bin/env python3
"""
check_withdrawn_sources.py — Find SMB objects whose museum-digital record has
been withdrawn, and stop showing their images.

SMB removes records from museum-digital from time to time (in 2026 about half
of the Ägyptisches Museum papyri). The image files often stay online, but the
record that stated their licence (CC BY-NC-SA) is gone and the object's source
link leads to "There is no displayable object of this ID". Ex Situ only shows
images it can credit, so these objects keep their place on the map but lose
their image until a new source is found.

  check    downloads the list of objects museum-digital still publishes for each
           institution (json/objects?s=institution:<id>, 24 per page, polite
           pace) and compares it with our source_link ids. No DB writes.
           Report: etl/reports/withdrawn_sources.csv
  apply    sets img_url = NULL for withdrawn rows that still have an image and
           records the old URL in geocoding_notes ([source-withdrawn] tag).
           Never touches review_status = 'verified'. --dry-run rolls back.
  restore  puts the image back for rows whose record is live again (or for all
           tagged rows with --all), using the URL kept in the note.
  relink   keeps the image and only replaces the dead source link: papyri ("P …")
           → BerlPap search, everything else → SMB's collection search
           (search.smb.museum). Old link kept in geocoding_notes ([source-relinked]
           tag — not [source-withdrawn], so the grid still shows the image).
           Verified rows untouched. --dry-run rolls back.

Usage (from etl/):
    python check_withdrawn_sources.py check [--institution "Ägyptisches Museum und Papyrussammlung"]
    python check_withdrawn_sources.py apply --dry-run
    python check_withdrawn_sources.py apply
    python check_withdrawn_sources.py restore [--all] [--dry-run]
    python check_withdrawn_sources.py relink --dry-run
    python check_withdrawn_sources.py relink
"""

import argparse
import csv
import json
import os
import re
import time
import urllib.parse
import urllib.request
from collections import Counter
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
REPORTS = os.path.join(HERE, "reports")
REPORT = os.path.join(REPORTS, "withdrawn_sources.csv")
UA = {"User-Agent": "ExSitu/1.0 (+https://exsitu.app)"}
NOTE_TAG = "[source-withdrawn]"

# museum-digital institution ids (https://smb.museum-digital.de/json/institutions)
MD_INSTITUTIONS = {
    "Ägyptisches Museum und Papyrussammlung": 9,
    "Antikensammlung": 10,
    "Ethnologisches Museum": 11,
    "Museum für Asiatische Kunst": 3,
    "Museum für Islamische Kunst": 5,
    "Vorderasiatisches Museum": 8,
}


def get_conn():
    import psycopg2
    from dotenv import load_dotenv

    load_dotenv(dotenv_path=os.path.join(HERE, "..", "backend", ".env"))
    return psycopg2.connect(
        host=os.environ.get("DATABASE_HOST", "127.0.0.1"), port=int(os.environ.get("DATABASE_PORT", 5432)),
        dbname=os.environ.get("DATABASE_NAME", ""), user=os.environ.get("DATABASE_USERNAME", ""),
        password=os.environ.get("DATABASE_PASSWORD", ""),
    )


def fetch_page(inst_id, start):
    url = f"https://smb.museum-digital.de/json/objects?s=institution:{inst_id}&startwert={start}"
    for attempt in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as resp:
                data = json.load(resp)
            # Overload comes back as HTTP 200 + {"status": "error", "code": 503}.
            if isinstance(data, list):
                return data
        except Exception:
            pass
        time.sleep(15 * (attempt + 1))
    raise RuntimeError(f"museum-digital unreachable (institution {inst_id}, offset {start})")


def live_ids(inst_id):
    """All object ids museum-digital currently publishes for one institution."""
    ids, start, total = set(), 0, None
    while total is None or start < total:
        page = fetch_page(inst_id, start)
        if not page:
            break
        total = int(page[0]["total"])
        ids.update(str(o["objekt_id"]) for o in page)
        start += len(page)
        if start % 2400 < len(page):
            print(f"    {start}/{total}", flush=True)
        time.sleep(1.2)
    if total is not None and len(ids) < total:
        raise RuntimeError(f"institution {inst_id}: got {len(ids)} of {total} ids — not trusting a partial list")
    return ids


def cmd_check(args):
    institutions = [args.institution] if args.institution else list(MD_INSTITUTIONS)
    conn = get_conn()
    rows_out, summary = [], []
    for name in institutions:
        print(f"{name}: downloading museum-digital list …", flush=True)
        live = live_ids(MD_INSTITUTIONS[name])
        with conn.cursor() as cur:
            cur.execute(
                r"""SELECT id, inventory_number, substring(source_link from 'museum-digital\.de/object/([0-9]+)'),
                           img_url, COALESCE(review_status, '')
                    FROM museum_objects
                    WHERE published_at IS NOT NULL AND institution_name = %s
                      AND source_link ~ 'museum-digital\.de/object/[0-9]+'""",
                [name],
            )
            rows = cur.fetchall()
        withdrawn = [r for r in rows if r[2] not in live]
        prefixes = Counter((r[1] or "?").split(" ")[0] for r in withdrawn)
        summary.append((name, len(rows), len(withdrawn), sum(1 for r in withdrawn if r[3]), prefixes))
        rows_out += [
            {"id": r[0], "institution": name, "inventory_number": r[1], "md_id": r[2],
             "img_url": r[3] or "", "verified": r[4] == "verified"}
            for r in withdrawn
        ]
    conn.close()
    os.makedirs(REPORTS, exist_ok=True)
    with open(REPORT, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["id", "institution", "inventory_number", "md_id", "img_url", "verified"])
        w.writeheader()
        w.writerows(rows_out)
    print(f"\nChecked {date.today()} — report: {REPORT}")
    for name, total, n, with_img, prefixes in summary:
        print(f"  {name}: {n} of {total} withdrawn ({with_img} with an image)  {dict(prefixes.most_common(5))}")


def cmd_apply(args):
    with open(REPORT, encoding="utf-8") as f:
        rows = [r for r in csv.DictReader(f) if r["img_url"] and r["verified"] != "True"]
    checked = date.fromtimestamp(os.path.getmtime(REPORT)).isoformat()
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            changed = 0
            for r in rows:
                note = f"{NOTE_TAG} museum-digital {r['md_id']} withdrawn (checked {checked}); img_url was {r['img_url']}"
                cur.execute(
                    """UPDATE museum_objects SET
                         img_url = NULL,
                         geocoding_notes = concat_ws(' | ', NULLIF(geocoding_notes, ''), %s)
                       WHERE id = %s AND img_url = %s AND COALESCE(review_status, '') <> 'verified'""",
                    (note, int(r["id"]), r["img_url"]),
                )
                changed += cur.rowcount
            print(f"Images hidden for {changed} of {len(rows)} withdrawn objects (map position and data kept).")
        if args.dry_run:
            conn.rollback()
            print("Dry run — rolled back, nothing written.")
        else:
            conn.commit()
            print("Committed.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


NOTE_RE = re.compile(re.escape(NOTE_TAG) + r" museum-digital (\d+) withdrawn \(checked [0-9-]+\); img_url was (\S+)")


def cmd_restore(args):
    still_withdrawn = set()
    if not args.all:
        with open(REPORT, encoding="utf-8") as f:
            still_withdrawn = {r["id"] for r in csv.DictReader(f)}
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, geocoding_notes FROM museum_objects WHERE img_url IS NULL AND geocoding_notes LIKE %s",
                        [f"%{NOTE_TAG}%"])
            restored = 0
            for rid, notes in cur.fetchall():
                m = NOTE_RE.search(notes or "")
                if not m or str(rid) in still_withdrawn:
                    continue
                parts = [p for p in notes.split(" | ") if not p.startswith(NOTE_TAG)]
                cur.execute("UPDATE museum_objects SET img_url = %s, geocoding_notes = NULLIF(%s, '') WHERE id = %s",
                            (m.group(2), " | ".join(parts), rid))
                restored += cur.rowcount
            print(f"Restored {restored} images.")
        if args.dry_run:
            conn.rollback()
            print("Dry run — rolled back, nothing written.")
        else:
            conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


RELINK_TAG = "[source-relinked]"


def search_link(inventory):
    inv = (inventory or "").strip()
    if re.match(r"^P\b", inv):
        return "https://berlpap.smb.museum/?s=" + urllib.parse.quote_plus(inv)
    return "https://search.smb.museum/?q=" + urllib.parse.quote_plus(inv)


def cmd_relink(args):
    with open(REPORT, encoding="utf-8") as f:
        rows = [r for r in csv.DictReader(f) if r["verified"] != "True" and r["inventory_number"].strip()]
    checked = date.fromtimestamp(os.path.getmtime(REPORT)).isoformat()
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            changed = 0
            per_inst = Counter()
            for r in rows:
                new = search_link(r["inventory_number"])
                cur.execute(
                    r"""UPDATE museum_objects SET
                          geocoding_notes = concat_ws(' | ', NULLIF(geocoding_notes, ''),
                            %s || ' museum-digital ' || %s || ' withdrawn (checked ' || %s || '); source_link was ' || source_link),
                          source_link = %s
                        WHERE id = %s AND source_link ~ ('museum-digital\.de/object/' || %s || '$')
                          AND COALESCE(review_status, '') <> 'verified'""",
                    (RELINK_TAG, r["md_id"], checked, new, int(r["id"]), r["md_id"]),
                )
                changed += cur.rowcount
                per_inst[r["institution"]] += cur.rowcount
            print(f"Source link replaced on {changed} of {len(rows)} withdrawn objects (images kept): {dict(per_inst)}")
        if args.dry_run:
            conn.rollback()
            print("Dry run — rolled back, nothing written.")
        else:
            conn.commit()
            print("Committed.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="command", required=True)
    c = sub.add_parser("check")
    c.add_argument("--institution", choices=list(MD_INSTITUTIONS))
    a = sub.add_parser("apply")
    a.add_argument("--dry-run", action="store_true")
    r = sub.add_parser("restore")
    r.add_argument("--all", action="store_true", help="restore every tagged row, not only ones live again")
    r.add_argument("--dry-run", action="store_true")
    rl = sub.add_parser("relink")
    rl.add_argument("--dry-run", action="store_true")
    args = p.parse_args()
    {"check": cmd_check, "apply": cmd_apply, "restore": cmd_restore, "relink": cmd_relink}[args.command](args)


if __name__ == "__main__":
    main()
