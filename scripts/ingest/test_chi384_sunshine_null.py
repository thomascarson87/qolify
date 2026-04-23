"""
CHI-384 regression guard: precipitation-only AEMET stations must NOT write
sunshine_hours_annual=0. They must write NULL so the UPSERT's "> 0" guard
preserves any existing good data and the solar-potential indicator treats
them as missing, not as "zero sunshine".

Run:   python3 scripts/ingest/test_chi384_sunshine_null.py
"""
from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from ingest_aemet_climate import build_climate_record  # noqa: E402


def _normals(temp: float, insol: float | str, rain: float = 10.0, hum: float = 60.0):
    """Build 12 monthly + 1 annual AEMET-shaped records."""
    rows = []
    for mes in range(1, 13):
        rows.append({
            "mes": mes,
            "tm_mes_md": str(temp).replace(".", ","),
            "inso_md": "" if insol == "" else str(insol).replace(".", ","),
            "p_mes_md": str(rain),
            "hr_md": str(hum),
        })
    rows.append({"mes": 13, "ss": "2500"})
    return rows


def test_precip_only_station_writes_null_sunshine():
    """AEMET station returns valid temp but empty inso_md (precip-only)."""
    rec = build_climate_record(
        municipio_code="29067",
        municipio_name="Málaga",
        provincia="Málaga",
        station_id="6156X",
        normals=_normals(temp=18.0, insol=""),
    )
    assert rec["sunshine_hours_annual"] is None, (
        f"expected NULL annual sunshine, got {rec['sunshine_hours_annual']!r}"
    )
    for m in ("jan", "feb", "mar", "apr", "may", "jun",
              "jul", "aug", "sep", "oct", "nov", "dec"):
        assert rec[f"sunshine_hours_{m}"] is None, (
            f"expected NULL sunshine_hours_{m}, got {rec[f'sunshine_hours_{m}']!r}"
        )
    # Temp still written (station has valid temp data)
    assert rec["temp_mean_annual_c"] == 18.0


def test_full_climate_station_writes_sunshine():
    """Full climate station returns valid inso_md → annual sunshine is populated."""
    rec = build_climate_record(
        municipio_code="29067",
        municipio_name="Málaga",
        provincia="Málaga",
        station_id="6155A",
        normals=_normals(temp=18.0, insol=8.0),
    )
    assert rec["sunshine_hours_annual"] is not None
    assert rec["sunshine_hours_annual"] > 2000, (
        f"expected > 2000h annual sunshine (8h/day × 365), got {rec['sunshine_hours_annual']}"
    )
    assert rec["sunshine_hours_jul"] == 8.0


def test_zero_insol_same_as_empty():
    """A station returning literal 0.0 across all months is treated as missing."""
    rec = build_climate_record(
        municipio_code="29067",
        municipio_name="Málaga",
        provincia="Málaga",
        station_id="0000X",
        normals=_normals(temp=18.0, insol=0.0),
    )
    assert rec["sunshine_hours_annual"] is None


if __name__ == "__main__":
    tests = [
        test_precip_only_station_writes_null_sunshine,
        test_full_climate_station_writes_sunshine,
        test_zero_insol_same_as_empty,
    ]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"✓ {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"✗ {t.__name__}: {e}")
    if failed:
        print(f"\n{failed}/{len(tests)} failed")
        sys.exit(1)
    print(f"\n{len(tests)}/{len(tests)} passed")
