#!/usr/bin/env python3
"""
scrape_wmw.py — Weltmuseum Wien resolver for Ex Situ

Source: the Weltmuseum Wien online collection (https://www.weltmuseumwien.at/en/objects,
~50,700 objects). There is no API, OAI-PMH or Europeana dataset for it (Europeana's
"World Museum Vienna" set is ~9,000 archive and photo records). robots.txt allows the
object pages and disallows the search and facet URLs, so objects are listed from the
sitemap (/en/sitemap.xml, 51 "objects" pages) and each object page is read once.

Stages (each writes local files only, never the database):

  enumerate  object page URLs from the sitemap
  fetch      the fields of each object page, cached as JSONL; resumable
  map        cache -> museum_objects records (see ORIGIN RULE), with a report

ORIGIN RULE: the page's "Geography" is a German path from continent down to a
place ("Afrika südlich der Sahara/West-Afrika/Kamerun/Nordwest-Kamerun/Bamum/Fumban").
It is the place of production, not the subject ("Jerusalem aus der Vogelperspektive",
a print, has .../Deutschland/Bayern/München). Its "Collection area" is not an origin
and not a scope filter: an Austrian suitcase is filed under "Afrika südlich der Sahara".
  1. Path starting with "Europa", or whose country is European -> left out (counted).
     A European country under a non-European branch ("Nordafrika/.../Spanien") is
     flagged for review instead, except Russia under an Asian branch (Siberia).
  2. Country = the deepest segment found in wmw_countries.json (Dänemark/Grönland -> Greenland).
  3. The deepest segment is placed only on a single exact GeoNames match of a
     populated place (or island) in that country; a first-level region name is never
     matched to a town of the same name. Otherwise the record keeps the country
     label and Ex Situ's existing point for that country. No fuzzy matching.
  4. No country in the path (Tibet, Korea, Neuguinea, "Ostasien") or no geography -> flagged.
Photographs and pictures (Fotosammlung, Bildersammlung) are kept like objects (user
decision 2026-10-22); their Geography is the museum's own place for the item.

Images: the page's own /pics/<id>/<file>.jpg (stable, full size), hotlinked, never copied.
KHM-Museumsverband licence for non-commercial use: CC BY-NC-SA 4.0, "©KHM-Museumsverband".
No people names are kept (collector, "Accession via", photographer).

Usage:
  python scrape_wmw.py enumerate
  python scrape_wmw.py fetch --limit 20                 # sample
  python scrape_wmw.py fetch                            # all (~50k pages, ~14 h at 1 req/s)
  python scrape_wmw.py map --dry-run                    # report + sample records
  python scrape_wmw.py map                              # write wmw_objects.json / wmw_flagged.json
"""

from __future__ import annotations

import argparse
import collections
import csv
import hashlib
import html
import json
import math
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import zipfile

ETL_DIR = os.path.dirname(os.path.abspath(__file__))
GAZETTEER_DIR = os.path.join(ETL_DIR, "data", "gazetteer")
BASE = "https://www.weltmuseumwien.at"
EXSITU_API = "https://exsitu.app/api"
UA = "ExSitu-index (https://exsitu.app; indexer, links back to Weltmuseum Wien records)"
PAUSE_SECONDS = 1.0
NOTE_TAG = "[wmw]"
INSTITUTION = {
    "institution_name": "Weltmuseum Wien",
    "institution_place": "Vienna, Austria",
    "institution_latitude": 48.2049,          # OpenStreetMap, Heldenplatz (Neue Burg)
    "institution_longitude": 16.3639,
    "institution_city_en": "Vienna",
    "institution_country_en": "Austria",
}
IMAGE_RIGHTS = "https://creativecommons.org/licenses/by-nc-sa/4.0/"  # the object pages' licence link
UNLABELLED_EVENT = "Attributed place"
ASIAN_BRANCHES = {"Nordasien", "Zentralasien", "Westasien", "Asien"}
ISLAND_CODES = {"ISL", "ISLET", "ATOL", "ISLT", "ISLS"}
SITE_CODES = {"RUIN", "ANS", "HSTS", "MSSN"}
# Segments that name a place inside one country but are not country labels: they give
# the country to search in, never a country point.
REGION_COUNTRY = {
    "Osterinsel": "Chile", "Hawaii Inseln": "United States", "Gaza": "Palestine",
    "Gesellschaftsinseln": "French Polynesia", "Marquesas Inseln": "French Polynesia",
    "Austral Inseln": "French Polynesia",
}
# Country labels that name a territory and may follow their state in the path.
TERRITORIES = {"Grönland"}
FIELDS = ("object_name", "time", "entry_date", "culture", "medium", "department", "thesaurus", "object_number")


