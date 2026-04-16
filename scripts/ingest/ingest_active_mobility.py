from __future__ import annotations
#!/usr/bin/env python3
"""
Ingest pedestrian zones, cycling infrastructure, and parking from OSM.
Optionally updates park area_sqm for green space scoring.

Populates:
  - pedestrian_cycling_zones  (pedestrian streets, cycle lanes/tracks)
  - amenities                 (parking_free, parking_paid; park area_sqm)

All writes are idempotent via UPSERT ON CONFLICT (osm_id).

Usage:
  python ingest_active_mobility.py                      # all features, full Spain
  python ingest_active_mobility.py --feature pedestrian # pedestrian only
  python ingest_active_mobility.py --feature cycling    # cycling only
  python ingest_active_mobility.py --feature parking    # parking only
  python ingest_active_mobility.py --feature parks      # park area enrichment only
  python ingest_active_mobility.py --feature all        # all features (default)

  python ingest_active_mobility.py --bbox 36.35,-5.20,36.95,-3.90  # Málaga bbox
  python ingest_active_mobility.py --provincia malaga
  python ingest_active_mobility.py --dry-run            # fetch + count, no DB writes

Each feature can also be run with --bbox/--provincia for regional testing.
"""
import argparse
import sys
import time
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
}

SPAIN_BBOX = "27.6,-18.2,43.8,4.4"


# ── Overpass query builders ──────────────────────────────────────────────────

def _area_filter() -> str:
    """Overpass area filter for Spain. Used in full-Spain queries."""
    return 'area["name"="España"]["boundary"="administrative"]->.searchArea;'


def build_pedestrian_query(bbox: str | None) -> str:
    """
    Pedestrian streets and zones.
    Uses 'out geom' to get full way geometry for PostGIS LineString storage.
    """
    if bbox:
        spatial = f"({bbox})"
    else:
        spatial = "(area.searchArea)"

    area_decl = "" if bbox else f"{_area_filter()}\n"

    return f"""
[out:json][timeout:180];
{area_decl}(
  way["highway"="pedestrian"]{spatial};
  way["highway"="living_street"]{spatial};
);
out geom;
"""


def build_cycling_query(bbox: str | None) -> str:
    """
    Dedicated cycleways and roads with marked cycle lanes.
    Uses 'out geom' to get full way geometry.
    """
    if bbox:
        spatial = f"({bbox})"
    else:
        spatial = "(area.searchArea)"

    area_decl = "" if bbox else f"{_area_filter()}\n"

    return f"""
[out:json][timeout:180];
{area_decl}(
  way["highway"="cycleway"]{spatial};
  way["cycleway"="lane"]{spatial};
  way["cycleway"="track"]{spatial};
  way["cycleway"="shared_lane"]{spatial};
  way["cycleway:right"="lane"]{spatial};
  way["cycleway:left"="lane"]{spatial};
  way["cycleway:both"="lane"]{spatial};
);
out geom;
"""


def build_parking_query(bbox: str | None) -> str:
    """
    Parking areas (nodes and ways). Fee tag used to classify free vs paid.
    Uses 'out center tags' — we only need the centroid and fee attribute.
    """
    if bbox:
        spatial = f"({bbox})"
    else:
        spatial = "(area.searchArea)"

    area_decl = "" if bbox else f"{_area_filter()}\n"

    return f"""
[out:json][timeout:120];
{area_decl}(
  node["amenity"="parking"]{spatial};
  way["amenity"="parking"]{spatial};
);
out center tags;
"""


def build_parks_query(bbox: str | None) -> str:
    """
    Parks and gardens as polygon ways (for area_sqm calculation).
    Uses 'out geom' so we get the polygon boundary coordinates.
    """
    if bbox:
        spatial = f"({bbox})"
    else:
        spatial = "(area.searchArea)"

    area_decl = "" if bbox else f"{_area_filter()}\n"

    return f"""
[out:json][timeout:180];
{area_decl}(
  way["leisure"="park"]{spatial};
  way["leisure"="garden"]{spatial};
);
out geom tags;
"""


# ── Overpass fetch ───────────────────────────────────────────────────────────

