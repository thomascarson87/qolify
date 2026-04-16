from __future__ import annotations
#!/usr/bin/env python3
"""
Ingest Spanish beaches from OpenStreetMap into the `beaches` table.

Uses the Overpass API to fetch all features tagged natural=beach across Spain,
then optionally matches against an ADEAC Blue Flag CSV to set is_blue_flag status.

All rows are UPSERTED by osm_id, so the script is safe to re-run.

Usage:
  python ingest_beaches.py                               # all Spain (Overpass area filter)
  python ingest_beaches.py --bbox 36.35,-5.20,36.95,-3.90  # Málaga bbox
  python ingest_beaches.py --provincia malaga            # named bbox
  python ingest_beaches.py --blue-flag-csv playas_2026.csv
  python ingest_beaches.py --dry-run                     # fetch + count, no DB writes

ADEAC Blue Flag CSV:
  Download annually from https://www.adeac.es/playas-certificadas
  The CSV is expected to have columns including 'Playa' (beach name) and
  'Municipio'. Column names are detected automatically (case-insensitive).
"""
import argparse
import sys
import time
import unicodedata
import requests
from tqdm import tqdm
from _db import get_conn, execute_batch

OVERPASS_URL = "https://overpass.kumi.systems/api/interpreter"

PROVINCE_BBOXES = {
    "malaga":     "36.35,-5.20,36.95,-3.90",
    "madrid":     "40.10,-4.00,40.70,-3.40",
    "barcelona":  "41.25,1.90,41.60,2.40",
    "sevilla":    "36.95,-6.00,37.65,-5.50",
    "valencia":   "39.25,-0.60,39.70,-0.25",
    "alicante":   "37.90,-1.00,38.55,-0.05",
    "cadiz":      "36.00,-6.00,36.85,-5.20",
    "huelva":     "37.00,-7.55,37.75,-6.60",
    "almeria":    "36.60,-3.10,37.35,-1.60",
    "granada":    "36.60,-4.00,37.20,-2.80",
    "murcia":     "37.40,-1.90,38.40,-0.70",
    "castellon":  "39.60,-0.40,40.55,0.50",
    "tarragona":  "40.50,0.40,41.20,1.55",
    "girona":     "41.60,2.65,42.45,3.30",
    "asturias":   "43.10,-7.20,43.70,-4.50",
    "cantabria":  "43.15,-4.50,43.50,-3.35",
    "vizcaya":    "43.05,-3.50,43.45,-2.50",
    "tenerife":   "27.90,-16.95,28.60,-16.10",
    "gran_canaria": "27.70,-15.85,28.20,-15.30",
}


# ── Overpass query builders ──────────────────────────────────────────────────

def build_spain_query() -> str:
    """Full Spain query using the administrative area filter. Slower but complete."""
    return """
[out:json][timeout:120];
area["name"="España"]["boundary"="administrative"]->.searchArea;
(
  way["natural"="beach"](area.searchArea);
  node["natural"="beach"](area.searchArea);
  relation["natural"="beach"](area.searchArea);
);
out center tags;
"""


def build_bbox_query(bbox: str) -> str:
    """Bounding-box query. bbox format: south,west,north,east"""
    return f"""
[out:json][timeout:60];
(
  way["natural"="beach"]({bbox});
  node["natural"="beach"]({bbox});
);
out center tags;
"""


# ── Overpass fetch ───────────────────────────────────────────────────────────

def fetch_overpass(query: str, retries: int = 3) -> list:
    for attempt in range(retries):
        try:
            resp = requests.post(
                OVERPASS_URL,
                data={"data": query},
                timeout=180,
            )
            resp.raise_for_status()
            return resp.json().get("elements", [])
        except requests.RequestException as e:
            if attempt < retries - 1:
                wait = 15 * (attempt + 1)
                print(f"  Overpass error ({e}), retrying in {wait}s...")
                time.sleep(wait)
            else:
                raise


# ── Element parsing ──────────────────────────────────────────────────────────

def classify_beach_type(tags: dict) -> str:
    """
    Derive beach_type from OSM tags.
    Falls back to 'natural' when no distinguishing tag is present.
    """
    name = (tags.get("name") or tags.get("name:es") or "").lower()
    if "cala" in name:
        return "cala"
    water = tags.get("water", "")
    if water in ("lake", "pond", "reservoir"):
        return "lake"
    waterway = tags.get("waterway", "")
    if waterway in ("river", "stream"):
        return "river"
    # OSM beaches tagged as urban resort areas
    if tags.get("tourism") in ("resort",) or tags.get("access") == "yes":
        return "urban"
    return "natural"


