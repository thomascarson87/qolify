from __future__ import annotations
#!/usr/bin/env python3
"""
Ingest SNCZI flood zone polygons into the `flood_zones` table.

Source: MITECO SNCZI via ArcGIS REST MapServer (sig.miteco.gob.es)
Service: /arcgis/rest/services/25830/WMS_AguaZI/MapServer

NOTE: The original GeoServer WFS endpoint (snczi.miteco.gob.es/geoserver/civ/wfs)
is no longer resolving as of 2026. Data is now served via ArcGIS REST on
sig.miteco.gob.es. Layer IDs mapped to risk levels:
  Layer 38 — Z.I. con alta probabilidad    → T10  (10-year return period)
  Layer 40 — Z.I. con probabilidad media   → T100 (100-year return period)
  Layer 41 — Z.I. con probabilidad baja    → T500 (500-year return period)

Usage:
  python ingest_flood_zones.py
  python ingest_flood_zones.py --period T100
  python ingest_flood_zones.py --dry-run
  python ingest_flood_zones.py --bbox="-5.2,36.4,-3.9,36.9"  # Málaga province
  python ingest_flood_zones.py --truncate                     # clear before ingest
"""
import argparse
import json
import time
import psycopg2
import requests
from tqdm import tqdm
from _db import get_conn

ARCGIS_BASE = (
    "https://sig.miteco.gob.es/arcgis/rest/services/25830/WMS_AguaZI/MapServer"
)

# ArcGIS MapServer layer IDs → risk level labels
LAYERS = {
    "T10":  38,   # Z.I. con alta probabilidad (10-year)
    "T100": 40,   # Z.I. con probabilidad media u ocasional (100-year)
    "T500": 41,   # Z.I. con probabilidad baja o excepcional (500-year)
}

PAGE_SIZE = 50  # This server 500s at >=100 when returning geometry with a bbox filter


def esri_rings_to_geojson(esri_geom: dict) -> dict | None:
    """
    Convert an Esri JSON polygon geometry (rings[]) to a GeoJSON geometry.
    This server returns f=json (Esri format); geojson is rejected with 400.

    Simplified conversion: treats each ring as a separate polygon exterior.
    This is correct for flood zone features that typically don't have holes.
    """
    rings = esri_geom.get("rings", [])
    if not rings:
        return None
    if len(rings) == 1:
        return {"type": "Polygon", "coordinates": rings}
    # Multiple rings → MultiPolygon (each ring treated as an exterior ring)
    return {"type": "MultiPolygon", "coordinates": [[r] for r in rings]}


def fetch_arcgis_page(
    layer_id: int,
    offset: int,
    bbox: str | None,
) -> dict:
    """
    Query one page of features from an ArcGIS MapServer layer.
    Uses f=json (Esri format) — f=geojson returns HTTP 400 on this server.
    bbox format: "minLng,minLat,maxLng,maxLat" (WGS84)
    """
    params: dict = {
        "f":                 "json",
        "where":             "1=1",
        "outFields":         "objectid",
        "returnGeometry":    "true",
        "outSR":             "4326",
        "resultOffset":      offset,
        "resultRecordCount": PAGE_SIZE,
    }

    if bbox:
        min_lng, min_lat, max_lng, max_lat = [float(v) for v in bbox.split(",")]
        params["geometry"] = json.dumps({
            "xmin": min_lng, "ymin": min_lat,
            "xmax": max_lng, "ymax": max_lat,
            "spatialReference": {"wkid": 4326},
        })
        params["geometryType"] = "esriGeometryEnvelope"
        params["inSR"]         = "4326"
        params["spatialRel"]   = "esriSpatialRelIntersects"

    url = f"{ARCGIS_BASE}/{layer_id}/query"
    resp = requests.get(url, params=params, timeout=120)
    resp.raise_for_status()
    return resp.json()


