#!/usr/bin/env python3
"""
remap_recherche_img_urls.py — Point img_url values that still use the dead
recherche.smb.museum host (301 to its homepage) at the same asset on
search.smb.museum, so the map, MCP and exports never hand out a dead link.

No museum API calls: the asset id is already in the old URL, and the new path
is derived from it (same layout as compute_search_url in
refetch_smb_image_urls.py). Each new URL is checked with a 1-byte GET (HEAD returns 404 there); rows
whose asset is not on search.smb.museum are left unchanged and listed.
The old URL is kept in geocoding_notes ([img-remapped] tag).
Never touches review_status = 'verified'.

Usage (from etl/):
    python remap_recherche_img_urls.py            # dry run: counts + sample, no writes
    python remap_recherche_img_urls.py --apply
Then restart Strapi so the materialized views pick up the new URLs.
"""

import argparse
import os
import re
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
UA = {"User-Agent": "ExSitu/1.0 (+https://exsitu.app)"}
NOTE_TAG = "[img-remapped]"
ASSET_RE = re.compile(r"/(\d+)(?:_\d+x\d+)?\.jpe?g$", re.I)


def get_conn():
    import psycopg2
    from dotenv import load_dotenv

    load_dotenv(dotenv_path=os.path.join(HERE, "..", "backend", ".env"))
    return psycopg2.connect(
        host=os.environ.get("DATABASE_HOST", "127.0.0.1"), port=int(os.environ.get("DATABASE_PORT", 5432)),
        dbname=os.environ.get("DATABASE_NAME", ""), user=os.environ.get("DATABASE_USERNAME", ""),
        password=os.environ.get("DATABASE_PASSWORD", ""),
    )


def search_url(asset_id):
    """dir1 = (id/1000) % 1000, dir2 = id/1e6, omitted when 0."""
    q1 = asset_id // 1000
    dirs = f"{q1 % 1000:03d}" if q1 // 1000 == 0 else f"{q1 % 1000:03d}/{q1 // 1000:03d}"
    return f"https://search.smb.museum/media/images/thumbs/extra_large/{dirs}/{asset_id}.jpg"


def is_image(url):
    """GET of the first byte only — search.smb.museum answers HEAD with 404.
    One retry, since the server is sometimes slow to accept connections."""
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, headers={**UA, "Range": "bytes=0-0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.status in (200, 206) and resp.headers.get("Content-Type", "").startswith("image/")
        except urllib.error.HTTPError:
            return False
        except Exception:
            if attempt == 0:
                time.sleep(5)
    return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="write the changes (default: dry run)")
    args = parser.parse_args()

    conn = get_conn()
    with conn.cursor() as cur:
        cur.execute(
            """SELECT id, img_url FROM museum_objects
               WHERE img_url LIKE '%%recherche.smb.museum/%%' AND COALESCE(review_status, '') <> 'verified'"""
        )
        rows = cur.fetchall()
        cur.execute("SELECT count(*) FROM museum_objects WHERE img_url LIKE '%%recherche.smb.museum/%%' AND review_status = 'verified'")
        verified = cur.fetchone()[0]

    candidates, unparsed = [], []
    for rid, old in rows:
        m = ASSET_RE.search(old)
        (candidates if m else unparsed).append((rid, old, search_url(int(m.group(1))) if m else None))

    with ThreadPoolExecutor(max_workers=8) as pool:
        ok = list(pool.map(lambda c: is_image(c[2]), candidates))
    remap = [c for c, good in zip(candidates, ok) if good]
    missing = [c for c, good in zip(candidates, ok) if not good]

    print(f"recherche.smb.museum img_urls: {len(rows)} (+{verified} verified, left alone)")
    print(f"  remappable (new URL is a live image): {len(remap)}")
    print(f"  asset not on search.smb.museum:       {len(missing)}")
    print(f"  no asset id in URL:                   {len(unparsed)}")
    for rid, old, new in remap[:5]:
        print(f"    {rid}: {old}\n      -> {new}")
    for rid, old, _ in (missing + unparsed)[:20]:
        print(f"    unchanged {rid}: {old}")

    if not args.apply:
        print("Dry run — nothing written. Re-run with --apply.")
        conn.close()
        return
    try:
        with conn.cursor() as cur:
            changed = 0
            for rid, old, new in remap:
                cur.execute(
                    """UPDATE museum_objects SET img_url = %s,
                         geocoding_notes = concat_ws(' | ', NULLIF(geocoding_notes, ''), %s)
                       WHERE id = %s AND img_url = %s AND COALESCE(review_status, '') <> 'verified'""",
                    (new, f"{NOTE_TAG} img_url was {old}", rid, old),
                )
                changed += cur.rowcount
        conn.commit()
        print(f"Committed: {changed} img_urls remapped. Restart Strapi to rebuild the views.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
