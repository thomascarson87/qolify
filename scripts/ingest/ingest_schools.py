#!/usr/bin/env python3
"""
Ingest school data into the `schools` table.

Two sources are supported (use --source to choose):

  osm (default)  — OpenStreetMap via Overpass API. No download required.
                   Fast, good coverage of public + concertado schools.
                   Recommended for first run and Phase 0 testing.

  csv            — Ministerio de Educación national CSV (~28,000 centres).
                   More complete but requires a manual download first:
                   1. Go to https://www.educacion.gob.es/centros/buscarCentros.do
                   2. Select "Busqueda completa" → Export → CSV
                   3. Pass the file path via --csv-path

Usage:
  python ingest_schools.py                                  # OSM, all Spain
  python ingest_schools.py --provincia malaga               # OSM, Málaga only
  python ingest_schools.py --bbox 36.35,-5.20,36.95,-3.90  # OSM, custom bbox
  python ingest_schools.py --source csv --csv-path centros.csv
  python ingest_schools.py --source csv --csv-path centros.csv --provincia 29
"""
import argparse
import csv
import io
import sys
import time
import requests
from tqdm import tqdm
from _db import get_conn, execute_batch

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

PROVINCE_BBOXES = {
    "malaga":    "36.35,-5.20,36.95,-3.90",
    "madrid":    "40.10,-4.00,40.70,-3.40",
    "barcelona": "41.25,1.90,41.60,2.40",
    "sevilla":   "36.95,-6.00,37.65,-5.50",
    "valencia":  "39.25,-0.60,39.70,-0.25",
    "alicante":  "38.00,-1.00,38.75,0.30",
    "murcia":    "37.50,-2.10,38.10,-0.75",
}

# OSM amenity → Qolify tipo
OSM_SCHOOL_QUERIES = {
    "publico":    "[amenity=school]",
    "infantil":   "[amenity=kindergarten]",
}

OSM_TIPO_MAP = {
    "school":        "publico",
    "kindergarten":  "publico",
}

# Datos.gob.es CSV (manual download required — see docstring above)
DATOS_GOB_FALLBACK = (
    "https://www.educacion.gob.es/centros/datos/centros_docentes.csv"
)

# Minedu tipo codes → Qolify tipo
TIPO_MAP = {
    "1": "publico",
    "2": "concertado",
    "3": "privado",
    "P": "publico",
    "C": "concertado",
    "R": "privado",
}

# Minedu etapa codes → human labels
ETAPA_MAP = {
    "EI": "infantil",
    "EP": "primaria",
    "ESO": "secundaria",
    "BACH": "bachillerato",
    "FP": "formacion_profesional",
    "EE": "educacion_especial",
}


# ---------------------------------------------------------------------------
# OSM source
# ---------------------------------------------------------------------------

def build_overpass_query(bbox: str, tag_filter: str) -> str:
    return f"""
[out:json][timeout:90];
(
  node{tag_filter}({bbox});
  way{tag_filter}({bbox});
);
out center;
"""


def fetch_overpass(query: str, retries: int = 3) -> list:
    for attempt in range(retries):
        try:
            resp = requests.post(OVERPASS_URL, data={"data": query}, timeout=120)
            resp.raise_for_status()
            return resp.json().get("elements", [])
        except requests.RequestException as e:
            if attempt < retries - 1:
                time.sleep(15 * (attempt + 1))
            else:
                raise


def osm_to_records(elements: list, tipo: str) -> list:
    records = []
    for el in elements:
        tags = el.get("tags", {})
        name = (
            tags.get("name")
            or tags.get("name:es")
            or tags.get("operator")
            or tags.get("school:name")
        )

        if el["type"] == "node":
            lat, lng = el.get("lat"), el.get("lon")
        elif el["type"] == "way":
            center = el.get("center", {})
            lat, lng = center.get("lat"), center.get("lon")
        else:
            continue

        if lat is None or lng is None:
            continue

        # Derive tipo from tags (concertado if private-but-state-funded)
        tag_tipo = tags.get("school:type") or tags.get("isced:level", "")
        if tags.get("fee") == "no" and tags.get("operator:type") == "private":
            derived_tipo = "concertado"
        elif tags.get("operator:type") == "private" or tags.get("fee") == "yes":
            derived_tipo = "privado"
        else:
            derived_tipo = "publico"

        # Etapas from OSM level tags
        etapas = []
        levels = tags.get("isced:level", "")
        if "1" in levels or "2" in levels:
            etapas.append("primaria")
        if "3" in levels:
            etapas.append("secundaria")
        if tipo == "infantil" or "0" in levels:
            etapas.append("infantil")
        if not etapas:
            etapas = ["primaria"]  # default for unlabelled schools

        records.append({
            "nombre":        name,
            "tipo":          derived_tipo,
            "etapas":        etapas,
            "lat":           lat,
            "lng":           lng,
            "municipio":     tags.get("addr:city") or tags.get("addr:municipality"),
            "provincia":     tags.get("addr:province"),
            "codigo_postal": tags.get("addr:postcode"),
            "source":        "osm",
        })
    return records


def load_from_osm(bbox: str) -> list:
    records = []
    for tipo, tag_filter in OSM_SCHOOL_QUERIES.items():
        print(f"→ Fetching {tipo} ({tag_filter}) from Overpass...", end=" ", flush=True)
        try:
            query = build_overpass_query(bbox, tag_filter)
            elements = fetch_overpass(query)
            batch = osm_to_records(elements, tipo)
            print(f"{len(batch)} features")
            records.extend(batch)
        except Exception as e:
            print(f"FAILED: {e}")
        time.sleep(2)  # Overpass rate limit
    return records


