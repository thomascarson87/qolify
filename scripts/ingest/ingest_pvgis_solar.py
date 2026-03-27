from __future__ import annotations
#!/usr/bin/env python3
"""
Qolify — PVGIS Solar Radiation Grid Pre-cache (CHI-323)

Pre-populates the solar_radiation table with a 0.1° grid across Spain using
the PVGIS JRC REST API (no API key required). On-demand property analysis
then looks up the nearest cached grid point rather than hitting PVGIS live.

Grid covers Spain bounding box: lat 35.0–44.0, lng -9.5–4.5
~5,850 grid points at 0.1° resolution (approximately 8km spacing).

The unique index on solar_radiation uses ROUND(lat,2) / ROUND(lng,2)
so on-demand caching at 0.01° resolution also works without conflict.

Usage:
  python ingest_pvgis_solar.py               # full grid run
  python ingest_pvgis_solar.py --dry-run     # compute grid, no DB writes
  python ingest_pvgis_solar.py --test        # fetch first 5 points only
  python ingest_pvgis_solar.py --resume      # skip already-cached points (default)
  python ingest_pvgis_solar.py --no-resume   # re-fetch everything

After the grid seed, run this SQL once to create the on-demand lookup function:
  (see SQL block at the bottom of this file)
"""

import argparse
import sys
import time

import requests
from tqdm import tqdm
from _db import get_conn

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

PVGIS_URL = "https://re.jrc.ec.europa.eu/api/v5_2/pvcalc"

# Spain bounding box (mainland + Balearics; Canaries excluded — separate run)
SPAIN_BBOX = {
    "lat_min": 35.0,
    "lat_max": 44.0,
    "lng_min": -9.5,
    "lng_max":  4.5,
}

GRID_STEP = 0.1   # degrees — approximately 8–9 km per step

# PVGIS parameters for monthly GHI extraction via pvcalc endpoint.
# MRcalculation was removed from the PVGIS v5.2 API.
# pvcalc with angle=0 (horizontal panel) gives H(i) = GHI (global horizontal
# irradiance) — identical values to the old MRcalculation G(h) output.
# peakpower=1, loss=14 are required by pvcalc but don't affect H(i) values.
PVGIS_PARAMS_BASE = {
    "outputformat": "json",
    "peakpower":    1,
    "loss":         14,
    "angle":        0,   # horizontal plane → H(i) == GHI
    "aspect":       0,
}

MONTHS_SHORT = ["jan", "feb", "mar", "apr", "may", "jun",
                "jul", "aug", "sep", "oct", "nov", "dec"]

# Rate limiting: PVGIS allows 30 req/s; we use 5 req/s to be safe
REQUEST_DELAY_S = 0.2


# ---------------------------------------------------------------------------
# Grid generation
# ---------------------------------------------------------------------------

def build_grid() -> list[tuple[float, float]]:
    """
    Generate all (lat, lng) grid points at GRID_STEP resolution across Spain.
    Coordinates are rounded to 1 decimal place.
    """
    points = []
    lat = SPAIN_BBOX["lat_min"]
    while lat <= SPAIN_BBOX["lat_max"] + 1e-9:
        lng = SPAIN_BBOX["lng_min"]
        while lng <= SPAIN_BBOX["lng_max"] + 1e-9:
            points.append((round(lat, 1), round(lng, 1)))
            lng = round(lng + GRID_STEP, 1)
        lat = round(lat + GRID_STEP, 1)
    return points


# ---------------------------------------------------------------------------
# Existing coord lookup (for --resume)
# ---------------------------------------------------------------------------

def get_existing_coords(conn) -> set[tuple[float, float]]:
    """
    Return the set of (lat, lng) pairs already cached in solar_radiation.
    Rounded to 1 decimal place to match the 0.1° grid.
    """
    with conn.cursor() as cur:
        cur.execute("SELECT ROUND(lat::NUMERIC, 1), ROUND(lng::NUMERIC, 1) FROM solar_radiation")
        return {(float(row[0]), float(row[1])) for row in cur.fetchall()}


