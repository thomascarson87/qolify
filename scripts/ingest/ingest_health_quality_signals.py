#!/usr/bin/env python3
"""
CHI-385: Update facility-level quality signals on `health_centres`.

Two CSV-driven update passes against rows already loaded by
`ingest_health_centres_malaga.py`:

  1. Surgery waiting days per hospital (SAS quarterly publication)
     CSV: data/health/malaga_surgery_waits.csv
     Cols: nombre, surgery_wait_days, wait_recorded_quarter, source_url

  2. ACSA accreditation level (avanzada / optima / excelente)
     CSV: data/health/malaga_acsa_accreditation.csv
     Cols: nombre, acsa_accreditation, source_url

Why two CSVs, one script: identical match-by-normalised-name logic, and
both signals are facility-level overlays on the curated list.

Match strategy: case+accent-insensitive exact match on `nombre`,
restricted to province='Málaga'. If a CSV row doesn't match anything,
warn — don't insert (these scripts only update existing rows).

Usage:
  python ingest_health_quality_signals.py                # both passes
  python ingest_health_quality_signals.py --waits-only
  python ingest_health_quality_signals.py --acsa-only
  python ingest_health_quality_signals.py --dry-run
"""
import argparse
import csv
import sys
import unicodedata
from pathlib import Path

from _db import get_conn

DATA_DIR = Path(__file__).parents[2] / "data" / "health"
WAITS_CSV = DATA_DIR / "malaga_surgery_waits.csv"
ACSA_CSV  = DATA_DIR / "malaga_acsa_accreditation.csv"


def normalize(s: str) -> str:
    if not s:
        return ""
    n = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    return " ".join(n.lower().split())


def fetch_malaga_facilities(conn) -> dict[str, str]:
    """Return {normalised_nombre: id} for all Málaga facilities."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, nombre
            FROM health_centres
            WHERE LOWER(provincia) = 'málaga'
        """)
        return {normalize(nombre): id_ for id_, nombre in cur.fetchall()}


def update_waits(conn, csv_path: Path, dry_run: bool) -> None:
    if not csv_path.exists():
        print(f"  [waits] CSV not found, skipping: {csv_path}")
        return

    facilities = fetch_malaga_facilities(conn)
    matched = unmatched = skipped = 0
    updates = []
    with open(csv_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            wait = (row.get("surgery_wait_days") or "").strip()
            quarter = (row.get("wait_recorded_quarter") or "").strip() or None
            nombre = row.get("nombre", "").strip()
            if not wait:
                skipped += 1
                continue
            try:
                wait_days = int(float(wait))
            except ValueError:
                print(f"  [waits] bad number, skipping: {nombre} = {wait!r}")
                skipped += 1
                continue
            id_ = facilities.get(normalize(nombre))
            if not id_:
                print(f"  [waits] no match: {nombre!r}")
                unmatched += 1
                continue
            updates.append((wait_days, quarter, id_))
            matched += 1

    print(f"  [waits] matched={matched} unmatched={unmatched} skipped_blank={skipped}")
    if dry_run or not updates:
        return
    with conn.cursor() as cur:
        cur.executemany("""
            UPDATE health_centres
            SET surgery_wait_days = %s,
                wait_recorded_quarter = %s,
                updated_at = NOW()
            WHERE id = %s
        """, updates)
    conn.commit()


def update_acsa(conn, csv_path: Path, dry_run: bool) -> None:
    if not csv_path.exists():
        print(f"  [acsa] CSV not found, skipping: {csv_path}")
        return

    valid = {"avanzada", "optima", "excelente"}
    facilities = fetch_malaga_facilities(conn)
    matched = unmatched = skipped = 0
    updates = []
    with open(csv_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            acc = (row.get("acsa_accreditation") or "").strip().lower()
            nombre = row.get("nombre", "").strip()
            if not acc:
                skipped += 1
                continue
            if acc not in valid:
                print(f"  [acsa] bad level, skipping: {nombre} = {acc!r}")
                skipped += 1
                continue
            id_ = facilities.get(normalize(nombre))
            if not id_:
                print(f"  [acsa] no match: {nombre!r}")
                unmatched += 1
                continue
            updates.append((acc, id_))
            matched += 1

    print(f"  [acsa] matched={matched} unmatched={unmatched} skipped_blank={skipped}")
    if dry_run or not updates:
        return
    with conn.cursor() as cur:
        cur.executemany("""
            UPDATE health_centres
            SET acsa_accreditation = %s,
                updated_at = NOW()
            WHERE id = %s
        """, updates)
    conn.commit()


def main():
    parser = argparse.ArgumentParser(description="Update facility-level quality signals")
    parser.add_argument("--waits-only", action="store_true")
    parser.add_argument("--acsa-only",  action="store_true")
    parser.add_argument("--dry-run",    action="store_true")
    args = parser.parse_args()

    do_waits = not args.acsa_only
    do_acsa  = not args.waits_only

    conn = get_conn()
    try:
        if do_waits:
            print("Surgery waits:")
            update_waits(conn, WAITS_CSV, args.dry_run)
        if do_acsa:
            print("ACSA accreditation:")
            update_acsa(conn, ACSA_CSV, args.dry_run)
    finally:
        conn.close()
    print("\n✓ Done." + (" (dry run)" if args.dry_run else ""))


if __name__ == "__main__":
    main()
