from __future__ import annotations
#!/usr/bin/env python3
"""
Qolify — AEMET Climate Normals Ingestion (CHI-322)

Fetches 30-year climate normals (1991–2020) for all AEMET stations via the
AEMET OpenData API. Maps each station to its nearest municipio using the
nearest_municipio() PostGIS function, then upserts into climate_data.

Prerequisites:
  - AEMET_API_KEY in .env.local (register free at opendata.aemet.es)
  - `municipios` reference table populated with INE codes + centroid geoms
  - nearest_municipio() PostGIS function created (SQL at bottom of this file)

Usage:
  python ingest_aemet_climate.py                    # full run
  python ingest_aemet_climate.py --dry-run          # fetch only, no DB writes
  python ingest_aemet_climate.py --station 6155A    # single station for testing
  python ingest_aemet_climate.py --skip-existing    # skip stations already in DB
"""

import argparse
import os
import sys
import time
from pathlib import Path

import requests
from tqdm import tqdm
import psycopg2
from _db import get_conn

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

AEMET_BASE = "https://opendata.aemet.es/opendata/api"

# Monthly day counts (non-leap year — adequate for 30yr normals approximation)
DAYS_PER_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

MONTHS_SHORT = ["jan", "feb", "mar", "apr", "may", "jun",
                "jul", "aug", "sep", "oct", "nov", "dec"]

# Winter months (indices): Dec, Jan, Feb + Oct, Nov for extended winter
WINTER_MONTHS = [0, 1, 2, 9, 10, 11]  # Jan, Feb, Mar, Oct, Nov, Dec

# ---------------------------------------------------------------------------
# AEMET API helpers
# ---------------------------------------------------------------------------

def _dms_to_decimal(dms: str) -> float:
    """
    Convert AEMET DMS coordinate string to decimal degrees.
    Format: 'DDMMSSN' or 'DDDMMSSW' (degrees-minutes-seconds + hemisphere char).
    Examples: '363958N' → 36.6661, '042856W' → -4.4822
    """
    hemi = dms[-1].upper()
    digits = dms[:-1]
    ss = int(digits[-2:])
    mm = int(digits[-4:-2])
    dd = int(digits[:-4])
    decimal = dd + mm / 60 + ss / 3600
    if hemi in ("S", "W"):
        decimal = -decimal
    return round(decimal, 6)


def _get_api_key() -> str:
    """Load AEMET_API_KEY from env (auto-loaded from .env.local by _db.py)."""
    key = os.environ.get("AEMET_API_KEY")
    if not key:
        sys.exit(
            "[ERROR] AEMET_API_KEY not set.\n"
            "  Register for a free key at https://opendata.aemet.es/centrodedescargas/inicio\n"
            "  Then add AEMET_API_KEY=your_key to .env.local"
        )
    return key


def fetch_aemet_json(url: str, api_key: str, timeout: int = 30) -> dict | None:
    """
    Make an AEMET API request. Returns the parsed JSON or None on error.
    AEMET uses a 2-step redirect pattern: first call returns {'datos': <url>},
    second call at that URL returns the actual data.
    """
    try:
        r = requests.get(url, params={"api_key": api_key}, timeout=timeout)
    except requests.RequestException as e:
        print(f"  [WARN] Request failed: {e}")
        return None

    if r.status_code == 429:
        print("  [WARN] Rate limited — sleeping 10s")
        time.sleep(10)
        return None
    if r.status_code != 200:
        print(f"  [WARN] HTTP {r.status_code} for {url}")
        return None

    return r.json()


def fetch_redirect_data(redirect_url: str, timeout: int = 30) -> list | None:
    """Follow the AEMET redirect URL and return the actual data list."""
    try:
        r = requests.get(redirect_url, timeout=timeout)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        print(f"  [WARN] Failed to fetch redirect data: {e}")
        return None


