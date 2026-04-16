# Qolify — Map MVP Specification
## Zone Intelligence Explorer

**Version:** 2.0 — Spatial Data Model integrated  
**Decision log reference:** D-024 through D-032  
**Replaces:** Model B (URL-paste) as the MVP entry point. Supersedes CHI-303 (original map issue).  
**Rationale:** Neighbourhood intelligence map is zero Parse.bot cost, zero legal exposure, immediately visual, and proves the data engine against real user behaviour before the property-level layer is added.

---

## 1. Product Vision

The Map MVP answers a different question than the DNA Report. The DNA Report asks: *"Should I buy this specific property?"* The Map MVP asks: *"Where should I even be looking?"*

A buyer arriving in Spain — or a Spanish buyer relocating — doesn't start with a specific property URL. They start with a city and a vague sense of priorities: good schools, safe streets, somewhere that isn't already overrun with Airbnbs. The map surfaces all of that as a spatial intelligence layer, before a single property is involved.

**The entry experience:**
User lands on `/map`. They see Málaga (or their chosen city). The map glows with zone-level scores — areas scoring high in their chosen profile glow emerald, weak zones are dimmed. They can see immediately that Pedregalejo scores better for families than El Palo, or that Soho shows Prime Buy NTI signals while Centro is already Too Late. This is the moment of value. No URL paste required.

The property layer (URL paste → DNA Report, or later, scraped pins) is then **added to** a map the user already trusts. The analysis enriches a location they've already been thinking about.

---

## 2. What Data Is Already Available (No New Ingestion)

All of the following exists in Supabase from Phase 0 ingestion work. The map draws exclusively from these tables:

| Table | Geometry type | What it powers |
|---|---|---|
| `schools` | Point | Education pins, proximity calculations |
| `school_catchments` | Polygon | Catchment boundary overlays |
| `flood_zones` | MultiPolygon | SNCZI T10/T100/T500 risk polygons |
| `vut_licences` | Point (address geocoded) | Community choropleth + individual pin layer |
| `health_centres` | Point | GP and hospital pins |
| `transport_stops` | Point | Metro/bus/train pins |
| `solar_radiation` | Point (grid) | Solar GHI heatmap |
| `infrastructure_projects` | Point | Future value pins |
| `amenities` | Point + Polygon | Park polygons, coworking/café pins |
| `climate_data` | Point (station) | Climate overlay by nearest station |
| `crime_stats` | Polygon (zona) | Safety choropleth |
| `fibre_coverage` | Polygon | Digital viability polygon overlay |
| `ine_income` | Polygon (municipio) | Affordability context |
| `property_price_history` | Point (property) | Price/m² choropleth where data exists |
| `postal_zones` | Polygon | Postcode boundaries — the choropleth container |

**Zone-level aggregation:** Most overlays operate at `codigo_postal` (postcode) or `municipio` level — data is pre-aggregated into a `zone_scores` materialised view at build time. Individual point layers (schools, transport, hospitals) are served as GeoJSON from Supabase Storage.

---

## 3. Spatial Data Model

This is the foundational section. Every data layer in the map belongs to one of six spatial primitive types. Understanding which type each layer is determines how it is stored, queried, rendered, and how it behaves when it crosses administrative boundaries. Getting this wrong causes cascading rendering and query failures.

---

### 3.1 — The Six Spatial Primitives

#### Primitive 1: Point (exact coordinate)

A single lat/lng. The simplest case. Represents a specific physical location.

**Qolify layers using this primitive:**
- Schools (entrance coordinate)
- GP surgeries and hospitals (entrance coordinate)
- Metro, bus, and train stops
- Infrastructure project sites
- Pharmacies
- Coworking spaces and amenities
- Individual VUT licensed addresses
- User-dropped property pin (user-generated)

**PostGIS storage:**
```sql
geom  GEOMETRY(Point, 4326)
-- Spatial index (mandatory on every point table)
CREATE INDEX ON schools USING GIST (geom);
```

**MapLibre layer type:** `circle` or `symbol` (icon)

**Zoom behaviour:** Cluster at zoom < 13 using MapLibre's built-in clustering. Individual pins with labels at zoom >= 13. At zoom >= 16, show full label + detail badge.

**Cross-boundary behaviour:** Points do not belong to administrative areas. A school in postcode 29017 is a point — it contributes to the zone score for 29017 via a spatial join (`ST_Within`), but the point itself is independent of postcode boundaries. At high zoom, the point is authoritative. At low zoom, it is summarised into the zone aggregate.

**Query pattern (PostGIS):**
```sql
-- All schools within 800m of a coordinate
SELECT name, type, ST_Distance(geom::geography, ST_MakePoint($lng,$lat)::geography) AS distance_m
FROM schools
WHERE ST_DWithin(geom::geography, ST_MakePoint($lng,$lat)::geography, 800)
ORDER BY distance_m;
```

---

#### Primitive 2: Polygon (defined boundary area)

A shape with a perimeter that represents a real-world boundary. May be irregular. May overlap postcode boundaries. May overlap other polygons of a different type.

**Qolify layers using this primitive:**

**Flood zones (SNCZI T10/T100/T500):**
These are the most critical polygons in the system. They are irregular shapes defined by hydrological modelling — they follow river basins and topography, not streets or postcode boundaries. A T10 flood zone routinely covers part of one postcode and a corner of three others. They must never be approximated by choropleth — the boundary is the data.

**School catchment areas:**
Defined by the education authority (Junta de Andalucía for Málaga). Follow street lines, not postcode lines. Catchments overlap postcode boundaries constantly. A child at the postcode boundary may be in a different catchment to their neighbour 10 metres away.

**Fibre coverage zones:**
Telecoms operator (Movistar, Orange, Vodafone) coverage areas for full-fibre. Defined by exchange coverage, not geography. Highly irregular.

**Park and green space polygons:**
Physical park boundaries from OpenStreetMap / INE.

**PostGIS storage:**
```sql
geom  GEOMETRY(MultiPolygon, 4326)
CREATE INDEX ON flood_zones USING GIST (geom);
CREATE INDEX ON school_catchments USING GIST (geom);
```

**MapLibre layer type:** `fill` (polygon fill) + `line` (stroke)

**Zoom behaviour:** Flood zones and catchments visible at all zoom levels when toggled ON. Park polygons visible at zoom >= 13.

**The boundary precision rule:** Polygon layers are served as pre-baked GeoJSON files from Supabase Storage, generated nightly from PostGIS. They are not served as live PostGIS queries on page load. Exception: the zone detail panel and pin report run live point-in-polygon queries at interaction time to determine precise intersection for a specific coordinate.

**Cross-boundary behaviour (critical):** When a polygon layer (flood zone) intersects a choropleth layer (zone score), the two layers tell different stories at different scales:

