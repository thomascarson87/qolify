-- ============================================================
-- 010_zone_scores_walkability.sql
-- CHI-351 — Add walkability fact columns to zone_scores view
--
-- Extends zone_scores with four new columns computed from the
-- amenities table (requires migration 009 display_category first):
--   nearest_supermarket_m  — distance to nearest supermarket
--   nearest_cafe_m         — distance to nearest café/bar
--   nearest_park_m         — distance to nearest park
--   daily_necessities_400m — count of essential amenities within 400m
--                            (supermarket + pharmacy + bakery + bank)
--
-- Also creates the export_zone_geojson RPC used by the tile
-- generation pipeline (generate-zone-tiles Edge Function).
--
-- Note: pg_cron schedule already exists from migration 008.
--       Only the view definition is recreated here.
-- ============================================================

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

  -- ---- VUT (tourist licence) density ------------------------------------
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

  -- ---- Amenity walkability (CHI-351) ------------------------------------
  -- Uses display_category from migration 009. Joined within 1000m so that
  -- nearest_* columns have a sensible search radius without full-table scans.
  -- daily_necessities_400m counts distinct display_category types (not rows)
  -- so a zone with 5 supermarkets and 1 pharmacy scores 2, not 6.
  amenity_agg AS (
    SELECT
      pz.codigo_postal,
      MIN(ST_Distance(a.geom, pz.centroid::geography))
        FILTER (WHERE a.display_category = 'supermarket')                  AS nearest_supermarket_m,
      MIN(ST_Distance(a.geom, pz.centroid::geography))
        FILTER (WHERE a.display_category = 'cafe')                         AS nearest_cafe_m,
      MIN(ST_Distance(a.geom, pz.centroid::geography))
        FILTER (WHERE a.display_category = 'park')                         AS nearest_park_m,
      -- Count of essential category *types* present within 400m
      -- (counts distinct display_category values, max 4: supermarket/pharmacy/bakery/bank)
      COUNT(DISTINCT a.display_category) FILTER (
        WHERE a.display_category IN ('supermarket', 'pharmacy', 'bakery', 'bank')
        AND ST_Distance(a.geom, pz.centroid::geography) < 400
      )                                                                     AS daily_necessities_400m
    FROM postal_zones pz
    LEFT JOIN amenities a
      ON ST_DWithin(a.geom, pz.centroid::geography, 1000)
         AND a.display_category != 'other'
    GROUP BY pz.codigo_postal
  ),

  -- ---- Pillar normalised scores (0–100, higher = better) ----------------
  pillar_scores AS (
    SELECT
      pz.codigo_postal,
      pz.geom,
      pz.centroid,
      pz.municipio,

      -- Raw aggregated values (used for zone panel display — not converted to scores)
      sa.school_count, sa.nearest_school_m, sa.schools_400m, sa.public_count,
      ha.nearest_gp_m, ha.nearest_emergency_m, ha.pharmacies_500m,
      va.vut_active, va.vut_density_pct,
      fa.has_t10_flood, fa.has_t100_flood, fa.t10_coverage_pct,
      so.avg_ghi,
      ta.nearest_metro_m, ta.stops_400m,
      ia.project_count, ia.has_metro_project,

      -- Walkability fact columns (CHI-351) — distances and counts, never scored
      aa.nearest_supermarket_m,
      aa.nearest_cafe_m,
      aa.nearest_park_m,
      aa.daily_necessities_400m,

      -- Education score
      LEAST(100, GREATEST(0, ROUND(
        (100 - LEAST(100, COALESCE(sa.nearest_school_m, 9999) / 15.0)) * 0.50
        + LEAST(40, COALESCE(sa.schools_400m, 0) * 8.0)
        + (COALESCE(sa.public_count, 0)::float / NULLIF(sa.school_count, 0)) * 10
      )))                                                                    AS school_score_norm,

      -- Health score
      LEAST(100, GREATEST(0, ROUND(
        (100 - LEAST(100, COALESCE(ha.nearest_gp_m, 9999) / 30.0)) * 0.50
        + (100 - LEAST(100, COALESCE(ha.nearest_emergency_m, 10000) / 100.0)) * 0.30
        + LEAST(20, COALESCE(ha.pharmacies_500m, 0) * 5.0)
      )))                                                                    AS health_score_norm,

      -- Community score
      LEAST(100, GREATEST(0, ROUND(
        100 - LEAST(100, COALESCE(va.vut_density_pct, 0) * 2.5)
      )))                                                                    AS community_score_norm,

      -- Flood safety score
      LEAST(100, GREATEST(0, ROUND(
        100
        - (CASE WHEN fa.has_t10_flood  THEN 30 ELSE 0 END)
        - LEAST(30, COALESCE(fa.t10_coverage_pct, 0) * 3.0)
        - (CASE WHEN fa.has_t100_flood THEN 10 ELSE 0 END)
      )))                                                                    AS flood_risk_score,

      -- Solar score
      LEAST(100, GREATEST(0, ROUND(
        (COALESCE(so.avg_ghi, 1400) - 1400) / 5.0
      )))                                                                    AS solar_score_norm,

      -- Connectivity score
      LEAST(100, GREATEST(0, ROUND(
        (100 - LEAST(100, COALESCE(ta.nearest_metro_m, 5000) / 50.0)) * 0.60
        + LEAST(40, COALESCE(ta.stops_400m, 0) * 5.0)
      )))                                                                    AS connectivity_score_norm,

      -- Infrastructure score
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
    LEFT JOIN amenity_agg   aa USING (codigo_postal)
  )

