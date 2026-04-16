from __future__ import annotations
#!/usr/bin/env python3
"""
Ingest EEA Strategic Noise Map polygons into the `noise_zones` table.

SOURCE
------
EEA END (Environmental Noise Directive) reporting data — 6th round (2022).
Spain's submission is available from the EEA Central Data Repository (CDR):

  https://cdr.eionet.europa.eu/es/eu/noise/

Specifically, look for 'Noise contour maps' data flows (DF7 / DF7a).
The data is provided as shapefiles or GeoPackage, typically named:
  ES_Lden_*.shp / ES_Lnight_*.shp   or
  ES_END_NoiseContours_2022.gpkg

NOTE: The exact download URL changes each reporting round. Confirm the
current URL at the CDR before running. Store it in DATA_SOURCES.md.

This script uses ogr2ogr to transform the source CRS
(ETRS89 EPSG:25830 for Spain) to WGS84 (EPSG:4326) and loads a staging
table, then Python classifies and inserts into noise_zones.

REQUIREMENTS
------------
  ogr2ogr  (from GDAL/OGR — install via: brew install gdal)
  psycopg2 (shared _db.py dependency)

USAGE
-----
  # Primary: load from a local file you have already downloaded
  python ingest_noise_zones.py --file /path/to/ES_END_Noise.gpkg

  # Specify the layer name if the GeoPackage has multiple layers
  python ingest_noise_zones.py --file /path/to/file.gpkg --layer Lden_roads

  # Specify source CRS if the file is not already in WGS84
  python ingest_noise_zones.py --file noise.shp --source-crs EPSG:25830

  # Dry-run: inspect field names and row counts, no DB writes
  python ingest_noise_zones.py --file noise.gpkg --dry-run

  # Override lden field names if the shapefile uses different column names
  python ingest_noise_zones.py --file noise.gpkg --field-db-low DB_Low --field-db-high DB_High

FIELD NAME VARIANTS
-------------------
The EEA shapefile field names for Lden bands are not fully standardised.
Known variants:
  db_low / DB_Low / lden_low / LDEN_LOW / db_lo / DB_LO
  db_high / DB_High / lden_high / LDEN_HIGH / db_hi / DB_HI
  noise_type / NOISE_TYPE / type_noise / TYPE / source_type

The script tries these in order and falls back to introspection if none match.
Use --field-db-low / --field-db-high / --field-noise-type to override.
"""
import argparse
import os
import subprocess
import sys
import tempfile
import time
import psycopg2
from _db import get_conn, execute_batch

# ── Known EEA field name variants (tried in order) ──────────────────────────

LDEN_LOW_CANDIDATES  = ["db_low",  "DB_Low",  "db_lo",  "DB_LO",  "lden_low",  "LDEN_LOW",  "dn_low",  "Lden_from"]
LDEN_HIGH_CANDIDATES = ["db_high", "DB_High", "db_hi",  "DB_HI",  "lden_high", "LDEN_HIGH", "dn_high", "Lden_to"]
NOISE_TYPE_CANDIDATES = ["noise_type", "NOISE_TYPE", "type_noise", "TYPE_NOISE",
                         "type", "TYPE", "source_type", "SOURCE_TYPE", "noisesource",
                         "NOISESOURCE", "noise_source", "NOISE_SOURCE"]

# ── Noise type classification ────────────────────────────────────────────────

# Maps EEA/CDR noise type codes → noise_zones.source_type check constraint values
NOISE_TYPE_MAP = {
    # Road variants
    "road": "road", "roads": "road", "lroad": "road",
    "major road": "road", "major roads": "road",
    "agglomeration road": "road", "agglo road": "road",
    "rd": "road", "r": "road",
    # Rail variants
    "rail": "rail", "railway": "rail", "railways": "rail",
    "major railway": "rail", "major railways": "rail",
    "lrail": "rail", "rw": "rail",
    # Airport variants
    "airport": "airport", "airports": "airport",
    "major airport": "airport", "laeroport": "airport",
    "ap": "airport", "air": "airport",
    # Industry variants
    "industry": "industry", "industrial": "industry",
    "major industrial": "industry",
}

DEFAULT_SOURCE_TYPE = "road"  # fallback if type field is absent or unrecognised


def classify_source_type(raw_value: str | None) -> str:
    if not raw_value:
        return DEFAULT_SOURCE_TYPE
    val = str(raw_value).strip().lower()
    return NOISE_TYPE_MAP.get(val, DEFAULT_SOURCE_TYPE)