- At zone level: "29017 has 12% T10 flood coverage" → choropleth penalty applied
- At pin level: "this specific address is inside the T10 polygon" → binary true/false, authoritative

Both must be shown. The choropleth is for discovery; the polygon intersection is for decision.

**Query patterns (PostGIS):**
```sql
-- Does this specific coordinate sit inside a flood zone?
SELECT flood_period, ST_Area(geom::geography) AS zone_area_sqm
FROM flood_zones
WHERE ST_Within(ST_MakePoint($lng,$lat)::geometry, geom)
ORDER BY flood_period;

-- What % of a postcode polygon is covered by T10 flood zone?
SELECT
  ST_Area(ST_Intersection(pz.geom, fz.geom)::geography) /
  NULLIF(ST_Area(pz.geom::geography), 0) * 100 AS t10_pct
FROM postal_zones pz
JOIN flood_zones fz ON ST_Intersects(pz.geom, fz.geom)
WHERE pz.codigo_postal = '29017' AND fz.flood_period = 'T10';
```

---

#### Primitive 3: Choropleth (administrative aggregate)

A polygon layer where the fill colour encodes a calculated aggregate value — not a physical feature, but an administrative container (postcode, municipio, zona) whose colour represents summarised data. The boundary of the polygon is a bureaucratic line; the fill colour is the intelligence.

**Qolify layers using this primitive:**
- Zone Score by postcode (the default view)
- VUT density % by postcode
- NTI Signal by postcode
- Average price/m² by postcode
- Crime index by zona (crime_stats)
- Median income by municipio

**The container:** `postal_zones` table holds the postcode boundary GeoJSON. This is the shape file. The zone_scores materialised view holds the data. MapLibre joins them using `codigo_postal` as the key.

**PostGIS storage:**
```sql
CREATE TABLE postal_zones (
  codigo_postal TEXT PRIMARY KEY,
  municipio     TEXT,
  geom          GEOMETRY(MultiPolygon, 4326),
  centroid      GEOMETRY(Point, 4326)  -- pre-computed for label placement and proximity queries
);
CREATE INDEX ON postal_zones USING GIST (geom);
CREATE INDEX ON postal_zones USING GIST (centroid);
```

**MapLibre layer type:** `fill` (polygon choropleth)

**MapLibre data join — Option A (pre-baked, chosen for MVP — see D-029):**
A single GeoJSON file is generated nightly. It contains both the boundary geometry AND the score properties merged into each feature. MapLibre loads one file; no client-side join required.

```javascript
// The pre-baked file has this feature structure:
{
  "type": "Feature",
  "geometry": { "type": "MultiPolygon", "coordinates": [...] },
  "properties": {
    "codigo_postal": "29017",
    "zone_tvi": 72,
    "weighted_score": 72,       // starts equal to zone_tvi; client overwrites on profile switch
    "school_score_norm": 85,
    "health_score_norm": 74,
    "community_score_norm": 68,
    "flood_risk_score": 90,
    "solar_score_norm": 88,
    "connectivity_score_norm": 65,
    "infrastructure_score_norm": 55,
    "vut_density_pct": 7.2,
    "has_t10_flood": false,
    "avg_ghi": 1720,
    "nti_signal": "stable",
    "signals": ["school_rich", "low_vut"]
  }
}
```

**MapLibre colour expression:**
```javascript
map.setPaintProperty('zones-fill', 'fill-color', [
  'interpolate', ['linear'], ['get', 'weighted_score'],
  0,   '#5C0F00',
  25,  '#8B1A00',
  40,  '#C94B1A',
  55,  '#D4820A',
  70,  '#34C97A',
  85,  '#00A855',
  100, '#00C464'
]);
```

**The bluntness acknowledgement:** Choropleth is zone-level approximation. VUT density at postcode level is a blunt tool — one tourist-saturated street in a postcode reads as moderate area-wide density. This is correct for discovery. For a specific property decision, the individual VUT licence point layer (at zoom > 14) provides precision. Both are needed, at their respective zoom levels.

---

#### Primitive 4: Heatmap (continuous intensity surface)

Not bound to any administrative area. Computed from point data — the visual intensity at any map location is a function of how many source points are nearby and how strong each one is. Produces a smooth gradient surface.

**Qolify layers using this primitive:**
- Solar exposure (GHI kWh/m²/yr from PVGIS grid — thousands of evenly-spaced measurement points, each with a precise value)
- Amenity density (concentration of cafes, coworking, parks — point count density)

**Why heatmap for solar:** Solar radiation varies continuously across space. There is no natural administrative boundary for sunlight. PVGIS provides a dense grid of measurement points — a heatmap is the honest representation of that continuous data.

**Why NOT heatmap for flood risk:** A heatmap of flood zone points would create a misleading gradient blur. Flood risk has a precise legal boundary — you are inside or outside the T10 polygon. A gradient would suggest gradual risk, which is wrong and potentially dangerous. Flood uses Polygon (Primitive 2). This distinction is non-negotiable.

**MapLibre layer type:** `heatmap` (zoom-dependent, transitions to symbol/label at high zoom)

**MapLibre implementation:**
```javascript
map.addLayer({
  id: 'solar-heatmap',
  type: 'heatmap',
  source: 'solar-points',   // GeoJSON: lat/lng PVGIS grid with ghi_annual_kwh_m2 property
  maxzoom: 14,
  paint: {
    'heatmap-weight': [
      'interpolate', ['linear'], ['get', 'ghi_annual_kwh_m2'],
      1000, 0,    // min GHI (northern Spain) = no weight
      1900, 1     // max GHI (Andalucía coast) = full weight
    ],
    'heatmap-intensity': 1.5,
    'heatmap-radius': [
      'interpolate', ['linear'], ['zoom'],
      8, 40,    // large radius at city view (blends smoothly)
      14, 15    // smaller at neighbourhood view (more precise)
    ],
    'heatmap-color': [
      'interpolate', ['linear'], ['heatmap-density'],
      0,   'rgba(13, 43, 78, 0)',        // transparent (no data / low solar)
      0.2, 'rgba(255, 220, 80, 0.40)',   // pale yellow
      0.5, 'rgba(255, 165, 30, 0.55)',   // amber
      0.8, 'rgba(220, 100, 20, 0.65)',   // deep amber-orange
      1.0, 'rgba(200, 60, 10, 0.72)'    // red-orange (peak solar)
    ],
    'heatmap-opacity': 0.80,
  }
});

// At zoom >= 14: switch to showing GHI value labels per point
map.addLayer({
  id: 'solar-labels',
  type: 'symbol',
  source: 'solar-points',
  minzoom: 14,
  layout: {
    'text-field': ['concat', ['to-string', ['round', ['get', 'ghi_annual_kwh_m2']]], ' kWh/m²'],
    'text-font': ['DM Mono Regular'],
    'text-size': 11,
  },
  paint: { 'text-color': '#D4820A', 'text-halo-color': '#111827', 'text-halo-width': 1.5 }
});
```

