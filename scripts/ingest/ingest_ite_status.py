from __future__ import annotations
#!/usr/bin/env python3
"""
Qolify — ITE Building Inspection Status Ingestion (CHI-325)

Loads ITE (Inspección Técnica de Edificios) data from Madrid and Barcelona
open data portals into the `ite_status` table. Feeds Indicator 2 (Structural
Liability Index) — a failed/overdue ITE is a red-alert risk of compulsory
repair levies (derramas).

Sources:
  Madrid    https://datos.madrid.es/egob/catalogo/201211-0-inspeccion-tecnica-edificios.csv
            Field: resultado_ite — FAVORABLE / DESFAVORABLE
  Barcelona https://opendata-ajuntament.barcelona.cat/data/dataset/cens-ite
            CSV URL discovered at runtime via CKAN API
            Field: estat_inspeccio — severity scale (Molt greu → Sense deficiències)

Coverage at launch: Madrid + Barcelona only.
Other cities return confidence='not_available' in the indicator engine.

Usage:
  python ingest_ite_status.py              # both cities
  python ingest_ite_status.py --city madrid
  python ingest_ite_status.py --city barcelona
  python ingest_ite_status.py --dry-run    # parse only, no DB writes
  python ingest_ite_status.py --no-geocode # skip Nominatim (faster, nulls coords)
  python ingest_ite_status.py --city madrid --inspect-fields
                                           # print CSV headers and exit
"""

import argparse
import csv
import io
import sys
import time

import requests
from tqdm import tqdm
from _db import get_conn

# ---------------------------------------------------------------------------
# Data source URLs
# ---------------------------------------------------------------------------

MADRID_ITE_URL = (
    "https://datos.madrid.es/egob/catalogo/201211-0-inspeccion-tecnica-edificios.csv"
)

# Barcelona: CKAN API endpoint to discover the current CSV resource URL.
# The actual CSV URL (with a UUID resource ID) can change when the dataset
# is updated. We fetch it dynamically rather than hardcoding it.
BARCELONA_CKAN_API = (
    "https://opendata-ajuntament.barcelona.cat/data/api/3/action/package_show"
    "?id=cens-ite"
)


def get_barcelona_csv_url() -> str:
    """
    Discover the direct CSV download URL from the Barcelona CKAN API.
    Returns the URL of the first CSV resource found, or raises if none.
    """
    r = requests.get(BARCELONA_CKAN_API, timeout=15)
    r.raise_for_status()
    result = r.json()
    resources = result.get("result", {}).get("resources", [])
    # Prefer the most recent CSV resource
    csv_resources = [
        res for res in resources
        if res.get("format", "").upper() in ("CSV", "TEXT/CSV")
    ]
    if not csv_resources:
        # Fall back to any resource
        csv_resources = resources
    if not csv_resources:
        raise RuntimeError(
            "No downloadable resources found for Barcelona ITE dataset. "
            "Check: https://opendata-ajuntament.barcelona.cat/data/dataset/cens-ite"
        )
    url = csv_resources[0].get("url") or csv_resources[0].get("download_url")
    if not url:
        raise RuntimeError(f"Resource has no URL: {csv_resources[0]}")
    return url


# ---------------------------------------------------------------------------
# Status normalisation
# ---------------------------------------------------------------------------

# Madrid resultado_ite values → canonical status
MADRID_STATUS_MAP = {
    "FAVORABLE":                                "passed",
    "FAVORABLE CON DEFICIENCIAS LEVES":         "passed",
    "FAVORABLE CON PRESCRIPCIONES":             "passed",
    "DESFAVORABLE":                             "failed",
    "DESFAVORABLE GRAVE":                       "failed",
    "DESFAVORABLE MUY GRAVE":                   "failed",
    "EN TRAMITACION":                           "pending",
    "EN TRAMITACIÓN":                           "pending",
    "PENDIENTE":                                "pending",
    "SIN ITE":                                  "pending",
    "NO REQUERIDA":                             "not_required",
    "EXENTA":                                   "not_required",
    "NO REQUERIDO":                             "not_required",
}

