"""
Regression tests for adapt_junta_bilingues_to_minedu.py (CHI-373).

The adapter converts Junta de Andalucía bilingual-schools CSV rows into
Minedu-shape rows that enrich_schools.py can consume. These tests pin the
core behaviours: derive_programas() language flattening, normalise_decimal()
European-format handling, and adapt() province filtering + counts.

Run:  python3 scripts/ingest/test_adapt_junta_bilingues.py
"""
from __future__ import annotations

import csv
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from adapt_junta_bilingues_to_minedu import (  # noqa: E402
    adapt,
    derive_programas,
    normalise_decimal,
)


# ── derive_programas ────────────────────────────────────────────────────────

def test_single_stage_english():
    row = {"Infantil_2_ciclo": "BIL ING", "Primaria": "", "ESO": "", "Bachillerato": ""}
    assert derive_programas(row) == "BILINGÜE INGLÉS"


def test_multiple_stages_dedupe():
    # Same language across stages should appear once.
    row = {"Infantil_2_ciclo": "BIL ING", "Primaria": "BIL ING", "ESO": "BIL ING", "Bachillerato": ""}
    assert derive_programas(row) == "BILINGÜE INGLÉS"


def test_multiple_languages_ordered():
    # Order of phrases follows STAGE_COLS iteration; English first if it appears first.
    row = {"Infantil_2_ciclo": "BIL ING", "Primaria": "BIL FRA", "ESO": "", "Bachillerato": "BIL ALE"}
    out = derive_programas(row)
    assert "BILINGÜE INGLÉS" in out
    assert "BILINGÜE FRANCÉS" in out
    assert "BILINGÜE ALEMÁN" in out
    assert out.count(";") == 2


def test_empty_and_unrecognised_flags():
    row = {"Infantil_2_ciclo": "", "Primaria": "BIL XYZ", "ESO": None, "Bachillerato": ""}
    # Unrecognised language is silently dropped (fail-safe — won't crash on new codes).
    assert derive_programas(row) == ""


def test_case_and_whitespace_tolerance():
    row = {"Infantil_2_ciclo": "  bil ing  ", "Primaria": "", "ESO": "", "Bachillerato": ""}
    assert derive_programas(row) == "BILINGÜE INGLÉS"


# ── normalise_decimal ──────────────────────────────────────────────────────

def test_normalise_european_decimal():
    assert normalise_decimal("36,7193") == "36.7193"


def test_normalise_already_dot():
    assert normalise_decimal("36.7193") == "36.7193"


def test_normalise_blank():
    assert normalise_decimal("") == ""
    assert normalise_decimal(None) == ""


# ── adapt() integration ────────────────────────────────────────────────────

def _write_junta_csv(path: Path, rows: list[dict]) -> None:
    """Write a synthetic Junta-shape CSV (Latin-1, ';' delimited)."""
    fields = [
        "codigo", "D_ESPECIFICA", "D_MUNICIPIO", "D_PROVINCIA",
        "N_LATITUD", "N_LONGITUD",
        "Infantil_2_ciclo", "Primaria", "ESO", "Bachillerato",
    ]
    with path.open("w", encoding="latin-1", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, delimiter=";")
        w.writeheader()
        for row in rows:
            w.writerow(row)


