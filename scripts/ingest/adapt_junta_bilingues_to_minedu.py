#!/usr/bin/env python3
"""
Adapter — Junta de Andalucía bilingual schools CSV → Minedu-compatible shape.

The Junta open-data CSV (`da_centros_bilingues.csv`) lists every bilingual
centre in Andalucía with per-stage language flags ("BIL ING", "BIL FRA",
"BIL ALE"). The existing enrich_schools.py expects Minedu CSV with a
free-text PROGRAMAS_EDUCATIVOS column ("BILINGÜE INGLÉS; ...") that its
detect_bilingual_languages() helper parses for language codes.

This script reads the Junta CSV, flattens the per-stage bilingual flags into
a single PROGRAMAS_EDUCATIVOS string, optionally filters by province, and
emits a CSV that enrich_schools.py can consume with no code changes.

USAGE
-----
  python adapt_junta_bilingues_to_minedu.py \\
    --in /tmp/junta_bilingues.csv \\
    --out /tmp/junta_malaga_minedu.csv \\
    --provincia "Málaga"

  # All Andalucía:
  python adapt_junta_bilingues_to_minedu.py --in IN.csv --out OUT.csv
"""
from __future__ import annotations

import argparse
import csv
import io
import sys
from pathlib import Path
from typing import Iterable

# Junta stage columns that carry the BIL flag
STAGE_COLS = (
    "Infantil_2_ciclo",
    "Primaria",
    "ESO",
    "Bachillerato",
)

# BIL XXX → human-readable Spanish phrase that enrich_schools.py recognises.
# detect_bilingual_languages() looks for the words "bilingue" + a language
# keyword (ingles, frances, aleman, etc.) so we emit exactly those.
BIL_CODE_TO_PHRASE = {
    "BIL ING": "BILINGÜE INGLÉS",
    "BIL FRA": "BILINGÜE FRANCÉS",
    "BIL ALE": "BILINGÜE ALEMÁN",
}


def derive_programas(row: dict) -> str:
    """
    Collect all distinct BIL phrases across the 4 stage columns.

    Returns "BILINGÜE INGLÉS; BILINGÜE FRANCÉS" (or similar) — the order is
    deterministic. Returns "" if no stage carries a recognised flag, which
    means the row is bilingual-by-listing-presence but in an unmapped language;
    we emit nothing in that case so the enricher leaves the row alone.
    """
    phrases = []
    for col in STAGE_COLS:
        flag = (row.get(col) or "").strip().upper()
        if not flag:
            continue
        phrase = BIL_CODE_TO_PHRASE.get(flag)
        if phrase and phrase not in phrases:
            phrases.append(phrase)
    return "; ".join(phrases)


def normalise_decimal(s: str | None) -> str:
    """Convert European-format '37,1234' decimals to '37.1234'."""
    if not s:
        return ""
    return s.replace(",", ".").strip()


def adapt(in_path: Path, out_path: Path, provincia_filter: str | None) -> dict:
    """
    Stream-read the Junta CSV, write a Minedu-shape CSV.

    Returns {'read': N, 'kept': N, 'with_bilingual': N} for reporting.
    """
    # Junta CSVs are Latin-1 with ';' delimiter and CRLF line endings
    raw = in_path.read_bytes()
    text = raw.decode("latin-1")
    reader = csv.DictReader(io.StringIO(text), delimiter=";")

    out_fields = [
        "CODIGO_CENTRO",
        "NOMBRE_CENTRO",
        "MUNICIPIO",
        "PROVINCIA",
        "LATITUD",
        "LONGITUD",
        "PROGRAMAS_EDUCATIVOS",
        "COMEDOR",
        "INSTALACIONES_DEPORTIVAS",
    ]

    counts = {"read": 0, "kept": 0, "with_bilingual": 0}
    target = provincia_filter.strip().lower() if provincia_filter else None

    with out_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=out_fields, delimiter=";")
        writer.writeheader()

        for row in reader:
            counts["read"] += 1

            provincia = (row.get("D_PROVINCIA") or "").strip()
            if target and provincia.lower() != target:
                continue

            programas = derive_programas(row)
            if programas:
                counts["with_bilingual"] += 1

            writer.writerow(
                {
                    "CODIGO_CENTRO": (row.get("codigo") or "").strip(),
                    "NOMBRE_CENTRO": (row.get("D_ESPECIFICA") or "").strip(),
                    "MUNICIPIO": (row.get("D_MUNICIPIO") or "").strip(),
                    "PROVINCIA": provincia,
                    "LATITUD": normalise_decimal(row.get("N_LATITUD")),
                    "LONGITUD": normalise_decimal(row.get("N_LONGITUD")),
                    "PROGRAMAS_EDUCATIVOS": programas,
                    # Junta CSV does not carry these — leave blank so the
                    # enricher writes NULL rather than overwriting with False.
                    "COMEDOR": "",
                    "INSTALACIONES_DEPORTIVAS": "",
                }
            )
            counts["kept"] += 1

    return counts


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--in", dest="in_path", required=True, help="Junta da_centros_bilingues.csv")
    parser.add_argument("--out", dest="out_path", required=True, help="Output Minedu-shape CSV")
    parser.add_argument("--provincia", default=None, help="Filter to a single province (e.g. 'Málaga'). Omit for all Andalucía.")
    args = parser.parse_args()

    in_path = Path(args.in_path)
    out_path = Path(args.out_path)
    if not in_path.exists():
        print(f"ERROR: input file not found: {in_path}", file=sys.stderr)
        return 1
    out_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"→ Reading {in_path}")
    if args.provincia:
        print(f"  Filtering to provincia = {args.provincia!r}")

    counts = adapt(in_path, out_path, args.provincia)

    print(f"\n  Read:                 {counts['read']:>5,}")
    print(f"  Kept (after filter):  {counts['kept']:>5,}")
    print(f"  With bilingual flag:  {counts['with_bilingual']:>5,}")
    print(f"\n✓ Wrote {out_path}")
    print("\nNext step:")
    print(f"  python scripts/ingest/enrich_schools.py --region bilingual --minedu-csv {out_path} --dry-run")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