# Barcelona estat_inspeccio severity scale (Catalan) → canonical status.
# "Molt greu" / "Greu" = structural/serious deficiency = failed.
# "Important" = significant but correctable = failed (conservative).
# "Lleu" = minor = passed with caveats.
# "Sense deficiències" / "Adequat" = no issues = passed.
BARCELONA_STATUS_MAP = {
    # No deficiencies
    "SENSE DEFICIENCIES":                       "passed",
    "SENSE DEFICIÈNCIES":                       "passed",
    "ADEQUAT":                                  "passed",
    "FAVORABLE":                                "passed",
    # Minor (Lleu)
    "LLEU":                                     "passed",
    "DEFICIENCIES LLEUS":                       "passed",
    "DEFICIÈNCIES LLEUS":                       "passed",
    # Significant — failed (conservative; requires intervention)
    "IMPORTANT":                                "failed",
    "DEFICIENCIES IMPORTANTS":                  "failed",
    "DEFICIÈNCIES IMPORTANTS":                  "failed",
    # Serious
    "GREU":                                     "failed",
    "DEFICIENCIES GREUS":                       "failed",
    "DEFICIÈNCIES GREUS":                       "failed",
    # Very serious
    "MOLT GREU":                                "failed",
    "DEFICIENCIES MOLT GREUS":                  "failed",
    "DEFICIÈNCIES MOLT GREUS":                  "failed",
    # Pending / not required
    "PENDENT":                                  "pending",
    "NO REQUERIDA":                             "not_required",
    "NO REQUERIT":                              "not_required",
    "EXEMPT":                                   "not_required",
    "EXEMPCIÓ":                                 "not_required",
}


def normalise_status(raw: str, status_map: dict) -> str:
    """Map raw status string to a canonical value. Defaults to 'pending'."""
    return status_map.get(raw.strip().upper(), "pending")


# ---------------------------------------------------------------------------
# Geocoding via Nominatim
# ---------------------------------------------------------------------------

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_HEADERS = {"User-Agent": "Qolify/1.0 (hello@qolify.com)"}


def geocode(address: str, municipio: str) -> tuple[float, float] | None:
    """Geocode address string to (lat, lng). Respects Nominatim 1 req/s limit."""
    if not address:
        return None
    try:
        r = requests.get(
            NOMINATIM_URL,
            params={"q": f"{address}, {municipio}, Spain",
                    "format": "json", "limit": 1, "countrycodes": "es"},
            headers=NOMINATIM_HEADERS,
            timeout=10,
        )
        results = r.json()
        if results:
            return float(results[0]["lat"]), float(results[0]["lon"])
    except Exception as e:
        tqdm.write(f"  [WARN] Geocode failed for '{address[:50]}': {e}")
    finally:
        time.sleep(1.1)
    return None


# ---------------------------------------------------------------------------
# Catastro OVC ref_catastral lookup
# ---------------------------------------------------------------------------

def lookup_catastral_ref(address: str, municipio: str) -> str | None:
    """
    Attempt to resolve a ref_catastral via Catastro OVC address search.
    Accept-rate is <100% — None means not found, not an error.
    """
    if not address:
        return None
    try:
        r = requests.get(
            "https://ovc.catastro.hacienda.gob.es/OVCServWeb/OVCWcfCallejero/"
            "COVCCallejero.svc/rest/Consulta_DNPRC",
            params={"Provincia": municipio, "Municipio": municipio,
                    "Domicilio": address},
            timeout=10,
        )
        data = r.json()
        inmuebles = (
            data.get("consulta_dnprcResult", {})
                .get("datos_consulta", {})
                .get("datos_inmueble", [])
        )
        if not inmuebles:
            return None
        rc = inmuebles[0].get("rc", {})
        ref = (rc.get("pc1", "") + rc.get("pc2", "")).strip()
        return ref or None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# CSV download
# ---------------------------------------------------------------------------

def download_csv(url: str, delimiter: str = ",") -> list[dict]:
    """Download CSV, trying common Spanish encodings."""
    r = requests.get(url, timeout=120, headers={"User-Agent": "Qolify/1.0"})
    r.raise_for_status()
    for enc in ("utf-8-sig", "utf-8", "latin-1", "cp1252"):
        try:
            content = r.content.decode(enc, errors="strict")
            rows = list(csv.DictReader(io.StringIO(content), delimiter=delimiter))
            if rows:
                return rows
        except (UnicodeDecodeError, LookupError):
            continue
    return list(csv.DictReader(
        io.StringIO(r.content.decode("utf-8", errors="replace")),
        delimiter=delimiter
    ))