def elements_to_records(elements: list) -> list:
    """
    Parse Overpass elements into beach record dicts ready for DB upsert.
    Nodes have lat/lon directly; ways and relations expose a 'center' field
    when queried with 'out center tags'.
    """
    records = []
    for el in elements:
        el_type = el.get("type")
        tags = el.get("tags", {})

        osm_id = f"{el_type[0]}{el['id']}"   # e.g. "w123456" / "n789"

        if el_type == "node":
            lat = el.get("lat")
            lng = el.get("lon")
        elif el_type in ("way", "relation"):
            center = el.get("center", {})
            lat = center.get("lat")
            lng = center.get("lon")
        else:
            continue

        if lat is None or lng is None:
            continue

        nombre = (
            tags.get("name")
            or tags.get("name:es")
            or tags.get("name:ca")
            or tags.get("name:eu")
        )

        # OSM addr tags for location context
        municipio = (
            tags.get("addr:municipality")
            or tags.get("addr:city")
            or tags.get("is_in:municipality")
        )
        provincia = tags.get("addr:province") or tags.get("is_in:province")

        records.append({
            "osm_id":     osm_id,
            "nombre":     nombre,
            "lat":        float(lat),
            "lng":        float(lng),
            "beach_type": classify_beach_type(tags),
            "municipio":  municipio,
            "provincia":  provincia,
            # length_m: would require polygon geometry (out geom); left NULL for now
        })

    return records


# ── Blue Flag matching ───────────────────────────────────────────────────────

def normalize(s: str) -> str:
    """Lowercase, strip diacritics, collapse whitespace. Used for fuzzy matching."""
    if not s:
        return ""
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return " ".join(s.lower().split())


def load_blue_flag_pdf(pdf_path: str) -> set[str]:
    """
    Extract Blue Flag beach names from the Bandera Azul annual PDF.

    Source: https://banderaazul.org (e.g. RELACIÓN DE PLAYAS GALARDONADAS 2025.pdf)

    The PDF uses a 3-column layout per page. Crucially, font distinguishes:
      - Lato-Bold   → section/province headers and municipio names  (skip)
      - Lato-Regular → beach names                                  (keep)

    We group consecutive Lato-Regular words that sit on the same line
    (within 3pt Y-tolerance) and close together (gap < 25pt X) into
    individual beach name phrases, then normalise each phrase.

    Returns a set of normalised beach name strings.
    """
    try:
        import pdfplumber
    except ImportError:
        raise RuntimeError(
            "pdfplumber is required to parse the Blue Flag PDF.\n"
            "Install it with:  pip3 install pdfplumber"
        )

    BEACH_FONT   = "Lato-Regular"   # suffix matched, handles ABCDEE+Lato-Regular etc.
    Y_TOLERANCE  = 3.0              # points — words within this Y-range are on same line
    X_GAP_MAX    = 25.0             # points — wider gap = different beach name on same row
    FOOTER_STRIP = 60               # points from page bottom to exclude (address/phone footer)

    beach_names: set[str] = set()

    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            words = page.extract_words(extra_attrs=["fontname", "size"])

            # Keep only regular-font words (= beach names), excluding footer strip
            page_height = page.height
            beach_words = [
                w for w in words
                if BEACH_FONT in w.get("fontname", "")
                and w.get("top", 0) < page_height - FOOTER_STRIP
            ]

            if not beach_words:
                continue

            # Group into name-phrases: same line (Y) and no large horizontal gap
            # Sort by top (Y), then x0 (X) to process left-to-right, top-to-bottom
            beach_words.sort(key=lambda w: (w["top"], w["x0"]))

            phrases: list[list[str]] = []
            current: list[str] = []
            prev_top = None
            prev_x1 = None

            for w in beach_words:
                top = w["top"]
                x0  = w["x0"]
                x1  = w["x1"]
                text = w["text"].strip()
                if not text or text in ("-", "–", "·"):
                    # Hyphen/dash continuation — attach to current phrase if any
                    if current:
                        current.append(text)
                    prev_top = top
                    prev_x1 = x1
                    continue

                new_line = (prev_top is None) or (abs(top - prev_top) > Y_TOLERANCE)
                big_gap  = (prev_x1 is not None) and (x0 - prev_x1 > X_GAP_MAX)

                if new_line or big_gap:
                    # Flush current phrase
                    if current:
                        phrases.append(current)
                    current = [text]
                else:
                    current.append(text)

                prev_top = top
                prev_x1  = x1

            if current:
                phrases.append(current)

            # Join each phrase into a single normalised string
            for phrase in phrases:
                joined = " ".join(phrase)
                # Strip trailing hyphens from split words (PDF line-break artefacts)
                joined = joined.rstrip("- –")
                name = normalize(joined)
                if name and len(name) > 2:
                    beach_names.add(name)

    return beach_names


