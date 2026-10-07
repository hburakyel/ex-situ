#!/usr/bin/env python3
"""
resolve_berlpap_links.py — Point withdrawn papyri at their Berliner Papyrusdatenbank record.

Papyri ("P …") that SMB withdrew from museum-digital (tagged [source-withdrawn]
by check_withdrawn_sources.py) are still published in BerlPap
(https://berlpap.smb.museum/<5-digit id>/, persistent URLs). BerlPap's search
returns, per record, a summary that starts with the inventory number, e.g.
"P. 9439: Liste oder Rechnung" or "P. 11652 A Fr. b R Kol. V".

  check    searches BerlPap for every such object (resumable cache, ~1 req/s per
           worker). No DB writes.
  report   counts: exactly one record / several (fragments) / none
  apply    for objects with exactly one matching record: source_link becomes the
           BerlPap URL; the old link is kept in geocoding_notes ([berlpap] tag).
           Several or no matches → unchanged (the grid links to BerlPap's search).
           Only the link changes — no BerlPap images are used (their terms
           allow study, not publication). Verified rows untouched. --dry-run.

Usage (from etl/):
    python resolve_berlpap_links.py check [--workers 2]
    python resolve_berlpap_links.py report
    python resolve_berlpap_links.py apply --dry-run
    python resolve_berlpap_links.py apply
"""

import argparse
import html
import json
import os
import re
import threading
import time
import urllib.parse
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "reports", "berlpap_lookup.jsonl")
UA = {"User-Agent": "ExSitu/1.0 (+https://exsitu.app)"}
NOTE_TAG = "[berlpap]"
ENTRY = re.compile(
    r'<h2 class="entry-title"><a href="(https://berlpap\.smb\.museum/\d{5}/)".*?<div class="entry-summary">\s*<p>(.*?)<a ',
    re.S,
)


def get_conn():
    import psycopg2
    from dotenv import load_dotenv

    load_dotenv(dotenv_path=os.path.join(HERE, "..", "backend", ".env"))
    return psycopg2.connect(
        host=os.environ.get("DATABASE_HOST", "127.0.0.1"), port=int(os.environ.get("DATABASE_PORT", 5432)),
        dbname=os.environ.get("DATABASE_NAME", ""), user=os.environ.get("DATABASE_USERNAME", ""),
        password=os.environ.get("DATABASE_PASSWORD", ""),
    )


def key(inventory):
    """'P 11652 A' / 'P. 11652 A' → 'p11652a' (comparison key)."""
    return re.sub(r"[\s.]+", "", inventory or "").lower()


def matching_records(inventory):
    """BerlPap records whose summary starts with exactly this inventory number."""
    url = "https://berlpap.smb.museum/?s=" + urllib.parse.quote_plus(inventory)
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as resp:
                page = resp.read().decode("utf-8", "replace")
            break
        except Exception:
            time.sleep(10 * (attempt + 1))
    else:
        raise RuntimeError(f"BerlPap unreachable for {inventory}")
    want = key(inventory)
    exact, parts = [], []
    for link, summary in ENTRY.findall(page):
        text = html.unescape(re.sub(r"<[^>]+>", "", summary)).strip()
        # Inventory part of the summary: up to ":" (title) — "P. 9439: Liste …"
        head = text.split(":")[0]
        if key(head) == want:
            exact.append({"url": link, "summary": text[:120]})
        elif re.match(re.escape(want) + r"(?!\d)", key(head)):
            parts.append({"url": link, "summary": text[:120]})  # fragment / side / column of it
    return exact, parts


def load_cache():
    done = {}
    if os.path.exists(CACHE):
        with open(CACHE, encoding="utf-8") as f:
            for line in f:
                try:
                    r = json.loads(line)
                    done[r["id"]] = r
                except (json.JSONDecodeError, KeyError):
                    pass
    return done


def cmd_check(args):
    conn = get_conn()
    with conn.cursor() as cur:
        cur.execute("""SELECT id, inventory_number, source_link FROM museum_objects
                       WHERE published_at IS NOT NULL AND geocoding_notes LIKE '%%[source-withdrawn]%%'
                         AND inventory_number ~ '^P[ .]' ORDER BY id""")
        rows = cur.fetchall()
    conn.close()
    done = load_cache()
    todo = [r for r in rows if r[0] not in done]
    print(f"{len(rows)} withdrawn papyri, {len(todo)} not looked up yet", flush=True)
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    lock, n = threading.Lock(), [0]
    with open(CACHE, "a", encoding="utf-8", buffering=1) as out:
        def work(row):
            rid, inv, link = row
            try:
                matches, parts = matching_records(inv)
            except RuntimeError:
                return
            time.sleep(1.0)
            with lock:
                out.write(json.dumps({"id": rid, "inventory": inv, "old_link": link, "matches": matches,
                                      "parts": len(parts)},
                                     ensure_ascii=False) + "\n")
                n[0] += 1
                if n[0] % 250 == 0:
                    print(f"  {n[0]}/{len(todo)}", flush=True)
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            list(pool.map(work, todo))
    cmd_report(args)


def cmd_report(_args):
    done = load_cache()
    def kind(r):
        if len(r["matches"]) == 1:
            return "one"
        if r["matches"]:
            return "several"
        return "fragments" if r.get("parts") else "none"
    c = Counter(kind(r) for r in done.values())
    print(f"{len(done)} looked up: exactly one record {c['one']}, several records {c['several']}, "
          f"only fragment records {c['fragments']}, not found {c['none']}")
    for k in ("several", "fragments", "none"):
        ex = [r["inventory"] for r in done.values() if kind(r) == k][:6]
        if ex:
            print(f"  {k}: {', '.join(ex)}")


def cmd_apply(args):
    fixes = [r for r in load_cache().values() if len(r["matches"]) == 1]
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            changed = 0
            for r in fixes:
                cur.execute(
                    """UPDATE museum_objects SET
                         source_link = %s,
                         geocoding_notes = concat_ws(' | ', NULLIF(geocoding_notes, ''), %s)
                       WHERE id = %s AND source_link = %s AND COALESCE(review_status, '') <> 'verified'""",
                    (r["matches"][0]["url"], f"{NOTE_TAG} source_link was {r['old_link']}", r["id"], r["old_link"]),
                )
                changed += cur.rowcount
            print(f"BerlPap link set for {changed} of {len(fixes)} papyri with exactly one record.")
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
    c.add_argument("--workers", type=int, default=2)
    sub.add_parser("report")
    a = sub.add_parser("apply")
    a.add_argument("--dry-run", action="store_true")
    args = p.parse_args()
    {"check": cmd_check, "report": cmd_report, "apply": cmd_apply}[args.command](args)


if __name__ == "__main__":
    main()