-- ---- Outer SELECT: composite TVI + signal badges ----------------------
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

-- Required indexes (recreated after DROP MATERIALIZED VIEW)
CREATE UNIQUE INDEX ON zone_scores (codigo_postal);
CREATE INDEX ON zone_scores USING GIST (geom);


-- ============================================================
-- export_zone_geojson(city)
--
-- Returns a GeoJSON FeatureCollection of all zone_scores rows
-- for a given city (matched by municipio substring, case-insensitive).
-- Called by the generate-zone-tiles Edge Function to bake the
-- pre-cached choropleth tile into Supabase Storage.
--
-- All new walkability columns (nearest_supermarket_m, etc.) are
-- included in properties so the zone panel can read them client-side
-- without a separate API call.
-- ============================================================
CREATE OR REPLACE FUNCTION export_zone_geojson(city TEXT DEFAULT 'malaga')
RETURNS JSONB
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'type',     'FeatureCollection',
    'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
  )
  FROM (
    SELECT jsonb_build_object(
      'type',     'Feature',
      'geometry', ST_AsGeoJSON(zs.geom)::jsonb,
      'properties', jsonb_build_object(
        'codigo_postal',             zs.codigo_postal,
        'municipio',                 zs.municipio,
        'zone_tvi',                  zs.zone_tvi,
        'school_score_norm',         zs.school_score_norm,
        'health_score_norm',         zs.health_score_norm,
        'community_score_norm',      zs.community_score_norm,
        'flood_risk_score',          zs.flood_risk_score,
        'solar_score_norm',          zs.solar_score_norm,
        'connectivity_score_norm',   zs.connectivity_score_norm,
        'infrastructure_score_norm', zs.infrastructure_score_norm,
        'vut_active',                zs.vut_active,
        'vut_density_pct',           zs.vut_density_pct,
        'has_t10_flood',             zs.has_t10_flood,
        'has_t100_flood',            zs.has_t100_flood,
        't10_coverage_pct',          zs.t10_coverage_pct,
        'nearest_school_m',          zs.nearest_school_m,
        'schools_400m',              zs.schools_400m,
        'nearest_gp_m',              zs.nearest_gp_m,
        'nearest_emergency_m',       zs.nearest_emergency_m,
        'nearest_metro_m',           zs.nearest_metro_m,
        'stops_400m',                zs.stops_400m,
        'avg_ghi',                   zs.avg_ghi,
        'project_count',             zs.project_count,
        'has_metro_project',         zs.has_metro_project,
        'nearest_supermarket_m',     zs.nearest_supermarket_m,
        'nearest_cafe_m',            zs.nearest_cafe_m,
        'nearest_park_m',            zs.nearest_park_m,
        'daily_necessities_400m',    zs.daily_necessities_400m,
        'signals',                   zs.signals
      )
    ) AS feature
    FROM zone_scores zs
    WHERE LOWER(zs.municipio) LIKE '%' || LOWER(city) || '%'
  ) features;
$$;