---

#### Primitive 5: Radius / Buffer (computed from a point)

A circle drawn around a specific coordinate, at a specified distance. Not a physical feature — a spatial computation. Used in two modes.

**System-drawn radius (automatic context):**
When the user clicks a school pin, the system draws a 400m radius around that school to show the walking catchment. When a property pin is placed, a 1km service area ring is drawn automatically.

```javascript
import * as turf from '@turf/turf';

function showSchoolRadius(lng, lat) {
  const circle = turf.circle([lng, lat], 0.4, { units: 'kilometers', steps: 64 });
  map.getSource('radius-display').setData(circle);
  map.setLayoutProperty('radius-fill', 'visibility', 'visible');
}
```

**User-controlled radius (interactive filter):**
User sets a search origin (right-click / long-press, or address search). A slider appears in the left panel. As they adjust the slider, the radius circle updates live and everything outside dims.

```
Interaction sequence:
1. User right-clicks → "Set search origin here"
2. Circle appears at 1km radius (default)
3. Slider in left panel: [0.5km ──●──── 10km]
4. Map dims outside the circle in real time
5. Left panel updates: "4 schools · 2 GPs · 6 bus stops within 1.5km"
6. Zone panel for zones inside the circle updates aggregate intelligence
```

**PostGIS query pattern:**
```sql
-- All schools within user-defined radius
SELECT name, type, ST_Distance(geom::geography, ST_MakePoint($lng,$lat)::geography) AS distance_m
FROM schools
WHERE ST_DWithin(geom::geography, ST_MakePoint($lng,$lat)::geography, $radius_m)
ORDER BY distance_m;

-- Zones intersecting the radius circle
WITH circle AS (
  SELECT ST_Buffer(ST_MakePoint($lng,$lat)::geography, $radius_m)::geometry AS geom
)
SELECT pz.codigo_postal, zs.zone_tvi,
  ST_Area(ST_Intersection(pz.geom, c.geom)::geography) /
  ST_Area(c.geom::geography) AS overlap_pct
FROM postal_zones pz
JOIN zone_scores zs USING (codigo_postal)
JOIN circle c ON ST_Intersects(pz.geom, c.geom)
ORDER BY overlap_pct DESC;
```

**MapLibre implementation:**
```javascript
const circle = turf.circle([originLng, originLat], radiusKm, { steps: 64 });
map.getSource('user-radius').setData(circle);

// Dim zones outside the radius
map.setPaintProperty('zones-fill', 'fill-opacity', [
  'case',
  ['within', circle],
  0.60,   // inside: normal
  0.10    // outside: faded
]);
```

**MVP scope:** Radius filter is included in Map MVP as a key interaction, driven by the left panel slider.

---

#### Primitive 6: User-drawn area (freehand polygon)

The user draws a custom polygon by clicking on the map. The system runs spatial queries for everything inside the drawn area.

**When it's valuable:**
- Buyer needs to be in a triangle between workplace, school, and elderly parent's home — none of which align with postcode lines
- Investor wants to define a corridor along a planned metro extension

**Technical implementation:** `@mapbox/mapbox-gl-draw` plugin (works with MapLibre despite the name). On draw complete, the GeoJSON polygon is POSTed to `/api/map/query`.

```javascript
map.on('draw.create', async (e) => {
  const polygon = e.features[0].geometry;
  const result = await fetch('/api/map/query', {
    method: 'POST',
    body: JSON.stringify({ polygon })
  });
  renderCustomAreaPanel(result);
});
```

**PostGIS query pattern:**
```sql
-- Zones whose centroid falls within the drawn polygon
SELECT zs.codigo_postal, zs.zone_tvi
FROM zone_scores zs
JOIN postal_zones pz USING (codigo_postal)
WHERE ST_Within(pz.centroid, ST_GeomFromGeoJSON($polygon_geojson));
```

**MVP scope:** **Phase 3 only.** The radius filter (Primitive 5) handles 90% of the same use cases with far less complexity. Logged as D-030.

---

### 3.2 — Layer Decision Matrix

Every layer in the system mapped to its primitive, boundary, zoom behaviour, and user interaction:

| Layer | Primitive | Boundary | Zoom behaviour | User interaction |
|---|---|---|---|---|
| Zone Score (default choropleth) | Choropleth | Postcode | All zooms | Profile switch reweights client-side |
| VUT density % | Choropleth | Postcode | All zooms | Toggle on/off |
| NTI Signal | Choropleth | Postcode | All zooms | Investor mode auto-on |
| Average price/m² | Choropleth | Postcode | All zooms | Toggle on/off |
| Crime index | Choropleth | Crime zona | All zooms | Toggle on/off |
| Median income | Choropleth | Municipio | All zooms | Background context only |
| Flood zones T10 | Polygon | Irregular SNCZI boundary | All zooms when ON | Toggle on/off; never dimmed |
| Flood zones T100 | Polygon | Irregular SNCZI boundary | All zooms when ON | Toggle on/off |
| Flood zones T500 | Polygon | Irregular SNCZI boundary | All zooms when ON | Toggle on/off |
| School catchment areas | Polygon | Education authority boundary | Visible zoom >= 12 | Toggle on/off |
| Fibre coverage zones | Polygon | Operator coverage area | All zooms when ON | Toggle on/off |
| Park / green space | Polygon | Physical boundary | Visible zoom >= 13 | Toggle on/off |
| Solar exposure | Heatmap | Continuous PVGIS grid | Heatmap zoom < 14; labels zoom >= 14 | Toggle on/off |
| Amenity density | Heatmap | Point density | Heatmap zoom < 13; pins zoom >= 13 | Toggle on/off |
| Schools | Point | Exact address | Cluster zoom < 13; pins zoom >= 13 | Toggle; click → detail + 400m radius |
| GPs / hospitals | Point | Exact address | Cluster zoom < 13; pins zoom >= 13 | Toggle; click → detail |
| Pharmacies | Point | Exact address | Visible zoom >= 15 only | Toggle |
| Metro / bus / train | Point | Exact location | Cluster zoom < 13; pins zoom >= 13 | Toggle; click → detail |
| Infrastructure projects | Point | Project site | Always visible (low count) | Toggle; click → detail |
| Individual VUT addresses | Point | Exact address | Visible zoom >= 15 only | Toggle (companion to VUT choropleth) |
| User dropped property pin | Point | User-defined | Always visible when placed | Right-click / long-press to place |
| User radius filter | Buffer | User-defined centre | Visible when radius mode active | Left panel slider |
| Custom drawn area | Polygon | User-drawn | Visible when drawn | Phase 3 only |

---

### 3.3 — The Two-Level Truth Problem

The most important architectural principle for layers that cross administrative boundaries.

