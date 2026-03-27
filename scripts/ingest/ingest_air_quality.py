from __future__ import annotations
#!/usr/bin/env python3
"""
Qolify — MITECO Air Quality Ingestion (CHI-328)

Fetches daily air quality readings from the MITECO national air quality
monitoring network (Red de Calidad del Aire) into `air_quality_readings`.
Feeds Indicator 8f (physical_risk) via the aqi_score sub-component.

⚠️  BLOCKED ON API ENDPOINT DISCOVERY
    The MITECO air quality REST API endpoint is NOT yet confirmed.
    To find it:
      1. Open https://www.miteco.gob.es/es/calidad-y-evaluacion-ambiental/temas/atmosfera-y-calidad-del-aire/
      2. Open browser DevTools → Network tab → filter for XHR/Fetch
      3. Reload or interact with the data map to trigger API calls
      4. Find the JSON endpoint that returns station readings
      5. Document it in MD files/DATA_SOURCES.md
      6. Replace MITECO_STATIONS_URL and MITECO_READINGS_URL below

    Alternative: Spain also publishes AQ data via the EU EEA API:
      https://discomap.eea.europa.eu/map/fme/AirQualityStatistics.htm
      This may be easier to work with and covers all EU stations.

Prerequisites:
  - Run migration 004_air_quality_table.sql in Supabase first
  - AEMET_API_KEY not needed — MITECO is keyless

Usage:
  python ingest_air_quality.py              # fetch latest readings
  python ingest_air_quality.py --days 30    # backfill last 30 days
  python ingest_air_quality.py --dry-run    # no DB writes
  python ingest_air_quality.py --station 28079001  # single station test
"""

import argparse
import sys
import time
from datetime import datetime, timedelta, timezone

import requests
from tqdm import tqdm
from _db import get_conn

# ---------------------------------------------------------------------------
# ⚠️  CONFIRM THESE ENDPOINTS BEFORE RUNNING
# ---------------------------------------------------------------------------

# Station metadata list — returns all active monitoring stations with
# station_id, name, lat, lng, municipio_code
MITECO_STATIONS_URL = (
    "https://REPLACE_WITH_CONFIRMED_MITECO_API_HOST/api/stations"
    # TODO: find by inspecting network requests on the MITECO air quality map page
    # Alternative EEA endpoint (may be easier):
    # https://eeadmz1-downloads-api-appservice.azurewebsites.net/ParquetFile?countries=ES&...
)

# Daily readings per station — returns pollutant values for a date range
MITECO_READINGS_URL = (
    "https://REPLACE_WITH_CONFIRMED_MITECO_API_HOST/api/readings"
    # TODO: confirm
)

# ---------------------------------------------------------------------------
# AQI categorisation (EU Air Quality Index — matches MITECO scale)
# ---------------------------------------------------------------------------

AQI_CATEGORIES = [
    (0,  25,  "bueno"),
    (25, 50,  "razonable"),
    (50, 75,  "regular"),
    (75, 100, "malo"),
    (100, 125, "muy_malo"),
    (125, float("inf"), "extremadamente_malo"),
]


def aqi_to_category(aqi: float | None) -> str | None:
    if aqi is None:
        return None
    for lo, hi, label in AQI_CATEGORIES:
        if lo <= aqi < hi:
            return label
    return "extremadamente_malo"


# ---------------------------------------------------------------------------
# Station fetch
# ---------------------------------------------------------------------------

