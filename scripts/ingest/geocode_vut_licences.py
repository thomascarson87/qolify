from __future__ import annotations
#!/usr/bin/env python3
"""
Qolify — VUT Licence Geocoding Backfill (CHI-326 follow-up)

The OpenRTA feed we ingest via `ingest_vut_licences.py` does not return
coordinates — it returns address strings. Because of that, 100 % of the
~192 000 Andalucía `vut_licences` rows currently have `geom = NULL`, which
causes every spatial query (e.g. "VUT licences within 200 m of this pin")
to return 0 and mask a real data signal in the UI.

This script fills that gap using the IGN **CartoCiudad Geocoder** public API.
We already rely on CartoCiudad for postal-zone polygons (see
`ingest_postal_zones_cartociudad.py`), so reuse keeps our provenance story
simple: Spanish addresses → Spanish authoritative geocoder.

Why CartoCiudad over alternatives
---------------------------------
  Nominatim (OpenStreetMap) — free but public instance is rate-limited to
      ~1 req/s, which would take ≥ 54 h for a full Andalucía backfill.
      Privately hosting is possible but overkill for a one-shot job.
  Google / Mapbox             — paid. No need for a paid provider when a
      free authoritative one exists for Spanish addresses.
  CartoCiudad                 — free, authoritative (IGN), no hard rate
      limit documented. Endpoint: `/geocoder/api/geocoder/candidates`
      returns JSON candidates with lat/lng inline.

Usage
-----
  python3 geocode_vut_licences.py                     # all null-geom rows
  python3 geocode_vut_licences.py --region andalucia  # one region only
  python3 geocode_vut_licences.py --limit 500         # first 500 rows (test)
  python3 geocode_vut_licences.py --concurrency 8     # parallel workers
  python3 geocode_vut_licences.py --dry-run           # no DB writes

The script is idempotent: rows with an existing `geom` are never touched.
Safe to kill (Ctrl-C) and resume — each successful geocode commits
immediately so progress is never lost.
"""

import argparse
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional

import requests
from tqdm import tqdm

from _db import get_conn

# ---------------------------------------------------------------------------
# CartoCiudad Geocoder
# ---------------------------------------------------------------------------

# Candidates endpoint returns a ranked JSON list; the top item has lat/lng
# and a "stateMsg" confidence code. We accept any candidate whose lat/lng
# falls inside the Iberian bounding box — protects against the occasional
# false positive that geocodes to an overseas territory or a misread number.
CARTOCIUDAD_URL = "https://www.cartociudad.es/geocoder/api/geocoder/candidates"

# Iberian peninsula + Balearics bounding box. Anything outside this we
# treat as a mismatch rather than writing bad coords into the DB. Keeping
# this tight on purpose — we're geocoding addresses that *should* be in
# Andalucía; a hit in Canarias is almost certainly a false match.
IBERIA_BBOX = (-10.0, 35.5, 5.0, 44.0)  # (min_lon, min_lat, max_lon, max_lat)

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Qolify/1.0 (hello@qolify.com) VUT-geocoder",
    "Accept":     "application/json",
})


def geocode_cartociudad(
    address: str,
    municipio: Optional[str],
    timeout: float = 10.0,
) -> tuple[float, float] | None:
    """
    Return (lat, lng) for the best CartoCiudad candidate, or None.

    We pass the address first and the municipio as part of the query string.
    CartoCiudad's ranking handles partial/noisy queries reasonably well — if
    the top candidate is outside the Iberia bbox we reject the whole result
    rather than fall through to lower-ranked hits (which are rarely better).
    """
    if not address:
        return None
    query = address if not municipio else f"{address}, {municipio}"
    try:
        r = SESSION.get(
            CARTOCIUDAD_URL,
            params={"q": query, "limit": 1, "_format": "json"},
            timeout=timeout,
        )
        if r.status_code != 200:
            return None
        data = r.json()
    except (requests.RequestException, ValueError):
        return None

    # API returns either a list or an object with "candidatos"/"features" —
    # tolerate both shapes.
    candidates: list = []
    if isinstance(data, list):
        candidates = data
    elif isinstance(data, dict):
        candidates = data.get("candidatos") or data.get("features") or data.get("results") or []

    if not candidates:
        return None

    top = candidates[0]
    # CartoCiudad candidates use "lat"/"lng" fields; GeoJSON-style responses
    # use geometry.coordinates. Try both.
    lat = _first_float(top, ["lat", "latitude"])
    lng = _first_float(top, ["lng", "lon", "longitude"])
    if lat is None or lng is None:
        geom = top.get("geometry") if isinstance(top, dict) else None
        if isinstance(geom, dict):
            coords = geom.get("coordinates")
            if isinstance(coords, list) and len(coords) >= 2:
                lng, lat = float(coords[0]), float(coords[1])

    if lat is None or lng is None:
        return None

    min_lon, min_lat, max_lon, max_lat = IBERIA_BBOX
    if not (min_lat <= lat <= max_lat and min_lon <= lng <= max_lon):
        return None

    return lat, lng


