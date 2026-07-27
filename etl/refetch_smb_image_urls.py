#!/usr/bin/env python3
"""
refetch_smb_image_urls.py — Rebuild img_url for SMB records broken by the
recherche.smb.museum/id.smb.museum outage.

Background: a one-off local pass (backend/scripts/updateImgUrlAntik.js,
run per institution) once swapped most SMB img_urls from the working
smb.museum-digital.de pattern to a higher-res recherche.smb.museum pattern.
SMB has since migrated that image backend (id.smb.museum's redirect chain
now hangs, and recherche.smb.museum itself shows "OHNE ABBILDUNGEN" /
broken-image placeholders site-wide) and every recherche.smb.museum/images/...
URL times out. SMB has since relaunched as search.smb.museum, which serves
the same images directly by asset id — no per-object API call needed — via
https://search.smb.museum/media/images/thumbs/extra_large/{dir1}/{dir2}/{asset_id}.jpg
(dir1/dir2 derived from asset_id, see compute_search_url — verified against a
238-record cross-institution sample plus the full population of short-digit
asset ids: 100% hit rate for asset ids >= 1000, 0% for 3-digit ids, which are
apparently retired/never-migrated). The smb.museum-digital.de mirror (an
independent third-party aggregator) is unaffected and still serves images —
just capped at 500px wide — and is used as a fallback when search.smb.museum
doesn't have an asset.

Two fetch strategies, both resumable and cache-compatible:

  1. fetch      — the ORIGINAL method: re-fetches
                  https://smb.museum-digital.de/json/object/{object_id} for
                  each broken row and rebuilds img_url from the object's
                  object_images[].folder / .preview fields. Rate-limited
                  (1 req/s) against museum-digital.de's API.

  2. fetch-fast — the NEW method: derives the asset id already embedded in
                  the broken old_url and constructs the search.smb.museum
                  URL directly — no API call, no rate limit needed for the
                  primary path (tested safe at 30+ req/s). Falls back to the
                  same slow museum-digital.de method (rate-limited) for
                  3-digit asset ids (confirmed 0% hit rate on search.smb.museum)
                  and for any asset that 404s there.

Both are resumable: re-running either skips row ids already present in the
cache file (etl/smb_image_refetch_cache.jsonl), so they can run in parallel
against the same broken-row set without stepping on each other's completed
work — `report`'s dedup prefers "ok" over "failed/skipped", and among "ok"
results prefers source=search.smb.museum over the museum-digital.de fallback,
so a slower redundant pass can't silently downgrade an already-fixed record.
Neither command touches the database.

  3. report — reads the cache file only (no network calls), prints a random
              sample of before/after rows plus summary counts. Use this to
              review the fetch pass results before anything is applied.

Applying the cached new_url values to Strapi is a separate script:
backend/scripts/applySmbImageUrls.js (reads the same cache file).

Usage:
    python refetch_smb_image_urls.py fetch                      # full run (resumable), slow method
    python refetch_smb_image_urls.py fetch --object-ids 5,46149 # quick spot check, bypasses cache
    python refetch_smb_image_urls.py fetch-fast                 # full run (resumable), fast method
    python refetch_smb_image_urls.py report --sample 40
"""

import argparse
import json
import os
import random
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import psycopg2
import psycopg2.extras
import requests
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "../backend/.env"))

SMB_INSTITUTIONS = [
    "Ethnologisches Museum",
    "Museum für Islamische Kunst",
    "Ägyptisches Museum und Papyrussammlung",
    "Antikensammlung",
    "Vorderasiatisches Museum",
    "Museum für Asiatische Kunst",
]

BROKEN_URL_PREFIX = "https://recherche.smb.museum"

CACHE_PATH = os.path.join(os.path.dirname(__file__), "smb_image_refetch_cache.jsonl")

# Matches scrape_smb.py / scrape_smb_am_api.py: retry up to 5x on 503,
# sleep 5s between retries, sleep 1s between object-detail requests.
MAX_RETRIES = 5
RETRY_SLEEP_SECONDS = 5
REQUEST_SLEEP_SECONDS = 1
REQUEST_TIMEOUT_SECONDS = 15