def fetch_stations() -> list[dict]:
    """
    Fetch all active MITECO monitoring stations.
    Expected response: list of {station_id, station_name, lat, lng,
                                 municipio_code, municipio_name, provincia}
    TODO: adapt field extraction to actual API response structure.
    """
    if "REPLACE_WITH_CONFIRMED" in MITECO_STATIONS_URL:
        sys.exit(
            "[ERROR] MITECO_STATIONS_URL not confirmed.\n"
            "  See the docstring at the top of this script for discovery instructions."
        )

    r = requests.get(MITECO_STATIONS_URL, timeout=30)
    r.raise_for_status()
    data = r.json()

    # TODO: adapt the field extraction below to match the actual API response
    stations = []
    for item in data:
        stations.append({
            "station_id":     item.get("codigo") or item.get("id") or item.get("station_id"),
            "station_name":   item.get("nombre") or item.get("name"),
            "lat":            _float_or_none(item.get("latitud") or item.get("lat")),
            "lng":            _float_or_none(item.get("longitud") or item.get("lon") or item.get("lng")),
            "municipio_code": item.get("municipio_code") or item.get("cod_municipio"),
            "municipio_name": item.get("municipio") or item.get("municipio_name"),
            "provincia":      item.get("provincia"),
        })
    return [s for s in stations if s["station_id"]]


# ---------------------------------------------------------------------------
# Readings fetch
# ---------------------------------------------------------------------------

def fetch_readings_for_station(
    station_id: str, date_from: datetime, date_to: datetime
) -> list[dict]:
    """
    Fetch daily readings for a station between date_from and date_to.
    Returns list of {reading_at, aqi_value, pm25, pm10, no2, o3, so2, co}.
    TODO: adapt to actual API response structure.
    """
    if "REPLACE_WITH_CONFIRMED" in MITECO_READINGS_URL:
        return []

    params = {
        "station": station_id,
        "from":    date_from.strftime("%Y-%m-%d"),
        "to":      date_to.strftime("%Y-%m-%d"),
    }
    try:
        r = requests.get(MITECO_READINGS_URL, params=params, timeout=30)
        if r.status_code == 404:
            return []
        r.raise_for_status()
        data = r.json()

        readings = []
        for item in data:
            # TODO: adapt field names to actual API response
            readings.append({
                "reading_at": item.get("fecha") or item.get("date") or item.get("timestamp"),
                "aqi_value":  _int_or_none(item.get("iaqi") or item.get("aqi") or item.get("ica")),
                "pm25_ugm3":  _float_or_none(item.get("pm25") or item.get("pm2_5")),
                "pm10_ugm3":  _float_or_none(item.get("pm10")),
                "no2_ugm3":   _float_or_none(item.get("no2")),
                "o3_ugm3":    _float_or_none(item.get("o3")),
                "so2_ugm3":   _float_or_none(item.get("so2")),
                "co_mgm3":    _float_or_none(item.get("co")),
            })
        return [r for r in readings if r["reading_at"]]

    except Exception as e:
        tqdm.write(f"  [WARN] Failed to fetch readings for {station_id}: {e}")
        return []


# ---------------------------------------------------------------------------
# Annual average computation
# ---------------------------------------------------------------------------

ANNUAL_AVG_SQL = """
SELECT AVG(aqi_value)::DECIMAL(6,2)
FROM air_quality_readings
WHERE station_id = %s
  AND reading_at >= NOW() - INTERVAL '12 months'
  AND aqi_value IS NOT NULL
"""


def compute_annual_avg(conn, station_id: str) -> float | None:
    with conn.cursor() as cur:
        cur.execute(ANNUAL_AVG_SQL, (station_id,))
        row = cur.fetchone()
        return float(row[0]) if row and row[0] is not None else None


# ---------------------------------------------------------------------------
# Database upsert
# ---------------------------------------------------------------------------

UPSERT_SQL = """
INSERT INTO air_quality_readings (
    station_id, station_name,
    municipio_code, municipio_name, provincia,
    lat, lng, geom,
    aqi_value, aqi_category,
    pm25_ugm3, pm10_ugm3, no2_ugm3, o3_ugm3, so2_ugm3, co_mgm3,
    aqi_annual_avg,
    reading_at
)
VALUES (
    %(station_id)s, %(station_name)s,
    %(municipio_code)s, %(municipio_name)s, %(provincia)s,
    %(lat)s, %(lng)s,
    CASE WHEN %(lat)s IS NOT NULL AND %(lng)s IS NOT NULL
         THEN ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::geography
         ELSE NULL END,
    %(aqi_value)s, %(aqi_category)s,
    %(pm25_ugm3)s, %(pm10_ugm3)s, %(no2_ugm3)s,
    %(o3_ugm3)s, %(so2_ugm3)s, %(co_mgm3)s,
    %(aqi_annual_avg)s,
    %(reading_at)s
)
ON CONFLICT (station_id, reading_at) DO UPDATE SET
    aqi_value      = EXCLUDED.aqi_value,
    aqi_category   = EXCLUDED.aqi_category,
    pm25_ugm3      = EXCLUDED.pm25_ugm3,
    pm10_ugm3      = EXCLUDED.pm10_ugm3,
    no2_ugm3       = EXCLUDED.no2_ugm3,
    o3_ugm3        = EXCLUDED.o3_ugm3,
    so2_ugm3       = EXCLUDED.so2_ugm3,
    co_mgm3        = EXCLUDED.co_mgm3,
    aqi_annual_avg = EXCLUDED.aqi_annual_avg
"""


