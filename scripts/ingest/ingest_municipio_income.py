from __future__ import annotations
#!/usr/bin/env python3
"""
Qolify — INE Atlas de Distribución de Renta de los Hogares (CHI-400)

Ingests municipio-level net median income from INE Atlas de Renta into the
`municipio_income` table. Feeds CHI-401 (True Affordability price-to-income).

Data source: INE ADRH, downloadable CSV (≈350MB, all years, all municipios +
districts + census sections — we filter to municipio-level only).
  https://www.ine.es/jaxiT3/files/t/es/csv_bdsc/30824.csv?nocab=1

Indicator used: "Renta neta media por persona" (net mean income per person).
CHI-401 compares it against monthly_cost × 12, so person-level is the right
denominator for both lone-buyer and household cases.

Value format in the INE CSV is European (period = thousands separator,
comma = decimal). E.g. "16.429" → 16,429 euros/year.

Usage:
  python ingest_municipio_income.py                 # download + upsert
  python ingest_municipio_income.py --csv path.csv  # use local file instead
  python ingest_municipio_income.py --dry-run       # parse only, no DB writes
  python ingest_municipio_income.py --verify        # print row counts and exit

Prerequisites:
  - DATABASE_URL or DATABASE_URL_POOLER in .env.local
  - `municipio_income` table (migration 001_initial_schema.sql)

Typical runtime: ~90s download on a decent connection + ~30s upsert.
"""
import argparse
import csv
import io
import re
import sys
import time
from pathlib import Path

import requests
from tqdm import tqdm

from _db import get_conn, execute_batch

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

INE_CSV_URL = "https://www.ine.es/jaxiT3/files/t/es/csv_bdsc/30824.csv?nocab=1"
INDICATOR_NAME = "Renta neta media por persona"

# Municipio column format: "29067 Málaga" (5-digit INE code + space + name).
MUN_PREFIX_RE = re.compile(r"^(\d{5})\s+(.+)$")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def parse_european_number(raw: str) -> int | None:
    """
    INE uses '.' as thousands sep and ',' as decimal. Income values are
    whole euros, so we strip dots and treat comma-decimals as fractional.
    Returns None for blank/'..'/non-numeric cells.
    """
    s = (raw or "").strip()
    if not s or s == ".." or s == "-":
        return None
    # Remove thousand-separator dots, then convert comma-decimal to dot.
    s = s.replace(".", "").replace(",", ".")
    try:
        return int(round(float(s)))
    except ValueError:
        return None


def download_csv(dest: Path) -> None:
    print(f"[download] {INE_CSV_URL} → {dest}", file=sys.stderr)
    with requests.get(INE_CSV_URL, stream=True, timeout=600) as r:
        r.raise_for_status()
        total = int(r.headers.get("content-length") or 0)
        with open(dest, "wb") as f, tqdm(total=total, unit="B", unit_scale=True, desc="download") as bar:
            for chunk in r.iter_content(chunk_size=1 << 20):
                if chunk:
                    f.write(chunk)
                    bar.update(len(chunk))


def parse_csv(path: Path) -> list[tuple[str, str, int, int]]:
    """
    Stream-parse the INE CSV, filtering to:
      - municipio-level rows (Distritos + Secciones empty)
      - indicator == 'Renta neta media por persona'
    Keeps only the most recent year per municipio.
    Returns list of (municipio_code, municipio_name, income, year).
    """
    best: dict[str, tuple[str, int, int]] = {}  # code → (name, income, year)
    total = skipped = 0

    # INE ships UTF-8-BOM; semicolon delimited.
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            total += 1
            distrito = (row.get("Distritos") or "").strip()
            seccion  = (row.get("Secciones") or "").strip()
            if distrito or seccion:
                continue  # skip sub-municipio rows

            indicator = (row.get("Indicadores de renta media") or "").strip()
            if indicator != INDICATOR_NAME:
                continue

            municipio = (row.get("Municipios") or "").strip()
            m = MUN_PREFIX_RE.match(municipio)
            if not m:
                skipped += 1
                continue
            code, name = m.group(1), m.group(2).strip()

            try:
                year = int((row.get("Periodo") or "").strip())
            except ValueError:
                skipped += 1
                continue

            value = parse_european_number(row.get("Total") or "")
            if value is None:
                continue  # missing-year for this municipio

            prev = best.get(code)
            if prev is None or year > prev[2]:
                best[code] = (name, value, year)

    print(f"[parse] read {total} rows, {len(best)} municipios kept, {skipped} skipped", file=sys.stderr)
    return [(code, name, income, year) for code, (name, income, year) in best.items()]


# ---------------------------------------------------------------------------
# DB
# ---------------------------------------------------------------------------

UPSERT_SQL = """
INSERT INTO municipio_income (municipio_code, municipio_name, median_income_annual, year)
VALUES (%s, %s, %s, %s)
ON CONFLICT (municipio_code, year) DO UPDATE
SET median_income_annual = EXCLUDED.median_income_annual,
    municipio_name       = COALESCE(NULLIF(EXCLUDED.municipio_name, ''), municipio_income.municipio_name),
    updated_at           = NOW();
"""


def verify(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT COUNT(*), MIN(year), MAX(year),
                   MIN(median_income_annual), MAX(median_income_annual),
                   ROUND(AVG(median_income_annual))
            FROM municipio_income
        """)
        count, y_min, y_max, inc_min, inc_max, inc_avg = cur.fetchone()
    print(f"[verify] rows={count} years={y_min}-{y_max} income_range=€{inc_min}-€{inc_max} avg=€{inc_avg}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest INE ADRH municipio income into Supabase.")
    parser.add_argument("--csv", type=Path, help="Path to a local copy of the INE CSV (skip download)")
    parser.add_argument("--dry-run", action="store_true", help="Parse only; no DB writes")
    parser.add_argument("--verify", action="store_true", help="Print row counts and exit")
    args = parser.parse_args()

    if args.verify:
        conn = get_conn()
        try:
            verify(conn)
        finally:
            conn.close()
        return 0

    t0 = time.time()
    if args.csv:
        csv_path = args.csv
        if not csv_path.exists():
            print(f"[error] {csv_path} does not exist", file=sys.stderr)
            return 1
    else:
        csv_path = Path("/tmp/ine_adrh_30824.csv")
        if not csv_path.exists():
            download_csv(csv_path)
        else:
            print(f"[cache] using existing {csv_path}", file=sys.stderr)

    rows = parse_csv(csv_path)
    if not rows:
        print("[parse] no rows parsed — aborting", file=sys.stderr)
        return 1

    print(f"[parse] sample: {rows[:3]}")

    if args.dry_run:
        print(f"[dry-run] would upsert {len(rows)} rows")
        return 0

    conn = get_conn()
    try:
        for chunk_start in tqdm(range(0, len(rows), 500), desc="upsert"):
            chunk = rows[chunk_start : chunk_start + 500]
            conn = execute_batch(conn, UPSERT_SQL, chunk, page_size=500) or conn
        verify(conn)
    finally:
        conn.close()

    print(f"[done] {len(rows)} rows upserted in {time.time() - t0:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
