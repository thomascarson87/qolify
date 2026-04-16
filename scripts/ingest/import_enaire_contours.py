from __future__ import annotations
#!/usr/bin/env python3
"""
Import ENAIRE airport noise contours from a local GeoJSON file into noise_zones.

ENAIRE publishes noise contour maps per airport in PDF and GIS formats:
  https://www.enaire.es/servicios/medio_ambiente/mapas_de_ruido

The GIS data must be requested from ENAIRE or extracted from their PDF maps
using a GIS tool (e.g. QGIS → Export → GeoJSON). ENAIRE does not provide
an automated download API.

Priority airports for Qolify (expat markets):
  AGP — Málaga-Costa del Sol
  PMI — Palma de Mallorca
  ALC — Alicante-Elche
  BCN — Barcelona El Prat
  MAD — Madrid Adolfo Suárez (Barajas)

USAGE
-----
  # Import contours for Málaga airport
  python import_enaire_contours.py \\
    --geojson /path/to/agp_noise_contours.geojson \\
    --airport AGP

  # Dry run to preview
  python import_enaire_contours.py \\
    --geojson /path/to/agp_noise_contours.geojson \\
    --airport AGP --dry-run

GEOJSON FORMAT
--------------
The GeoJSON file should contain Polygon or MultiPolygon features.
Each feature should have properties that include the Lden dB level.

Recognised property names for the dB level:
  lden, Lden, LDEN, db, dB, DB, noise_level, level, value,
  lden_low, lden_min, db_low, db_lo

If none of these are present, the script will list available properties
and ask you to specify with --field-lden.

The script assigns source_type='airport' and source='enaire' automatically.
"""
import argparse
import json
import sys
from _db import get_conn, execute_batch

# ── IATA codes for the priority airports ────────────────────────────────────

AIRPORT_NAMES = {
    "AGP": "Málaga-Costa del Sol",
    "PMI": "Palma de Mallorca",
    "ALC": "Alicante-Elche",
    "BCN": "Barcelona El Prat",
    "MAD": "Madrid Adolfo Suárez (Barajas)",
    "SVQ": "Sevilla",
    "VLC": "Valencia",
    "TFN": "Tenerife Norte",
    "TFS": "Tenerife Sur",
    "LPA": "Gran Canaria",
    "IBZ": "Ibiza",
    "MAH": "Menorca",
}

# ── Lden dB property name detection ─────────────────────────────────────────

LDEN_PROP_CANDIDATES = [
    "lden", "Lden", "LDEN",
    "db", "dB", "DB",
    "noise_level", "noise_db", "level",
    "lden_low", "lden_min", "db_low", "db_lo",
    "value", "contour_db",
]


def detect_lden_field(properties: dict) -> str | None:
    """Return the first recognised Lden dB property name present in `properties`."""
    prop_lower = {k.lower(): k for k in properties}
    for c in LDEN_PROP_CANDIDATES:
        if c.lower() in prop_lower:
            return prop_lower[c.lower()]
    return None


# ── Lden band classification ─────────────────────────────────────────────────

def classify_lden_band(db_value: float | None) -> tuple[str, int, int | None]:
    """Return (lden_band, lden_min, lden_max) from a raw dB Lden value."""
    if db_value is None:
        return "55-60", 55, 60
    try:
        val = int(float(db_value))
    except (ValueError, TypeError):
        return "55-60", 55, 60

    if val >= 75:
        return "75+", 75, None
    elif val >= 70:
        return "70-75", 70, 75
    elif val >= 65:
        return "65-70", 65, 70
    elif val >= 60:
        return "60-65", 60, 65
    else:
        return "55-60", 55, 60


# ── GeoJSON parsing ──────────────────────────────────────────────────────────

def geojson_to_records(
    geojson_path: str,
    airport_iata: str,
    lden_field: str | None,
) -> list[dict]:
    """
    Parse a GeoJSON file into noise_zones records.

    Geometry is expected to be Polygon or MultiPolygon in WGS84.
    Converts to EWKT for PostGIS insertion.
    """
    with open(geojson_path, encoding="utf-8") as f:
        data = json.load(f)

    features = data.get("features", [])
    if not features:
        raise ValueError("GeoJSON has no features.")

    # Auto-detect lden field from first feature if not specified
    if not lden_field:
        first_props = features[0].get("properties") or {}
        lden_field = detect_lden_field(first_props)
        if lden_field:
            print(f"  Auto-detected Lden field: '{lden_field}'")
        else:
            available = list((features[0].get("properties") or {}).keys())
            print(f"\n  Could not detect Lden dB field automatically.")
            print(f"  Available properties in first feature: {available}")
            print(f"  Re-run with --field-lden <field_name>")
            sys.exit(1)

    airport_name = AIRPORT_NAMES.get(airport_iata.upper(), airport_iata)
    records = []
    skipped = 0

    for feature in features:
        geom = feature.get("geometry")
        props = feature.get("properties") or {}

        if not geom:
            skipped += 1
            continue

        geom_type = geom.get("type")
        if geom_type not in ("Polygon", "MultiPolygon"):
            skipped += 1
            continue

        # Convert GeoJSON geometry to WKT for PostGIS
        # PostGIS expects MULTIPOLYGON for the noise_zones.geom column
        wkt = geojson_geom_to_wkt(geom)
        if not wkt:
            skipped += 1
            continue

        db_value = props.get(lden_field)
        lden_band, lden_min, lden_max = classify_lden_band(db_value)

        records.append({
            "geom_wkt":     f"SRID=4326;{wkt}",
            "source_type":  "airport",
            "lden_band":    lden_band,
            "lden_min":     lden_min,
            "lden_max":     lden_max,
            "source":       "enaire",
            "agglomeration": airport_name,
        })

    if skipped:
        print(f"  Skipped {skipped} features (no geometry or unsupported type)")

    return records


