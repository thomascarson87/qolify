-- ============================================================
-- 008_postal_zones_and_zone_scores.sql
-- CHI-339 — Map MVP: zone data foundation
--
-- Creates:
--   1. postal_zones  — postcode boundary polygons (choropleth container)
--   2. zone_scores   — materialised view: one row per postcode with all
--                      pillar scores and composite TVI
--   3. pg_cron job   — nightly refresh at 03:00 UTC
--
-- Column name notes (actual schema vs. MAP_MVP_SPEC references):
--   schools.nombre / tipo / etapas  (not name / type / levels)
--   health_centres.nombre / tipo / is_24h  (not name / type / has_emergency)
--   transport_stops.nombre / tipo          (not name / type)
--   flood_zones.risk_level                 (not flood_period)
--   vut_licences — no codigo_postal column; spatial join used instead
--   All existing tables use GEOGRAPHY; postal_zones uses GEOMETRY(4326)
-- ============================================================

-- ----------------------------------------------------------------
-- Step 1 — postal_zones table
-- Boundary data loaded separately by ingest script.
-- Minimum coverage for MVP: Málaga postcodes 29001–29017.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS postal_zones (
  codigo_postal TEXT PRIMARY KEY,
  municipio     TEXT,
  geom          GEOMETRY(MultiPolygon, 4326),
  centroid      GEOMETRY(Point, 4326)   -- pre-computed for proximity queries
);

CREATE INDEX IF NOT EXISTS postal_zones_geom_idx     ON postal_zones USING GIST (geom);
CREATE INDEX IF NOT EXISTS postal_zones_centroid_idx ON postal_zones USING GIST (centroid);

-- Auto-compute centroid when rows are inserted (run after boundary data is loaded):
-- UPDATE postal_zones SET centroid = ST_Centroid(geom) WHERE centroid IS NULL;

-- ----------------------------------------------------------------
-- Step 2 — zone_scores materialised view
--
-- Two-level structure avoids the PostgreSQL restriction that
-- column aliases cannot be referenced within the same SELECT list:
--   • pillar_scores CTE  — computes all seven normalised pillar scores
--   • outer SELECT       — computes zone_tvi and signals using those aliases
--
-- Uses LEFT JOINs throughout so missing data (empty vut_licences,
-- flood_zones, etc.) produces null pillar scores instead of errors.
-- ----------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS zone_scores;