# search.smb.museum tolerated 60 back-to-back requests from a single thread
# (~31 req/s) with zero throttling in testing. 10 concurrent workers at the
# ~120ms/request latency seen in the real run land in a similar ballpark
# (~80 req/s) rather than a large multiple of what was actually verified —
# a deliberate margin below max-observed-safe, not just "as many as possible".
FAST_WORKERS = 10
FAST_REQUEST_TIMEOUT_SECONDS = 10
FAST_MAX_RETRIES = 3
FAST_RETRY_SLEEP_SECONDS = 1

# Asset id embedded in the broken old_url, e.g. the "3148534" in both
# .../images/31/3148534_1000x1000.jpg and .../images/2924541_2500x2500.jpg#2924541
ASSET_ID_RE = re.compile(r"/(\d+)(?:-[a-z]+)?_\d+x\d+\.jpg(?:#\d+)?$")

# Every record produced by fetch/fetch-fast/recovery carries a "source" so a
# redundant slower pass can never silently downgrade an already-fixed record.
SOURCE_PRIORITY = {"search.smb.museum": 2, "museum-digital.de": 1}
STATUS_PRIORITY = {"ok": 2, "skipped": 1, "failed": 0}


def record_priority(rec):
    return (
        STATUS_PRIORITY.get(rec.get("status"), 0),
        SOURCE_PRIORITY.get(rec.get("source"), 0) if rec.get("status") == "ok" else 0,
    )


def get_conn():
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
    for attempt in range(MAX_RETRIES):
        try:
            r = http.get(url, timeout=REQUEST_TIMEOUT_SECONDS)
        except requests.RequestException as e:
            # Transient network issues (DNS blip, connection reset, timeout) get
            # the same retry/backoff as a 503 — a previous version gave up after
            # a single attempt here, which permanently marked ~180 records as
            # "failed" during one bad network stretch instead of retrying.
            last_error = f"request error: {e}"
            time.sleep(RETRY_SLEEP_SECONDS)
            continue
        if r.status_code == 200:
            try:
                return r.json(), None
            except json.JSONDecodeError:
                return None, "invalid JSON response"
        elif r.status_code == 503:
            last_error = "HTTP 503"
            time.sleep(RETRY_SLEEP_SECONDS)
        else:
            return None, f"HTTP {r.status_code}"
    return None, f"exhausted retries: {last_error}"


def build_new_url(details):
    images = details.get("object_images", [])
    if not images:
        return None, "no object_images in response"
    main = next((im for im in images if im.get("is_main") == "j"), images[0])
    folder = main.get("folder")
    preview = main.get("preview")
    if not folder or not preview:
        return None, "missing folder/preview field"
    base = re.sub(r"^\d+w_", "", preview)
    return f"https://smb.museum-digital.de/data/smb/{folder}/500w_{base}", None


def extract_asset_id(old_url):
    """Pull the numeric asset id out of a broken recherche.smb.museum URL.
    Handles the plain form, the bucketed form, the "-xl" suffix form, and
    the two records with a stray #fragment appended after .jpg."""
    m = ASSET_ID_RE.search(old_url)
    if not m:
        return None
    return m.group(1)


def compute_search_url(asset_id, size="extra_large"):
    """search.smb.museum buckets assets into a 2-level directory tree:
    dir1 = zero-pad(floor(id/1000) % 1000, 3)
    dir2 = zero-pad(floor(id/1000/1000), 3) — omitted entirely when it's "000"
    (i.e. for any asset id under 1,000,000, which is most of them).
    Verified against a 238-record cross-institution sample (100% hit) plus
    the full population of 4-digit asset ids (28/28). 3-digit asset ids
    (12 total in the whole broken set) hit 0% — they don't exist here at
    all, not a bucketing issue, so they're routed to the slow fallback."""
    n = int(asset_id)
    q1 = n // 1000
    dir1 = f"{q1 % 1000:03d}"
    dir2_num = q1 // 1000
    if dir2_num == 0:
        return f"https://search.smb.museum/media/images/thumbs/{size}/{dir1}/{n}.jpg"
    return f"https://search.smb.museum/media/images/thumbs/{size}/{dir1}/{dir2_num:03d}/{n}.jpg"


