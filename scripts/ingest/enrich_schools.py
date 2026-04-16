from __future__ import annotations
#!/usr/bin/env python3
"""
Enrich the existing `schools` table with quality indicators.

This script is a complement to ingest_schools.py — it does NOT re-ingest schools,
it only adds enrichment columns to rows that already exist.

DATA SOURCES
------------

1. Minedu CSV (bilingual status, canteen, sports facilities, source_id)
   - Download from: https://www.educacion.gob.es/centros/buscarCentros.do
   - Click 'Búsqueda completa' → Export → CSV (all Spain, ~28,000 centres)
   - Columns used: CODIGO_CENTRO, COMEDOR, PROGRAMAS_EDUCATIVOS,
                   INSTALACIONES / DEPORTE, LATITUD, LONGITUD

2. Andalucía Evaluación de Diagnóstico (diagnostic test scores)
   - The Junta de Andalucía publishes school-level results annually (~June)
   - Navigate to: https://www.juntadeandalucia.es/educacion
   - Search for "Evaluación de Diagnóstico resultados centros"
   - Download the Excel/CSV with per-school scores by Código de Centro
   - Columns: CÓDIGO DE CENTRO (or CODCEN), subject scores (0–100 or 0–10 — see below)

3. Madrid Evaluación de Diagnóstico
   - Navigate to: https://www.comunidad.madrid/servicios/educacion
   - Search for "resultados evaluación diagnóstico centros"
   - Download the Excel/CSV
   - Same matching pattern as Andalucía

CRITICAL RULE
-------------
Where data is unavailable, preserve NULL — never fabricate a score.
The UI shows "Academic data not available for this region" when diagnostic_score is NULL.

USAGE
-----
  # Step 1: Backfill source_id and set bilingual/facilities from Minedu CSV
  python enrich_schools.py --region bilingual --minedu-csv centros.csv

  # Step 2: Load Andalucía diagnostic scores
  python enrich_schools.py --region andalucia --diagnostic-csv andalucia_diag_2024.csv

  # Step 3: Load Madrid diagnostic scores
  python enrich_schools.py --region madrid --diagnostic-csv madrid_diag_2024.csv

  # All steps in one run (requires all three files)
  python enrich_schools.py --region all \\
    --minedu-csv centros.csv \\
    --andalucia-csv andalucia_diag_2024.csv \\
    --madrid-csv madrid_diag_2024.csv

  # Dry run — shows counts and sample matches without writing
  python enrich_schools.py --region bilingual --minedu-csv centros.csv --dry-run

REQUIRES
  openpyxl   pip3 install openpyxl   (for .xlsx diagnostic files)
  xlrd       pip3 install xlrd       (for .xls diagnostic files)
"""
import argparse
import csv
import io
import os
import sys
import unicodedata
from pathlib import Path
from _db import get_conn

# ── Normalisation helper ─────────────────────────────────────────────────────

def normalize(s: str) -> str:
    """Lowercase, strip accents, collapse whitespace."""
    if not s:
        return ""
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return " ".join(s.lower().split())


# ── Bilingual language detection ─────────────────────────────────────────────

# Maps normalised programme name keywords → ISO 639-1 language codes
BILINGUAL_LANG_MAP = [
    (["ingles", "ingles"], "en"),
    (["frances", "frances"], "fr"),
    (["aleman", "aleman"], "de"),
    (["italiano"], "it"),
    (["portugues"], "pt"),
    (["chino", "mandarin"], "zh"),
    (["arabe"], "ar"),
    (["japones"], "ja"),
]

def detect_bilingual_languages(programas_raw: str) -> list[str] | None:
    """
    Extract ISO 639-1 language codes from a Minedu PROGRAMAS_EDUCATIVOS string.

    Examples:
      "BILINGÜE INGLÉS; PROGRAMA LECTURA" → ['es', 'en']
      "BILINGÜE FRANCÉS-INGLÉS"          → ['es', 'fr', 'en']
      "PROGRAMA LECTURA"                  → None (no bilingual programme)

    Spanish is always included if any language is found (all Spanish schools
    teach in Spanish; bilingual means a second language is also used).
    """
    if not programas_raw:
        return None
    norm = normalize(programas_raw)
    if "bilingue" not in norm and "bilingüe" not in norm.replace("bilingue", ""):
        return None

    langs = ["es"]  # Spanish always first
    for keywords, code in BILINGUAL_LANG_MAP:
        if any(kw in norm for kw in keywords):
            langs.append(code)

    return langs if len(langs) > 1 else None


