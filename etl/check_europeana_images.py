#!/usr/bin/env python3
"""
check_europeana_images.py — Find Europeana image URLs that will not load on Ex Situ.

Europeana objects are only indexed with a loadable image. Many providers'
edmIsShownBy links do not load in a browser: TIFF files, HTML viewers
(Sketchfab), bot walls, 404s, 401/403, or images served with
Cross-Origin-Resource-Policy: same-origin.

Input:
  europeana_objects.json       resolver output
  europeana_image_groups.json  per (institution|host) verdict from a browser
                               sample on the site itself (with its CSP):
                               "drop" = no sampled image loaded,
                               "check_each" = some loaded, some did not.
                               Groups not listed loaded every sampled image.

For "check_each" groups every URL is fetched once (cached in
europeana_image_url_check.jsonl): it passes with HTTP 200, a content type a
browser can display, and no same-origin/same-site CORP header.

Output: europeana_image_check.json {"bad_urls": [...]} — the resolver leaves
these objects out (scrape_europeana.py --apply --finalize-only).

Usage:
    python etl/check_europeana_images.py
"""

import json
import os
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
OBJECTS = os.path.join(HERE, "europeana_objects.json")
GROUPS = os.path.join(HERE, "europeana_image_groups.json")
CACHE = os.path.join(HERE, "europeana_image_url_check.jsonl")
OUTPUT = os.path.join(HERE, "europeana_image_check.json")

DISPLAYABLE = ("image/jpeg", "image/png", "image/gif", "image/webp", "image/avif", "image/svg+xml")
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Safari/605.1.15",
    "Accept": "image/avif,image/webp,image/*,*/*;q=0.8",
}


def group_key(r: dict) -> str:
    return f"{r['institution_name']}|{urlparse(r['img_url']).netloc}"


def check(url: str) -> tuple:
    try:
        with requests.get(url, headers=HEADERS, timeout=30, stream=True, allow_redirects=True) as resp:
            ctype = resp.headers.get("Content-Type", "").split(";")[0].strip().lower()
            corp = resp.headers.get("Cross-Origin-Resource-Policy", "").lower()
            ok = resp.status_code == 200 and ctype in DISPLAYABLE and corp not in ("same-origin", "same-site")
            return url, ok, f"{resp.status_code} {ctype}{' corp=' + corp if corp else ''}"
    except requests.RequestException as exc:
        return url, False, type(exc).__name__


def main():
    records = json.load(open(OBJECTS, encoding="utf-8"))
    groups = json.load(open(GROUPS, encoding="utf-8"))["groups"]

    cache = {}
    if os.path.exists(CACHE):
        for line in open(CACHE, encoding="utf-8"):
            e = json.loads(line)
            cache[e["url"]] = e["ok"]

    bad = set()
    todo = []
    for r in records:
        if not r["img_url"]:
            continue
        verdict = groups.get(group_key(r))
        if verdict == "drop":
            bad.add(r["img_url"])
        elif verdict == "check_each" and r["img_url"] not in cache:
            todo.append(r["img_url"])
    todo = sorted(set(todo))
    print(f"{len(bad):,} URLs in dropped groups; {len(todo):,} to check one by one")

    with open(CACHE, "a", encoding="utf-8") as out, ThreadPoolExecutor(8) as pool:
        for i, (url, ok, why) in enumerate(pool.map(check, todo), 1):
            cache[url] = ok
            out.write(json.dumps({"url": url, "ok": ok, "why": why}, ensure_ascii=False) + "\n")
            if i % 2000 == 0:
                out.flush()
                print(f"  {i:,} / {len(todo):,}")

    for r in records:
        if r["img_url"] and groups.get(group_key(r)) == "check_each" and not cache.get(r["img_url"], False):
            bad.add(r["img_url"])

    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump({"bad_urls": sorted(bad)}, f, ensure_ascii=False)
    print(f"{len(bad):,} image URLs will not load → {OUTPUT}")


if __name__ == "__main__":
    main()
