from __future__ import annotations
#!/usr/bin/env python3
"""
Ingest MSCBS health waiting time data into the `health_waiting_times` table.

SOURCE
------
Ministerio de Sanidad — Sistema de Información sobre Listas de Espera del SNS
  https://www.sanidad.gob.es/estadEstudios/estadisticas/inforRecopilaciones/listaEspera.htm

NOTE: The download URL changes every quarter (the filename includes the month/year).
      Confirm the current URL at the page above before running.
      Store it in DATA_SOURCES.md after each run.

QUARTERLY MAINTENANCE SCHEDULE
  January   → Q4 previous year data published  → run with --quarter YYYY-Q4
  April     → Q1 data published                → run with --quarter YYYY-Q1
  July      → Q2 data published                → run with --quarter YYYY-Q2
  October   → Q3 data published                → run with --quarter YYYY-Q3

DATA STRUCTURE (as of 2025 — PDF format)
  Page 3: Surgical waiting list — number of patients per specialty per CCAA
  Page 4: Surgical waiting list — mean wait days per specialty per CCAA  (avg_days_surgery)
  Page 7: Consultation waiting list — number of patients per specialty per CCAA
  Page 8: Consultation waiting list — mean wait days per specialty per CCAA  (avg_days_specialist)

  GP wait times are NOT published nationally — only surgical and specialist consultation.
  avg_days_gp is populated only where regional supplements exist (Andalucía, Madrid).

GRANULARITY
  One row per CCAA (17 comunidades + Ceuta + Melilla = 19 rows per quarter).
  health_area_code uses ISO 3166-2:ES codes (ES-AND, ES-AR, etc.)

USAGE
-----
  # Download the latest PDF, then run:
  python ingest_health_waiting.py \\
    --url https://www.sanidad.gob.es/estadEstudios/estadisticas/inforRecopilaciones/docs/Datos_ccaa_jun2025.pdf \\
    --quarter 2025-Q2

  # Dry run (no DB write):
  python ingest_health_waiting.py \\
    --url https://...Datos_ccaa_jun2025.pdf \\
    --quarter 2025-Q2 --dry-run

  # Inspect available columns (use with --dry-run to see what was parsed):
  python ingest_health_waiting.py --url https://... --quarter 2025-Q2 --dry-run

REQUIRES
  pdfplumber   pip3 install pdfplumber
"""
import argparse
import io
import sys
import tempfile
import os
import requests
from datetime import date
from _db import get_conn, execute_batch

# ── CCAA codes and display names ─────────────────────────────────────────────

# Maps PDF CCAA label → ISO 3166-2:ES code used as health_area_code
CCAA_CODE_MAP: dict[str, str] = {
    "ANDALUCÍA":            "ES-AND",
    "ARAGON":               "ES-AR",
    "PDO DE ASTURIAS":      "ES-AST",
    "BALEARES":             "ES-IB",
    "CANARIAS":             "ES-CN",
    "CANTABRIA":            "ES-CB",
    "CASTILLA Y LEON":      "ES-CL",
    "CASTILLA-LA MANCHA":   "ES-CM",
    "CATALUÑA":             "ES-CT",
    "COMUNIDAD VALENCIANA": "ES-VC",
    "EXTREMADURA":          "ES-EX",
    "GALICIA":              "ES-GA",
    "MADRID":               "ES-MD",
    "MURCIA":               "ES-MC",
    "C. FORAL DE NAVARRA":  "ES-NC",
    "C.FORAL DE NAVARRA":   "ES-NC",   # variant without space after period
    "PAÍS VASCO":           "ES-PV",
    "PAIS VASCO":           "ES-PV",   # alternate accent
    "RIOJA":                "ES-RI",
    "CEUTA":                "ES-CE",
    "MELILLA":              "ES-ML",
}

# ── Quarter → recorded_quarter date ──────────────────────────────────────────

QUARTER_MONTHS = {"Q1": 1, "Q2": 4, "Q3": 7, "Q4": 10}


def parse_quarter(quarter_str: str) -> date:
    """
    Convert '2025-Q2' → date(2025, 4, 1) (first day of quarter).
    Also accepts ISO date strings like '2025-04-01'.
    """
    quarter_str = quarter_str.strip().upper()
    if "-Q" in quarter_str:
        parts = quarter_str.split("-Q")
        if len(parts) != 2:
            raise ValueError(f"Invalid quarter format: {quarter_str!r}. Expected e.g. '2025-Q2'")
        year = int(parts[0])
        qnum = "Q" + parts[1]
        if qnum not in QUARTER_MONTHS:
            raise ValueError(f"Quarter must be Q1-Q4, got: {qnum!r}")
        return date(year, QUARTER_MONTHS[qnum], 1)
    else:
        # Try ISO date
        return date.fromisoformat(quarter_str.lower())