def detect_delimiter(url: str) -> str:
    """Peek at first line of a CSV URL to guess delimiter."""
    r = requests.get(url, timeout=30, stream=True,
                     headers={"User-Agent": "Qolify/1.0"})
    r.raise_for_status()
    first_line = next(r.iter_lines()).decode("utf-8-sig", errors="replace")
    return ";" if first_line.count(";") > first_line.count(",") else ","


# ---------------------------------------------------------------------------
# Database upsert
# ---------------------------------------------------------------------------

UPSERT_SQL = """
INSERT INTO ite_status (
    ref_catastral, address, lat, lng, geom,
    status, inspection_date, due_date,
    municipio, source, updated_at
)
VALUES (
    %(ref_catastral)s, %(address)s, %(lat)s, %(lng)s,
    CASE WHEN %(lat)s IS NOT NULL AND %(lng)s IS NOT NULL
         THEN ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::geography
         ELSE NULL END,
    %(status)s, %(inspection_date)s, %(due_date)s,
    %(municipio)s, %(source)s, NOW()
)
ON CONFLICT (ref_catastral) WHERE ref_catastral IS NOT NULL
DO UPDATE SET
    address         = COALESCE(EXCLUDED.address, ite_status.address),
    lat             = COALESCE(EXCLUDED.lat, ite_status.lat),
    lng             = COALESCE(EXCLUDED.lng, ite_status.lng),
    geom            = COALESCE(EXCLUDED.geom, ite_status.geom),
    status          = EXCLUDED.status,
    inspection_date = COALESCE(EXCLUDED.inspection_date, ite_status.inspection_date),
    due_date        = COALESCE(EXCLUDED.due_date, ite_status.due_date),
    updated_at      = NOW()
"""

INSERT_NO_REF_SQL = """
INSERT INTO ite_status (
    address, lat, lng, geom, status, inspection_date, due_date,
    municipio, source, updated_at
)
VALUES (
    %(address)s, %(lat)s, %(lng)s,
    CASE WHEN %(lat)s IS NOT NULL AND %(lng)s IS NOT NULL
         THEN ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::geography
         ELSE NULL END,
    %(status)s, %(inspection_date)s, %(due_date)s,
    %(municipio)s, %(source)s, NOW()
)
"""


def _safe_date(val) -> str | None:
    if not val or str(val).strip() in ("", "-", "N/A", "null", "0", "None"):
        return None
    return str(val).strip()


def _float_or_none(val) -> float | None:
    try:
        return float(val) if val is not None else None
    except (TypeError, ValueError):
        return None


def upsert_batch(conn, records: list[dict], batch_size: int = 500):
    with_ref    = [r for r in records if r.get("ref_catastral")]
    without_ref = [r for r in records if not r.get("ref_catastral")]
    with conn.cursor() as cur:
        for i in range(0, len(with_ref), batch_size):
            for rec in with_ref[i:i + batch_size]:
                cur.execute(UPSERT_SQL, rec)
            conn.commit()
        for i in range(0, len(without_ref), batch_size):
            for rec in without_ref[i:i + batch_size]:
                cur.execute(INSERT_NO_REF_SQL, rec)
            conn.commit()


# ---------------------------------------------------------------------------
# City ingestors
# ---------------------------------------------------------------------------