def pause(seconds: float) -> None:
    # time.sleep() is stretched for background processes on macOS (timer
    # coalescing); a short busy wait keeps the pace predictable.
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        pass


def get(url: str, retries: int = 6) -> tuple[int, str]:
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                return e.code, ""
            last = e
        except Exception as e:  # timeouts, resets
            last = e
        pause(5 * (attempt + 1))
    return 0, str(last)


def stable_object_id(uri: str) -> int:
    """object_id is a bigint that also passes through JS numbers (exact to 2**53): a
    stable 53-bit id from the object's page URL, as scrape_europeana.py does."""
    return int.from_bytes(hashlib.sha256(uri.encode()).digest()[:8], "big") >> 11


# ---------------------------------------------------------------- enumerate

def cmd_enumerate(args) -> None:
    status, index = get(f"{BASE}/en/sitemap.xml")
    if status != 200:
        sys.exit(f"sitemap index: HTTP {status}")
    pages = [html.unescape(u) for u in re.findall(r"<loc>([^<]*sitemap=objects[^<]*)</loc>", index)]
    urls = []
    for i, p in enumerate(pages, 1):
        status, xml = get(p)
        if status != 200:
            sys.exit(f"sitemap page {p}: HTTP {status}")
        urls += [html.unescape(u) for u in re.findall(r"<loc>([^<]+/en/objects/[^<]+)</loc>", xml)]
        print(f"  sitemap {i}/{len(pages)}: {len(urls)} urls", flush=True)
        pause(PAUSE_SECONDS)
    urls = list(dict.fromkeys(urls))
    json.dump(urls, open(args.output, "w", encoding="utf-8"), indent=0)
    print(f"wrote {len(urls)} object urls to {args.output}")


# -------------------------------------------------------------------- fetch

def _clean(s: str) -> str:
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", s)).split())


def parse_page(page: str) -> dict:
    """Fields of one object page. Each field sits in <div class="details-<key>"><p> Label <br> … <strong>value</strong>."""
    out = {}
    h1 = re.search(r'<h1 class="online-collection__title[^"]*">(.*?)</h1>', page, re.S)
    out["title"] = _clean(h1.group(1)) if h1 else None
    for key in FIELDS:
        m = re.search(r'<div class="details-%s\b[^"]*">\s*<p>(.*?)</p>' % key, page, re.S)
        if m:
            strong = re.findall(r"<strong>(.*?)</strong>", m.group(1), re.S)
            out[key] = "; ".join(_clean(s) for s in strong if _clean(s)) or None
    imgs = re.findall(r'property="og:image" content="(%s/pics/[^"]+)"' % re.escape(BASE), page)
    out["image"] = html.unescape(imgs[0]) if imgs else None
    return out


def cmd_fetch(args) -> None:
    urls = json.load(open(args.urls, encoding="utf-8"))
    done = set()
    if os.path.exists(args.cache):
        for line in open(args.cache, encoding="utf-8"):
            r = json.loads(line)
            if r.get("status") == 200:
                done.add(r["url"])
    todo = [u for u in urls if u not in done]
    if args.limit:
        todo = todo[: args.limit]
    print(f"{len(urls)} urls, {len(done)} cached, fetching {len(todo)}", flush=True)
    with open(args.cache, "a", encoding="utf-8") as out:
        for i, url in enumerate(todo, 1):
            status, page = get(url)
            rec = {"url": url, "status": status, "fetched": time.strftime("%Y-%m-%d")}
            if status == 200:
                rec.update(parse_page(page))
            out.write(json.dumps(rec, ensure_ascii=False) + "\n")
            out.flush()
            if i % 500 == 0:
                print(f"  {i}/{len(todo)}", flush=True)
            pause(PAUSE_SECONDS)
    print("done")


