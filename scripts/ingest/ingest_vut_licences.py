from __future__ import annotations
#!/usr/bin/env python3
"""
Qolify — VUT Tourist Licence Ingestion (CHI-326)

Loads VUT (Vivienda de Uso Turístico) data from regional registries into the
`vut_licences` table. Feeds Indicator 7 (Community Stability Score) and
Indicator 11 (Rental Trap Index).

Sources:
  Andalucía  OpenRTA JSON API — https://datos.juntadeandalucia.es/api/v0/openrta/all
             Field: estado → ALTA (active) / BAJA (cancelled)
  Madrid     XLS from Geoportal Madrid — EPSG:25830 coordinates
             https://datos.madrid.es/egob/catalogo/300694-12386129-viviendas-turisticas-geoportal.xls
             Field: licencia (unique licence number)
             ⚠️  Requires pyproj for EPSG:25830 → WGS84 reprojection

Usage:
  python ingest_vut_licences.py                  # all regions
  python ingest_vut_licences.py --region andalucia
  python ingest_vut_licences.py --region madrid
  python ingest_vut_licences.py --dry-run        # no DB writes
  python ingest_vut_licences.py --no-geocode     # skip Nominatim for null-coord records
  python ingest_vut_licences.py --skip-geocoded  # skip records already with geom
  python ingest_vut_licences.py --region madrid --inspect-fields
"""

import argparse
import csv
import io
import sys
import time

import requests
from tqdm import tqdm
from _db import get_conn

# ---------------------------------------------------------------------------
# Data source URLs
# ---------------------------------------------------------------------------

# Andalucía: OpenRTA JSON API — most reliable access method.
# Returns all VUT (and other establishment types — filter on tipo_establecimiento).
ANDALUCIA_OPENRTA_URL = "https://datos.juntadeandalucia.es/api/v0/openrta/all"
# VUT type codes in RETA — filter on these values in tipo_establecimiento / tipo
ANDALUCIA_VUT_TYPES = {
    "VIVIENDA CON FINES TURÍSTICOS",
    "VIVIENDA CON FINES TURISTICOS",
    "VIVIENDA DE USO TURISTICO",
    "VIVIENDA DE USO TURÍSTICO",
    "VFT",
    "VUT",
}

# Madrid: XLS file from Geoportal. Coordinates in EPSG:25830 (UTM zone 30N).
# Alternative: datos.madrid.es XLS (same data, different host):
#   https://datos.madrid.es/egob/catalogo/300694-12386129-viviendas-turisticas-geoportal.xls
MADRID_VUT_URL = (
    "https://datos.madrid.es/egob/catalogo/300694-12386129-viviendas-turisticas-geoportal.xls"
)


# ---------------------------------------------------------------------------
# Coordinate reprojection: EPSG:25830 → WGS84
# ---------------------------------------------------------------------------

def _get_transformer():
    """
    Return a pyproj Transformer for EPSG:25830 → EPSG:4326.
    Raises ImportError with instructions if pyproj is not installed.
    """
    try:
        from pyproj import Transformer
        return Transformer.from_crs("EPSG:25830", "EPSG:4326", always_xy=True)
    except ImportError:
        raise ImportError(
            "pyproj is required for Madrid VUT coordinate reprojection.\n"
            "  Install with: pip install pyproj\n"
            "  Then re-run this script."
        )


def reproject_25830_to_wgs84(
    x: float, y: float, transformer
) -> tuple[float, float] | None:
    """
    Convert EPSG:25830 (Easting, Northing in metres) to WGS84 (lat, lng).
    Returns (lat, lng) or None on error.
    """
    try:
        lng, lat = transformer.transform(x, y)
        # Sanity check: Spain bounding box
        if 27.5 <= lat <= 44.5 and -20.0 <= lng <= 5.0:
            return lat, lng
        return None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Status normalisation
# ---------------------------------------------------------------------------

def normalise_vut_status(raw: str) -> str:
    """
    Normalise regional status strings to 'active' / 'cancelled'.
    Defaults to 'active' for unknown values (licences presumed valid).
    """
    val = raw.strip().upper()
    if val in {"ALTA", "ACTIVO", "ACTIVA", "VIGENTE", "ACTIU", "EN VIGOR",
               "ACTIVO/A", "VIGENT"}:
        return "active"
    if val in {"BAJA", "CANCELADO", "CANCELADA", "REVOCADO", "REVOCADA",
               "CADUCADO", "CADUCADA", "BAIXA", "SUSPENDIDO", "SUSPENDIDA",
               "EXTINGUIDO", "EXTINGUIDA"}:
        return "cancelled"
    return "active"