def fetch_overpass(query: str, retries: int = 3) -> list:
    for attempt in range(retries):
        try:
            resp = requests.post(
                OVERPASS_URL,
                data={"data": query},
                timeout=300,
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


# ── Geometry helpers ─────────────────────────────────────────────────────────

def way_geometry_to_linestring(geometry: list) -> str | None:
    """
    Convert an Overpass way geometry (list of {lat, lon} dicts) to WKT LINESTRING.

    PostGIS uses (longitude latitude) coordinate order.
    Returns None if geometry has fewer than 2 points.
    """
    if not geometry or len(geometry) < 2:
        return None
    coords = ", ".join(f"{pt['lon']} {pt['lat']}" for pt in geometry)
    return f"LINESTRING({coords})"


def way_geometry_to_polygon(geometry: list) -> str | None:
    """
    Convert a closed way geometry to WKT POLYGON for area calculation.

    Overpass returns polygon ways as open rings (first ≠ last node).
    We close them explicitly before building the WKT.
    Returns None if fewer than 3 points.
    """
    if not geometry or len(geometry) < 3:
        return None
    pts = list(geometry)
    # Close the ring if not already closed
    if pts[0] != pts[-1]:
        pts.append(pts[0])
    coords = ", ".join(f"{pt['lon']} {pt['lat']}" for pt in pts)
    return f"POLYGON(({coords}))"


def way_center(geometry: list) -> tuple[float, float] | tuple[None, None]:
    """Compute centroid of a way as the average of its node coordinates."""
    if not geometry:
        return None, None
    lats = [pt["lat"] for pt in geometry]
    lons = [pt["lon"] for pt in geometry]
    return sum(lats) / len(lats), sum(lons) / len(lons)


# ── Zone-type classification ─────────────────────────────────────────────────

def classify_pedestrian_zone_type(tags: dict) -> str:
    """
    Map OSM highway tags to pedestrian_cycling_zones.zone_type values.
    pedestrian_zone = full plaza/zona peatonal (area=yes)
    pedestrian_street = linear pedestrian street or living street
    """
    highway = tags.get("highway", "")
    if highway == "pedestrian" and tags.get("area") == "yes":
        return "pedestrian_zone"
    # living_street is also classified as pedestrian_street (shared space, very low traffic)
    return "pedestrian_street"


def classify_cycling_zone_type(tags: dict) -> str:
    """
    Map OSM cycling tags to pedestrian_cycling_zones.zone_type values.

    Hierarchy:
      highway=cycleway + segregated=yes  → cycle_track (physical separation)
      highway=cycleway                   → cycle_path (off-road or protected)
      cycleway=track / cycleway:*=track  → cycle_track
      cycleway=lane / cycleway:*=lane    → cycle_lane (painted lane on road)
      cycleway=shared_lane               → shared_path
    """
    highway = tags.get("highway", "")
    cycleway = tags.get("cycleway", "")

    # Explicit cycleway tags on other road types
    if cycleway == "track":
        return "cycle_track"
    if cycleway in ("lane", ""):
        # Check directional cycleway tags
        for key in ("cycleway:right", "cycleway:left", "cycleway:both"):
            val = tags.get(key, "")
            if val == "track":
                return "cycle_track"
            if val == "lane":
                return "cycle_lane"

    if cycleway == "shared_lane":
        return "shared_path"
    if cycleway == "lane":
        return "cycle_lane"

    # Dedicated cycleway
    if highway == "cycleway":
        if tags.get("segregated") == "yes":
            return "cycle_track"
        # foot=designated → shared use path
        if tags.get("foot") == "designated":
            return "shared_path"
        return "cycle_path"

    # Default for any cycleway tag we haven't explicitly handled
    return "cycle_lane"


# ── Record builders ──────────────────────────────────────────────────────────

def build_mobility_records(elements: list, feature: str) -> list:
    """
    Parse Overpass way elements into pedestrian_cycling_zones records.
    Skips elements with no usable geometry.
    """
    records = []
    skipped = 0

    for el in elements:
        if el.get("type") != "way":
            continue

        tags = el.get("tags", {})
        geometry = el.get("geometry", [])
        osm_id = f"w{el['id']}"

        geom_wkt = way_geometry_to_linestring(geometry)
        if geom_wkt is None:
            skipped += 1
            continue

        if feature == "pedestrian":
            zone_type = classify_pedestrian_zone_type(tags)
        else:
            zone_type = classify_cycling_zone_type(tags)

        municipio = (
            tags.get("addr:municipality")
            or tags.get("addr:city")
            or tags.get("is_in:municipality")
        )

        records.append({
            "osm_id":    osm_id,
            "geom_wkt":  geom_wkt,
            "zone_type": zone_type,
            "surface":   tags.get("surface"),
            "municipio": municipio,
        })

    if skipped:
        print(f"  Skipped {skipped} elements with no usable geometry")

    return records


def build_parking_records(elements: list) -> list:
    """
    Parse Overpass parking elements into amenities records.
    fee=no → category='parking_free', fee=yes → 'parking_paid'.
    Elements with no fee tag default to 'parking_free' (conservative assumption
    since free parking is the more useful signal for the Daily Life Score).
    """
    records = []
    for el in elements:
        el_type = el.get("type")
        tags = el.get("tags", {})
        osm_id = f"{el_type[0]}{el['id']}"

        if el_type == "node":
            lat = el.get("lat")
            lng = el.get("lon")
        elif el_type == "way":
            center = el.get("center", {})
            lat = center.get("lat")
            lng = center.get("lon")
        else:
            continue

        if lat is None or lng is None:
            continue

        fee_tag = tags.get("fee", "").lower()
        if fee_tag in ("yes", "paid"):
            category = "parking_paid"
            fee_val = "paid"
        else:
            # fee=no, fee=free, or absent → treat as free
            category = "parking_free"
            fee_val = "free" if fee_tag in ("no", "free") else "unknown"

        nombre = tags.get("name") or tags.get("operator")
        municipio = (
            tags.get("addr:municipality")
            or tags.get("addr:city")
            or tags.get("is_in:municipality")
        )

        records.append({
            "osm_id":   osm_id,
            "nombre":   nombre,
            "category": category,
            "fee":      fee_val,
            "lat":      float(lat),
            "lng":      float(lng),
            "municipio": municipio,
        })

    return records


def build_park_records(elements: list) -> list:
    """
    Parse Overpass park/garden polygon ways into amenity records with area WKT.
    The polygon_wkt is passed to PostGIS ST_Area() for area_sqm computation.
    Only processes closed polygon ways (area=yes implied by leisure=park).
    """
    records = []
    skipped = 0

    for el in elements:
        if el.get("type") != "way":
            continue

        tags = el.get("tags", {})
        geometry = el.get("geometry", [])
        osm_id = f"w{el['id']}"

        polygon_wkt = way_geometry_to_polygon(geometry)
        if polygon_wkt is None:
            skipped += 1
            continue

        # Centroid for the amenities point geometry
        lat, lng = way_center(geometry)
        if lat is None:
            skipped += 1
            continue

        nombre = tags.get("name") or tags.get("name:es")
        municipio = (
            tags.get("addr:municipality")
            or tags.get("addr:city")
            or tags.get("is_in:municipality")
        )

        records.append({
            "osm_id":      osm_id,
            "nombre":      nombre,
            "lat":         lat,
            "lng":         lng,
            "polygon_wkt": polygon_wkt,
            "municipio":   municipio,
        })

    if skipped:
        print(f"  Skipped {skipped} park elements with insufficient geometry")

    return records


# ── SQL statements ───────────────────────────────────────────────────────────

# pedestrian_cycling_zones — UPSERT by osm_id
# ST_Multi() converts LINESTRING → MULTILINESTRING to match column type GEOGRAPHY(MULTILINESTRING)
UPSERT_MOBILITY_SQL = """
INSERT INTO pedestrian_cycling_zones (
    osm_id, geom, zone_type, surface, municipio, source, updated_at
)
VALUES (
    %(osm_id)s,
    ST_Multi(ST_GeomFromText(%(geom_wkt)s, 4326))::GEOGRAPHY,
    %(zone_type)s,
    %(surface)s,
    %(municipio)s,
    'osm',
    NOW()
)
ON CONFLICT (osm_id) DO UPDATE SET
    geom       = EXCLUDED.geom,
    zone_type  = EXCLUDED.zone_type,
    surface    = EXCLUDED.surface,
    updated_at = NOW()
"""

# Parking — UPSERT into amenities by osm_id
UPSERT_PARKING_SQL = """
INSERT INTO amenities (
    osm_id, nombre, category, display_category,
    lat, lng, geom,
    fee, municipio, source, updated_at
)
VALUES (
    %(osm_id)s,
    %(nombre)s,
    %(category)s,
    'parking',
    %(lat)s,
    %(lng)s,
    ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::GEOGRAPHY,
    %(fee)s,
    %(municipio)s,
    'osm',
    NOW()
)
ON CONFLICT (osm_id) DO UPDATE SET
    category   = EXCLUDED.category,
    fee        = EXCLUDED.fee,
    lat        = EXCLUDED.lat,
    lng        = EXCLUDED.lng,
    geom       = EXCLUDED.geom,
    updated_at = NOW()
"""

# Parks — UPSERT into amenities with area_sqm computed by PostGIS.
# ST_Area on a GEOGRAPHY gives area in square metres.
UPSERT_PARK_SQL = """
INSERT INTO amenities (
    osm_id, nombre, category, display_category,
    lat, lng, geom,
    area_sqm, municipio, source, updated_at
)
VALUES (
    %(osm_id)s,
    %(nombre)s,
    'park',
    'park',
    %(lat)s,
    %(lng)s,
    ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::GEOGRAPHY,
    ST_Area(ST_GeomFromText(%(polygon_wkt)s, 4326)::GEOGRAPHY)::INTEGER,
    %(municipio)s,
    'osm',
    NOW()
)
ON CONFLICT (osm_id) DO UPDATE SET
    area_sqm   = EXCLUDED.area_sqm,
    nombre     = EXCLUDED.nombre,
    updated_at = NOW()
"""

# Backfill area_sqm for parks already in amenities that have no osm_id yet.
# Matches by spatial proximity (within 50m of centroid) to link old rows.
BACKFILL_PARK_AREA_SQL = """
WITH target AS (
    SELECT id FROM amenities
    WHERE category = 'park'
      AND osm_id IS NULL
      AND area_sqm IS NULL
      AND ST_DWithin(
            geom,
            ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::GEOGRAPHY,
            50
          )
    LIMIT 1
)
UPDATE amenities SET
    area_sqm = ST_Area(ST_GeomFromText(%(polygon_wkt)s, 4326)::GEOGRAPHY)::INTEGER,
    osm_id   = %(osm_id)s
FROM target
WHERE amenities.id = target.id
"""


# ── DB helpers ───────────────────────────────────────────────────────────────

def refresh_enrichment_view(conn) -> None:
    """
    Refresh the zone_enrichment_scores materialized view.
    CONCURRENTLY keeps the view readable during refresh.
    """
    print("→ Refreshing zone_enrichment_scores...", end=" ", flush=True)
    try:
        with conn.cursor() as cur:
            cur.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY zone_enrichment_scores")
        conn.commit()
        print("done")
    except Exception as e:
        conn.rollback()
        print(f"WARNING: refresh failed ({e}). Nightly pg_cron will refresh it.")


# ── Feature runners ──────────────────────────────────────────────────────────

def run_pedestrian(bbox: str | None, dry_run: bool, conn) -> int:
    print("\n→ [pedestrian] Querying Overpass...", end=" ", flush=True)
    elements = fetch_overpass(build_pedestrian_query(bbox))
    print(f"{len(elements)} elements")

    records = build_mobility_records(elements, "pedestrian")
    print(f"  Parsed {len(records)} pedestrian way records")
    if not records:
        return 0

    zone_types = {}
    for r in records:
        zone_types[r["zone_type"]] = zone_types.get(r["zone_type"], 0) + 1
    print(f"  Zone types: {zone_types}")

    if dry_run:
        print(f"  [dry-run] Would upsert {len(records)} rows into pedestrian_cycling_zones")
    else:
        execute_batch(conn, UPSERT_MOBILITY_SQL, records)
        print(f"  Upserted {len(records)} rows into pedestrian_cycling_zones")

    return len(records)


def run_cycling(bbox: str | None, dry_run: bool, conn) -> int:
    print("\n→ [cycling] Querying Overpass...", end=" ", flush=True)
    elements = fetch_overpass(build_cycling_query(bbox))
    print(f"{len(elements)} elements")

    records = build_mobility_records(elements, "cycling")
    print(f"  Parsed {len(records)} cycling way records")
    if not records:
        return 0

    zone_types = {}
    for r in records:
        zone_types[r["zone_type"]] = zone_types.get(r["zone_type"], 0) + 1
    print(f"  Zone types: {zone_types}")

    if dry_run:
        print(f"  [dry-run] Would upsert {len(records)} rows into pedestrian_cycling_zones")
    else:
        execute_batch(conn, UPSERT_MOBILITY_SQL, records)
        print(f"  Upserted {len(records)} rows into pedestrian_cycling_zones")

    return len(records)


def run_parking(bbox: str | None, dry_run: bool, conn) -> int:
    print("\n→ [parking] Querying Overpass...", end=" ", flush=True)
    elements = fetch_overpass(build_parking_query(bbox))
    print(f"{len(elements)} elements")

    records = build_parking_records(elements)
    print(f"  Parsed {len(records)} parking records")
    if not records:
        return 0

    free = sum(1 for r in records if r["category"] == "parking_free")
    paid = len(records) - free
    print(f"  Free: {free}, Paid: {paid}")

    if dry_run:
        print(f"  [dry-run] Would upsert {len(records)} rows into amenities")
    else:
        execute_batch(conn, UPSERT_PARKING_SQL, records)
        print(f"  Upserted {len(records)} rows into amenities (parking)")

    return len(records)


def run_parks(bbox: str | None, dry_run: bool, conn) -> int:
    print("\n→ [parks] Querying Overpass for park/garden polygons...", end=" ", flush=True)
    elements = fetch_overpass(build_parks_query(bbox))
    print(f"{len(elements)} elements")

    records = build_park_records(elements)
    print(f"  Parsed {len(records)} park polygon records")
    if not records:
        return 0

    if dry_run:
        print(f"  [dry-run] Would upsert {len(records)} park rows with area_sqm into amenities")
        return len(records)

    # Step 1: UPSERT parks with area_sqm (new parks or parks with osm_id already set)
    execute_batch(conn, UPSERT_PARK_SQL, records)
    print(f"  Upserted {len(records)} rows into amenities (parks with area_sqm)")

    # Step 2: Backfill area_sqm for parks already in amenities without osm_id
    # This catches parks ingested by ingest_amenities.py before osm_id column was added.
    backfill_count = 0
    try:
        with conn.cursor() as cur:
            for rec in records:
                cur.execute(BACKFILL_PARK_AREA_SQL, rec)
                backfill_count += cur.rowcount
        conn.commit()
        if backfill_count:
            print(f"  Backfilled area_sqm on {backfill_count} existing park rows (proximity match)")
    except Exception as e:
        conn.rollback()
        print(f"  Warning: backfill step failed ({e}) — new parks are still written correctly")

    return len(records)


# ── Main ─────────────────────────────────────────────────────────────────────

FEATURES = ("pedestrian", "cycling", "parking", "parks", "all")


def main():
    parser = argparse.ArgumentParser(
        description="Ingest pedestrian zones, cycling infrastructure, and parking from OSM"
    )
    parser.add_argument(
        "--feature",
        choices=FEATURES,
        default="all",
        help="Which feature to ingest (default: all)",
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
        "--dry-run",
        action="store_true",
        help="Fetch from Overpass and count records but do not write to DB",
    )
    args = parser.parse_args()

    # Resolve bounding box
    if args.provincia:
        bbox = PROVINCE_BBOXES[args.provincia]
        print(f"Using bbox for {args.provincia}: {bbox}")
    elif args.bbox:
        bbox = args.bbox
        print(f"Using custom bbox: {bbox}")
    else:
        bbox = None
        print("Using full Spain area filter (this may take several minutes per feature)...")

    conn = get_conn() if not args.dry_run else None

    totals: dict[str, int] = {}

    features_to_run = (
        ["pedestrian", "cycling", "parking", "parks"]
        if args.feature == "all"
        else [args.feature]
    )

    for feat in features_to_run:
        try:
            if feat == "pedestrian":
                totals[feat] = run_pedestrian(bbox, args.dry_run, conn)
            elif feat == "cycling":
                totals[feat] = run_cycling(bbox, args.dry_run, conn)
            elif feat == "parking":
                totals[feat] = run_parking(bbox, args.dry_run, conn)
            elif feat == "parks":
                totals[feat] = run_parks(bbox, args.dry_run, conn)
            time.sleep(2)  # polite pause between Overpass requests
        except Exception as e:
            print(f"\nERROR during '{feat}': {e}", file=sys.stderr)
            print("Continuing with next feature...", file=sys.stderr)

    if conn:
        refresh_enrichment_view(conn)
        conn.close()

    print("\n─── Summary ───────────────────────────────────────────────")
    for feat, count in totals.items():
        print(f"  {feat:20s} {count:>7,} records processed")
    total = sum(totals.values())
    print(f"  {'TOTAL':20s} {total:>7,}")

    # DoD validation hints
    mobility_total = totals.get("pedestrian", 0) + totals.get("cycling", 0)
    if args.feature in ("all", "pedestrian", "cycling") and not args.dry_run:
        if mobility_total < 50_000 and bbox is None:
            print(
                f"\n  Warning: {mobility_total:,} pedestrian/cycle features is below the "
                "expected >50,000 national total.\n"
                "  If this was a --bbox run, this is expected."
            )
        elif mobility_total >= 50_000:
            print(f"\n  ✓ Pedestrian + cycling features ({mobility_total:,}) meet the >50,000 DoD threshold.")

    print("\n✓ Done.")


if __name__ == "__main__":
    main()
