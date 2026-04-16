# Qolify — QoL Enrichment Layer
**Specification v1.0 | April 2026**
**Status: In progress — CHI-371 schema migrations applied 2026-04-08**

> **Issue number mapping:** Placeholder numbers CHI-347–CHI-355 used throughout this document were replaced by the actual Linear identifiers on creation. Use the real numbers in all code and conversations:
>
> | Placeholder | Real issue |
> |---|---|
> | CHI-347 (schema) | **CHI-371** |
> | CHI-348 (noise ingest) | **CHI-372** |
> | CHI-349 (school enrichment) | **CHI-373** |
> | CHI-350 (OSM batch ingest) | **CHI-374** |
> | CHI-351 (health waiting) | **CHI-375** |
> | CHI-352 (cost of living) | **CHI-376** |
> | CHI-353 (indicator engine) | **CHI-377** |
> | CHI-354 (frontend) | **CHI-378** |
> | CHI-355 (zone refresh/map) | **CHI-379** |

This document specifies all new and enriched quality-of-life data layers identified for addition to the Qolify intelligence platform. It covers: new database schema, data sources and ingestion scripts, indicator formula changes, and frontend display components. It is structured to be translated directly into Linear issues.

See also: `INDICATORS.md`, `DATA_SOURCES.md`, `SCHEMA.md`, `DECISIONS.md`

---

## Decision Log Entries Required

Before implementation begins, the following decisions must be logged in `DECISIONS.md`:

**D-024** — QoL Enrichment Layer adopted as Phase 2 extension workstream. All new tables, indicators, and UI components specified in `QOL_ENRICHMENT.md` are authoritative. Existing `INDICATORS.md`, `SCHEMA.md`, and `DATA_SOURCES.md` must be updated to reflect all additions from this document before CHI-371 (schema migrations) build begins.

**D-025** — Noise pollution data sourced from EEA Strategic Noise Maps (already referenced in DATA_SOURCES.md as `noise_zones` table) as primary, supplemented by ENAIRE airport-specific contours. A single `noise_zones` PostGIS table stores both road/rail and airport polygons with a `source_type` discriminator column.

**D-026** — School enrichment uses LOMCE/regional diagnostic test scores where available (Andalucía, Madrid, Cataluña have published microdata). Bilingual school status scraped from BuscaColegio extended attributes. Where test data is unavailable, the `education_quality_score` field is NULL and the UI displays "Quality data not yet available for this region" — never a fabricated score.

**D-027** — Cost of living proxies use Numbeo API at city level (not postcode) for café/restaurant price indices, combined with OSM supermarket operator taxonomy as a neighbourhood-level granularity supplement. Numbeo data is refreshed quarterly. City-level granularity is clearly disclosed in the UI.

---

## Summary of All Changes

| # | Change Type | Description | Affects |
|---|---|---|---|
| E-01 | New table + ingest | Noise zones (road, rail, airport) | Community Stability Score |
| E-02 | Enrich existing table | School quality scores + bilingual flag | Education Opportunity Score |
| E-03 | New table + ingest | Beach and natural water proximity | Expat Liveability, new sub-score |
| E-04 | New table + ingest | Pedestrian zones + cycling infrastructure | New: Daily Life Score |
| E-05 | Enrich existing table | Free parking zones from OSM | New: Daily Life Score |
| E-06 | New table + ingest | Green space quality (area + accessibility) | New: Daily Life Score |
| E-07 | New ingest | Health waiting times (MSCBS quarterly) | Health Security Score |
| E-08 | New table + ingest | Cost of living proxies (Numbeo + OSM) | New: Cost of Life Index |
| E-09 | Synthesised | Walkability Score (from existing data) | New: Daily Life Score |
| E-10 | Synthesised | Car Dependency Index (from existing data) | New: Daily Life Score |
| E-11 | Synthesised | Noise Façade Orientation (existing data) | Community Stability Score |
| E-12 | New composite indicator | Daily Life Score (E-04, E-05, E-06, E-09, E-10) | TVI Pillar: Community |
| E-13 | New composite indicator | Sensory Environment Score (E-01, air quality, green) | TVI Pillar: Environmental |
| E-14 | New composite indicator | Cost of Life Index (E-08) | TVI Pillar: Market |
| E-15 | Frontend | New UI components for all new indicators | DNA Report + Map |

---

## Part 1 — Database Schema Changes

### 1.1 New Table: `noise_zones`

```sql
CREATE TABLE noise_zones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  geom            GEOGRAPHY(MULTIPOLYGON, 4326) NOT NULL,
  source_type     TEXT NOT NULL CHECK (source_type IN ('road', 'rail', 'airport', 'industry')),
  lden_band       TEXT NOT NULL CHECK (lden_band IN ('55-60', '60-65', '65-70', '70-75', '75+')),
  lden_min        SMALLINT NOT NULL,  -- dB lower bound
  lden_max        SMALLINT,           -- dB upper bound (NULL = 75+)
  source          TEXT DEFAULT 'eea', -- 'eea' | 'enaire' | 'mitma'
  agglomeration   TEXT,               -- e.g. 'Madrid', 'Barcelona'
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX noise_zones_geom_idx ON noise_zones USING GIST (geom);
```

**Usage:** PostGIS `ST_Intersects(property_point, noise_zones.geom)` returns the noise band at a property's coordinates. Where multiple polygons overlap (road + airport), return the highest `lden_min`.

---

### 1.2 Schema Additions: `schools` table enrichment

```sql
ALTER TABLE schools ADD COLUMN IF NOT EXISTS
  bilingual_languages   TEXT[],           -- e.g. ['es', 'en'] or ['es', 'fr']
  diagnostic_score      DECIMAL(5,2),     -- 0-100, from LOMCE/regional test data
  diagnostic_year       SMALLINT,         -- year of test data
  diagnostic_source     TEXT,             -- 'lomce' | 'evaluacion_diagnostico_and' | etc.
  teacher_ratio         DECIMAL(4,2),     -- pupils per teacher
  etapas_range          TEXT,             -- 'infantil-bachillerato' | 'primaria' | etc.
  year_founded          SMALLINT,
  has_canteen           BOOLEAN DEFAULT FALSE,
  has_sports_facilities BOOLEAN DEFAULT FALSE;
```

---

### 1.3 New Table: `beaches`

```sql
CREATE TABLE beaches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          TEXT,
  lat             DECIMAL(10,7),
  lng             DECIMAL(10,7),
  geom            GEOGRAPHY(POINT, 4326),
  beach_type      TEXT CHECK (beach_type IN ('urban', 'natural', 'cala', 'lake', 'river')),
  length_m        INTEGER,
  is_blue_flag    BOOLEAN DEFAULT FALSE,
  blue_flag_year  SMALLINT,
  municipio       TEXT,
  provincia       TEXT,
  osm_id          TEXT UNIQUE,
  source          TEXT DEFAULT 'osm',
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX beaches_geom_idx ON beaches USING GIST (geom);
```

---

### 1.4 New Table: `pedestrian_cycling_zones`

```sql
CREATE TABLE pedestrian_cycling_zones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  geom        GEOGRAPHY(MULTILINESTRING, 4326) NOT NULL,  -- line network
  zone_type   TEXT NOT NULL CHECK (zone_type IN (
                'pedestrian_street',
                'pedestrian_zone',     -- full plaza / zona peatonal
                'cycle_lane',          -- painted lane on road
                'cycle_track',         -- segregated path
                'cycle_path',          -- off-road path
                'shared_path'          -- pedestrian + cycle shared
              )),
  surface     TEXT,                    -- 'asphalt' | 'cobblestone' | 'gravel' | etc.
  municipio   TEXT,
  osm_id      TEXT UNIQUE,
  source      TEXT DEFAULT 'osm',
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX pedcycle_geom_idx ON pedestrian_cycling_zones USING GIST (geom);
```

---

### 1.5 Schema Additions: `amenities` table (parking + green space)

