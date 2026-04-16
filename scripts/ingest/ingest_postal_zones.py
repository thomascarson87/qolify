#!/usr/bin/env python3
"""
Ingest Málaga postcode boundary polygons into `postal_zones`.

Pipeline (all in one run by default):
  1. Fetch boundary=postal_code relations from OpenStreetMap via Overpass API
     (or load from a local shapefile if --shapefile PATH is supplied)
  2. Reconstruct MultiPolygon geometry using osm2geojson (or geopandas for shapefile)
  3. Upsert into postal_zones (codigo_postal, municipio, geom)
  4. UPDATE postal_zones SET centroid = ST_Centroid(geom)
  5. REFRESH MATERIALIZED VIEW zone_scores
  6. Export zones.geojson from PostGIS and upload to Supabase Storage
     (map-tiles/malaga/zones.geojson — MapLibre loads this on page open)

Sources:
  OpenStreetMap via Overpass API (default)
    Queries all "boundary=postal_code" relations within the Málaga municipality
    area (OSM admin_level=8). Covers postcodes 29001–29017 plus surrounding
    Málaga municipality codes.

  Local shapefile (--shapefile PATH)
    Load official polygon boundaries from a Correos or CartoCiudad/CNIG shapefile.
    This replaces the Overpass + Nominatim fetch entirely. All other pipeline steps
    (upsert, centroid, zone_scores refresh, CDN export) run as normal.

    Download sources for Spanish postcode shapefiles:
      CartoCiudad (IGN/CNIG): https://centrodedescargas.cnig.es/CentroDescargas/
        → Search "CartoCiudad" → download national dataset → find Cod_Postal layer
      Correos open data: https://datos.gob.es  (search "codigos postales shp")

    Expected column names (auto-detected): COD_POSTAL, CODPOS, CP, POSTAL_CODE,
      CODIGOPOST, CODIGO_POS (case-insensitive). CRS is auto-reprojected to EPSG:4326.

Prerequisites:
  pip install osm2geojson supabase tqdm requests
  pip install geopandas  # only required when using --shapefile

Env vars (from .env.local or environment):
  DATABASE_URL_POOLER or DATABASE_URL  — Supabase Postgres connection
  NEXT_PUBLIC_SUPABASE_URL             — Supabase project URL (for storage upload)
  SUPABASE_SERVICE_ROLE_KEY            — Supabase service role key (for storage upload)

Usage:
  python ingest_postal_zones.py                                            # full OSM pipeline
  python ingest_postal_zones.py --dry-run                                  # count OSM features, no DB writes
  python ingest_postal_zones.py --verify                                   # show current row counts and exit
  python ingest_postal_zones.py --no-upload                                # skip Supabase Storage upload step
  python ingest_postal_zones.py --export-only                              # skip ingest, just refresh + export
  python ingest_postal_zones.py --malaga-only                              # restrict to 29001–29017 city postcodes
  python3 ingest_postal_zones.py --fetch-cartociudad --malaga-only                              # fetch from CartoCiudad WFS (recommended, no download)
  python3 ingest_postal_zones.py --shapefile ~/Downloads/CP.shp --malaga-only                 # load from local shapefile
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import requests
from tqdm import tqdm
from _db import get_conn

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Overpass mirrors — rotated on failure
OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
]

# OSM area ID for Málaga municipality (admin_level=8)
# Using an explicit area query is more reliable than relying on the area ID.
MALAGA_CITY_POSTCODES = {str(i).zfill(5) for i in range(29001, 29018)}  # 29001–29017

# Supabase Storage bucket + path for the pre-baked tile
STORAGE_BUCKET = "map-tiles"
STORAGE_PATH   = "malaga/zones.geojson"

# Properties to include in each GeoJSON feature (must match zone_scores columns)
TILE_PROPERTIES = [
    "codigo_postal", "zone_tvi",
    "school_score_norm", "health_score_norm", "community_score_norm",
    "flood_risk_score", "solar_score_norm", "connectivity_score_norm",
    "infrastructure_score_norm", "vut_density_pct", "has_t10_flood",
    "avg_ghi", "signals",
]

# ---------------------------------------------------------------------------
# Nominatim fallback (for city postcodes missing from Overpass results)
# ---------------------------------------------------------------------------

def fetch_nominatim_polygon(postal_code: str) -> dict | None:
    """
    Fetch a polygon boundary for a specific postcode from Nominatim.
    Rate-limited: 1 req/s (Nominatim usage policy).
    Returns a GeoJSON geometry dict or None if not found.
    """
    url = "https://nominatim.openstreetmap.org/search"
    params = {
        "postalcode":     postal_code,
        "country":        "Spain",
        "format":         "json",
        "polygon_geojson": "1",
        "limit":          "1",
    }
    headers = {"User-Agent": "Qolify/1.0 ingest_postal_zones.py (ingest@qolify.es)"}
    try:
        resp = requests.get(url, params=params, timeout=30, headers=headers)
        resp.raise_for_status()
        results = resp.json()
        if results:
            geom = results[0].get("geojson")
            if geom and geom.get("type") in ("Polygon", "MultiPolygon"):
                return geom
    except Exception as e:
        print(f"    {postal_code}: Nominatim error ({e})")
    return None


def fill_missing_from_nominatim(features: list[dict]) -> list[dict]:
    """
    For any city postcode (29001–29017) not already in features, attempt to
    fetch its boundary from Nominatim and append to the list.
    Nominatim draws from OSM too, so it also fails when OSM lacks the boundary —
    but it uses a different search path and sometimes succeeds where Overpass doesn't.
    """
    found = {f["codigo_postal"] for f in features}
    missing = sorted(MALAGA_CITY_POSTCODES - found)
    if not missing:
        return features

    print(f"\n  Nominatim fallback: fetching {len(missing)} missing city postcodes…")
    added = 0
    for cp in missing:
        time.sleep(1.1)  # respect 1 req/s policy
        geom = fetch_nominatim_polygon(cp)
        if geom:
            features.append({"codigo_postal": cp, "municipio": "Málaga", "geometry": geom})
            added += 1
            print(f"    ✓ {cp}")
        else:
            print(f"    ✗ {cp} — not in OSM (will be absent from choropleth)")

    if added < len(missing):
        print(
            f"\n  ⚠  {len(missing) - added} city postcodes have no OSM boundary.\n"
            "     The choropleth will have gaps for those zones.\n"
            "     To fill them, obtain boundary polygons from Correos or INE and\n"
            "     load them with: python ingest_postal_zones.py --shapefile <path>\n"
        )
    return features


# ---------------------------------------------------------------------------
# CartoCiudad WFS fetcher (IGN official postcode boundaries — no download needed)
# ---------------------------------------------------------------------------

# CartoCiudad WFS candidate URLs — IGN/CNIG may host the service at any of these.
# fetch_cartociudad_wfs() probes each in order until one returns valid WFS XML.
_WFS_CANDIDATES = [
    "https://www.cartociudad.es/wfs",
    "https://servicios.idee.es/wfs/cartociudad",
    "https://servicios.idee.es/wfs/CartoCiudad",
    "https://servicios.idee.es/wfs/inspire/codigos-postales",
]

def _probe_wfs_endpoint(base_url: str) -> tuple[str, str] | None:
    """
    Send a GetCapabilities request to base_url. If it returns valid WFS XML,
    extract the first layer name that looks like a postal-code layer and return
    (base_url, layer_name). Returns None if the endpoint is not a WFS service.
    """
    import re
    cap_url = (
        f"{base_url}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetCapabilities"
    )
    try:
        resp = requests.get(cap_url, timeout=15,
                            headers={"User-Agent": "Qolify/1.0 ingest_postal_zones.py"})
        text = resp.text
    except requests.RequestException:
        return None

    # Must contain WFS_Capabilities XML root — if it returns HTML it's not a WFS
    if "<WFS_Capabilities" not in text and "<wfs:WFS_Capabilities" not in text:
        return None

    # Look for a layer/FeatureType whose name contains "postal" or "codigo"
    candidates = re.findall(r"<Name>([^<]*(?:postal|codigo|CP|zip)[^<]*)</Name>",
                            text, re.IGNORECASE)
    if not candidates:
        # Return first layer name as generic fallback
        first = re.search(r"<Name>([^<]+)</Name>", text)
        layer = first.group(1) if first else None
    else:
        layer = candidates[0]

    return (base_url, layer) if layer else None


def fetch_cartociudad_wfs(malaga_only: bool) -> list[dict]:
    """
    Fetch official Spanish postcode boundary polygons from an IGN/CNIG WFS.
    No download required — probes each candidate URL for a live WFS, then
    queries the postal-code layer directly.

    CartoCiudad is the official Spanish geographic reference database (IGN/CNIG).
    Returns real boundary polygons (not bounding boxes) in EPSG:4326 for all
    Málaga province postcodes (29xxx), or just 29001–29017 if malaga_only is set.
    """
    # ---- Step 1: find a live WFS endpoint ----
    print(f"  Probing {len(_WFS_CANDIDATES)} WFS candidate URLs…")
    endpoint = None
    layer_name = None
    for url in _WFS_CANDIDATES:
        print(f"    {url} … ", end="", flush=True)
        result = _probe_wfs_endpoint(url)
        if result:
            endpoint, layer_name = result
            print(f"✓  (layer: {layer_name})")
            break
        print("no WFS")

    if not endpoint:
        _print_wfs_not_found()
        sys.exit(1)

    # ---- Step 2: fetch features ----
    if malaga_only:
        cps = sorted(MALAGA_CITY_POSTCODES)
        cp_list = ",".join(f"'{cp}'" for cp in cps)
        cql_filter = f"cod_postal IN ({cp_list})"
    else:
        cql_filter = "cod_postal LIKE '29%'"

    params = {
        "SERVICE":      "WFS",
        "VERSION":      "2.0.0",
        "REQUEST":      "GetFeature",
        "TYPENAMES":    layer_name,
        "CQL_FILTER":   cql_filter,
        "outputFormat": "application/json",
        "SRSNAME":      "EPSG:4326",
        "count":        "200",
    }

    print(f"  Fetching features from {endpoint}…")
    try:
        resp = requests.get(endpoint, params=params, timeout=60,
                            headers={"User-Agent": "Qolify/1.0 ingest_postal_zones.py"})
        resp.raise_for_status()
        content_type = resp.headers.get("Content-Type", "")
        if "xml" in content_type.lower() or resp.text.strip().startswith("<"):
            # Server returned XML error — the CQL filter may not be supported.
            # Retry without CQL_FILTER and filter in Python.
            print("  WFS returned XML (CQL not supported?) — retrying with bbox filter…")
            params_nobbox = {k: v for k, v in params.items() if k != "CQL_FILTER"}
            # bbox around Málaga province
            params_nobbox["BBOX"] = "36.0,-5.5,37.5,-3.5,EPSG:4326"
            resp = requests.get(endpoint, params=params_nobbox, timeout=60,
                                headers={"User-Agent": "Qolify/1.0 ingest_postal_zones.py"})
            resp.raise_for_status()
        data = resp.json()
    except (requests.RequestException, ValueError) as e:
        print(f"\nERROR: WFS feature fetch failed: {e}", file=sys.stderr)
        _print_wfs_not_found()
        sys.exit(1)

    raw_features = data.get("features", [])
    print(f"  {len(raw_features)} raw features from WFS")

    if not raw_features:
        print("  WFS returned 0 features — layer found but no matching postcodes.")
        _print_wfs_not_found()
        sys.exit(1)

    # ---- Step 3: normalise to internal feature format ----
    features = []
    skipped = 0
    for feat in raw_features:
        props = feat.get("properties", {}) or {}
        # Try common postcode property names across different WFS providers
        raw_cp = (
            props.get("cod_postal")
            or props.get("COD_POSTAL")
            or props.get("codpos")
            or props.get("CODPOS")
            or props.get("cp")
            or props.get("CP")
            or ""
        )
        cp = str(raw_cp).strip().zfill(5)
        if not cp.isdigit() or len(cp) != 5:
            skipped += 1
            continue

        if not cp.startswith("29"):
            skipped += 1
            continue

        if malaga_only and cp not in MALAGA_CITY_POSTCODES:
            skipped += 1
            continue

        geom = feat.get("geometry")
        if not geom or geom.get("type") not in ("Polygon", "MultiPolygon"):
            skipped += 1
            continue

        features.append({
            "codigo_postal": cp,
            "municipio":     "Málaga" if cp in MALAGA_CITY_POSTCODES else None,
            "geometry":      geom,
        })

    print(f"  {len(features)} valid postcode polygons ({skipped} skipped)")

    if malaga_only:
        found = {f["codigo_postal"] for f in features}
        missing = sorted(MALAGA_CITY_POSTCODES - found)
        if missing:
            print(f"  ⚠  {len(missing)} city postcodes missing from WFS: {missing}")

    return features


def _print_wfs_not_found() -> None:
    """Print clear instructions when no live CartoCiudad WFS is found."""
    caps_urls = "\n".join(
        f"  curl '{u}?SERVICE=WFS&REQUEST=GetCapabilities' | grep -i postal"
        for u in _WFS_CANDIDATES
    )
    print(
        "\n── CartoCiudad WFS not reachable ─────────────────────────────────────\n"
        "  None of the candidate URLs returned a valid WFS GetCapabilities.\n\n"
        "  To diagnose, run these and look for a layer name with 'postal' or 'codigo':\n"
        f"{caps_urls}\n\n"
        "  To download the shapefile directly:\n"
        "    1. Open https://centrodedescargas.cnig.es/CentroDescargas/\n"
        "    2. Search: CartoCiudad\n"
        "    3. Download the national CartoCiudad dataset (Series: CARTCIUD)\n"
        "    4. Unzip → find the Cod_Postal.shp layer\n"
        "    5. Run:\n"
        "         python3 ingest_postal_zones.py --shapefile /path/to/Cod_Postal.shp --malaga-only\n"
        "─────────────────────────────────────────────────────────────────────────",
        file=sys.stderr,
    )


# ---------------------------------------------------------------------------
# Shapefile loader (Correos / CartoCiudad / CNIG)
# ---------------------------------------------------------------------------

# Column names used by Spanish official postcode shapefiles, in priority order.
# geopandas column names are case-sensitive; we normalise to uppercase for matching.
_CP_COLUMN_CANDIDATES = [
    "COD_POSTAL", "CODPOS", "CP", "POSTAL_CODE", "POSTALCODE",
    "CODIGOPOST", "CODIGO_POS", "COD_POST", "CODIGO_POSTAL",
]


def detect_postcode_column(gdf) -> str | None:
    """
    Return the name of the postcode column in a GeoDataFrame, or None.
    Compares against known Spanish official shapefile column names (case-insensitive).
    """
    # Build a mapping of uppercase → original column name
    upper_map = {col.upper(): col for col in gdf.columns}
    for candidate in _CP_COLUMN_CANDIDATES:
        if candidate in upper_map:
            return upper_map[candidate]
    return None


def load_from_shapefile(path: str, malaga_only: bool) -> list[dict]:
    """
    Load postcode boundary polygons from a local shapefile (Correos / CartoCiudad / CNIG).
    Returns a list of feature dicts compatible with ingest_features().

    Handles:
      - Automatic CRS reprojection to EPSG:4326 (WGS84) — most Spanish official data
        is distributed as ETRS89 / UTM Zone 30N (EPSG:25830).
      - Auto-detection of the postcode column from known column name patterns.
      - Filtering to Málaga province (29xxx) or city only (29001–29017 with --malaga-only).
      - Skipping null / empty geometries and non-Polygon types with a warning.
    """
    try:
        import geopandas as gpd
    except ImportError:
        print(
            "\nERROR: geopandas not installed.\n"
            "Run:  pip install geopandas\n",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"  Reading {path}…")
    try:
        gdf = gpd.read_file(path)
    except Exception as e:
        print(f"\nERROR: Could not read shapefile: {e}", file=sys.stderr)
        sys.exit(1)

    print(f"  {len(gdf):,} features, CRS: {gdf.crs}")

    # Reproject to WGS84 (EPSG:4326) if the source uses a different CRS
    if gdf.crs and gdf.crs.to_epsg() != 4326:
        print(f"  Reprojecting from {gdf.crs.to_epsg()} → 4326…")
        gdf = gdf.to_crs(epsg=4326)

    # Detect postcode column
    cp_col = detect_postcode_column(gdf)
    if cp_col is None:
        print(
            f"\nERROR: Could not find a postcode column in the shapefile.\n"
            f"       Available columns: {list(gdf.columns)}\n"
            f"       Expected one of: {', '.join(_CP_COLUMN_CANDIDATES)}\n"
            f"       Rename the column or add it to _CP_COLUMN_CANDIDATES in the script.\n",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"  Postcode column: '{cp_col}'")

    features = []
    skipped_no_geom = skipped_non_polygon = skipped_filtered = 0

    for _, row in gdf.iterrows():
        raw_cp = str(row[cp_col]).strip()

        # Zero-pad to 5 digits (some sources store as int without leading zero)
        cp = raw_cp.zfill(5) if raw_cp.isdigit() else raw_cp

        # Validate: must be 5-digit numeric
        if not cp.isdigit() or len(cp) != 5:
            skipped_filtered += 1
            continue

        # Filter to Málaga province (all 29xxx)
        if not cp.startswith("29"):
            skipped_filtered += 1
            continue

        # Apply --malaga-only filter (city postcodes 29001–29017 only)
        if malaga_only and cp not in MALAGA_CITY_POSTCODES:
            skipped_filtered += 1
            continue

        # Skip null / empty geometries
        geom = row.geometry
        if geom is None or geom.is_empty:
            skipped_no_geom += 1
            print(f"    ⚠  {cp}: null/empty geometry — skipped")
            continue

        # Get GeoJSON-compatible dict via the standard __geo_interface__ protocol
        geom_dict = geom.__geo_interface__

        # Ensure we have a usable polygon type (Polygon → MultiPolygon handled by UPSERT_SQL)
        if geom_dict.get("type") not in ("Polygon", "MultiPolygon"):
            skipped_non_polygon += 1
            print(f"    ⚠  {cp}: unexpected geometry type '{geom_dict.get('type')}' — skipped")
            continue

        features.append({
            "codigo_postal": cp,
            "municipio":     "Málaga" if cp in MALAGA_CITY_POSTCODES else None,
            "geometry":      geom_dict,
        })

    print(
        f"  {len(features)} valid postcode polygons extracted "
        f"(skipped: {skipped_filtered} out-of-scope, "
        f"{skipped_no_geom} no-geom, {skipped_non_polygon} non-polygon)"
    )

    if malaga_only and len(features) < len(MALAGA_CITY_POSTCODES):
        found = {f["codigo_postal"] for f in features}
        missing = sorted(MALAGA_CITY_POSTCODES - found)
        if missing:
            print(f"\n  ⚠  {len(missing)} city postcodes not found in shapefile: {missing}")
            print("     Check that the shapefile covers all 29001–29017 postcodes.")

    return features


# ---------------------------------------------------------------------------
# Overpass fetch
# ---------------------------------------------------------------------------

def build_query_by_area() -> str:
    """
    Fetch all postal_code boundary relations for Málaga province (29xxx).

    Strategy (three parallel branches — union deduped by Overpass):
      1. Direct province range query by postal_code tag ("^29" prefix)
      2. Same but using the `ref` tag (some Spanish OSM mappers use ref, not postal_code)
      3. Area filter on Málaga municipality (admin_level=8) as a safety net

    The broad "^29" prefix catches all Málaga province codes (29001–29769).
    We filter down to just the city postcodes in osm_to_features() if --malaga-only is set.
    Using a broad query is safer than a tight one — extra postcodes cost nothing to skip.
    """
    return """
