#!/usr/bin/env python3
"""
Ingest MITMA national GTFS transport stops into the `transport_stops` table.

Source: Ministerio de Transportes y Movilidad Sostenible (MITMA)
Download: https://www.transportes.gob.es/recursos_mfom/listado.recursos/publicaciones/opendata/gtfs/

The national GTFS feed contains stops for:
  - Long-distance bus (route_type=3)
  - Regional bus (route_type=3)
  - Renfe Cercanías (route_type=2)
  - Renfe AVE/Larga Distancia (route_type=2, flagged as 'ave' by route name)

Usage:
  python ingest_gtfs.py                                  # downloads national feed
  python ingest_gtfs.py --gtfs-path /tmp/gtfs.zip       # use local file
  python ingest_gtfs.py --bbox 36.4,-5.1,36.8,-4.3     # Málaga only
"""
import argparse
import io
import os
import sys
import zipfile
import csv
import requests
from tqdm import tqdm
from _db import get_conn, execute_batch

# MITMA national GTFS (intercity/ALSA buses via NAP platform S3 mirror).
# The original MITMA direct URL now returns 403 (moved behind NAP portal login).
# This S3 mirror (busmaps.com/transitpdf.com) is the improved/validated version.
# For full Málaga coverage, EMT Málaga (local buses) needs a separate feed:
#   https://nap.transportes.gob.es/ → search "EMT Málaga"
MITMA_GTFS_URL = "https://s3.transitpdf.com/files/uran/improved-gtfs-alsa-autobuses.zip"

# GTFS route_type → Qolify tipo
ROUTE_TYPE_MAP = {
    "0": "tram",
    "1": "metro",
    "2": "cercanias",   # rail — refined to 'ave' below based on route name
    "3": "bus",
    "4": "ferry",
    "109": "cercanias",
    "400": "metro",
    "700": "bus",
    "900": "tram",
}

AVE_KEYWORDS = ("Ave", "AVE", "Larga Distancia", "Alvia", "Intercity", "Talgo")


def download_gtfs(url: str) -> bytes:
    print(f"Downloading GTFS from {url}...")
    resp = requests.get(url, timeout=300, stream=True)
    resp.raise_for_status()
    total = int(resp.headers.get("content-length", 0))
    buf = io.BytesIO()
    with tqdm(total=total, unit="B", unit_scale=True, desc="GTFS download") as bar:
        for chunk in resp.iter_content(chunk_size=65536):
            buf.write(chunk)
            bar.update(len(chunk))
    return buf.getvalue()


def parse_gtfs(gtfs_bytes: bytes, bbox: tuple = None):
    """
    Parse stops.txt and routes.txt from a GTFS zip.
    bbox = (south, west, north, east) floats, or None for all.
    Returns list of transport_stops dicts.
    """
    with zipfile.ZipFile(io.BytesIO(gtfs_bytes)) as zf:
        names = zf.namelist()

        # Parse stops
        stops = {}
        with zf.open("stops.txt") as f:
            reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))
            for row in reader:
                try:
                    lat = float(row["stop_lat"])
                    lng = float(row["stop_lon"])
                except (ValueError, KeyError):
                    continue

                if bbox:
                    s, w, n, e = bbox
                    if not (s <= lat <= n and w <= lng <= e):
                        continue

                stops[row["stop_id"]] = {
                    "stop_id": row["stop_id"],
                    "nombre":  row.get("stop_name", ""),
                    "lat":     lat,
                    "lng":     lng,
                }

        if not stops:
            print("No stops found (check bbox or feed)")
            return []

        # Parse routes to determine tipo
        route_tipo = {}
        if "routes.txt" in names:
            with zf.open("routes.txt") as f:
                reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))
                for row in reader:
                    rt = row.get("route_type", "3")
                    tipo = ROUTE_TYPE_MAP.get(rt, "bus")
                    long_name = row.get("route_long_name", "")
                    if tipo == "cercanias" and any(k in long_name for k in AVE_KEYWORDS):
                        tipo = "ave"
                    route_tipo[row["route_id"]] = tipo

        # Map stop → tipo via stop_times → trips → routes
        stop_tipo = {}
        stop_operator = {}
        if "trips.txt" in names and "stop_times.txt" in names:
            trip_route = {}
            with zf.open("trips.txt") as f:
                reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))
                for row in reader:
                    trip_route[row["trip_id"]] = row.get("route_id")

            with zf.open("stop_times.txt") as f:
                reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))
                for row in reader:
                    sid = row["stop_id"]
                    if sid not in stops:
                        continue
                    route_id = trip_route.get(row["trip_id"])
                    if route_id and route_id in route_tipo:
                        # First route wins for tipo assignment
                        stop_tipo.setdefault(sid, route_tipo[route_id])

        # Build final records
        records = []
        for stop_id, stop in stops.items():
            tipo = stop_tipo.get(stop_id, "bus")
            records.append({
                "nombre":   stop["nombre"],
                "tipo":     tipo,
                "lat":      stop["lat"],
                "lng":      stop["lng"],
                "operator": None,
                "source":   "mitma_gtfs",
            })

        return records


UPSERT_SQL = """
INSERT INTO transport_stops (nombre, tipo, lat, lng, geom, operator, source, updated_at)
VALUES (
    %(nombre)s,
    %(tipo)s,
    %(lat)s,
    %(lng)s,
    ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::GEOGRAPHY,
    %(operator)s,
    %(source)s,
    NOW()
)
ON CONFLICT DO NOTHING
"""


def main():
    parser = argparse.ArgumentParser(description="Ingest MITMA GTFS stops → Qolify")
    parser.add_argument("--gtfs-path", help="Path to local GTFS zip file")
    parser.add_argument("--bbox", help="south,west,north,east — filter stops to this area")
    args = parser.parse_args()

    bbox = None
    if args.bbox:
        try:
            bbox = tuple(float(x) for x in args.bbox.split(","))
            if len(bbox) != 4:
                raise ValueError
        except ValueError:
            print("--bbox must be south,west,north,east e.g. 36.4,-5.1,36.8,-4.3")
            sys.exit(1)

    # Load GTFS data
    if args.gtfs_path:
        with open(args.gtfs_path, "rb") as f:
            gtfs_bytes = f.read()
    else:
        gtfs_bytes = download_gtfs(MITMA_GTFS_URL)

    print("Parsing GTFS...")
    records = parse_gtfs(gtfs_bytes, bbox=bbox)
    print(f"Found {len(records)} stops")

    if not records:
        print("Nothing to insert.")
        return

    conn = get_conn()
    execute_batch(conn, UPSERT_SQL, records)
    conn.close()
    print(f"✓ Done. {len(records)} transport stops written.")


if __name__ == "__main__":
    main()