# ── Number parsing ────────────────────────────────────────────────────────────

def parse_spanish_number(s: str | None) -> float | None:
    """
    Parse a Spanish-formatted number string.

    Spanish convention:
      Period = thousands separator:  "191.034" → 191034
      Comma  = decimal separator:    "2,5"     → 2.5
      Mixed:                         "1.234,56"→ 1234.56

    Returns None for missing values ('-', 'ND', empty).
    """
    if not s:
        return None
    s = s.strip().replace(' ', '').replace('\xa0', '')
    if s in ('-', 'ND', 'nd', 'N.D.', ''):
        return None
    if '.' in s and ',' in s:
        # e.g. "1.234,56" → 1234.56
        s = s.replace('.', '').replace(',', '.')
    elif '.' in s:
        parts = s.split('.')
        if len(parts) == 2 and len(parts[1]) == 3 and parts[1].isdigit():
            # Thousands separator: "191.034" → "191034"
            s = s.replace('.', '')
        # else treat as decimal point: "3.5" stays "3.5"
    elif ',' in s:
        s = s.replace(',', '.')
    try:
        return float(s)
    except ValueError:
        return None


# ── PDF parsing ───────────────────────────────────────────────────────────────

def extract_ccaa_totals_from_table(table: list[list]) -> dict[str, float | None]:
    """
    Extract CCAA → total value from an MSCBS waiting list table.

    The PDF table format (as extracted by pdfplumber):
      Row 0: empty/header artefact
      Row 1: column headers (CCAA name + specialty names + TOTAL)
      Row 2: BIG data row — cell[0] = all CCAA names joined by \\n
                           cell[1..N-1] = all values for each specialty, joined by \\n
                           cell[-1] = TOTAL value for the FIRST CCAA
      Rows 3+: [None, ..., None, TOTAL value for next CCAA]

    Returns {ccaa_code: total_value_or_None}
    """
    result: dict[str, float | None] = {}

    # Find the "big data row" — the one where cell[0] contains multiple CCAA names.
    # A header row can also contain newlines (multi-line column labels), so require
    # that the split parts actually match known CCAAs.
    data_row_idx = None
    for i, row in enumerate(table):
        if not row or not row[0] or '\n' not in str(row[0]):
            continue
        parts = [p.strip() for p in str(row[0]).split('\n') if p.strip()]
        matched = sum(
            1 for p in parts
            if p in CCAA_CODE_MAP or p.upper() in {k.upper() for k in CCAA_CODE_MAP}
        )
        if matched >= 3:
            data_row_idx = i
            break

    if data_row_idx is None:
        return result

    data_row = table[data_row_idx]

    # Extract CCAA names from first cell
    ccaa_names = [n.strip() for n in str(data_row[0]).split('\n') if n.strip()]

    # TOTAL column is the last cell in each row
    # Row data_row_idx has the first CCAA's total; rows after have subsequent totals
    total_values: list[float | None] = []
    first_total = parse_spanish_number(str(data_row[-1]) if data_row[-1] is not None else None)
    total_values.append(first_total)

    # Collect subsequent CCAA totals from following rows
    for row in table[data_row_idx + 1 :]:
        if row and row[-1] is not None and str(row[-1]).strip():
            total_values.append(parse_spanish_number(str(row[-1])))

    # Match CCAA names to total values by position
    for i, ccaa_name in enumerate(ccaa_names):
        code = CCAA_CODE_MAP.get(ccaa_name)
        if not code:
            # Try normalised lookup
            norm = ccaa_name.upper().strip()
            code = next((v for k, v in CCAA_CODE_MAP.items() if k.upper() == norm), None)
        if not code:
            continue
        total = total_values[i] if i < len(total_values) else None
        result[code] = total

    return result


