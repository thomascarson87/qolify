from __future__ import annotations
#!/usr/bin/env python3
"""
Ingest OpenStreetMap amenities into the `amenities` table via the Overpass API.

Usage:
  python ingest_amenities.py                          # all Spain (slow, ~4M nodes)
  python ingest_amenities.py --bbox 36.4,−5.1,36.8,−4.3   # Málaga bbox
  python ingest_amenities.py --provincia malaga       # Málaga provincia

Bounding boxes (south,west,north,east):
  Málaga:   36.4,-5.1,36.8,-4.3
  Madrid:   40.2,-3.9,40.6,-3.5
  Barcelona: 41.3,2.0,41.5,2.3
  All Spain: 27.6,-18.2,43.8,4.4
"""
import argparse
import sys
import time
import requests
from tqdm import tqdm
from _db import get_conn, execute_batch

OVERPASS_URL = "https://overpass.kumi.systems/api/interpreter"

# OSM tag → Qolify category
QUERY_GROUPS = {
    "cafe":         '[amenity=cafe]',
    "restaurant":   '[amenity=restaurant]',
    "bar":          '[amenity=bar]',
    "pharmacy":     '[amenity=pharmacy]',
    "gym":          '[leisure=fitness_centre]',
    "park":         '[leisure=park]',
    "garden":       '[leisure=garden]',
    "supermarket":  '[shop=supermarket]',
    "bank":         '[amenity=bank]',
    "clinic":       '[amenity=doctors]',
    "kindergarten": '[amenity=kindergarten]',
    "library":      '[amenity=library]',
    "beach":        '[natural=beach]',
    "swimming":     '[leisure=swimming_pool]',
    "theatre":      '[amenity=theatre]',
    "cinema":       '[amenity=cinema]',
}

# Maps the category keys above → display_category stored in DB.
# Mirrors the mapping in lib/amenity-categories.ts (CHI-350).
# Multiple OSM categories can share the same display_category
# (e.g. 'park' and 'garden' both → 'park').
# Any category not listed here defaults to 'other' and is excluded
# from the proximity summary display.
DISPLAY_CATEGORY_MAP: dict[str, str] = {
    # Daily necessities
    "supermarket":   "supermarket",
    "convenience":   "supermarket",
    "grocery":       "supermarket",
    "bakery":        "bakery",
    "pastry":        "bakery",
    "bank":          "bank",
    "atm":           "bank",
    "pharmacy":      "pharmacy",
    # Lifestyle
    "cafe":          "cafe",
    "coffee_shop":   "cafe",
    "restaurant":    "restaurant",
    "fast_food":     "restaurant",
    "bar":           "bar",
    "pub":           "bar",
    "gym":           "gym",
    "sports_centre": "gym",
    "swimming":      "gym",
    "park":          "park",
    "garden":        "park",
    "coworking":     "coworking",
    # Other — stored but not shown in proximity summary
    "clinic":        "other",
    "kindergarten":  "other",
    "library":       "other",
    "beach":         "other",
    "theatre":       "other",
    "cinema":        "other",
}

PROVINCE_BBOXES = {
    "malaga":    "36.35,-5.20,36.95,-3.90",
    "madrid":    "40.10,-4.00,40.70,-3.40",
    "barcelona": "41.25,1.90,41.60,2.40",
    "sevilla":   "36.95,-6.00,37.65,-5.50",
    "valencia":  "39.25,-0.60,39.70,-0.25",
    "alicante":  "37.90,-1.00,38.55,-0.05",
}


def build_query(bbox: str, tag_filter: str) -> str:
    # bbox format for Overpass: south,west,north,east
    return f"""
[out:json][timeout:60];
(
  node{tag_filter}({bbox});
  way{tag_filter}({bbox});
);
out center;
"""


def fetch_overpass(query: str, retries: int = 3) -> list:
    for attempt in range(retries):
        try:
            resp = requests.post(
                OVERPASS_URL,
                data={"data": query},
                timeout=90,
            )
            resp.raise_for_status()
            return resp.json().get("elements", [])
        except requests.RequestException as e:
            if attempt < retries - 1:
                wait = 10 * (attempt + 1)
                print(f"  Overpass error ({e}), retrying in {wait}s...")
                time.sleep(wait)
            else:
                raise