**The problem:** A flood zone polygon may cover 8% of postcode 29017 — a small strip along a river. At the choropleth level, 29017 shows a slight penalty in its zone score. But a specific property sitting precisely in that 8% strip is in a T10 flood zone. For that buyer, the choropleth penalty is meaningless — what matters is the binary polygon intersection at their address.

**The rule: always run two queries for boundary-crossing layers.**

```
Zone level  (discovery)  → choropleth aggregate, postcode-level penalty
Pin level   (decision)   → point-in-polygon query, binary and authoritative
```

**Layers requiring two-level truth:**

| Layer | Zone level (choropleth) | Pin level (point-in-polygon) |
|---|---|---|
| Flood zones | % of postcode covered by T10/T100 | `ST_Within(pin, flood_geom)` → binary true/false + zone period |
| School catchments | Count of catchments overlapping postcode | `ST_Within(pin, catchment_geom)` → specific school name |
| Fibre coverage | % of postcode with full-fibre | `ST_Within(pin, fibre_geom)` → confirmed true/false |
| Crime zones | Crime zone index for postcode | Which crime zona the pin falls in (may differ from postcode majority) |
| Noise contours (future) | Avg noise band across postcode | Precise dB contour at pin coordinate |

**Implementation rule:** The zone detail panel shows zone-level aggregates. The property pin report always runs point-in-polygon queries. Never show the choropleth aggregate in the pin report. The pin report must use the phrase "This address is / is not in a T10 flood zone" — not "12% of this postcode is T10."

---

### 3.4 — Zoom-Dependent Layer Visibility

MapLibre controls visibility via `minzoom` / `maxzoom` per layer. The correct zoom level per layer type is not cosmetic — showing pins at city view or chropleths at street level both produce unreadable maps.

```
Zoom 8–10  (city / region view)
  VISIBLE:  Choropleth fill
            Solar heatmap
            City-level cluster counts for schools, health
  HIDDEN:   All individual pins
            Catchment polygons (too many to distinguish)
            Flood zone polygons (too small to read)

Zoom 11–12 (district view)
  VISIBLE:  Choropleth fill
            Flood zone polygons (legible at this scale)
            Clustered pins — schools, health, transport
            Amenity density heatmap
  HIDDEN:   Catchment polygons
            Individual VUT addresses

Zoom 13–14 (neighbourhood view)
  VISIBLE:  Choropleth fill (reduced opacity — pins take precedence visually)
            Individual school, GP, transport, infrastructure pins
            School catchment boundaries (now legible — dashed lines)
            Park polygons
            Flood zone polygon labels
  HIDDEN:   Solar heatmap (transitions to point labels at zoom 14)
            All cluster markers (individual pins take over)

Zoom 15–16 (street view)
  VISIBLE:  All individual pins with labels
            Catchment boundaries
            Flood zone polygons (most critical at this scale)
            Pharmacy pins (only visible here)
            Individual VUT licence address pins
            User radius circle if active
  HIDDEN:   Choropleth fill (too granular — replace with pin-level data)

Zoom 17+   (building level)
  VISIBLE:  Pin labels fully expanded
            All polygon boundaries (flood, catchment, fibre)
            User property pin + auto-drawn 400m service ring
  HIDDEN:   Choropleth, heatmaps (meaningless at this resolution)
```

**MapLibre layer definitions:**
```javascript
map.addLayer({ id: 'zones-fill',        minzoom: 8,  maxzoom: 16 });
map.addLayer({ id: 'schools-cluster',   minzoom: 8,  maxzoom: 13 });
map.addLayer({ id: 'schools-pins',      minzoom: 13, maxzoom: 22 });
map.addLayer({ id: 'flood-polygons',    minzoom: 11, maxzoom: 22 });
map.addLayer({ id: 'catchment-lines',   minzoom: 12, maxzoom: 22 });
map.addLayer({ id: 'solar-heatmap',     minzoom: 8,  maxzoom: 14 });
map.addLayer({ id: 'solar-labels',      minzoom: 14, maxzoom: 22 });
map.addLayer({ id: 'vut-individual',    minzoom: 15, maxzoom: 22 });
map.addLayer({ id: 'pharmacy-pins',     minzoom: 15, maxzoom: 22 });
map.addLayer({ id: 'park-polygons',     minzoom: 13, maxzoom: 22 });
```

---

### 3.5 — Coordinate System and PostGIS Conventions

All geometry uses SRID 4326 (WGS84 — standard lat/lng). All distance calculations cast to `.::geography` for accurate metre-based results. All spatial indexes use GIST.

```sql
-- Correct distance calculation (returns metres)
ST_Distance(geom::geography, ST_MakePoint($lng, $lat)::geography)

-- Correct proximity filter (radius in metres)
ST_DWithin(geom::geography, ST_MakePoint($lng, $lat)::geography, $metres)

-- Correct point-in-polygon
ST_Within(ST_MakePoint($lng, $lat)::geometry, polygon_geom)

-- CRITICAL parameter order: longitude first, then latitude (GeoJSON convention)
-- CORRECT: ST_MakePoint(-4.4214, 36.7213)  ← lng, lat
-- WRONG:   ST_MakePoint(36.7213, -4.4214)  ← common mistake, produces wrong results silently
```

---

## 4. Architecture: How the Map Works Without Model A Scraping

The critical insight: **the map does not need scraped property listings to be valuable.** It needs zone-level intelligence. Zone intelligence is computed entirely from the open-data QoL tables.

```
User loads /map
      │
      ▼
MapLibre initialises — loads pre-baked boundary+score GeoJSON from Supabase Storage CDN
  (malaga/zones.geojson — boundary geometry + score properties merged, ~300KB, CDN-cached)
      │
      ▼
Choropleth renders immediately — no API call needed for initial paint (~150ms)
      │
User switches to Family profile
      │
Client reweights zone scores locally using PROFILE_WEIGHTS (~10ms)
MapLibre repaints choropleth (~200ms CSS transition) — no API call
      │
User enables Schools layer
      │
GET /api/map/layer?type=schools&bbox=[viewport bounds]
  → Returns GeoJSON: schools within current viewport (~180ms)
  → MapLibre renders clustered pins
      │
User clicks postcode zone 29017
      │
GET /api/map/zone/29017
  → Returns full zone detail (pillar breakdowns, school list, VUT detail, flood detail)
  → Zone panel slides in from right (~250ms)
      │
User drops property pin at a specific address
      │
POST /api/map/pin { lat, lng, price_asking?, area_sqm? }
  → Runs point-in-polygon queries for all boundary-crossing layers (flood, catchment, fibre)
  → Runs ST_DWithin proximity queries for all point layers (schools, GPs, transport)
  → Returns: full pin-level location intelligence (no Parse.bot, no URL required)
```

### The `zone_scores` materialised view

