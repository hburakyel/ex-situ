#!/usr/bin/env python3
"""
refresh_rijks_images.py — Add the image to Rijksmuseum rows that have none, where
the museum has published one since the import.

Reads the current record from the museum's OAI-PMH feed for every Rijksmuseum row
with no img_url, except rows stored as in copyright (InC). An image is added only
when the record's current edm:rights is an open licence (the rule in
scrape_rijks.py), and it opens on the IIIF server. The rights value comes along
with it. Never touches review_status = 'verified'.

Results are kept in a cache file, so an interrupted run continues where it stopped.
Rows are matched by source_link + institution. Added rows carry [rijks-img-added]
in geocoding_notes; to undo:
    UPDATE museum_objects SET img_url = NULL
    WHERE institution_name = 'Rijksmuseum' AND geocoding_notes LIKE '%[rijks-img-added]%';

Usage (from etl/):
    python refresh_rijks_images.py            # dry run: counts + sample, no writes
    python refresh_rijks_images.py --apply
Then SELECT refresh_geospatial_views(); so the map views pick up the new URLs.
"""

import argparse
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter

from scrape_europeana import OPEN_RIGHTS

HERE = os.path.dirname(os.path.abspath(__file__))
HEADERS = {"User-Agent": "ExSitu/1.0 (+https://exsitu.app)"}
OAI_URL = "https://data.rijksmuseum.nl/oai"
IMAGE_WIDTH = 1000  # as in scrape_rijks.py
NOTE_TAG = "[rijks-img-added]"
DEFAULT_CACHE = os.path.join(HERE, "reports", "rijks_image_refresh.json")
SAVE_EVERY = 100
NS = {
    "edm": "http://www.europeana.eu/schemas/edm/",
    "ore": "http://www.openarchives.org/ore/terms/",
}
RDF_RESOURCE = "{http://www.w3.org/1999/02/22-rdf-syntax-ns#}resource"


def get_conn():
    import psycopg2
    from dotenv import load_dotenv

    load_dotenv(dotenv_path=os.path.join(HERE, "..", "backend", ".env"))
    return psycopg2.connect(
        host=os.environ.get("DATABASE_HOST", "127.0.0.1"), port=int(os.environ.get("DATABASE_PORT", 5432)),
        dbname=os.environ.get("DATABASE_NAME", ""), user=os.environ.get("DATABASE_USERNAME", ""),
        password=os.environ.get("DATABASE_PASSWORD", ""),
    )


def feed_record(source_link):
    """(edm:isShownBy, edm:rights) from the museum's current record; retries, then raises."""
    query = urllib.parse.urlencode({"verb": "GetRecord", "metadataPrefix": "edm", "identifier": source_link})
    for attempt in range(1, 5):
        try:
            with urllib.request.urlopen(urllib.request.Request(f"{OAI_URL}?{query}", headers=HEADERS), timeout=60) as r:
                agg = ET.fromstring(r.read()).find(".//ore:Aggregation", NS)
            if agg is None:  # withdrawn: the feed answers with an OAI error
                return None, None
            shown_by, rights = agg.find("edm:isShownBy", NS), agg.find("edm:rights", NS)
            return (
                shown_by.get(RDF_RESOURCE) if shown_by is not None else None,
                rights.get(RDF_RESOURCE) if rights is not None else None,
            )
        except (urllib.error.URLError, ET.ParseError, TimeoutError) as e:
            if attempt == 4:
                raise
            print(f"  retry {attempt} ({e})", flush=True)
            time.sleep(2 ** attempt)


def image_url(shown_by):
    """The web-sized form scrape_rijks.py stores."""
    return re.sub(r"/full/max/0/default\.jpg$", f"/full/{IMAGE_WIDTH},/0/default.jpg", shown_by)


def image_opens(url):
    """True when the IIIF server returns an image. resolveImageSrc asks for a fit-in box, not this width."""
    try:
        request = urllib.request.Request(url.replace(f"/full/{IMAGE_WIDTH},/", "/full/!600,600/"), headers=HEADERS)
        with urllib.request.urlopen(request, timeout=30) as r:
            return r.status == 200 and r.headers.get("Content-Type", "").startswith("image/")
    except (urllib.error.URLError, TimeoutError):
        return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="write the changes (default: dry run)")
    parser.add_argument("--limit", type=int, help="check only this many rows (for a test)")
    parser.add_argument("--sleep", type=float, default=0.3, help="seconds between feed requests")
    parser.add_argument("--cache", default=DEFAULT_CACHE)
    args = parser.parse_args()

    cache = {}
    if os.path.exists(args.cache):
        with open(args.cache) as f:
            cache = json.load(f)

    conn = get_conn()
    with conn.cursor() as cur:
        cur.execute(
            """SELECT source_link FROM museum_objects
               WHERE institution_name = 'Rijksmuseum' AND img_url IS NULL
                 AND source_link LIKE 'https://id.rijksmuseum.nl/%%'
                 AND COALESCE(image_rights, '') NOT LIKE '%%/InC/%%'
                 AND COALESCE(review_status, '') <> 'verified'
               ORDER BY source_link"""
        )
        links = [row[0] for row in cur.fetchall()]
    # End the read transaction before the feed calls: an idle-in-transaction session
    # holds a lock that blocks Strapi's start (DROP TRIGGER) and other writers.
    conn.rollback()
    if args.limit:
        links = links[:args.limit]
    print(f"{len(links)} rows without an image; {sum(l in cache for l in links)} already checked", flush=True)

    os.makedirs(os.path.dirname(args.cache), exist_ok=True)
    for done, link in enumerate(links, 1):
        if link not in cache:
            cache[link] = feed_record(link)
            time.sleep(args.sleep)
        if done % SAVE_EVERY == 0:
            with open(args.cache, "w") as f:
                json.dump(cache, f)
            print(f"  {done}/{len(links)}", flush=True)
    with open(args.cache, "w") as f:
        json.dump(cache, f)

    counts, found = Counter(), []
    for link in links:
        shown_by, rights = cache[link]
        if not shown_by:
            counts["no image at the museum"] += 1
        elif not rights or not any(r in rights for r in OPEN_RIGHTS):
            counts["image, rights not open now (left as is)"] += 1
        elif not image_opens(image_url(shown_by)):
            counts["image does not open (left as is)"] += 1
        else:
            counts["image to add"] += 1
            found.append((link, image_url(shown_by), rights))

    for label, n in counts.most_common():
        print(f"{label}: {n}")
    for link, url, rights in found[:15]:
        print(f"  {link} -> {url}  ({rights})")

    if not args.apply:
        print("dry run — nothing written (use --apply)")
        return
    updated = 0
    with conn.cursor() as cur:
        for link, url, rights in found:
            cur.execute(
                """UPDATE museum_objects SET img_url = %s, image_rights = %s,
                     geocoding_notes = CONCAT_WS(' ', NULLIF(geocoding_notes, ''), %s)
                   WHERE institution_name = 'Rijksmuseum' AND source_link = %s AND img_url IS NULL
                     AND COALESCE(review_status, '') <> 'verified'""",
                (url, rights, NOTE_TAG, link),
            )
            updated += cur.rowcount
    conn.commit()
    print(f"updated {updated} rows")


if __name__ == "__main__":
    main()