# ---------------------------------------------------------------------------
# PVGIS API fetch
# ---------------------------------------------------------------------------

def fetch_pvgis(lat: float, lng: float) -> dict | None:
    """
    Fetch monthly solar radiation data from PVGIS for a coordinate.
    Returns the raw 'outputs' dict or None on error.

    Response structure (MRcalculation endpoint):
    {
      "outputs": {
        "monthly": [
          {"month": 1, "G(h)": 52.34, "Gb(n)": 44.12, "Gd(h)": 25.6, ...},
          ...
        ],
        "totals": {
          "G(h)": 1785.23,
          "Gb(n)": 1420.10,
          ...
        }
      }
    }

    G(h)  = Global Horizontal Irradiation in kWh/m² (monthly sum or annual sum)
    Gb(n) = Direct Normal Irradiation in kWh/m²
    Gd(h) = Diffuse Horizontal Irradiation in kWh/m²
    """
    params = {**PVGIS_PARAMS_BASE, "lat": lat, "lon": lng}
    try:
        r = requests.get(PVGIS_URL, params=params, timeout=30)
    except requests.RequestException as e:
        tqdm.write(f"  [WARN] Request error at ({lat}, {lng}): {e}")
        return None

    if r.status_code == 400:
        # 400 from pvcalc means either: (a) point is over the sea / out-of-range,
        # or (b) a parameter error. Check the body to distinguish.
        try:
            body_msg = r.json().get("message", r.text[:200])
        except ValueError:
            body_msg = r.text[:200]
        lower = body_msg.lower()
        if any(kw in lower for kw in ("sea", "outside", "out of", "no data", "not found")):
            # Genuine sea/OOB — silent skip
            return None
        else:
            # Unexpected parameter error — warn loudly so we catch API breakage
            tqdm.write(f"  [WARN] 400 param error at ({lat:.1f}, {lng:.1f}): {body_msg}")
            return None
    if r.status_code != 200:
        tqdm.write(f"  [WARN] HTTP {r.status_code} at ({lat:.1f}, {lng:.1f})")
        return None

    try:
        return r.json().get("outputs")
    except ValueError as e:
        tqdm.write(f"  [WARN] JSON parse error at ({lat:.1f}, {lng:.1f}): {e}")
        return None


# ---------------------------------------------------------------------------
# Parse PVGIS response → DB record
# ---------------------------------------------------------------------------

def parse_pvgis_outputs(lat: float, lng: float, outputs: dict) -> dict | None:
    """
    Convert PVGIS pvcalc 'outputs' dict to a dict ready for upsert.

    pvcalc (with angle=0) returns:
      outputs.monthly.fixed — list of {"month": N, "H(i)_m": kWh/m²/month, ...}
      outputs.totals.fixed  — dict with "H(i)_y" = annual kWh/m²/year

    With angle=0 (horizontal panel), H(i) == GHI (global horizontal irradiance),
    identical to the old MRcalculation G(h) values.
    """
    monthly_fixed = outputs.get("monthly", {}).get("fixed", [])
    totals_fixed  = outputs.get("totals",  {}).get("fixed", {})

    if not monthly_fixed or not totals_fixed:
        tqdm.write(f"  [WARN] Missing monthly/totals data for ({lat:.1f}, {lng:.1f})")
        return None

    month_by_num = {entry["month"]: entry for entry in monthly_fixed if "month" in entry}
    monthly_ghi: dict[str, float | None] = {}
    for i, month_name in enumerate(MONTHS_SHORT):
        entry = month_by_num.get(i + 1, {})
        monthly_ghi[month_name] = entry.get("H(i)_m")  # kWh/m²/month, horizontal

    ghi_annual = totals_fixed.get("H(i)_y")  # kWh/m²/year, horizontal

    record = {
        "lat":               lat,
        "lng":               lng,
        "ghi_annual_kwh_m2": round(float(ghi_annual), 2) if ghi_annual is not None else None,
        "pvgis_version":     "PVGIS-5.2",
    }
    for month_name, val in monthly_ghi.items():
        record[f"ghi_{month_name}"] = round(float(val), 2) if val is not None else None

    return record


