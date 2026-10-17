"""
scrape_smb_search.py — Staatliche Museen zu Berlin objects from search.smb.museum
that Ex Situ does not have yet (museum-digital only exports part of some
collections: Ethnologisches Museum 123k on search.smb.museum, ~77k on museum-digital).

search.smb.museum has no documented API; its Nuxt site uses open JSON endpoints
(robots.txt allows everything; SMB marks object texts public domain):
  /api/objects/search-expert   listing, capped at start+limit <= 10,000, limit <= 300
  /api/objects/detail/obj-<N>  full record; <N> is the id behind id.smb.museum/object/<N>

Stages (each writes local files only, never the database):

  enumerate  list the collection's object ids. The listing is split by a
             case-sensitive geography prefix ("Ka*") until each slice fits the
             10,000 cap; a space or punctuation in the prefix makes the API fall
             back to the parent query, so only letters and digits are used.
             Objects with no geography (or one starting with lowercase or
             punctuation) are not reached; they cannot carry an origin anyway.
  fetch      detail records for the listed ids minus those already indexed
             (--exclude: JSON list of SMB ids), cached as JSONL; resumable.
  map        cache -> museum_objects records (see ORIGIN RULE), with a report.

ORIGIN RULE (user decision 2026-10-16, see the calibration in the PR/notes):
search.smb.museum gives places as German labels with a role and, sometimes, a
qualifier ("Fundort: X", "Herkunft (Allgemein): X", "Aufnahmeort: X"), but it
drops museum-digital's event types: a recording or photo place shows up as a
plain place. So:
  1. A place labelled "Fundort" or "Herkunft (Allgemein)" is an origin.
  2. Departments I-VI (material culture): the most specific unlabelled
     settlement or island, else the country. In a 150-object calibration every
     such place museum-digital also has was its "Created" place (115/115),
     never a Recorded/Collected one. Shown as an attributed place, not a findspot.
  3. Department VII (sound, media), VIII (photographs) and anything else:
     labelled places only (VIII: 7 of 12 places were Recorded/Collected).
  Places in Germany are held (VII W POW-camp recordings, objects made in Berlin).
  Objects with no origin are left out of the output (user decision).

Usage:
  python scrape_smb_search.py enumerate --org-unit "Ethnologisches Museum" --output smb_ethno_ids.json
  python scrape_smb_search.py fetch --ids smb_ethno_ids.json --exclude known_smb_ids.json --cache smb_ethno_details.jsonl [--limit 20]
  python scrape_smb_search.py map --cache smb_ethno_details.jsonl --output smb_search_objects.json [--dry-run]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.parse
import urllib.request

BASE = "https://search.smb.museum"
UA = "ExSitu-index (https://exsitu.app; indexer, links back to SMB records)"
PAGE = 300
CAP = 9900
PAUSE_SECONDS = 0.35


def pause(seconds: float) -> None:
    # time.sleep() is stretched to seconds for background processes on macOS
    # (timer coalescing); a short busy wait keeps the pace predictable.
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        pass


def get_json(url: str, retries: int = 6) -> dict:
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=45) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {"error": True, "statusCode": 404}
            last = e
        except Exception as e:  # timeouts, resets
            last = e
        pause(5 * (attempt + 1))
    return {"error": True, "message": str(last)}


# ---------------------------------------------------------------- enumerate

def cmd_enumerate(args) -> None:
    cache_path = args.output + ".cache.jsonl"
    cache: dict[str, dict] = {}
    if os.path.exists(cache_path):
        for line in open(cache_path):
            r = json.loads(line)
            cache[r["q"]] = r["d"]
    cache_file = open(cache_path, "a")

    def search(params: dict) -> dict:
        q = urllib.parse.urlencode({"org_units": args.org_unit, "limit": PAGE, **params})
        if q in cache:
            return cache[q]
        d = get_json(f"{BASE}/api/objects/search-expert?{q}")
        if d.get("error"):
            sys.exit(f"search failed: {q} {d}")
        slim = {"total": d.get("total"),
                "artworks": [{k: a.get(k) for k in ("id", "datierungVon", "datierungBis")}
                             for a in d.get("artworks", [])]}
        cache[q] = slim
        cache_file.write(json.dumps({"q": q, "d": slim}, ensure_ascii=False) + "\n")
        cache_file.flush()
        pause(PAUSE_SECONDS)
        return slim

    seen: dict[str, set] = {}
    dates: dict[str, list] = {}

    def take(d: dict, geo: str) -> None:
        for a in d.get("artworks", []):
            seen.setdefault(a["id"], set()).add(geo)
            if a.get("datierungVon") or a.get("datierungBis"):
                dates[a["id"]] = [a.get("datierungVon"), a.get("datierungBis")]

    def page(geo: str, total: int, sort: str) -> None:
        for start in range(0, min(total, CAP), PAGE):
            take(search({"geographicalReferences": geo, "start": start, "sort": sort}), geo)

    full = search({"start": 0})["total"]
    first = [chr(c) for c in range(ord("A"), ord("Z") + 1)] + list("ÄÖÜ0123456789")
    second = list("abcdefghijklmnopqrstuvwxyzäöüßABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
    queue = [p + "*" for p in first]
    while queue:
        geo = queue.pop(0)
        t = search({"geographicalReferences": geo, "start": 0, "sort": "id asc"})["total"]
        if t == 0 or t == full:  # t == full: the API ignored an invalid filter
            continue
        if t <= CAP:
            page(geo, t, "id asc")
        else:
            if t <= 2 * CAP:  # both ends of the id order may already cover it
                page(geo, t, "id asc")
                page(geo, t, "id desc")
                if sum(1 for s in seen.values() if geo in s) >= t:
                    continue
            queue.extend(geo[:-1] + c + "*" for c in second)
        print(f"{geo:>8} {t:>6}  listed {len(seen)}", flush=True)

    ids = sorted(seen)
    json.dump({"org_unit": args.org_unit, "total": full, "ids": ids, "dates": dates}, open(args.output, "w"))
    print(f"listed {len(ids)} of {full} ({full - len(ids)} have no geography the listing can reach)")


# -------------------------------------------------------------------- fetch

def load_ids(path: str) -> list[str]:
    d = json.load(open(path))
    if isinstance(d, dict):
        d = d.get("ids") or [o["id"] for o in d.get("objects", [])]
    return [i if str(i).startswith("obj-") else f"obj-{i}" for i in d]


def slim_detail(d: dict) -> dict:
    d = dict(d)
    d.pop("additionalItems", None)
    images = d.pop("images", None) or []
    if images:
        im = images[0]
        d["image"] = {k: im.get(k) for k in ("xl_path", "l_path", "license", "photographer")}
    d["image_count"] = len(images)
    return d


def cmd_fetch(args) -> None:
    ids = load_ids(args.ids)
    if args.exclude:
        known = {f"obj-{i}" if not str(i).startswith("obj-") else i for i in json.load(open(args.exclude))}
        ids = [i for i in ids if i not in known]
    done: set[str] = set()
    if os.path.exists(args.cache):
        for line in open(args.cache):
            r = json.loads(line)
            # transient errors are fetched again; a 404 is final
            if not r["detail"].get("error") or r["detail"].get("statusCode") == 404:
                done.add(r["id"])
    todo = [i for i in ids if i not in done]
    if args.limit:
        todo = todo[: args.limit]
    print(f"{len(ids)} ids, {len(done)} cached, fetching {len(todo)}", flush=True)
    with open(args.cache, "a") as f:
        for n, oid in enumerate(todo, 1):
            d = get_json(f"{BASE}/api/objects/detail/{oid}")
            f.write(json.dumps({"id": oid, "fetched": time.strftime("%Y-%m-%d"),
                                "detail": slim_detail(d)}, ensure_ascii=False) + "\n")
            if n % 500 == 0:
                f.flush()
                print(f"{n}/{len(todo)}", flush=True)
            pause(PAUSE_SECONDS)
    print("done")


# ---------------------------------------------------------------------- map

# Qualifiers ("Fundort: X") that make a place an origin, with the label the
# panel shows (frontend/lib/origin-attribution.ts) and whether it is a findspot.
LABELLED_ORIGIN = {
    "Fundort": ("Found", True),
    "Herstellungsort": ("Created", False),
    "Herkunft (Allgemein)": ("Origin (general)", False),
}
# Qualifiers naming the present-day country of the record's place.
PRESENT_DAY = {"heutige Bezeichnung", "heutige Zuordnung", "heutige Zugehörigkeit"}
# Everything else ("Aufnahmeort", "Erwerbungsort", "Absendeort", "Bezug",
# "historische Angabe (…)", "historische Bezeichnung", "Drehort", …) is never an origin.
SETTLEMENT_ROLES = {"Ort", "Stadt", "Dorf", "Siedlung", "Station", "Stadt (oder Gemeinde)", "Weiler",
                    "Ortschaft", "Gemeinde", "Missionsstation", "Handelsposten (Handelsstation)",
                    "Ruinenstätte", "Fundstelle"}
ISLAND_ROLES = {"Insel", "Atoll"}
COUNTRY_ROLES = {"Land", "Land/Region", "Republik", None}
HOLD_ROLES = {"Deutsches Kriegsgefangenenlager"}
MATERIAL_DEPARTMENTS = {"I", "II", "III", "IV", "V", "VI"}
UNLABELLED_EVENT = "Attributed place"
NOTE_TAG = "[smb-search]"
INSTITUTION = {"institution_name": "Ethnologisches Museum", "institution_place": "Berlin",
               "institution_latitude": 52.5174, "institution_longitude": 13.4007}


def stable_object_id(uri: str) -> int:
    """object_id is a bigint that also passes through JS numbers (exact to 2**53), and SMB's
    own numbers collide with the museum-digital ids already used for this institution, so
    derive a stable 53-bit id from the persistent URI (as scrape_europeana.py does)."""
    return int.from_bytes(hashlib.sha256(uri.encode()).digest()[:8], "big") >> 11


def split_line(name_line: str) -> tuple[str, str]:
    """'Fundort: Navajo Ruins' -> ('Fundort', 'Navajo Ruins'); 'Kamerun' -> ('', 'Kamerun')."""
    head, sep, rest = (name_line or "").partition(":")
    if sep and 2 <= len(head) <= 60 and rest.strip():
        return head.strip(), rest.strip()
    return "", (name_line or "").strip()


def name_variants(label: str) -> list[str]:
    """'Sulawesi (Celebes)' -> ['Sulawesi (Celebes)', 'Sulawesi', 'Celebes']; drops a trailing '(?)'."""
    label = label.replace("(?)", "").strip()
    out = [label]
    if "(" in label and label.endswith(")"):
        outer, inner = label[:-1].split("(", 1)
        out += [outer.strip(), inner.strip()]
    return [v for v in dict.fromkeys(out) if v]


class Places:
    """Coordinates only from sources that name the same place: Ex Situ's own
    museum-digital points for the identical SMB label, a single exact GeoNames
    match in the record's country, or the reviewed lookup file. No fuzzy matching."""

    def __init__(self, exsitu_rows: list[dict], gazetteer_dir: str, lookup_path: str | None):
        self.lookup = json.load(open(lookup_path)) if lookup_path and os.path.exists(lookup_path) else {}
        self.points: dict[str, set] = {}
        country_votes: dict[str, dict] = {}
        for r in exsitu_rows:
            name, lat, lon = (r.get("place_name") or "").strip(), r.get("latitude"), r.get("longitude")
            if not name or lat in (None, "N/A") or lon in (None, "N/A"):
                continue
            key = (round(float(lat), 3), round(float(lon), 3), r.get("country_en"))
            self.points.setdefault(name, set()).add(key)
            votes = country_votes.setdefault(name, {})
            votes[key] = votes.get(key, 0) + 1
        # German country label -> (country_en, lat, lon): the point Ex Situ already uses for
        # rows whose place_name is that country (any of its labels in GERMAN_COUNTRY_NAMES, or
        # its English name), when >= 3 such rows exist and >= 60 % share one point.
        self.countries: dict[str, tuple] = {}
        for cen, names in GERMAN_COUNTRY_NAMES.items():
            votes: dict[tuple, int] = {}
            for name in (*names, cen):
                for key, n in country_votes.get(name, {}).items():
                    if key[2] == cen:
                        votes[key] = votes.get(key, 0) + n
            if not votes:
                continue
            (lat, lon, _), n = max(votes.items(), key=lambda kv: kv[1])
            if n >= 3 and n / sum(votes.values()) >= 0.6:
                for name in names:
                    self.countries[name] = (cen, lat, lon)
        for key, v in self.lookup.items():
            if v.get("kind") == "country":
                self.countries[key] = (v["country_en"], v["lat"], v["lon"])
        self.iso = {}
        for line in open(os.path.join(gazetteer_dir, "countryInfo.txt"), encoding="utf-8"):
            if line.startswith("#"):
                continue
            f = line.rstrip("\n").split("\t")
            if len(f) > 4:
                self.iso[f[4]] = f[0]
        self.iso.update({"United States": "US", "Côte d'Ivoire": "CI", "Palestine": "PS", "Czechia": "CZ",
                         "Timor-Leste": "TL", "The Bahamas": "BS", "The Gambia": "GM", "Cabo Verde": "CV",
                         "Federated States of Micronesia": "FM", "Micronesia": "FM", "Republic of the Congo": "CG",
                         "Democratic Republic of the Congo": "CD", "South Korea": "KR", "North Korea": "KP"})
        self.gaz: dict[tuple, set] = {}
        for line in open(os.path.join(gazetteer_dir, "cities500.txt"), encoding="utf-8"):
            f = line.rstrip("\n").split("\t")
            gid, name, ascii_, alts, lat, lon, cc = f[0], f[1], f[2], f[3], f[4], f[5], f[8]
            for n in {name, ascii_, *[a for a in alts.split(",") if a]}:
                self.gaz.setdefault((cc, n.lower()), set()).add((gid, float(lat), float(lon)))

    def country(self, label: str):
        for v in name_variants(label):
            if v in self.countries:
                return self.countries[v]
        return None

    def resolve(self, label: str, country_label: str | None, country_en: str | None):
        """-> (lat, lon, country_en, source) or None."""
        for key in (f"{label}|{country_label or ''}", f"{label}|"):
            v = self.lookup.get(key)
            if v and v.get("kind") != "country":
                if v.get("skip"):
                    return None
                return v["lat"], v["lon"], v.get("country_en") or country_en, f"desk review: {v.get('source', 'lookup')}"
        for v in name_variants(label):
            pts = {p for p in self.points.get(v, set()) if country_en is None or p[2] == country_en}
            if len(pts) == 1:
                lat, lon, cen = next(iter(pts))
                return lat, lon, cen, "Ex Situ point for the same SMB place name (museum-digital)"
        cc = self.iso.get(country_en or "")
        if cc:
            hits = set()
            for v in name_variants(label):
                hits |= self.gaz.get((cc, v.lower()), set())
            if len(hits) == 1:
                gid, lat, lon = next(iter(hits))
                return round(lat, 5), round(lon, 5), country_en, f"GeoNames {gid} (single exact match in {cc})"
        return None