# ── Minedu CSV column detection ──────────────────────────────────────────────

# Known column name variants in the Minedu CSV exports
MINEDU_COL_VARIANTS = {
    "source_id":    ["CODIGO_CENTRO", "COD_CENTRO", "CODCEN", "cod_centro", "codigo_centro"],
    "nombre":       ["NOMBRE_CENTRO", "DCENTRO", "NOMBRE", "nombre_centro"],
    "lat":          ["LATITUD", "LAT", "latitud", "lat"],
    "lng":          ["LONGITUD", "LON", "longitud", "lon"],
    "programas":    ["PROGRAMAS_EDUCATIVOS", "PROGRAMAS", "programas_educativos", "PROG_EDUC"],
    "comedor":      ["COMEDOR", "comedor", "TIENE_COMEDOR"],
    "instalaciones":["INSTALACIONES_DEPORTIVAS", "DEPORTE", "INSTALACIONES", "instalaciones"],
    "municipio":    ["MUNICIPIO", "CNMUN", "municipio", "NOM_MUNICIPIO"],
    "provincia":    ["PROVINCIA", "DSC_PROVINCIA", "provincia"],
}


def detect_col(headers: list[str], field: str) -> str | None:
    """Return the actual header name matching any known variant for `field`."""
    header_lower = {h.upper(): h for h in headers}
    for variant in MINEDU_COL_VARIANTS.get(field, []):
        if variant.upper() in header_lower:
            return header_lower[variant.upper()]
    return None


# ── Minedu CSV parsing ────────────────────────────────────────────────────────

def parse_minedu_csv(csv_path: str) -> list[dict]:
    """
    Parse the Minedu 'centros' CSV into enrichment records.

    Returns list of dicts with:
      source_id, lat, lng, bilingual_languages, has_canteen, has_sports_facilities
    """
    encoding = "latin-1"  # Minedu CSVs are typically Latin-1 encoded
    with open(csv_path, "rb") as f:
        raw = f.read()
    # Try UTF-8 first (some editions use it), fall back to latin-1
    for enc in ("utf-8-sig", "utf-8", "latin-1", "cp1252"):
        try:
            content = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise ValueError(f"Could not decode {csv_path} with any known encoding")

    # Detect delimiter (semicolon is standard for Spanish government CSVs)
    sample = content[:4096]
    delimiter = ";" if sample.count(";") >= sample.count(",") else ","

    reader = csv.DictReader(io.StringIO(content), delimiter=delimiter)
    headers = reader.fieldnames or []

    # Detect columns
    cols = {field: detect_col(headers, field) for field in MINEDU_COL_VARIANTS}

    if not cols["source_id"]:
        print(f"  Warning: No CODIGO_CENTRO column found in {csv_path}")
        print(f"  Available columns: {headers[:15]}")
        print("  Cannot link to DB by source_id. Proximity matching will be used.")

    if not cols["lat"] or not cols["lng"]:
        print(f"  Warning: No lat/lng columns found. Cannot proximity-match without coordinates.")

    records = []
    for row in reader:
        source_id = (row.get(cols["source_id"]) or "").strip() if cols["source_id"] else None

        # Coordinates for proximity matching
        try:
            lat = float((row.get(cols["lat"]) or "").replace(",", ".")) if cols["lat"] else None
            lng = float((row.get(cols["lng"]) or "").replace(",", ".")) if cols["lng"] else None
        except (ValueError, TypeError):
            lat, lng = None, None

        if not source_id and lat is None:
            continue  # Can't match this row to the DB

        # Bilingual languages
        programas = (row.get(cols["programas"]) or "") if cols["programas"] else ""
        bilingual = detect_bilingual_languages(programas)

        # Canteen
        comedor_raw = (row.get(cols["comedor"]) or "").strip().upper() if cols["comedor"] else ""
        has_canteen = comedor_raw in ("S", "SI", "1", "YES", "TRUE", "VERDADERO") or None

        # Sports facilities
        inst_raw = normalize(row.get(cols["instalaciones"]) or "") if cols["instalaciones"] else ""
        has_sports = bool(inst_raw and any(
            kw in inst_raw for kw in ("pista", "gimnasio", "polideportivo", "deport", "sport", "field")
        )) if inst_raw else None

        nombre = (row.get(cols["nombre"]) or "").strip() if cols["nombre"] else None

        records.append({
            "source_id":           source_id,
            "nombre":              nombre,
            "lat":                 lat,
            "lng":                 lng,
            "bilingual_languages": bilingual,
            "has_canteen":         has_canteen,
            "has_sports_facilities": has_sports,
        })

    return records