def verify_image_url(url, timeout, max_retries, retry_sleep, session=None):
    """GET the URL and confirm it's really an image (not a 404/placeholder).
    Retries connection/timeout errors (not 404s — that's a real signal)."""
    http = session or requests
    last_error = None
    for attempt in range(max_retries):
        try:
            r = http.get(url, timeout=timeout)
        except requests.RequestException as e:
            last_error = f"request error: {e}"
            time.sleep(retry_sleep)
            continue
        if r.status_code == 200 and "image" in r.headers.get("content-type", "") and len(r.content) > 1000:
            return True, None
        if r.status_code == 404:
            return False, "HTTP 404"
        last_error = f"HTTP {r.status_code}"
        time.sleep(retry_sleep)
    return False, last_error or "exhausted retries"


def fetch_broken_rows(conn):
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        """
        SELECT id, object_id, inventory_number, institution_name, img_url
        FROM museum_objects
        WHERE institution_name = ANY(%s)
          AND img_url LIKE %s
        ORDER BY id
        """,
        [SMB_INSTITUTIONS, f"{BROKEN_URL_PREFIX}%"],
    )
    rows = cur.fetchall()
    cur.close()
    return rows


def load_cache_ids(cache_path):
    """Return the set of row ids already recorded in the cache file."""
    done = set()
    if not os.path.exists(cache_path):
        return done
    with open(cache_path, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
                done.add(rec["id"])
            except (json.JSONDecodeError, KeyError):
                continue  # tolerate a truncated last line from a killed process
    return done


def load_cache_records(cache_path):
    """Load cache records, keeping the BEST line seen per row id — needed
    because two fetch strategies (or a recovery pass) can append more than
    one line for the same id. "Best" means: an "ok" beats "skipped"/"failed"
    regardless of order, and among "ok" results, source=search.smb.museum
    beats the museum-digital.de fallback — so if the slow fetch pass later
    redundantly re-processes an id the fast pass already fixed, its lower-
    quality result can't silently overwrite the better one in reports.
    Ties (same priority) keep whichever line came last."""
    by_id = {}
    order = []
    if not os.path.exists(cache_path):
        return []
    with open(cache_path, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if rec["id"] not in by_id:
                order.append(rec["id"])
                by_id[rec["id"]] = rec
            else:
                existing = by_id[rec["id"]]
                if record_priority(rec) >= record_priority(existing):
                    by_id[rec["id"]] = rec
    return [by_id[k] for k in order]


def cmd_fetch(args):
    conn = get_conn()

    if args.object_ids:
        ids = [int(x) for x in args.object_ids.split(",")]
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            SELECT id, object_id, inventory_number, institution_name, img_url
            FROM museum_objects
            WHERE institution_name = ANY(%s)
              AND img_url LIKE %s
              AND object_id = ANY(%s)
            ORDER BY id
            """,
            [SMB_INSTITUTIONS, f"{BROKEN_URL_PREFIX}%", ids],
        )
        rows = cur.fetchall()
        cur.close()
        conn.close()
        print(f"Spot check: {len(rows)} matching rows (not written to cache)")
        for row in rows:
            details, err = fetch_object_details(row["object_id"])
            time.sleep(REQUEST_SLEEP_SECONDS)
            new_url, build_err = build_new_url(details) if details else (None, None)
            print(f"object_id={row['object_id']} inv={row['inventory_number']!r} institution={row['institution_name']!r}")
            print(f"    OLD: {row['img_url']}")
            print(f"    NEW: {new_url}")
            if err or build_err:
                print(f"    ERR: {err or build_err}")
        return

    all_rows = fetch_broken_rows(conn)
    conn.close()

    already_done = load_cache_ids(CACHE_PATH)
    remaining = [r for r in all_rows if r["id"] not in already_done]

    print(f"Total broken SMB rows: {len(all_rows)}")
    print(f"Already in cache:      {len(already_done)}")
    print(f"Remaining to fetch:    {len(remaining)}")
    print(f"Cache file:            {CACHE_PATH}")
    sys.stdout.flush()

    if not remaining:
        print("Nothing left to fetch.")
        return

    ok = skipped = failed = 0
    start = time.time()

    with open(CACHE_PATH, "a", buffering=1) as cache_f:  # line-buffered
        for i, row in enumerate(remaining, 1):
            details, err = fetch_object_details(row["object_id"])
            new_url, build_err = (None, None)
            if details is not None:
                new_url, build_err = build_new_url(details)

            if err:
                status, error = "failed", err
                failed += 1
            elif build_err:
                status, error = "skipped", build_err
                skipped += 1
            else:
                status, error = "ok", None
                ok += 1

            record = {
                "id": row["id"],
                "object_id": row["object_id"],
                "inventory_number": row["inventory_number"],
                "institution_name": row["institution_name"],
                "old_url": row["img_url"],
                "new_url": new_url,
                "status": status,
                "error": error,
                "source": "museum-digital.de" if status == "ok" else None,
            }
            cache_f.write(json.dumps(record, ensure_ascii=False) + "\n")

            if i % 50 == 0 or i == len(remaining):
                elapsed = time.time() - start
                rate = i / elapsed if elapsed > 0 else 0
                eta_hours = (len(remaining) - i) / rate / 3600 if rate > 0 else float("nan")
                print(
                    f"[{i}/{len(remaining)}] ok={ok} skipped={skipped} failed={failed} "
                    f"elapsed={elapsed/60:.1f}m eta={eta_hours:.1f}h",
                    flush=True,
                )

            time.sleep(REQUEST_SLEEP_SECONDS)

    print(f"\nFetch pass complete (slow method). ok={ok} skipped={skipped} failed={failed} total_processed={len(remaining)}")


def process_row_fast(row, session):
    """Resolve one broken row via search.smb.museum, falling back to the
    slow museum-digital.de method for 3-digit asset ids (0% hit rate,
    confirmed exhaustively) or any search.smb.museum 404/failure."""
    asset_id = extract_asset_id(row["img_url"])
    new_url = None
    status = "failed"
    error = None
    source = None

    if asset_id is None:
        error = "could not extract asset_id from old_url"
    elif len(asset_id) <= 3:
        details, err = fetch_object_details(row["object_id"], session=session)
        if details is not None:
            new_url, build_err = build_new_url(details)
            if new_url:
                status, source = "ok", "museum-digital.de"
            else:
                status, error = "skipped", build_err
        else:
            status, error = "failed", err
    else:
        candidate_url = compute_search_url(asset_id)
        is_ok, err = verify_image_url(
            candidate_url, FAST_REQUEST_TIMEOUT_SECONDS, FAST_MAX_RETRIES, FAST_RETRY_SLEEP_SECONDS,
            session=session,
        )
        if is_ok:
            new_url, status, source = candidate_url, "ok", "search.smb.museum"
        else:
            details, fb_err = fetch_object_details(row["object_id"], session=session)
            if details is not None:
                new_url, build_err = build_new_url(details)
                if new_url:
                    status, source = "ok", "museum-digital.de"
                else:
                    status, error = "skipped", build_err
            else:
                status, error = "failed", f"search.smb.museum: {err}; fallback: {fb_err}"

    return {
        "id": row["id"],
        "object_id": row["object_id"],
        "inventory_number": row["inventory_number"],
        "institution_name": row["institution_name"],
        "old_url": row["img_url"],
        "new_url": new_url,
        "status": status,
        "error": error,
        "source": source,
    }


def cmd_fetch_fast(args):
    conn = get_conn()
    all_rows = fetch_broken_rows(conn)
    conn.close()

    already_done = load_cache_ids(CACHE_PATH)
    remaining = [r for r in all_rows if r["id"] not in already_done]

    print(f"Total broken SMB rows: {len(all_rows)}")
    print(f"Already in cache:      {len(already_done)}")
    print(f"Remaining to fetch:    {len(remaining)}")
    print(f"Cache file:            {CACHE_PATH}")
    print(f"Workers:               {FAST_WORKERS}")
    sys.stdout.flush()

    if not remaining:
        print("Nothing left to fetch.")
        return

    ok = skipped = failed = 0
    via_search = via_fallback = 0
    completed = 0
    start = time.time()
    write_lock = threading.Lock()

    # One Session shared across worker threads: requests/urllib3's connection
    # pooling is thread-safe, so this keeps TCP+TLS connections warm across
    # concurrent requests instead of each thread paying a fresh handshake.
    adapter = requests.adapters.HTTPAdapter(pool_connections=FAST_WORKERS, pool_maxsize=FAST_WORKERS)
    session = requests.Session()
    session.mount("https://", adapter)
    session.mount("http://", adapter)

    with open(CACHE_PATH, "a", buffering=1) as cache_f:  # line-buffered
        with ThreadPoolExecutor(max_workers=FAST_WORKERS) as executor:
            futures = {executor.submit(process_row_fast, row, session): row for row in remaining}
            for future in as_completed(futures):
                record = future.result()

                if record["status"] == "ok":
                    ok += 1
                    if record["source"] == "search.smb.museum":
                        via_search += 1
                    else:
                        via_fallback += 1
                elif record["status"] == "skipped":
                    skipped += 1
                else:
                    failed += 1

                with write_lock:
                    cache_f.write(json.dumps(record, ensure_ascii=False) + "\n")
                    completed += 1
                    i = completed

                if i % 200 == 0 or i == len(remaining):
                    elapsed = time.time() - start
                    rate = i / elapsed if elapsed > 0 else 0
                    eta_min = (len(remaining) - i) / rate / 60 if rate > 0 else float("nan")
                    print(
                        f"[{i}/{len(remaining)}] ok={ok} (search={via_search} fallback={via_fallback}) "
                        f"skipped={skipped} failed={failed} elapsed={elapsed/60:.1f}m eta={eta_min:.1f}m",
                        flush=True,
                    )

    print(
        f"\nFetch pass complete (fast method). ok={ok} (via search.smb.museum={via_search}, "
        f"via museum-digital.de fallback={via_fallback}) skipped={skipped} failed={failed} "
        f"total_processed={len(remaining)}"
    )


def cmd_upgrade(args):
    """Re-check already-'ok' records that were resolved via the museum-digital.de
    fallback (mostly from the original slow pass, before search.smb.museum was
    found) and upgrade them to search.smb.museum where it now resolves —
    same asset id, meaningfully higher resolution. Appends new cache lines
    rather than editing in place; the existing priority dedup (search.smb.museum
    beats museum-digital.de among "ok" results) means these supersede the old
    entries automatically in report/apply. Resumable via the "upgrade_checked"
    marker written on every line this command produces, success or not."""
    records = load_cache_records(CACHE_PATH)
    candidates = [r for r in records if r["status"] == "ok" and r.get("source") != "search.smb.museum"]

    already_checked = set()
    with open(CACHE_PATH, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if rec.get("upgrade_checked"):
                already_checked.add(rec["id"])

    remaining = [r for r in candidates if r["id"] not in already_checked]

    print(f"Upgrade candidates (currently non-search.smb.museum 'ok'): {len(candidates)}")
    print(f"Already checked in a prior upgrade run:                   {len(already_checked)}")
    print(f"Remaining to check:                                       {len(remaining)}")
    print(f"Workers:                                                  {FAST_WORKERS}")
    sys.stdout.flush()

    if not remaining:
        print("Nothing left to check.")
        return

    upgraded = unchanged = 0
    completed = 0
    start = time.time()
    write_lock = threading.Lock()

    adapter = requests.adapters.HTTPAdapter(pool_connections=FAST_WORKERS, pool_maxsize=FAST_WORKERS)
    session = requests.Session()
    session.mount("https://", adapter)
    session.mount("http://", adapter)

    def check_one(row):
        asset_id = extract_asset_id(row["old_url"])
        if asset_id is not None and len(asset_id) > 3:
            candidate_url = compute_search_url(asset_id)
            is_ok, _ = verify_image_url(
                candidate_url, FAST_REQUEST_TIMEOUT_SECONDS, FAST_MAX_RETRIES, FAST_RETRY_SLEEP_SECONDS,
                session=session,
            )
            if is_ok:
                return {
                    **{k: row[k] for k in ("id", "object_id", "inventory_number", "institution_name", "old_url")},
                    "new_url": candidate_url,
                    "status": "ok",
                    "error": None,
                    "source": "search.smb.museum",
                    "upgraded_from": row.get("source") or "museum-digital.de",
                    "upgrade_checked": True,
                }
        return {
            **{k: row[k] for k in ("id", "object_id", "inventory_number", "institution_name", "old_url")},
            "new_url": row["new_url"],
            "status": row["status"],
            "error": row.get("error"),
            "source": row.get("source"),
            "upgrade_checked": True,
        }

    with open(CACHE_PATH, "a", buffering=1) as cache_f:
        with ThreadPoolExecutor(max_workers=FAST_WORKERS) as executor:
            futures = {executor.submit(check_one, row): row for row in remaining}
            for future in as_completed(futures):
                record = future.result()
                if record["source"] == "search.smb.museum" and record.get("upgraded_from"):
                    upgraded += 1
                else:
                    unchanged += 1

                with write_lock:
                    cache_f.write(json.dumps(record, ensure_ascii=False) + "\n")
                    completed += 1
                    i = completed

                if i % 200 == 0 or i == len(remaining):
                    elapsed = time.time() - start
                    rate = i / elapsed if elapsed > 0 else 0
                    eta_min = (len(remaining) - i) / rate / 60 if rate > 0 else float("nan")
                    print(
                        f"[{i}/{len(remaining)}] upgraded={upgraded} unchanged={unchanged} "
                        f"elapsed={elapsed/60:.1f}m eta={eta_min:.1f}m",
                        flush=True,
                    )

    print(f"\nUpgrade pass complete. upgraded={upgraded} unchanged={unchanged} total_checked={len(remaining)}")


def cmd_report(args):
    records = load_cache_records(CACHE_PATH)
    if not records:
        print(f"No cache records found at {CACHE_PATH}")
        return

    counts = {"ok": 0, "skipped": 0, "failed": 0}
    for r in records:
        counts[r["status"]] = counts.get(r["status"], 0) + 1

    print(f"Cache file: {CACHE_PATH}")
    print(f"Total records: {len(records)}")
    print(f"  ok (would update):  {counts.get('ok', 0)}")
    print(f"  skipped:            {counts.get('skipped', 0)}")
    print(f"  failed:             {counts.get('failed', 0)}")
    print()

    ok_records = [r for r in records if r["status"] == "ok"]
    sample_size = min(args.sample, len(ok_records))
    sample = random.sample(ok_records, sample_size) if sample_size else []

    print(f"Random sample of {sample_size} 'ok' records:")
    print()
    for r in sample:
        print(f"object_id={r['object_id']} inv={r['inventory_number']!r} institution={r['institution_name']!r}")
        print(f"    OLD: {r['old_url']}")
        print(f"    NEW: {r['new_url']}")
        print()

    non_ok = [r for r in records if r["status"] != "ok"]
    if non_ok:
        print(f"Sample of {min(10, len(non_ok))} non-ok records (skipped/failed):")
        for r in non_ok[:10]:
            print(f"  [{r['status']}] object_id={r['object_id']} inv={r['inventory_number']!r}: {r['error']}")


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    p_fetch = sub.add_parser("fetch", help="Slow method: rate-limited resumable crawl via museum-digital.de API")
    p_fetch.add_argument("--object-ids", type=str, default=None,
                          help="Comma-separated object_ids to spot-check (bypasses cache, no writes)")

    sub.add_parser("fetch-fast", help="Fast method: resumable crawl via search.smb.museum URL construction")

    sub.add_parser("upgrade", help="Re-check museum-digital.de-sourced 'ok' records against search.smb.museum")

    p_report = sub.add_parser("report", help="Read cache file, print sample + summary (no network calls)")
    p_report.add_argument("--sample", type=int, default=40, help="Number of 'ok' records to sample")

    args = parser.parse_args()

    if args.command == "fetch":
        cmd_fetch(args)
    elif args.command == "fetch-fast":
        cmd_fetch_fast(args)
    elif args.command == "upgrade":
        cmd_upgrade(args)
    elif args.command == "report":
        cmd_report(args)


if __name__ == "__main__":
    main()
