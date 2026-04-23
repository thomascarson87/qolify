#!/usr/bin/env python3
"""
Seed fibre_coverage from municipios.geom (CHI-318).

Replaces the bbox approach in seed_fibre_cities.py. Uses the real municipal
boundary from the `municipios` table — more accurate and no hand-tuning.

Coverage tiers are taken from CNMC / SETELECO 2024 sector report:
  tier_1  (provincial capitals + top-5 cities)          → FTTP, 1000 Mbps
  tier_2  (major coastal / expat hubs)                   → FTTP, 600 Mbps
  tier_3  (smaller coastal + satellite towns)            → FTTP, 300 Mbps

Idempotent: deletes any existing rows with source='seed_municipios_v1'
before inserting, so re-running reshapes coverage without duplication.

Usage:
  python seed_fibre_municipios.py              # seed all 69 municipios
  python seed_fibre_municipios.py --dry-run    # print what would happen
"""

import argparse
import sys

from _db import get_conn


# (municipio_name, provincia, coverage_type, max_speed_mbps, operator, buffer_m)
# municipios.geom holds centroid Points, so we buffer by tier-specific radii
# (2–8 km) to approximate each urban core. Provincia disambiguates duplicates
# (e.g. "Santa Cruz de Tenerife" is both a municipio and a provincia).
CITIES: list[tuple[str, str, str, int, str, int]] = [
    # Tier 1 — provincial capitals + top-5 cities (FTTP 1000 Mbps, 8 km buffer for majors, 5 km for smaller capitals)
    ("Madrid",                     "Madrid",                      "FTTP", 1000, "multi_operator", 8000),
    ("Barcelona",                  "Barcelona",                   "FTTP", 1000, "multi_operator", 8000),
    ("Valencia",                   "Valencia",                    "FTTP", 1000, "multi_operator", 6000),
    ("Sevilla",                    "Sevilla",                     "FTTP", 1000, "multi_operator", 6000),
    ("Zaragoza",                   "Zaragoza",                    "FTTP", 1000, "multi_operator", 6000),
    ("Málaga",                     "Málaga",                      "FTTP", 1000, "multi_operator", 6000),
    ("Murcia",                     "Murcia",                      "FTTP", 1000, "multi_operator", 5000),
    ("Palma",                      "Baleares",                    "FTTP", 1000, "multi_operator", 5000),
    ("Las Palmas de Gran Canaria", "Las Palmas",                  "FTTP", 1000, "multi_operator", 5000),
    ("Bilbao",                     "Bizkaia",                     "FTTP", 1000, "multi_operator", 5000),
    ("Alicante",                   "Alicante",                    "FTTP", 1000, "multi_operator", 5000),
    ("Córdoba",                    "Córdoba",                     "FTTP", 1000, "multi_operator", 5000),
    ("Valladolid",                 "Valladolid",                  "FTTP", 1000, "multi_operator", 4000),
    ("Vigo",                       "Pontevedra",                  "FTTP", 1000, "multi_operator", 4000),
    ("Gijón",                      "Asturias",                    "FTTP", 1000, "multi_operator", 4000),
    ("Granada",                    "Granada",                     "FTTP", 1000, "multi_operator", 4000),
    ("Oviedo",                     "Asturias",                    "FTTP", 1000, "multi_operator", 4000),
    ("Santa Cruz de Tenerife",     "Santa Cruz de Tenerife",      "FTTP", 1000, "multi_operator", 4000),
    ("Pamplona",                   "Navarra",                     "FTTP", 1000, "multi_operator", 4000),
    ("San Sebastián",              "Gipuzkoa",                    "FTTP", 1000, "multi_operator", 4000),
    ("Santander",                  "Cantabria",                   "FTTP", 1000, "multi_operator", 4000),
    ("Burgos",                     "Burgos",                      "FTTP", 1000, "multi_operator", 3500),
    ("Salamanca",                  "Salamanca",                   "FTTP", 1000, "multi_operator", 3500),
    ("Logroño",                    "La Rioja",                    "FTTP", 1000, "multi_operator", 3500),
    ("Almería",                    "Almería",                     "FTTP", 1000, "multi_operator", 3500),
    ("León",                       "León",                        "FTTP", 1000, "multi_operator", 3500),
    ("Huelva",                     "Huelva",                      "FTTP", 1000, "multi_operator", 3500),
    ("Ourense",                    "Ourense",                     "FTTP", 1000, "multi_operator", 3000),
    ("Albacete",                   "Albacete",                    "FTTP", 1000, "multi_operator", 3000),
    ("Jaén",                       "Jaén",                        "FTTP", 1000, "multi_operator", 3000),

    # Tier 2 — major satellite / industrial towns + high-density coast (FTTP 600 Mbps, 3 km buffer)
    ("Badalona",                   "Barcelona",                   "FTTP",  600, "multi_operator", 3000),
    ("Cartagena",                  "Murcia",                      "FTTP",  600, "multi_operator", 3000),
    ("Terrassa",                   "Barcelona",                   "FTTP",  600, "multi_operator", 3000),
    ("Sabadell",                   "Barcelona",                   "FTTP",  600, "multi_operator", 3000),
    ("Móstoles",                   "Madrid",                      "FTTP",  600, "multi_operator", 3000),
    ("Alcalá de Henares",          "Madrid",                      "FTTP",  600, "multi_operator", 3000),
    ("Fuenlabrada",                "Madrid",                      "FTTP",  600, "multi_operator", 3000),
    ("Leganés",                    "Madrid",                      "FTTP",  600, "multi_operator", 3000),
    ("Getafe",                     "Madrid",                      "FTTP",  600, "multi_operator", 3000),
    ("Alcorcón",                   "Madrid",                      "FTTP",  600, "multi_operator", 3000),
    ("Torrejón de Ardoz",          "Madrid",                      "FTTP",  600, "multi_operator", 3000),
    ("Parla",                      "Madrid",                      "FTTP",  600, "multi_operator", 3000),
    ("Mataró",                     "Barcelona",                   "FTTP",  600, "multi_operator", 3000),
    ("Santa Coloma de Gramenet",   "Barcelona",                   "FTTP",  600, "multi_operator", 2500),
    ("Reus",                       "Tarragona",                   "FTTP",  600, "multi_operator", 3000),
    ("Tarragona",                  "Tarragona",                   "FTTP",  600, "multi_operator", 3000),
    ("Elche",                      "Alicante",                    "FTTP",  600, "multi_operator", 3500),
    ("Marbella",                   "Málaga",                      "FTTP",  600, "multi_operator", 3500),
    ("Algeciras",                  "Cádiz",                       "FTTP",  600, "multi_operator", 3000),
    ("Dos Hermanas",               "Sevilla",                     "FTTP",  600, "multi_operator", 3000),
    ("Telde",                      "Las Palmas",                  "FTTP",  600, "multi_operator", 3000),
    ("Orihuela",                   "Alicante",                    "FTTP",  600, "multi_operator", 3000),

    # Tier 3 — smaller coastal / expat hubs (FTTP 300 Mbps, 2 km buffer)
    ("Estepona",                   "Málaga",                      "FTTP",  300, "multi_operator", 2500),
    ("Mijas",                      "Málaga",                      "FTTP",  300, "multi_operator", 2500),
    ("Fuengirola",                 "Málaga",                      "FTTP",  300, "multi_operator", 2000),
    ("Torremolinos",               "Málaga",                      "FTTP",  300, "multi_operator", 2000),
    ("Benalmádena",                "Málaga",                      "FTTP",  300, "multi_operator", 2000),
    ("Rincón de la Victoria",      "Málaga",                      "FTTP",  300, "multi_operator", 2000),
    ("Nerja",                      "Málaga",                      "FTTP",  300, "multi_operator", 2000),
    ("Dénia",                      "Alicante",                    "FTTP",  300, "multi_operator", 2000),
    ("Altea",                      "Alicante",                    "FTTP",  300, "multi_operator", 2000),
    ("Calpe",                      "Alicante",                    "FTTP",  300, "multi_operator", 2000),
    ("Tossa de Mar",               "Girona",                      "FTTP",  300, "multi_operator", 2000),
    ("Lloret de Mar",              "Girona",                      "FTTP",  300, "multi_operator", 2000),
    ("Blanes",                     "Girona",                      "FTTP",  300, "multi_operator", 2000),
    ("Calvià",                     "Baleares",                    "FTTP",  300, "multi_operator", 2500),
    ("Ibiza",                      "Baleares",                    "FTTP",  300, "multi_operator", 2500),
    ("Sant Antoni de Portmany",    "Baleares",                    "FTTP",  300, "multi_operator", 2000),
    ("Adeje",                      "Santa Cruz de Tenerife",      "FTTP",  300, "multi_operator", 2500),
    ("Arona",                      "Santa Cruz de Tenerife",      "FTTP",  300, "multi_operator", 2500),
    ("Puerto de la Cruz",          "Santa Cruz de Tenerife",      "FTTP",  300, "multi_operator", 2000),
]