# ── Minedu DB enrichment ─────────────────────────────────────────────────────

# Update by source_id (for schools that already have source_id set from a previous run)
UPDATE_BY_SOURCE_ID_SQL = """
UPDATE schools SET
    bilingual_languages     = %(bilingual_languages)s,
    has_canteen             = %(has_canteen)s,
    has_sports_facilities   = %(has_sports_facilities)s,
    updated_at              = NOW()
WHERE source_id = %(source_id)s
  AND source_id IS NOT NULL
"""

# Set source_id + enrichment by proximity (within 100m) — for first run
# Uses a CTE to ensure at most one school is updated per Minedu row
UPDATE_BY_PROXIMITY_SQL = """
WITH target AS (
    SELECT id FROM schools
    WHERE source_id IS NULL
      AND ST_DWithin(
            geom,
            ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::GEOGRAPHY,
            100
          )
    ORDER BY ST_Distance(geom, ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::GEOGRAPHY)
    LIMIT 1
)
UPDATE schools SET
    source_id               = %(source_id)s,
    bilingual_languages     = %(bilingual_languages)s,
    has_canteen             = %(has_canteen)s,
    has_sports_facilities   = %(has_sports_facilities)s,
    updated_at              = NOW()
FROM target
WHERE schools.id = target.id
"""


def run_bilingual_enrichment(conn, records: list[dict], dry_run: bool) -> dict:
    """
    Apply Minedu CSV enrichment to the schools table.
    Returns counts: {by_source_id, by_proximity, skipped, bilingual_count}
    """
    counts = {"by_source_id": 0, "by_proximity": 0, "skipped": 0, "bilingual_count": 0}

    for rec in records:
        if dry_run:
            if rec.get("bilingual_languages"):
                counts["bilingual_count"] += 1
            counts["by_source_id"] += 1  # approximate
            continue

        with conn.cursor() as cur:
            # Strategy 1: update by source_id
            if rec["source_id"]:
                cur.execute(UPDATE_BY_SOURCE_ID_SQL, rec)
                if cur.rowcount > 0:
                    counts["by_source_id"] += cur.rowcount
                    if rec.get("bilingual_languages"):
                        counts["bilingual_count"] += 1
                    continue

            # Strategy 2: proximity fallback (only if we have coords)
            if rec["lat"] is not None and rec["lng"] is not None:
                cur.execute(UPDATE_BY_PROXIMITY_SQL, rec)
                if cur.rowcount > 0:
                    counts["by_proximity"] += cur.rowcount
                    if rec.get("bilingual_languages"):
                        counts["bilingual_count"] += 1
                else:
                    counts["skipped"] += 1
            else:
                counts["skipped"] += 1

        conn.commit()

    return counts


# ── Diagnostic CSV parsing ────────────────────────────────────────────────────

