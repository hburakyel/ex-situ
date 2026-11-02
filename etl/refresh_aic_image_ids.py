#!/usr/bin/env python3
"""
refresh_aic_image_ids.py — Point Art Institute of Chicago img_url values at the
image the museum shows today. AIC replaces an artwork's photograph now and then;
the old IIIF id then answers 404, and the map lists the object by its inventory
number although artic.edu shows an image (1923.1174, artworks/9752).

Reads the current image_id from the AIC API (100 artworks per request) for every
AIC row and rebuilds the URL the way scrape_aic_api.py does. Rows whose artwork
has no image now are listed and left unchanged. The old URL is kept in
geocoding_notes ([aic-img-refreshed] tag). Never touches review_status = 'verified'.

Usage (from etl/):
    python refresh_aic_image_ids.py            # dry run: counts + sample, no writes
    python refresh_aic_image_ids.py --apply
Then SELECT refresh_geospatial_views(); so the map views pick up the new URLs.
"""

import argparse
import json
import os
import re
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
HEADERS = {"User-Agent": "ExSitu/1.0 (+https://exsitu.app)", "AIC-User-Agent": "ExSitu (+https://exsitu.app)"}
NOTE_TAG = "[aic-img-refreshed]"
ARTWORK_RE = re.compile(r"/artworks/(\d+)")
IIIF_RE = re.compile(r"/iiif/2/([0-9a-f-]{36})/")


def get_conn():
    import psycopg2
    from dotenv import load_dotenv

    load_dotenv(dotenv_path=os.path.join(HERE, "..", "backend", ".env"))
    return psycopg2.connect(
        host=os.environ.get("DATABASE_HOST", "127.0.0.1"), port=int(os.environ.get("DATABASE_PORT", 5432)),
        dbname=os.environ.get("DATABASE_NAME", ""), user=os.environ.get("DATABASE_USERNAME", ""),
        password=os.environ.get("DATABASE_PASSWORD", ""),
    )


def current_image_ids(artwork_ids):
    """{artwork id: image_id or None} from the AIC API; one retry per batch."""
    url = "https://api.artic.edu/api/v1/artworks?limit=100&fields=id,image_id&ids=" + ",".join(map(str, artwork_ids))
    for attempt in range(2):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=60) as resp:
                return {x["id"]: x.get("image_id") for x in json.load(resp)["data"]}
        except Exception:
            if attempt == 1:
                raise
            time.sleep(5)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="write the changes (default: dry run)")
    args = parser.parse_args()

    conn = get_conn()
    with conn.cursor() as cur:
        cur.execute(
            """SELECT id, source_link, img_url FROM museum_objects
               WHERE institution_name = 'Art Institute of Chicago' AND img_url LIKE '%%/iiif/2/%%'
                 AND COALESCE(review_status, '') <> 'verified'"""
        )
        rows = []
        for row_id, link, img in cur.fetchall():
            a, i = ARTWORK_RE.search(link or ""), IIIF_RE.search(img or "")
            if a and i:
                rows.append((row_id, int(a.group(1)), i.group(1), img))
    # End the read transaction before the API calls: an idle-in-transaction session
    # holds a lock that blocks Strapi's start (DROP TRIGGER) and other writers.
    conn.rollback()
    print(f"{len(rows)} AIC rows with an artwork id and a IIIF image")

    changed, gone = [], []
    for start in range(0, len(rows), 100):
        batch = rows[start:start + 100]
        current = current_image_ids([r[1] for r in batch])
        for row_id, artwork, image_id, img in batch:
            now = current.get(artwork)
            if artwork in current and now is None:
                gone.append((row_id, artwork, img))
            elif now and now != image_id:
                changed.append((row_id, artwork, img, f"https://www.artic.edu/iiif/2/{now}/full/843,/0/default.jpg"))
        time.sleep(0.5)

    print(f"image changed at AIC: {len(changed)}; no image at AIC now (left as is): {len(gone)}")
    for row_id, artwork, old, new in changed[:15]:
        print(f"  artworks/{artwork}: {old.split('/')[5]} -> {new.split('/')[5]}")
    for row_id, artwork, old in gone[:10]:
        print(f"  no image now: artworks/{artwork}")

    if not args.apply:
        print("dry run — nothing written (use --apply)")
        return
    with conn.cursor() as cur:
        for row_id, artwork, old, new in changed:
            cur.execute(
                """UPDATE museum_objects SET img_url = %s,
                     geocoding_notes = CONCAT_WS(' ', NULLIF(geocoding_notes, ''), %s)
                   WHERE id = %s AND COALESCE(review_status, '') <> 'verified'""",
                (new, f"{NOTE_TAG} old img_url: {old}", row_id),
            )
    conn.commit()
    print(f"updated {len(changed)} rows")


if __name__ == "__main__":
    main()
