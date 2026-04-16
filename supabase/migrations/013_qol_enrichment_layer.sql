-- ============================================================
-- 013_qol_enrichment_layer.sql
-- CHI-371 — QoL Enrichment Layer: schema foundations
--
-- Creates:
--   1. noise_zones               — EEA road/rail/airport noise polygons
--   2. beaches                   — OSM beach points + ADEAC Blue Flag status
--   3. pedestrian_cycling_zones  — OSM pedestrian streets + cycle infrastructure
--   4. health_waiting_times      — MSCBS surgical list + regional GP wait data
--   5. cost_of_living            — Numbeo city-level price data + OSM supermarket tiers
--
-- Amends:
--   6. schools                   — source_id + 9 quality enrichment columns
--   7. amenities                 — area_sqm, fee, osm_id, operator
--
-- Adds:
--   8. zone_enrichment_scores    — materialised view: per-postcode enrichment
--                                  scores for Map Explorer and DNA report.
--                                  Refreshed nightly by cron (see Step 8).
--
-- NOTE on daily_life_score:
--   The zone_enrichment_scores view computes daily_life_score directly so
--   the Map Explorer choropleth can reference it from a single field. This
--   resolves the gap in QOL_ENRICHMENT.md where the view DDL listed only
--   input metrics but CHI-379 needed a pre-computed score field.
--
-- NOTE on beaches join:
--   The spec used LEFT JOIN beaches ON TRUE (cross join) inside a GROUP BY.
--   We use a LATERAL subquery instead — semantically identical but avoids
--   O(postcodes × beaches) row expansion before aggregation.
-- ============================================================