# ── Lden band classification ─────────────────────────────────────────────────

def classify_lden_band(db_low: float | None, db_high: float | None) -> tuple[str, int, int | None]:
    """
    Return (lden_band, lden_min, lden_max) from raw dB values.

    EEA reports bands as: 55, 60, 65, 70, 75 (lower bounds).
    The 75+ band has no upper bound.

    Returns:
      lden_band  TEXT    e.g. '65-70'
      lden_min   INT     e.g. 65
      lden_max   INT|None e.g. 70 (or None for 75+)
    """
    if db_low is None:
        # Try to infer from db_high
        if db_high is not None:
            db_low = int(db_high) - 5
        else:
            return "55-60", 55, 60  # fallback

    low = int(db_low)

    if low >= 75:
        return "75+", 75, None
    elif low >= 70:
        return "70-75", 70, 75
    elif low >= 65:
        return "65-70", 65, 70
    elif low >= 60:
        return "60-65", 60, 65
    else:
        return "55-60", 55, 60


# ── ogr2ogr staging load ─────────────────────────────────────────────────────

STAGING_TABLE = "noise_zones_staging"


def ogr2ogr_to_staging(
    file_path: str,
    db_url: str,
    layer: str | None,
    source_crs: str | None,
) -> None:
    """
    Load a shapefile or GeoPackage into a PostGIS staging table using ogr2ogr.

    The staging table is overwritten on each run. It holds raw geometries
    and attributes; Python then classifies and inserts into noise_zones.

    Geometry is reprojected to EPSG:4326 (WGS84) during the ogr2ogr load.
    """
    cmd = [
        "ogr2ogr",
        "-f", "PostgreSQL",
        f"PG:{db_url}",
        file_path,
        "-nln", STAGING_TABLE,
        "-t_srs", "EPSG:4326",
        "-overwrite",
        "-progress",
    ]

    if layer:
        cmd.append(layer)

    if source_crs:
        cmd.extend(["-s_srs", source_crs])

    print(f"  Running ogr2ogr to load {os.path.basename(file_path)} into {STAGING_TABLE}...")
    print(f"  Command: {' '.join(cmd[:6])} ... (truncated)")

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if result.returncode != 0:
            print(f"  ogr2ogr stderr:\n{result.stderr[:2000]}")
            raise RuntimeError(f"ogr2ogr failed with exit code {result.returncode}")
        if result.stdout:
            print(f"  {result.stdout.strip()}")
    except FileNotFoundError:
        raise RuntimeError(
            "ogr2ogr not found. Install GDAL with:  brew install gdal"
        )


def introspect_staging(conn) -> dict:
    """
    Return the actual column names of the staging table.
    Used to auto-detect which variant of the lden/type field names is present.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = %s AND table_schema = 'public'
            ORDER BY ordinal_position
            """,
            (STAGING_TABLE,),
        )
        return {row[0].lower(): row[0] for row in cur.fetchall()}


def resolve_field(candidates: list[str], available: dict) -> str | None:
    """Find the first candidate field name that exists in the available columns."""
    for c in candidates:
        if c.lower() in available:
            return available[c.lower()]
    return None


# ── Staging → noise_zones transfer ──────────────────────────────────────────

INSERT_SQL = """
INSERT INTO noise_zones (
    geom, source_type, lden_band, lden_min, lden_max,
    source, agglomeration, updated_at
)
VALUES (
    %(geom_wkt)s::GEOGRAPHY,
    %(source_type)s,
    %(lden_band)s,
    %(lden_min)s,
    %(lden_max)s,
    %(source)s,
    %(agglomeration)s,
    NOW()
)
"""


