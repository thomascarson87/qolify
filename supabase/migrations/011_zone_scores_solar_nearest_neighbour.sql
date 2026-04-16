-- ============================================================
-- 011_zone_scores_solar_nearest_neighbour.sql
-- CHI-330 — Fix avg_ghi always NULL in zone_scores
--
-- Root cause: solar_agg used ST_Within (inner join), requiring
-- PVGIS grid points to fall *inside* each postal zone polygon.
-- Málaga urban zones are ~1 km² but the PVGIS grid is ~3–5 km
-- resolution, so most zones contain zero grid points and the
-- LEFT JOIN in pillar_scores produces NULL avg_ghi everywhere.
--
-- Fix: LATERAL nearest-neighbour join — for each zone centroid,
-- pick the closest solar_radiation row (ORDER BY geom <-> centroid
-- LIMIT 1). This always returns a value and is the correct
-- approach for a reference climate grid.
--
-- Foundation note (CHI-362 — future work):
--   avg_ghi is a zone-level solar resource baseline (kWh/m²/yr).
--   The long-term goal is per-building solar gain using Catastro
--   building footprints + orientation (azimuth) combined with
--   the PVGIS irradiance grid. This enables:
--     • North-facing property flag (azimuth ~315°–45°)
--     • Estimated annual direct-sun hours per dwelling
--     • Damp risk signal (north-facing + low sun + high humidity)
--     • Actual rooftop solar potential vs. notional zone average
--   This migration keeps avg_ghi as the zone baseline that the
--   per-building calculation will reference when Catastro data
--   is ingested (Phase 3).
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
  -- FIX (CHI-330): nearest-neighbour LATERAL join replaces the broken
  -- ST_Within inner join. PVGIS grid spacing (~3–5 km) is larger than
  -- most Málaga urban zones (~1 km²), so ST_Within returned zero rows
  -- for the majority of zones. LATERAL picks the closest grid point
  -- to each zone centroid, guaranteeing a non-null avg_ghi for every zone.
  --
  -- FOUNDATION (CHI-362): avg_ghi (kWh/m²/yr) is the zone-level solar
  -- resource baseline. Per-building solar gain — using Catastro orientation
  -- data — will multiply the nearest PVGIS irradiance by an orientation
  -- factor derived from building azimuth, enabling north-facing / damp
  -- risk signals at property level (Phase 3).
  solar_agg AS (
    SELECT
      pz.codigo_postal,
      nearest.ghi_annual_kwh_m2                                             AS avg_ghi
    FROM postal_zones pz
    LEFT JOIN LATERAL (
      SELECT ghi_annual_kwh_m2
      FROM solar_radiation
      ORDER BY geom::geometry <-> pz.centroid
      LIMIT 1
    ) nearest ON true
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
  amenity_agg AS (
    SELECT
      pz.codigo_postal,
      MIN(ST_Distance(a.geom, pz.centroid::geography))
        FILTER (WHERE a.display_category = 'supermarket')                  AS nearest_supermarket_m,
      MIN(ST_Distance(a.geom, pz.centroid::geography))
        FILTER (WHERE a.display_category = 'cafe')                         AS nearest_cafe_m,
      MIN(ST_Distance(a.geom, pz.centroid::geography))
        FILTER (WHERE a.display_category = 'park')                         AS nearest_park_m,
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

      -- Raw aggregated values
      sa.school_count, sa.nearest_school_m, sa.schools_400m, sa.public_count,
      ha.nearest_gp_m, ha.nearest_emergency_m, ha.pharmacies_500m,
      va.vut_active, va.vut_density_pct,
      fa.has_t10_flood, fa.has_t100_flood, fa.t10_coverage_pct,
      so.avg_ghi,
      ta.nearest_metro_m, ta.stops_400m,
      ia.project_count, ia.has_metro_project,

      -- Walkability fact columns (CHI-351)
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

      -- Solar score: zone GHI baseline (kWh/m²/yr).
      -- Málaga baseline ~1400; score 0 at ≤1400, 100 at 1900.
      -- Per-building orientation adjustment planned in CHI-362
      -- (Catastro azimuth × PVGIS factor → actual solar gain score).
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