# ---------------------------------------------------------------------- map

def name_variants(label: str) -> list[str]:
    """'Süd-Sulawesi (Selatan)' -> itself, Süd-Sulawesi, Selatan; 'A / B' -> A, B; plus accent-free forms."""
    label = label.replace("(?)", "").strip()
    out = [label]
    if "(" in label and label.endswith(")"):
        outer, inner = label[:-1].split("(", 1)
        out += [outer.strip(), inner.strip(), *[x.strip() for x in inner.split(",")]]
    out += [x.strip() for v in list(out) for x in re.split(r" / |, ", v) if (" / " in v or ", " in v)]
    out += [unicodedata.normalize("NFKD", v).encode("ascii", "ignore").decode() for v in out]
    return [v for v in dict.fromkeys(out) if v and "(" not in v[:1]]


def km(a, b) -> float:
    """Great-circle distance between two (lat, lon) points."""
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


class Places:
    """German country labels, Ex Situ's own country points, and exact GeoNames lookups."""

    def __init__(self, gazetteer_dir: str, countries_path: str):
        self.country_of = {}                      # German label -> country_en
        for country_en, names in json.load(open(countries_path, encoding="utf-8")).items():
            if not country_en.startswith("_"):
                for n in names:
                    self.country_of[n] = country_en
        self.iso, self.continent = {}, {}
        for line in open(os.path.join(gazetteer_dir, "countryInfo.txt"), encoding="utf-8"):
            if line.startswith("#"):
                continue
            f = line.rstrip("\n").split("\t")
            if len(f) > 8:
                self.iso[f[4]] = f[0]
                self.continent[f[0]] = f[8]
        self.iso.update({"United States": "US", "Côte d'Ivoire": "CI", "Palestine": "PS", "Czechia": "CZ",
                         "Timor-Leste": "TL", "Gambia": "GM", "Cabo Verde": "CV", "Reunion": "RE",
                         "Federated States of Micronesia": "FM", "Republic of the Congo": "CG",
                         "Democratic Republic of the Congo": "CD", "South Korea": "KR", "North Korea": "KP",
                         "Eswatini": "SZ", "Myanmar": "MM", "United Kingdom": "GB"})
        self.admin1 = set()                       # (cc, lower name) of first-level regions
        for line in open(os.path.join(gazetteer_dir, "admin1CodesASCII.txt"), encoding="utf-8"):
            f = line.rstrip("\n").split("\t")
            if len(f) == 4:
                cc = f[0].split(".")[0]
                self.admin1 |= {(cc, f[1].lower()), (cc, f[2].lower())}
        self.gaz: dict[tuple, set] = {}
        for line in open(os.path.join(gazetteer_dir, "cities500.txt"), encoding="utf-8"):
            f = line.rstrip("\n").split("\t")
            for n in {f[1], f[2], *[a for a in f[3].split(",") if a]}:
                self.gaz.setdefault((f[8], n.lower()), set()).add((f[0], float(f[4]), float(f[5]), "P", f[7]))
        self.points_path = os.path.join(ETL_DIR, "wmw_country_points.json")
        self.points = json.load(open(self.points_path, encoding="utf-8")) if os.path.exists(self.points_path) else {}

    def add_country_files(self, folder: str, wanted: set[str]) -> None:
        """GeoNames country dumps (<CC>.zip): villages and islands cities500 lacks; only the names asked for."""
        if not os.path.isdir(folder):
            return
        for fn in sorted(os.listdir(folder)):
            if not fn.endswith(".zip"):
                continue
            cc = fn[:-4]
            with zipfile.ZipFile(os.path.join(folder, fn)) as z, z.open(f"{cc}.txt") as fh:
                for raw in fh:
                    f = raw.decode("utf-8").rstrip("\n").split("\t")
                    for n in {f[1].lower(), f[2].lower(), *[a.lower() for a in f[3].split(",") if a]}:
                        if n in wanted:
                            self.gaz.setdefault((cc, n), set()).add((f[0], float(f[4]), float(f[5]), f[6], f[7]))

    def is_european(self, country_en: str) -> bool:
        return self.continent.get(self.iso.get(country_en, "")) == "EU"

    def country_point(self, country_en: str):
        """Ex Situ's own point for rows whose place is just this country: >= 3 such rows, >= 60 % on or
        within 50 km of the most used point (collections put Vietnam at 16,108 and 15.927,107.965)."""
        if country_en not in self.points:
            # site=<country> lists the rows on the country's own site (not its cities)
            q = urllib.parse.urlencode({"country": country_en, "site": country_en, "pageSize": 100})
            status, body = get(f"{EXSITU_API}/museum-objects/by-country?{q}")
            votes = collections.Counter()
            if status == 200:
                for row in json.loads(body).get("data", []):
                    a = row.get("attributes", {})
                    if a.get("latitude") is not None and a.get("country_en") in (country_en, None):
                        votes[(round(a["latitude"], 3), round(a["longitude"], 3))] += 1
            point = None
            if votes:
                (lat, lon), top = votes.most_common(1)[0]
                n = sum(v for p, v in votes.items() if km((lat, lon), p) <= 50)
                if top >= 3 and n / sum(votes.values()) >= 0.6:
                    point = [lat, lon]
            self.points[country_en] = point
            json.dump(self.points, open(self.points_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
            pause(0.3)
        return self.points[country_en]

    def resolve(self, label: str, country_en: str):
        """-> (lat, lon, source) for a single exact match in the country, else None."""
        cc = self.iso.get(country_en)
        # two names in one level ("Alwar / Sariska"): a match on one would misplace the other
        if not cc or " / " in label or any((cc, v.lower()) in self.admin1 for v in name_variants(label)):
            return None
        hits = {}
        for v in name_variants(label):
            for gid, lat, lon, fclass, fcode in self.gaz.get((cc, v.lower()), set()):
                if fclass == "P" or (fclass == "T" and fcode in ISLAND_CODES) or (fclass == "S" and fcode in SITE_CODES):
                    hits[gid] = (lat, lon, fcode)
        if len(hits) == 1:
            gid, (lat, lon, fcode) = next(iter(hits.items()))
            return round(lat, 5), round(lon, 5), f"GeoNames {gid} {fcode} (single exact match in {cc})"
        return None


def choose_origin(path: str | None, places: Places) -> dict:
    # "/" separates levels; " / " inside a level joins two names ("Alwar / Sariska")
    segs = [s.strip() for s in re.split(r"(?<! )/(?! )", path or "")
            if s.strip() and s.strip() not in ("unbekannt", "unbestimmt")]
    if not segs:
        return {"kind": "flag", "why": "no geography"}
    if segs[0] == "Europa":
        return {"kind": "europe", "why": "Europa branch"}
    # The first country in the path is the country; a deeper label that is also a
    # country name is a place inside it ("Nigeria/Benin" is the Benin Kingdom), except
    # a territory under its state ("Dänemark/Grönland").
    countries = [i for i, s in enumerate(segs) if s in places.country_of]
    idx = countries[0] if countries else None
    for i in countries[1:]:
        if segs[i] in TERRITORIES:
            idx = i
    country_label = segs[idx] if idx is not None else None
    if idx is None:
        idx = next((i for i, s in enumerate(segs) if s in REGION_COUNTRY), None)
        if idx is None:
            return {"kind": "flag", "why": "no country in path", "segs": segs}
    country_en = places.country_of[country_label] if country_label else REGION_COUNTRY[segs[idx]]
    if places.is_european(country_en) and not (country_en == "Russia" and segs[0] in ASIAN_BRANCHES):
        return {"kind": "flag", "why": f"European country under {segs[0]}", "segs": segs, "country_en": country_en}
    return {"kind": "ok", "segs": segs, "country_en": country_en, "country_label": country_label,
            "deepest": segs[-1] if len(segs) - 1 > idx or not country_label else None}


CENTURY = r"(\d{1,2})\.?\s*(?:th|st|nd|rd)?\.?\s*(?:century|Jahrhundert|Jh\.?)"


def parse_years(s: str | None) -> tuple:
    """Conservative: years only where the text states them; centuries as their full span."""
    if not s:
        return None, None
    t = s.strip()
    if re.search(r"\b(BC|BCE|v\.\s*Chr)\b", t, re.I):
        return None, None
    m = re.fullmatch(r"(?:\d{1,2}\.\d{1,2}\.)?(\d{4})(?:-\d{2}-\d{2})?", t)                 # 1965, 23.8.1893
    if m:
        return int(m.group(1)), int(m.group(1))
    m = re.fullmatch(r"(?:um|ca\.?|c\.|circa|around)\s*(\d{4})", t, re.I)
    if m:
        return int(m.group(1)), int(m.group(1))
    m = re.fullmatch(r"(?:vor|before)\s*(\d{4})|(\d{4})\s*or earlier", t, re.I)
    if m:
        return None, int(m.group(1) or m.group(2))
    m = re.fullmatch(r"(\d{4})\s*[-–]\s*(\d{4})", t)
    if m and int(m.group(1)) <= int(m.group(2)):
        return int(m.group(1)), int(m.group(2))
    m = re.fullmatch(r"(\d{1,2})(?:th|st|nd|rd)/(\d{1,2})(?:th|st|nd|rd) century", t, re.I)   # 16th/17th century
    cents = [int(m.group(1)), int(m.group(2))] if m else [int(c) for c in re.findall(CENTURY, t, re.I)]
    if cents and all(1 <= c <= 21 for c in cents):
        return (min(cents) - 1) * 100 + 1, max(cents) * 100
    return None, None


def cmd_map(args) -> None:
    places = Places(args.gazetteer, args.countries)
    rows = {}
    for line in open(args.cache, encoding="utf-8"):
        r = json.loads(line)
        rows[r["url"]] = r                       # last line wins (re-fetched errors)
    wanted = {v.lower() for r in rows.values() for s in (r.get("thesaurus") or "").split("/")[-1:]
              for v in name_variants(s)}
    places.add_country_files(os.path.join(args.gazetteer, "countries"), wanted)

    stats, unresolved = collections.Counter(), collections.Counter()
    kept, flagged, today = [], [], time.strftime("%Y-%m-%d")
    for url, d in rows.items():
        if d.get("status") != 200:
            stats[f"fetch HTTP {d.get('status')}"] += 1
            continue
        o = choose_origin(d.get("thesaurus"), places)
        if o["kind"] == "europe":
            stats["left out: Europa branch"] += 1
            continue
        notes = [f"origin from Weltmuseum Wien Geography \"{d.get('thesaurus')}\""] if d.get("thesaurus") else []
        place_name, lat, lon, country_en, level = None, None, None, o.get("country_en"), None
        if o["kind"] == "ok":
            loc = places.resolve(o["deepest"], country_en) if o["deepest"] else None
            if loc:
                place_name, (lat, lon, source), level = o["deepest"], loc, "place"
                notes.append(f"coordinates: {source}")
            else:
                if o["deepest"]:
                    unresolved[(o["deepest"], country_en)] += 1
                    notes.append(f"specific place not resolved: {o['deepest']}")
                point = places.country_point(country_en) if o["country_label"] else None
                if point:
                    place_name, (lat, lon), level = o["country_label"], point, "country"
                    notes.append("coordinates: Ex Situ country point")
                else:
                    o = {**o, "kind": "flag", "why": "no country point" if o["country_label"] else "region without country label"}
        stats[f"kept: {level}" if o["kind"] == "ok" else f"flagged: {o['why']}"] += 1
        start, end = parse_years(d.get("time"))
        inv = d.get("object_number")
        # Photo and picture pages show no "Invs."; their image files are named after the
        # collection number the way object images are (VO_64667.jpg for Invs. 64667,
        # 41/41 in the sample): VF_17191.jpg -> "VF_17191".
        m = re.search(r"/pics/\d+/(V[A-Z])_(\d+)", d.get("image") or "")
        if not inv and m:
            inv = f"{m.group(1)}_{m.group(2)}"
            notes.append("inventory number from the image file name")
        rec = {
            "object_id": stable_object_id(url),
            "title": d.get("title") or d.get("object_name"),
            "img_url": d.get("image"),
            "image_rights": IMAGE_RIGHTS if d.get("image") else None,
            "source_link": url,
            **INSTITUTION,
            "inventory_number": inv,
            "place_name": place_name,
            "latitude": lat,
            "longitude": lon,
            "country_en": country_en,
            "origin_event_type_en": UNLABELLED_EVENT if place_name else None,
            "origin_is_findspot": False if place_name else None,
            "object_date": d.get("time"),
            "time": [{"time_name": d["time"], "time_start": start, "time_end": end}]
                    if d.get("time") and (start is not None or end is not None) else [],
            "acquisition_year": int(d["entry_date"][:4]) if re.match(r"^\d{4}", d.get("entry_date") or "") else None,
            "object_links": [{"link_text": url, "link_display": "Institution object page"}],
            "geocoder_source": "wmw",
            "geocoding_status": "ok" if o["kind"] == "ok" else "ambiguous",
            "geocoding_notes": f"{NOTE_TAG} {today} " + "; ".join(notes) + "; desk review, not verified"
                               + ("" if o["kind"] == "ok" else f"; flagged: {o['why']}"),
            "review_status": None if o["kind"] == "ok" else "pending",
        }
        (kept if o["kind"] == "ok" else flagged).append(rec)

    print(f"{len(rows)} cached pages")
    for k, v in sorted(stats.items(), key=lambda kv: -kv[1]):
        print(f"  {v:>7}  {k}")
    base = os.path.splitext(args.output)[0]
    with open(base + "_unresolved.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["label", "country_en", "objects"])
        for (label, cen), n in unresolved.most_common():
            w.writerow([label, cen, n])
    print(f"unresolved specific places: {len(unresolved)} labels -> {base}_unresolved.csv")
    if args.dry_run:
        for rec in kept[: args.show]:
            print(json.dumps({k: rec[k] for k in ("source_link", "inventory_number", "title", "place_name", "latitude",
                                                  "longitude", "country_en", "object_date", "time", "img_url",
                                                  "geocoding_notes")}, ensure_ascii=False))
        for rec in flagged[: max(3, args.show // 3)]:
            print("FLAGGED", json.dumps({k: rec[k] for k in ("source_link", "country_en", "geocoding_notes")},
                                        ensure_ascii=False))
        return
    json.dump(kept, open(args.output, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump(flagged, open(args.flagged_output, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"wrote {len(kept)} records to {args.output}, {len(flagged)} flagged to {args.flagged_output}")


# ---------------------------------------------------------------------- main

def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("enumerate", help="object page urls from the sitemap")
    e.add_argument("--output", default=os.path.join(ETL_DIR, "wmw_urls.json"))
    f = sub.add_parser("fetch", help="cache object page fields (resumable)")
    f.add_argument("--urls", default=os.path.join(ETL_DIR, "wmw_urls.json"))
    f.add_argument("--cache", default=os.path.join(ETL_DIR, "wmw_details.jsonl"))
    f.add_argument("--limit", type=int)
    m = sub.add_parser("map", help="cache -> museum_objects JSON")
    m.add_argument("--cache", default=os.path.join(ETL_DIR, "wmw_details.jsonl"))
    m.add_argument("--gazetteer", default=GAZETTEER_DIR)
    m.add_argument("--countries", default=os.path.join(ETL_DIR, "wmw_countries.json"))
    m.add_argument("--output", default=os.path.join(ETL_DIR, "wmw_objects.json"))
    m.add_argument("--flagged-output", default=os.path.join(ETL_DIR, "wmw_flagged.json"))
    m.add_argument("--dry-run", action="store_true")
    m.add_argument("--show", type=int, default=15)
    args = p.parse_args()
    {"enumerate": cmd_enumerate, "fetch": cmd_fetch, "map": cmd_map}[args.cmd](args)


if __name__ == "__main__":
    main()