# ---------------------------------------------------------------------------
# Geocoding (Nominatim fallback for records without coordinates)
# ---------------------------------------------------------------------------

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_HEADERS = {"User-Agent": "Qolify/1.0 (hello@qolify.com)"}


def geocode(address: str, municipio: str, region_label: str) -> tuple[float, float] | None:
    """Geocode address via Nominatim (1 req/s). Returns (lat, lng) or None."""
    if not address:
        return None
    query = f"{address}, {municipio}, {region_label}, Spain"
    try:
        r = requests.get(
            NOMINATIM_URL,
            params={"q": query, "format": "json", "limit": 1, "countrycodes": "es"},
            headers=NOMINATIM_HEADERS,
            timeout=10,
        )
        results = r.json()
        if results:
            return float(results[0]["lat"]), float(results[0]["lon"])
    except Exception as e:
        tqdm.write(f"  [WARN] Geocode failed for '{address[:50]}': {e}")
    finally:
        time.sleep(1.1)
    return None


# ---------------------------------------------------------------------------
# Database operations
# ---------------------------------------------------------------------------

# Ensure the licence_ref unique index exists (CHI-326 spec)
ENSURE_INDEX_SQL = """
CREATE UNIQUE INDEX IF NOT EXISTS vut_licence_ref_idx
ON vut_licences (licence_ref)
WHERE licence_ref IS NOT NULL;
"""

UPSERT_SQL = """
INSERT INTO vut_licences (
    licence_ref, address, lat, lng, geom,
    region, status, source, updated_at
)
VALUES (
    %(licence_ref)s, %(address)s, %(lat)s, %(lng)s,
    CASE WHEN %(lat)s IS NOT NULL AND %(lng)s IS NOT NULL
         THEN ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::geography
         ELSE NULL END,
    %(region)s, %(status)s, %(source)s, NOW()
)
ON CONFLICT (licence_ref) WHERE licence_ref IS NOT NULL
DO UPDATE SET
    address    = COALESCE(EXCLUDED.address, vut_licences.address),
    lat        = COALESCE(EXCLUDED.lat, vut_licences.lat),
    lng        = COALESCE(EXCLUDED.lng, vut_licences.lng),
    geom       = COALESCE(EXCLUDED.geom, vut_licences.geom),
    status     = EXCLUDED.status,
    updated_at = NOW()
"""

INSERT_SQL = """
INSERT INTO vut_licences (
    licence_ref, address, lat, lng, geom,
    region, status, source, updated_at
)
VALUES (
    %(licence_ref)s, %(address)s, %(lat)s, %(lng)s,
    CASE WHEN %(lat)s IS NOT NULL AND %(lng)s IS NOT NULL
         THEN ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::geography
         ELSE NULL END,
    %(region)s, %(status)s, %(source)s, NOW()
)
"""


def _float_or_none(val) -> float | None:
    try:
        return float(val) if val not in (None, "", "NULL", "null") else None
    except (TypeError, ValueError):
        return None


def ensure_unique_index(conn):
    with conn.cursor() as cur:
        cur.execute(ENSURE_INDEX_SQL)
    conn.commit()


def get_geocoded_refs(conn, region: str) -> set[str]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT licence_ref FROM vut_licences "
            "WHERE region = %s AND geom IS NOT NULL AND licence_ref IS NOT NULL",
            (region,)
        )
        return {row[0] for row in cur.fetchall()}


def upsert_batch(conn, records: list[dict], batch_size: int = 500):
    with_ref    = [r for r in records if r.get("licence_ref")]
    without_ref = [r for r in records if not r.get("licence_ref")]
    with conn.cursor() as cur:
        for i in range(0, len(with_ref), batch_size):
            for rec in with_ref[i:i + batch_size]:
                cur.execute(UPSERT_SQL, rec)
            conn.commit()
        for i in range(0, len(without_ref), batch_size):
            for rec in without_ref[i:i + batch_size]:
                cur.execute(INSERT_SQL, rec)
            conn.commit()


# ---------------------------------------------------------------------------
# Andalucía ingestor (OpenRTA JSON API)
# ---------------------------------------------------------------------------