def parse_pdf(pdf_path: str) -> dict[str, dict]:
    """
    Parse the MSCBS 'Datos por CCAA' PDF.

    Returns a dict keyed by CCAA code:
      {
        'ES-AND': {
          'health_area_name': 'ANDALUCÍA',
          'surgery_waiting_list': 191034,
          'avg_days_surgery': 160.0,
          'avg_days_specialist': 127.0,
        },
        ...
      }
    """
    try:
        import pdfplumber
    except ImportError:
        raise RuntimeError("pdfplumber is required:  pip3 install pdfplumber")

    data: dict[str, dict] = {}

    # Reverse lookup: code → display name
    code_to_name = {v: k for k, v in CCAA_CODE_MAP.items()}

    with pdfplumber.open(pdf_path) as pdf:
        pages = pdf.pages
        n_pages = len(pages)
        print(f"  PDF has {n_pages} pages")

        def best_totals(page_idx: int) -> dict[str, float | None]:
            # Some PDF versions emit multiple tables per page (banner + data).
            # Try each and keep the one that yields the most CCAA rows.
            tables = pages[page_idx].extract_tables() if page_idx < n_pages else []
            best: dict[str, float | None] = {}
            for tbl in tables:
                got = extract_ccaa_totals_from_table(tbl)
                if len(got) > len(best):
                    best = got
            return best

        # Page 3 (index 2): Surgical waiting list — number of patients → surgery_waiting_list
        counts = best_totals(2)
        for code, val in counts.items():
            data.setdefault(code, {})["surgery_waiting_list"] = (
                int(val) if val is not None else None
            )
        print(f"  Page 3: {len(counts)} CCAA surgical patient counts")

        # Page 4 (index 3): Surgical waiting list — mean wait days → avg_days_surgery
        waits = best_totals(3)
        for code, val in waits.items():
            data.setdefault(code, {})["avg_days_surgery"] = val
        print(f"  Page 4: {len(waits)} CCAA surgical wait times")

        # Page 8 (index 7): Consultation waiting list — mean wait days → avg_days_specialist
        consult = best_totals(7)
        for code, val in consult.items():
            data.setdefault(code, {})["avg_days_specialist"] = val
        print(f"  Page 8: {len(consult)} CCAA consultation wait times")

    # Attach display names and initialise missing fields
    for code in list(data.keys()):
        rec = data[code]
        rec.setdefault("health_area_name",      code_to_name.get(code, code))
        rec.setdefault("surgery_waiting_list",   None)
        rec.setdefault("avg_days_surgery",       None)
        rec.setdefault("avg_days_specialist",    None)
        rec["avg_days_gp"] = None   # Not available nationally; regional supplements only

    return data


# ── Download ──────────────────────────────────────────────────────────────────

def download_pdf(url: str) -> str:
    """
    Download the MSCBS PDF to a temp file. Returns the local file path.
    Raises a clear error if the URL returns 404 (URL has changed for this quarter).
    """
    print(f"  Downloading: {url}")
    try:
        resp = requests.get(url, timeout=60)
    except requests.RequestException as e:
        raise RuntimeError(f"Network error downloading PDF: {e}")

    if resp.status_code == 404:
        raise RuntimeError(
            f"\n  ERROR 404: The MSCBS PDF URL returned Not Found.\n"
            f"  The URL changes each quarter. Please:\n"
            f"  1. Visit https://www.sanidad.gob.es/estadEstudios/estadisticas/inforRecopilaciones/listaEspera.htm\n"
            f"  2. Find the 'Datos por Comunidades Autónomas' link for the current quarter\n"
            f"  3. Copy the URL and re-run with --url <new-url>\n"
            f"  4. Update DATA_SOURCES.md with the confirmed URL\n"
            f"  Attempted URL: {url}"
        )

    resp.raise_for_status()

    if 'pdf' not in resp.headers.get('content-type', '').lower() and not url.lower().endswith('.pdf'):
        print(f"  Warning: response Content-Type is {resp.headers.get('content-type')} — may not be a PDF")

    # Write to a named temp file (pdfplumber needs a file path, not a stream)
    tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    tmp.write(resp.content)
    tmp.close()
    print(f"  Downloaded {len(resp.content):,} bytes → {tmp.name}")
    return tmp.name


# ── DB write ──────────────────────────────────────────────────────────────────