# Known column name variants for diagnostic CSV files
DIAG_COL_VARIANTS = {
    "source_id":   ["CÓDIGO DE CENTRO", "CODIGO DE CENTRO", "CODCEN", "COD_CENTRO",
                    "CODIGO_CENTRO", "cod_centro", "codigo_centro"],
    "score_math":  ["MATEMÁTICAS", "MATEMATICAS", "MATH", "COMPETENCIA MATEMATICA",
                    "COMPETENCIA_MATEMATICA", "MAT"],
    "score_lang":  ["LENGUA", "CASTELLANO", "ESPAÑOL", "LENGUA Y LITERATURA",
                    "COMUNICACION LINGUISTICA", "LENGUA_CASTELLANA", "LEN"],
    "score_avg":   ["PUNTUACIÓN MEDIA", "PUNTUACION MEDIA", "MEDIA", "TOTAL",
                    "PUNTUACION_MEDIA", "NOTA_MEDIA"],
    "school_name": ["DENOMINACIÓN DEL CENTRO", "DENOMINACION DEL CENTRO",
                    "NOMBRE DEL CENTRO", "NOMBRE_CENTRO", "NOMBRE"],
}


def parse_diagnostic_file(file_path: str, region: str) -> list[dict]:
    """
    Parse a regional diagnostic test results file (Excel or CSV).

    Expects at minimum: a school code column and one or more score columns.
    Scores are normalised to 0–100 (some regions publish 0–10 scale).

    Returns list of dicts: {source_id, diagnostic_score, diagnostic_year}
    """
    ext = Path(file_path).suffix.lower()

    if ext in (".xlsx", ".xls"):
        rows = _read_excel(file_path)
    elif ext in (".csv", ".tsv"):
        rows = _read_csv_file(file_path)
    else:
        raise ValueError(f"Unsupported file format: {ext}. Expected .xlsx, .xls, or .csv")

    if not rows:
        print(f"  Warning: No rows read from {file_path}")
        return []

    # Detect columns
    headers = list(rows[0].keys()) if rows else []
    cols = {field: detect_diag_col(headers, field) for field in DIAG_COL_VARIANTS}

    if not cols["source_id"]:
        print(f"\n  ERROR: No school code column found in {file_path}")
        print(f"  Available columns: {headers[:15]}")
        print("  Cannot match to schools table without a centro code column.")
        print("  Known variants: " + str(DIAG_COL_VARIANTS["source_id"][:5]))
        return []

    print(f"  School code column: '{cols['source_id']}'")
    print(f"  Score columns detected: math={cols['score_math']}, lang={cols['score_lang']}, avg={cols['score_avg']}")

    # Try to extract year from filename (e.g. "andalucia_2024.xlsx" → 2024)
    import re
    year_match = re.search(r"(20\d{2})", file_path)
    diagnostic_year = int(year_match.group(1)) if year_match else None

    source_label = f"evaluacion_diagnostico_{region[:3]}"

    records = []
    for row in rows[1:]:  # Skip header row
        source_id = str(row.get(cols["source_id"]) or "").strip()
        if not source_id or source_id in ("-", "ND", ""):
            continue

        # Collect available scores
        scores = []
        for score_col in [cols["score_avg"], cols["score_math"], cols["score_lang"]]:
            if score_col:
                val = _parse_score(row.get(score_col))
                if val is not None:
                    scores.append(val)

        if not scores:
            continue

        raw_score = sum(scores) / len(scores)

        # Normalise to 0–100 scale
        # Spanish regional diagnostics use 0–10 or 0–100, sometimes 0–500 (PISA-style)
        diagnostic_score = _normalise_score(raw_score)

        records.append({
            "source_id":        source_id,
            "diagnostic_score": round(diagnostic_score, 2),
            "diagnostic_year":  diagnostic_year,
            "diagnostic_source": source_label,
        })

    return records


def detect_diag_col(headers: list[str], field: str) -> str | None:
    """Return the actual header matching any known variant for diagnostic columns."""
    header_lower = {normalize(h): h for h in headers}
    for variant in DIAG_COL_VARIANTS.get(field, []):
        norm_variant = normalize(variant)
        if norm_variant in header_lower:
            return header_lower[norm_variant]
    return None