New OSM categories to add to existing `amenities` ingest:

```sql
-- New categories added to existing amenities table:
-- category = 'parking_free'         (OSM: amenity=parking + fee=no)
-- category = 'parking_paid'         (OSM: amenity=parking + fee=yes)
-- category = 'park'                 (OSM: leisure=park — already present, enrich with area_sqm)
-- category = 'playground'           (OSM: leisure=playground)
-- category = 'sports_area'          (OSM: leisure=pitch, leisure=sports_centre)
-- category = 'market'               (OSM: amenity=marketplace)
-- category = 'coworking'            (OSM: office=coworking — already referenced, ensure ingested)
-- category = 'beach_access'         (OSM: natural=beach access path)

-- Add area_sqm to amenities for parks/green spaces:
ALTER TABLE amenities ADD COLUMN IF NOT EXISTS
  area_sqm    INTEGER,    -- for parks, sports areas, plazas
  fee         TEXT,       -- 'free' | 'paid' | 'unknown' (for parking)
  osm_id      TEXT UNIQUE;
```

---

### 1.6 New Table: `health_waiting_times`

```sql
CREATE TABLE health_waiting_times (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  health_area_code      TEXT NOT NULL,   -- Zona Básica de Salud code
  health_area_name      TEXT,
  comunidad_autonoma    TEXT NOT NULL,
  avg_days_gp           DECIMAL(4,1),    -- avg wait for GP appointment (days)
  avg_days_specialist   DECIMAL(4,1),    -- avg wait for specialist referral (days)
  avg_days_surgery      DECIMAL(5,1),    -- surgical waiting list average (days)
  surgery_waiting_list  INTEGER,         -- total patients on surgical list
  recorded_quarter      DATE NOT NULL,   -- e.g. 2026-01-01 = Q1 2026
  source                TEXT DEFAULT 'mscbs',
  source_url            TEXT,
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT health_waiting_times_area_quarter_unique UNIQUE (health_area_code, recorded_quarter)
);
```

---

### 1.7 New Table: `cost_of_living`

```sql
CREATE TABLE cost_of_living (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio               TEXT,
  ciudad                  TEXT NOT NULL,   -- Numbeo uses city names, not INE codes
  provincia               TEXT,
  coffee_eur              DECIMAL(4,2),    -- espresso in city-centre café
  beer_eur                DECIMAL(4,2),    -- 330ml beer in local bar
  meal_cheap_eur          DECIMAL(5,2),    -- inexpensive restaurant, 1 person
  meal_midrange_eur       DECIMAL(6,2),    -- mid-range restaurant, 2 persons
  grocery_index           DECIMAL(5,2),    -- Numbeo grocery index (100 = global avg)
  supermarket_premium_pct DECIMAL(4,1),   -- % of nearby supermarkets that are premium tier
  supermarket_discount_pct DECIMAL(4,1),  -- % that are discount tier (Lidl, Aldi, Dia)
  source                  TEXT DEFAULT 'numbeo',
  recorded_quarter        DATE NOT NULL,
  updated_at              TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT col_city_quarter_unique UNIQUE (ciudad, recorded_quarter)
);
```

---

### 1.8 New Materialized View: `zone_enrichment_scores`

Pre-computed per-postcode enrichment scores used by the DNA report and Map Explorer. Refreshed nightly.

```sql
CREATE MATERIALIZED VIEW zone_enrichment_scores AS
SELECT
  cp.codigo_postal,
  cp.municipio,

  -- Noise
  AVG(CASE WHEN nz.lden_min IS NOT NULL THEN nz.lden_min ELSE 40 END)  AS avg_noise_lden,
  MAX(nz.lden_min)                                                       AS max_noise_lden,

  -- Green space
  COUNT(a.id) FILTER (WHERE a.category = 'park')                         AS park_count_500m,
  SUM(a.area_sqm) FILTER (WHERE a.category = 'park')                     AS park_area_sqm_500m,
  COUNT(a.id) FILTER (WHERE a.category = 'playground')                   AS playground_count_500m,

  -- Active mobility
  COUNT(pcz.id) FILTER (WHERE pcz.zone_type LIKE 'pedestrian%')          AS pedestrian_features_500m,
  COUNT(pcz.id) FILTER (WHERE pcz.zone_type LIKE 'cycle%')               AS cycle_features_500m,

  -- Parking
  COUNT(a.id) FILTER (WHERE a.category = 'parking_free')                 AS free_parking_count_1km,

  -- Beach
  MIN(ST_Distance(cp.centroid, b.geom))                                   AS nearest_beach_m,

  -- Schools enriched
  AVG(s.diagnostic_score)                                                  AS school_avg_diagnostic,
  COUNT(s.id) FILTER (WHERE s.bilingual_languages IS NOT NULL)            AS bilingual_schools_1km,

  -- Markets
  COUNT(a.id) FILTER (WHERE a.category = 'market')                        AS market_count_1km

FROM postal_zones cp
LEFT JOIN noise_zones nz ON ST_Intersects(cp.centroid, nz.geom)
LEFT JOIN amenities a ON ST_DWithin(cp.centroid, a.geom, 500)
LEFT JOIN pedestrian_cycling_zones pcz ON ST_DWithin(cp.centroid, pcz.geom, 500)
LEFT JOIN beaches b ON TRUE  -- distance-only join; no spatial filter
LEFT JOIN schools s ON ST_DWithin(cp.centroid, s.geom, 1000)
GROUP BY cp.codigo_postal, cp.municipio, cp.centroid;

CREATE UNIQUE INDEX zone_enrichment_scores_cp_idx ON zone_enrichment_scores (codigo_postal);
```

---

## Part 2 — Data Sources and Ingestion Scripts

### E-01: Noise Zones

**Source 1 — EEA Strategic Noise Maps**
- URL: `https://www.eea.europa.eu/data-and-maps/data/noise-observations-mapping-6`
- Format: Shapefile / GeoPackage download
- Coverage: All Spanish agglomerations >100k population + major roads + rail lines
- Ingest method: `ogr2ogr` one-time national load → PostGIS `noise_zones`
- Bands available: Lden 55-60, 60-65, 65-70, 70-75, 75+ dB
- Refresh: Annual (EU reporting cycle)

**Source 2 — ENAIRE Airport Noise Contours**
- URL: `https://www.enaire.es/servicios/medio_ambiente/mapas_de_ruido`
- Format: PDF contour maps (requires digitising) or GIS downloads per airport
- Coverage: All Spanish international airports
- Ingest method: Manual GIS import for top 10 airports; automate remainder
- Refresh: When ENAIRE publishes updates (~every 2 years)

**Ingestion script spec (`scripts/ingest_noise_zones.py`):**
```python
"""
Ingest EEA Strategic Noise Maps for Spain into noise_zones table.

Steps:
1. Download shapefile from EEA Download Service API:
   GET https://discomap.eea.europa.eu/arcgis/rest/services/Noise/...
   Filter: country_code = 'ES'
2. Use ogr2ogr to load into PostGIS staging table
3. Transform to EPSG:4326 (source is typically ETRS89 / EPSG:25830)
4. Classify lden_band from polygon attribute field
5. UPSERT into noise_zones, deduplicate by geometry hash
6. Refresh zone_enrichment_scores materialized view

Run: python scripts/ingest_noise_zones.py --country ES --year 2022
"""
```

---

### E-02: School Quality Enrichment

**Source 1 — BuscaColegio extended attributes**
- URL: `https://www.educacion.gob.es/centros/buscarCentros.do`
- Fields to add: bilingual programme, languages offered, comedor, sports facilities
- Method: Extend existing BuscaColegio scraper (CHI-317 or equivalent) to capture additional fields
- Refresh: Quarterly (same cycle as existing school ingest)