def fetch_all_features(layer_id: int, bbox: str | None) -> list:
    """Page through ArcGIS query; return list of GeoJSON-compatible feature dicts."""
    features = []
    offset = 0
    while True:
        print(f"    offset={offset}...", end=" ", flush=True)
        data = fetch_arcgis_page(layer_id, offset, bbox)

        if "error" in data:
            raise RuntimeError(f"ArcGIS error: {data['error']}")

        batch = data.get("features", [])
        # Convert Esri JSON geometry → GeoJSON geometry for each feature
        converted = []
        for feat in batch:
            geom = feat.get("geometry")
            if geom:
                gj = esri_rings_to_geojson(geom)
                if gj:
                    converted.append({"geometry": gj})
        print(f"{len(converted)} features")
        features.extend(converted)

        # ArcGIS signals more pages via exceededTransferLimit=true
        if not data.get("exceededTransferLimit", False):
            break
        offset += PAGE_SIZE
        time.sleep(0.5)

    return features


INSERT_SQL = """
INSERT INTO flood_zones (geom, risk_level, source, updated_at)
VALUES (
    ST_Multi(ST_GeomFromGeoJSON(%(geom_json)s))::GEOGRAPHY,
    %(risk_level)s,
    'snczi_arcgis',
    NOW()
)
"""


def load_period(
    conn,
    period: str,
    layer_id: int,
    dry_run: bool,
    bbox: str | None,
) -> int:
    bbox_label = f" [BBOX: {bbox}]" if bbox else " [national]"
    print(f"\n→ Loading {period} (layer {layer_id}){bbox_label}")

    try:
        features = fetch_all_features(layer_id, bbox)
    except Exception as e:
        print(f"  ERROR fetching {period}: {e}")
        return 0

    if dry_run:
        print(f"  [dry-run] would insert {len(features)} {period} polygons")
        return len(features)

    inserted = 0
    errors = 0

    with conn.cursor() as cur:
        for feat in tqdm(features, desc=f"  {period}"):
            geom = feat.get("geometry")
            if not geom:
                continue
            try:
                cur.execute(INSERT_SQL, {
                    "geom_json":  json.dumps(geom),
                    "risk_level": period,
                })
                inserted += 1
            except psycopg2.OperationalError:
                # Connection dropped mid-batch — reconnect and retry
                conn.rollback()
                tqdm.write("  [RECONNECT] DB connection lost, reconnecting...")
                conn = get_conn()
                try:
                    with conn.cursor() as cur2:
                        cur2.execute(INSERT_SQL, {
                            "geom_json":  json.dumps(geom),
                            "risk_level": period,
                        })
                    conn.commit()
                    inserted += 1
                except Exception as e2:
                    tqdm.write(f"  Skipping feature after reconnect: {e2}")
                    errors += 1
                continue
            except Exception as e:
                conn.rollback()
                errors += 1
                tqdm.write(f"  Skipping feature: {e}")
                continue

        try:
            conn.commit()
        except Exception:
            pass

    print(f"  ✓ {inserted} {period} zones inserted ({errors} skipped)")
    return inserted


def main():
    parser = argparse.ArgumentParser(
        description="Ingest SNCZI flood zones from MITECO ArcGIS REST → Qolify"
    )
    parser.add_argument("--period", choices=["T10", "T100", "T500"],
                        help="Load only this return period (default: all)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Fetch and count features without writing to DB")
    parser.add_argument(
        "--bbox",
        metavar="minLng,minLat,maxLng,maxLat",
        help="Spatial filter in WGS84. Example: --bbox=\"-5.2,36.4,-3.9,36.9\" (Málaga)"
    )
    parser.add_argument(
        "--truncate", action="store_true",
        help="DELETE existing flood_zones rows before inserting "
             "(use on re-runs — table has no unique constraint)."
    )
    args = parser.parse_args()

    periods = {args.period: LAYERS[args.period]} if args.period else LAYERS
    conn = None if args.dry_run else get_conn()

    if conn and args.truncate:
        print("→ Truncating existing flood_zones rows...")
        with conn.cursor() as cur:
            cur.execute("DELETE FROM flood_zones")
        conn.commit()
        print("  ✓ flood_zones cleared")

    total = 0
    for period, layer_id in periods.items():
        total += load_period(conn, period, layer_id, args.dry_run, args.bbox)

    if conn:
        conn.close()

    print(f"\n✓ Done. {total} flood zone polygons processed.")
    if not args.truncate and not args.dry_run:
        print("\nTip: use --truncate on re-runs to avoid duplicate rows.")


if __name__ == "__main__":
    main()