CREATE MATERIALIZED VIEW zone_scores AS
WITH

  -- ---- School proximity -------------------------------------------------
  school_agg AS (
    SELECT
      pz.codigo_postal,
      COUNT(s.id)                                                            AS school_count,
      MIN(ST_Distance(s.geom, pz.centroid::geography))                      AS nearest_school_m,
      SUM(CASE WHEN s.tipo = 'publico' THEN 1 ELSE 0 END)                  AS public_count,
      COUNT(s.id) FILTER (
        WHERE ST_Distance(s.geom, pz.centroid::geography) < 400
      )                                                                      AS schools_400m
    FROM postal_zones pz
    LEFT JOIN schools s
      ON ST_DWithin(s.geom, pz.centroid::geography, 1500)
    GROUP BY pz.codigo_postal
  ),

  -- ---- Health centre proximity ------------------------------------------
  -- tipo values: 'centro_salud' = GP, 'hospital' = hospital, 'farmacia' = pharmacy
  -- is_24h = true indicates emergency / 24h facility
  health_agg AS (
    SELECT
      pz.codigo_postal,
      MIN(ST_Distance(h.geom, pz.centroid::geography))
        FILTER (WHERE h.tipo = 'centro_salud')                              AS nearest_gp_m,
      MIN(ST_Distance(h.geom, pz.centroid::geography))
        FILTER (WHERE h.tipo = 'hospital' AND h.is_24h = true)             AS nearest_emergency_m,
      COUNT(h.id) FILTER (
        WHERE h.tipo = 'farmacia'
        AND ST_Distance(h.geom, pz.centroid::geography) < 500
      )                                                                      AS pharmacies_500m
    FROM postal_zones pz
    LEFT JOIN health_centres h
      ON ST_DWithin(h.geom, pz.centroid::geography, 3000)
    GROUP BY pz.codigo_postal
  ),

  -- ---- VUT (tourist licence) density -------------------------------------
  -- vut_licences has no codigo_postal column; use spatial join.
  -- vut_density_pct is used as a raw count proxy here (no estimated_units
  -- column in schema). The community score formula treats it as a count.
  vut_agg AS (
    SELECT
      pz.codigo_postal,
      COUNT(vl.id) FILTER (WHERE vl.status = 'active')                     AS vut_active,
      COUNT(vl.id) FILTER (WHERE vl.status = 'active')::numeric            AS vut_density_pct
    FROM postal_zones pz
    LEFT JOIN vut_licences vl
      ON ST_Within(vl.geom::geometry, pz.geom)
    GROUP BY pz.codigo_postal
  ),

  -- ---- Flood zone intersection ------------------------------------------
  -- risk_level values: 'T10', 'T100', 'T500'
  -- Cast GEOGRAPHY(MULTIPOLYGON) to GEOMETRY for ST_Intersects / ST_Intersection.
  flood_agg AS (
    SELECT
      pz.codigo_postal,
      BOOL_OR(fz.risk_level = 'T10')                                        AS has_t10_flood,
      BOOL_OR(fz.risk_level = 'T100')                                       AS has_t100_flood,
      COALESCE(
        MAX(
          ST_Area(ST_Intersection(pz.geom, fz.geom::geometry)::geography)
        ) FILTER (WHERE fz.risk_level = 'T10')
        / NULLIF(ST_Area(pz.geom::geography), 0) * 100,
        0
      )                                                                      AS t10_coverage_pct
    FROM postal_zones pz
    LEFT JOIN flood_zones fz
      ON ST_Intersects(pz.geom, fz.geom::geometry)
    GROUP BY pz.codigo_postal
  ),

  -- ---- Solar irradiance --------------------------------------------------
  -- solar_radiation.geom is GEOGRAPHY(POINT); cast to GEOMETRY for ST_Within.
  solar_agg AS (
    SELECT
      pz.codigo_postal,
      AVG(sr.ghi_annual_kwh_m2)                                             AS avg_ghi
    FROM postal_zones pz
    JOIN solar_radiation sr
      ON ST_Within(sr.geom::geometry, pz.geom)
    GROUP BY pz.codigo_postal
  ),

  -- ---- Transport connectivity -------------------------------------------
  transport_agg AS (
    SELECT
      pz.codigo_postal,
      MIN(ST_Distance(t.geom, pz.centroid::geography))
        FILTER (WHERE t.tipo = 'metro')                                     AS nearest_metro_m,
      COUNT(t.id) FILTER (
        WHERE ST_Distance(t.geom, pz.centroid::geography) < 400
      )                                                                      AS stops_400m
    FROM postal_zones pz
    LEFT JOIN transport_stops t
      ON ST_DWithin(t.geom, pz.centroid::geography, 1000)
    GROUP BY pz.codigo_postal
  ),

  -- ---- Infrastructure projects ------------------------------------------
  infra_agg AS (
    SELECT
      pz.codigo_postal,
      COUNT(ip.id)                                                           AS project_count,
      BOOL_OR(ip.type = 'metro_extension')                                  AS has_metro_project
    FROM postal_zones pz
    LEFT JOIN infrastructure_projects ip
      ON ST_DWithin(ip.geom::geography, pz.centroid::geography, 2000)
      AND ip.status = 'approved'
    GROUP BY pz.codigo_postal
  ),

  -- ---- Pillar normalised scores (0–100, higher = better) ----------------
  -- Named CTE so the outer SELECT can reference aliases for zone_tvi.
  pillar_scores AS (
    SELECT
      pz.codigo_postal,
      pz.geom,
      pz.centroid,
      pz.municipio,

      -- Raw aggregated values (exposed for zone panel display)
      sa.school_count, sa.nearest_school_m, sa.schools_400m, sa.public_count,
      ha.nearest_gp_m, ha.nearest_emergency_m, ha.pharmacies_500m,
      va.vut_active, va.vut_density_pct,
      fa.has_t10_flood, fa.has_t100_flood, fa.t10_coverage_pct,
      so.avg_ghi,
      ta.nearest_metro_m, ta.stops_400m,
      ia.project_count, ia.has_metro_project,

      -- Education: proximity to nearest school + density within 400m + public ratio
      LEAST(100, GREATEST(0, ROUND(
        (100 - LEAST(100, COALESCE(sa.nearest_school_m, 9999) / 15.0)) * 0.50
        + LEAST(40, COALESCE(sa.schools_400m, 0) * 8.0)
        + (COALESCE(sa.public_count, 0)::float / NULLIF(sa.school_count, 0)) * 10
      )))                                                                    AS school_score_norm,

      -- Health: nearest GP + nearest emergency + pharmacy density
      LEAST(100, GREATEST(0, ROUND(
        (100 - LEAST(100, COALESCE(ha.nearest_gp_m, 9999) / 30.0)) * 0.50
        + (100 - LEAST(100, COALESCE(ha.nearest_emergency_m, 10000) / 100.0)) * 0.30
        + LEAST(20, COALESCE(ha.pharmacies_500m, 0) * 5.0)
      )))                                                                    AS health_score_norm,

      -- Community: penalise high VUT density (tourist licence saturation)
      LEAST(100, GREATEST(0, ROUND(
        100 - LEAST(100, COALESCE(va.vut_density_pct, 0) * 2.5)
      )))                                                                    AS community_score_norm,

      -- Flood safety: hard penalty for T10/T100 exposure + coverage %
      LEAST(100, GREATEST(0, ROUND(
        100
        - (CASE WHEN fa.has_t10_flood  THEN 30 ELSE 0 END)
        - LEAST(30, COALESCE(fa.t10_coverage_pct, 0) * 3.0)
        - (CASE WHEN fa.has_t100_flood THEN 10 ELSE 0 END)
      )))                                                                    AS flood_risk_score,

      -- Solar: Málaga baseline ~1400 kWh/m²/yr; 100 = 1900 kWh/m²/yr
      LEAST(100, GREATEST(0, ROUND(
        (COALESCE(so.avg_ghi, 1400) - 1400) / 5.0
      )))                                                                    AS solar_score_norm,

      -- Connectivity: metro proximity + stop density within 400m
      LEAST(100, GREATEST(0, ROUND(
        (100 - LEAST(100, COALESCE(ta.nearest_metro_m, 5000) / 50.0)) * 0.60
        + LEAST(40, COALESCE(ta.stops_400m, 0) * 5.0)
      )))                                                                    AS connectivity_score_norm,

      -- Infrastructure: approved project count + metro extension bonus
      LEAST(100, GREATEST(0, ROUND(
        LEAST(60, COALESCE(ia.project_count, 0) * 15.0)
        + (CASE WHEN ia.has_metro_project THEN 30 ELSE 0 END)
      )))                                                                    AS infrastructure_score_norm

    FROM postal_zones pz
    LEFT JOIN school_agg    sa USING (codigo_postal)
    LEFT JOIN health_agg    ha USING (codigo_postal)
    LEFT JOIN vut_agg       va USING (codigo_postal)
    LEFT JOIN flood_agg     fa USING (codigo_postal)
    LEFT JOIN solar_agg     so USING (codigo_postal)
    LEFT JOIN transport_agg ta USING (codigo_postal)
    LEFT JOIN infra_agg     ia USING (codigo_postal)
  )