Pre-computed nightly via pg_cron. Each postcode polygon gets a composite score and all pillar sub-scores. The nightly refresh takes all expensive PostGIS spatial join work off the request path.

```sql
CREATE MATERIALIZED VIEW zone_scores AS
WITH
  school_agg AS (
    SELECT
      pz.codigo_postal,
      COUNT(s.id)                                                              AS school_count,
      MIN(ST_Distance(s.geom::geography, pz.centroid::geography))             AS nearest_school_m,
      SUM(CASE WHEN s.type = 'public' THEN 1 ELSE 0 END)                     AS public_count,
      COUNT(s.id) FILTER (
        WHERE ST_Distance(s.geom::geography, pz.centroid::geography) < 400
      )                                                                        AS schools_400m
    FROM postal_zones pz
    LEFT JOIN schools s ON ST_DWithin(s.geom::geography, pz.centroid::geography, 1500)
    GROUP BY pz.codigo_postal
  ),
  health_agg AS (
    SELECT
      pz.codigo_postal,
      MIN(ST_Distance(h.geom::geography, pz.centroid::geography))
        FILTER (WHERE h.type = 'gp')                                          AS nearest_gp_m,
      MIN(ST_Distance(h.geom::geography, pz.centroid::geography))
        FILTER (WHERE h.type = 'hospital' AND h.has_emergency = true)         AS nearest_emergency_m,
      COUNT(h.id) FILTER (
        WHERE h.type = 'pharmacy'
        AND ST_Distance(h.geom::geography, pz.centroid::geography) < 500
      )                                                                        AS pharmacies_500m
    FROM postal_zones pz
    LEFT JOIN health_centres h ON ST_DWithin(h.geom::geography, pz.centroid::geography, 3000)
    GROUP BY pz.codigo_postal
  ),
  vut_agg AS (
    SELECT
      codigo_postal,
      COUNT(*) FILTER (WHERE status = 'active')                               AS vut_active,
      ROUND(
        COUNT(*) FILTER (WHERE status = 'active') * 100.0
        / NULLIF(estimated_units, 0), 1
      )                                                                        AS vut_density_pct
    FROM vut_licences
    GROUP BY codigo_postal
  ),
  flood_agg AS (
    SELECT
      pz.codigo_postal,
      BOOL_OR(fz.flood_period = 'T10')                                        AS has_t10_flood,
      BOOL_OR(fz.flood_period = 'T100')                                       AS has_t100_flood,
      COALESCE(
        MAX(
          ST_Area(ST_Intersection(pz.geom, fz.geom)::geography)
        ) FILTER (WHERE fz.flood_period = 'T10')
        / NULLIF(ST_Area(pz.geom::geography), 0) * 100,
        0
      )                                                                        AS t10_coverage_pct
    FROM postal_zones pz
    LEFT JOIN flood_zones fz ON ST_Intersects(pz.geom, fz.geom)
    GROUP BY pz.codigo_postal
  ),
  solar_agg AS (
    SELECT
      pz.codigo_postal,
      AVG(sr.ghi_annual_kwh_m2)                                               AS avg_ghi
    FROM postal_zones pz
    JOIN solar_radiation sr ON ST_Within(sr.geom, pz.geom)
    GROUP BY pz.codigo_postal
  ),
  transport_agg AS (
    SELECT
      pz.codigo_postal,
      MIN(ST_Distance(t.geom::geography, pz.centroid::geography))
        FILTER (WHERE t.type = 'metro')                                       AS nearest_metro_m,
      COUNT(t.id) FILTER (
        WHERE ST_Distance(t.geom::geography, pz.centroid::geography) < 400
      )                                                                        AS stops_400m
    FROM postal_zones pz
    LEFT JOIN transport_stops t ON ST_DWithin(t.geom::geography, pz.centroid::geography, 1000)
    GROUP BY pz.codigo_postal
  ),
  infra_agg AS (
    SELECT
      pz.codigo_postal,
      COUNT(ip.id)                                                             AS project_count,
      BOOL_OR(ip.type = 'metro_extension')                                    AS has_metro_project
    FROM postal_zones pz
    LEFT JOIN infrastructure_projects ip
      ON ST_DWithin(ip.geom::geography, pz.centroid::geography, 2000)
      AND ip.status = 'approved'
    GROUP BY pz.codigo_postal
  )

SELECT
  pz.codigo_postal, pz.geom, pz.centroid, pz.municipio,

  -- Raw values (for display in zone panel)
  sa.school_count, sa.nearest_school_m, sa.schools_400m, sa.public_count,
  ha.nearest_gp_m, ha.nearest_emergency_m, ha.pharmacies_500m,
  va.vut_active, va.vut_density_pct,
  fa.has_t10_flood, fa.has_t100_flood, fa.t10_coverage_pct,
  so.avg_ghi,
  ta.nearest_metro_m, ta.stops_400m,
  ia.project_count, ia.has_metro_project,

  -- Normalised pillar scores (0–100, higher = better)
  LEAST(100, GREATEST(0, ROUND(
    (100 - LEAST(100, COALESCE(sa.nearest_school_m, 9999) / 15.0)) * 0.50
    + LEAST(40, COALESCE(sa.schools_400m, 0) * 8.0)
    + (COALESCE(sa.public_count, 0)::float / NULLIF(sa.school_count, 0)) * 10
  )))                                                                          AS school_score_norm,

  LEAST(100, GREATEST(0, ROUND(
    (100 - LEAST(100, COALESCE(ha.nearest_gp_m, 9999) / 30.0)) * 0.50
    + (100 - LEAST(100, COALESCE(ha.nearest_emergency_m, 10000) / 100.0)) * 0.30
    + LEAST(20, COALESCE(ha.pharmacies_500m, 0) * 5.0)
  )))                                                                          AS health_score_norm,

  LEAST(100, GREATEST(0, ROUND(
    100 - LEAST(100, COALESCE(va.vut_density_pct, 0) * 2.5)
  )))                                                                          AS community_score_norm,

  LEAST(100, GREATEST(0, ROUND(
    100
    - (CASE WHEN fa.has_t10_flood THEN 30 ELSE 0 END)
    - LEAST(30, COALESCE(fa.t10_coverage_pct, 0) * 3.0)
    - (CASE WHEN fa.has_t100_flood THEN 10 ELSE 0 END)
  )))                                                                          AS flood_risk_score,

  LEAST(100, GREATEST(0, ROUND(
    (COALESCE(so.avg_ghi, 1400) - 1400) / 5.0
  )))                                                                          AS solar_score_norm,

  LEAST(100, GREATEST(0, ROUND(
    (100 - LEAST(100, COALESCE(ta.nearest_metro_m, 5000) / 50.0)) * 0.60
    + LEAST(40, COALESCE(ta.stops_400m, 0) * 5.0)
  )))                                                                          AS connectivity_score_norm,

  LEAST(100, GREATEST(0, ROUND(
    LEAST(60, COALESCE(ia.project_count, 0) * 15.0)
    + (CASE WHEN ia.has_metro_project THEN 30 ELSE 0 END)
  )))                                                                          AS infrastructure_score_norm,

  -- Composite zone TVI (base weights; overridden client-side by profile)
  ROUND(
    COALESCE(school_score_norm        * 0.15, 0)
    + COALESCE(health_score_norm      * 0.15, 0)
    + COALESCE(community_score_norm   * 0.12, 0)
    + COALESCE(flood_risk_score       * 0.18, 0)
    + COALESCE(solar_score_norm       * 0.10, 0)
    + COALESCE(connectivity_score_norm* 0.15, 0)
    + COALESCE(infrastructure_score_norm * 0.15, 0)
  )                                                                            AS zone_tvi,

  -- Signal badges array
  ARRAY_REMOVE(ARRAY[
    CASE WHEN fa.has_t10_flood                              THEN 'flood_t10'      END,
    CASE WHEN COALESCE(va.vut_density_pct, 0) > 30         THEN 'high_vut'       END,
    CASE WHEN COALESCE(va.vut_density_pct, 0) < 8          THEN 'low_vut'        END,
    CASE WHEN COALESCE(sa.schools_400m, 0) >= 2            THEN 'school_rich'    END,
    CASE WHEN COALESCE(ha.nearest_gp_m, 9999) < 300        THEN 'gp_close'       END,
    CASE WHEN ia.has_metro_project                          THEN 'metro_incoming' END,
    CASE WHEN COALESCE(so.avg_ghi, 0) > 1750               THEN 'high_solar'     END
  ], NULL)                                                                    AS signals

FROM postal_zones pz
LEFT JOIN school_agg      sa USING (codigo_postal)
LEFT JOIN health_agg      ha USING (codigo_postal)
LEFT JOIN vut_agg         va USING (codigo_postal)
LEFT JOIN flood_agg       fa USING (codigo_postal)
LEFT JOIN solar_agg       so USING (codigo_postal)
LEFT JOIN transport_agg   ta USING (codigo_postal)
LEFT JOIN infra_agg       ia USING (codigo_postal);

CREATE UNIQUE INDEX ON zone_scores (codigo_postal);
CREATE INDEX ON zone_scores USING GIST (geom);
```

