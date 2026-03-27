from __future__ import annotations
#!/usr/bin/env python3
"""
Ingest Spanish municipios reference data into the `municipios` table.

Source: OpenStreetMap via Overpass API
  - Queries all admin_level=8 boundaries (municipios) in Spain
  - Each boundary has a ref:INE tag (5-digit INE municipio code)
  - Overpass returns the centroid of each boundary with `out center`

~8,100 municipios. Takes ~2–5 minutes to fetch and insert.

Prerequisites:
  - Run migration 005_municipios_table.sql in Supabase first

Usage:
  python ingest_municipios.py                          # all Spain
  python ingest_municipios.py --provincia 29           # Málaga province (INE code)
  python ingest_municipios.py --dry-run
  python ingest_municipios.py --verify                 # count existing rows
"""
import argparse
import sys
import time
import requests
from tqdm import tqdm
from _db import get_conn, execute_batch

# Overpass mirrors — tried in order on failure
OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
]
OVERPASS_URL = OVERPASS_MIRRORS[0]  # default; fetch_municipios rotates on empty response

# Spain bounding box (includes Canarias/Baleares/Ceuta/Melilla)
SPAIN_BBOX = "27.6,-18.2,43.8,4.4"

# Province bounding boxes for filtered runs (saves time during testing)
PROVINCE_BBOXES = {
    "29": ("36.35,-5.20,36.95,-3.90", "Málaga"),
    "28": ("40.10,-4.00,40.70,-3.40", "Madrid"),
    "08": ("41.25,1.90,41.60,2.40",   "Barcelona"),
    "41": ("36.95,-6.00,37.65,-5.50", "Sevilla"),
    "46": ("39.25,-0.60,39.70,-0.25", "Valencia"),
    "03": ("38.00,-1.00,38.75,0.30",  "Alicante"),
    "11": ("36.00,-6.00,36.75,-5.30", "Cádiz"),
    "04": ("36.80,-3.10,37.40,-1.80", "Almería"),
    "14": ("37.75,-5.40,38.10,-4.40", "Córdoba"),
    "18": ("36.70,-4.30,37.50,-2.80", "Granada"),
    "21": ("37.05,-7.50,38.05,-6.35", "Huelva"),
    "23": ("37.40,-4.10,38.65,-2.50", "Jaén"),
}


def build_overpass_query(bbox: str) -> str:
    # Note: OSM Spain data uses "ine:municipio" (not "ref:INE") as the 5-digit code tag.
    # We query all admin_level=8 boundaries and filter in parse_municipio().
    return f"""
[out:json][timeout:300];
(
  relation["boundary"="administrative"]["admin_level"="8"]({bbox});
);
out center tags;
"""


def fetch_municipios(bbox: str) -> list:
    """Try each Overpass mirror in turn. Rotates on empty/invalid responses (rate-limit)."""
    query = build_overpass_query(bbox)
    for mirror in OVERPASS_MIRRORS:
        for attempt in range(2):
            try:
                print(f"  [{mirror.split('/')[2]}] attempt {attempt + 1}...", flush=True)
                resp = requests.post(
                    mirror,
                    data={"data": query},
                    timeout=360,
                    headers={"User-Agent": "Qolify/1.0 municipios-ingest"},
                )
                if resp.status_code != 200 or not resp.text.strip():
                    print(f"  HTTP {resp.status_code}, empty body — rate-limited, trying next mirror")
                    break  # try next mirror
                elements = resp.json().get("elements", [])
                print(f"  {len(elements)} municipio boundaries returned")
                return elements
            except requests.exceptions.JSONDecodeError:
                print(f"  Non-JSON response ({resp.status_code}) — rate-limited, trying next mirror")
                break
            except requests.RequestException as e:
                if attempt == 0:
                    print(f"  Request failed ({e}), retrying in 15s...")
                    time.sleep(15)
                else:
                    print(f"  Failed ({e}), trying next mirror")
    raise RuntimeError("All Overpass mirrors failed — rate-limited. Wait 15-30 min and retry.")


