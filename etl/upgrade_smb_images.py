#!/usr/bin/env python3
"""
upgrade_smb_images.py — Replace museum-digital SMB images with SMB's current ones.

Many SMB objects still show the museum-digital copy of their photo: 500 px, with
the Stiftung Preußischer Kulturbesitz caption bar burnt in. SMB's own collection
site (search.smb.museum) has the current photography. The museum-digital record
names SMB's object id in its image link (…eMuseumPlus?…&objectId=1305434…), and
https://search.smb.museum/object/obj-1305434 lists that object's images, the
current main image first.

  check    for each SMB object whose image is on smb.museum-digital.de:
             museum-digital JSON → SMB object id → search.smb.museum object page
             → first image; accepted only if the page's "Ident. Nr." equals our
             inventory number and the image answers. Resumable cache; no DB writes.
  report   counts and a few examples to compare by eye
  apply    img_url → the search.smb.museum image, source_link → the
           search.smb.museum object page; old values kept in geocoding_notes
           ([smb-upgrade] tag). Verified rows untouched. --dry-run rolls back.

Usage (from etl/):
    python upgrade_smb_images.py check [--workers 2]
    python upgrade_smb_images.py report
    python upgrade_smb_images.py apply --dry-run
    python upgrade_smb_images.py apply
"""

import argparse
import html
import json
import os
import re
import threading
import time
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "reports", "smb_image_upgrade.jsonl")
UA = {"User-Agent": "ExSitu/1.0 (+https://exsitu.app)"}
NOTE_TAG = "[smb-upgrade]"
SMB_INSTITUTIONS = [
    "Ethnologisches Museum", "Museum für Islamische Kunst", "Antikensammlung", "Museum für Asiatische Kunst",
    "Ägyptisches Museum und Papyrussammlung", "Vorderasiatisches Museum",
]
IMAGE_ID = re.compile(r"media/images/(?:thumbs/\w+|originals)/\d+/(?:\d+/)?(\d+)\.")
IDENT = re.compile(r"Ident\. Nr\.:\s*([^<]+)</p>")


def get_conn():
    import psycopg2
    from dotenv import load_dotenv

    load_dotenv(dotenv_path=os.path.join(HERE, "..", "backend", ".env"))
    return psycopg2.connect(
        host=os.environ.get("DATABASE_HOST", "127.0.0.1"), port=int(os.environ.get("DATABASE_PORT", 5432)),
        dbname=os.environ.get("DATABASE_NAME", ""), user=os.environ.get("DATABASE_USERNAME", ""),
        password=os.environ.get("DATABASE_PASSWORD", ""),
    )


def key(inv):
    return re.sub(r"\s+", "", html.unescape(inv or "")).lower()


def fetch(url, as_json=False):
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=45) as resp:
                body = resp.read()
            if not as_json:
                return body.decode("utf-8", "replace")
            data = json.loads(body)
            # museum-digital overload: HTTP 200 + {"status":"error","code":503}
            if isinstance(data, dict) and data.get("status") == "error" and data.get("code") == 503:
                raise IOError("busy")
            return data
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(10 * (attempt + 1))
        except Exception:
            time.sleep(10 * (attempt + 1))
    raise RuntimeError(f"unreachable: {url}")


def search_url(asset_id):
    """Same layout as refetch_smb_image_urls.compute_search_url: dir1 = (id/1000) % 1000,
    dir2 = id/1e6, omitted when 0."""
    n = int(asset_id)
    q1 = n // 1000
    dir1 = f"{q1 % 1000:03d}"
    if q1 // 1000 == 0:
        return f"https://search.smb.museum/media/images/thumbs/extra_large/{dir1}/{n}.jpg"
    return f"https://search.smb.museum/media/images/thumbs/extra_large/{dir1}/{q1 // 1000:03d}/{n}.jpg"