**Nightly refresh (pg_cron):**
```sql
SELECT cron.schedule('refresh-zone-scores', '0 3 * * *',
  'REFRESH MATERIALIZED VIEW CONCURRENTLY zone_scores');
```

**GeoJSON tile generation (Edge Function, runs after refresh):**
```typescript
// supabase/functions/generate-zone-tiles/index.ts
const geojson = await supabase.rpc('export_zone_geojson', { city: 'malaga' });
await supabase.storage.from('map-tiles').upload(
  'malaga/zones.geojson',
  JSON.stringify(geojson),
  { contentType: 'application/geo+json', upsert: true, cacheControl: '86400' }
);
```

### Profile-weighted recompute (client-side)

Pillar sub-scores are included in the pre-baked GeoJSON. Profile switching reweights locally — instant, no API call.

```typescript
const PROFILE_WEIGHTS = {
  family:   { school: 0.30, health: 0.20, community: 0.12, flood: 0.23, solar: 0.05, connectivity: 0.10, infrastructure: 0.00 },
  nomad:    { school: 0.02, health: 0.08, community: 0.10, flood: 0.10, solar: 0.10, connectivity: 0.60, infrastructure: 0.00 },
  retiree:  { school: 0.00, health: 0.35, community: 0.15, flood: 0.15, solar: 0.20, connectivity: 0.15, infrastructure: 0.00 },
  investor: { school: 0.05, health: 0.05, community: 0.20, flood: 0.20, solar: 0.05, connectivity: 0.10, infrastructure: 0.35 },
};

function reweightZone(props: ZoneProperties, profile: Profile): number {
  const w = PROFILE_WEIGHTS[profile];
  return Math.round(
    (props.school_score_norm        ?? 50) * w.school +
    (props.health_score_norm        ?? 50) * w.health +
    (props.community_score_norm     ?? 50) * w.community +
    (props.flood_risk_score         ?? 50) * w.flood +
    (props.solar_score_norm         ?? 50) * w.solar +
    (props.connectivity_score_norm  ?? 50) * w.connectivity +
    (props.infrastructure_score_norm?? 50) * w.infrastructure
  );
}

function repaintChoropleth(zones: GeoJSON.FeatureCollection, profile: Profile): void {
  zones.features.forEach(f => {
    f.properties!.weighted_score = reweightZone(f.properties as ZoneProperties, profile);
  });
  (map.getSource('zones') as maplibregl.GeoJSONSource).setData(zones);
}
```

---

## 5. Screen Architecture

### Route: `/map` — Full-viewport

```
┌─────────────────────────────────────────────────────────────────────┐
│  [Qolify 24px]   [Málaga ▼]   [29001–29017]   [Save area] [Acct]  │ ← 48px nav, Navy
├─────────────────────────────────────────────────────────────────────┤
│  ┌────────────┐                              ┌─────────────────────┐│
│  │ LEFT PANEL │                              │  ZONE / PIN PANEL   ││
│  │  320px     │   MAPLIBRE GL CANVAS         │  360px              ││
│  │            │   full viewport              │  (slides in on      ││
│  │  Profile   │                              │   zone click or     ││
│  │  Radius    │                              │   pin drop)         ││
│  │  Filters   │                              │                     ││
│  │  Layers    │                              └─────────────────────┘│
│  └────────────┘                                                      │
│                ┌──────────────────────────────────────┐             │
│                │  BOTTOM OVERLAY TOOLBAR (pill)       │             │
│                └──────────────────────────────────────┘             │
│  [+][-]  ©MapTiler                    [Radius mode ○] [Draw — Ph3] │
└─────────────────────────────────────────────────────────────────────┘
```

**Left Panel** (320px, glassmorphism — backdrop-filter: blur(24px), Navy primary_container 80% opacity):

- **Section 1 — Profile tabs:** `Families` · `Nomads` · `Retirees` · `Investors` — switching calls `repaintChoropleth()`
- **Section 2 — Score threshold slider:** "Show zones scoring above: [40]" — below-threshold zones fade to 10% opacity in real time
- **Section 3 — Radius filter:** "Centre search here" — address field or map-click mode. When active: distance slider + live counts ("4 schools · 2 GPs within 1.5km")
- **Section 4 — ICP filters:** Changes content based on active profile (school type pills, fibre required toggle, GP distance slider, NTI filter, etc.)
- **Section 5 — Layer toggles:** Six rows with icon + label + emerald/slate toggle pill

**Bottom Overlay Toolbar** (centred, pill, 44px height, white bg, ambient shadow):
`[ Zone Score ] [ Schools ] [ Flood ] [ Solar ] [ Community ] [ Safety ] [ Prices ]`
One active at a time. Switching changes the choropleth fill colour expression.