def fetch_all_stations(api_key: str) -> list[dict]:
    """
    Fetch the list of all AEMET climate normal stations.
    Returns a list of station dicts with keys: indicativo, latitud_dec, longitud_dec, etc.
    """
    print("→ Fetching station list from AEMET...")
    meta = fetch_aemet_json(
        f"{AEMET_BASE}/valores/climatologicos/inventarioestaciones/todasestaciones",
        api_key
    )
    if not meta:
        sys.exit("[ERROR] Could not fetch station list from AEMET.")

    redirect_url = meta.get("datos")
    if not redirect_url:
        sys.exit(f"[ERROR] No 'datos' URL in AEMET response: {meta}")

    time.sleep(2)  # conservative — respect rate limit before redirect call
    stations = fetch_redirect_data(redirect_url)
    if not stations:
        sys.exit("[ERROR] Empty station list from AEMET redirect URL.")

    print(f"  ✓ {len(stations)} stations found")
    return stations


def fetch_station_normals(station_id: str, api_key: str) -> dict | None:
    """
    Fetch 30-year climate normals for a single AEMET station.
    Returns a dict of field→value (monthly temps, sunshine, etc.) or None.
    """
    meta = fetch_aemet_json(
        f"{AEMET_BASE}/valores/climatologicos/normales/estacion/{station_id}",
        api_key
    )
    if not meta:
        return None

    redirect_url = meta.get("datos")
    if not redirect_url:
        return None

    time.sleep(1)
    records = fetch_redirect_data(redirect_url)
    if not records:
        return None

    # API returns 13 records (one per month, ordered by `mes` 1-12, plus 13=annual)
    # Return all records sorted by mes; caller uses extract_monthly() to pull values
    if not isinstance(records, list) or not records:
        return None
    return sorted(records, key=lambda r: int(r.get("mes", 99)))


# ---------------------------------------------------------------------------
# Climate calculations
# ---------------------------------------------------------------------------

def _safe_float(value, default: float = 0.0) -> float:
    """Parse a value to float, handling Spanish comma decimals (e.g. '2974,5' → 2974.5)."""
    if value is None:
        return default
    try:
        return float(str(value).replace(",", "."))
    except (TypeError, ValueError):
        return default


def extract_monthly(records: list, field: str) -> list[float]:
    """
    Extract 12 monthly values from the list of AEMET normals records.
    Each record represents one month (mes=1..12). The 13th record (mes=13) is annual.
    Field examples: 'tm_mes_md' (temp), 'inso_md' (sunshine h), 'p_mes_md' (rain), 'hr_md' (humidity).
    """
    monthly = [r for r in records if int(r.get("mes", 99)) <= 12]
    monthly.sort(key=lambda r: int(r["mes"]))
    return [_safe_float(r.get(field), 0.0) for r in monthly]


def extract_annual_field(records: list, field: str, default: float = 0.0) -> float:
    """
    Extract a single value from the annual summary record (mes=13).
    AEMET annual sunshine is stored as 'ss' in the mes=13 record (not in monthly records).
    """
    annual = next((r for r in records if int(r.get("mes", 0)) == 13), None)
    if annual is None:
        return default
    return _safe_float(annual.get(field), default)


def calc_hdd(monthly_temps: list[float], base: float = 15.5) -> int:
    """
    Heating Degree Days — approximated from monthly mean temperatures.
    HDD = Σ max(0, base - temp_mean) × days_in_month
    Standard base for Spain is 15.5°C.
    """
    return int(sum(
        max(0.0, base - t) * d
        for t, d in zip(monthly_temps, DAYS_PER_MONTH)
    ))


def calc_cdd(monthly_temps: list[float], base: float = 22.0) -> int:
    """
    Cooling Degree Days — approximated from monthly mean temperatures.
    CDD = Σ max(0, temp_mean - base) × days_in_month
    Standard base for cooling is 22.0°C.
    """
    return int(sum(
        max(0.0, t - base) * d
        for t, d in zip(monthly_temps, DAYS_PER_MONTH)
    ))