def test_adapt_filters_by_provincia_and_counts():
    with tempfile.TemporaryDirectory() as td:
        in_path = Path(td) / "in.csv"
        out_path = Path(td) / "out.csv"
        _write_junta_csv(in_path, [
            # Two Málaga rows (one bilingual, one not), plus one Sevilla row that should be filtered out.
            {"codigo": "29001234", "D_ESPECIFICA": "CEIP Centro", "D_MUNICIPIO": "Málaga",
             "D_PROVINCIA": "Málaga", "N_LATITUD": "36,7193", "N_LONGITUD": "-4,4197",
             "Infantil_2_ciclo": "BIL ING", "Primaria": "BIL ING", "ESO": "", "Bachillerato": ""},
            {"codigo": "29005678", "D_ESPECIFICA": "CEIP Mar", "D_MUNICIPIO": "Torremolinos",
             "D_PROVINCIA": "Málaga", "N_LATITUD": "36,6234", "N_LONGITUD": "-4,5009",
             "Infantil_2_ciclo": "", "Primaria": "", "ESO": "", "Bachillerato": ""},
            {"codigo": "41009999", "D_ESPECIFICA": "IES Sevilla", "D_MUNICIPIO": "Sevilla",
             "D_PROVINCIA": "Sevilla", "N_LATITUD": "37,3886", "N_LONGITUD": "-5,9823",
             "Infantil_2_ciclo": "", "Primaria": "BIL FRA", "ESO": "", "Bachillerato": ""},
        ])

        counts = adapt(in_path, out_path, provincia_filter="Málaga")

        assert counts["read"] == 3
        assert counts["kept"] == 2          # Sevilla filtered out
        assert counts["with_bilingual"] == 1  # Only the first Málaga row has BIL flags

        # Verify the output CSV is shaped correctly for enrich_schools.py
        with out_path.open(encoding="utf-8") as f:
            out_rows = list(csv.DictReader(f, delimiter=";"))

        assert len(out_rows) == 2
        # Coordinates normalised to dot decimals
        assert out_rows[0]["LATITUD"] == "36.7193"
        assert out_rows[0]["LONGITUD"] == "-4.4197"
        # PROGRAMAS_EDUCATIVOS contains the phrase the enricher recognises
        assert out_rows[0]["PROGRAMAS_EDUCATIVOS"] == "BILINGÜE INGLÉS"
        # Non-bilingual Málaga school: empty PROGRAMAS so the enricher leaves it alone
        assert out_rows[1]["PROGRAMAS_EDUCATIVOS"] == ""
        # COMEDOR/INSTALACIONES blank — Junta CSV doesn't carry these
        assert out_rows[0]["COMEDOR"] == ""


def test_adapt_no_filter_keeps_all():
    with tempfile.TemporaryDirectory() as td:
        in_path = Path(td) / "in.csv"
        out_path = Path(td) / "out.csv"
        _write_junta_csv(in_path, [
            {"codigo": "29001234", "D_ESPECIFICA": "CEIP A", "D_MUNICIPIO": "M",
             "D_PROVINCIA": "Málaga", "N_LATITUD": "36,7", "N_LONGITUD": "-4,4",
             "Infantil_2_ciclo": "BIL ING", "Primaria": "", "ESO": "", "Bachillerato": ""},
            {"codigo": "41009999", "D_ESPECIFICA": "IES B", "D_MUNICIPIO": "S",
             "D_PROVINCIA": "Sevilla", "N_LATITUD": "37,3", "N_LONGITUD": "-5,9",
             "Infantil_2_ciclo": "", "Primaria": "BIL FRA", "ESO": "", "Bachillerato": ""},
        ])
        counts = adapt(in_path, out_path, provincia_filter=None)
        assert counts["read"] == 2
        assert counts["kept"] == 2
        assert counts["with_bilingual"] == 2


# ── runner ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    tests = [
        ("derive_programas: single stage English",     test_single_stage_english),
        ("derive_programas: dedupe across stages",     test_multiple_stages_dedupe),
        ("derive_programas: multiple languages",       test_multiple_languages_ordered),
        ("derive_programas: empty + unrecognised",     test_empty_and_unrecognised_flags),
        ("derive_programas: case/whitespace tolerant", test_case_and_whitespace_tolerance),
        ("normalise_decimal: european",                test_normalise_european_decimal),
        ("normalise_decimal: already dot",             test_normalise_already_dot),
        ("normalise_decimal: blank/None",              test_normalise_blank),
        ("adapt: provincia filter + counts",           test_adapt_filters_by_provincia_and_counts),
        ("adapt: no filter keeps all",                 test_adapt_no_filter_keeps_all),
    ]
    failures = 0
    for name, fn in tests:
        try:
            fn()
            print(f"  ✓ {name}")
        except AssertionError as e:
            failures += 1
            print(f"  ✗ {name}: {e}")
    print(f"\n{len(tests) - failures}/{len(tests)} passed")
    sys.exit(1 if failures else 0)