-- ============================================================
-- 1. noise_zones
-- Stores EEA Strategic Noise Map polygons and ENAIRE airport contours.
-- source_type discriminates road / rail / airport / industry.
-- lden_band is the standard EU noise reporting band in dB(A) Lden.
-- ============================================================
CREATE TABLE noise_zones (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  geom          GEOGRAPHY(MULTIPOLYGON, 4326) NOT NULL,
  source_type   TEXT NOT NULL CHECK (source_type IN ('road', 'rail', 'airport', 'industry')),
  lden_band     TEXT NOT NULL CHECK (lden_band IN ('55-60', '60-65', '65-70', '70-75', '75+')),
  lden_min      SMALLINT NOT NULL,    -- dB lower bound of band
  lden_max      SMALLINT,             -- dB upper bound; NULL = open-ended (75+)
  source        TEXT DEFAULT 'eea',   -- 'eea' | 'enaire' | 'mitma'
  agglomeration TEXT,                 -- e.g. 'Madrid', 'Barcelona' (EEA agglomeration name)
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX noise_zones_geom_idx ON noise_zones USING GIST (geom);


-- ============================================================
-- 2. beaches
-- OSM beach centroids + ADEAC annual Blue Flag certification status.
-- beach_type distinguishes coastal from inland water bodies.
-- ============================================================
CREATE TABLE beaches (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         TEXT,
  lat            DECIMAL(10,7),
  lng            DECIMAL(10,7),
  geom           GEOGRAPHY(POINT, 4326),
  beach_type     TEXT CHECK (beach_type IN ('urban', 'natural', 'cala', 'lake', 'river')),
  length_m       INTEGER,
  is_blue_flag   BOOLEAN DEFAULT FALSE,
  blue_flag_year SMALLINT,
  municipio      TEXT,
  provincia      TEXT,
  osm_id         TEXT UNIQUE,
  source         TEXT DEFAULT 'osm',
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX beaches_geom_idx ON beaches USING GIST (geom);


-- ============================================================
-- 3. pedestrian_cycling_zones
-- OSM linear features: pedestrian streets, plazas, cycle lanes/tracks.
-- Used for mobility scoring in the Daily Life Score (Indicator 16).
-- ============================================================
CREATE TABLE pedestrian_cycling_zones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  geom        GEOGRAPHY(MULTILINESTRING, 4326) NOT NULL,
  zone_type   TEXT NOT NULL CHECK (zone_type IN (
                'pedestrian_street',
                'pedestrian_zone',   -- full plaza / zona peatonal
                'cycle_lane',        -- painted lane on road
                'cycle_track',       -- segregated path
                'cycle_path',        -- off-road path
                'shared_path'        -- pedestrian + cycle shared use
              )),
  surface     TEXT,                  -- 'asphalt' | 'cobblestone' | 'gravel' | etc.
  municipio   TEXT,
  osm_id      TEXT UNIQUE,
  source      TEXT DEFAULT 'osm',
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX pedcycle_geom_idx ON pedestrian_cycling_zones USING GIST (geom);


-- ============================================================
-- 4. health_waiting_times
-- MSCBS quarterly surgical waiting list data + Andalucía/Madrid
-- regional GP appointment wait time supplements.
-- Matched to analysis via municipio → comunidad_autonoma lookup.
-- ============================================================
CREATE TABLE health_waiting_times (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  health_area_code     TEXT NOT NULL,    -- Zona Básica de Salud / área sanitaria code
  health_area_name     TEXT,
  comunidad_autonoma   TEXT NOT NULL,
  avg_days_gp          DECIMAL(4,1),     -- average wait for GP appointment (days)
  avg_days_specialist  DECIMAL(4,1),     -- average wait for specialist referral (days)
  avg_days_surgery     DECIMAL(5,1),     -- surgical waiting list average (days)
  surgery_waiting_list INTEGER,          -- total patients on surgical list
  recorded_quarter     DATE NOT NULL,    -- first day of quarter, e.g. 2026-01-01 = Q1 2026
  source               TEXT DEFAULT 'mscbs',
  source_url           TEXT,             -- confirmed quarterly URL stored for auditability
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT health_waiting_times_area_quarter_unique
    UNIQUE (health_area_code, recorded_quarter)
);


-- ============================================================
-- 5. cost_of_living
-- Numbeo city-level price data refreshed quarterly.
-- OSM supermarket operator tier breakdown computed per postcode
-- by ingest_cost_of_living.py and stored here.
-- Granularity is city-level (not postcode) — disclosed in UI.
-- ============================================================
CREATE TABLE cost_of_living (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio                TEXT,
  ciudad                   TEXT NOT NULL,         -- Numbeo city name (may differ from municipio)
  provincia                TEXT,
  coffee_eur               DECIMAL(4,2),          -- espresso in city-centre café
  beer_eur                 DECIMAL(4,2),          -- 330ml beer in local bar
  meal_cheap_eur           DECIMAL(5,2),          -- inexpensive restaurant, 1 person
  meal_midrange_eur        DECIMAL(6,2),          -- mid-range restaurant, 2 persons
  grocery_index            DECIMAL(5,2),          -- Numbeo grocery index (100 = global avg)
  supermarket_premium_pct  DECIMAL(4,1),          -- % of nearby supermarkets that are premium tier
  supermarket_discount_pct DECIMAL(4,1),          -- % that are discount tier (Lidl, Aldi, Dia)
  source                   TEXT DEFAULT 'numbeo',
  recorded_quarter         DATE NOT NULL,
  updated_at               TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT col_city_quarter_unique UNIQUE (ciudad, recorded_quarter)
);


-- ============================================================
-- 6. schools — quality enrichment columns
--
-- source_id: government centre code (e.g. BuscaColegio 'Código de Centro').
--   Required by enrich_schools.py to match diagnostic test CSVs.
--   Added here because it was absent from the original schema but
--   referenced by CHI-373.
--
-- bilingual_languages: ISO 639-1 codes, e.g. ['es', 'en'].
-- diagnostic_score: 0–100 from LOMCE / regional evaluation data.
--   NULL when data is unavailable — never fabricated.
-- teacher_ratio: pupils per teacher (province average where per-school
--   data is unavailable).
-- ============================================================
ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS source_id              TEXT,           -- gobierno centre code
  ADD COLUMN IF NOT EXISTS bilingual_languages    TEXT[],         -- e.g. ['es', 'en']
  ADD COLUMN IF NOT EXISTS diagnostic_score       DECIMAL(5,2),   -- 0–100; NULL = no data
  ADD COLUMN IF NOT EXISTS diagnostic_year        SMALLINT,
  ADD COLUMN IF NOT EXISTS diagnostic_source      TEXT,           -- 'lomce' | 'evaluacion_diagnostico_and' | etc.
  ADD COLUMN IF NOT EXISTS teacher_ratio          DECIMAL(4,2),   -- pupils per teacher
  ADD COLUMN IF NOT EXISTS etapas_range           TEXT,           -- 'infantil-bachillerato' | 'primaria' | etc.
  ADD COLUMN IF NOT EXISTS year_founded           SMALLINT,
  ADD COLUMN IF NOT EXISTS has_canteen            BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS has_sports_facilities  BOOLEAN DEFAULT FALSE;

-- Index for diagnostic score lookups (percentile ranking within region)
CREATE INDEX schools_diagnostic_score_idx ON schools (diagnostic_score)
  WHERE diagnostic_score IS NOT NULL;

-- Index for bilingual school proximity queries
CREATE INDEX schools_bilingual_idx ON schools (municipio)
  WHERE bilingual_languages IS NOT NULL;


-- ============================================================
-- 7. amenities — enrichment columns
--
-- area_sqm:  polygon area for parks, sports pitches, plazas.
--   Computed from OSM geometry before point conversion.
-- fee:       'free' | 'paid' | 'unknown' — used for parking categories.
-- osm_id:    OSM element ID — makes re-runs idempotent (UPSERT by osm_id).
-- operator:  OSM operator name — used by cost_of_living ingest for
--   supermarket tier classification (CHI-376).
-- ============================================================
ALTER TABLE amenities
  ADD COLUMN IF NOT EXISTS area_sqm  INTEGER,
  ADD COLUMN IF NOT EXISTS fee       TEXT,        -- 'free' | 'paid' | 'unknown'
  ADD COLUMN IF NOT EXISTS osm_id    TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS operator  TEXT;        -- OSM operator tag (supermarkets, parking)

-- Backfill display_category for new amenity categories introduced by
-- this enrichment layer. Existing rows are unaffected.
-- New categories: parking_free, parking_paid, playground, sports_area, market
UPDATE amenities
SET display_category = CASE category
  WHEN 'parking_free'  THEN 'parking'
  WHEN 'parking_paid'  THEN 'parking'
  WHEN 'playground'    THEN 'playground'
  WHEN 'sports_area'   THEN 'sports'
  WHEN 'market'        THEN 'market'
  ELSE display_category  -- leave existing mappings intact
END
WHERE category IN ('parking_free', 'parking_paid', 'playground', 'sports_area', 'market');


-- ============================================================
-- 8. zone_enrichment_scores — materialised view
--
-- Pre-computes per-postcode enrichment metrics and composite scores
-- used by the Map Explorer choropleth and the DNA report zone panel.
-- Refreshed nightly by pg_cron (see Step 9 below).
--
-- Columns provided to Map Explorer (CHI-379):
--   avg_noise_lden, nearest_beach_m, park_area_sqm_500m,
--   pedestrian_features_500m, school_avg_diagnostic,
--   bilingual_schools_1km, daily_life_score
--
-- daily_life_score resolves the gap between the input-metrics-only
-- DDL in QOL_ENRICHMENT.md §1.8 and the choropleth field reference
-- in CHI-379. Formula mirrors calc_daily_life_score() in CHI-377.
-- ============================================================
CREATE MATERIALIZED VIEW zone_enrichment_scores AS
WITH

  -- ---- Noise: highest lden_min intersecting each postcode centroid -------
  noise_agg AS (
    SELECT
      cp.codigo_postal,
      AVG(nz.lden_min)::NUMERIC(5,1)  AS avg_noise_lden,
      MAX(nz.lden_min)                AS max_noise_lden
    FROM postal_zones cp
    LEFT JOIN noise_zones nz
      ON ST_Intersects(cp.centroid::geography, nz.geom)
    GROUP BY cp.codigo_postal
  ),

  -- ---- Amenities within 500m of postcode centroid -----------------------
  amenity_agg AS (
    SELECT
      cp.codigo_postal,
      -- Parks / green space
      COUNT(a.id) FILTER (WHERE a.category = 'park')                               AS park_count_500m,
      COALESCE(SUM(a.area_sqm) FILTER (WHERE a.category = 'park'), 0)              AS park_area_sqm_500m,
      COUNT(a.id) FILTER (WHERE a.category = 'playground')                         AS playground_count_500m,
      -- Free parking (1km radius — slightly wider than 500m default)
      COUNT(a.id) FILTER (
        WHERE a.category = 'parking_free'
        AND ST_DWithin(cp.centroid::geography, a.geom, 1000)
      )                                                                             AS free_parking_count_1km,
      -- Markets
      COUNT(a.id) FILTER (
        WHERE a.category = 'market'
        AND ST_DWithin(cp.centroid::geography, a.geom, 1000)
      )                                                                             AS market_count_1km,
      -- Daily needs within 400m: pharmacy + supermarket + cafe
      -- (GP/centro_salud counted separately from health_centres table)
      COUNT(a.id) FILTER (
        WHERE a.category IN ('pharmacy', 'supermarket', 'cafe')
        AND ST_DWithin(cp.centroid::geography, a.geom, 400)
      )                                                                             AS daily_needs_count_400m
    FROM postal_zones cp
    LEFT JOIN amenities a
      ON ST_DWithin(cp.centroid::geography, a.geom, 500)
    GROUP BY cp.codigo_postal
  ),

  -- ---- GP centres within 400m (contributes to daily needs) ---------------
  gp_400m_agg AS (
    SELECT
      cp.codigo_postal,
      COUNT(h.id) FILTER (WHERE h.tipo = 'centro_salud')  AS gp_count_400m
    FROM postal_zones cp
    LEFT JOIN health_centres h
      ON ST_DWithin(cp.centroid::geography, h.geom, 400)
    GROUP BY cp.codigo_postal
  ),

  -- ---- Pedestrian and cycling infrastructure within 500m ----------------
  mobility_agg AS (
    SELECT
      cp.codigo_postal,
      COUNT(pcz.id) FILTER (WHERE pcz.zone_type LIKE 'pedestrian%')  AS pedestrian_features_500m,
      COUNT(pcz.id) FILTER (WHERE pcz.zone_type LIKE 'cycle%')       AS cycle_features_500m
    FROM postal_zones cp
    LEFT JOIN pedestrian_cycling_zones pcz
      ON ST_DWithin(cp.centroid::geography, pcz.geom, 500)
    GROUP BY cp.codigo_postal
  ),

  -- ---- Nearest beach (LATERAL: avoids cross-join row explosion) ----------
  -- Only meaningful where beaches table is populated; returns NULL otherwise.
  beach_agg AS (
    SELECT
      cp.codigo_postal,
      (
        SELECT MIN(ST_Distance(cp.centroid::geography, b.geom))
        FROM beaches b
      ) AS nearest_beach_m
    FROM postal_zones cp
  ),

  -- ---- Schools within 1km: diagnostic score average + bilingual count ---
  school_agg AS (
    SELECT
      cp.codigo_postal,
      AVG(s.diagnostic_score)                                        AS school_avg_diagnostic,
      COUNT(s.id) FILTER (WHERE s.bilingual_languages IS NOT NULL)   AS bilingual_schools_1km
    FROM postal_zones cp
    LEFT JOIN schools s
      ON ST_DWithin(cp.centroid::geography, s.geom, 1000)
    GROUP BY cp.codigo_postal
  )

-- ---- Outer SELECT: combine and compute daily_life_score ----------------
SELECT
  cp.codigo_postal,
  cp.municipio,

  -- Noise
  na.avg_noise_lden,
  na.max_noise_lden,

  -- Green space
  aa.park_count_500m,
  aa.park_area_sqm_500m,
  aa.playground_count_500m,

  -- Active mobility
  ma.pedestrian_features_500m,
  ma.cycle_features_500m,

  -- Parking & markets
  aa.free_parking_count_1km,
  aa.market_count_1km,

  -- Beach
  ba.nearest_beach_m,

  -- Schools enriched
  sa.school_avg_diagnostic,
  sa.bilingual_schools_1km,

  -- Daily needs (combined amenities + GP, for Daily Life Score)
  (COALESCE(aa.daily_needs_count_400m, 0) + COALESCE(ga.gp_count_400m, 0))
                                                                AS daily_needs_count_400m,

  -- ---- Daily Life Score (Indicator 16) pre-computed --------------------
  -- Mirrors calc_daily_life_score() in CHI-377.
  -- walk_sub    = LEAST(60, daily_needs_count * 15)         → weight 0.40
  -- mobility_sub = LEAST(20, ped*5) + LEAST(20, cycle*3)   → weight 0.30
  -- green_sub   = LEAST(20, park_area_sqm / 1000 * 10)     → weight 0.20
  -- beach_sub   = GREATEST(0, 20 - nearest_beach_m / 250)  → weight 0.10
  --               capped at 0 when beach is >5km away
  ROUND(
    -- walkability component: count of daily needs × 15pts each, capped at 60, weighted 40%
    LEAST(60.0,
      (COALESCE(aa.daily_needs_count_400m, 0) + COALESCE(ga.gp_count_400m, 0)) * 15.0
    ) * 0.40
    +
    -- mobility component
    (
      LEAST(20.0, COALESCE(ma.pedestrian_features_500m, 0) * 5.0)
      + LEAST(20.0, COALESCE(ma.cycle_features_500m, 0) * 3.0)
    ) * 0.30
    +
    -- green space component
    LEAST(20.0,
      COALESCE(aa.park_area_sqm_500m, 0) / 1000.0 * 10.0
    ) * 0.20
    +
    -- beach component (only meaningful within 5km)
    GREATEST(0.0,
      CASE
        WHEN COALESCE(ba.nearest_beach_m, 99999) < 5000
        THEN 20.0 - (ba.nearest_beach_m / 250.0)
        ELSE 0.0
      END
    ) * 0.10
  )::NUMERIC(5,2)                                               AS daily_life_score

FROM postal_zones cp
LEFT JOIN noise_agg    na USING (codigo_postal)
LEFT JOIN amenity_agg  aa USING (codigo_postal)
LEFT JOIN gp_400m_agg  ga USING (codigo_postal)
LEFT JOIN mobility_agg ma USING (codigo_postal)
LEFT JOIN beach_agg    ba USING (codigo_postal)
LEFT JOIN school_agg   sa USING (codigo_postal);

-- Unique index required for REFRESH MATERIALIZED VIEW CONCURRENTLY
CREATE UNIQUE INDEX zone_enrichment_scores_cp_idx
  ON zone_enrichment_scores (codigo_postal);


-- ============================================================
-- 9. pg_cron — nightly refresh
-- Runs at 02:00 UTC (before zone_scores refresh at 03:00 UTC).
-- Requires pg_cron extension enabled in Supabase dashboard.
-- ============================================================
SELECT cron.schedule(
  'refresh-zone-enrichment-scores',
  '0 2 * * *',
  'REFRESH MATERIALIZED VIEW CONCURRENTLY zone_enrichment_scores'
);