[out:json][timeout:180];
(
  relation["boundary"="postal_code"]["postal_code"~"^29"];
  relation["boundary"="postal_code"]["ref"~"^29"][!"postal_code"];
  area["name"="Málaga"]["admin_level"="8"]->.malaga;
  relation["boundary"="postal_code"](area.malaga);
);
out geom;
"""


def fetch_overpass(query: str, retries: int = 3) -> dict:
    """POST to Overpass API, rotating mirrors on error."""
    for attempt in range(retries):
        mirror = OVERPASS_MIRRORS[attempt % len(OVERPASS_MIRRORS)]
        try:
            print(f"  Querying {mirror}…", end=" ", flush=True)
            resp = requests.post(mirror, data={"data": query}, timeout=180)
            resp.raise_for_status()
            data = resp.json()
            elements = data.get("elements", [])
            print(f"{len(elements)} elements")
            return data
        except requests.RequestException as e:
            print(f"FAILED ({e})")
            if attempt < retries - 1:
                time.sleep(15 * (attempt + 1))
            else:
                raise RuntimeError(f"All Overpass mirrors failed: {e}") from e
    return {}


# ---------------------------------------------------------------------------
# Geometry reconstruction
# ---------------------------------------------------------------------------

def osm_to_features(overpass_data: dict) -> list[dict]:
    """
    Convert Overpass JSON to a list of GeoJSON-like feature dicts.
    Uses osm2geojson for proper ring assembly from member ways.

    Each returned dict has:
      { "codigo_postal": str, "municipio": str | None, "geometry": dict }
    """
    try:
        import osm2geojson
    except ImportError:
        print(
            "\nERROR: osm2geojson not installed.\n"
            "Run:  pip install osm2geojson\n",
            file=sys.stderr,
        )
        sys.exit(1)

    # osm2geojson.json2geojson reconstructs polygons from member way geometry.
    # shape=True returns shapely geometries; shape=False returns GeoJSON dicts.
    geojson_fc = osm2geojson.json2geojson(overpass_data, filter_used_refs=False)

    features = []
    skipped_no_cp = skipped_no_geom = skipped_bad_cp = 0

    for feat in geojson_fc.get("features", []):
        props = feat.get("properties", {}) or {}
        tags  = props.get("tags", {}) or {}

        # postal_code is the preferred tag; ref is a common fallback in Spanish OSM data
        cp = tags.get("postal_code") or tags.get("ref")
        if not cp:
            skipped_no_cp += 1
            continue

        cp = cp.strip()
        if not cp.isdigit() or len(cp) != 5:
            skipped_bad_cp += 1
            continue  # malformed (e.g. "ES-29001", partial, non-numeric)

        geom = feat.get("geometry")
        if not geom or geom.get("type") not in ("Polygon", "MultiPolygon"):
            skipped_no_geom += 1
            continue  # relation exists but osm2geojson couldn't reconstruct a polygon

        municipio = (
            tags.get("addr:city")
            or tags.get("addr:municipality")
            or tags.get("is_in:city")
            or ("Málaga" if cp in MALAGA_CITY_POSTCODES else None)
        )

        features.append({
            "codigo_postal": cp,
            "municipio":     municipio,
            "geometry":      geom,
        })

    total = len(features) + skipped_no_cp + skipped_no_geom + skipped_bad_cp
    print(f"  {total} OSM features → {len(features)} valid postcode polygons "
          f"(skipped: {skipped_no_cp} no-cp, {skipped_bad_cp} bad-cp, {skipped_no_geom} no-geom)")

    if len(features) < 5:
        print(
            "\n  ⚠  Very few boundaries returned. Likely causes:\n"
            "     - OSM coverage for Málaga postal codes is sparse\n"
            "     - Relations exist but geometry is incomplete (open ways, missing nodes)\n"
            "     - Try running with a different Overpass mirror (edit OVERPASS_MIRRORS)\n"
            "     - As a fallback, load boundaries from a Correos/IGN shapefile instead\n"
        )

    return features


# ---------------------------------------------------------------------------
# Database operations
# ---------------------------------------------------------------------------

UPSERT_SQL = """
INSERT INTO postal_zones (codigo_postal, municipio, geom, centroid)
VALUES (
    %(codigo_postal)s,
    %(municipio)s,
    ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%(geom_json)s), 4326)),
    NULL
)
ON CONFLICT (codigo_postal) DO UPDATE
  SET municipio = EXCLUDED.municipio,
      geom      = EXCLUDED.geom,
      centroid  = NULL;