# ---------------------------------------------------------------------------
# Database upsert
# ---------------------------------------------------------------------------

# Note: the unique index is on ROUND(lat::NUMERIC, 2), ROUND(lng::NUMERIC, 2)
# which means ON CONFLICT must use the same expression.
# geom is computed directly in SQL from lat/lng.
UPSERT_SQL = """
INSERT INTO solar_radiation (
    lat, lng, geom,
    ghi_annual_kwh_m2,
    ghi_jan, ghi_feb, ghi_mar, ghi_apr, ghi_may, ghi_jun,
    ghi_jul, ghi_aug, ghi_sep, ghi_oct, ghi_nov, ghi_dec,
    pvgis_version,
    queried_at
)
VALUES (
    %(lat)s, %(lng)s,
    ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::geography,
    %(ghi_annual_kwh_m2)s,
    %(ghi_jan)s, %(ghi_feb)s, %(ghi_mar)s, %(ghi_apr)s,
    %(ghi_may)s, %(ghi_jun)s,
    %(ghi_jul)s, %(ghi_aug)s, %(ghi_sep)s, %(ghi_oct)s,
    %(ghi_nov)s, %(ghi_dec)s,
    %(pvgis_version)s,
    NOW()
)
ON CONFLICT (ROUND(lat::NUMERIC, 2), ROUND(lng::NUMERIC, 2)) DO UPDATE SET
    ghi_annual_kwh_m2 = EXCLUDED.ghi_annual_kwh_m2,
    ghi_jan           = EXCLUDED.ghi_jan,
    ghi_feb           = EXCLUDED.ghi_feb,
    ghi_mar           = EXCLUDED.ghi_mar,
    ghi_apr           = EXCLUDED.ghi_apr,
    ghi_may           = EXCLUDED.ghi_may,
    ghi_jun           = EXCLUDED.ghi_jun,
    ghi_jul           = EXCLUDED.ghi_jul,
    ghi_aug           = EXCLUDED.ghi_aug,
    ghi_sep           = EXCLUDED.ghi_sep,
    ghi_oct           = EXCLUDED.ghi_oct,
    ghi_nov           = EXCLUDED.ghi_nov,
    ghi_dec           = EXCLUDED.ghi_dec,
    pvgis_version     = EXCLUDED.pvgis_version,
    queried_at        = NOW()
"""


def upsert_solar_record(conn, record: dict):
    with conn.cursor() as cur:
        cur.execute(UPSERT_SQL, record)
    conn.commit()


# ---------------------------------------------------------------------------
# Main ingestion loop
# ---------------------------------------------------------------------------

