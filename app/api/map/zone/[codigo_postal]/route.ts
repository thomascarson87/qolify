/**
 * GET /api/map/zone/[codigo_postal]
 *
 * CHI-341 — Returns full zone detail for the right-side zone panel when a
 * user clicks a postcode on the map. Expanded to include:
 *   - zone_scores base fields (pillar scores, proximity metrics, signals)
 *   - schools_list     — nearest 5 schools within 1500m
 *   - health_list      — nearest 5 health centres within 3000m
 *   - amenity_context  — count of life amenities within 500m (restaurants,
 *                        bars, parks, supermarkets, gyms, pharmacies, etc.)
 *   - climate          — AEMET 30yr normals for the zone's municipio
 *   - price_context    — avg price/m² from on-demand analyses (≥3 obs)
 *
 * Column name notes (actual schema vs. original spec):
 *   schools.nombre / tipo / etapas  (not name / type / levels)
 *   health_centres.nombre / tipo / is_24h  (not name / type / has_emergency)
 *   amenities.geom is GEOGRAPHY — used directly in ST_DWithin
 *   climate_data joined by municipio_name (text match to zone_scores.municipio)
 */
import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ codigo_postal: string }> }
) {
  const { codigo_postal: cp } = await params;

  if (!cp || !/^\d{5}$/.test(cp)) {
    return NextResponse.json({ error: 'invalid_postcode' }, { status: 400 });
  }

  try {
    const [zone, schools, health, amenityContext, climate, priceContext, vutTrend, monthlyGhi, enrichmentRows] = await Promise.all([

      // Zone scores — explicit column list excludes geom/centroid (WKB, not needed).
      // All NUMERIC/computed columns cast to ::float or ::int so postgres.js returns
      // numbers rather than strings (text protocol returns NUMERIC as string).
      db`
        SELECT
          codigo_postal, municipio,
          zone_tvi::float,
          school_score_norm::float, health_score_norm::float, community_score_norm::float,
          flood_risk_score::float, solar_score_norm::float, connectivity_score_norm::float,
          infrastructure_score_norm::float,
          vut_density_pct::float, vut_active::int,
          has_t10_flood, has_t100_flood, t10_coverage_pct::float,
          nearest_school_m::float, schools_400m::int,
          nearest_gp_m::float, nearest_emergency_m::float,
          nearest_metro_m::float, stops_400m::int,
          avg_ghi::float,
          project_count::int, has_metro_project,
          nearest_supermarket_m::float, nearest_cafe_m::float,
          nearest_park_m::float, daily_necessities_400m::int,
          signals
        FROM zone_scores
        WHERE codigo_postal = ${cp}
        LIMIT 1`,

      // Nearest schools (up to 5 within 1500m of zone centroid)
      db`
        SELECT
          nombre                                AS name,
          tipo                                 AS type,
          etapas                               AS levels,
          ROUND(ST_Distance(
            geom,
            (SELECT centroid::geography FROM postal_zones WHERE codigo_postal = ${cp})
          )::numeric, 0)                       AS distance_m
        FROM schools
        WHERE ST_DWithin(
          geom,
          (SELECT centroid::geography FROM postal_zones WHERE codigo_postal = ${cp}),
          1500
        )
        ORDER BY distance_m
        LIMIT 5`,

      // Nearest health centres (up to 5 within 3000m)
      db`
        SELECT
          nombre                                AS name,
          tipo                                 AS type,
          is_24h                               AS has_emergency,
          ROUND(ST_Distance(
            geom,
            (SELECT centroid::geography FROM postal_zones WHERE codigo_postal = ${cp})
          )::numeric, 0)                       AS distance_m
        FROM health_centres
        WHERE ST_DWithin(
          geom,
          (SELECT centroid::geography FROM postal_zones WHERE codigo_postal = ${cp}),
          3000
        )
        ORDER BY distance_m
        LIMIT 5`,

      // Life amenities within 500m — grouped by display_category (CHI-350).
      // Excludes 'other' (libraries, cinema, etc.) which are not shown in the zone panel.
      // Deduplicated by (display_category, nombre) to avoid duplicate OSM entries.
      db`
        SELECT
          display_category,
          COUNT(DISTINCT nombre)::int AS cnt
        FROM amenities
        WHERE geom IS NOT NULL
          AND display_category != 'other'
          AND ST_DWithin(
            geom,
            (SELECT centroid::geography FROM postal_zones WHERE codigo_postal = ${cp}),
            500
          )
        GROUP BY display_category
        ORDER BY cnt DESC`,

      // AEMET 30yr climate normals for the zone's municipio
      db`
        SELECT
          sunshine_hours_annual::int  AS sunshine_hours_annual,
          sunshine_hours_jan::float   AS sunshine_hours_jan,
          sunshine_hours_feb::float   AS sunshine_hours_feb,
          sunshine_hours_mar::float   AS sunshine_hours_mar,
          sunshine_hours_apr::float   AS sunshine_hours_apr,
          sunshine_hours_may::float   AS sunshine_hours_may,
          sunshine_hours_jun::float   AS sunshine_hours_jun,
          sunshine_hours_jul::float   AS sunshine_hours_jul,
          sunshine_hours_aug::float   AS sunshine_hours_aug,
          sunshine_hours_sep::float   AS sunshine_hours_sep,
          sunshine_hours_oct::float   AS sunshine_hours_oct,
          sunshine_hours_nov::float   AS sunshine_hours_nov,
          sunshine_hours_dec::float   AS sunshine_hours_dec,
          temp_mean_annual_c::float   AS temp_mean_annual_c,
          temp_mean_jan_c::float      AS temp_mean_jan_c,
          temp_mean_jul_c::float      AS temp_mean_jul_c,
          rainfall_annual_mm::int     AS rainfall_annual_mm,
          humidity_annual_pct::float  AS humidity_annual_pct,
          days_above_35c_annual::int  AS days_above_35c_annual,
          hdd_annual::int             AS hdd_annual,
          cdd_annual::int             AS cdd_annual
        FROM climate_data
        WHERE municipio_name = (
          SELECT municipio FROM zone_scores WHERE codigo_postal = ${cp} LIMIT 1
        )
        LIMIT 1`,

      // Average price/m² from on-demand analyses — only shown when >= 3 observations.
      // Uses ST_Intersects(geography, geography) to avoid && operator type ambiguity.
      db`
        SELECT
          ROUND(AVG(pph.price_per_sqm))::int AS avg_price_sqm,
          COUNT(*)::int                      AS sample_count
        FROM property_price_history pph
        JOIN analysis_cache ac ON pph.cache_id = ac.id
        WHERE pph.price_per_sqm IS NOT NULL
          AND ST_Intersects(
            ac.geom,
            (SELECT geom::geography FROM postal_zones WHERE codigo_postal = ${cp})
          )
        HAVING COUNT(*) >= 3`,

      // VUT application trend — last 12 months (Community accordion sparkline)
      db`
        SELECT
          recorded_date::text AS date,
          vut_applications_30d::int AS value
        FROM zone_metrics_history
        WHERE zone_id = ${cp}
          AND vut_applications_30d IS NOT NULL
          AND recorded_date >= CURRENT_DATE - INTERVAL '12 months'
        ORDER BY recorded_date ASC
        LIMIT 12`,

      // Monthly GHI from the nearest PVGIS solar grid point.
      // Used as a fallback for the solar bar chart when AEMET monthly sunshine
      // hours are zero or unpopulated. Values are kWh/m²/day.
      db`
        SELECT
          ghi_jan::float, ghi_feb::float, ghi_mar::float, ghi_apr::float,
          ghi_may::float, ghi_jun::float, ghi_jul::float, ghi_aug::float,
          ghi_sep::float, ghi_oct::float, ghi_nov::float, ghi_dec::float,
          ghi_annual_kwh_m2::float
        FROM solar_radiation
        ORDER BY geom <-> (SELECT centroid FROM postal_zones WHERE codigo_postal = ${cp})
        LIMIT 1`,

      // QoL enrichment scores (migration 013 — graceful fallback if view not yet populated)
      db`
        SELECT
          avg_noise_lden::float,
          park_area_sqm_500m::int,
          pedestrian_features_500m::int,
          cycle_features_500m::int,
          nearest_beach_m::float,
          daily_needs_count_400m::int,
          school_avg_diagnostic::float,
          bilingual_schools_1km::int,
          daily_life_score::float
        FROM zone_enrichment_scores
        WHERE codigo_postal = ${cp}
        LIMIT 1
      `.catch(() => []),
    ]);

    if (!zone[0]) {
      return NextResponse.json({ error: 'zone_not_found' }, { status: 404 });
    }

    return NextResponse.json(
      {
        ...zone[0],
        schools_list:       schools,
        health_list:        health,
        amenity_context:    amenityContext,
        climate:            climate[0] ?? null,
        price_context:      priceContext[0] ?? null,
        vut_trend:          vutTrend.length >= 3 ? vutTrend : null,
        monthly_ghi:        monthlyGhi[0] ?? null,
        enrichment:         (enrichmentRows as unknown[])[0] ?? null,
        generated_at:       new Date().toISOString(),
      },
      {
        headers: { 'Cache-Control': 'public, max-age=3600' },
      }
    );

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[zone API] ${cp}:`, message);
    return NextResponse.json(
      { error: 'db_error', detail: process.env.VERCEL ? undefined : message },
      { status: 500 }
    );
  }
}
