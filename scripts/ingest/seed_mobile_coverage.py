#!/usr/bin/env python3
"""
Seed mobile_coverage from municipios.geom (CHI-393).

CNMC publishes mobile coverage shapefiles per operator/technology annually.
Rather than block on the manual shapefile download, this script produces
a municipio-centroid baseline that tracks published CNMC 2024 headline
coverage figures:

  4G: >99% population coverage — buffer EVERY municipio centroid by 5 km.
      Operators: Movistar + Vodafone + Orange + MásMóvil + Yoigo all present
      nationally, so we write a single aggregate row per municipio with
      operator='multi_operator'.

  5G: ~85% population coverage (urban cores + costas) — buffer the Tier-1
      provincial capitals + Tier-2 satellite/coastal hubs from the CHI-318
      fibre seed (52 municipios total).

Idempotent: source='seed_municipios_v1' delete-then-insert, so re-running
reshapes rather than duplicates.

Usage:
  python seed_mobile_coverage.py              # seed 4G (all) + 5G (urban)
  python seed_mobile_coverage.py --tech 4g    # only 4G
  python seed_mobile_coverage.py --tech 5g    # only 5G
  python seed_mobile_coverage.py --dry-run
"""

import argparse
import sys

from _db import get_conn


SEED_SOURCE = "seed_municipios_v1"
MANUAL_SOURCE = "seed_manual_v1"  # hand-coded coords for gaps in municipios table

# Download speed (Mbps) typical values per CNMC 2024 report.
SPEED_4G = 60   # typical HSDPA+/LTE-A
SPEED_5G = 300  # typical NSA 5G

# Two major cities are missing from our `municipios` table (ingest defect —
# see CHI tracking ticket). Insert by known centroid coordinates so Digital
# Viability works at these lat/lngs.
MANUAL_GAPS: list[tuple[str, float, float]] = [
    ("Palma de Mallorca", 39.5696,  2.6502),
    ("Córdoba",           37.8882, -4.7794),
]


# Tier-1 (5km) + Tier-2 (3km) from CHI-318 — the urban cores with 5G.
CITIES_5G: list[tuple[str, str, int]] = [
    # Tier 1 — provincial capitals + top-5 (5 km)
    ("Madrid",                     "Madrid",                      8000),
    ("Barcelona",                  "Barcelona",                   8000),
    ("Valencia",                   "Valencia",                    6000),
    ("Sevilla",                    "Sevilla",                     6000),
    ("Zaragoza",                   "Zaragoza",                    6000),
    ("Málaga",                     "Málaga",                      6000),
    ("Murcia",                     "Murcia",                      5000),
    ("Palma",                      "Baleares",                    5000),
    ("Las Palmas de Gran Canaria", "Las Palmas",                  5000),
    ("Bilbao",                     "Bizkaia",                     5000),
    ("Alicante",                   "Alicante",                    5000),
    ("Córdoba",                    "Córdoba",                     5000),
    ("Valladolid",                 "Valladolid",                  4000),
    ("Vigo",                       "Pontevedra",                  4000),
    ("Gijón",                      "Asturias",                    4000),
    ("Granada",                    "Granada",                     4000),
    ("Oviedo",                     "Asturias",                    4000),
    ("Santa Cruz de Tenerife",     "Santa Cruz de Tenerife",      4000),
    ("Pamplona",                   "Navarra",                     4000),
    ("San Sebastián",              "Gipuzkoa",                    4000),
    ("Santander",                  "Cantabria",                   4000),
    ("Burgos",                     "Burgos",                      3500),
    ("Salamanca",                  "Salamanca",                   3500),
    ("Logroño",                    "La Rioja",                    3500),
    ("Almería",                    "Almería",                     3500),
    ("León",                       "León",                        3500),
    ("Huelva",                     "Huelva",                      3500),
    ("Ourense",                    "Ourense",                     3000),
    ("Albacete",                   "Albacete",                    3000),
    ("Jaén",                       "Jaén",                        3000),

    # Tier 2 — satellite / industrial / high-density coast (3 km)
    ("Badalona",                   "Barcelona",                   3000),
    ("Cartagena",                  "Murcia",                      3000),
    ("Terrassa",                   "Barcelona",                   3000),
    ("Sabadell",                   "Barcelona",                   3000),
    ("Móstoles",                   "Madrid",                      3000),
    ("Alcalá de Henares",          "Madrid",                      3000),
    ("Fuenlabrada",                "Madrid",                      3000),
    ("Leganés",                    "Madrid",                      3000),
    ("Getafe",                     "Madrid",                      3000),
    ("Alcorcón",                   "Madrid",                      3000),
    ("Torrejón de Ardoz",          "Madrid",                      3000),
    ("Parla",                      "Madrid",                      3000),
    ("Mataró",                     "Barcelona",                   3000),
    ("Santa Coloma de Gramenet",   "Barcelona",                   2500),
    ("Reus",                       "Tarragona",                   3000),
    ("Tarragona",                  "Tarragona",                   3000),
    ("Elche",                      "Alicante",                    3500),
    ("Marbella",                   "Málaga",                      3500),
    ("Algeciras",                  "Cádiz",                       3000),
    ("Dos Hermanas",               "Sevilla",                     3000),
    ("Telde",                      "Las Palmas",                  3000),
    ("Orihuela",                   "Alicante",                    3000),
]