def ingest_andalucia(conn, dry_run: bool, do_geocode: bool, skip_geocoded: bool) -> int:
    """
    Ingest Andalucía VUT via the OpenRTA API (JSON format).
    Filters to VUT-type establishments (tipo_establecimiento).
    """
    print("\n→ Andalucía VUT (OpenRTA API)")

    # OpenRTA supports pagination — fetch all pages
    all_items = []
    page = 1
    page_size = 1000

    with tqdm(desc="  Fetching pages", unit="page") as pbar:
        while True:
            r = requests.get(
                ANDALUCIA_OPENRTA_URL,
                params={"page": page, "size": page_size, "format": "json"},
                timeout=60,
            )
            r.raise_for_status()
            data = r.json()

            # OpenRTA response: {"data": [...], "total": N} or just a list
            if isinstance(data, list):
                batch = data
            else:
                batch = data.get("data") or data.get("items") or data.get("results") or []

            if not batch:
                break
            all_items.extend(batch)
            pbar.update(1)

            # If fewer results than page_size, we've reached the last page
            if len(batch) < page_size:
                break
            page += 1

    print(f"  Fetched {len(all_items)} total OpenRTA records")

    # Filter to VUT type only
    vut_items = []
    for item in all_items:
        tipo = (
            item.get("tipo_establecimiento") or
            item.get("tipo") or
            item.get("type") or ""
        ).upper().strip()
        if not tipo or any(vut_type in tipo for vut_type in ANDALUCIA_VUT_TYPES):
            vut_items.append(item)

    print(f"  {len(vut_items)} VUT records after type filter")

    already_geocoded = set()
    if skip_geocoded and conn:
        already_geocoded = get_geocoded_refs(conn, "andalucia")

    records = []
    for item in tqdm(vut_items, desc="  Andalucía VUT", unit="rec"):
        licence_ref = (
            item.get("numero_inscripcion") or
            item.get("numero_registro") or
            item.get("referencia") or
            item.get("codigo") or ""
        ).strip() or None

        address   = (item.get("direccion") or item.get("domicilio") or "").strip()
        municipio = (item.get("municipio") or item.get("localidad") or "").strip()
        status_raw = (item.get("estado") or item.get("situacion") or "ALTA").strip()

        lat = _float_or_none(item.get("latitud") or item.get("lat") or item.get("latitude"))
        lng = _float_or_none(item.get("longitud") or item.get("lon") or item.get("longitude") or item.get("lng"))

        if lat is None and do_geocode and address:
            if licence_ref not in already_geocoded:
                coords = geocode(address, municipio, "Andalucía")
                if coords:
                    lat, lng = coords

        records.append({
            "licence_ref": licence_ref,
            "address":     address or None,
            "lat":         lat,
            "lng":         lng,
            "region":      "andalucia",
            "status":      normalise_vut_status(status_raw),
            "source":      "openrta_andalucia",
        })

    if dry_run:
        geocoded = sum(1 for r in records if r["lat"])
        print(f"  [DRY] Would upsert {len(records)} records ({geocoded} with coords)")
    else:
        upsert_batch(conn, records)
        geocoded = sum(1 for r in records if r["lat"])
        print(f"  ✓ {len(records)} Andalucía VUT records upserted ({geocoded} with coords)")

    return len(records)


# ---------------------------------------------------------------------------
# Madrid ingestor (XLS with EPSG:25830 coordinates)
# ---------------------------------------------------------------------------

def _load_xls_with_pandas(url: str) -> list[dict]:
    """Download and parse XLS/XLSX into a list of row dicts using pandas."""
    try:
        import pandas as pd
    except ImportError:
        raise ImportError("pandas is required. pip install pandas")

    print(f"  Downloading XLS: {url}")
    r = requests.get(url, timeout=120, headers={"User-Agent": "Qolify/1.0"})
    r.raise_for_status()

    ext = url.split("?")[0].lower()
    engine = "xlrd" if ext.endswith(".xls") else "openpyxl"

    try:
        df = pd.read_excel(io.BytesIO(r.content), engine=engine, dtype=str)
    except Exception as e:
        # Try the other engine as fallback
        alt_engine = "openpyxl" if engine == "xlrd" else "xlrd"
        try:
            df = pd.read_excel(io.BytesIO(r.content), engine=alt_engine, dtype=str)
        except Exception:
            raise RuntimeError(f"Could not parse XLS with either engine: {e}")

    # Normalise column names: strip whitespace, uppercase
    df.columns = [str(c).strip().upper() for c in df.columns]
    return df.to_dict(orient="records")


