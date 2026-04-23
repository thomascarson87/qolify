#!/usr/bin/env python3
"""
Ingest postal-zone polygons into `postal_zones` from a CartoCiudad Callejero
GeoPackage (one provincia per file, e.g. malaga.gpkg).

Why this script exists
----------------------
CartoCiudad Callejero ships address *points* (`portalpk_publi`) with a
`cod_postal` column, not CP boundary polygons. The companion
`ingest_postal_zones.py` expects polygons, so it can't consume this file.
This script builds per-CP polygons server-side with `ST_ConcaveHull` so
property → CP attribution (the only thing indicators actually need) is
driven by authoritative IGN data instead of spotty OSM.

Pipeline
--------
  1. Read points from the .gpkg (stdlib sqlite3 — no geopandas needed).
  2. COPY them into a server-side temp table as WGS84 points.
  3. Per CP, build ST_ConcaveHull(points, 0.85) and ST_PointOnSurface centroid.
  4. DELETE existing rows in the provincias we're loading, INSERT new ones.
  5. Verify: row count, centroids-inside-polygons, Spain bbox guard.

Usage
-----
  python3 ingest_postal_zones_cartociudad.py /path/to/malaga.gpkg
  python3 ingest_postal_zones_cartociudad.py /path/to/malaga.gpkg --dry-run
  python3 ingest_postal_zones_cartociudad.py /path/to/malaga.gpkg --hull-target 0.9
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

from _db import get_conn

# Spain bbox guard (shared with CHI-410 ingest). Any centroid outside this
# rectangle is rejected — catches foreign CP contamination or bad geoms.
SPAIN_BBOX = (-18.5, 27.0, 4.5, 44.0)  # (min_lon, min_lat, max_lon, max_lat)


def read_points(gpkg_path: Path) -> tuple[list[tuple], list[str], str]:
    """
    Return (rows, provincias, provincia_label).
    rows = [(cod_postal, municipio, lon, lat), ...]
    provincias = distinct provincia names found in the file.
    provincia_label = comma-joined provincias, for logging.
    """
    conn = sqlite3.connect(str(gpkg_path))
    cur = conn.cursor()

    # Sanity: fail fast if this isn't a CartoCiudad Callejero file.
    tables = {r[0] for r in cur.execute(
        "SELECT table_name FROM gpkg_contents"
    ).fetchall()}
    if "portalpk_publi" not in tables:
        raise SystemExit(
            f"ERROR: {gpkg_path.name} does not contain 'portalpk_publi'. "
            "Is this a CartoCiudad Callejero file?"
        )

    # GeoPackage stores geometry in a custom header followed by WKB. For
    # POINT layers the coordinates live at a fixed offset after the header,
    # but extracting them by hand is fragile. Instead, use the gpkg's own
    # extension helper: cod_postal is already in columns, and portalpk_publi
    # is EPSG:4258 (ETRS89) which is ~equivalent to WGS84 for our purposes
    # (datum shift < 1m). We read the WKB and parse the POINT bytes inline.
    rows: list[tuple] = []
    provincias: set[str] = set()

    cur.execute("""
        SELECT cod_postal, municipio, provincia, geom
        FROM portalpk_publi
        WHERE cod_postal IS NOT NULL
          AND cod_postal != ''
          AND geom IS NOT NULL
    """)

    for cod_postal, municipio, provincia, geom_blob in cur:
        lon, lat = _parse_gpkg_point(geom_blob)
        if lon is None:
            continue
        rows.append((cod_postal.strip(), (municipio or "").strip(), lon, lat))
        if provincia:
            provincias.add(provincia.strip())

    conn.close()
    provincia_label = ", ".join(sorted(provincias)) or "(unknown)"
    return rows, sorted(provincias), provincia_label


def _parse_gpkg_point(blob: bytes) -> tuple[float | None, float | None]:
    """
    Parse a GeoPackage geometry blob for a POINT feature.

    Layout (GPKG spec, http://www.geopackage.org/spec/#gpb_format):
      bytes 0-1 : magic "GP"
      byte  2   : version (0)
      byte  3   : flags   (bit 0 = endianness of ENVELOPE + header ints,
                           bits 1-3 = envelope type: 0=no envelope,
                           1=xy, 2=xyz, 3=xym, 4=xyzm)
      bytes 4-7 : srs_id (int32, endianness per flag)
      then ENVELOPE (8 * N doubles, N=0,4,6,6,8 for envelope types above)
      then STANDARD WKB (byte order + type + coords)

    For our purposes we only need to skip the envelope and read the WKB
    POINT coordinates that follow.
    """
    if not blob or len(blob) < 8 or blob[:2] != b"GP":
        return None, None
    flags = blob[3]
    envelope_type = (flags >> 1) & 0x07
    envelope_sizes = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}
    if envelope_type not in envelope_sizes:
        return None, None
    wkb_start = 8 + envelope_sizes[envelope_type]
    wkb = blob[wkb_start:]
    if len(wkb) < 21:
        return None, None
    import struct
    endian = "<" if wkb[0] == 1 else ">"
    geom_type = struct.unpack(endian + "I", wkb[1:5])[0]
    # WKB POINT types: 1 (2D), 1001 (Z), 2001 (M), 3001 (ZM).
    if geom_type not in (1, 1001, 2001, 3001):
        return None, None
    lon, lat = struct.unpack(endian + "dd", wkb[5:21])
    return lon, lat


def ingest(
    rows: list[tuple],
    provincias: list[str],
    hull_target: float,
    dry_run: bool,
) -> None:
    """Load points into Postgres and build per-CP polygons."""
    if not rows:
        raise SystemExit("No rows to ingest — aborting.")

    distinct_cps = {r[0] for r in rows}
    print(f"Read {len(rows):,} points across {len(distinct_cps)} CPs.")

    if dry_run:
        print("--dry-run: skipping DB writes.")
        return

    conn = get_conn()
    conn.autocommit = False
    cur = conn.cursor()

    try:
        print("Creating temp table _cc_points …")
        cur.execute("""
            CREATE TEMP TABLE _cc_points (
                cod_postal   TEXT NOT NULL,
                municipio    TEXT,
                geom         GEOMETRY(POINT, 4326) NOT NULL
            ) ON COMMIT DROP
        """)

        print(f"Streaming {len(rows):,} points via COPY …")
        # COPY is ~10x faster than executemany for bulk geometry loads.
        from io import StringIO
        buf = StringIO()
        for cp, mun, lon, lat in rows:
            # TSV: cod_postal \t municipio \t EWKT-ish point (SRID=4326)
            mun_escaped = (mun or "").replace("\t", " ").replace("\n", " ")
            buf.write(f"{cp}\t{mun_escaped}\tSRID=4326;POINT({lon} {lat})\n")
        buf.seek(0)
        cur.copy_expert(
            "COPY _cc_points (cod_postal, municipio, geom) FROM STDIN",
            buf,
        )
        print(f"  loaded {cur.rowcount:,} rows.")

        print("Building per-CP hulls + centroids …")
        # Pick the mode municipio per CP (some CPs straddle >1 municipio).
        # ST_ConcaveHull with param_pctconvex close to 1.0 is loose; 0.85 gives
        # a tight but still point-containing shape. allow_holes=true keeps
        # disjoint clusters from being force-merged with artifacts.
        cur.execute(f"""
            CREATE TEMP TABLE _cc_hulls AS
            WITH mun_mode AS (
              SELECT cod_postal, municipio, COUNT(*) AS n,
                     ROW_NUMBER() OVER (
                       PARTITION BY cod_postal
                       ORDER BY COUNT(*) DESC, municipio
                     ) AS rk
              FROM _cc_points
              GROUP BY cod_postal, municipio
            ),
            hulls AS (
              SELECT cod_postal,
                     ST_ConcaveHull(ST_Collect(geom), {hull_target}, true)
                       AS geom
              FROM _cc_points
              GROUP BY cod_postal
            )
            SELECT h.cod_postal,
                   m.municipio,
                   ST_Multi(h.geom) AS geom,
                   ST_PointOnSurface(h.geom) AS centroid
            FROM hulls h
            LEFT JOIN mun_mode m
              ON m.cod_postal = h.cod_postal AND m.rk = 1
        """)
        hull_count = cur.execute(
            "SELECT COUNT(*) FROM _cc_hulls"
        ) or cur.rowcount
        cur.execute("SELECT COUNT(*) FROM _cc_hulls")
        print(f"  built {cur.fetchone()[0]} hulls.")

        # Spain bbox guard — reject any centroid outside Spain's rectangle.
        cur.execute(f"""
            SELECT COUNT(*) FROM _cc_hulls
            WHERE NOT (
              ST_X(centroid) BETWEEN {SPAIN_BBOX[0]} AND {SPAIN_BBOX[2]}
              AND ST_Y(centroid) BETWEEN {SPAIN_BBOX[1]} AND {SPAIN_BBOX[3]}
            )
        """)
        bad = cur.fetchone()[0]
        if bad:
            raise SystemExit(
                f"ABORT: {bad} hull centroids fall outside Spain bbox. "
                "Refusing to pollute postal_zones."
            )

        # Delete existing rows for the provincia(s) we're replacing.
        # We scope by a CP prefix range (provincia = first 2 digits).
        prov_prefixes = sorted({r[0][:2] for r in rows})
        like_clauses = " OR ".join(["codigo_postal LIKE %s"] * len(prov_prefixes))
        params = [f"{p}%" for p in prov_prefixes]
        cur.execute(
            f"DELETE FROM postal_zones WHERE {like_clauses}", params
        )
        print(f"  deleted {cur.rowcount} existing rows in prefixes "
              f"{prov_prefixes}.")

        cur.execute("""
            INSERT INTO postal_zones (codigo_postal, municipio, geom, centroid)
            SELECT cod_postal, municipio, geom, centroid FROM _cc_hulls
        """)
        inserted = cur.rowcount
        print(f"  inserted {inserted} rows into postal_zones.")

        # Final sanity: every centroid must fall inside its own polygon.
        cur.execute("""
            SELECT COUNT(*) FROM postal_zones
            WHERE NOT ST_Contains(geom, centroid)
        """)
        orphaned = cur.fetchone()[0]
        if orphaned:
            raise SystemExit(
                f"ABORT: {orphaned} postal_zones rows have centroid outside "
                "their polygon. Rolling back."
            )

        conn.commit()
        print(f"DONE — {inserted} rows committed.")

    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("gpkg", type=Path,
                        help="Path to CartoCiudad Callejero .gpkg file")
    parser.add_argument("--hull-target", type=float, default=0.85,
                        help="ST_ConcaveHull param_pctconvex (0.0–1.0). "
                             "Lower = tighter fit. Default 0.85.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Parse the gpkg and report counts, no DB writes.")
    args = parser.parse_args()

    if not args.gpkg.exists():
        print(f"ERROR: {args.gpkg} does not exist.", file=sys.stderr)
        return 1

    rows, provincias, label = read_points(args.gpkg)
    print(f"Provincia(s) detected: {label}")
    ingest(rows, provincias, args.hull_target, args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