# German country labels used by SMB -> the country_en Ex Situ uses. Only these
# (and lookup entries of kind "country") are accepted as country-level origins.
GERMAN_COUNTRY_NAMES: dict[str, tuple] = {}


def load_country_names(path: str) -> None:
    if path and os.path.exists(path):
        for country_en, names in json.load(open(path)).items():
            if not country_en.startswith("_"):
                GERMAN_COUNTRY_NAMES[country_en] = tuple(names)


def choose_origin(d: dict) -> dict:
    """Apply the ORIGIN RULE to one detail record. Returns a dict with 'kind'."""
    ident = (d.get("ident") or "").split()
    dept = ident[0] if ident else ""
    parsed = [(*split_line(g.get("nameLine")), g.get("role")) for g in d.get("geography") or []]
    if any(role in HOLD_ROLES for _, _, role in parsed):
        return {"kind": "held", "why": "German POW camp"}
    labelled = [(p, v, r) for p, v, r in parsed if p in LABELLED_ORIGIN]
    countries = list(dict.fromkeys(v for p, v, r in parsed
                                   if (p == "" or p in PRESENT_DAY) and r in COUNTRY_ROLES))
    out = {"dept": dept, "countries": countries}
    if labelled:
        order = list(LABELLED_ORIGIN)
        p, v, r = sorted(labelled, key=lambda x: order.index(x[0]))[0]
        event, findspot = LABELLED_ORIGIN[p]
        return {**out, "kind": "labelled", "qualifier": p, "place": v, "role": r,
                "event": event, "findspot": findspot}
    if dept not in MATERIAL_DEPARTMENTS:
        return {**out, "kind": "none", "why": f"department {dept or '?'}: labelled places only"}
    unl = [(v, r) for p, v, r in parsed if p == ""]
    settlements = list(dict.fromkeys(v for v, r in unl if r in SETTLEMENT_ROLES))
    islands = list(dict.fromkeys(v for v, r in unl if r in ISLAND_ROLES))
    if len(settlements) == 1:
        return {**out, "kind": "unlabelled", "place": settlements[0], "role": "settlement"}
    if not settlements and len(islands) == 1:
        return {**out, "kind": "unlabelled", "place": islands[0], "role": "island"}
    why = "several settlements" if len(settlements) > 1 else ("several islands" if len(islands) > 1 else "")
    return {**out, "kind": "country_only", "why": why}