def transfer_staging_to_noise_zones(
    conn,
    col_db_low: str | None,
    col_db_high: str | None,
    col_noise_type: str | None,
    col_agglomeration: str | None,
    source: str,
    dry_run: bool,
) -> int:
    """
    Read rows from staging table, classify them, and insert into noise_zones.

    Returns number of rows processed.
    """
    # Build the SELECT for the staging table
    select_cols = ["ST_AsText(ST_ForceCollection(wkb_geometry)) AS geom_wkt"]
    if col_db_low:
        select_cols.append(f'"{col_db_low}" AS db_low')
    if col_db_high:
        select_cols.append(f'"{col_db_high}" AS db_high')
    if col_noise_type:
        select_cols.append(f'"{col_noise_type}" AS noise_type')
    if col_agglomeration:
        select_cols.append(f'"{col_agglomeration}" AS agglomeration')

    query = f'SELECT {", ".join(select_cols)} FROM "{STAGING_TABLE}"'

    with conn.cursor() as cur:
        cur.execute(f'SELECT COUNT(*) FROM "{STAGING_TABLE}"')
        total = cur.fetchone()[0]

    if dry_run:
        print(f"  [dry-run] Staging table has {total:,} rows. Would classify and insert into noise_zones.")
        _inspect_staging_sample(conn, query, col_db_low, col_db_high, col_noise_type)
        return total

    print(f"  Processing {total:,} staging rows...")

    records = []
    batch_size = 500
    inserted = 0

    with conn.cursor() as cur:
        cur.execute(query)

        while True:
            rows = cur.fetchmany(batch_size)
            if not rows:
                break

            for row in rows:
                row_dict = {}
                idx = 0
                row_dict["geom_wkt"] = row[idx]; idx += 1
                if col_db_low:
                    row_dict["db_low"] = row[idx]; idx += 1
                if col_db_high:
                    row_dict["db_high"] = row[idx]; idx += 1
                if col_noise_type:
                    row_dict["noise_type"] = row[idx]; idx += 1
                if col_agglomeration:
                    row_dict["agglomeration"] = row[idx]; idx += 1

                # Skip rows with no geometry
                if not row_dict.get("geom_wkt"):
                    continue

                lden_band, lden_min, lden_max = classify_lden_band(
                    row_dict.get("db_low"), row_dict.get("db_high")
                )

                records.append({
                    "geom_wkt":     row_dict["geom_wkt"],
                    "source_type":  classify_source_type(row_dict.get("noise_type")),
                    "lden_band":    lden_band,
                    "lden_min":     lden_min,
                    "lden_max":     lden_max,
                    "source":       source,
                    "agglomeration": row_dict.get("agglomeration"),
                })

                if len(records) >= batch_size:
                    conn = execute_batch(conn, INSERT_SQL, records)
                    inserted += len(records)
                    records = []
                    print(f"  {inserted:,}/{total:,} rows inserted...", end="\r")

    if records:
        conn = execute_batch(conn, INSERT_SQL, records)
        inserted += len(records)

    print(f"  {inserted:,}/{total:,} rows inserted.          ")
    return inserted


def _inspect_staging_sample(conn, query, col_db_low, col_db_high, col_noise_type) -> None:
    """Print a sample of staging rows to help diagnose field mapping."""
    with conn.cursor() as cur:
        cur.execute(query + " LIMIT 5")
        rows = cur.fetchall()
    print("  Sample staging rows (first 5):")
    for row in rows:
        print(f"    {row}")