def build_climate_record(
    municipio_code: str,
    municipio_name: str | None,
    provincia: str | None,
    station_id: str,  # normals arg below is now list[dict], one record per month
    normals: dict,
) -> dict:
    """
    Build a dict ready for upsert into climate_data from raw AEMET normals.

    Monthly sunshine (ss_01…ss_12) from AEMET is in hours/day for that month.
    sunshine_hours_annual is the sum of (daily_hours × days_in_month).
    sunshine_hours_jan etc. stores the average daily hours for that month.
    """
    monthly_temps = extract_monthly(normals, "tm_mes_md")   # °C mean monthly temp
    monthly_sun   = extract_monthly(normals, "inso_md")     # mean daily sunshine (h/day) — may be 0 for many stations
    monthly_rain  = extract_monthly(normals, "p_mes_md")    # mean monthly rainfall (mm)
    monthly_hum   = extract_monthly(normals, "hr_md")       # mean monthly humidity (%)

    # Annual sunshine: sum of monthly inso_md (h/day) × days_in_month.
    # CHI-384: inso_md is empty for precipitation-only stations. _safe_float() turns
    # empties into 0.0, which would silently write sunshine_hours_annual=0 — a
    # factually wrong value that pollutes solar-potential scores. Detect "no
    # insolation data" by checking that at least one month has a non-zero value;
    # if all twelve are zero, persist NULL for annual + monthly sunshine fields
    # so the quality gate in run() can treat the station as precip-only.
    has_sunshine_data = any(v > 0 for v in monthly_sun)
    if has_sunshine_data:
        sunshine_annual: int | None = int(sum(
            monthly_sun[i] * DAYS_PER_MONTH[i] for i in range(12)
        ))
    else:
        sunshine_annual = None
    hdd = calc_hdd(monthly_temps)
    cdd = calc_cdd(monthly_temps)

    record = {
        "municipio_code":      municipio_code,
        "municipio_name":      municipio_name,
        "provincia":           provincia,
        "aemet_station_id":    station_id,

        # Annual aggregates
        "sunshine_hours_annual": sunshine_annual,
        "hdd_annual":            hdd,
        "cdd_annual":            cdd,
        "temp_mean_annual_c":    round(sum(monthly_temps) / 12, 1),
        "temp_mean_jan_c":       round(monthly_temps[0], 1),
        "temp_mean_jul_c":       round(monthly_temps[6], 1),
        "rainfall_annual_mm":    int(sum(monthly_rain)),
        "rainfall_jan_mm":       int(monthly_rain[0]),
        "rainfall_jul_mm":       int(monthly_rain[6]),
        "humidity_annual_pct":   round(sum(monthly_hum) / 12, 1),
        "humidity_winter_pct":   round(
            sum(monthly_hum[i] for i in WINTER_MONTHS) / len(WINTER_MONTHS), 1
        ),

        # Source metadata
        "era5_gap_fill":   False,
        "data_year_from":  1991,
        "data_year_to":    2020,
    }

    # Monthly sunshine (avg daily hours for each month) — NULL when station has no insol data
    for i, month in enumerate(MONTHS_SHORT):
        record[f"sunshine_hours_{month}"] = round(monthly_sun[i], 1) if has_sunshine_data else None

    return record


# ---------------------------------------------------------------------------
# Spatial lookup: station → nearest municipio
# ---------------------------------------------------------------------------