"""


def ingest_features(conn, features: list[dict], malaga_only: bool) -> int:
    """Upsert features into postal_zones. Returns count inserted/updated."""
    if malaga_only:
        features = [f for f in features if f["codigo_postal"] in MALAGA_CITY_POSTCODES]
        print(f"  --malaga-only: filtered to {len(features)} city postcodes")

    inserted = 0
    with conn.cursor() as cur:
        for feat in tqdm(features, desc="  upserting postal_zones"):
            try:
                cur.execute(UPSERT_SQL, {
                    "codigo_postal": feat["codigo_postal"],
                    "municipio":     feat["municipio"],
                    "geom_json":     json.dumps(feat["geometry"]),
                })
                inserted += 1
            except Exception as e:
                conn.rollback()
                print(f"\n  Skip {feat['codigo_postal']}: {e}")
                continue
        conn.commit()

    return inserted


def compute_centroids(conn) -> int:
    """SET centroid = ST_Centroid(geom) for all rows where centroid is NULL."""
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE postal_zones
            SET centroid = ST_Centroid(geom)
            WHERE centroid IS NULL
        """)
        updated = cur.rowcount
        conn.commit()
    return updated


def refresh_zone_scores(conn) -> None:
    """
    Refresh the zone_scores materialised view.
    Falls back to non-concurrent refresh on first run (view empty or no lock).
    """
    with conn.cursor() as cur:
        try:
            print("  REFRESH MATERIALIZED VIEW CONCURRENTLY zone_scores…", end=" ", flush=True)
            cur.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY zone_scores")
            conn.commit()
            print("done")
        except Exception as e:
            conn.rollback()
            print(f"(CONCURRENTLY failed: {e}) — falling back to blocking refresh…", end=" ", flush=True)
            cur.execute("REFRESH MATERIALIZED VIEW zone_scores")
            conn.commit()
            print("done")


