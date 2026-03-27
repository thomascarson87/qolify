#!/usr/bin/env python3
"""
Ingest health centres and hospitals into the `health_centres` table.

Sources (in priority order):
  1. SNS RESC (Red de Establecimientos Sanitarios y Centros)
     API: https://www.sanidad.gob.es/estadEstudios/estadisticas/docs/siap/centros/
     Dataset: https://www.mscbs.gob.es/ciudadanos/prestaciones/centrosServiciosSNS/
  2. OpenStreetMap Overpass (pharmacies + clinics — supplemental)

The RESC publishes an annual Excel/CSV of all registered health facilities.
Download the latest from:
  https://www.mscbs.gob.es/estadEstudios/estadisticas/docs/siap/SIAP_RESC_*.xlsx

Usage:
  python ingest_health_centres.py                          # OSM only (quick)
  python ingest_health_centres.py --resc-path RESC.xlsx   # RESC Excel + OSM
  python ingest_health_centres.py --bbox 36.4,-5.1,36.8,-4.3  # Málaga
  python ingest_health_centres.py --source osm            # OSM only
"""
import argparse
import sys
import time
import requests
from tqdm import tqdm
from _db import get_conn, execute_batch

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# OSM tag → Qolify tipo
OSM_HEALTH_QUERIES = {
    "hospital":     '[amenity=hospital]',
    "clinic":       '[amenity=clinic]',
    "centro_salud": '[healthcare=centre]',
    "farmacia":     '[amenity=pharmacy]',
    "urgencias_24h": '[amenity=hospital][emergency=yes]',
}

PROVINCE_BBOXES = {
    "malaga":    "36.35,-5.20,36.95,-3.90",
    "madrid":    "40.10,-4.00,40.70,-3.40",
    "barcelona": "41.25,1.90,41.60,2.40",
    "sevilla":   "36.95,-6.00,37.65,-5.50",
    "valencia":  "39.25,-0.60,39.70,-0.25",
}


def build_overpass_query(bbox: str, tag_filter: str) -> str:
    return f"""
[out:json][timeout:60];
(
  node{tag_filter}({bbox});
  way{tag_filter}({bbox});
);
out center;
"""


def fetch_overpass(query: str, retries: int = 3) -> list:
    for attempt in range(retries):
        try:
            resp = requests.post(OVERPASS_URL, data={"data": query}, timeout=90)
            resp.raise_for_status()
            return resp.json().get("elements", [])
        except requests.RequestException as e:
            if attempt < retries - 1:
                time.sleep(10 * (attempt + 1))
            else:
                raise


def osm_to_records(elements: list, tipo: str) -> list:
    records = []
    for el in elements:
        tags = el.get("tags", {})
        name = tags.get("name") or tags.get("name:es") or tags.get("operator")

        if el["type"] == "node":
            lat, lng = el.get("lat"), el.get("lon")
        elif el["type"] == "way":
            center = el.get("center", {})
            lat, lng = center.get("lat"), center.get("lon")
        else:
            continue

        if lat is None or lng is None:
            continue

        is_24h = (
            tags.get("opening_hours") == "24/7"
            or tags.get("emergency") == "yes"
            or tipo == "urgencias_24h"
        )

        records.append({
            "nombre":    name,
            "tipo":      tipo,
            "is_24h":   is_24h,
            "lat":       lat,
            "lng":       lng,
            "municipio": tags.get("addr:city") or tags.get("addr:municipality"),
            "provincia": tags.get("addr:province"),
            "source":    "osm",
        })
    return records