# Common Spanish prefixes in OSM beach names that don't appear in the PDF short names.
# Stripping these before matching prevents "playa de burriana" from missing "burriana".
_PREFIX_RE = None

def _strip_beach_prefix(name: str) -> str:
    """Remove leading 'playa (de|del|de la|de los)', 'cala (de|del)' etc."""
    import re
    global _PREFIX_RE
    if _PREFIX_RE is None:
        _PREFIX_RE = re.compile(
            r"^(playa\s+(de\s+la\s+|de\s+los\s+|de\s+las\s+|del\s+|de\s+)?|"
            r"cala\s+(de\s+la\s+|de\s+los\s+|del\s+|de\s+)?|"
            r"playa\s+|playa-|cala-)"
        )
    return _PREFIX_RE.sub("", name).strip()


def is_blue_flag_match(norm_osm_name: str, bf_set: set[str]) -> bool:
    """
    Check if a normalised OSM beach name appears in the Blue Flag set.

    Matching cascade:
      1. Exact normalised match ("aguamarga" == "aguamarga")
      2. After stripping common Spanish prefixes ("playa de burriana" → "burriana")
      3. Substring: a PDF entry is fully contained in the OSM name (≥5 chars)
         Handles OSM "playa el bajondillo" matching PDF "el bajondillo"
      4. Substring: OSM name is fully contained in a PDF entry (≥5 chars)
         Handles OSM "burriana" matching PDF "burriana costa" (uncommon)
    """
    if not norm_osm_name:
        return False
    # 1. Exact
    if norm_osm_name in bf_set:
        return True
    # 2. Prefix-stripped exact
    stripped = _strip_beach_prefix(norm_osm_name)
    if stripped and stripped != norm_osm_name and stripped in bf_set:
        return True
    # 3-4. Substring checks (min 5 chars to avoid false positives on short words).
    # Run against both the original and prefix-stripped form.
    # This handles cases like:
    #   OSM "playa el bajondillo" vs PDF "el bajondillo ancha" (two merged beaches)
    #   → stripped "el bajondillo" is contained in PDF "el bajondillo ancha" ✓
    candidates = {norm_osm_name}
    if stripped:
        candidates.add(stripped)
    for bf in bf_set:
        if len(bf) >= 5:
            for cand in candidates:
                if bf in cand or cand in bf:
                    return True
    return False


def apply_blue_flag(records: list, pdf_path: str) -> list:
    """
    Annotate beach records with Blue Flag status using the Bandera Azul PDF.

    Uses font-based extraction (Lato-Regular = beach name) to build a name set,
    then matches each OSM beach via a normalise + substring cascade.
    Year is set to the year in the PDF filename if detectable (e.g. '2025'),
    otherwise defaults to None (the DB will show it as unset).
    """
    import re
    print(f"  Parsing PDF: {pdf_path}")
    bf_set = load_blue_flag_pdf(pdf_path)
    print(f"  Extracted {len(bf_set)} normalised beach name phrases from PDF")

    # Try to extract the certification year from the filename (e.g. "...2025.pdf")
    year_match = re.search(r"(20\d{2})", pdf_path)
    bf_year = int(year_match.group(1)) if year_match else None

    matched = 0
    for rec in records:
        norm_name = normalize(rec.get("nombre") or "")
        if is_blue_flag_match(norm_name, bf_set):
            rec["is_blue_flag"]   = True
            rec["blue_flag_year"] = bf_year
            matched += 1
        else:
            rec["is_blue_flag"]   = False
            rec["blue_flag_year"] = None

    print(f"  Blue Flag matched: {matched}/{len(records)} beaches")
    return records


# ── DB helpers ───────────────────────────────────────────────────────────────

def refresh_enrichment_view(conn) -> None:
    """
    Refresh the zone_enrichment_scores materialized view.
    Uses CONCURRENTLY so existing data remains readable during the refresh.
    Requires the unique index on (codigo_postal) to exist (created in migration 013).
    """
    print("→ Refreshing zone_enrichment_scores...", end=" ", flush=True)
    try:
        with conn.cursor() as cur:
            cur.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY zone_enrichment_scores")
        conn.commit()
        print("done")
    except Exception as e:
        conn.rollback()
        print(f"WARNING: refresh failed ({e}). The view will be refreshed by nightly pg_cron.")