**Source 2 — Andalucía Evaluación de Diagnóstico**
- URL: `https://www.juntadeandalucia.es/educacion/portals/web/ced/evaluacion-diagnostico`
- Fields: school-level test results by competency area (Matemáticas, Lengua, etc.)
- Method: Download annual Excel/CSV → match to schools by centre code (código de centro)
- Refresh: Annual (results published ~June each year)

**Source 3 — Madrid Resultados Escolares**
- URL: `https://www.comunidad.madrid/servicios/educacion/resultados-evaluacion-diagnostico`
- Method: Annual CSV download, join to schools by centro code
- Refresh: Annual

**Source 4 — MEC Teacher ratio microdata**
- URL: `https://www.educacion.gob.es/educabase/` (Estadística de la enseñanza)
- Fields: alumnos/profesor ratio by school type and province
- Method: CSV download (province-level average, not per-school — use as fallback)
- Refresh: Annual

**Ingestion script spec (`scripts/enrich_schools.py`):**
```python
"""
Enrich existing schools table with quality indicators.

Steps:
1. Load BuscaColegio HTML for each school (batch by province)
   Extract: bilingual_languages, has_canteen, has_sports_facilities
2. Download Andalucía Evaluación Diagnóstico CSV
   Match by 'Código de Centro' → schools.source_id
   UPDATE schools SET diagnostic_score, diagnostic_year, diagnostic_source
3. Download Madrid diagnostic results (same pattern)
4. For schools without per-school data, set diagnostic_score = NULL
   (UI will show "Quality data not available for this region")

Run: python scripts/enrich_schools.py --region andalucia
     python scripts/enrich_schools.py --region madrid
"""
```

---

### E-03: Beaches