UPSERT_SQL = """
INSERT INTO health_waiting_times (
    health_area_code, health_area_name, comunidad_autonoma,
    avg_days_gp, avg_days_specialist, avg_days_surgery,
    surgery_waiting_list, recorded_quarter,
    source, source_url, updated_at
)
VALUES (
    %(health_area_code)s,
    %(health_area_name)s,
    %(comunidad_autonoma)s,
    %(avg_days_gp)s,
    %(avg_days_specialist)s,
    %(avg_days_surgery)s,
    %(surgery_waiting_list)s,
    %(recorded_quarter)s,
    'mscbs',
    %(source_url)s,
    NOW()
)
ON CONFLICT (health_area_code, recorded_quarter) DO UPDATE SET
    health_area_name      = EXCLUDED.health_area_name,
    avg_days_specialist   = EXCLUDED.avg_days_specialist,
    avg_days_surgery      = EXCLUDED.avg_days_surgery,
    surgery_waiting_list  = EXCLUDED.surgery_waiting_list,
    source_url            = EXCLUDED.source_url,
    updated_at            = NOW()
    -- avg_days_gp not updated here; set via regional supplements only
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


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description=(
            "Ingest MSCBS quarterly health waiting time data into health_waiting_times.\n"
            "  Source: https://www.sanidad.gob.es/estadEstudios/estadisticas/inforRecopilaciones/listaEspera.htm"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--url",
        required=True,
        metavar="URL",
        help=(
            "MSCBS 'Datos por CCAA' PDF URL for this quarter.\n"
            "Example (Jun 2025): https://www.sanidad.gob.es/.../Datos_ccaa_jun2025.pdf\n"
            "This URL changes each quarter — confirm at the MSCBS page before running."
        ),
    )
    parser.add_argument(
        "--quarter",
        required=True,
        metavar="YYYY-QN",
        help=(
            "Quarter this data represents. Format: YYYY-Q1 / YYYY-Q2 / YYYY-Q3 / YYYY-Q4.\n"
            "Sets the recorded_quarter field (first day of the quarter).\n"
            "For June 2025 data use: 2025-Q2"
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Download and parse PDF but do not write to DB",
    )
    args = parser.parse_args()

    # Parse quarter → recorded_quarter date
    try:
        recorded_quarter = parse_quarter(args.quarter)
    except ValueError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    print(f"\n→ Ingesting MSCBS health waiting data")
    print(f"  Quarter:           {args.quarter}  →  recorded_quarter = {recorded_quarter}")
    print(f"  URL:               {args.url}")

    # Download PDF
    print("\n→ [Step 1/3] Downloading PDF...")
    try:
        pdf_path = download_pdf(args.url)
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)

    # Parse PDF
    print("\n→ [Step 2/3] Parsing PDF tables...")
    try:
        ccaa_data = parse_pdf(pdf_path)
    finally:
        # Always clean up the temp file
        try:
            os.unlink(pdf_path)
        except OSError:
            pass

    if not ccaa_data:
        print("ERROR: No data extracted from PDF. The format may have changed.", file=sys.stderr)
        print("  Try running with --dry-run to inspect the PDF structure.", file=sys.stderr)
        sys.exit(1)

    print(f"  Extracted data for {len(ccaa_data)} comunidades autónomas")

    # Build records
    records = []
    for code, fields in ccaa_data.items():
        records.append({
            "health_area_code":  code,
            "health_area_name":  fields["health_area_name"],
            "comunidad_autonoma": fields["health_area_name"],
            "avg_days_gp":       fields.get("avg_days_gp"),
            "avg_days_specialist": fields.get("avg_days_specialist"),
            "avg_days_surgery":  fields.get("avg_days_surgery"),
            "surgery_waiting_list": fields.get("surgery_waiting_list"),
            "recorded_quarter":  recorded_quarter,
            "source_url":        args.url,
        })

    # Print summary table
    print(f"\n  {'CCAA':<25} {'Code':<8} {'Surgical wait':>14} {'Patients':>10} {'Consult wait':>13}")
    print(f"  {'-'*24} {'-'*7} {'-'*14} {'-'*10} {'-'*13}")
    for rec in sorted(records, key=lambda r: r["health_area_code"]):
        surg  = f"{rec['avg_days_surgery']:.0f}d" if rec['avg_days_surgery'] else "n/a"
        pats  = f"{rec['surgery_waiting_list']:,}" if rec['surgery_waiting_list'] else "n/a"
        cons  = f"{rec['avg_days_specialist']:.0f}d" if rec['avg_days_specialist'] else "n/a"
        print(f"  {rec['health_area_name']:<25} {rec['health_area_code']:<8} {surg:>14} {pats:>10} {cons:>13}")

    # Step 3: Write to DB
    if args.dry_run:
        print(f"\n  [dry-run] Would upsert {len(records)} rows into health_waiting_times.")
        print("  No DB writes performed.")
        return

    print(f"\n→ [Step 3/3] Writing {len(records)} rows to DB...")
    conn = get_conn()
    execute_batch(conn, UPSERT_SQL, records)
    print(f"  Upserted {len(records)} rows into health_waiting_times.")

    refresh_enrichment_view(conn)
    conn.close()

    print(f"\n✓ Done. {args.quarter} health waiting data loaded.")
    print(
        f"\n  Remember to update DATA_SOURCES.md with:\n"
        f"    Quarter: {args.quarter}\n"
        f"    URL:     {args.url}\n"
        f"    Date:    {date.today()}"
    )
    print(
        "\n  Next quarterly run:\n"
        "    Check https://www.sanidad.gob.es/estadEstudios/estadisticas/inforRecopilaciones/listaEspera.htm\n"
        "    for the new 'Datos por CCAA' URL each January, April, July, and October."
    )


if __name__ == "__main__":
    main()
