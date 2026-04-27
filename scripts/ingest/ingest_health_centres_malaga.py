#!/usr/bin/env python3
"""
CHI-385: Ingest curated SAS facility list for Málaga province.

Why this script exists
----------------------
The OSM-derived rows in `health_centres` mislabel private clinics as
`centro_salud` (e.g. "Indiba", "Dorsia", "Clínica Londres") and miss the
big public hospitals entirely (Carlos Haya, Virgen de la Victoria).
This script seeds a curated, authoritative list of public Centros de
Salud and hospitals in Málaga from `data/health/malaga_curated.csv`,
upserts them, and retags any leftover OSM `centro_salud` rows in Málaga
province as `clinica` so the indicator stops mistaking private clinics
for public GPs.

Other regions are NOT touched.

Usage:
  python ingest_health_centres_malaga.py
  python ingest_health_centres_malaga.py --csv data/health/malaga_curated.csv
  python ingest_health_centres_malaga.py --dry-run
"""
import argparse
import csv
import sys
import unicodedata
from pathlib import Path

from _db import get_conn, execute_batch

DEFAULT_CSV = Path(__file__).parents[2] / "data" / "health" / "malaga_curated.csv"


# ---------------------------------------------------------------------------
# Upsert SQL
# ---------------------------------------------------------------------------
# Use (nombre, municipio) as the natural key. health_centres has no unique
# constraint on this pair so we do a manual UPSERT in two passes (delete
# matching rows from prior `sas_curated` runs, then insert) inside one
# transaction. We do NOT touch rows with source != 'sas_curated' here —
# those are handled separately by the OSM-retag pass.

DELETE_PRIOR_CURATED_SQL = """
DELETE FROM health_centres
WHERE source = 'sas_curated'
  AND LOWER(provincia) = 'málaga'
"""

INSERT_SQL = """
INSERT INTO health_centres (
    nombre, tipo, is_24h, lat, lng, geom,
    municipio, provincia, source, updated_at
)
VALUES (
    %(nombre)s,
    %(tipo)s,
    %(is_24h)s,
    %(lat)s,
    %(lng)s,
    ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::GEOGRAPHY,
    %(municipio)s,
    'Málaga',
    'sas_curated',
    NOW()
)
"""

# Retag any OSM-sourced "centro_salud" in Málaga that does NOT match a
# curated public centre by name. These are almost certainly private
# clinics OSM mislabelled. We move them to `clinica` so they stop
# polluting the GP-distance signal but keep them on the map.
RETAG_OSM_PRIVATE_SQL = """
UPDATE health_centres
SET tipo = 'clinica',
    updated_at = NOW()
WHERE source = 'osm'
  AND tipo = 'centro_salud'
  AND ST_Intersects(
      geom::geometry,
      ST_MakeEnvelope(-5.20, 36.35, -3.90, 36.95, 4326)
  )
  AND LOWER(REGEXP_REPLACE(COALESCE(nombre, ''), '[^a-záéíóúñ ]', '', 'g'))
      NOT IN %(curated_names_lower)s
"""


def normalize(s: str) -> str:
    """lowercase + strip accents + collapse whitespace, for name matching."""
    if not s:
        return ""
    n = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    return " ".join(n.lower().split())


def load_csv(path: Path) -> list[dict]:
    rows = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            try:
                lat = float(r["lat"])
                lng = float(r["lng"])
            except (ValueError, TypeError):
                print(f"  skip (bad coords): {r.get('nombre')}")
                continue
            rows.append({
                "nombre":    r["nombre"].strip(),
                "tipo":      r["tipo"].strip(),
                "is_24h":    r["is_24h"].strip().lower() in ("true", "1", "yes"),
                "lat":       lat,
                "lng":       lng,
                "municipio": r.get("municipio", "").strip() or None,
            })
    return rows


def main():
    parser = argparse.ArgumentParser(description="Ingest curated SAS facilities for Málaga")
    parser.add_argument("--csv", default=str(DEFAULT_CSV), help="Path to curated CSV")
    parser.add_argument("--dry-run", action="store_true", help="Show what would change, don't write")
    args = parser.parse_args()

    csv_path = Path(args.csv)
    if not csv_path.exists():
        print(f"CSV not found: {csv_path}", file=sys.stderr)
        sys.exit(1)

    records = load_csv(csv_path)
    print(f"Loaded {len(records)} curated facilities from {csv_path.name}")
    by_tipo = {}
    for r in records:
        by_tipo[r["tipo"]] = by_tipo.get(r["tipo"], 0) + 1
    for t, n in sorted(by_tipo.items()):
        print(f"  {t}: {n}")

    # Curated centro_salud names (normalised) — used to spare matching OSM rows
    # from the private-clinic retag.
    curated_cs_names = tuple(sorted({
        normalize(r["nombre"]) for r in records if r["tipo"] == "centro_salud"
    }))
    if not curated_cs_names:
        # Empty IN () is illegal; insert sentinel to keep the SQL valid.
        curated_cs_names = ("__none__",)

    if args.dry_run:
        print("\nDRY RUN — no DB writes")
        print(f"Would delete prior sas_curated rows in Málaga, then insert {len(records)}.")
        print(f"Would retag OSM 'centro_salud' rows in Málaga whose normalised name is not in:")
        for n in curated_cs_names[:5]:
            print(f"    {n!r}")
        if len(curated_cs_names) > 5:
            print(f"    ... ({len(curated_cs_names)} total)")
        return

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(DELETE_PRIOR_CURATED_SQL)
            print(f"Cleared {cur.rowcount} prior sas_curated rows in Málaga")

        execute_batch(conn, INSERT_SQL, records)
        print(f"Inserted {len(records)} curated facilities")

        with conn.cursor() as cur:
            cur.execute(RETAG_OSM_PRIVATE_SQL, {"curated_names_lower": curated_cs_names})
            print(f"Retagged {cur.rowcount} OSM rows from centro_salud → clinica")
        conn.commit()
    finally:
        conn.close()
    print("\n✓ Done.")


if __name__ == "__main__":
    main()