def _read_excel(file_path: str) -> list[dict]:
    """Read an Excel file into a list of dicts (first sheet)."""
    try:
        import openpyxl
        wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            return []
        headers = [str(h or "").strip() for h in rows[0]]
        return [dict(zip(headers, row)) for row in rows[1:]]
    except ImportError:
        pass

    # xlrd fallback for .xls
    try:
        import xlrd
        wb = xlrd.open_workbook(file_path)
        ws = wb.sheet_by_index(0)
        headers = [str(ws.cell_value(0, c)).strip() for c in range(ws.ncols)]
        return [
            {headers[c]: ws.cell_value(r, c) for c in range(ws.ncols)}
            for r in range(1, ws.nrows)
        ]
    except ImportError:
        raise RuntimeError("openpyxl or xlrd required for Excel files:  pip3 install openpyxl xlrd")


def _read_csv_file(file_path: str) -> list[dict]:
    """Read a CSV/TSV file into a list of dicts."""
    with open(file_path, "rb") as f:
        raw = f.read()
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            content = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    sample = content[:4096]
    delimiter = "\t" if sample.count("\t") > sample.count(";") else (
        ";" if sample.count(";") >= sample.count(",") else ","
    )
    reader = csv.DictReader(io.StringIO(content), delimiter=delimiter)
    return list(reader)


def _parse_score(val) -> float | None:
    if val is None:
        return None
    try:
        f = float(str(val).replace(",", ".").strip())
        return f if f > 0 else None
    except (ValueError, TypeError):
        return None


def _normalise_score(raw: float) -> float:
    """Normalise a raw score to 0–100 scale."""
    if raw <= 10:
        return raw * 10   # 0–10 → 0–100
    elif raw <= 100:
        return raw        # already 0–100
    elif raw <= 500:
        return (raw / 500) * 100   # 0–500 (PISA-style) → 0–100
    else:
        return min(raw, 100)


# ── Diagnostic DB enrichment ─────────────────────────────────────────────────

UPDATE_DIAGNOSTIC_SQL = """
UPDATE schools SET
    diagnostic_score  = %(diagnostic_score)s,
    diagnostic_year   = %(diagnostic_year)s,
    diagnostic_source = %(diagnostic_source)s,
    updated_at        = NOW()
WHERE source_id = %(source_id)s
  AND source_id IS NOT NULL
"""


