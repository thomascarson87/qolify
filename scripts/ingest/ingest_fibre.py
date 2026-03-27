#!/usr/bin/env python3
"""
Ingest CNMC fibre/broadband coverage polygons into the `fibre_coverage` table.

Source: CNMC / Ministerio de Asuntos Económicos — Geoportal de Telecomunicaciones
Portal: https://geoportal.mincotur.gob.es/MappingTelecos/
Data: GIS shapefiles for broadband coverage by technology

The CNMC publishes shapefiles semi-annually. Download from the geoportal and
unzip, then pass the shapefile path.

Alternatively, the Datos Abiertos de España hosts CSV/GeoJSON versions:
  https://datos.gob.es/es/catalogo/e00015000-cobertura-de-banda-ancha

Technology type mapping:
  FTTP = Fibre to the Premises (>= 100 Mbps symmetric)
  FTTC = Fibre to the Cabinet (30-100 Mbps)
  HFC  = Hybrid Fibre-Coaxial (30-100 Mbps, cable operators)
  none = no coverage

Usage:
  python ingest_fibre.py --shp-path /path/to/cobertura.shp
  python ingest_fibre.py --shp-path cobertura.shp --operator Movistar
  python ingest_fibre.py --shp-path cobertura.shp --dry-run
"""
import argparse
import json
import sys
from _db import get_conn

try:
    import geopandas as gpd
    from shapely.geometry import mapping
    HAS_GEO = True
except ImportError:
    HAS_GEO = False


# CNMC shapefile column → Qolify coverage_type
TECH_MAP = {
    "FTTP": "FTTP",
    "FTTH": "FTTP",
    "FTTB": "FTTP",
    "FTTC": "FTTC",
    "FTTN": "FTTC",
    "HFC":  "HFC",
    "CABLE": "HFC",
    "ADSL": "none",
    "VDSL": "FTTC",
}


def load_shapefile(path: str, operator_filter: str = None) -> list:
    """Read shapefile and return list of fibre_coverage records."""
    if not HAS_GEO:
        print("geopandas and shapely are required for shapefile ingestion.")
        print("Install: pip install geopandas shapely")
        sys.exit(1)

    print(f"Reading shapefile: {path}")
    gdf = gpd.read_file(path)
    print(f"  CRS: {gdf.crs}")
    print(f"  Columns: {list(gdf.columns)}")
    print(f"  Features: {len(gdf)}")

    # Reproject to WGS84 if needed
    if gdf.crs and str(gdf.crs).upper() != "EPSG:4326":
        print(f"  Reprojecting from {gdf.crs} to EPSG:4326...")
        gdf = gdf.to_crs("EPSG:4326")

    # Detect column names
    cols = list(gdf.columns)
    def col(*candidates):
        for c in candidates:
            if c in cols:
                return c
        return None

    tech_col     = col("TECNOLOGIA", "TECHNOLOGY", "TECH", "TYPE", "tipo")
    speed_col    = col("VEL_MAX", "MAX_SPEED", "VELOCIDAD", "SPEED_MBPS")
    operator_col = col("OPERADOR", "OPERATOR", "PROVEEDOR")

    records = []
    for _, row in gdf.iterrows():
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue

        tech_raw = str(row.get(tech_col, "")).upper().strip() if tech_col else ""
        coverage_type = TECH_MAP.get(tech_raw, "FTTP")  # default FTTP if unknown

        op = str(row.get(operator_col, "") or "").strip() if operator_col else None
        if operator_filter and op and operator_filter.lower() not in op.lower():
            continue

        try:
            max_speed = int(row.get(speed_col, 0) or 0) if speed_col else None
        except (ValueError, TypeError):
            max_speed = None

        # Convert geometry to GeoJSON string for PostGIS
        geom_json = json.dumps(mapping(geom))

        records.append({
            "geom_json":     geom_json,
            "coverage_type": coverage_type,
            "max_speed_mbps": max_speed,
            "operator":      op,
            "source":        "cnmc",
        })

    return records


UPSERT_SQL = """
INSERT INTO fibre_coverage (geom, coverage_type, max_speed_mbps, operator, source, updated_at)
VALUES (
    ST_GeomFromGeoJSON(%(geom_json)s)::GEOGRAPHY,
    %(coverage_type)s,
    %(max_speed_mbps)s,
    %(operator)s,
    %(source)s,
    NOW()
)
"""


def main():
    parser = argparse.ArgumentParser(description="Ingest CNMC fibre coverage → Qolify")
    parser.add_argument("--shp-path", required=True, help="Path to CNMC shapefile (.shp)")
    parser.add_argument("--operator", help="Filter by operator name substring")
    parser.add_argument("--dry-run",  action="store_true",
                        help="Parse shapefile without writing to DB")
    args = parser.parse_args()

    records = load_shapefile(args.shp_path, args.operator)
    print(f"Parsed {len(records)} coverage polygons")

    if args.dry_run:
        print("[dry-run] No data written.")
        return

    if not records:
        print("Nothing to insert.")
        return

    conn = get_conn()
    batch_size = 200  # polygons can be large
    total = 0

    with conn.cursor() as cur:
        for i in range(0, len(records), batch_size):
            batch = records[i:i + batch_size]
            import psycopg2.extras
            psycopg2.extras.execute_batch(cur, UPSERT_SQL, batch, page_size=batch_size)
            conn.commit()
            total += len(batch)
            print(f"  {total}/{len(records)} polygons inserted...")

    conn.close()
    print(f"✓ Done. {total} fibre coverage polygons written.")


if __name__ == "__main__":
    main()