def drop_staging_table(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(f'DROP TABLE IF EXISTS "{STAGING_TABLE}"')
    conn.commit()
    print(f"  Staging table {STAGING_TABLE} dropped.")


def refresh_enrichment_view(conn) -> None:
    print("→ Refreshing zone_enrichment_scores...", end=" ", flush=True)
    try:
        with conn.cursor() as cur:
            cur.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY zone_enrichment_scores")
        conn.commit()
        print("done")
    except Exception as e:
        conn.rollback()
        print(f"WARNING: refresh failed ({e}). Nightly pg_cron will refresh it.")


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description=(
            "Ingest EEA Strategic Noise Map polygons into the noise_zones table.\n"
            "Requires a locally downloaded shapefile or GeoPackage from the EEA CDR.\n"
            "  Source: https://cdr.eionet.europa.eu/es/eu/noise/"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--file",
        required=True,
        metavar="PATH",
        help="Path to EEA noise shapefile (.shp) or GeoPackage (.gpkg)",
    )
    parser.add_argument(
        "--layer",
        metavar="NAME",
        help="Layer name inside a GeoPackage (omit to use the first/only layer)",
    )
    parser.add_argument(
        "--source-crs",
        metavar="EPSG:NNNN",
        default=None,
        help=(
            "Source CRS of the input file if not WGS84. "
            "Spain's data is typically EPSG:25830 (ETRS89 / UTM zone 30N). "
            "Omit if the file already contains CRS metadata."
        ),
    )
    parser.add_argument(
        "--source",
        default="eea",
        choices=["eea", "enaire", "mitma"],
        help="Data source identifier stored in the source column (default: eea)",
    )
    parser.add_argument(
        "--field-db-low",
        metavar="COL",
        help=f"Column name for Lden lower bound. Auto-detected if omitted. Known variants: {LDEN_LOW_CANDIDATES[:3]}",
    )
    parser.add_argument(
        "--field-db-high",
        metavar="COL",
        help="Column name for Lden upper bound. Auto-detected if omitted.",
    )
    parser.add_argument(
        "--field-noise-type",
        metavar="COL",
        help="Column name for noise source type (road/rail/airport). Auto-detected if omitted.",
    )
    parser.add_argument(
        "--field-agglomeration",
        metavar="COL",
        help="Column name for agglomeration name. Auto-detected if omitted.",
    )
    parser.add_argument(
        "--keep-staging",
        action="store_true",
        help="Keep the staging table after load (useful for debugging field names)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Load staging table and inspect, but do not write to noise_zones",
    )
    args = parser.parse_args()

    if not os.path.exists(args.file):
        print(f"ERROR: File not found: {args.file}", file=sys.stderr)
        sys.exit(1)

    # Get DB URL for ogr2ogr (needs raw connection string, not psycopg2)
    import os as _os
    db_url = _os.environ.get("DATABASE_URL_POOLER") or _os.environ.get("DATABASE_URL")
    if not db_url:
        print("ERROR: DATABASE_URL or DATABASE_URL_POOLER not set.", file=sys.stderr)
        sys.exit(1)

    # Step 1: ogr2ogr → staging table
    print(f"\n→ [Step 1/4] Loading {os.path.basename(args.file)} into staging table...")
    ogr2ogr_to_staging(args.file, db_url, args.layer, args.source_crs)
    print("  ogr2ogr complete.")

    # Step 2: Introspect staging table to resolve field names
    conn = get_conn()
    print("\n→ [Step 2/4] Detecting field names in staging table...")
    available = introspect_staging(conn)
    print(f"  Available columns: {list(available.keys())[:20]}")

    col_db_low   = args.field_db_low   or resolve_field(LDEN_LOW_CANDIDATES,   available)
    col_db_high  = args.field_db_high  or resolve_field(LDEN_HIGH_CANDIDATES,  available)
    col_noise_type = args.field_noise_type or resolve_field(NOISE_TYPE_CANDIDATES, available)
    # Common agglomeration field names
    col_agglomeration = (
        args.field_agglomeration
        or resolve_field(["agglomeration", "AGGLOMERATION", "agglo", "AGGLO",
                          "city", "municipality", "urban_area"], available)
    )

    print(f"  lden_low field:    {col_db_low or '(not found — all rows will use 55-60 fallback)'}")
    print(f"  lden_high field:   {col_db_high or '(not found)'}")
    print(f"  noise_type field:  {col_noise_type or '(not found — source_type defaults to road)'}")
    print(f"  agglomeration field: {col_agglomeration or '(not found — will be NULL)'}")

    if not col_db_low and not col_db_high:
        print(
            "\n  WARNING: No Lden dB field found. All rows will be assigned band '55-60'.\n"
            "  Use --field-db-low to specify the correct column name.\n"
            f"  Run with --dry-run --keep-staging to inspect available columns."
        )

    # Step 3: Transfer staging → noise_zones
    print("\n→ [Step 3/4] Classifying and inserting into noise_zones...")
    inserted = transfer_staging_to_noise_zones(
        conn,
        col_db_low=col_db_low,
        col_db_high=col_db_high,
        col_noise_type=col_noise_type,
        col_agglomeration=col_agglomeration,
        source=args.source,
        dry_run=args.dry_run,
    )

    # Step 4: Cleanup and refresh
    print("\n→ [Step 4/4] Cleanup...")
    if not args.keep_staging and not args.dry_run:
        drop_staging_table(conn)

    if not args.dry_run:
        refresh_enrichment_view(conn)

    conn.close()

    print(f"\n✓ Done. {inserted:,} noise zone polygons processed.")

    if not args.dry_run:
        if inserted < 1000:
            print(
                f"\n  Warning: {inserted:,} rows is lower than the expected 5,000–15,000 nationally.\n"
                "  Check that the source file covers all noise source types (road, rail, airport).\n"
                "  EEA data is often split into separate files per source type — run once per file."
            )
        else:
            print(f"  Row count {inserted:,} is within expected range (5,000–15,000).")


if __name__ == "__main__":
    main()