def ingest_madrid(
    conn, dry_run: bool, do_geocode: bool,
    skip_geocoded: bool, inspect_fields: bool
) -> int:
    """
    Ingest Madrid VUT XLS from Geoportal.

    Coordinates are in EPSG:25830 (ETRS89 / UTM Zone 30N, metres).
    pyproj is required to reproject to WGS84.

    Confirmed field: licencia (unique licence number).
    Typical fields: LICENCIA, DIRECCION, DISTRITO, BARRIO, X (easting), Y (northing)
    """
    print("\n→ Madrid VUT (XLS, EPSG:25830)")

    try:
        transformer = _get_transformer()
    except ImportError as e:
        print(f"  [ERROR] {e}")
        return 0

    rows = _load_xls_with_pandas(MADRID_VUT_URL)
    print(f"  Parsed {len(rows)} rows")

    if inspect_fields:
        print("  Fields:", list(rows[0].keys()) if rows else "(empty)")
        return 0

    already_geocoded = set()
    if skip_geocoded and conn:
        already_geocoded = get_geocoded_refs(conn, "madrid")

    records = []
    for row in tqdm(rows, desc="  Madrid VUT", unit="rec"):
        # Normalise to uppercase keys (done in _load_xls_with_pandas)
        licence_ref = (
            row.get("LICENCIA") or row.get("NUM_LICENCIA") or
            row.get("NUMERO_LICENCIA") or row.get("REFERENCIA") or ""
        ).strip() or None

        address = (
            row.get("DIRECCION") or row.get("DOMICILIO") or
            row.get("CALLE") or ""
        ).strip()

        status_raw = (
            row.get("ESTADO") or row.get("SITUACION") or "ALTA"
        ).strip()

        # EPSG:25830 coordinates
        lat, lng = None, None
        x = _float_or_none(row.get("X") or row.get("COORD_X") or row.get("XCOORD") or row.get("X_ETRS89"))
        y = _float_or_none(row.get("Y") or row.get("COORD_Y") or row.get("YCOORD") or row.get("Y_ETRS89"))

        if x and y:
            reprojected = reproject_25830_to_wgs84(x, y, transformer)
            if reprojected:
                lat, lng = reprojected

        # Nominatim fallback for records without coordinates
        if lat is None and do_geocode and address:
            if licence_ref not in already_geocoded:
                distrito = row.get("DISTRITO", "")
                full_address = f"{address}, {distrito}, Madrid" if distrito else f"{address}, Madrid"
                coords = geocode(full_address, "Madrid", "Madrid")
                if coords:
                    lat, lng = coords

        records.append({
            "licence_ref": licence_ref,
            "address":     address or None,
            "lat":         lat,
            "lng":         lng,
            "region":      "madrid",
            "status":      normalise_vut_status(status_raw),
            "source":      "geoportal.madrid.es",
        })

    if dry_run:
        geocoded = sum(1 for r in records if r["lat"])
        print(f"  [DRY] Would upsert {len(records)} records ({geocoded} with coords)")
    else:
        upsert_batch(conn, records)
        geocoded = sum(1 for r in records if r["lat"])
        print(f"  ✓ {len(records)} Madrid VUT records upserted ({geocoded} with coords)")

    return len(records)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Ingest VUT tourist licences → vut_licences"
    )
    parser.add_argument("--region", choices=["andalucia", "madrid"],
                        help="Process only this region (default: all)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Download and parse without writing to DB")
    parser.add_argument("--no-geocode", action="store_true",
                        help="Skip Nominatim (faster; leaves coords null for unmatched records)")
    parser.add_argument("--skip-geocoded", action="store_true",
                        help="Skip records that already have geom (resume geocoding)")
    parser.add_argument("--inspect-fields", action="store_true",
                        help="Print column headers and exit (debugging)")
    args = parser.parse_args()

    conn = None if args.dry_run else get_conn()
    do_geocode = not args.no_geocode
    total = 0

    try:
        if conn:
            ensure_unique_index(conn)

        if args.region in (None, "andalucia"):
            total += ingest_andalucia(conn, args.dry_run, do_geocode, args.skip_geocoded)
        if args.region in (None, "madrid"):
            total += ingest_madrid(conn, args.dry_run, do_geocode,
                                   args.skip_geocoded, args.inspect_fields)
    finally:
        if conn:
            conn.close()

    print(f"\n✓ Done. {total} VUT records processed.")
    print("\nTip: Run with --no-geocode first to seed the DB quickly,")
    print("     then --skip-geocoded to geocode incrementally on re-runs.")


if __name__ == "__main__":
    main()


# =============================================================================
# SQL: PostGIS function for indicator engine (run once in Supabase)
# =============================================================================
#
# CREATE OR REPLACE FUNCTION count_vut_within(
#     p_lat     DECIMAL,
#     p_lng     DECIMAL,
#     radius_m  INT DEFAULT 500
# )
# RETURNS JSONB LANGUAGE sql STABLE AS $$
#     SELECT jsonb_build_object(
#         'total',     COUNT(*),
#         'active',    COUNT(*) FILTER (WHERE status = 'active'),
#         'cancelled', COUNT(*) FILTER (WHERE status = 'cancelled')
#     )
#     FROM vut_licences
#     WHERE ST_DWithin(
#         geom,
#         ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
#         radius_m
#     );
# $$;