def verify(conn) -> None:
    """Print current row counts for postal_zones and zone_scores."""
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM postal_zones")
        pz = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM zone_scores")
        zs = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM zone_scores WHERE zone_tvi IS NOT NULL")
        scored = cur.fetchone()[0]
    print(f"\n  postal_zones : {pz} rows")
    print(f"  zone_scores  : {zs} rows  ({scored} with non-null zone_tvi)")
    if pz == 0:
        print("\n  ⚠  postal_zones is empty — run without --verify to ingest boundaries.")
    elif zs == 0:
        print("\n  ⚠  zone_scores is empty — run REFRESH MATERIALIZED VIEW zone_scores in Supabase.")


# ---------------------------------------------------------------------------
# GeoJSON export + Supabase Storage upload
# ---------------------------------------------------------------------------

_EXPORT_SQL_TEMPLATE = """
SELECT json_build_object(
  'type', 'FeatureCollection',
  'features', COALESCE(json_agg(
    json_build_object(
      'type',       'Feature',
      'geometry',   ST_AsGeoJSON(zs.geom)::json,
      'properties', json_build_object(
        'codigo_postal',             zs.codigo_postal,
        'municipio',                 zs.municipio,
        'zone_tvi',                  zs.zone_tvi,
        'weighted_score',            zs.zone_tvi,
        'school_score_norm',         zs.school_score_norm,
        'health_score_norm',         zs.health_score_norm,
        'community_score_norm',      zs.community_score_norm,
        'flood_risk_score',          zs.flood_risk_score,
        'solar_score_norm',          zs.solar_score_norm,
        'connectivity_score_norm',   zs.connectivity_score_norm,
        'infrastructure_score_norm', zs.infrastructure_score_norm,
        'vut_density_pct',           zs.vut_density_pct,
        'has_t10_flood',             zs.has_t10_flood,
        'avg_ghi',                   zs.avg_ghi,
        'signals',                   zs.signals
      )
    )
  ), '[]'::json)
) AS geojson
FROM zone_scores zs
WHERE zs.geom IS NOT NULL{extra_filter};
"""