def date_fields(d: dict, years: list | None) -> dict:
    lines = [x.get("nameLine") for x in d.get("dating") or []
             if x.get("nameLine") and not x["nameLine"].startswith("Einstelldatum")]
    time_name = "; ".join(lines) or None
    start, end = (years or [None, None])[:2]
    start = start if start not in (0, None) else None
    end = end if end not in (0, None) else None
    if not time_name and start is None:
        return {"object_date": None, "time": None}
    return {"object_date": time_name, "time": {"time_name": time_name, "time_start": start, "time_end": end}}


def cmd_map(args) -> None:
    import collections
    import csv
    load_country_names(args.country_names)
    exsitu = json.load(open(args.exsitu))
    known_inv = {" ".join((r.get("inventory_number") or "").split()) for r in exsitu}
    places = Places(exsitu, args.gazetteer, args.lookup)
    years = {}
    if args.ids:
        d = json.load(open(args.ids))
        if isinstance(d, dict) and "dates" in d:
            years = d["dates"]
        elif isinstance(d, dict):
            years = {o["id"]: [o.get("von"), o.get("bis")] for o in d.get("objects", [])}

    stats = collections.Counter()
    unresolved = collections.Counter()
    held = []
    out = []
    today = time.strftime("%Y-%m-%d")
    rows = {}
    for line in open(args.cache):
        r = json.loads(line)
        rows[r["id"]] = r  # last line wins (re-fetched errors)
    for oid, r in rows.items():
        d = r["detail"]
        if d.get("error"):
            stats["fetch error / 404"] += 1
            continue
        if d.get("org_unit") != INSTITUTION["institution_name"]:
            stats["other org_unit"] += 1
            continue
        inv = " ".join((d.get("ident") or "").split())
        if inv and inv in known_inv:
            stats["inventory number already in Ex Situ"] += 1
            continue
        o = choose_origin(d)
        if o["kind"] == "held":
            stats["held: " + o["why"]] += 1
            held.append((oid, inv, o["why"]))
            continue
        country = None
        country_label = None
        cands = [c for c in o.get("countries", []) if places.country(c)]
        if len({places.country(c)[0] for c in cands}) == 1:
            country_label = cands[0]
            country = places.country(country_label)
        loc = None
        place_name = None
        notes = []
        if o["kind"] in ("labelled", "unlabelled"):
            as_country = places.country(o["place"])
            if as_country:  # "Herkunft (Allgemein): Kamerun"
                country_label, country = o["place"], as_country
            else:
                loc = places.resolve(o["place"], country_label, country[0] if country else None)
                if loc:
                    place_name = o["place"]
                else:
                    unresolved[(o["place"], o.get("role"), country_label or "")] += 1
                    notes.append(f"specific place not resolved: {o['place']}")
        # The unlabelled country is a fallback only in departments I-VI; elsewhere it may be
        # where a recording or photograph was made (see ORIGIN RULE).
        if not loc and country and (o["kind"] != "none") and \
                (o.get("dept") in MATERIAL_DEPARTMENTS or country_label == o.get("place")):
            loc = (country[1], country[2], country[0], "Ex Situ country point")
            place_name = country_label
        if not loc:
            stats[f"no origin ({o['kind']}{': ' + o['why'] if o.get('why') else ''})"] += 1
            continue
        lat, lon, country_en, source = loc
        if country_en in ("Germany", "Deutschland"):
            stats["held: place in Germany"] += 1
            held.append((oid, inv, f"place in Germany: {place_name}"))
            continue
        if o["kind"] == "labelled":
            event, findspot = o["event"], o["findspot"]
            how = f'"{o["qualifier"]}: {o["place"]}"'
        else:
            event, findspot = UNLABELLED_EVENT, False
            how = f"unlabelled place, department {o['dept']}" if o["kind"] == "unlabelled" else \
                  f"country only, department {o['dept']}"
        level = "country" if place_name == country_label else "place"
        stats[f"located: {o['kind']} -> {level}"] += 1
        image = d.get("image") or {}
        source_link = d.get("permalink") or f"https://id.smb.museum/object/{oid.removeprefix('obj-')}"
        rec = {
            "object_id": stable_object_id(source_link),
            "title": d.get("term"),
            "img_url": f"{BASE}/media{image['xl_path']}" if image.get("xl_path") else None,
            "image_rights": image.get("license"),
            "source_link": source_link,
            **INSTITUTION,
            "inventory_number": d.get("ident"),
            "place_name": place_name,
            "latitude": lat,
            "longitude": lon,
            "country_en": country_en,
            "origin_event_type_en": event,
            "origin_is_findspot": findspot,
            **date_fields(d, years.get(oid)),
            "object_links": [],
            "geocoder_source": "smb-search",
            "geocoding_notes": f"{NOTE_TAG} {today} origin from search.smb.museum {oid} ({how}); "
                               f"coordinates: {source}; desk review, not verified"
                               + ("; " + "; ".join(notes) if notes else ""),
            "review_status": None,
        }
        out.append(rec)

    print(f"{len(rows)} cached records")
    for k, v in sorted(stats.items(), key=lambda kv: -kv[1]):
        print(f"  {v:>7}  {k}")
    print(f"  {len(out):>7}  written")
    base = os.path.splitext(args.output)[0]
    with open(base + "_unresolved.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["label", "role", "country_label", "objects"])
        for (label, role, cl), n in unresolved.most_common():
            w.writerow([label, role, cl, n])
    with open(base + "_held.csv", "w", newline="") as f:
        csv.writer(f).writerows([("object_id", "inventory_number", "why"), *held])
    print(f"unresolved specific places: {len(unresolved)} labels -> {base}_unresolved.csv")
    if args.dry_run:
        for rec in out[: args.show]:
            print(json.dumps({k: rec[k] for k in ("source_link", "inventory_number", "place_name", "latitude",
                                                  "longitude", "country_en", "origin_event_type_en",
                                                  "object_date", "geocoding_notes")}, ensure_ascii=False))
        return
    json.dump(out, open(args.output, "w"), ensure_ascii=False, indent=1)
    print(f"wrote {args.output}")


# ---------------------------------------------------------------------- main

def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("enumerate", help="list object ids of one collection")
    e.add_argument("--org-unit", default="Ethnologisches Museum")
    e.add_argument("--output", default="smb_search_ids.json")
    f = sub.add_parser("fetch", help="cache detail records (resumable)")
    f.add_argument("--ids", required=True)
    f.add_argument("--exclude", help="JSON list of SMB ids already in Ex Situ")
    f.add_argument("--cache", default="smb_search_details.jsonl")
    f.add_argument("--limit", type=int)
    m = sub.add_parser("map", help="cache -> museum_objects JSON (located objects only)")
    m.add_argument("--cache", default="smb_search_details.jsonl")
    m.add_argument("--ids", help="enumerate output (listing year ranges)")
    m.add_argument("--exsitu", required=True,
                   help="JSON list of the institution's Ex Situ rows (place_name, latitude, longitude, "
                        "country_en, inventory_number), e.g. from /museum-objects/by-country")
    m.add_argument("--gazetteer", default=os.path.join(os.path.dirname(__file__), "data", "gazetteer"))
    m.add_argument("--lookup", default=os.path.join(os.path.dirname(__file__), "smb_search_places.json"),
                   help="reviewed place lookup ('label|country label' -> lat/lon), desk review")
    m.add_argument("--country-names", default=os.path.join(os.path.dirname(__file__), "smb_search_countries.json"))
    m.add_argument("--output", default="smb_search_objects.json")
    m.add_argument("--dry-run", action="store_true")
    m.add_argument("--show", type=int, default=15)
    args = p.parse_args()
    {"enumerate": cmd_enumerate, "fetch": cmd_fetch, "map": cmd_map}[args.cmd](args)


if __name__ == "__main__":
    main()