def run(args):
    grid = build_grid()

    # Optional bbox filter — useful for regional validation runs (e.g. Málaga only)
    if args.bbox:
        lat_min, lng_min, lat_max, lng_max = args.bbox
        grid = [(lat, lng) for lat, lng in grid
                if lat_min <= lat <= lat_max and lng_min <= lng <= lng_max]
        print(f"Grid: {len(grid)} points in bbox [{lat_min},{lng_min} → {lat_max},{lng_max}]")
    else:
        print(f"Grid: {len(grid)} points at {GRID_STEP}° resolution over Spain bbox")

    if args.dry_run:
        print("[DRY RUN] No DB writes will occur.")
        print(f"  Would fetch {len(grid)} grid points from PVGIS")
        print(f"  Estimated time at {REQUEST_DELAY_S}s/req: "
              f"~{len(grid) * REQUEST_DELAY_S / 60:.0f} minutes")
        return

    conn = get_conn()

    # Resume: skip coordinates already in the table
    to_fetch = grid
    if args.resume:
        existing = get_existing_coords(conn)
        to_fetch = [(lat, lng) for lat, lng in grid if (lat, lng) not in existing]
        print(f"Already cached: {len(existing)} — To fetch: {len(to_fetch)}")
    else:
        print(f"Fetching all {len(to_fetch)} points (--no-resume mode)")

    if args.test:
        to_fetch = to_fetch[:5]
        print(f"[TEST MODE] Limiting to first {len(to_fetch)} points")

    n_fetched = 0
    n_skipped = 0
    n_errors = 0

    for i, (lat, lng) in enumerate(tqdm(to_fetch, desc="PVGIS grid", unit="pt")):
        outputs = fetch_pvgis(lat, lng)
        if outputs is None:
            n_skipped += 1
            time.sleep(REQUEST_DELAY_S)
            continue

        record = parse_pvgis_outputs(lat, lng, outputs)
        if record is None:
            n_errors += 1
            time.sleep(REQUEST_DELAY_S)
            continue

        try:
            upsert_solar_record(conn, record)
            n_fetched += 1
        except Exception as e:
            tqdm.write(f"  [ERROR] DB upsert failed at ({lat:.1f}, {lng:.1f}): {e}")
            conn.rollback()
            n_errors += 1

        time.sleep(REQUEST_DELAY_S)

        # Progress checkpoint every 500 points
        if (i + 1) % 500 == 0:
            tqdm.write(f"  Checkpoint: {i + 1}/{len(to_fetch)} — "
                       f"fetched={n_fetched}, skipped={n_skipped}, errors={n_errors}")

    conn.close()

    print(f"""
✓ PVGIS solar grid cache complete
  Fetched & upserted: {n_fetched}
  Skipped (sea/OOB):  {n_skipped}
  Errors:             {n_errors}
  Total in grid:      {len(to_fetch)}
""")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Pre-seed solar_radiation table with PVGIS 0.1° grid across Spain"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Compute grid and print stats without fetching or writing"
    )
    parser.add_argument(
        "--test", action="store_true",
        help="Fetch only the first 5 grid points (for API validation)"
    )
    parser.add_argument(
        "--resume", action="store_true", default=True,
        help="Skip grid points already in solar_radiation (default: on)"
    )
    parser.add_argument(
        "--no-resume", dest="resume", action="store_false",
        help="Re-fetch all points even if already cached"
    )
    parser.add_argument(
        "--bbox", metavar=("LAT_MIN", "LNG_MIN", "LAT_MAX", "LNG_MAX"),
        type=float, nargs=4,
        help="Restrict grid to a bounding box, e.g. --bbox 36.3 -5.2 36.9 -4.3 (Málaga)"
    )
    args = parser.parse_args()
    run(args)


if __name__ == "__main__":
    main()


# =============================================================================
# SQL: Create the on-demand lookup function (run once in Supabase after grid seed)
# =============================================================================
#
# CREATE OR REPLACE FUNCTION nearest_solar_grid_point(
#     p_lat  DECIMAL,
#     p_lng  DECIMAL
# )
# RETURNS SETOF solar_radiation
# LANGUAGE sql STABLE AS $$
#     SELECT *
#     FROM solar_radiation
#     ORDER BY geom <-> ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
#     LIMIT 1;
# $$;
#
# Usage in indicator engine:
#   SELECT * FROM nearest_solar_grid_point(36.72, -4.42);  -- Málaga
#
# =============================================================================
# SQL: Canary Islands grid (run separately if needed)
# =============================================================================
#
# The main Spain bbox excludes the Canary Islands (lat ~27-29, lng ~-18 to -13).
# To pre-seed Canaries, run with a modified bbox or insert manually:
#
#   CANARY_BBOX = {"lat_min": 27.5, "lat_max": 29.5, "lng_min": -18.2, "lng_max": -13.3}