# ── DB write ─────────────────────────────────────────────────────────────────

UPSERT_SQL = """
INSERT INTO beaches (
    osm_id, nombre, lat, lng, geom,
    beach_type, municipio, provincia,
    is_blue_flag, blue_flag_year,
    source, updated_at
)
VALUES (
    %(osm_id)s,
    %(nombre)s,
    %(lat)s,
    %(lng)s,
    ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::GEOGRAPHY,
    %(beach_type)s,
    %(municipio)s,
    %(provincia)s,
    %(is_blue_flag)s,
    %(blue_flag_year)s,
    'osm',
    NOW()
)
ON CONFLICT (osm_id) DO UPDATE SET
    nombre         = EXCLUDED.nombre,
    lat            = EXCLUDED.lat,
    lng            = EXCLUDED.lng,
    geom           = EXCLUDED.geom,
    beach_type     = EXCLUDED.beach_type,
    municipio      = EXCLUDED.municipio,
    provincia      = EXCLUDED.provincia,
    is_blue_flag   = EXCLUDED.is_blue_flag,
    blue_flag_year = EXCLUDED.blue_flag_year,
    updated_at     = NOW()
"""


def write_records(conn, records: list, dry_run: bool) -> None:
    if dry_run:
        print(f"  [dry-run] Would upsert {len(records)} beach rows")
        return

    conn = execute_batch(conn, UPSERT_SQL, records)
    print(f"  Upserted {len(records)} rows into beaches")


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Ingest Spanish beaches from OSM → Qolify beaches table"
    )
    location = parser.add_mutually_exclusive_group()
    location.add_argument(
        "--bbox",
        help="Bounding box: south,west,north,east  e.g. 36.35,-5.20,36.95,-3.90",
    )
    location.add_argument(
        "--provincia",
        choices=list(PROVINCE_BBOXES),
        help="Use a named province bounding box",
    )
    parser.add_argument(
        "--blue-flag",
        metavar="PATH",
        help="Path to Bandera Azul PDF (download from https://banderaazul.org)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch from Overpass and count records but do not write to DB",
    )
    args = parser.parse_args()

    # Determine query
    if args.provincia:
        bbox = PROVINCE_BBOXES[args.provincia]
        print(f"Using bbox for {args.provincia}: {bbox}")
        query = build_bbox_query(bbox)
    elif args.bbox:
        bbox = args.bbox
        print(f"Using custom bbox: {bbox}")
        query = build_bbox_query(bbox)
    else:
        print("Using full Spain area filter (this may take 2–3 minutes)...")
        query = build_spain_query()

    # Fetch from Overpass
    print("→ Querying Overpass for natural=beach features...", end=" ", flush=True)
    try:
        elements = fetch_overpass(query)
    except Exception as e:
        print(f"\nFATAL: Overpass query failed: {e}", file=sys.stderr)
        sys.exit(1)
    print(f"{len(elements)} elements returned")

    # Parse
    records = elements_to_records(elements)
    print(f"  Parsed {len(records)} valid beach records")

    if not records:
        print("No records to write. Exiting.")
        sys.exit(0)

    # Blue Flag matching (optional)
    if args.blue_flag:
        print(f"→ Matching Blue Flag status from {args.blue_flag}...")
        records = apply_blue_flag(records, args.blue_flag)
    else:
        # Default: no Blue Flag data (is_blue_flag stays FALSE, year NULL)
        for rec in records:
            rec.setdefault("is_blue_flag", False)
            rec.setdefault("blue_flag_year", None)
        print(
            "  No --blue-flag provided. is_blue_flag will be FALSE for all rows.\n"
            "  To set Blue Flag status, re-run with:  --blue-flag <path-to-pdf>"
        )

    # Summary by beach_type
    from collections import Counter
    type_counts = Counter(r["beach_type"] for r in records)
    print(f"  Beach types: {dict(type_counts)}")

    # Write to DB
    if not args.dry_run:
        conn = get_conn()
    else:
        conn = None

    print("→ Writing to DB...")
    if args.dry_run:
        write_records(None, records, dry_run=True)
    else:
        write_records(conn, records, dry_run=False)
        refresh_enrichment_view(conn)
        conn.close()

    print(f"\n✓ Done. {len(records)} beaches processed.")
    if len(records) < 3000:
        print(
            f"  Warning: {len(records)} beaches is below the expected >3,000 national total.\n"
            "  If running with --bbox or --provincia, this is expected.\n"
            "  For a national seed, run without --bbox/--provincia."
        )


if __name__ == "__main__":
    main()