# ---------------------------------------------------------------------------
# CSV source
# ---------------------------------------------------------------------------

def download_csv(url: str) -> str:
    print(f"Downloading from {url}...")
    resp = requests.get(url, timeout=120, headers={"User-Agent": "Qolify/1.0 data-pipeline"})
    resp.raise_for_status()
    return resp.content.decode("latin-1")


def parse_csv(content: str, provincia_filter: str = None) -> list:
    """
    Parse Minedu centros CSV into transport_stops records.
    Column names vary by edition — we try common variants.
    """
    reader = csv.DictReader(io.StringIO(content), delimiter=";")
    records = []

    # Detect column names from first row
    headers = reader.fieldnames or []
    print(f"CSV columns: {headers[:10]}...")

    # Column name candidates
    def col(*candidates):
        for c in candidates:
            if c in headers:
                return c
        return None

    name_col     = col("NOMBRE_CENTRO", "DCENTRO", "NOMBRE", "nombre_centro")
    tipo_col     = col("TITULARIDAD", "TIPO_CENTRO", "titularidad")
    lat_col      = col("LATITUD", "LAT", "latitud")
    lng_col      = col("LONGITUD", "LON", "longitud")
    prov_col     = col("COD_PROVINCIA", "CPROV", "cod_provincia")
    mun_col      = col("MUNICIPIO", "CNMUN", "municipio")
    postal_col   = col("COD_POSTAL", "CP", "cod_postal")
    prov_name_col = col("PROVINCIA", "DSC_PROVINCIA", "provincia")
    etapas_col   = col("ETAPAS", "NIVELESOFERTADOS", "etapas")

    for row in reader:
        prov_code = row.get(prov_col, "").strip() if prov_col else ""

        if provincia_filter and prov_code != provincia_filter:
            continue

        try:
            lat = float(row.get(lat_col, "").replace(",", ".")) if lat_col else None
            lng = float(row.get(lng_col, "").replace(",", ".")) if lng_col else None
        except (ValueError, TypeError):
            lat, lng = None, None

        if lat is None or lng is None:
            continue

        tipo_raw = row.get(tipo_col, "").strip() if tipo_col else ""
        tipo = TIPO_MAP.get(tipo_raw, "publico")

        # Parse etapas (comma or semicolon separated codes)
        etapas_raw = row.get(etapas_col, "") if etapas_col else ""
        etapas = [
            ETAPA_MAP.get(e.strip(), e.strip())
            for e in etapas_raw.replace(";", ",").split(",")
            if e.strip()
        ]

        records.append({
            "nombre":       (row.get(name_col) or "").strip() if name_col else None,
            "tipo":         tipo,
            "etapas":       etapas or [],
            "lat":          lat,
            "lng":          lng,
            "municipio":    (row.get(mun_col) or "").strip() if mun_col else None,
            "provincia":    (row.get(prov_name_col) or "").strip() if prov_name_col else None,
            "codigo_postal": (row.get(postal_col) or "").strip() if postal_col else None,
            "source":       "minedu",
        })

    return records


UPSERT_SQL = """
INSERT INTO schools (nombre, tipo, etapas, lat, lng, geom, municipio, provincia, codigo_postal, source, updated_at)
VALUES (
    %(nombre)s,
    %(tipo)s,
    %(etapas)s,
    %(lat)s,
    %(lng)s,
    ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::GEOGRAPHY,
    %(municipio)s,
    %(provincia)s,
    %(codigo_postal)s,
    %(source)s,
    NOW()
)
ON CONFLICT DO NOTHING
"""


def main():
    parser = argparse.ArgumentParser(description="Ingest schools → Qolify")
    parser.add_argument(
        "--source", choices=["osm", "csv"], default="osm",
        help="Data source: 'osm' (default, no download needed) or 'csv' (Minedu national CSV)"
    )
    parser.add_argument("--csv-path", help="Path to local Minedu CSV (required for --source csv)")
    parser.add_argument(
        "--provincia",
        help="Named province for OSM bbox (e.g. malaga, madrid) OR province code for CSV filter (e.g. 29)"
    )
    parser.add_argument("--bbox", help="Custom bbox for OSM: south,west,north,east")
    args = parser.parse_args()

    conn = get_conn()

    if args.source == "osm":
        # Determine bbox
        if args.bbox:
            bbox = args.bbox
        elif args.provincia and args.provincia.lower() in PROVINCE_BBOXES:
            bbox = PROVINCE_BBOXES[args.provincia.lower()]
            print(f"Using bbox for {args.provincia}: {bbox}")
        else:
            bbox = "27.6,-18.2,43.8,4.4"  # all Spain
            print("No province/bbox specified — loading all Spain (slow)")

        records = load_from_osm(bbox)
        print(f"\nTotal OSM schools parsed: {len(records)}")

    else:  # csv
        if args.csv_path:
            with open(args.csv_path, "rb") as f:
                content = f.read().decode("latin-1")
        else:
            print("No --csv-path provided for CSV source. Trying fallback URL...")
            try:
                content = download_csv(DATOS_GOB_FALLBACK)
            except Exception as e:
                print(f"Download failed: {e}")
                print("Please download the CSV manually from the Minedu portal.")
                print("  https://www.educacion.gob.es/centros/buscarCentros.do")
                sys.exit(1)

        # For CSV, --provincia is a numeric province code (e.g. 29 for Málaga)
        records = parse_csv(content, provincia_filter=args.provincia)
        print(f"Parsed {len(records)} schools with coordinates")

    if not records:
        print("Nothing to insert.")
        return

    execute_batch(conn, UPSERT_SQL, records)
    conn.close()
    print(f"✓ Done. {len(records)} schools written.")


if __name__ == "__main__":
    main()