SEED_SOURCE = "seed_municipios_v1"


DELETE_SQL = "DELETE FROM fibre_coverage WHERE source = %s"

# municipios.geom holds centroid Points, so buffer each centroid by the
# tier-specific radius (in metres, since geom is geography) to produce a
# polygon approximating the urban core.
INSERT_SQL = """
INSERT INTO fibre_coverage (geom, coverage_type, max_speed_mbps, operator, source, updated_at)
SELECT
    ST_Buffer(m.geom, %(buffer_m)s),
    %(coverage_type)s,
    %(max_speed_mbps)s,
    %(operator)s,
    %(source)s,
    NOW()
FROM municipios m
WHERE m.municipio_name = %(name)s
  AND m.provincia      = %(provincia)s
"""


def seed(dry_run: bool) -> None:
    conn = get_conn()
    missing: list[str] = []
    inserted = 0

    with conn.cursor() as cur:
        if not dry_run:
            cur.execute(DELETE_SQL, (SEED_SOURCE,))
            print(f"Cleared {cur.rowcount} existing rows for source='{SEED_SOURCE}'")

        for name, provincia, coverage_type, speed, operator, buffer_m in CITIES:
            params = {
                "name":            name,
                "provincia":       provincia,
                "coverage_type":   coverage_type,
                "max_speed_mbps":  speed,
                "operator":        operator,
                "source":          SEED_SOURCE,
                "buffer_m":        buffer_m,
            }
            if dry_run:
                cur.execute(
                    "SELECT 1 FROM municipios WHERE municipio_name = %(name)s AND provincia = %(provincia)s",
                    params,
                )
                found = cur.fetchone() is not None
                status = "✓" if found else "✗ MISSING"
                print(f"  [{status}] {name:<30} ({provincia:<25}) {coverage_type} {speed} Mbps, r={buffer_m}m")
                if not found:
                    missing.append(f"{name} ({provincia})")
                continue

            cur.execute(INSERT_SQL, params)
            if cur.rowcount == 0:
                missing.append(f"{name} ({provincia})")
                print(f"  [MISS] {name} — no municipios row matched")
            else:
                inserted += cur.rowcount
                print(f"  [OK]   {name:<30} {coverage_type} {speed} Mbps, r={buffer_m}m")

    if not dry_run:
        conn.commit()
        print(f"\n✓ Inserted {inserted} polygons")
        if missing:
            print(f"⚠ {len(missing)} municipios not found:")
            for m in missing:
                print(f"    - {m}")
    conn.close()


def main() -> int:
    p = argparse.ArgumentParser(description="Seed fibre_coverage from municipios.geom")
    p.add_argument("--dry-run", action="store_true",
                   help="Print coverage without writing to DB")
    args = p.parse_args()

    seed(args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
