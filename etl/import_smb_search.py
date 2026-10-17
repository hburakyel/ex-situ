"""
import_smb_search.py — insert the records written by `scrape_smb_search.py map`
into museum_objects, in ONE transaction. Dry run (rolled back) unless --apply.

Insert-only: rows whose object_id (a hash of the id.smb.museum URI) or source_link
already exists for the institution are skipped, and no existing row is changed, so it is safe to re-run.
Institution columns are copied from the institution's existing rows. Afterwards run
the place pipeline (CLAUDE.md) and then `--finalize` to fill search_vector for the
new rows from their normalized labels, then SELECT refresh_geospatial_views();.

DB credentials from DATABASE_* env vars (backend/.env on the server).

Usage:
  python import_smb_search.py smb_search_objects.json              # dry run
  python import_smb_search.py smb_search_objects.json --apply
  python import_smb_search.py --finalize --apply                   # after the place pipeline
"""
import argparse
import json
import os
import re
import sys
import time

import psycopg2
import psycopg2.extras

NOTE_TAG = "[smb-search]"
INSTITUTION = "Ethnologisches Museum"
INSTITUTION_COLS = ["institution_place", "institution_country", "institution_city_en",
                    "institution_country_en", "institution_latitude", "institution_longitude"]


def cut(v, n=255):
    return v if v is None or len(v) <= n else v[: n - 1] + "…"


def precision(start, end, text):
    if start is None:
        return "unknown"
    if re.search(r"\b(ca\.|um|circa)\b", text or "", re.I):
        return "circa"
    return "exact" if start == end else "range"


def connect():
    return psycopg2.connect(host=os.environ.get("DATABASE_HOST", "127.0.0.1"),
                            port=int(os.environ.get("DATABASE_PORT", 5432)),
                            dbname=os.environ["DATABASE_NAME"], user=os.environ["DATABASE_USERNAME"],
                            password=os.environ["DATABASE_PASSWORD"])


def columns(cur):
    cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'museum_objects'")
    return {r[0] for r in cur.fetchall()}