def image_ok(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as resp:
            return resp.status == 200 and resp.headers.get_content_type().startswith("image/")
    except Exception:
        return False


def check_one(row):
    rid, inv, md_id, old_img, old_link = row
    out = {"id": rid, "inventory": inv, "old_img": old_img, "old_link": old_link}
    data = fetch(f"https://smb.museum-digital.de/json/object/{md_id}", as_json=True)
    time.sleep(1.0)
    if not isinstance(data, dict) or data.get("status") in ("error", "Error") or "object_images" not in data:
        return {**out, "status": "md_record_missing"}
    images = data.get("object_images") or []
    main = next((im for im in images if im.get("is_main") == "j"), images[0] if images else None)
    m = re.search(r"objectId=(\d+)", (main or {}).get("filename_loc") or "")
    if not m:
        return {**out, "status": "no_smb_object_id"}
    smb_id = m.group(1)
    page = fetch(f"https://search.smb.museum/object/obj-{smb_id}")
    if not page:
        return {**out, "status": "smb_page_missing", "smb_id": smb_id}
    ident = IDENT.search(page)
    if not ident or key(ident.group(1)) != key(inv):
        return {**out, "status": "ident_mismatch", "smb_id": smb_id, "smb_ident": ident and ident.group(1).strip()}
    ids = []
    for a in IMAGE_ID.findall(page):
        if a not in ids:
            ids.append(a)
    if not ids:
        return {**out, "status": "no_smb_image", "smb_id": smb_id}
    url = search_url(ids[0])
    if not image_ok(url):
        return {**out, "status": "smb_image_unreachable", "smb_id": smb_id, "new_img": url}
    return {**out, "status": "upgrade", "smb_id": smb_id, "new_img": url,
            "new_link": f"https://search.smb.museum/object/obj-{smb_id}"}


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
        cur.execute(
            r"""SELECT id, inventory_number, substring(source_link from 'museum-digital\.de/object/([0-9]+)'),
                       img_url, source_link
                FROM museum_objects
                WHERE published_at IS NOT NULL AND institution_name = ANY(%s)
                  AND img_url LIKE 'https://smb.museum-digital.de%%'
                  AND source_link ~ 'museum-digital\.de/object/[0-9]+'
                  AND NULLIF(BTRIM(inventory_number), '') IS NOT NULL
                ORDER BY id""",
            [SMB_INSTITUTIONS],
        )
        rows = cur.fetchall()
    conn.close()
    done = load_cache()
    # Retry transient outcomes on a re-run; keep definitive ones.
    retry = {"smb_image_unreachable"}
    todo = [r for r in rows if r[0] not in done or done[r[0]]["status"] in retry]
    print(f"{len(rows)} SMB objects with a museum-digital image, {len(todo)} to check", flush=True)
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    lock, n = threading.Lock(), [0]
    with open(CACHE, "a", encoding="utf-8", buffering=1) as out:
        def work(row):
            try:
                r = check_one(row)
            except RuntimeError:
                return
            with lock:
                out.write(json.dumps(r, ensure_ascii=False) + "\n")
                n[0] += 1
                if n[0] % 250 == 0:
                    print(f"  {n[0]}/{len(todo)}", flush=True)
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            list(pool.map(work, todo))
    cmd_report(args)


def cmd_report(_args):
    done = load_cache()
    c = Counter(r["status"] for r in done.values())
    print(f"{len(done)} checked: {dict(c.most_common())}")
    for r in [r for r in done.values() if r["status"] == "upgrade"][:6]:
        print(f"  {r['inventory']}: {r['old_img']}\n      → {r['new_img']}  ({r['new_link']})")
    for r in [r for r in done.values() if r["status"] == "ident_mismatch"][:4]:
        print(f"  mismatch {r['inventory']!r} vs SMB {r.get('smb_ident')!r} (obj-{r['smb_id']})")


def cmd_apply(args):
    rows = [r for r in load_cache().values() if r["status"] == "upgrade"]
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            changed = 0
            for r in rows:
                cur.execute(
                    """UPDATE museum_objects SET
                         img_url = %s, source_link = %s,
                         geocoding_notes = concat_ws(' | ', NULLIF(geocoding_notes, ''), %s)
                       WHERE id = %s AND img_url = %s AND source_link = %s
                         AND COALESCE(review_status, '') <> 'verified'""",
                    (r["new_img"], r["new_link"],
                     f"{NOTE_TAG} img_url was {r['old_img']}; source_link was {r['old_link']}",
                     r["id"], r["old_img"], r["old_link"]),
                )
                changed += cur.rowcount
            print(f"Upgraded {changed} of {len(rows)} objects to SMB's current image and page.")
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