def load_resc_excel(path: str) -> list:
    """
    Parse RESC Excel file (SIAP format).
    Column names vary by year — adjust if needed.
    """
    try:
        import openpyxl
    except ImportError:
        print("openpyxl required for RESC Excel: pip install openpyxl")
        return []

    try:
        import pandas as pd
    except ImportError:
        print("pandas required for RESC Excel: pip install pandas openpyxl")
        return []

    print(f"Loading RESC Excel: {path}")
    df = pd.read_excel(path, sheet_name=0, header=0)
    print(f"  Columns: {list(df.columns)[:10]}")

    # Column mappings (adjust for your RESC edition)
    col_map = {
        "nombre":    ["NOMBRE_CENTRO", "NombreCentro", "NOMBRE"],
        "tipo_raw":  ["TIPO_CENTRO", "TipoCentro", "TIPO"],
        "lat":       ["LATITUD", "Latitud", "LAT"],
        "lng":       ["LONGITUD", "Longitud", "LON"],
        "municipio": ["MUNICIPIO", "Municipio"],
        "provincia": ["PROVINCIA", "Provincia"],
    }

    def find_col(candidates):
        for c in candidates:
            if c in df.columns:
                return c
        return None

    mapped = {k: find_col(v) for k, v in col_map.items()}

    RESC_TIPO_MAP = {
        "Hospital":                  "hospital",
        "Centro de Salud":           "centro_salud",
        "Consultorio Local":         "centro_salud",
        "Centro de Especialidades":  "clinic",
        "Urgencias":                 "urgencias_24h",
        "Farmacia":                  "farmacia",
    }

    records = []
    for _, row in df.iterrows():
        try:
            lat = float(str(row[mapped["lat"]]).replace(",", ".")) if mapped["lat"] else None
            lng = float(str(row[mapped["lng"]]).replace(",", ".")) if mapped["lng"] else None
        except (ValueError, TypeError):
            continue

        if lat is None or lng is None or lat == 0.0 or lng == 0.0:
            continue

        tipo_raw = str(row.get(mapped["tipo_raw"], "")).strip() if mapped["tipo_raw"] else ""
        tipo = RESC_TIPO_MAP.get(tipo_raw, "clinica")

        records.append({
            "nombre":    str(row[mapped["nombre"]]).strip() if mapped["nombre"] else None,
            "tipo":      tipo,
            "is_24h":   tipo == "urgencias_24h",
            "lat":       lat,
            "lng":       lng,
            "municipio": str(row[mapped["municipio"]]).strip() if mapped["municipio"] else None,
            "provincia": str(row[mapped["provincia"]]).strip() if mapped["provincia"] else None,
            "source":    "resc",
        })

    return records


UPSERT_SQL = """
INSERT INTO health_centres (nombre, tipo, is_24h, lat, lng, geom, municipio, provincia, source, updated_at)
VALUES (
    %(nombre)s,
    %(tipo)s,
    %(is_24h)s,
    %(lat)s,
    %(lng)s,
    ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::GEOGRAPHY,
    %(municipio)s,
    %(provincia)s,
    %(source)s,
    NOW()
)
ON CONFLICT DO NOTHING
"""


def main():
    parser = argparse.ArgumentParser(description="Ingest health centres → Qolify")
    parser.add_argument("--resc-path", help="Path to RESC Excel file (optional)")
    parser.add_argument("--bbox",      help="south,west,north,east for OSM query")
    parser.add_argument("--provincia", choices=list(PROVINCE_BBOXES),
                        help="Named province bbox for OSM query")
    parser.add_argument("--source",    choices=["osm", "resc", "both"], default="both",
                        help="Which source to load (default: both)")
    args = parser.parse_args()

    bbox = None
    if args.provincia:
        bbox = PROVINCE_BBOXES[args.provincia]
    elif args.bbox:
        bbox = args.bbox
    else:
        bbox = "27.6,-18.2,43.8,4.4"  # all Spain

    conn = get_conn()
    total = 0

    # 1. RESC Excel (if provided)
    if args.source in ("resc", "both") and args.resc_path:
        resc_records = load_resc_excel(args.resc_path)
        print(f"RESC: {len(resc_records)} records")
        if resc_records:
            execute_batch(conn, UPSERT_SQL, resc_records)
            total += len(resc_records)

    # 2. OSM (pharmacies, hospitals, clinics, health centres)
    if args.source in ("osm", "both"):
        for tipo, tag_filter in tqdm(OSM_HEALTH_QUERIES.items(), desc="OSM health"):
            print(f"\n→ Fetching {tipo}...", end=" ")
            try:
                query = build_overpass_query(bbox, tag_filter)
                elements = fetch_overpass(query)
            except Exception as e:
                print(f"FAILED: {e}")
                continue

            records = osm_to_records(elements, tipo)
            print(f"{len(records)} features")

            if records:
                execute_batch(conn, UPSERT_SQL, records)
                total += len(records)

            time.sleep(1)

    conn.close()
    print(f"\n✓ Done. {total} health centres written.")


if __name__ == "__main__":
    main()