def geojson_geom_to_wkt(geom: dict) -> str | None:
    """
    Convert a GeoJSON geometry dict to WKT MULTIPOLYGON string.
    PostGIS noise_zones.geom is GEOGRAPHY(MULTIPOLYGON, 4326).
    """
    def ring_wkt(ring: list) -> str:
        return "(" + ", ".join(f"{coord[0]} {coord[1]}" for coord in ring) + ")"

    def polygon_wkt(coords: list) -> str:
        return "(" + ", ".join(ring_wkt(ring) for ring in coords) + ")"

    geom_type = geom.get("type")
    coords = geom.get("coordinates")

    if not coords:
        return None

    if geom_type == "Polygon":
        return f"MULTIPOLYGON({polygon_wkt(coords)})"

    elif geom_type == "MultiPolygon":
        parts = ", ".join(polygon_wkt(poly) for poly in coords)
        return f"MULTIPOLYGON({parts})"

    return None


# ── DB write ─────────────────────────────────────────────────────────────────

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


def refresh_enrichment_view(conn) -> None:
    print("→ Refreshing zone_enrichment_scores...", end=" ", flush=True)
    try:
        with conn.cursor() as cur:
            cur.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY zone_enrichment_scores")
        conn.commit()
        print("done")
    except Exception as e:
        conn.rollback()
        print(f"WARNING: refresh failed ({e}). Nightly pg_cron will handle it.")


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description=(
            "Import ENAIRE airport noise contours from a local GeoJSON into noise_zones.\n"
            "  Source: https://www.enaire.es/servicios/medio_ambiente/mapas_de_ruido"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--geojson",
        required=True,
        metavar="PATH",
        help="Path to local GeoJSON file containing airport noise contours",
    )
    parser.add_argument(
        "--airport",
        required=True,
        metavar="IATA",
        help=f"Airport IATA code. Priority: {', '.join(AIRPORT_NAMES.keys())}",
    )
    parser.add_argument(
        "--field-lden",
        metavar="FIELD",
        help="GeoJSON property name containing the Lden dB value. Auto-detected if omitted.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse file and count records but do not write to DB",
    )
    args = parser.parse_args()

    import os
    if not os.path.exists(args.geojson):
        print(f"ERROR: File not found: {args.geojson}", file=sys.stderr)
        sys.exit(1)

    airport = args.airport.upper()
    airport_label = AIRPORT_NAMES.get(airport, airport)
    print(f"\n→ Importing ENAIRE noise contours for {airport} ({airport_label})")

    # Parse GeoJSON
    print(f"→ Parsing {os.path.basename(args.geojson)}...")
    records = geojson_to_records(args.geojson, airport, args.field_lden)
    print(f"  Parsed {len(records)} contour features")

    if not records:
        print("No valid features found. Check the GeoJSON geometry types.")
        sys.exit(0)

    # Summary of bands found
    from collections import Counter
    band_counts = Counter(r["lden_band"] for r in records)
    print(f"  Lden bands: {dict(band_counts)}")

    if args.dry_run:
        print(f"\n  [dry-run] Would insert {len(records)} rows into noise_zones.")
        print("  Sample record:")
        r = records[0]
        for k, v in r.items():
            if k == "geom_wkt":
                print(f"    geom_wkt: {str(v)[:80]}...")
            else:
                print(f"    {k}: {v}")
        sys.exit(0)

    # Write to DB
    conn = get_conn()
    print(f"\n→ Inserting {len(records)} rows into noise_zones...")
    execute_batch(conn, INSERT_SQL, records)
    print(f"  Inserted {len(records)} airport noise contours for {airport}.")

    refresh_enrichment_view(conn)
    conn.close()

    print(f"\n✓ Done. {airport} ({airport_label}) noise contours loaded.")
    print(
        "\nRemaining priority airports to load:\n"
        + "\n".join(
            f"  {iata} — {name}"
            for iata, name in AIRPORT_NAMES.items()
            if iata != airport
        )
    )


if __name__ == "__main__":
    main()