def ingest_madrid(conn, dry_run: bool, do_geocode: bool, inspect_fields: bool) -> int:
    """
    Ingest Madrid ITE dataset.

    Confirmed field names (datos.madrid.es, 2026):
      resultado_ite     → FAVORABLE / FAVORABLE CON DEFICIENCIAS LEVES / DESFAVORABLE
      Address fields:   try DIRECCION, DOMICILIO_INMUEBLE, DOMICILIO (in that order)
      Date fields:      try FECHA_ITE, AÑO_ITE, FECHA_INSPECCION
      Due date:         try FECHA_VENCIMIENTO, AÑO_VENCIMIENTO
      Coordinates:      try COORD_X_ETRS89 / COORD_Y_ETRS89 (EPSG:25830 — needs reproject)
                        or LATITUD / LONGITUD (WGS84, if present)
    """
    print("\n→ Madrid ITE")
    delim = detect_delimiter(MADRID_ITE_URL)
    rows  = download_csv(MADRID_ITE_URL, delimiter=delim)
    print(f"  Downloaded {len(rows)} rows  (delimiter='{delim}')")

    if inspect_fields:
        print("  Fields:", list(rows[0].keys()) if rows else "(empty)")
        return 0

    # Try to detect coordinate fields and whether they need reprojection
    first = rows[0] if rows else {}
    has_etrs89 = any(k.upper() in ("COORD_X_ETRS89", "COORD_X", "X_ETRS89", "UTM_X")
                     for k in first)
    has_wgs84  = any(k.upper() in ("LATITUD", "LATITUDE", "LAT") for k in first)

    transformer = None
    if has_etrs89 and not has_wgs84:
        try:
            from pyproj import Transformer
            transformer = Transformer.from_crs("EPSG:25830", "EPSG:4326", always_xy=True)
        except ImportError:
            print("  [WARN] pyproj not installed — coordinates will be null. pip install pyproj")

    records = []
    for row in tqdm(rows, desc="  Madrid ITE", unit="rec"):
        row_upper = {k.upper(): v for k, v in row.items()}

        address = (
            row_upper.get("DIRECCION") or
            row_upper.get("DOMICILIO_INMUEBLE") or
            row_upper.get("DOMICILIO") or ""
        ).strip()

        status_raw = (
            row_upper.get("RESULTADO_ITE") or
            row_upper.get("RESULTADO") or ""
        )

        inspection_date = _safe_date(
            row_upper.get("FECHA_ITE") or
            row_upper.get("AÑO_ITE") or
            row_upper.get("FECHA_INSPECCION")
        )
        due_date = _safe_date(
            row_upper.get("FECHA_VENCIMIENTO") or
            row_upper.get("AÑO_VENCIMIENTO")
        )

        # Coordinates
        lat, lng = None, None
        if transformer:
            x = _float_or_none(row_upper.get("COORD_X_ETRS89") or row_upper.get("COORD_X") or row_upper.get("X_ETRS89"))
            y = _float_or_none(row_upper.get("COORD_Y_ETRS89") or row_upper.get("COORD_Y") or row_upper.get("Y_ETRS89"))
            if x and y:
                try:
                    lng, lat = transformer.transform(x, y)
                except Exception:
                    pass
        elif has_wgs84:
            lat = _float_or_none(row_upper.get("LATITUD") or row_upper.get("LAT"))
            lng = _float_or_none(row_upper.get("LONGITUD") or row_upper.get("LON") or row_upper.get("LNG"))

        if lat is None and do_geocode and address:
            coords = geocode(address, "Madrid")
            if coords:
                lat, lng = coords

        ref = lookup_catastral_ref(address, "Madrid") if address else None

        records.append({
            "ref_catastral":   ref,
            "address":         address or None,
            "lat":             lat,
            "lng":             lng,
            "status":          normalise_status(status_raw, MADRID_STATUS_MAP),
            "inspection_date": inspection_date,
            "due_date":        due_date,
            "municipio":       "Madrid",
            "source":          "datos.madrid.es",
        })

    if dry_run:
        geocoded = sum(1 for r in records if r["lat"])
        print(f"  [DRY] Would upsert {len(records)} records ({geocoded} with coords)")
    else:
        upsert_batch(conn, records)
        geocoded = sum(1 for r in records if r["lat"])
        print(f"  ✓ {len(records)} Madrid ITE records upserted ({geocoded} with coords)")

    return len(records)


