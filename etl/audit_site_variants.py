#!/usr/bin/env python3
"""
audit_site_variants.py — Find one place written several ways. Read-only.

The map groups origins by label (PLACE_GROUP_EXPR / SITE_KEY in
backend/src/api/museum-object/services/place-group.js), which folds case,
accents, a trailing "?" and type suffixes like "(city)", but nothing else. So
"Faiyum", "Fayûm", "Fayyum" and "Egypt, Fayum" were four sites in Egypt until
2026-10-21. This lists candidate groups of sites in one country that are
probably the same place, for review by hand:

  name     the names match after transliteration-ish folding (ai/ay/ayy,
           ou/u, ei/i, kh/ch/q/k, doubled letters, al-/el-/the prefixes,
           hyphens, "Governorate"/"Province" wrappers, "Egypt, Fayum" forms)
           and the points are within NAME_KM of each other
  loose    as name, but a trailing "(…)" qualifier or a Tell/Tall/Tepe/Höyük
           word is also dropped ("Hawara (Fayum)", "Tell el-Amarna")
  near     the points are within NEAR_KM and the folded names are similar
           (SequenceMatcher ratio ≥ SIMILAR)

The SQL for a site is read from place-group.js (node), so this never drifts
from the map. Points are COALESCE(manual_latitude, latitude), as the map draws
them. A member on its country's centre point (the point of the rows labelled
with the country's own name) is flagged "centre".

Usage (from etl/):
    python3 audit_site_variants.py              # table on stdout + reports/site_variants.csv
    python3 audit_site_variants.py --country Egypt
"""

import argparse
import csv
import difflib
import math
import os
import re
import subprocess
import unicodedata
from collections import defaultdict

from audit_places import get_conn

HERE = os.path.dirname(os.path.abspath(__file__))
PLACE_GROUP_JS = os.path.join(HERE, "..", "backend", "src", "api", "museum-object", "services", "place-group.js")
REPORTS = os.path.join(HERE, "reports")
NAME_KM = 150
NEAR_KM = 15
SIMILAR = 0.8

# Words that wrap a place name without naming another place.
WRAPPERS = r"(governorate|gouvernement|province|provinz|provincia|prov|region|district|county|state|oasis|wilaya|muhafazat|vilayet|il|ili)"
ARTICLE = r"(al|el|ul|as|ash|at|az|ad|an|ar|the|le|la|les|de|der|die|das)"
SITE_WORDS = r"(tell|tel|tall|tepe|tepesi|hoyuk|huyuk|kom|kum|jebel|gebel|djebel|dschebel)"


def place_group_sql():
    """PLACE_GROUP_EXPR and PLACE_GROUP_KEY as place-group.js builds them."""
    js = ("const p = require(process.argv[1]);"
          "process.stdout.write(JSON.stringify([p.PLACE_GROUP_EXPR, p.SITE_KEY(p.PLACE_GROUP_EXPR)]))")
    import json
    out = subprocess.run(["node", "-e", js, PLACE_GROUP_JS], check=True, capture_output=True, text=True).stdout
    return json.loads(out)