def run_diagnostic_enrichment(conn, records: list[dict], dry_run: bool) -> int:
    """Apply diagnostic scores to schools. Returns count of schools updated."""
    if dry_run:
        print(f"  [dry-run] Would update diagnostic scores for up to {len(records)} schools")
        if records:
            sample = records[:3]
            print(f"  Sample records:")
            for r in sample:
                print(f"    source_id={r['source_id']!r}  score={r['diagnostic_score']}  year={r['diagnostic_year']}")
        return len(records)

    updated = 0
    with conn.cursor() as cur:
        for rec in records:
            cur.execute(UPDATE_DIAGNOSTIC_SQL, rec)
            updated += cur.rowcount
    conn.commit()
    return updated


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Enrich the schools table with bilingual status and diagnostic scores.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--region",
        choices=["bilingual", "andalucia", "madrid", "all"],
        required=True,
        help=(
            "bilingual  — enrich bilingual_languages, has_canteen, has_sports_facilities from Minedu CSV\n"
            "andalucia  — load Evaluación de Diagnóstico scores for Andalucía schools\n"
            "madrid     — load Evaluación de Diagnóstico scores for Madrid schools\n"
            "all        — run all three (requires --minedu-csv, --andalucia-csv, --madrid-csv)"
        ),
    )
    parser.add_argument(
        "--minedu-csv",
        metavar="PATH",
        help=(
            "Path to Minedu 'centros' CSV (required for --region bilingual or all).\n"
            "Download from: https://www.educacion.gob.es/centros/buscarCentros.do\n"
            "→ Búsqueda completa → Export CSV"
        ),
    )
    parser.add_argument(
        "--andalucia-csv",
        metavar="PATH",
        help=(
            "Path to Andalucía Evaluación de Diagnóstico file (.xlsx or .csv).\n"
            "Find at: https://www.juntadeandalucia.es/educacion (search 'evaluacion diagnostico centros')"
        ),
    )
    parser.add_argument(
        "--madrid-csv",
        metavar="PATH",
        help=(
            "Path to Madrid Evaluación de Diagnóstico file (.xlsx or .csv).\n"
            "Find at: https://www.comunidad.madrid/servicios/educacion"
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse files and show counts but do not write to DB",
    )
    args = parser.parse_args()

    # Validate required files
    if args.region in ("bilingual", "all") and not args.minedu_csv:
        parser.error("--minedu-csv is required for --region bilingual or all")
    if args.region in ("andalucia", "all") and not args.andalucia_csv:
        parser.error("--andalucia-csv is required for --region andalucia or all")
    if args.region in ("madrid", "all") and not args.madrid_csv:
        parser.error("--madrid-csv is required for --region madrid or all")

    for path_arg, label in [
        (args.minedu_csv, "Minedu CSV"),
        (args.andalucia_csv, "Andalucía diagnostic"),
        (args.madrid_csv, "Madrid diagnostic"),
    ]:
        if path_arg and not os.path.exists(path_arg):
            print(f"ERROR: File not found: {path_arg} ({label})", file=sys.stderr)
            sys.exit(1)

    conn = get_conn() if not args.dry_run else None

    # ── Bilingual / facilities enrichment ────────────────────────────────
    if args.region in ("bilingual", "all"):
        print(f"\n→ [Bilingual/Facilities] Parsing {args.minedu_csv}...")
        minedu_records = parse_minedu_csv(args.minedu_csv)
        print(f"  Parsed {len(minedu_records)} school records from Minedu CSV")

        bilingual_total = sum(1 for r in minedu_records if r.get("bilingual_languages"))
        canteen_total   = sum(1 for r in minedu_records if r.get("has_canteen") is True)
        print(f"  With bilingual info: {bilingual_total}")
        print(f"  With canteen info: {canteen_total}")

        print(f"  Applying to schools table...")
        counts = run_bilingual_enrichment(conn, minedu_records, args.dry_run)

        print(f"\n  Results:")
        print(f"    Updated by source_id:    {counts['by_source_id']:>6,}")
        print(f"    Updated by proximity:    {counts['by_proximity']:>6,}")
        print(f"    Skipped (no match):      {counts['skipped']:>6,}")
        print(f"    With bilingual_languages:{counts['bilingual_count']:>6,}")

    # ── Andalucía diagnostic ──────────────────────────────────────────────
    if args.region in ("andalucia", "all"):
        print(f"\n→ [Andalucía Diagnostic] Parsing {args.andalucia_csv}...")
        and_records = parse_diagnostic_file(args.andalucia_csv, "andalucia")
        print(f"  Parsed {len(and_records)} school diagnostic records")

        if and_records:
            scores = [r["diagnostic_score"] for r in and_records]
            print(f"  Score range: {min(scores):.1f} – {max(scores):.1f} (mean: {sum(scores)/len(scores):.1f})")

        updated = run_diagnostic_enrichment(conn, and_records, args.dry_run)
        print(f"  Schools updated with Andalucía diagnostic scores: {updated:,}")

    # ── Madrid diagnostic ─────────────────────────────────────────────────
    if args.region in ("madrid", "all"):
        print(f"\n→ [Madrid Diagnostic] Parsing {args.madrid_csv}...")
        mad_records = parse_diagnostic_file(args.madrid_csv, "madrid")
        print(f"  Parsed {len(mad_records)} school diagnostic records")

        if mad_records:
            scores = [r["diagnostic_score"] for r in mad_records]
            print(f"  Score range: {min(scores):.1f} – {max(scores):.1f} (mean: {sum(scores)/len(scores):.1f})")

        updated = run_diagnostic_enrichment(conn, mad_records, args.dry_run)
        print(f"  Schools updated with Madrid diagnostic scores: {updated:,}")

    if conn:
        conn.close()

    print(f"\n✓ Done.")

    if not args.dry_run and args.region in ("bilingual", "all"):
        print(
            "\n  NOTE: Schools that could not be matched (no source_id and no nearby school in DB)\n"
            "  have been skipped. Their diagnostic_score remains NULL.\n"
            "  The UI will show 'Academic data not available' for these schools — correct behaviour."
        )


if __name__ == "__main__":
    main()