def ingest_barcelona(conn, dry_run: bool, do_geocode: bool, inspect_fields: bool) -> int:
    """
    Ingest Barcelona ITE dataset via CKAN API resource discovery.

    Confirmed field names (Open Data BCN, 2026):
      estat_inspeccio / resultat → severity scale (Molt greu → Sense deficiències)
      Address fields: adreca, domicili, direccion
      Date fields:    data_ite, data_inspeccio
      The dataset may include lat/lng directly in some years.
    """
    print("\n→ Barcelona ITE (discovering CSV URL from CKAN...)")
    try:
        csv_url = get_barcelona_csv_url()
        print(f"  CSV URL: {csv_url}")
    except Exception as e:
        print(f"  [ERROR] Could not discover Barcelona ITE CSV: {e}")
        return 0

    delim = detect_delimiter(csv_url)
    rows  = download_csv(csv_url, delimiter=delim)
    print(f"  Downloaded {len(rows)} rows  (delimiter='{delim}')")

    if inspect_fields:
        print("  Fields:", list(rows[0].keys()) if rows else "(empty)")
        return 0

    records = []
    for row in tqdm(rows, desc="  Barcelona ITE", unit="rec"):
        row_upper = {k.upper(): v for k, v in row.items()}

        address = (
            row_upper.get("ADRECA") or
            row_upper.get("DIRECCIO") or
            row_upper.get("DOMICILI") or
            row_upper.get("DIRECCION") or
            row_upper.get("ADDRESS") or ""
        ).strip()

        status_raw = (
            row_upper.get("ESTAT_INSPECCIO") or
            row_upper.get("RESULTAT") or
            row_upper.get("ESTAT") or
            row_upper.get("RESULTADO") or ""
        )

        inspection_date = _safe_date(
            row_upper.get("DATA_ITE") or
            row_upper.get("DATA_INSPECCIO") or
            row_upper.get("FECHA_ITE")
        )
        due_date = _safe_date(
            row_upper.get("DATA_VENCIMENT") or
            row_upper.get("FECHA_VENCIMIENTO")
        )

        lat = _float_or_none(
            row_upper.get("LATITUD") or row_upper.get("LAT") or row_upper.get("LATITUDINE")
        )
        lng = _float_or_none(
            row_upper.get("LONGITUD") or row_upper.get("LON") or row_upper.get("LNG") or row_upper.get("LONG")
        )

        if lat is None and do_geocode and address:
            coords = geocode(address, "Barcelona")
            if coords:
                lat, lng = coords

        ref = lookup_catastral_ref(address, "Barcelona") if address else None

        records.append({
            "ref_catastral":   ref,
            "address":         address or None,
            "lat":             lat,
            "lng":             lng,
            "status":          normalise_status(status_raw, BARCELONA_STATUS_MAP),
            "inspection_date": inspection_date,
            "due_date":        due_date,
            "municipio":       "Barcelona",
            "source":          "opendata-ajuntament.barcelona.cat",
        })

    if dry_run:
        geocoded = sum(1 for r in records if r["lat"])
        print(f"  [DRY] Would upsert {len(records)} records ({geocoded} with coords)")
    else:
        upsert_batch(conn, records)
        geocoded = sum(1 for r in records if r["lat"])
        print(f"  ✓ {len(records)} Barcelona ITE records upserted ({geocoded} with coords)")

    return len(records)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Ingest ITE building inspection status → ite_status"
    )
    parser.add_argument("--city", choices=["madrid", "barcelona"],
                        help="Process only this city (default: both)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Download and parse without writing to DB")
    parser.add_argument("--no-geocode", action="store_true",
                        help="Skip Nominatim geocoding (faster; nulls lat/lng for unmatched)")
    parser.add_argument("--inspect-fields", action="store_true",
                        help="Print CSV column headers and exit (useful for debugging)")
    args = parser.parse_args()

    conn = None if args.dry_run else get_conn()
    do_geocode = not args.no_geocode
    total = 0

    try:
        if args.city in (None, "madrid"):
            total += ingest_madrid(conn, args.dry_run, do_geocode, args.inspect_fields)
        if args.city in (None, "barcelona"):
            total += ingest_barcelona(conn, args.dry_run, do_geocode, args.inspect_fields)
    finally:
        if conn:
            conn.close()

    print(f"\n✓ Done. {total} ITE records processed.")
    print("\nTip: First run with --inspect-fields --city madrid to verify column names,")
    print("     then run with --no-geocode for speed, then --geocode-only to fill coords.")


if __name__ == "__main__":
    main()


# =============================================================================
# SQL helpers (run once in Supabase)
# =============================================================================
#
# -- Lookup by ref_catastral (primary indicator engine lookup)
# CREATE OR REPLACE FUNCTION get_ite_for_property(p_ref TEXT)
# RETURNS SETOF ite_status LANGUAGE sql STABLE AS $$
#   SELECT * FROM ite_status WHERE ref_catastral = p_ref LIMIT 1;
# $$;
#
# -- Coverage check (for 'not_available' confidence flag)
# CREATE OR REPLACE FUNCTION has_ite_coverage(p_municipio TEXT)
# RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
#   SELECT EXISTS (SELECT 1 FROM ite_status WHERE municipio = p_municipio LIMIT 1);
# $$;