def export_geojson(conn, malaga_only: bool = False) -> bytes:
    """Run the PostGIS export query and return the GeoJSON as UTF-8 bytes.

    When malaga_only is True, only the 17 Málaga city postcodes (29001–29017)
    are included in the export. This produces a much smaller tile file and
    removes the outer province rectangles that pollute the choropleth.
    """
    if malaga_only:
        cp_list = ",".join(f"'{cp}'" for cp in sorted(MALAGA_CITY_POSTCODES))
        extra = f"\n  AND zs.codigo_postal IN ({cp_list})"
    else:
        extra = ""
    sql = _EXPORT_SQL_TEMPLATE.format(extra_filter=extra)

    with conn.cursor() as cur:
        cur.execute(sql)
        row = cur.fetchone()
    if not row or not row[0]:
        raise RuntimeError("Export query returned NULL — is zone_scores populated?")
    geojson_obj = row[0]
    return json.dumps(geojson_obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def upload_to_storage(geojson_bytes: bytes) -> None:
    """
    Upload zones.geojson to Supabase Storage bucket 'map-tiles'.
    Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
    """
    try:
        from supabase import create_client
    except ImportError:
        print(
            "\nERROR: supabase Python client not installed.\n"
            "Run:  pip install supabase\n"
            "Or upload zones.geojson manually to Supabase Storage → map-tiles/malaga/zones.geojson\n",
            file=sys.stderr,
        )
        return

    supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    service_key  = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not supabase_url or not service_key:
        print(
            "\n⚠  NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set.\n"
            "   Add them to .env.local to enable automatic upload.\n"
            "   Alternatively, download zones.geojson and upload manually via\n"
            "   Supabase Dashboard → Storage → map-tiles → malaga/zones.geojson\n"
        )
        # Save locally so user can upload manually
        out = Path("zones.geojson")
        out.write_bytes(geojson_bytes)
        print(f"  GeoJSON saved locally to {out.resolve()} ({len(geojson_bytes):,} bytes)")
        return

    client = create_client(supabase_url, service_key)

    # Ensure bucket exists (public = True so MapLibre CDN fetch works without auth)
    try:
        client.storage.create_bucket(STORAGE_BUCKET, options={"public": True})
    except Exception:
        pass  # bucket already exists

    # Remove old file if present (supabase-py v2 upsert option)
    try:
        client.storage.from_(STORAGE_BUCKET).remove([STORAGE_PATH])
    except Exception:
        pass  # file doesn't exist yet — that's fine

    print(f"  Uploading {len(geojson_bytes):,} bytes to {STORAGE_BUCKET}/{STORAGE_PATH}…", end=" ", flush=True)
    client.storage.from_(STORAGE_BUCKET).upload(
        path=STORAGE_PATH,
        file=geojson_bytes,
        file_options={
            "content-type":  "application/geo+json",
            "cache-control": "86400",
        },
    )
    print("done ✓")
    print(f"\n  CDN URL: {supabase_url}/storage/v1/object/public/{STORAGE_BUCKET}/{STORAGE_PATH}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Ingest Málaga postcode boundaries → postal_zones → zone_scores → CDN tile"
    )
    parser.add_argument("--dry-run",     action="store_true", help="Fetch OSM data but write nothing")
    parser.add_argument("--verify",      action="store_true", help="Print row counts and exit")
    parser.add_argument("--no-upload",   action="store_true", help="Skip Supabase Storage upload")
    parser.add_argument("--export-only", action="store_true", help="Skip ingest; refresh + export only")
    parser.add_argument("--malaga-only", action="store_true",
                        help="Restrict to city postcodes 29001–29017 only (default: all Málaga municipality)")
    parser.add_argument("--shapefile",          metavar="PATH",
                        help="Load boundaries from a local Correos/CartoCiudad SHP file instead of OSM Overpass")
    parser.add_argument("--fetch-cartociudad", action="store_true",
                        help="Fetch official postcode polygons from CartoCiudad WFS (IGN) — no download needed")
    args = parser.parse_args()

    conn = get_conn()

    # --verify: just print counts and exit
    if args.verify:
        verify(conn)
        conn.close()
        return

    # --export-only: skip ingest, just refresh + export + upload
    if not args.export_only:

        if args.fetch_cartociudad:
            # ---- CartoCiudad WFS path: no download needed ----
            print("\n[1/5] Fetching official postcode polygons from CartoCiudad WFS (IGN)…")
            features = fetch_cartociudad_wfs(args.malaga_only)
            print(f"\n[2/5] (Skipped — WFS GeoJSON used directly, no osm2geojson needed)")
        elif args.shapefile:
            # ---- Shapefile path: skip Overpass + Nominatim ----
            print(f"\n[1/5] Loading postcode boundaries from shapefile: {args.shapefile}")
            features = load_from_shapefile(args.shapefile, args.malaga_only)
            print(f"\n[2/5] (Skipped — shapefile used instead of osm2geojson reconstruction)")
        else:
            # ---- OSM path: Overpass + Nominatim ----
            print("\n[1/5] Fetching postcode boundaries from OpenStreetMap Overpass…")
            query = build_query_by_area()
            raw = fetch_overpass(query)

            print("\n[2/5] Reconstructing MultiPolygon geometries with osm2geojson…")
            features = osm_to_features(raw)

            # Always try Nominatim for any missing city postcodes (29001–29017).
            # This is a best-effort supplement to Overpass — OSM coverage is sparse
            # for Málaga city center postal codes.
            features = fill_missing_from_nominatim(features)
            print(f"\n  Total: {len(features)} postcode features after Overpass + Nominatim")

            if args.malaga_only:
                found_city = {f["codigo_postal"] for f in features} & MALAGA_CITY_POSTCODES
                missing = MALAGA_CITY_POSTCODES - found_city
                if missing:
                    print(f"  ⚠  Still missing city postcodes: {sorted(missing)}")

        if args.dry_run:
            print(f"\n[dry-run] Would upsert {len(features)} postcodes. Exiting without DB write.")
            conn.close()
            return

        # ---- Step 3: upsert into postal_zones ----
        print(f"\n[3/5] Upserting {len(features)} postcodes into postal_zones…")
        n = ingest_features(conn, features, args.malaga_only)
        print(f"  ✓ {n} rows upserted")

        # ---- Step 4: compute centroids ----
        print("\n[4/5] Computing centroids (ST_Centroid)…")
        updated = compute_centroids(conn)
        print(f"  ✓ {updated} centroids computed")

    # ---- Step 5: refresh zone_scores ----
    print("\n[5/5] Refreshing zone_scores materialised view…")
    # Re-fetch conn in case it went idle during long Overpass fetch
    try:
        refresh_zone_scores(conn)
    except Exception as e:
        print(f"  Connection may have dropped — reconnecting: {e}")
        conn = get_conn()
        refresh_zone_scores(conn)

    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM zone_scores WHERE zone_tvi IS NOT NULL")
        scored = cur.fetchone()[0]
    print(f"  ✓ zone_scores populated: {scored} postcodes with zone_tvi")

    if scored == 0:
        print("\n  ⚠  zone_scores has 0 scored rows. Likely causes:")
        print("     - postal_zones is empty (ingest did not find OSM boundaries)")
        print("     - Required QoL tables (schools, health_centres, etc.) are empty")
        print("     Run: python ingest_postal_zones.py --verify")
        conn.close()
        return

    # ---- Step 6: export + upload GeoJSON tile ----
    print("\n[6/6] Exporting GeoJSON tile from PostGIS…")
    if args.malaga_only:
        print("  --malaga-only: exporting 29001–29017 only (outer province zones excluded)")
    geojson_bytes = export_geojson(conn, malaga_only=args.malaga_only)
    n_exported = geojson_bytes.count(b'"codigo_postal"')
    print(f"  {len(geojson_bytes):,} bytes, {n_exported} features")

    conn.close()

    if args.no_upload:
        out = Path("zones.geojson")
        out.write_bytes(geojson_bytes)
        print(f"  --no-upload: saved locally to {out.resolve()}")
        print("  Upload manually to Supabase Storage → map-tiles/malaga/zones.geojson")
    else:
        upload_to_storage(geojson_bytes)

    print("\n✅ Done. Open /map to see the choropleth.")


if __name__ == "__main__":
    main()