def get_municipio_for_station(
    conn, station_id: str, lat: float, lng: float, max_km: int = 25
) -> dict | None:
    """
    Find the nearest municipio centroid within max_km km of the station.
    Returns dict with municipio_code, municipio_name, provincia — or None.

    Requires the nearest_municipio() PostgreSQL function to exist.
    See SQL at the bottom of this file to create it.
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM nearest_municipio(%s, %s, %s)",
            (lat, lng, max_km)
        )
        row = cur.fetchone()
        if row is None:
            return None
        col_names = [desc[0] for desc in cur.description]
        return dict(zip(col_names, row))


def check_prerequisites(conn) -> bool:
    """
    Verify that the required DB objects exist before running the full ingestion.
    Returns True if all prerequisites are met.
    """
    ok = True
    with conn.cursor() as cur:
        # Check municipios table
        cur.execute("""
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_name = 'municipios'
            )
        """)
        if not cur.fetchone()[0]:
            print("[WARN] Table `municipios` does not exist.")
            print("       Create it with INE codes + PostGIS centroid geoms,")
            print("       then re-run this script.")
            ok = False

        # Check nearest_municipio function
        cur.execute("""
            SELECT EXISTS (
                SELECT 1 FROM pg_proc
                WHERE proname = 'nearest_municipio'
            )
        """)
        if not cur.fetchone()[0]:
            print("[WARN] Function nearest_municipio() does not exist.")
            print("       Run the SQL at the bottom of this script to create it.")
            ok = False

    return ok


# ---------------------------------------------------------------------------
# Database upsert
# ---------------------------------------------------------------------------

UPSERT_SQL = """
INSERT INTO climate_data (
    municipio_code, municipio_name, provincia, aemet_station_id,
    sunshine_hours_annual,
    sunshine_hours_jan, sunshine_hours_feb, sunshine_hours_mar,
    sunshine_hours_apr, sunshine_hours_may, sunshine_hours_jun,
    sunshine_hours_jul, sunshine_hours_aug, sunshine_hours_sep,
    sunshine_hours_oct, sunshine_hours_nov, sunshine_hours_dec,
    hdd_annual, cdd_annual,
    temp_mean_annual_c, temp_mean_jan_c, temp_mean_jul_c,
    rainfall_annual_mm, rainfall_jan_mm, rainfall_jul_mm,
    humidity_annual_pct, humidity_winter_pct,
    era5_gap_fill, data_year_from, data_year_to,
    updated_at
)
VALUES (
    %(municipio_code)s, %(municipio_name)s, %(provincia)s, %(aemet_station_id)s,
    %(sunshine_hours_annual)s,
    %(sunshine_hours_jan)s, %(sunshine_hours_feb)s, %(sunshine_hours_mar)s,
    %(sunshine_hours_apr)s, %(sunshine_hours_may)s, %(sunshine_hours_jun)s,
    %(sunshine_hours_jul)s, %(sunshine_hours_aug)s, %(sunshine_hours_sep)s,
    %(sunshine_hours_oct)s, %(sunshine_hours_nov)s, %(sunshine_hours_dec)s,
    %(hdd_annual)s, %(cdd_annual)s,
    %(temp_mean_annual_c)s, %(temp_mean_jan_c)s, %(temp_mean_jul_c)s,
    %(rainfall_annual_mm)s, %(rainfall_jan_mm)s, %(rainfall_jul_mm)s,
    %(humidity_annual_pct)s, %(humidity_winter_pct)s,
    %(era5_gap_fill)s, %(data_year_from)s, %(data_year_to)s,
    NOW()
)
ON CONFLICT (municipio_code) DO UPDATE SET
    -- Only replace existing data if the new record has sunshine (higher quality).
    -- This prevents synoptic-only stations (no inso_md) from overwriting full climate
    -- stations that were processed earlier in the same run.
    aemet_station_id      = CASE WHEN EXCLUDED.sunshine_hours_annual > 0 THEN EXCLUDED.aemet_station_id ELSE climate_data.aemet_station_id END,
    municipio_name        = COALESCE(EXCLUDED.municipio_name, climate_data.municipio_name),
    provincia             = COALESCE(EXCLUDED.provincia, climate_data.provincia),
    sunshine_hours_annual = CASE WHEN EXCLUDED.sunshine_hours_annual > 0 THEN EXCLUDED.sunshine_hours_annual ELSE climate_data.sunshine_hours_annual END,
    sunshine_hours_jan    = CASE WHEN EXCLUDED.sunshine_hours_annual > 0 THEN EXCLUDED.sunshine_hours_jan ELSE climate_data.sunshine_hours_jan END,
    sunshine_hours_feb    = CASE WHEN EXCLUDED.sunshine_hours_annual > 0 THEN EXCLUDED.sunshine_hours_feb ELSE climate_data.sunshine_hours_feb END,
    sunshine_hours_mar    = CASE WHEN EXCLUDED.sunshine_hours_annual > 0 THEN EXCLUDED.sunshine_hours_mar ELSE climate_data.sunshine_hours_mar END,
    sunshine_hours_apr    = CASE WHEN EXCLUDED.sunshine_hours_annual > 0 THEN EXCLUDED.sunshine_hours_apr ELSE climate_data.sunshine_hours_apr END,
    sunshine_hours_may    = CASE WHEN EXCLUDED.sunshine_hours_annual > 0 THEN EXCLUDED.sunshine_hours_may ELSE climate_data.sunshine_hours_may END,
    sunshine_hours_jun    = CASE WHEN EXCLUDED.sunshine_hours_annual > 0 THEN EXCLUDED.sunshine_hours_jun ELSE climate_data.sunshine_hours_jun END,
    sunshine_hours_jul    = CASE WHEN EXCLUDED.sunshine_hours_annual > 0 THEN EXCLUDED.sunshine_hours_jul ELSE climate_data.sunshine_hours_jul END,
    sunshine_hours_aug    = CASE WHEN EXCLUDED.sunshine_hours_annual > 0 THEN EXCLUDED.sunshine_hours_aug ELSE climate_data.sunshine_hours_aug END,
    sunshine_hours_sep    = CASE WHEN EXCLUDED.sunshine_hours_annual > 0 THEN EXCLUDED.sunshine_hours_sep ELSE climate_data.sunshine_hours_sep END,
    sunshine_hours_oct    = CASE WHEN EXCLUDED.sunshine_hours_annual > 0 THEN EXCLUDED.sunshine_hours_oct ELSE climate_data.sunshine_hours_oct END,
    sunshine_hours_nov    = CASE WHEN EXCLUDED.sunshine_hours_annual > 0 THEN EXCLUDED.sunshine_hours_nov ELSE climate_data.sunshine_hours_nov END,
    sunshine_hours_dec    = CASE WHEN EXCLUDED.sunshine_hours_annual > 0 THEN EXCLUDED.sunshine_hours_dec ELSE climate_data.sunshine_hours_dec END,
    hdd_annual            = CASE WHEN EXCLUDED.temp_mean_annual_c <> 0 THEN EXCLUDED.hdd_annual ELSE climate_data.hdd_annual END,
    cdd_annual            = CASE WHEN EXCLUDED.temp_mean_annual_c <> 0 THEN EXCLUDED.cdd_annual ELSE climate_data.cdd_annual END,
    temp_mean_annual_c    = CASE WHEN EXCLUDED.temp_mean_annual_c <> 0 THEN EXCLUDED.temp_mean_annual_c ELSE climate_data.temp_mean_annual_c END,
    temp_mean_jan_c       = CASE WHEN EXCLUDED.temp_mean_annual_c <> 0 THEN EXCLUDED.temp_mean_jan_c ELSE climate_data.temp_mean_jan_c END,
    temp_mean_jul_c       = CASE WHEN EXCLUDED.temp_mean_annual_c <> 0 THEN EXCLUDED.temp_mean_jul_c ELSE climate_data.temp_mean_jul_c END,
    rainfall_annual_mm    = CASE WHEN EXCLUDED.rainfall_annual_mm > 0 THEN EXCLUDED.rainfall_annual_mm ELSE climate_data.rainfall_annual_mm END,
    rainfall_jan_mm       = CASE WHEN EXCLUDED.rainfall_annual_mm > 0 THEN EXCLUDED.rainfall_jan_mm ELSE climate_data.rainfall_jan_mm END,
    rainfall_jul_mm       = EXCLUDED.rainfall_jul_mm,
    humidity_annual_pct   = EXCLUDED.humidity_annual_pct,
    humidity_winter_pct   = EXCLUDED.humidity_winter_pct,
    era5_gap_fill         = EXCLUDED.era5_gap_fill,
    data_year_from        = EXCLUDED.data_year_from,
    data_year_to          = EXCLUDED.data_year_to,
    updated_at            = NOW()