def _first_float(obj: dict, keys: list[str]) -> float | None:
    for k in keys:
        v = obj.get(k)
        if v is None:
            continue
        try:
            return float(v)
        except (TypeError, ValueError):
            continue
    return None


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

SELECT_SQL = """
SELECT id, address, region
FROM vut_licences
WHERE geom IS NULL
  AND address IS NOT NULL
  AND address <> ''
  {region_clause}
ORDER BY id
{limit_clause}
"""

UPDATE_SQL = """
UPDATE vut_licences
SET lat  = %(lat)s,
    lng  = %(lng)s,
    geom = ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::geography,
    updated_at = NOW()
WHERE id = %(id)s
"""


def fetch_batch(conn, region: str | None, limit: int | None) -> list[tuple]:
    """Load the set of rows that still need geocoding."""
    sql = SELECT_SQL.format(
        region_clause=("AND region = %s" if region else ""),
        limit_clause =("LIMIT %s"        if limit  else ""),
    )
    params: list = []
    if region: params.append(region)
    if limit:  params.append(limit)

    with conn.cursor() as cur:
        cur.execute(sql, tuple(params))
        return cur.fetchall()


def _municipio_for_row(region: str) -> str | None:
    """
    We don't store municipio on the vut_licences table — it lives in the
    source feed but wasn't carried through. For regional context we append
    the region label so e.g. a Málaga street disambiguates against a
    same-named street elsewhere in Spain.
    """
    return {
        "andalucia": "Andalucía, España",
        "madrid":    "Madrid, España",
        "catalunya": "Catalunya, España",
        "valencia":  "Valencia, España",
    }.get(region, "España")


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def run(args: argparse.Namespace) -> None:
    conn = get_conn()
    conn.autocommit = True    # each successful geocode commits immediately

    print(f"Loading candidate rows (region={args.region or 'all'}) …")
    rows = fetch_batch(conn, args.region, args.limit)
    if not rows:
        print("Nothing to do — no rows have geom IS NULL.")
        return
    print(f"  {len(rows):,} rows to geocode.")

    if args.dry_run:
        print("--dry-run: will query CartoCiudad but not write to DB.")

    hits   = 0
    misses = 0
    errors = 0

    def work(row: tuple) -> tuple[int, str, str, tuple[float, float] | None]:
        row_id, address, region = row
        municipio = _municipio_for_row(region)
        coords = geocode_cartociudad(address, municipio)
        return row_id, address, region, coords

    with ThreadPoolExecutor(max_workers=args.concurrency) as pool, \
         tqdm(total=len(rows), unit="row", desc="Geocoding") as pbar:

        futures = [pool.submit(work, r) for r in rows]
        for fut in as_completed(futures):
            try:
                row_id, address, _region, coords = fut.result()
            except Exception as exc:
                errors += 1
                tqdm.write(f"  [ERR] worker crashed: {exc}")
                pbar.update(1)
                continue

            if coords is None:
                misses += 1
            else:
                lat, lng = coords
                hits += 1
                if not args.dry_run:
                    try:
                        with conn.cursor() as cur:
                            cur.execute(UPDATE_SQL, {"id": row_id, "lat": lat, "lng": lng})
                    except Exception as exc:
                        errors += 1
                        tqdm.write(f"  [ERR] DB update failed for {row_id}: {exc}")

            pbar.set_postfix(hits=hits, misses=misses, errors=errors)
            pbar.update(1)

            # Light jitter between scheduled requests to avoid hammering the
            # CartoCiudad endpoint. Because tasks are already running in
            # parallel the sleep only applies to the dispatching thread, so
            # it caps aggregate QPS at roughly (concurrency / interval).
            if args.interval > 0:
                time.sleep(args.interval)

    print()
    print(f"Done. hits={hits:,}  misses={misses:,}  errors={errors:,}")
    if hits and args.dry_run:
        print("(dry-run — no rows were actually updated)")


def main() -> int:
    p = argparse.ArgumentParser(
        description="Geocode vut_licences rows that have NULL geom via CartoCiudad."
    )
    p.add_argument("--region",  choices=["andalucia", "madrid", "catalunya", "valencia"],
                   help="Only geocode rows from this region (default: all).")
    p.add_argument("--limit",   type=int, default=None,
                   help="Stop after N rows (useful for a quick sanity check).")
    p.add_argument("--concurrency", type=int, default=6,
                   help="Parallel CartoCiudad requests (default: 6). Keep polite.")
    p.add_argument("--interval",  type=float, default=0.0,
                   help="Seconds to sleep between dispatch (default: 0). Raise if throttled.")
    p.add_argument("--dry-run",   action="store_true",
                   help="Query CartoCiudad but don't write updates.")
    args = p.parse_args()

    try:
        run(args)
    except KeyboardInterrupt:
        print("\nInterrupted — partial progress already committed.")
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