def upsert_reading(conn, record: dict):
    with conn.cursor() as cur:
        cur.execute(UPSERT_SQL, record)


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def _float_or_none(val) -> float | None:
    try:
        return float(val) if val is not None else None
    except (TypeError, ValueError):
        return None


def _int_or_none(val) -> int | None:
    try:
        return int(float(val)) if val is not None else None
    except (TypeError, ValueError):
        return None


def run(args):
    if "REPLACE_WITH_CONFIRMED" in MITECO_STATIONS_URL:
        print(
            "[ERROR] MITECO API endpoint not confirmed.\n"
            "  This script cannot run until the endpoint is discovered.\n"
            "  See docstring at the top of this file for instructions.\n"
            "\n"
            "  Alternative: The EU EEA API provides Spanish station data:\n"
            "    https://discomap.eea.europa.eu/map/fme/AirQualityStatistics.htm\n"
            "  Consider implementing EEA as the primary source if MITECO REST API\n"
            "  is not publicly accessible."
        )
        sys.exit(1)

    date_to   = datetime.now(timezone.utc)
    date_from = date_to - timedelta(days=args.days)

    print(f"→ Fetching MITECO air quality: {date_from.date()} → {date_to.date()}")

    if args.dry_run:
        print("[DRY RUN] No DB writes.")
        conn = None
    else:
        conn = get_conn()

    # Get station list (or single station for testing)
    if args.station:
        stations = [{"station_id": args.station, "station_name": None,
                     "lat": None, "lng": None, "municipio_code": None,
                     "municipio_name": None, "provincia": None}]
    else:
        stations = fetch_stations()
        print(f"  {len(stations)} active stations found")

    n_readings = 0
    n_errors   = 0

    for station in tqdm(stations, desc="Stations", unit="station"):
        station_id = station["station_id"]

        readings = fetch_readings_for_station(station_id, date_from, date_to)
        if not readings:
            continue

        # Compute annual average after fetching (used for all new readings)
        annual_avg = compute_annual_avg(conn, station_id) if conn else None

        for reading in readings:
            aqi_val = reading["aqi_value"]
            record = {
                **station,
                **reading,
                "aqi_category":  aqi_to_category(float(aqi_val) if aqi_val is not None else None),
                "aqi_annual_avg": annual_avg,
            }

            if args.dry_run:
                pass  # nothing to write
            else:
                try:
                    upsert_reading(conn, record)
                    n_readings += 1
                except Exception as e:
                    tqdm.write(f"  [ERROR] Upsert failed for {station_id}: {e}")
                    conn.rollback()
                    n_errors += 1

        if conn:
            conn.commit()

        time.sleep(0.5)  # rate limit

    if conn:
        conn.close()

    print(f"""
✓ Air quality ingestion complete
  Readings upserted: {n_readings}
  Errors:            {n_errors}
""")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Ingest MITECO air quality readings → air_quality_readings"
    )
    parser.add_argument(
        "--days", type=int, default=1,
        help="Number of days to backfill (default: 1 — yesterday)"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Fetch data but do not write to DB"
    )
    parser.add_argument(
        "--station",
        help="Process a single station ID only (for testing)"
    )
    args = parser.parse_args()
    run(args)


if __name__ == "__main__":
    main()