"""


def upsert_climate_record(conn, record: dict):
    with conn.cursor() as cur:
        cur.execute(UPSERT_SQL, record)
    conn.commit()


# ---------------------------------------------------------------------------
# Main ingestion loop
# ---------------------------------------------------------------------------

def get_existing_station_ids(conn) -> set[str]:
    """Return station IDs already in climate_data (for --skip-existing)."""
    with conn.cursor() as cur:
        cur.execute("SELECT aemet_station_id FROM climate_data WHERE aemet_station_id IS NOT NULL")
        return {row[0] for row in cur.fetchall()}


def run(args):
    api_key = _get_api_key()

    if args.dry_run:
        print("[DRY RUN] No DB writes will occur.")
        conn = None
    else:
        conn = get_conn()
        if not check_prerequisites(conn):
            conn.close()
            sys.exit(
                "\n[ERROR] Prerequisites not met. "
                "Create the municipios table and nearest_municipio() function first.\n"
                "See the SQL block at the bottom of this script."
            )

    # Determine which stations to process
    if args.station:
        # Single-station test: fetch inventory so we get real lat/lng
        all_stations = fetch_all_stations(api_key)
        stations = [s for s in all_stations if s.get("indicativo") == args.station]
        if not stations:
            sys.exit(f"[ERROR] Station '{args.station}' not found in AEMET inventory.")
    else:
        stations = fetch_all_stations(api_key)

    # Skip already-ingested stations if requested
    existing_ids: set[str] = set()
    if args.skip_existing and conn:
        existing_ids = get_existing_station_ids(conn)
        print(f"  Skipping {len(existing_ids)} stations already in climate_data")

    # Counters
    n_processed = 0
    n_skipped_existing = 0
    n_skipped_no_municipio = 0
    n_skipped_no_normals = 0
    n_upserted = 0

    for station in tqdm(stations, desc="AEMET stations", unit="station"):
        station_id = station.get("indicativo")
        if not station_id:
            continue

        if station_id in existing_ids:
            n_skipped_existing += 1
            continue

        n_processed += 1

        # Parse coordinates — AEMET inventory uses DMS strings e.g. "363958N" / "042856W"
        try:
            lat = _dms_to_decimal(station["latitud"])
            lng = _dms_to_decimal(station["longitud"])
        except (KeyError, TypeError, ValueError):
            tqdm.write(f"  [SKIP] {station_id}: missing or invalid coordinates")
            n_skipped_no_municipio += 1
            continue

        # Spatial lookup: find nearest municipio
        if not args.dry_run:
            try:
                municipio_info = get_municipio_for_station(conn, station_id, lat, lng)
            except psycopg2.OperationalError:
                # Supabase pooler closed the connection after idle during long API call — reconnect once
                tqdm.write("  [RECONNECT] DB connection lost, reconnecting...")
                conn = get_conn()
                municipio_info = get_municipio_for_station(conn, station_id, lat, lng)
            if not municipio_info:
                tqdm.write(f"  [SKIP] {station_id}: no municipio within 25km (lat={lat}, lng={lng})")
                n_skipped_no_municipio += 1
                time.sleep(2)
                continue
        else:
            # In dry-run, use station ID as a placeholder
            municipio_info = {
                "municipio_code": f"DRYRUN_{station_id}",
                "municipio_name": station.get("nombre"),
                "provincia":      station.get("provincia"),
            }

        # Fetch climate normals for this station
        normals = fetch_station_normals(station_id, api_key)
        if not normals:
            tqdm.write(f"  [SKIP] {station_id}: no normals data returned")
            n_skipped_no_normals += 1
            time.sleep(2)
            continue

        if args.dry_run:
            # Show what would be written without touching the DB
            record = build_climate_record(
                municipio_code=municipio_info["municipio_code"],
                municipio_name=municipio_info.get("municipio_name"),
                provincia=municipio_info.get("provincia"),
                station_id=station_id,
                normals=normals,
            )
            sun_val = record['sunshine_hours_annual']
            sun_str = f"{sun_val}h" if sun_val is not None else "NULL (precip-only)"
            tqdm.write(
                f"  [DRY] {station_id} → municipio={record['municipio_code']} "
                f"sun={sun_str} "
                f"HDD={record['hdd_annual']} CDD={record['cdd_annual']}"
            )
            n_upserted += 1
        else:
            record = build_climate_record(
                municipio_code=municipio_info["municipio_code"],
                municipio_name=municipio_info.get("municipio_name"),
                provincia=municipio_info.get("provincia"),
                station_id=station_id,
                normals=normals,
            )
            # Quality gate: skip stations with no usable data at all (no temp AND no sunshine).
            # CHI-384: sunshine_hours_annual is now NULL (not 0) when the station lacks
            # insol data, so treat missing-or-zero the same here. A precip-only station
            # with valid temp still passes — it writes temp/rain/humidity, leaves
            # sunshine as NULL, and the UPSERT's "WHEN EXCLUDED.sunshine_hours_annual > 0"
            # guard (NULL > 0 is NULL/false) preserves any existing good sunshine data.
            sun_val = record["sunshine_hours_annual"]
            has_sun = sun_val is not None and sun_val > 0
            has_temp = record["temp_mean_annual_c"] != 0.0
            if not has_sun and not has_temp:
                tqdm.write(
                    f"  [SKIP] {station_id}: no temp/sunshine data (synoptic-only station)"
                )
                continue
            if not has_sun:
                tqdm.write(
                    f"  [WARN] {station_id}: no sunshine data → writing sunshine fields as NULL "
                    f"(municipio={record['municipio_code']})"
                )
            try:
                upsert_climate_record(conn, record)
            except psycopg2.OperationalError:
                tqdm.write("  [RECONNECT] DB connection lost on upsert, reconnecting...")
                conn = get_conn()
                upsert_climate_record(conn, record)
            n_upserted += 1

        # Conservative rate limiting: 1 req per 2 seconds (full fetch = 2 requests)
        time.sleep(2)

    if conn:
        conn.close()

    print(f"""