---

## 6. Zone Panel — Detail View (360px, right edge)

Triggered on postcode zone click. 200ms ease-out slide.

**Header:** Zone name + postcode in Playfair Display 22px. Zone Score ring (64px TVI-style donut). Profile-adjusted score badge if different.

**Signal badges:** Horizontal scroll pill row. Colour-coded: Emerald (positive) / Amber (caution) / Terracotta (risk).

**Pillar score grid (2×3):** Schools · Health · Community · Solar · Connectivity · Flood Safety. Each cell: icon + name + 60px score bar + number.

**Accordion sections (each pillar expands):**

*Schools:* Nearest school (name, distance, type). Schools within 1km count. Catchment note. "Show on map →" link.

*Flood Risk:*
- If `has_t10_flood = false`: "✓ No T10 flood exposure in this postcode."
- If `has_t10_flood = true`: "⚠️ [t10_coverage_pct]% of this postcode is within the T10 flood zone. **Drop a property pin to check any specific address against the exact polygon boundary.**"
- Note: the zone panel shows the aggregate. The pin report shows the precise binary result. This distinction is explicit in the UI copy.

*Community / VUT:* Density percentage. Benchmark comparison ("Málaga Centro runs at ~28%"). Residential character estimate.

*Solar:* Average GHI. Solar panel viability rating. Estimated annual savings on a typical apartment.

*Health:* Nearest GP (name, distance). Nearest 24hr emergency. Pharmacy count within 500m.

*Infrastructure (Investor mode):* Project list within 2km with type, year, distance.

**Price context:** Average price/m² if >= 3 data points in `property_price_history`. Grey placeholder if insufficient.

**Undervalued badge (Investor mode):** Full-width emerald banner if `zone_tvi >= 65 AND avg_price_sqm < national_p40_for_zone_score`.

**CTA (full-width, bottom):**
`"Drop a property pin here"` — Navy bg, Playfair Display italic 16px white
Below: "Or paste an Idealista URL to analyse a specific listing →"

---

## 7. Map Visual Design

### Basemap
Library: MapLibre GL JS. Tiles: MapTiler GL (free tier, vector tiles, no Mapbox token).
Custom dark style: land `#1A2535`, water `#0F1E30`, streets `#243347`, labels `#8A9BB0` (DM Sans).

### Zone Choropleth
```javascript
const SCORE_COLOR = ['interpolate', ['linear'], ['get', 'weighted_score'],
  0, '#5C0F00', 25, '#8B1A00', 40, '#C94B1A', 55, '#D4820A', 70, '#34C97A', 85, '#00A855', 100, '#00C464'];

const SCORE_OPACITY = ['case',
  ['>=', ['get', 'weighted_score'], scoreThreshold], 0.55, 0.10];
```
Hover: opacity 0.72. Click: opacity 0.80, 2px Navy stroke. Profile switch: 400ms MapLibre interpolation.

### Point Layer Styles

**Schools:** 20px circle, white fill, 2px emerald stroke. Cluster: 36px emerald. Click → 400m radius auto-drawn.

**Health:** 18–22px circle, white fill, 2px terracotta stroke. Hospital larger.

**Transport:** 14px diamond, slate fill, white stroke. M/B/T SVG icon.

**Infrastructure:** 20px diamond, emerald fill, 2px white stroke. `drop-shadow(0 0 8px rgba(52,201,122,0.6))` glow — future value luminance.

**Flood polygons:** T10 `rgba(201,75,26,0.55)`. T100 `rgba(212,130,10,0.42)`. T500 `rgba(212,130,10,0.20)`. Never dimmed by threshold filter (safety-critical).

**School catchments:** No fill. 2px dashed emerald stroke at 70% opacity. School name label centred.

**User property pin:** 32px circle, emerald fill, 3px white stroke. Pulsing ring animation.

**User radius circle:** Emerald fill 8% opacity. 2px dashed emerald stroke 40% opacity. Slow opacity pulse while active.

---

## 8. ICP Profiles — Detailed Behaviour

### Family
- Overlay: Zone Score family-weighted (school 30%, flood 23%)
- Schools layer: auto-ON. Flood polygons: permanently visible in Family mode (no toggle).
- "Exclude T10 flood zones" toggle: hard filter (zones hidden, not just dimmed).
- Zone panel quick-insight: plain-English summary auto-generated from data.

### Nomad
- Overlay: Zone Score nomad-weighted (connectivity 60%)
- Fibre coverage polygon: auto-ON. No-fibre zones: cross-hatch pattern, not just dimmed.
- "Full-fibre required" toggle: hard filter.

### Retiree
- Overlay: Zone Score retiree-weighted (health 35%, solar 20%)
- Health centres: auto-ON. Solar heatmap: auto-ON.
- Zone panel: healthcare shown first, climate second.

### Investor
- Overlay: **NTI Signal choropleth** (4-state, replaces interpolated scale)
  - Prime Buy: `rgba(52,201,122,0.60)`. Too Late: `rgba(212,130,10,0.50)`. Stable: `rgba(74,93,116,0.30)`. Risk: `rgba(201,75,26,0.55)`. No data: slate with dot texture.
- Infrastructure layer: auto-ON with glow effect on project diamonds.
- Undervalued zone: `⬇️` symbol layer on choropleth + banner in zone panel.

---

## 9. The Property Pin — Coordinate-Based Analysis

Works entirely without a URL or Parse.bot. Requires only coordinates (and optionally price + m²).

**Interaction:**
1. Right-click (desktop) / long-press (mobile) anywhere on map
2. Popover: "Drop an intelligence pin here" + price/size fields (optional)
3. `POST /api/map/pin { lat, lng, price_asking?, area_sqm? }`
4. Server runs all PostGIS — no Parse.bot:
   - Point-in-polygon: flood zones (binary result per period)
   - Point-in-polygon: school catchment (exact school name)
   - Point-in-polygon: fibre coverage (confirmed true/false)
   - ST_DWithin: nearest school, GP, hospital, pharmacy, transport, infrastructure
   - PVGIS nearest grid point → solar GHI
   - AEMET nearest station → climate data
   - Catastro OVC by coordinates → build year, cadastral area
   - VUT count within 200m radius
5. Zone panel switches to Pin Report mode — all data is point-level (not zone aggregate)
6. Flood result: "✓ This address is NOT in a T10 flood zone" (binary, authoritative)
7. Catchment result: "This address is in the CEIP La Paz catchment" (specific, not aggregate)

**Optional enrichment:** "Paste an Idealista URL to add property-specific data →" — triggers full DNA Report with pin coordinate pre-filled.

---

## 10. API Endpoints