def elements_to_records(elements: list, category: str) -> tuple[list, list]:
    """
    Returns (amenity_records, history_records).
    history_records use osm_id as dedup key — used as NTI baseline on first seed.
    """
    amenity_records = []
    history_records = []
    for el in elements:
        tags = el.get("tags", {})
        name = tags.get("name") or tags.get("name:es") or tags.get("brand")
        osm_id = str(el.get("id", ""))

        # Nodes have lat/lon directly; ways have a center
        if el["type"] == "node":
            lat, lng = el.get("lat"), el.get("lon")
        elif el["type"] == "way":
            center = el.get("center", {})
            lat, lng = center.get("lat"), center.get("lon")
        else:
            continue

        if lat is None or lng is None:
            continue

        municipio = tags.get("addr:city") or tags.get("addr:municipality")

        amenity_records.append({
            "nombre":           name,
            "category":         category,
            "display_category": DISPLAY_CATEGORY_MAP.get(category, "other"),
            "lat":              lat,
            "lng":              lng,
            "municipio":        municipio,
            "source":           "osm",
        })
        history_records.append({
            "osm_id":    osm_id,
            "category":  category,
            "lat":       lat,
            "lng":       lng,
            "municipio": municipio,
        })

    return amenity_records, history_records


UPSERT_SQL = """
INSERT INTO amenities (nombre, category, display_category, lat, lng, geom, municipio, source, updated_at)
VALUES (
    %(nombre)s,
    %(category)s,
    %(display_category)s,
    %(lat)s,
    %(lng)s,
    ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::GEOGRAPHY,
    %(municipio)s,
    %(source)s,
    NOW()
)
ON CONFLICT DO NOTHING
"""

# ON CONFLICT (osm_id) DO NOTHING — skip re-seeds; unique constraint in 006_helper_functions.sql
HISTORY_SQL = """
INSERT INTO amenity_history (osm_id, category, lat, lng, geom, municipio, first_seen_at, is_active)
VALUES (
    %(osm_id)s,
    %(category)s,
    %(lat)s,
    %(lng)s,
    ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::GEOGRAPHY,
    %(municipio)s,
    NOW(),
    TRUE
)
ON CONFLICT (osm_id) DO NOTHING
"""


def main():
    parser = argparse.ArgumentParser(description="Ingest OSM amenities → Qolify")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--bbox", help="south,west,north,east")
    group.add_argument("--provincia", choices=list(PROVINCE_BBOXES), help="Named bbox")
    parser.add_argument("--no-history", action="store_true",
                        help="Skip amenity_history seeding (monthly re-runs use separate diff script)")
    args = parser.parse_args()

    if args.provincia:
        bbox = PROVINCE_BBOXES[args.provincia]
        print(f"Using bbox for {args.provincia}: {bbox}")
    elif args.bbox:
        bbox = args.bbox
        print(f"Using custom bbox: {bbox}")
    else:
        bbox = "27.6,-18.2,43.8,4.4"
        print("Using full Spain bbox (this will take a long time)")

    conn = get_conn()
    total_amenities = 0
    total_history = 0

    for category, tag_filter in tqdm(QUERY_GROUPS.items(), desc="Categories"):
        print(f"\n→ Fetching {category}...", end=" ")
        query = build_query(bbox, tag_filter)

        try:
            elements = fetch_overpass(query)
        except Exception as e:
            print(f"FAILED: {e}")
            continue

        amenity_records, history_records = elements_to_records(elements, category)
        print(f"{len(amenity_records)} features")

        if amenity_records:
            conn = execute_batch(conn, UPSERT_SQL, amenity_records)
            total_amenities += len(amenity_records)

        if history_records and not args.no_history:
            conn = execute_batch(conn, HISTORY_SQL, history_records)
            total_history += len(history_records)

        time.sleep(1)  # be polite to Overpass

    conn.close()
    print(f"\n✓ Done. {total_amenities} amenities written, {total_history} history rows seeded.")
    if not args.no_history:
        print("  NTI baseline established — amenity_history populated for CHI-290.")


if __name__ == "__main__":
    main()