✓ AEMET climate ingestion complete
  Processed:            {n_processed}
  Upserted:             {n_upserted}
  Skipped (existing):   {n_skipped_existing}
  Skipped (no municipio): {n_skipped_no_municipio}
  Skipped (no normals): {n_skipped_no_normals}
""")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Ingest AEMET 30-year climate normals → climate_data"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Fetch data but do not write to the database"
    )
    parser.add_argument(
        "--station",
        help="Process a single station ID only (e.g. --station 6155A for Málaga)"
    )
    parser.add_argument(
        "--skip-existing", action="store_true",
        help="Skip stations whose aemet_station_id is already in climate_data"
    )
    args = parser.parse_args()
    run(args)


if __name__ == "__main__":
    main()


# =============================================================================
# SQL: Prerequisites — run these once in Supabase before the ingestion script
# =============================================================================
#
# 1. Create the municipios reference table (populate from INE cartography):
#
# CREATE TABLE IF NOT EXISTS municipios (
#   municipio_code  TEXT PRIMARY KEY,   -- 5-digit INE code (e.g. '29067' for Málaga)
#   municipio_name  TEXT NOT NULL,
#   provincia       TEXT,
#   geom            GEOGRAPHY(POINT, 4326) NOT NULL  -- centroid of municipio boundary
# );
# CREATE INDEX IF NOT EXISTS municipios_geom_idx ON municipios USING GIST (geom);
#
# Populate from INE boundary files (GADM or IGN):
#   https://www.ine.es/ss/Satellite?L=es_ES&c=Page&cid=1259952026632
#
# 2. Create the nearest_municipio() lookup function:
#
# CREATE OR REPLACE FUNCTION nearest_municipio(
#     p_lat    DECIMAL,
#     p_lng    DECIMAL,
#     max_km   INT DEFAULT 25
# )
# RETURNS TABLE (
#     municipio_code  TEXT,
#     municipio_name  TEXT,
#     provincia       TEXT
# )
# LANGUAGE sql STABLE AS $$
#     SELECT municipio_code, municipio_name, provincia
#     FROM municipios
#     WHERE ST_DWithin(
#         geom,
#         ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
#         max_km * 1000
#     )
#     ORDER BY geom <-> ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
#     LIMIT 1;
# $$;