def do_import(cur, path):
    records = json.load(open(path, encoding="utf-8"))
    cols_present = columns(cur)
    cur.execute(f"""SELECT {', '.join(INSTITUTION_COLS)}, count(*) FROM museum_objects
                    WHERE institution_name = %s GROUP BY {', '.join(INSTITUTION_COLS)}
                    ORDER BY count(*) DESC LIMIT 1""", (INSTITUTION,))
    inst = dict(zip(INSTITUTION_COLS, cur.fetchone()[:-1]))
    print("institution columns from existing rows:", inst)
    cur.execute("SELECT object_id, source_link FROM museum_objects WHERE institution_name = %s", (INSTITUTION,))
    existing_rows = cur.fetchall()
    existing = {r[0] for r in existing_rows} | {r[1] for r in existing_rows}

    rows, times = [], []
    for r in records:
        if r["object_id"] in existing or r["source_link"] in existing:
            continue
        t = r.get("time") or None
        start = int(t["time_start"]) if t and t.get("time_start") is not None else None
        end = int(t["time_end"]) if t and t.get("time_end") is not None else None
        row = dict(
            object_id=r["object_id"], title=cut(r.get("title")), img_url=r.get("img_url"),
            latitude=r["latitude"], longitude=r["longitude"], source_link=r["source_link"],
            institution_name=INSTITUTION, place_name=r["place_name"],
            inventory_number=cut(r.get("inventory_number")), country_en=cut(r.get("country_en")),
            geocoded_country=cut(r.get("country_en")), geocoding_status="ok",
            geocoding_notes=r["geocoding_notes"], geocoder_source=r["geocoder_source"],
            review_status=r.get("review_status"), image_rights=cut(r.get("image_rights")),
            origin_event_type_en=r.get("origin_event_type_en"), origin_is_findspot=r.get("origin_is_findspot"),
            object_date=cut(r.get("object_date")), object_date_display=r.get("object_date"),
            object_date_earliest=start, object_date_latest=end,
            object_date_precision=precision(start, end, r.get("object_date")),
            **inst)
        rows.append(row)
        times.append((cut(t["time_name"]), str(start) if start is not None else None,
                      str(end) if end is not None else None) if t else None)
    print(f"{len(records)} records, {len(records) - len(rows)} already present, inserting {len(rows)}")
    if not rows:
        return
    cols = [c for c in rows[0] if c in cols_present]
    missing = [c for c in rows[0] if c not in cols_present]
    if missing:
        sys.exit(f"columns missing in museum_objects: {missing}")
    ids = psycopg2.extras.execute_values(cur, f"""
        INSERT INTO museum_objects ({', '.join(cols)}, created_at, updated_at, published_at)
        VALUES %s RETURNING id""",
        [tuple(r[c] for c in cols) for r in rows],
        template="(" + ", ".join(["%s"] * len(cols)) + ", now(), now(), now())", page_size=2000, fetch=True)
    ids = [i[0] for i in ids]
    print("rows inserted:", len(ids))
    t_rows = [(ids[i],) + times[i] for i in range(len(ids)) if times[i]]
    if t_rows:
        t_ids = psycopg2.extras.execute_values(
            cur, "INSERT INTO components_time_name_time_infos (time_name, time_start, time_end) VALUES %s RETURNING id",
            [x[1:] for x in t_rows], page_size=5000, fetch=True)
        psycopg2.extras.execute_values(
            cur, 'INSERT INTO museum_objects_components (entity_id, component_id, component_type, field, "order") VALUES %s',
            [(t_rows[i][0], t_ids[i][0], "time-name.time-info", "time", 1) for i in range(len(t_rows))], page_size=5000)
    print("time components:", len(t_rows))
    extra = []
    if "inventory_number_normalized" in cols_present:  # migration 011's expression
        extra.append("""inventory_number_normalized = LOWER(TRIM(REGEXP_REPLACE(TRIM(inventory_number),
                        '([a-z](\\s*,\\s*[a-z])*\\s*)$', '', 'i')))""")
    if "geom" in cols_present:
        extra.append("geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography")
    if extra:
        cur.execute(f"UPDATE museum_objects SET {', '.join(extra)} WHERE id = ANY(%s)", (ids,))
        print("filled:", ", ".join(e.split(" =")[0] for e in extra))
    cur.execute("""SELECT country_en, count(*) FROM museum_objects WHERE id = ANY(%s)
                   GROUP BY 1 ORDER BY 2 DESC LIMIT 15""", (ids,))
    print("top countries:", cur.fetchall())


def do_finalize(cur):
    if "search_vector" not in columns(cur):
        print("no search_vector column")
        return
    cur.execute(f"""
        UPDATE museum_objects SET search_vector =
          setweight(to_tsvector('simple', coalesce(place_name, '')), 'A') ||
          setweight(to_tsvector('simple', coalesce(place_name_normalized, '')), 'B') ||
          setweight(to_tsvector('simple', coalesce(country_en, '')), 'B') ||
          setweight(to_tsvector('simple', coalesce(city_en, '')), 'C') ||
          setweight(to_tsvector('simple', coalesce(institution_name, '')), 'C')
        WHERE institution_name = %s AND geocoding_notes LIKE %s""", (INSTITUTION, NOTE_TAG + "%"))
    print("search_vector filled:", cur.rowcount)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("file", nargs="?")
    p.add_argument("--finalize", action="store_true")
    p.add_argument("--apply", action="store_true")
    args = p.parse_args()
    conn = connect()
    t0 = time.time()
    try:
        with conn.cursor() as cur:
            if args.finalize:
                do_finalize(cur)
            else:
                do_import(cur, args.file)
        if args.apply:
            conn.commit()
            print(f"COMMITTED in {time.time() - t0:.0f}s")
        else:
            conn.rollback()
            print(f"dry run, rolled back ({time.time() - t0:.0f}s)")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