DELETE_SQL = "DELETE FROM mobile_coverage WHERE source = %s AND technology = %s"

# 4G: every municipio gets a 5 km buffer around its centroid.
INSERT_4G_SQL = """
INSERT INTO mobile_coverage (geom, technology, operator, download_mbps_typ, source, updated_at)
SELECT
    ST_Buffer(m.geom, 5000),
    '4G',
    'multi_operator',
    %(speed)s,
    %(source)s,
    NOW()
FROM municipios m
WHERE m.geom IS NOT NULL
"""

INSERT_5G_SQL = """
INSERT INTO mobile_coverage (geom, technology, operator, download_mbps_typ, source, updated_at)
SELECT
    ST_Buffer(m.geom, %(buffer_m)s),
    '5G',
    'multi_operator',
    %(speed)s,
    %(source)s,
    NOW()
FROM municipios m
WHERE m.municipio_name = %(name)s
  AND m.provincia      = %(provincia)s
"""


def seed_4g(cur, dry_run: bool) -> int:
    if dry_run:
        cur.execute("SELECT COUNT(*) FROM municipios WHERE geom IS NOT NULL")
        (count,) = cur.fetchone()
        print(f"  [dry-run] would insert 4G polygons for {count} municipios")
        return 0

    cur.execute(DELETE_SQL, (SEED_SOURCE, "4G"))
    print(f"  Cleared {cur.rowcount} existing 4G rows for source='{SEED_SOURCE}'")

    cur.execute(INSERT_4G_SQL, {"speed": SPEED_4G, "source": SEED_SOURCE})
    print(f"  ✓ Inserted {cur.rowcount} 4G polygons (one per municipio)")
    return cur.rowcount


def seed_5g(cur, dry_run: bool) -> int:
    if dry_run:
        print(f"  [dry-run] would insert 5G polygons for {len(CITIES_5G)} cities")
        return 0

    cur.execute(DELETE_SQL, (SEED_SOURCE, "5G"))
    print(f"  Cleared {cur.rowcount} existing 5G rows for source='{SEED_SOURCE}'")

    missing: list[str] = []
    inserted = 0
    for name, provincia, buffer_m in CITIES_5G:
        cur.execute(
            INSERT_5G_SQL,
            {
                "name":      name,
                "provincia": provincia,
                "buffer_m":  buffer_m,
                "speed":     SPEED_5G,
                "source":    SEED_SOURCE,
            },
        )
        if cur.rowcount == 0:
            missing.append(f"{name} ({provincia})")
            print(f"  [MISS] {name} — no municipios row matched")
        else:
            inserted += cur.rowcount
            print(f"  [OK]   {name:<30} 5G r={buffer_m}m")

    print(f"  ✓ Inserted {inserted} 5G polygons")
    if missing:
        print(f"  ⚠ {len(missing)} cities not found:")
        for m in missing:
            print(f"      - {m}")
    return inserted


MANUAL_INSERT_SQL = """
INSERT INTO mobile_coverage (geom, technology, operator, download_mbps_typ, source, updated_at)
VALUES (
    ST_Buffer(ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::geography, 5000),
    %(technology)s, 'multi_operator', %(speed)s, %(source)s, NOW()
)
"""


def seed_manual_gaps(cur, dry_run: bool) -> int:
    if dry_run:
        print(f"  [dry-run] would insert manual 4G+5G for {len(MANUAL_GAPS)} missing cities")
        return 0

    cur.execute("DELETE FROM mobile_coverage WHERE source = %s", (MANUAL_SOURCE,))
    print(f"  Cleared {cur.rowcount} existing manual rows")

    inserted = 0
    for name, lat, lng in MANUAL_GAPS:
        for tech, speed in (("4G", SPEED_4G), ("5G", SPEED_5G)):
            cur.execute(MANUAL_INSERT_SQL, {
                "lat": lat, "lng": lng, "technology": tech,
                "speed": speed, "source": MANUAL_SOURCE,
            })
            inserted += cur.rowcount
        print(f"  [OK]   {name} (manual, 5 km buffer)")
    print(f"  ✓ Inserted {inserted} manual rows")
    return inserted


def main() -> int:
    p = argparse.ArgumentParser(description="Seed mobile_coverage from municipios.geom")
    p.add_argument("--tech", choices=["4g", "5g", "both"], default="both",
                   help="Which technology to seed (default: both)")
    p.add_argument("--dry-run", action="store_true",
                   help="Print counts without writing to DB")
    args = p.parse_args()

    conn = get_conn()
    with conn.cursor() as cur:
        if args.tech in ("4g", "both"):
            print("— 4G seed —")
            seed_4g(cur, args.dry_run)
        if args.tech in ("5g", "both"):
            print("— 5G seed —")
            seed_5g(cur, args.dry_run)
        if args.tech == "both":
            print("— Manual gap-fill (Palma, Córdoba) —")
            seed_manual_gaps(cur, args.dry_run)
    if not args.dry_run:
        conn.commit()
    conn.close()
    print("\nDone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