**Source — OpenStreetMap Overpass API**
- Query: `natural=beach` and `natural=coastline` waypoints/areas across Spain
- Also: ADEAC Blue Flag certified beaches list (already referenced in DATA_SOURCES.md)
- Method: Overpass QL batch query, parse geometry centroids → `beaches` table
- Refresh: Annual (beaches don't move; Blue Flag status annual)

**Overpass query:**
```
[out:json][timeout:120];
area["name"="España"]["boundary"="administrative"]->.searchArea;
(
  way["natural"="beach"](area.searchArea);
  node["natural"="beach"](area.searchArea);
  relation["natural"="beach"](area.searchArea);
);
out center tags;
```

**Ingestion script spec (`scripts/ingest_beaches.py`):**
```python
"""
Ingest Spanish beaches from OSM into beaches table.

Steps:
1. Run Overpass QL query above
2. For each result: extract centre coordinate, name, municipio from address reverse-geocode
3. Match to ADEAC Blue Flag CSV (annual download from https://www.adeac.es/playas-certificadas)
   SET is_blue_flag = TRUE, blue_flag_year for matched beaches
4. UPSERT beaches table by osm_id
5. Estimate length_m from way geometry where available
"""
```

---

### E-04 + E-05: Pedestrian Zones, Cycling Infrastructure, Parking

**Source — OpenStreetMap Overpass API**

**Pedestrian query:**
```
[out:json][timeout:180];
area["name"="España"]["boundary"="administrative"]->.searchArea;
(
  way["highway"="pedestrian"](area.searchArea);
  way["highway"="living_street"](area.searchArea);
  relation["highway"="pedestrian"](area.searchArea);
  area["landuse"="pedestrian"](area.searchArea);
);
out geom;
```

**Cycling query:**
```
(
  way["highway"="cycleway"](area.searchArea);
  way["cycleway"="lane"](area.searchArea);
  way["cycleway"="track"](area.searchArea);
  way["cycleway"="shared_lane"](area.searchArea);
);
out geom;
```

**Parking query:**
```
(
  node["amenity"="parking"](area.searchArea);
  way["amenity"="parking"](area.searchArea);
);
out center tags;
-- Then filter: fee=no → parking_free, fee=yes → parking_paid
```

**Ingestion script spec (`scripts/ingest_active_mobility.py`):**
```python
"""
Ingest pedestrian zones, cycling infrastructure, and parking from OSM.

Steps:
1. Run each Overpass query above
2. Parse GeoJSON LineStrings/Polygons → WKT for PostGIS insert
3. Classify zone_type from OSM highway/cycleway tags
4. INSERT INTO pedestrian_cycling_zones with ST_GeomFromText
5. For parking: UPSERT amenities with category='parking_free' or 'parking_paid'
   SET fee from OSM tag; SET area_sqm from polygon area where available
6. Refresh zone_enrichment_scores materialized view

Run: python scripts/ingest_active_mobility.py
"""
```

---

### E-06: Green Space Quality

**Source — OpenStreetMap (extend existing amenities ingest)**

Extend the existing OSM amenities ingest (weekly job) to:
- Capture `area_sqm` for `leisure=park`, `leisure=garden`, `leisure=pitch` features
- Add `leisure=playground` as new category
- Calculate park area from OSM polygon geometry before point conversion

No new table required. Additions to existing `amenities` table and `ingest_amenities.py` script.

---

### E-07: Health Waiting Times

**Source — MSCBS Lista de Espera Quirúrgica**
- URL: `https://www.mscbs.gob.es/estadEstudios/estadisticas/inforRecopilaciones/listaEspera.htm`
- Format: Excel/CSV, published quarterly by Comunidad Autónoma
- Fields available: Zona de Salud, patients on surgical list, mean wait days
- Note: GP appointment wait times are NOT published nationally — only surgical list data is standardised

**Supplementary source — regional health portals:**
- Andalucía: `https://www.sspa.juntadeandalucia.es` — tiempos de espera por área
- Madrid: `https://www.comunidad.madrid/servicios/salud` — espera media consulta
- Both publish GP wait averages at área de salud level

**Ingestion script spec (`scripts/ingest_health_waiting.py`):**
```python
"""
Ingest health waiting time data from MSCBS and regional portals.

Steps:
1. Download MSCBS quarterly Excel from URL above
2. Parse: health_area_code, avg_days_surgery, surgery_waiting_list per CCAA
3. Download Andalucía and Madrid supplementary GP wait data
4. Match health_area_code to health_centres via municipio/zona de salud lookup
5. UPSERT health_waiting_times by (health_area_code, recorded_quarter)

Run: python scripts/ingest_health_waiting.py --quarter 2026-Q1
Note: MSCBS Excel URL changes each quarter — confirm URL before run.
      Store confirmed URL in DATA_SOURCES.md each quarter.
"""
```

---

### E-08: Cost of Living

**Source 1 — Numbeo API**
- URL: `https://www.numbeo.com/api/`
- Endpoint: `/city_prices?api_key=YOUR_KEY&query=Malaga&country=Spain`
- Items relevant: coffee (item 114), beer local (item 6), meal cheap (item 1), meal midrange (item 2)
- Tier: Numbeo API requires a paid key (~$50/month for commercial use)
- Alternative for MVP: Scrape Numbeo HTML for top 30 Spanish cities (terms of service: verify before scraping)
- Refresh: Quarterly

**Source 2 — OSM supermarket operator taxonomy**
- Premium operators (El Corte Inglés, Supercor, Mercadona, Carrefour): OSM `shop=supermarket` + `operator` tag
- Discount operators (Lidl, Aldi, Día, Consum discount): same tag
- Method: Extend existing amenities ingest to capture `operator` field for supermarkets
- Derive `supermarket_premium_pct` and `supermarket_discount_pct` per postcode from `zone_enrichment_scores` view

**Ingestion script spec (`scripts/ingest_cost_of_living.py`):**
```python
"""
Ingest cost of living data from Numbeo + OSM supermarket data.

Steps:
1. For each city in TOP_30_SPANISH_CITIES list:
   GET https://www.numbeo.com/api/city_prices?api_key=KEY&query={city}&country=Spain
   Extract: coffee_eur, beer_eur, meal_cheap_eur, meal_midrange_eur, grocery_index
2. Match Numbeo city name to municipio via lookup table (Numbeo uses anglicised names)
3. UPSERT cost_of_living by (ciudad, recorded_quarter)
4. OSM supermarket tier classification:
   PREMIUM_OPERATORS = ['el corte ingles', 'supercor', 'el corte inglés market']
   DISCOUNT_OPERATORS = ['lidl', 'aldi', 'dia', 'dia%', 'consum', 'simply']
   Calculate pct breakdown per codigo_postal from amenities where category='supermarket'

TOP_30_SPANISH_CITIES = [
  'Madrid', 'Barcelona', 'Valencia', 'Sevilla', 'Zaragoza', 'Malaga',
  'Murcia', 'Palma', 'Las Palmas', 'Bilbao', 'Alicante', 'Cordoba',
  'Valladolid', 'Vigo', 'Gijon', 'Granada', 'Vitoria', 'La Coruna',
  'Elche', 'Santa Cruz de Tenerife', 'Oviedo', 'Badalona', 'Cartagena',
  'Terrassa', 'Jerez de la Frontera', 'Sabadell', 'Mostoles', 'Alcala de Henares',
  'Pamplona', 'Fuenlabrada'
]
"""
```

---

## Part 3 — Indicator Formula Changes

### Indicator 4 — Health Security Score (updated)

**New inputs added:**
- `health_waiting_times.avg_days_gp` for nearest health area
- `health_waiting_times.avg_days_specialist`

**Updated formula:**
```python
gp_score      = distance_to_score(gp_dist_m, optimal=300, max=3000)
er_score      = distance_to_score(er_dist_m, optimal=1000, max=8000)
pharm_score   = min(pharmacy_count_500m * 25, 100)

# New: waiting time penalty (if data available)
if avg_days_gp is not None:
    wait_score = max(0, 100 - (avg_days_gp * 8))  # 0 days = 100, 12+ days = 4
else:
    wait_score = 60  # neutral assumption when data unavailable

health_security = (gp_score * 0.35) + (er_score * 0.35) + (pharm_score * 0.15) + (wait_score * 0.15)
```

**New output fields:**
- `avg_days_gp_wait`: decimal (displayed as "~X day wait for GP appointment")
- `avg_days_specialist_wait`: decimal (displayed in report)

---

### Indicator 5 — Education Opportunity Score (updated)

**New inputs added:**
- `schools.diagnostic_score` (0-100, from regional test data)
- `schools.bilingual_languages` (array)

**Updated formula:**
```python
public_score      = min(public_schools_1km * 20, 60)
concertado_score  = min(concertado_1km * 15, 30)
private_score     = min(private_1km * 10, 20)
catchment_bonus   = 15 if in_catchment else 0

# Updated quality scoring
if diagnostic_scores_available:
    quality_bonus = avg_diagnostic_score_1km * 0.10  # up to 10 pts for top schools
else:
    quality_bonus = 0

bilingual_bonus   = min(bilingual_schools_1km * 8, 16)  # up to 16 pts

edu_score = min(
    public_score + concertado_score + private_score +
    catchment_bonus + quality_bonus + bilingual_bonus, 100
)
```

**New output fields:**
- `bilingual_schools_1km`: integer
- `avg_diagnostic_score_1km`: decimal (NULL if no data)
- `diagnostic_data_available`: boolean

---

### Indicator 7 — Community Stability Score (updated)

**New inputs added:**
- `noise_zones` — Lden dB at property coordinates (replaces placeholder `noise_score`)
- Building façade noise exposure (derived: facing road type from OSM)

**Updated formula:**
```python
vut_score     = 100 - min(vut_density_pct * 2, 100)
dom_stability = 100 - normalise(dom_variance_12m, national_min, national_max)
commerce_age  = normalise(avg_amenity_age_months, min=0, max=60)

# Updated noise scoring — now uses real EEA data
if noise_lden is not None:
    noise_score = max(0, 100 - ((noise_lden - 40) * 4))
    # 40dB = 100 (quiet countryside), 65dB = 0 (busy road)
else:
    noise_score = 70  # neutral default (most residential areas)

community_stability = (
    vut_score     * 0.40 +
    dom_stability * 0.20 +
    commerce_age  * 0.20 +
    noise_score   * 0.20
)
```

---

### New Composite Indicator 16 — Daily Life Score

**Tier:** 1 (no historical data needed)
**TVI Pillar:** Community

**What it tells the user:** Whether this location supports a walkable, car-optional daily life — a question that portals never answer and that determines daily quality of life more than almost any other factor.

**Inputs:**
- Amenity counts within 400m (pharmacy, supermarket, café, GP) from `amenities`
- Pedestrian features within 500m — count from `pedestrian_cycling_zones`
- Cycle infrastructure within 500m — count from `pedestrian_cycling_zones`
- Free parking within 1km — count from `amenities` where `category='parking_free'`
- Nearest beach distance — from `beaches` (optional component, ICP-weighted)
- Nearest park area_sqm within 500m — from `amenities`

**Formula:**
```python
# Walkability sub-score
daily_needs_400m = count of {pharmacy, supermarket, cafe, gp} within 400m
walk_score = min(daily_needs_400m * 15, 60)

# Active mobility sub-score
ped_score  = min(pedestrian_features_500m * 5, 20)
cycle_score = min(cycle_features_500m * 3, 20)
mobility_score = ped_score + cycle_score  # 0-40

# Green space sub-score
green_score = min((park_area_sqm_500m / 1000) * 10, 20)
# 2000 sqm of park within 500m = 20 pts

# Parking (inverts for car-optional users; preserved for car-dependent ICPs)
parking_score = min(free_parking_count_1km * 5, 15)

# Beach proximity (weighted for Nomad/Retiree profiles)
if nearest_beach_m is not None:
    beach_score = max(0, 20 - (nearest_beach_m / 250))  # 0m = 20, 5km = 0
else:
    beach_score = 0

# Base score (no ICP weighting)
daily_life_base = (walk_score * 0.40) + (mobility_score * 0.30) + (green_score * 0.20) + (beach_score * 0.10)

# ICP reweighting applied in TVI composition (not here)
```

**Output:**
- `daily_life_score`: 0-100
- `walkability_sub_score`: 0-100
- `nearest_beach_m`: integer (NULL if no beach within 15km)
- `park_area_sqm_500m`: integer
- `free_parking_count_1km`: integer
- `pedestrian_street_count_500m`: integer
- `confidence`: 'high'

---

### New Composite Indicator 17 — Sensory Environment Score

**Tier:** 1 (requires noise + AQI data, both static reference tables)
**TVI Pillar:** Environmental

**What it tells the user:** What this place actually feels and sounds and smells like to live in — the sensory quality of the immediate environment, combining noise, air quality, and green exposure.

**Inputs:**
- `noise_zones` intersection → Lden dB at property point
- `air_quality_readings` — nearest station AQI annual average
- `amenities` park area within 500m

**Formula:**
```python
# Noise component
if noise_lden is not None:
    noise_score = max(0, 100 - ((noise_lden - 35) * 3.5))
    # 35dB (countryside) = 100, 75dB (heavy road) = 0
else:
    noise_score = 65  # urban default assumption

# Air quality component
if aqi_annual_avg is not None:
    aqi_score = max(0, 100 - (aqi_annual_avg * 2))
    # AQI 0 = 100 (perfect air), AQI 50 = 0 (very poor)
else:
    aqi_score = 70  # national average assumption

# Green exposure component
green_ratio = min(park_area_sqm_500m / 5000, 1.0)  # cap at 5000 sqm
green_score = green_ratio * 100

sensory_environment = (
    noise_score * 0.45 +
    aqi_score   * 0.35 +
    green_score * 0.20
)
```

**Output:**
- `sensory_environment_score`: 0-100
- `noise_lden`: integer (displayed: "~55 dB — equivalent to a busy street")
- `aqi_annual_avg`: decimal
- `nearest_green_space_m`: integer
- `confidence`: 'high' if noise data available, 'medium' if AQI only, 'low' if neither

---

### New Composite Indicator 18 — Cost of Life Index

**Tier:** 1
**TVI Pillar:** Market

**What it tells the user:** What daily life actually costs beyond the mortgage — a figure that is invisible on every portal and highly variable across Spanish cities and neighbourhoods.

**Inputs:**
- `cost_of_living` for `ciudad` (matched via `municipio`)
- `amenities` supermarket tier breakdown within 500m (premium vs discount %)

**Formula:**
```python
# Normalise Numbeo coffee price (Spain range: ~€1.20 in Teruel to ~€2.20 in Madrid)
coffee_score = max(0, 100 - ((coffee_eur - 1.0) * 65))

# Grocery affordability
grocery_score = max(0, 100 - (grocery_index - 50))  # Numbeo 100 = global avg; Spain ~75-90

# Supermarket access (discount nearby = lower daily cost)
discount_score = supermarket_discount_pct  # 0-100

col_score = (coffee_score * 0.30) + (grocery_score * 0.40) + (discount_score * 0.30)
```

**Output:**
- `cost_of_life_index`: 0-100 (higher = more affordable daily life)
- `coffee_eur`: decimal (displayed: "Coffee: ~€1.60")
- `beer_eur`: decimal (displayed: "Beer in local bar: ~€2.20")
- `meal_cheap_eur`: decimal
- `grocery_index`: decimal
- `confidence`: 'medium' (city-level, not postcode — disclosed in UI)

---

## Part 4 — Frontend Display Components

### 4.1 Health Security — enriched display

**Current:** "GP 400m · Pharmacy ×3 within 500m · Nearest A&E 2.1km"

**New display (when waiting time data available):**
```
Health Security Score: 78/100

✓ GP Centro de Salud Las Flores — 340m
  ~3 day average appointment wait (Zona Básica de Salud Centro)
✓ Farmacia ×4 within 500m
✓ Urgencias 24h — Hospital Regional — 1.8km
  Average surgical waiting list: 67 days (Andalucía average: 89 days)

[When no waiting time data] Quality note: Appointment wait data not available
for this health area. Distance data only.
```

---

### 4.2 Education Opportunity — enriched display

**Current:** "2 public, 1 concertado within 1km · In catchment zone"

**New display:**
```
Education Score: 82/100

Within your catchment zone:
  CEIP Nuestra Señora del Carmen (public, 380m)
  [★ Bilingual: Spanish/English]
  Diagnostic score: 74/100 (top 28% in Andalucía) — 2024 data

Nearby (1km):
  IES Fernando de los Ríos (secondary, concertado, 720m)
  [★ Bilingual: Spanish/French]
  COLEGIO PRIVADO San José (private, 950m)

[When no diagnostic data] Note: Academic performance data not
yet available for schools in this region.
```

---

### 4.3 New Component: Daily Life Score card

```
Daily Life Score: 71/100

Can you live here without a car?
[●●●●●●●○○○] Mostly yes

  Walkability
  Supermarket 180m · GP 340m · Pharmacy 200m · Café ×7 within 400m

  Active Mobility
  Pedestrian zone 50m · Cycle lane network: 3 routes within 500m

  Green Space
  Parque Central: 4,200 sqm — 220m away
  Playground: 180m

  Free Parking
  3 free public car parks within 1km (for when you do need the car)

  [For Retiree / Nomad profiles, beach row appears here]
  Nearest beach: Playa de la Malagueta — 1.2km
```

---

### 4.4 New Component: Sensory Environment card

```
Sensory Environment Score: 64/100

Noise
  ~58 dB average (Lden) — equivalent to a busy restaurant
  Source: EU Strategic Noise Map 2022
  [A quiet zone would score above 70]

Air Quality
  Annual AQI: 24 (Good)
  PM2.5: 8.2 μg/m³ · NO₂: 18.4 μg/m³
  Nearest station: Alameda Principal (0.8km)

Green Exposure
  440 sqm of accessible park within 500m
  [Low — urban centre. Consider this if you spend time outdoors]
```

---

### 4.5 New Component: Cost of Life card

```
Cost of Life Index: 74/100 — Below average cost city

Daily life costs in Málaga (city-level estimate)

  ☕ Espresso in local café: ~€1.60
  🍺 Beer in local bar: ~€2.20
  🍽  Cheap meal out (1 person): ~€12
  🛒 Groceries: 18% below European average

Nearby supermarkets
  Mercadona (240m) · Lidl (380m) · Carrefour Express (550m)
  Mix: 67% discount/mid-tier · 33% premium

Data source: Numbeo Q1 2026 · City-level estimate, not postcode-specific
```

---

### 4.6 Map Layer Additions (Zone Intelligence Explorer)

New toggles to add to the Map bottom toolbar and left panel layer list:

| Layer | Toggle label | Data source | Visualisation |
|---|---|---|---|
| Noise | Noise | `noise_zones` polygons | Choropleth: grey (quiet) → red (loud) |
| Beach proximity | Beach | `beaches` points | Blue dot markers; distance ring from property pin |
| Pedestrian zones | Walkability | `pedestrian_cycling_zones` | Green line overlay |
| Air quality | Air | `air_quality_readings` | Bubble markers at station locations |
| Daily Life Score | Daily Life | `zone_enrichment_scores` | Choropleth replacing zone score on toggle |

---

## Part 5 — ICP Profile Reweighting

These new indicators affect the ICP profile weighting system in `user_filter_presets`. Suggested default weight adjustments:

| Indicator | Family weight | Nomad weight | Retiree weight | Investor weight |
|---|---|---|---|---|
| Daily Life Score | 1.5× | 1.2× | 1.8× | 0.5× |
| Sensory Environment | 1.2× | 1.0× | 1.5× | 0.3× |
| Cost of Life Index | 1.0× | 1.5× | 1.3× | 0.8× |
| Beach proximity sub-score | 0.5× | 1.8× | 2.0× | 0.4× |
| Bilingual schools | 2.0× | 0.3× | 0.2× | 0.3× |
| Health wait times | 0.8× | 0.5× | 2.0× | 0.3× |

These multipliers are applied to indicator sub-scores before TVI aggregation. They do not change the underlying scores — they change how much each indicator contributes to the final TVI for a given profile.

---

## Part 6 — Linear Issues

The following 9 Linear issues should be created in project Qolify, team Chimeopen.

---

### CHI-347 — Schema migrations: QoL Enrichment Layer tables

**Priority:** High
**Milestone:** Phase 2

**Description:**
Add all new database tables and schema amendments specified in QOL_ENRICHMENT.md Part 1.

**Definition of Done:**
- [ ] `noise_zones` table created with GIST index
- [ ] `schools` table amended with 8 new columns (bilingual_languages, diagnostic_score, etc.)
- [ ] `beaches` table created with GIST index
- [ ] `pedestrian_cycling_zones` table created with GIST index
- [ ] `amenities` table amended with `area_sqm`, `fee`, `osm_id` columns
- [ ] `health_waiting_times` table created
- [ ] `cost_of_living` table created
- [ ] `zone_enrichment_scores` materialised view created
- [ ] All migrations in `/supabase/migrations/` as timestamped `.sql` files
- [ ] `SCHEMA.md` updated to reflect all additions
- [ ] Migrations tested against Supabase staging branch before merge

---

### CHI-348 — Ingest: Noise zones (EEA + ENAIRE)

**Priority:** High
**Milestone:** Phase 2
**Blocked by:** CHI-347

**Description:**
Implement `scripts/ingest_noise_zones.py` as specified in QOL_ENRICHMENT.md E-01.

**Definition of Done:**
- [ ] Script downloads EEA Strategic Noise shapefile for Spain
- [ ] `ogr2ogr` transform from ETRS89 to WGS84 (EPSG:4326)
- [ ] All five Lden bands loaded into `noise_zones` with correct `lden_band` and `source_type`
- [ ] ENAIRE airport contours loaded for the 5 busiest Spanish airports (MAD, BCN, AGP, PMI, ALC)
- [ ] PostGIS spatial index confirmed working (query: `ST_Intersects(point, geom)` returns <50ms)
- [ ] Row counts logged and validated (expect 5,000–15,000 polygons nationally)
- [ ] `DATA_SOURCES.md` updated with confirmed source URLs and ingest date
- [ ] Supabase cron job scheduled: annual refresh

---

### CHI-349 — Ingest: School quality enrichment

**Priority:** High
**Milestone:** Phase 2
**Blocked by:** CHI-347

**Description:**
Implement `scripts/enrich_schools.py` to add quality data to existing `schools` table. Spec in QOL_ENRICHMENT.md E-02.

**Definition of Done:**
- [ ] BuscaColegio scraper extended to capture `bilingual_languages`, `has_canteen`, `has_sports_facilities`
- [ ] Andalucía Evaluación Diagnóstico CSV downloaded and matched to schools by código de centro
- [ ] Madrid diagnostic results matched and loaded
- [ ] `diagnostic_score`, `diagnostic_year`, `diagnostic_source` populated where available
- [ ] NULL preserved (not fabricated) where regional data unavailable
- [ ] At least 70% of Andalucía and Madrid schools have `bilingual_languages` populated
- [ ] `DATA_SOURCES.md` updated with confirmed source URLs

---

### CHI-350 — Ingest: Beaches, pedestrian zones, cycling, parking (OSM batch)

**Priority:** Medium
**Milestone:** Phase 2
**Blocked by:** CHI-347

**Description:**
Three Overpass API ingest scripts as specified in QOL_ENRICHMENT.md E-03, E-04, E-05.

**Definition of Done:**
- [ ] `scripts/ingest_beaches.py` loads `beaches` table from OSM + ADEAC Blue Flag CSV
- [ ] `scripts/ingest_active_mobility.py` loads `pedestrian_cycling_zones` with correct `zone_type` classification
- [ ] Parking UPSERT adds `parking_free` and `parking_paid` categories to `amenities`
- [ ] Green space `area_sqm` populated for `park` amenities from OSM polygon geometry
- [ ] `osm_id` populated on amenities to enable deduplication
- [ ] All three scripts runnable independently with `--region` flag for partial national loads
- [ ] Row counts reasonable: >3,000 beaches, >50,000 pedestrian/cycle features
- [ ] Supabase cron: weekly refresh (same cadence as existing amenities job)

---

### CHI-351 — Ingest: Health waiting times (MSCBS quarterly)

**Priority:** Medium
**Milestone:** Phase 2
**Blocked by:** CHI-347

**Description:**
Implement `scripts/ingest_health_waiting.py` as specified in QOL_ENRICHMENT.md E-07.

**Definition of Done:**
- [ ] Script downloads MSCBS surgical waiting list Excel (confirm URL each quarter — document in code)
- [ ] Andalucía and Madrid GP wait time supplements downloaded and parsed
- [ ] `health_waiting_times` populated with Q1 2026 data as baseline
- [ ] `health_area_code` matches to municipios in `health_centres` table (lookup table provided in script)
- [ ] Quarterly reminder created in Linear (search alert or recurring issue) to re-run before each quarter
- [ ] Where data is NULL, indicator engine falls back to neutral 60/100 assumption (documented in INDICATORS.md)

---

### CHI-352 — Ingest: Cost of living (Numbeo + OSM supermarket tiers)

**Priority:** Medium
**Milestone:** Phase 2
**Blocked by:** CHI-347

**Description:**
Implement `scripts/ingest_cost_of_living.py` as specified in QOL_ENRICHMENT.md E-08.

**Definition of Done:**
- [ ] Numbeo API key confirmed and stored in Supabase Vault (not in code)
- [ ] Top 30 Spanish cities loaded with coffee, beer, meal, grocery_index
- [ ] OSM supermarket operator taxonomy implemented (PREMIUM_OPERATORS and DISCOUNT_OPERATORS lists)
- [ ] `supermarket_premium_pct` and `supermarket_discount_pct` computed per postcode in `zone_enrichment_scores`
- [ ] City-to-municipio lookup table verified for all 30 cities
- [ ] Quarterly cron job scheduled
- [ ] City-level granularity limitation documented in UI copy (not hidden from users)

---

### CHI-353 — Indicator engine: New indicators 16, 17, 18 + formula updates

**Priority:** High
**Milestone:** Phase 2
**Blocked by:** CHI-347, CHI-348, CHI-349, CHI-350

**Description:**
Implement three new composite indicators (Daily Life Score, Sensory Environment Score, Cost of Life Index) and update formulas for Indicators 4, 5, and 7 as specified in QOL_ENRICHMENT.md Part 3.

**TypeScript interfaces (for Edge Function):**

```typescript
interface DailyLifeScore {
  score: number;           // 0-100
  walkability_sub: number; // 0-100
  nearest_beach_m: number | null;
  park_area_sqm_500m: number;
  free_parking_count_1km: number;
  pedestrian_count_500m: number;
  confidence: 'high' | 'medium';
}

interface SensoryEnvironmentScore {
  score: number;           // 0-100
  noise_lden: number | null;  // dB Lden
  aqi_annual_avg: number | null;
  nearest_green_m: number | null;
  confidence: 'high' | 'medium' | 'low';
}

interface CostOfLifeIndex {
  score: number;           // 0-100
  coffee_eur: number | null;
  beer_eur: number | null;
  meal_cheap_eur: number | null;
  grocery_index: number | null;
  supermarket_discount_pct: number | null;
  confidence: 'medium';   // always medium — city-level data
}
```

**SQL queries required:**
```sql
-- Noise at property point
SELECT lden_min, lden_band, source_type
FROM noise_zones
WHERE ST_Intersects(ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, geom)
ORDER BY lden_min DESC LIMIT 1;

-- Nearest beach
SELECT nombre, ST_Distance(geom, ST_MakePoint(:lng, :lat)::geography) AS dist_m
FROM beaches
ORDER BY geom <-> ST_MakePoint(:lng, :lat)::geography
LIMIT 1;

-- Pedestrian / cycle features within 500m
SELECT zone_type, COUNT(*) as count
FROM pedestrian_cycling_zones
WHERE ST_DWithin(geom, ST_MakePoint(:lng, :lat)::geography, 500)
GROUP BY zone_type;

-- Green space within 500m
SELECT SUM(area_sqm) as total_sqm, MIN(ST_Distance(geom, ST_MakePoint(:lng, :lat)::geography)) as nearest_m
FROM amenities
WHERE category = 'park'
AND ST_DWithin(geom, ST_MakePoint(:lng, :lat)::geography, 500);

-- Cost of living for municipio
SELECT coffee_eur, beer_eur, meal_cheap_eur, grocery_index
FROM cost_of_living
WHERE municipio = :municipio
ORDER BY recorded_quarter DESC LIMIT 1;
```

**Definition of Done:**
- [ ] `calc_daily_life_score()` function implemented and unit tested
- [ ] `calc_sensory_environment_score()` implemented and unit tested
- [ ] `calc_cost_of_life_index()` implemented and unit tested
- [ ] `calc_health_security()` updated with waiting time inputs
- [ ] `calc_education_opportunity()` updated with diagnostic + bilingual inputs
- [ ] `calc_community_stability()` updated with real `noise_lden` from `noise_zones`
- [ ] All three new indicator results stored in `analysis_cache.composite_indicators` JSONB
- [ ] Graceful fallback when any data source returns NULL (neutral scores, not errors)
- [ ] `INDICATORS.md` updated with final formulas

---

### CHI-354 — Frontend: QoL enrichment display components

**Priority:** Medium
**Milestone:** Phase 2
**Blocked by:** CHI-353

**Description:**
Build new and updated DNA Report display components for all QoL enrichment indicators, as specified in QOL_ENRICHMENT.md Part 4.

**Components required:**

1. **`HealthSecurityCard` (update)** — Add waiting time row. Show "~X day wait" when data available; show "Wait data unavailable" in slate/muted style when NULL.

2. **`EducationOpportunityCard` (update)** — Add bilingual badge (small pill: "🌐 Bilingual ES/EN") next to school name. Add diagnostic score bar (thin, 0-100, with "Top X% in [region]" label). When no diagnostic data: "Academic data not available for this region" in muted text.

3. **`DailyLifeScoreCard` (new)** — Full card with walkability headline, sub-rows for mobility/green/parking/beach. Car-optional verdict text ("Mostly yes / Partially / You'll need a car"). Uses emerald for good scores, terracotta for low.

4. **`SensoryEnvironmentCard` (new)** — Three sub-rows: Noise (dB label + plain-English equivalent), Air Quality (AQI value + category label), Green Exposure (sqm + distance). Noise source attribution line at bottom in caption size.

5. **`CostOfLifeCard` (new)** — Price pill grid (coffee, beer, meal). Supermarket tier bar. "City-level estimate" disclosure in caption. Quarterly data date shown.

6. **Map layer toggles (update)** — Add Noise, Beach, Walkability, Air, Daily Life toggles to Map bottom toolbar per QOL_ENRICHMENT.md section 4.6.

**Design tokens:** Follow DESIGN.md. All new cards use `card_background`, `primary_text`, `secondary_text`. Score rings use `emerald_bright` for scores ≥70, `amber` for 40-69, `terracotta` for <40.

**Definition of Done:**
- [ ] All 5 components built and rendering in DNA Report
- [ ] All components handle NULL data gracefully (no blank cards, always a message)
- [ ] Map layer toggles connected to `zone_enrichment_scores` materialised view
- [ ] Components reviewed against DESIGN.md colour tokens — no hardcoded colours
- [ ] Mobile layout verified (all cards readable at 375px width)

---

### CHI-355 — `zone_enrichment_scores` view: refresh cron + Map integration

**Priority:** Medium
**Milestone:** Phase 2
**Blocked by:** CHI-347, CHI-350

**Description:**
Ensure `zone_enrichment_scores` materialised view refreshes nightly and is connected to the Map Explorer layer system.

**Definition of Done:**
- [ ] Supabase cron job: `REFRESH MATERIALIZED VIEW CONCURRENTLY zone_enrichment_scores` — nightly at 02:00 UTC
- [ ] Map API endpoint `/api/map/zones` extended to include enrichment score fields from the view
- [ ] Zone panel (right slide-in) on Map Explorer shows Daily Life, Sensory, and Cost of Life scores for clicked zone
- [ ] Choropleth fill expression updated to support new layer modes (Noise, Daily Life, Sensory)
- [ ] Performance: zone tile query <200ms with enrichment fields included (index on `codigo_postal` confirmed)

---

## Part 7 — Claude Code Prompt

The following prompt is ready to hand directly to Claude Code in your terminal. Run it from the `/Users/thomascarson/Desktop/Qolify` directory. Work through the issues in dependency order: CHI-347 first, then ingest scripts in parallel, then indicator engine, then frontend.

---

```
You are working on Qolify — a Spanish property intelligence platform. 
The codebase is at the current directory. The stack is: 
Next.js App Router, Supabase (PostgreSQL + PostGIS), 
Supabase Edge Functions (Deno/TypeScript), MapLibre GL JS.

Your task is to implement the QoL Enrichment Layer as specified in 
QOL_ENRICHMENT.md. Work through the following steps in order, 
pausing for confirmation after each one.

Reference documents you must read before starting:
- QOL_ENRICHMENT.md (primary spec for this task)
- SCHEMA.md (existing database schema)
- INDICATORS.md (existing indicator formulas)
- DATA_SOURCES.md (existing data source registry)
- DECISIONS.md (decision log — you must update this)

─────────────────────────────────────────────────────────────
STEP 1 — Schema Migrations (CHI-347)
─────────────────────────────────────────────────────────────

Create the following Supabase migration file:
  /supabase/migrations/[timestamp]_qol_enrichment_layer.sql

The migration must include, in this order:

1. CREATE TABLE noise_zones — exact DDL from QOL_ENRICHMENT.md section 1.1
2. ALTER TABLE schools ADD COLUMN — all 8 columns from section 1.2
3. CREATE TABLE beaches — section 1.3
4. CREATE TABLE pedestrian_cycling_zones — section 1.4
5. ALTER TABLE amenities ADD COLUMN — area_sqm, fee, osm_id from section 1.5
6. CREATE TABLE health_waiting_times — section 1.6
7. CREATE TABLE cost_of_living — section 1.7
8. CREATE MATERIALIZED VIEW zone_enrichment_scores — section 1.8
   (wrap in a DO $$ BEGIN ... EXCEPTION WHEN ... END $$ block so it 
   can run safely if view already exists)
9. All spatial indexes (GIST) immediately after each geometry table

After creating the migration file:
- Update SCHEMA.md to document all new tables and columns
- Do NOT run the migration yet

Pause here and show me the migration file for review.

─────────────────────────────────────────────────────────────
STEP 2 — Ingest Scripts: Noise Zones (CHI-348)
─────────────────────────────────────────────────────────────

After I confirm Step 1, create:
  /scripts/ingest_noise_zones.py

Use the spec in QOL_ENRICHMENT.md section E-01. The script must:
- Accept --country (default 'ES') and --year (default '2022') args
- Download the EEA shapefile via their Download Service API
- Use ogr2ogr to transform from ETRS89 (EPSG:25830) to WGS84 (EPSG:4326)
- Parse lden_band from the shapefile attribute field (check EEA schema — 
  field is typically 'db_low' and 'db_high')
- Use psycopg2 to UPSERT into noise_zones via Supabase connection string
  (read from SUPABASE_DB_URL environment variable — never hardcode)
- Log row counts at completion
- Include a --dry-run flag that prints counts without writing to DB

Separately, create a manual import script for ENAIRE airport contours:
  /scripts/import_enaire_contours.py
  
This script accepts a --geojson flag pointing to a local file 
(since ENAIRE contours require manual download) and loads it into 
noise_zones with source='enaire'.

Pause here and show me both scripts before proceeding.

─────────────────────────────────────────────────────────────
STEP 3 — Ingest Scripts: Schools, Beaches, OSM Mobility (CHI-349, CHI-350)
─────────────────────────────────────────────────────────────

After I confirm Step 2, create three scripts:

3a. /scripts/enrich_schools.py
    Spec: QOL_ENRICHMENT.md section E-02
    - Accept --region flag: 'andalucia' | 'madrid' | 'all'
    - For BuscaColegio enrichment: extend existing scraper pattern 
      to capture bilingual programme fields
    - For diagnostic data: download CSVs, match by código de centro,
      UPDATE schools table
    - Where data is NULL, do NOT update (preserve existing NULLs)
    - Log: X schools updated, Y schools with no data found

3b. /scripts/ingest_beaches.py
    Spec: QOL_ENRICHMENT.md section E-03
    - Run the Overpass QL query in the spec
    - Parse centre coordinates from way/node/relation geometries
    - Download ADEAC Blue Flag CSV and match by beach name + municipio
    - UPSERT beaches table by osm_id

3c. /scripts/ingest_active_mobility.py
    Spec: QOL_ENRICHMENT.md sections E-04 and E-05
    - Run pedestrian, cycling, and parking Overpass queries
    - Load pedestrian_cycling_zones table from pedestrian + cycling results
    - UPSERT amenities for parking (category='parking_free' / 'parking_paid')
    - Extend existing park amenities with area_sqm from polygon geometry
    - Accept --feature flag: 'pedestrian' | 'cycling' | 'parking' | 'all'

Pause here after showing me all three scripts.

─────────────────────────────────────────────────────────────
STEP 4 — Ingest Scripts: Health Waiting Times + Cost of Living (CHI-351, CHI-352)
─────────────────────────────────────────────────────────────

After I confirm Step 3, create:

4a. /scripts/ingest_health_waiting.py
    Spec: QOL_ENRICHMENT.md section E-07
    - Accept --quarter flag: e.g. '2026-Q1'
    - Download MSCBS Excel (URL must be passed as --url flag since it 
      changes quarterly — document this in the script header)
    - Parse health area codes and wait times
    - UPSERT health_waiting_times by (health_area_code, recorded_quarter)
    - Print a clear WARNING if the MSCBS URL returns a 404 
      (URL changes quarterly)

4b. /scripts/ingest_cost_of_living.py
    Spec: QOL_ENRICHMENT.md section E-08
    - Read Numbeo API key from NUMBEO_API_KEY environment variable
    - If NUMBEO_API_KEY is not set, print instructions and exit cleanly
    - Iterate TOP_30_SPANISH_CITIES list from the spec
    - UPSERT cost_of_living by (ciudad, recorded_quarter)
    - OSM supermarket tier breakdown: query existing amenities table,
      classify by operator field using PREMIUM_OPERATORS and 
      DISCOUNT_OPERATORS lists in spec, compute pct per codigo_postal

Pause here after showing me both scripts.

─────────────────────────────────────────────────────────────
STEP 5 — Indicator Engine Updates (CHI-353)
─────────────────────────────────────────────────────────────

After I confirm Step 4, update the indicator engine in the Supabase 
Edge Function (find the file — likely in /supabase/functions/).

5a. Update calc_health_security() to add waiting time inputs.
    New formula is in QOL_ENRICHMENT.md section 3, Indicator 4.
    Add the two new SQL queries from section 3 (Indicator Engine) 
    to fetch waiting time data.

5b. Update calc_education_opportunity() to add diagnostic score 
    and bilingual school inputs.
    New formula in QOL_ENRICHMENT.md section 3, Indicator 5.

5c. Update calc_community_stability() to use real noise_lden data 
    from noise_zones table.
    New formula in QOL_ENRICHMENT.md section 3, Indicator 7.
    Use the noise query from section 3 SQL block.

5d. Add calc_daily_life_score() — new function.
    Full spec in QOL_ENRICHMENT.md section 3, Indicator 16.
    TypeScript interface in section 6 (CHI-353 issue).
    All four SQL queries in section 3 SQL block.

5e. Add calc_sensory_environment_score() — new function.
    Full spec in QOL_ENRICHMENT.md section 3, Indicator 17.

5f. Add calc_cost_of_life_index() — new function.
    Full spec in QOL_ENRICHMENT.md section 3, Indicator 18.

5g. Integrate all three new indicators into the main indicator 
    orchestration function — they run in Tier 1 (no historical data 
    dependency). Store results in analysis_cache.composite_indicators JSONB.

5h. All functions must handle NULL inputs gracefully — never throw, 
    always return a score with confidence='low' or 'medium' when 
    data is missing.

After all indicator changes, update INDICATORS.md with the new formulas.

Pause here and show me the updated indicator functions before proceeding.

─────────────────────────────────────────────────────────────
STEP 6 — Frontend Components (CHI-354)
─────────────────────────────────────────────────────────────

After I confirm Step 5, build the frontend display components 
as specified in QOL_ENRICHMENT.md Part 4.

All components are in the DNA Report page (/app/analyse/[jobId]).
Follow the DESIGN.md colour token system — no hardcoded hex values.

6a. Update HealthSecurityCard component:
    - Add waiting time row below GP distance
    - When avg_days_gp is not null: show "~X day wait for GP appointment"
    - When null: show "Wait data unavailable for this area" in secondary_text colour

6b. Update EducationOpportunityCard component:
    - Add bilingual language pill (small, emerald outline, "🌐 ES/EN") 
      next to school name where bilingual_languages is populated
    - Add diagnostic score mini-bar (thin progress bar, 0-100) with 
      "Top X% in [region]" label where diagnostic_score is available
    - When no diagnostic data: show caption "Academic data not yet 
      available for this region"

6c. Create DailyLifeScoreCard component (new):
    - Score ring at top (same pattern as other indicator cards)
    - Car-optional verdict text (use thresholds: ≥70 = "Mostly yes", 
      40-69 = "Partially", <40 = "You'll likely need a car")
    - Sub-rows: Walkability / Active Mobility / Green Space / Parking
    - Beach row: only render when nearest_beach_m < 15000
    - Empty state: when score confidence = 'low', show 
      "Data being collected for this area"

6d. Create SensoryEnvironmentCard component (new):
    - Three sub-rows: Noise / Air Quality / Green Exposure
    - Noise: show dB value + plain-English equivalent
      (use lookup: <45="Very quiet", 45-55="Quiet residential", 
       55-65="Busy street", 65-75="Heavy traffic", 75+="Very loud")
    - AQI: show value + category label from aqi_category field
    - Green: show sqm + nearest_green_m
    - Source attribution line for noise data

6e. Create CostOfLifeCard component (new):
    - Price pill grid: coffee / beer / meal in a 3-column row
    - Supermarket tier bar (horizontal proportional bar, discount vs premium)
    - "City-level estimate" disclosure in caption
    - Quarter date shown at bottom

6f. Map layer toggles: Add 5 new toggle buttons to the Map bottom 
    toolbar as specified in QOL_ENRICHMENT.md section 4.6.
    Connect to zone_enrichment_scores fields via Map API.

Pause after each component (6a through 6f) to show me before moving 
to the next.

─────────────────────────────────────────────────────────────
STEP 7 — Cron job + Map integration (CHI-355)
─────────────────────────────────────────────────────────────

After I confirm Step 6:

7a. Add a Supabase cron job (pg_cron or Supabase scheduled function) to:
    REFRESH MATERIALIZED VIEW CONCURRENTLY zone_enrichment_scores
    Schedule: nightly at 02:00 UTC

7b. Extend the Map API endpoint /api/map/zones to include these new
    fields from zone_enrichment_scores:
    avg_noise_lden, nearest_beach_m, park_area_sqm_500m,
    pedestrian_features_500m, school_avg_diagnostic, bilingual_schools_1km

7c. Update the zone right-panel (slide-in on zone click in Map Explorer)
    to show Daily Life Score, Sensory Environment Score, and Cost of Life
    Index for the clicked zone, sourced from zone_enrichment_scores.

Pause and show me the cron configuration and API changes before finalising.

─────────────────────────────────────────────────────────────
STEP 8 — Final documentation update
─────────────────────────────────────────────────────────────

After I confirm Step 7, update the following documents:

- DECISIONS.md: Add D-024, D-025, D-026, D-027 as specified in 
  QOL_ENRICHMENT.md Decision Log section
- DATA_SOURCES.md: Add all new sources from QOL_ENRICHMENT.md Part 2 
  to the QoL Reference Data table
- INDICATORS.md: Confirm all formula changes from Part 3 are reflected 
  (you should have updated this in Step 5 — verify completeness here)

Show me a diff summary of all documentation changes before finishing.

─────────────────────────────────────────────────────────────
IMPORTANT RULES FOR THIS TASK:
─────────────────────────────────────────────────────────────

1. Never hardcode database credentials. Always read from environment 
   variables: SUPABASE_DB_URL, SUPABASE_ANON_KEY, NUMBEO_API_KEY.

2. All ingest scripts must be idempotent — safe to re-run without 
   creating duplicate data. Use UPSERT (INSERT ... ON CONFLICT DO UPDATE).

3. Never fabricate scores. If data is unavailable, return NULL or a 
   neutral score with confidence='low'. The confidence field must always 
   be set honestly.

4. After each step, update the relevant Linear issue (CHI-347 through 
   CHI-355) status if you have Linear MCP access. If not, list what 
   to update manually.

5. Do not proceed to the next step until I confirm the current one.
   Each step may require discussion before continuing.
```

---

*Document end. Total new tables: 5. New columns on existing tables: 11. New indicators: 3. Updated indicators: 3. Linear issues: 9.*
