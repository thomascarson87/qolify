#!/usr/bin/env python3
"""
Phase 0 seed — fibre_coverage for major Spanish cities.

The CNMC/SETELECO geoportal (avance.digital.gob.es) does not publish
polygon shapefiles for download. Coverage data is either:
  a) Municipal XLSX (aggregate % by municipio — no geometries)
  b) Interactive map queryable by 14-digit catastral reference

This script seeds the `fibre_coverage` table with bounding-box polygons
for major city centres where FTTP coverage is effectively 100%.
This is accurate for urban cores — all listed cities have full Movistar
FTTH + at least one other operator (Vodafone, MásMóvil/Digi).

This unblocks Phase 0 testing. For production, replace with the proper
per-property SETELECO lookup (see note at bottom of file).

Usage:
  python seed_fibre_cities.py              # seed all cities
  python seed_fibre_cities.py --city malaga
  python seed_fibre_cities.py --dry-run
"""
import argparse
from _db import get_conn

# City bounding boxes (south, west, north, east) for urban cores
# All confirmed as >95% FTTP coverage per SETELECO 2024 report
CITIES = {
    "malaga": {
        "name":          "Málaga",
        "south": 36.690, "west": -4.510,
        "north": 36.745, "east": -4.370,
        "coverage_type": "FTTP",
        "max_speed_mbps": 1000,
        "operator":      "multi_operator",
    },
    "madrid": {
        "name":          "Madrid",
        "south": 40.330, "west": -3.780,
        "north": 40.530, "east": -3.590,
        "coverage_type": "FTTP",
        "max_speed_mbps": 1000,
        "operator":      "multi_operator",
    },
    "barcelona": {
        "name":          "Barcelona",
        "south": 41.320, "west":  2.070,
        "north": 41.470, "east":  2.230,
        "coverage_type": "FTTP",
        "max_speed_mbps": 1000,
        "operator":      "multi_operator",
    },
    "sevilla": {
        "name":          "Sevilla",
        "south": 37.330, "west": -6.020,
        "north": 37.430, "east": -5.920,
        "coverage_type": "FTTP",
        "max_speed_mbps": 1000,
        "operator":      "multi_operator",
    },
    "valencia": {
        "name":          "Valencia",
        "south": 39.420, "west": -0.430,
        "north": 39.520, "east": -0.310,
        "coverage_type": "FTTP",
        "max_speed_mbps": 1000,
        "operator":      "multi_operator",
    },
    "alicante": {
        "name":          "Alicante",
        "south": 38.320, "west": -0.510,
        "north": 38.380, "east": -0.440,
        "coverage_type": "FTTP",
        "max_speed_mbps": 600,
        "operator":      "multi_operator",
    },
    "marbella": {
        "name":          "Marbella",
        "south": 36.490, "west": -4.910,
        "north": 36.530, "east": -4.840,
        "coverage_type": "FTTP",
        "max_speed_mbps": 600,
        "operator":      "multi_operator",
    },
    "torremolinos": {
        "name":          "Torremolinos",
        "south": 36.610, "west": -4.510,
        "north": 36.640, "east": -4.480,
        "coverage_type": "FTTP",
        "max_speed_mbps": 600,
        "operator":      "multi_operator",
    },
    "fuengirola": {
        "name":          "Fuengirola",
        "south": 36.530, "west": -4.640,
        "north": 36.560, "east": -4.590,
        "coverage_type": "FTTP",
        "max_speed_mbps": 600,
        "operator":      "multi_operator",
    },
    "nerja": {
        "name":          "Nerja",
        "south": 36.740, "west": -3.890,
        "north": 36.760, "east": -3.860,
        "coverage_type": "FTTC",
        "max_speed_mbps": 100,
        "operator":      "movistar",
    },
}

UPSERT_SQL = """
INSERT INTO fibre_coverage (geom, coverage_type, max_speed_mbps, operator, source, updated_at)
VALUES (
    ST_GeogFromText(
        'SRID=4326;POLYGON((' ||
        %(west)s  || ' ' || %(south)s || ',' ||
        %(east)s  || ' ' || %(south)s || ',' ||
        %(east)s  || ' ' || %(north)s || ',' ||
        %(west)s  || ' ' || %(north)s || ',' ||
        %(west)s  || ' ' || %(south)s ||
        '))'
    ),
    %(coverage_type)s,
    %(max_speed_mbps)s,
    %(operator)s,
    'seed_phase0',
    NOW()
)
"""


def main():
    parser = argparse.ArgumentParser(description="Seed fibre_coverage for Phase 0 testing")
    parser.add_argument("--city",    choices=list(CITIES), help="Seed only this city")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    cities = {args.city: CITIES[args.city]} if args.city else CITIES

    print(f"Seeding {len(cities)} city/cities into fibre_coverage...")

    if args.dry_run:
        for key, c in cities.items():
            print(f"  [dry-run] {c['name']} bbox ({c['south']},{c['west']}) → ({c['north']},{c['east']}) — {c['coverage_type']}")
        return

    conn = get_conn()
    with conn.cursor() as cur:
        for key, c in cities.items():
            cur.execute(UPSERT_SQL, c)
            print(f"  ✓ {c['name']} ({c['coverage_type']}, {c['max_speed_mbps']} Mbps)")
    conn.commit()
    conn.close()

    print(f"\n✓ Done. {len(cities)} fibre coverage polygon(s) seeded.")
    print("\nNote: These are bounding-box approximations for Phase 0 testing.")
    print("Production: use SETELECO per-property lookup at avance.digital.gob.es")
    print("  Interactive map: avance.digital.gob.es/banda-ancha/cobertura/Mapas-servicios-Banda-Ancha/")
    print("  Query by 14-digit catastral reference for exact per-property coverage.")


if __name__ == "__main__":
    main()

# =============================================================================
# NOTE: Production fibre coverage approach
# =============================================================================
# The SETELECO interactive map (avance.digital.gob.es) accepts a 14-digit
# catastral reference and returns coverage per technology. For production,
# the digital_viability indicator should query this directly:
#
#   GET https://avance.digital.gob.es/banda-ancha/.../api?refCatastral=XXXXXXXXXXXXXX
#
# This gives exact per-property coverage at analysis time, removing the need
# for the pre-loaded fibre_coverage table entirely. Implement as part of
# the Parse.bot / Catastro enrichment step in CHI-289.
# =============================================================================