### `GET /api/map/zones?city={city}`
Resolves to pre-baked GeoJSON tile URL in Supabase Storage. MapLibre can also load the file directly from the public CDN URL without this API call.

### `GET /api/map/layer?type={type}&bbox={minLng},{minLat},{maxLng},{maxLat}`
Returns GeoJSON FeatureCollection for a point layer type, filtered to viewport bounds.
Types: `schools` | `health` | `transport` | `infrastructure` | `vut_points`
Target: < 200ms (indexed PostGIS bbox query)

### `GET /api/map/zone/{codigo_postal}`
Returns full zone detail for zone panel. Includes school list, health list, infrastructure list, VUT breakdown, flood breakdown, price context, NTI signal.
Target: < 300ms

### `POST /api/map/pin`
Request: `{ lat, lng, price_asking?, area_sqm? }`
Returns pin-level intelligence: flood binary results, catchment, fibre, all proximity distances, solar, climate, Catastro, VUT radius count, optional affordability estimate.
Target: < 800ms (multiple PostGIS queries + Catastro API)

### `POST /api/map/query` (Phase 3)
Request: `{ polygon: GeoJSON.Polygon }`
Returns aggregate intelligence for user-drawn area.

---

## 11. Linear Issue Structure

| Issue | Title | Priority | Milestone | Depends on |
|---|---|---|---|---|
| **CHI-335** | Build `zone_scores` materialised view + nightly pg_cron refresh | Urgent | M0 | Ingestion complete |
| **CHI-336** | GeoJSON tile generation Edge Function + Supabase Storage delivery | High | M0 | CHI-335 |
| **CHI-337** | `GET /api/map/layer` — point layer endpoint (schools, health, transport, infra) | High | M0 | Schema |
| **CHI-338** | `GET /api/map/zone/:codigo_postal` — zone detail endpoint | High | M0 | CHI-335 |
| **CHI-339** | Map MVP frontend — MapLibre canvas, choropleth, zoom-dependent layer visibility | Urgent | M1 | CHI-336 |
| **CHI-340** | Left panel — profile tabs, ICP filters, layer toggles, radius slider | High | M1 | CHI-339 |
| **CHI-341** | Zone panel — click detail, signal badges, pillar accordions, two-level truth display | High | M1 | CHI-338, CHI-339 |
| **CHI-342** | Bottom overlay toolbar — 7 choropleth overlay switcher | High | M1 | CHI-339 |
| **CHI-343** | Property pin — coordinate-based analysis, pin report mode, pulse animation | High | M2 | CHI-334 |
| **CHI-344** | `POST /api/map/pin` — all PostGIS spatial queries + Catastro by coordinates | High | M2 | CHI-335, CHI-337 |
| **CHI-303** | Superseded — close with comment "Replaced by MAP_MVP_SPEC v2.0" | — | — | — |

---

## 12. Definition of Done — Map MVP

**Data layer:**
- [ ] `zone_scores` materialised view populates correctly for all Málaga postcodes
- [ ] Nightly pg_cron refresh confirmed (check pg_cron.job_run_details)
- [ ] Pre-baked GeoJSON tile accessible from Supabase Storage CDN URL
- [ ] All point layer endpoints return correct GeoJSON with sub-200ms response

**Map rendering:**
- [ ] `/map` loads and paints choropleth in < 2 seconds for Málaga
- [ ] All 7 choropleth overlays switch correctly via bottom toolbar
- [ ] Profile switching recolours all zones in < 400ms (no API call — confirm in Network panel)
- [ ] Score threshold slider dims below-threshold zones in real time
- [ ] Zoom QA at zoom 8, 12, 14, 16: correct layers visible/hidden per §3.4 table
- [ ] Schools cluster at zoom < 13; individual pins at zoom >= 13
- [ ] Flood zone T10 and T100 clearly visually distinct; never dimmed by threshold filter
- [ ] Solar heatmap renders from PVGIS grid; transitions to value labels at zoom 14
- [ ] School catchment boundaries visible at zoom >= 12 (dashed emerald, no fill)
- [ ] Infrastructure project pins show glow drop-shadow

**Spatial correctness (the critical QA):**
- [ ] A postcode confirmed to have no flood exposure shows no flood polygon overlap
- [ ] A coordinate known inside a T10 polygon returns `in_t10: true` from `/api/map/pin`
- [ ] A coordinate known outside all flood polygons returns `in_t10: false`
- [ ] School catchment result from pin matches Junta de Andalucía official catchment for that address
- [ ] Radius filter dims zones outside the circle in real time; point layer counts update correctly
- [ ] Zone panel flood section shows postcode-level %; pin report shows binary result — confirmed different

**Interaction:**
- [ ] Zone panel opens correctly for 3 test postcodes: one high-score, one mixed, one flood-risk
- [ ] Signal badges in zone panel match `signals` array in zone_scores
- [ ] "Drop a pin here" CTA in zone panel triggers pin interaction mode
- [ ] Right-click / long-press on map opens pin popover
- [ ] Pin placed, analysis runs, zone panel switches to Pin Report mode
- [ ] Pin report flood result is binary ("is / is not in T10") — not a percentage

**Zero legacy dependencies:**
- [ ] No Parse.bot calls fired anywhere in Map MVP (confirm via Network inspector)
- [ ] No Idealista URLs required for any Map MVP feature
- [ ] Map MVP fully functional with zero rows in `properties` table

---

## 13. Decisions Logged

| ID | Decision | Rationale |
|---|---|---|
| D-024 | Map-first MVP entry point | Zero Parse.bot cost, zero legal exposure, proves data engine against real users, lower friction than URL paste |
| D-025 | Profile-weighted recompute client-side | Eliminates API roundtrip on profile switch; pillar sub-scores returned with initial GeoJSON tile |
| D-026 | `zone_scores` as nightly materialised view | < 400ms zone load vs > 2s live spatial join; nightly cadence sufficient for QoL data change rate |
| D-027 | GeoJSON tile pre-baked to Supabase Storage | Eliminates per-request query cost; CDN-cached; MapLibre can load directly without API call |
| D-028 | Property pin = coordinate-based analysis, URL optional | Breaks Parse.bot dependency for value delivery; URL paste becomes optional enrichment |
| D-029 | Single pre-baked GeoJSON with boundary + score properties merged (Option A) | Eliminates client-side join complexity; single CDN fetch; simpler MapLibre source |
| D-030 | User-drawn polygon deferred to Phase 3 | Radius slider covers 90% of use cases; drawing tool adds significant UX and build complexity |
| D-031 | Flood zones use Polygon primitive — never choropleth, never heatmap | Flood risk has a precise legal boundary; gradient approximation is misleading and potentially harmful |
| D-032 | Two-level truth: zone choropleth for discovery, pin point-in-polygon for decision | Zone aggregates are appropriate for area comparison; only exact polygon intersection is appropriate for property decisions; UI copy must make this distinction explicit |
