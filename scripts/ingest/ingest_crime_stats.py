#!/usr/bin/env python3
"""
Ingest MIR crime statistics into the `crime_stats` table.

Source: Ministerio del Interior — Estadísticas de Criminalidad
Portal: https://estadisticasdecriminalidad.ses.mir.es/
Data: Monthly CSV/Excel published at municipio level

The MIR portal requires manual download (no direct API). Steps:
  1. Go to https://estadisticasdecriminalidad.ses.mir.es/
  2. Select "Datos por municipio" → Export CSV
  3. Pass the downloaded file via --csv-path

Alternatively, datos.gob.es hosts annual versions:
  https://datos.gob.es/es/catalogo/l01280796-estadisticas-de-criminalidad

Usage:
  python ingest_crime_stats.py --csv-path criminalidad_2025.csv
  python ingest_crime_stats.py --csv-path criminalidad_2025.csv --year-month 2025-06
"""
import argparse
import csv
import io
import sys
from datetime import date
from _db import get_conn, execute_batch


def parse_mir_csv(path: str, year_month_override: str = None) -> list:
    """
    Parse MIR CSV. Column names vary by publication year — we try common variants.
    Expected format: one row per municipio per month.
    """
    with open(path, encoding="latin-1") as f:
        content = f.read()

    # Try semicolon delimiter (typical Spanish CSV)
    sample = content[:2000]
    delimiter = ";" if sample.count(";") > sample.count(",") else ","

    reader = csv.DictReader(io.StringIO(content), delimiter=delimiter)
    headers = reader.fieldnames or []
    print(f"Columns ({len(headers)}): {headers[:12]}...")

    def col(*candidates):
        for c in candidates:
            if c in headers:
                return c
        return None

    mun_col     = col("MUNICIPIO", "NMUN", "municipio", "DESCRIPCION_MUNICIPIO")
    prov_col    = col("PROVINCIA", "NPRO", "provincia", "DESCRIPCION_PROVINCIA")
    period_col  = col("PERIODO", "FECHA", "AÑO_MES", "period", "MES_ANO")
    violent_col = col("DELITOS_VIDA", "DELITOS_VIOLENTOS", "VIOLENTOS", "violent")
    property_col = col("DELITOS_PATRIMONIO", "DELITOS_PROPIEDAD", "property")
    antisocial_col = col("FALTAS_ORDEN", "ANTISOCIAL", "antisocial")
    total_col   = col("TOTAL_DELITOS", "INFRACCIONES", "TOTAL", "total")

    records = []
    skipped = 0

    for row in reader:
        municipio = (row.get(mun_col) or "").strip() if mun_col else ""
        if not municipio:
            skipped += 1
            continue

        # Parse year_month — MIR uses YYYYMM or YYYY-MM or "Enero 2025" etc.
        if year_month_override:
            ym_str = year_month_override + "-01"
        elif period_col and row.get(period_col):
            raw = str(row[period_col]).strip()
            if len(raw) == 6 and raw.isdigit():
                ym_str = f"{raw[:4]}-{raw[4:6]}-01"
            elif len(raw) == 7 and raw[4] in ("-", "/"):
                ym_str = raw.replace("/", "-") + "-01"
            else:
                ym_str = f"{raw}-01" if len(raw) <= 10 else None
        else:
            ym_str = None

        if not ym_str:
            skipped += 1
            continue

        try:
            year_month = date.fromisoformat(ym_str)
        except ValueError:
            skipped += 1
            continue

        def safe_int(val):
            try:
                return int(str(val).replace(".", "").strip())
            except (ValueError, TypeError):
                return None

        violent   = safe_int(row.get(violent_col)) if violent_col else None
        property_ = safe_int(row.get(property_col)) if property_col else None
        antisocial = safe_int(row.get(antisocial_col)) if antisocial_col else None
        total     = safe_int(row.get(total_col)) if total_col else None

        records.append({
            "municipio":      municipio,
            "provincia":      (row.get(prov_col) or "").strip() if prov_col else None,
            "year_month":     year_month,
            "violent_crime":  violent,
            "property_crime": property_,
            "antisocial":     antisocial,
            "total":          total,
            "per_1000_pop":   None,  # calculated later via INE population join
            "trend_12m":      None,
            "source":         "mir",
        })

    if skipped:
        print(f"Skipped {skipped} rows (missing municipio or date)")

    return records


UPSERT_SQL = """
INSERT INTO crime_stats
    (municipio, provincia, year_month, violent_crime, property_crime, antisocial, total, per_1000_pop, trend_12m, source, updated_at)
VALUES
    (%(municipio)s, %(provincia)s, %(year_month)s, %(violent_crime)s, %(property_crime)s,
     %(antisocial)s, %(total)s, %(per_1000_pop)s, %(trend_12m)s, %(source)s, NOW())
ON CONFLICT (municipio, year_month) DO UPDATE SET
    violent_crime  = EXCLUDED.violent_crime,
    property_crime = EXCLUDED.property_crime,
    antisocial     = EXCLUDED.antisocial,
    total          = EXCLUDED.total,
    source         = EXCLUDED.source,
    updated_at     = NOW()
"""


def main():
    parser = argparse.ArgumentParser(description="Ingest MIR crime stats → Qolify")
    parser.add_argument("--csv-path", required=True, help="Path to MIR CSV/TXT export")
    parser.add_argument("--year-month", help="Override period as YYYY-MM (e.g. 2025-06)")
    args = parser.parse_args()

    records = parse_mir_csv(args.csv_path, args.year_month)
    print(f"Parsed {len(records)} municipio-month rows")

    if not records:
        print("Nothing to insert. Check the column mapping above.")
        return

    conn = get_conn()
    execute_batch(conn, UPSERT_SQL, records)
    conn.close()
    print(f"✓ Done. {len(records)} crime_stats rows written.")


if __name__ == "__main__":
    main()