def parse_municipio(el: dict) -> dict | None:
    """Extract municipio record from an Overpass element."""
    tags = el.get("tags", {})

    # OSM Spain uses "ine:municipio" = 5-digit code (e.g. "29067")
    # Fallback: "ref:ine" = 11-digit census code (e.g. "29067000000") → take first 5
    # Legacy fallback: "ref:INE" (older OSM entries)
    ine_code = (
        tags.get("ine:municipio", "").strip()
        or tags.get("ref:ine", "").strip()[:5]
        or tags.get("ref:INE", "").strip()[:5]
    )
    if not ine_code or len(ine_code) != 5 or not ine_code.isdigit():
        return None

    name = (
        tags.get("name:es")
        or tags.get("name")
        or tags.get("official_name")
    )
    if not name:
        return None

    # Centroid from Overpass `out center`
    center = el.get("center", {})
    lat = center.get("lat")
    lng = center.get("lon")
    if lat is None or lng is None:
        return None

    return {
        "municipio_code": ine_code,
        "municipio_name": name.strip(),
        "provincia":      tags.get("is_in:province") or tags.get("addr:province"),
        "comunidad":      tags.get("is_in:region") or tags.get("is_in:community"),
        "lat":            lat,
        "lng":            lng,
        "osm_id":         str(el.get("id", "")),
        "source":         "osm",
    }


UPSERT_SQL = """
INSERT INTO municipios (
    municipio_code, municipio_name, provincia, comunidad,
    lat, lng, geom, osm_id, source, updated_at
)
VALUES (
    %(municipio_code)s, %(municipio_name)s, %(provincia)s, %(comunidad)s,
    %(lat)s, %(lng)s,
    ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::GEOGRAPHY,
    %(osm_id)s, %(source)s, NOW()
)
ON CONFLICT (municipio_code) DO UPDATE SET
    municipio_name = EXCLUDED.municipio_name,
    provincia      = COALESCE(EXCLUDED.provincia, municipios.provincia),
    comunidad      = COALESCE(EXCLUDED.comunidad, municipios.comunidad),
    lat            = EXCLUDED.lat,
    lng            = EXCLUDED.lng,
    geom           = EXCLUDED.geom,
    osm_id         = EXCLUDED.osm_id,
    updated_at     = NOW()
"""


def verify(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM municipios")
        count = cur.fetchone()[0]
        cur.execute("SELECT municipio_code, municipio_name, provincia FROM municipios ORDER BY municipio_name LIMIT 5")
        samples = cur.fetchall()
    print(f"\nmunicipio_code rows: {count}")
    print("Sample rows:")
    for row in samples:
        print(f"  {row[0]}  {row[1]}  ({row[2]})")


def main():
    parser = argparse.ArgumentParser(description="Ingest municipios reference data → Qolify")
    parser.add_argument(
        "--provincia",
        help="INE province code to limit scope (e.g. 29 = Málaga). Loads all Spain if omitted."
    )
    parser.add_argument("--dry-run", action="store_true", help="Parse without writing to DB")
    parser.add_argument("--verify",  action="store_true", help="Show row count and sample rows")
    args = parser.parse_args()

    conn = get_conn()

    if args.verify:
        verify(conn)
        conn.close()
        return

    # Determine bbox
    if args.provincia and args.provincia in PROVINCE_BBOXES:
        bbox, prov_name = PROVINCE_BBOXES[args.provincia]
        print(f"Loading municipios for provincia {args.provincia} ({prov_name}): bbox {bbox}")
    elif args.provincia:
        print(f"[WARN] Province code '{args.provincia}' not in known bboxes — loading all Spain")
        bbox = SPAIN_BBOX
    else:
        bbox = SPAIN_BBOX
        print(f"Loading all Spain municipios (bbox: {bbox})")

    # Fetch from Overpass
    elements = fetch_municipios(bbox)

    # Parse
    records = []
    skipped = 0
    for el in elements:
        record = parse_municipio(el)
        if record:
            records.append(record)
        else:
            skipped += 1

    print(f"Parsed: {len(records)} valid, {skipped} skipped (missing INE code or centroid)")

    if not records:
        print("Nothing to insert.")
        conn.close()
        return

    if args.dry_run:
        print("[dry-run] First 5 records:")
        for r in records[:5]:
            print(f"  {r['municipio_code']}  {r['municipio_name']}  ({r['provincia']})  {r['lat']},{r['lng']}")
        conn.close()
        return

    execute_batch(conn, UPSERT_SQL, records)
    conn.close()
    print(f"✓ Done. {len(records)} municipios upserted.")
    print("  CHI-322 prerequisite satisfied — ingest_aemet_climate.py can now run.")


if __name__ == "__main__":
    main()