def fold(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return s.replace("ʿ", "").replace("ʾ", "").replace("'", "").replace("’", "").replace("‘", "").replace("`", "")


def translit(s):
    """Spelling-insensitive skeleton of a folded name (no spaces)."""
    s = re.sub(r"[^a-z]", "", s)
    for a, b in (("dsch", "j"), ("tsch", "ch"), ("sch", "sh"), ("dj", "j"), ("kh", "k"), ("ch", "k"),
                 ("gh", "g"), ("ph", "f"), ("th", "t"), ("dh", "d"), ("q", "k"), ("c", "k"),
                 ("ou", "u"), ("oo", "u"), ("w", "u"), ("ee", "i"), ("ei", "i"), ("ie", "i"),
                 ("y", "i")):
        s = s.replace(a, b)
    s = re.sub(r"(.)\1+", r"\1", s)  # doubled letters, incl. ii from ayy
    return s


def name_key(label, country, loose=False):
    s = fold(label)
    c = fold(country)
    s = re.sub(r"\s*\(?\?+\)?\s*$", "", s)
    # Met-style "Egypt, Fayum" / "Herat, present-day Afghanistan" / "probably Golconda, India, Deccan":
    # the country and the source's hedge are not part of the place name (the hedge stays as "?").
    parts = [x.strip() for x in s.split(",")]
    parts = [re.sub(r"^(probably|possibly|reportedly|perhaps)\s+", "", x) for x in parts]
    parts = [x for x in parts if x and x != c and not re.fullmatch(rf"(present|modern)[- ]day {re.escape(c)}", x)] or [c]
    if loose and parts:
        parts = parts[:1]
    s = ", ".join(parts)
    if loose:
        s = re.sub(r"\s*\([^)]*\)\s*$", "", s)
    s = re.sub(r"\s*\((city|province|provinz|stad|state|district|region|prov\.)\)\s*$", "", s)
    # "al-Fayyum Governorate", "Gouvernement al-Fayyum", "Province of X"
    s = re.sub(rf"\b{WRAPPERS}\b(\s+of)?", " ", s)
    words = [w for w in re.split(r"[\s\-_.,/]+", s) if w]
    if loose:
        words = [w for w in words if not re.fullmatch(SITE_WORDS, w)]
    words = [w for w in words if not re.fullmatch(ARTICLE, w)]
    # "al-" glued to the next word after the hyphen split: "alfayyum" stays, but "el" alone is gone
    return translit("".join(words))


def km(a, b):
    (la1, lo1), (la2, lo2) = a, b
    p1, p2 = math.radians(la1), math.radians(la2)
    dp, dl = p2 - p1, math.radians(lo2 - lo1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(min(1, h)))


def load_sites(cur, country=None):
    expr, key = place_group_sql()
    where = "AND country_en = %(c)s" if country else ""
    sql = f"""
        SELECT {key} AS site_key, country_en,
               mode() WITHIN GROUP (ORDER BY {expr}) AS label,
               array_agg(DISTINCT {expr}) AS spellings,
               COUNT(*) AS n,
               avg(COALESCE(manual_latitude, latitude)) AS lat,
               avg(COALESCE(manual_longitude, longitude)) AS lon,
               mode() WITHIN GROUP (ORDER BY COALESCE(manual_latitude, latitude)) AS mlat,
               mode() WITHIN GROUP (ORDER BY COALESCE(manual_longitude, longitude)) AS mlon,
               COUNT(DISTINCT (round(COALESCE(manual_latitude, latitude)::numeric, 3),
                               round(COALESCE(manual_longitude, longitude)::numeric, 3))) AS points,
               array_agg(DISTINCT institution_name) AS institutions,
               COUNT(*) FILTER (WHERE review_status = 'verified') AS verified,
               array_agg(DISTINCT BTRIM(historical_name)) FILTER (WHERE NULLIF(BTRIM(historical_name), '') IS NOT NULL) AS hist
        FROM museum_objects
        WHERE published_at IS NOT NULL
          AND COALESCE(manual_latitude, latitude) IS NOT NULL
          AND COALESCE(manual_longitude, longitude) IS NOT NULL
          AND NULLIF(country_en::text, '') IS NOT NULL {where}
        GROUP BY 1, 2
    """
    cur.execute(sql, {"c": country} if country else None)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def find_groups(sites):
    by_country = defaultdict(list)
    for s in sites:
        s["key"] = name_key(s["label"], s["country_en"])
        s["loose"] = name_key(s["label"], s["country_en"], loose=True)
        s["pt"] = (float(s["lat"]), float(s["lon"]))
        s["mode_pt"] = (float(s["mlat"]), float(s["mlon"]))
        by_country[s["country_en"]].append(s)

    parent = {}

    def root(i):
        while parent.setdefault(i, i) != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    links = defaultdict(set)  # (i, j) → reasons
    for country, ss in by_country.items():
        country_key = name_key(country, "")
        centre = next((s["mode_pt"] for s in ss if s["key"] == country_key), None)
        for s in ss:
            s["centre"] = centre is not None and s["key"] != country_key and km(s["pt"], centre) < 1
        for field, reason in (("key", "name"), ("loose", "loose")):
            buckets = defaultdict(list)
            for s in ss:
                if len(s[field]) >= 3 and s[field] != country_key:
                    buckets[s[field]].append(s)
            for b in buckets.values():
                for i in range(len(b)):
                    for j in range(i + 1, len(b)):
                        a, c = b[i], b[j]
                        if km(a["pt"], c["pt"]) <= NAME_KM or a["centre"] or c["centre"]:
                            links[tuple(sorted((id(a), id(c))))].add(reason)
                            parent[root(id(a))] = root(id(c))
        # near + similar: grid of ~0.2° cells
        grid = defaultdict(list)
        for s in ss:
            grid[(int(s["pt"][0] // 0.2), int(s["pt"][1] // 0.2))].append(s)
        for (gx, gy), cell in grid.items():
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for a in cell:
                        for c in grid.get((gx + dx, gy + dy), ()):
                            if id(a) >= id(c) or len(a["key"]) < 4 or len(c["key"]) < 4:
                                continue
                            if km(a["pt"], c["pt"]) > NEAR_KM:
                                continue
                            if difflib.SequenceMatcher(None, a["key"], c["key"]).ratio() >= SIMILAR:
                                links[tuple(sorted((id(a), id(c))))].add("near")
                                parent[root(id(a))] = root(id(c))

    byid = {id(s): s for s in sites}
    groups = defaultdict(list)
    for i in parent:
        groups[root(i)].append(byid[i])
    out = []
    for members in groups.values():
        if len(members) < 2:
            continue
        members.sort(key=lambda s: -s["n"])
        ids = {id(m) for m in members}
        reasons = set()
        for (a, c), r in links.items():
            if a in ids:
                reasons |= r
        out.append((members, reasons))
    out.sort(key=lambda g: (g[0][0]["country_en"], -sum(m["n"] for m in g[0])))
    return out


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--country")
    args = p.parse_args()
    conn = get_conn()
    conn.set_session(readonly=True, autocommit=True)
    try:
        with conn.cursor() as cur:
            sites = load_sites(cur, args.country)
    finally:
        conn.close()
    groups = find_groups(sites)
    os.makedirs(REPORTS, exist_ok=True)
    path = os.path.join(REPORTS, "site_variants.csv")
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["group", "country", "reasons", "label", "objects", "km_from_first", "lat", "lon", "points",
                    "centre", "verified", "spellings", "historical", "institutions"])
        for g, (members, reasons) in enumerate(groups, 1):
            first = members[0]
            print(f"\n#{g} {first['country_en']}  [{', '.join(sorted(reasons))}]")
            for m in members:
                d = km(first["pt"], m["pt"])
                flags = (" CENTRE" if m["centre"] else "") + (f" verified={m['verified']}" if m["verified"] else "")
                print(f"   {m['label']:<42} {m['n']:>6}  {d:>7.1f} km  ({m['pt'][0]:.3f}, {m['pt'][1]:.3f}) "
                      f"pts={m['points']}{flags}  {'; '.join(sorted(m['institutions']))[:80]}")
                w.writerow([g, m["country_en"], " ".join(sorted(reasons)), m["label"], m["n"], f"{d:.1f}",
                            f"{m['pt'][0]:.5f}", f"{m['pt'][1]:.5f}", m["points"], int(m["centre"]), m["verified"],
                            " | ".join(sorted(x for x in m["spellings"] if x)), " | ".join(m["hist"] or []),
                            " | ".join(sorted(m["institutions"]))])
    print(f"\n{len(groups)} candidate groups, {sum(len(g[0]) for g in groups)} sites. CSV: {path}")


if __name__ == "__main__":
    main()
