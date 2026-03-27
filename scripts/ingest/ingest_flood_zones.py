#!/usr/bin/env python3
"""
Ingest SNCZI flood zone polygons into the `flood_zones` table.

Source: SNCZI (MITECO) — Sistema Nacional de Cartografía de Zonas Inundables
WFS endpoint: https://snczi.miteco.gob.es/geoserver/civ/wfs

Three return periods are loaded:
  T10  — high probability (10-year flood)
  T100 — medium probability (100-year flood)
  T500 — low probability (500-year flood)

Usage:
  python ingest_flood_zones.py
  python ingest_flood_zones.py --period T100   # single period only
  python ingest_flood_zones.py --dry-run       # count features, no DB write
"""
import argparse
import json
import sys
import time
import requests
from tqdm import tqdm
from _db import get_conn

SNCZI_WFS = "https://snczi.miteco.gob.es/geoserver/civ/wfs"

# WFS layer names for each return period
LAYERS = {
    "T10":  "civ:LLANURA_INUNDABLE_T10",
    "T100": "civ:LLANURA_INUNDABLE_T100",
    "T500": "civ:LLANURA_INUNDABLE_T500",
}

PAGE_SIZE = 500  # WFS features per request


def fetch_wfs_page(layer: str, start_index: int) -> dict:
    params = {
        "service":      "WFS",
        "version":      "2.0.0",
        "request":      "GetFeature",
        "typeName":     layer,
        "outputFormat": "application/json",
        "count":        PAGE_SIZE,
        "startIndex":   start_index,
    }
    resp = requests.get(SNCZI_WFS, params=params, timeout=120)
    resp.raise_for_status()
    return resp.json()


def fetch_all_features(layer: str) -> list:
    """Page through WFS and return all features."""
    features = []
    start = 0
    while True:
        print(f"    page start={start}...", end=" ", flush=True)
        data = fetch_wfs_page(layer, start)
        batch = data.get("features", [])
        print(f"{len(batch)} features")
        features.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        start += PAGE_SIZE
        time.sleep(0.5)
    return features


UPSERT_SQL = """
INSERT INTO flood_zones (geom, risk_level, source, updated_at)
VALUES (
    ST_Multi(ST_GeomFromGeoJSON(%(geom_json)s))::GEOGRAPHY,
    %(risk_level)s,
    'snczi',
    NOW()
)
"""


def load_period(conn, period: str, layer: str, dry_run: bool):
    print(f"\n→ Loading {period} ({layer})")
    try:
        features = fetch_all_features(layer)
    except Exception as e:
        print(f"  ERROR fetching {period}: {e}")
        return 0

    if dry_run:
        print(f"  [dry-run] would insert {len(features)} {period} polygons")
        return len(features)

    inserted = 0
    with conn.cursor() as cur:
        for feat in tqdm(features, desc=f"  {period}"):
            geom = feat.get("geometry")
            if not geom:
                continue
            try:
                cur.execute(UPSERT_SQL, {
                    "geom_json": json.dumps(geom),
                    "risk_level": period,
                })
                inserted += 1
            except Exception as e:
                conn.rollback()
                print(f"  Skipping feature: {e}")
                continue
        conn.commit()

    print(f"  ✓ {inserted} {period} zones inserted")
    return inserted


def main():
    parser = argparse.ArgumentParser(description="Ingest SNCZI flood zones → Qolify")
    parser.add_argument("--period", choices=["T10", "T100", "T500"],
                        help="Load only this return period (default: all)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Fetch and count features without writing to DB")
    args = parser.parse_args()

    periods = {args.period: LAYERS[args.period]} if args.period else LAYERS

    conn = None if args.dry_run else get_conn()
    total = 0

    for period, layer in periods.items():
        total += load_period(conn, period, layer, args.dry_run)

    if conn:
        conn.close()

    print(f"\n✓ Done. {total} flood zone polygons processed.")


if __name__ == "__main__":
    main()