-- ---- Outer SELECT: composite TVI + signal badges ----------------------
-- Base weights; overridden client-side by profile (see PROFILE_WEIGHTS in MapClient).
SELECT
  *,

  ROUND(
    COALESCE(school_score_norm          * 0.15, 0)
    + COALESCE(health_score_norm        * 0.15, 0)
    + COALESCE(community_score_norm     * 0.12, 0)
    + COALESCE(flood_risk_score         * 0.18, 0)
    + COALESCE(solar_score_norm         * 0.10, 0)
    + COALESCE(connectivity_score_norm  * 0.15, 0)
    + COALESCE(infrastructure_score_norm* 0.15, 0)
  )                                                                          AS zone_tvi,

  ARRAY_REMOVE(ARRAY[
    CASE WHEN has_t10_flood                                THEN 'flood_t10'      END,
    CASE WHEN COALESCE(vut_density_pct, 0) > 30           THEN 'high_vut'       END,
    CASE WHEN COALESCE(vut_density_pct, 0) < 8            THEN 'low_vut'        END,
    CASE WHEN COALESCE(schools_400m, 0) >= 2              THEN 'school_rich'    END,
    CASE WHEN COALESCE(nearest_gp_m, 9999) < 300          THEN 'gp_close'       END,
    CASE WHEN has_metro_project                            THEN 'metro_incoming' END,
    CASE WHEN COALESCE(avg_ghi, 0) > 1750                 THEN 'high_solar'     END
  ], NULL)                                                                   AS signals

FROM pillar_scores;

-- Unique index required for REFRESH CONCURRENTLY
CREATE UNIQUE INDEX ON zone_scores (codigo_postal);
-- Spatial index for map tile queries
CREATE INDEX ON zone_scores USING GIST (geom);

-- ----------------------------------------------------------------
-- Step 3 — pg_cron nightly refresh
-- Runs at 03:00 UTC after zone_metrics cron (02:00 UTC).
-- Requires pg_cron extension to be enabled in Supabase dashboard.
-- ----------------------------------------------------------------
SELECT cron.schedule(
  'refresh-zone-scores',
  '0 3 * * *',
  'REFRESH MATERIALIZED VIEW CONCURRENTLY zone_scores'
);
