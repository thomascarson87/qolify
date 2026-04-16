/**
 * POST /api/map/pin
 *
 * CHI-346 — Coordinate-based location intelligence.
 * No Parse.bot call, no property URL required.
 *
 * Request body: { lat, lng, price_asking?, area_sqm? }
 *
 * Performance notes:
 *   - 16 parallel PostGIS queries (down from 22) via Promise.allSettled.
 *   - Promise.allSettled: a single slow/failed query returns a fallback value
 *     rather than killing the entire response.
 *   - withTimeout(): 5 s application-level cap per query. Necessary because
 *     statement_timeout set in lib/db.ts is a session variable that Supabase's
 *     transaction-mode pooler (Supavisor) resets between transactions — it is
 *     NOT reliably applied to individual queries routed through the pooler.
 *   - Amenity counts/distances: formerly 7 separate queries on the 197 K-row
 *     amenities table; now one CTE that does a single ST_DWithin(1 000 m) pass
 *     and derives all counts + nearest distances with conditional aggregation.
 *
 * Column name notes (actual schema vs spec pseudocode):
 *   schools.nombre / tipo / etapas      (not name / type / levels)
 *   health_centres.nombre / tipo        (not name / type)
 *   health_centres.is_24h               (emergency filter)
 *   health_centres.tipo = 'centro_salud' (GP filter)
 *   transport_stops.nombre / tipo       (not name / type)
 *   airports.nombre                     (not name)
 *   amenities.geom is GEOGRAPHY         (ST_DWithin directly, no cast needed)
 *   climate_data has no geom            (lookup via postal_zones.municipio)
 *
 * Financial estimate (only when price_asking provided):
 *   LTV 80 %, rate = ecb_base_rate_pct + typical_bank_spread_pct, 25-year term.
 *   IBI: 0.4 % of asking / 12 (estimate — no cadastral value available).
 *   Energy: €8/m²/month if area_sqm given; else €80 flat estimate.
 *   Community: €75/month flat estimate.
 *
 * Target latency: < 1 s on warm DB (all queries in parallel + GIST indexes).
 */

import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

// ---------------------------------------------------------------------------
// Query timeout — applied at the application layer because Supavisor (Supabase
// transaction-mode pooler) resets session variables between transactions,
// making statement_timeout set in lib/db.ts unreliable per-query.
// ---------------------------------------------------------------------------

const QUERY_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`pin_timeout:${label} (${QUERY_TIMEOUT_MS}ms)`)),
        QUERY_TIMEOUT_MS,
      )
    ),
  ]);
}

/** Unwrap one allSettled result, logging + returning a fallback on failure. */
function settled<T>(r: PromiseSettledResult<T[]>, fallback: T[], label: string): T[] {
  if (r.status === 'fulfilled') return r.value;
  const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
  console.warn(`[pin] ${label} failed:`, reason);
  return fallback;
}

// ---------------------------------------------------------------------------
// Mortgage formula
// ---------------------------------------------------------------------------

function calcMortgage(principal: number, annualRatePct: number, termYears: number): number {
  const r = annualRatePct / 100 / 12;
  const n = termYears * 12;
  if (r === 0) return Math.round(principal / n);
  const factor = Math.pow(1 + r, n);
  return Math.round(principal * (r * factor) / (factor - 1));
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const { lat, lng, price_asking, area_sqm } = body as {
    lat?: unknown;
    lng?: unknown;
    price_asking?: unknown;
    area_sqm?: unknown;
  };

  if (
    typeof lat !== 'number' || typeof lng !== 'number' ||
    lat < 35.5 || lat > 44.0 ||
    lng < -9.5 || lng > 4.5
  ) {
    return NextResponse.json({ error: 'invalid_coordinates' }, { status: 400 });
  }

  const priceNum = typeof price_asking === 'number' && price_asking > 0 ? price_asking : null;
  const areaNum  = typeof area_sqm    === 'number' && area_sqm    > 0 ? area_sqm    : null;

  // ---- 16 parallel queries --------------------------------------------------
  // Previously 22 queries. Amenity lookups consolidated from 7 → 1 (see Q15).
  // All wrapped in withTimeout() to enforce 5 s per-query cap regardless of
  // pooler session-variable behaviour.

  const results = await Promise.allSettled([

    // Q1. Flood zones — binary per risk level
    withTimeout(
      db`
        SELECT risk_level
        FROM flood_zones
        WHERE ST_Within(
          ST_SetSRID(ST_MakePoint(${lng}::float, ${lat}::float), 4326),
          geom::geometry
        )`,
      'flood',
    ),

    // Q2. School catchment — point-in-polygon
    withTimeout(
      db`
        SELECT s.nombre AS school_name, s.tipo AS school_type
        FROM school_catchments sc
        JOIN schools s ON s.id = sc.school_id
        WHERE ST_Within(
          ST_SetSRID(ST_MakePoint(${lng}::float, ${lat}::float), 4326),
          sc.geom::geometry
        )
        LIMIT 1`,
      'catchment',
    ),

    // Q3. Fibre broadband coverage
    withTimeout(
      db`
        SELECT operator, coverage_type
        FROM fibre_coverage
        WHERE ST_Within(
          ST_SetSRID(ST_MakePoint(${lng}::float, ${lat}::float), 4326),
          geom::geometry
        )
        LIMIT 1`,
      'fibre',
    ),

    // Q4. Nearest school (KNN) — 49 K national rows, GIST index on geography
    withTimeout(
      db`
        SELECT
          nombre AS name,
          tipo   AS type,
          ST_Distance(
            geom::geography,
            ST_MakePoint(${lng}::float, ${lat}::float)::geography
          )::float AS distance_m
        FROM schools
        ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${lng}::float, ${lat}::float), 4326)
        LIMIT 1`,
      'nearest_school',
    ),

    // Q5. Schools within 400 m
    withTimeout(
      db`
        SELECT COUNT(*)::int AS count
        FROM schools
        WHERE ST_DWithin(
          geom::geography,
          ST_MakePoint(${lng}::float, ${lat}::float)::geography,
          400
        )`,
      'school_count_400m',
    ),

    // Q6. Nearest GP + GP count 400 m (combined to save one round-trip)
    withTimeout(
      db`
        SELECT
          (SELECT nombre
           FROM health_centres
           WHERE tipo = 'centro_salud'
           ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${lng}::float, ${lat}::float), 4326)
           LIMIT 1) AS nearest_name,
          (SELECT ST_Distance(geom::geography, ST_MakePoint(${lng}::float, ${lat}::float)::geography)::float
           FROM health_centres
           WHERE tipo = 'centro_salud'
           ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${lng}::float, ${lat}::float), 4326)
           LIMIT 1) AS nearest_dist_m,
          (SELECT COUNT(*)::int
           FROM health_centres
           WHERE tipo = 'centro_salud'
             AND ST_DWithin(geom::geography, ST_MakePoint(${lng}::float, ${lat}::float)::geography, 400)
          ) AS count_400m`,
      'gp',
    ),

    // Q7. Nearest 24 h emergency centre
    withTimeout(
      db`
        SELECT
          nombre AS name,
          ST_Distance(
            geom::geography,
            ST_MakePoint(${lng}::float, ${lat}::float)::geography
          )::float AS distance_m
        FROM health_centres
        WHERE is_24h = true
        ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${lng}::float, ${lat}::float), 4326)
        LIMIT 1`,
      'nearest_emergency',
    ),

    // Q8. Nearest bus stop + count 400 m (combined)
    withTimeout(
      db`
        SELECT
          (SELECT nombre
           FROM transport_stops
           ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${lng}::float, ${lat}::float), 4326)
           LIMIT 1) AS nearest_name,
          (SELECT tipo
           FROM transport_stops
           ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${lng}::float, ${lat}::float), 4326)
           LIMIT 1) AS nearest_type,
          (SELECT ST_Distance(geom::geography, ST_MakePoint(${lng}::float, ${lat}::float)::geography)::float
           FROM transport_stops
           ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${lng}::float, ${lat}::float), 4326)
           LIMIT 1) AS nearest_dist_m,
          (SELECT COUNT(*)::int
           FROM transport_stops
           WHERE ST_DWithin(geom::geography, ST_MakePoint(${lng}::float, ${lat}::float)::geography, 400)
          ) AS count_400m`,
      'bus',
    ),

    // Q9. Solar irradiance (nearest PVGIS grid point)
    withTimeout(
      db`
        SELECT ghi_annual_kwh_m2::float AS ghi_annual_kwh_m2
        FROM solar_radiation
        ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${lng}::float, ${lat}::float), 4326)
        LIMIT 1`,
      'solar',
    ),

    // Q10. Climate — via postal-zone municipio text lookup (no geom on climate_data)
    withTimeout(
      db`
        SELECT
          sunshine_hours_annual::int AS sunshine_hours_annual,
          days_above_35c_annual::int AS days_above_35c_annual,
          temp_mean_annual_c::float  AS temp_mean_annual_c,
          temp_mean_jul_c::float     AS temp_mean_jul_c,
          temp_mean_jan_c::float     AS temp_mean_jan_c
        FROM climate_data
        WHERE municipio_name = (
          SELECT municipio FROM postal_zones
          WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint(${lng}::float, ${lat}::float), 4326))
             OR ST_DWithin(geom::geography, ST_MakePoint(${lng}::float, ${lat}::float)::geography, 50)
          ORDER BY ST_Distance(geom::geography, ST_MakePoint(${lng}::float, ${lat}::float)::geography)
          LIMIT 1
        )
        LIMIT 1`,
      'climate',
    ),

    // Q11. Nearest 2 airports
    withTimeout(
      db`
        SELECT
          nombre    AS name,
          iata_code,
          (ST_Distance(
            geom::geography,
            ST_MakePoint(${lng}::float, ${lat}::float)::geography
          ) / 1000)::float AS distance_km
        FROM airports
        ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${lng}::float, ${lat}::float), 4326)
        LIMIT 2`,
      'airports',
    ),

    // Q12. Active VUT licences within 200 m
    // geom IS NOT NULL guard is critical: all rows currently have geom = NULL
    // (Nominatim geocoding pending). Without it, ST_DWithin triggers a full scan.
    withTimeout(
      db`
        SELECT COUNT(*)::int AS count
        FROM vut_licences
        WHERE status = 'active'
          AND geom IS NOT NULL
          AND ST_DWithin(
            geom,
            ST_MakePoint(${lng}::float, ${lat}::float)::geography,
            200
          )`,
      'vut',
    ),

    // Q13. ECB rate constants (always fetched; only used when price_asking is set)
    withTimeout(
      db`
        SELECT
          ecb_base_rate_pct::float       AS ecb_base_rate_pct,
          typical_bank_spread_pct::float AS typical_bank_spread_pct
        FROM eco_constants
        ORDER BY updated_at DESC
        LIMIT 1`,
      'eco',
    ),

    // Q14. Postcode — for zone-report link in the pin panel.
    // Uses ST_Contains (includes boundary points — ST_Within can miss them) with a
    // ST_DWithin(50 m) fallback ordered by distance so points snapped to zone
    // edges or geocoded just outside a polygon boundary still resolve correctly.
    withTimeout(
      db`
        SELECT codigo_postal
        FROM postal_zones
        WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint(${lng}::float, ${lat}::float), 4326))
           OR ST_DWithin(
                geom::geography,
                ST_MakePoint(${lng}::float, ${lat}::float)::geography,
                50
              )
        ORDER BY ST_Distance(
          geom::geography,
          ST_MakePoint(${lng}::float, ${lat}::float)::geography
        )
        LIMIT 1`,
      'postal_zone',
    ),

    // Q15. ALL amenity metrics in one pass — replaces the 7 separate queries that
    // previously each scanned the 197 K-row amenities table independently.
    //
    // Strategy: one ST_DWithin(1 000 m) index scan materialises every amenity
    // within the outer radius; conditional aggregation then derives all counts
    // and nearest distances at the correct per-category radii.
    //
    // Radii per field:
    //   pharmacy / supermarket / park / cafe  → 800 m  (ProximitySummary display)
    //   daily_needs (pharmacy+supermarket+cafe+gp) → 400 m  (Daily Life Score)
    //   park_area_sqm → 500 m  (Daily Life Score)
    //   free_parking  → 1 000 m (Daily Life Score)
    withTimeout(
      db`
        SELECT
          -- ProximitySummary counts + nearest (800 m)
          COUNT(*)   FILTER (WHERE category = 'pharmacy'    AND dist_m <= 800)::int  AS pharmacy_count,
          MIN(dist_m) FILTER (WHERE category = 'pharmacy')::float                    AS pharmacy_nearest_m,
          COUNT(*)   FILTER (WHERE category = 'supermarket' AND dist_m <= 800)::int  AS supermarket_count,
          MIN(dist_m) FILTER (WHERE category = 'supermarket')::float                 AS supermarket_nearest_m,
          COUNT(*)   FILTER (WHERE category = 'park'        AND dist_m <= 800)::int  AS park_count,
          MIN(dist_m) FILTER (WHERE category = 'park')::float                        AS park_nearest_m,
          COUNT(*)   FILTER (WHERE display_category = 'cafe' AND dist_m <= 800)::int AS cafe_count,
          MIN(dist_m) FILTER (WHERE display_category = 'cafe')::float                AS cafe_nearest_m,
          -- Daily Life Score inputs
          COUNT(*)   FILTER (WHERE category IN ('pharmacy','supermarket','cafe','centro_salud') AND dist_m <= 400)::int AS daily_needs_400m,
          COALESCE(SUM(area_sqm) FILTER (WHERE category = 'park' AND dist_m <= 500), 0)::int AS park_area_sqm_500m,
          COUNT(*)   FILTER (WHERE category = 'parking_free' AND dist_m <= 1000)::int AS free_parking_1km
        FROM (
          SELECT
            category,
            display_category,
            area_sqm,
            ST_Distance(geom, ST_MakePoint(${lng}::float, ${lat}::float)::geography)::float AS dist_m
          FROM amenities
          WHERE ST_DWithin(geom, ST_MakePoint(${lng}::float, ${lat}::float)::geography, 1000)
        ) sub`,
      'amenities',
    ),

    // Q16. QoL extras — pedestrian/cycle zones + noise + nearest beach.
    // pedestrian_cycling_zones and noise_zones and beaches are currently empty
    // (data ingestion pending) so these sub-queries return quickly.
    // Kept as one combined CTE to avoid a round-trip per empty table.
    withTimeout(
      db`
        WITH
          mobility AS (
            SELECT
              COUNT(*) FILTER (WHERE zone_type LIKE 'pedestrian%')::int AS ped_count,
              COUNT(*) FILTER (WHERE zone_type LIKE 'cycle%' OR zone_type = 'shared_path')::int AS cyc_count
            FROM pedestrian_cycling_zones
            WHERE ST_DWithin(
              geom,
              ST_MakePoint(${lng}::float, ${lat}::float)::geography,
              500
            )
          ),
          noise AS (
            SELECT lden_min, lden_band, source
            FROM noise_zones
            WHERE ST_Intersects(
              ST_SetSRID(ST_MakePoint(${lng}::float, ${lat}::float), 4326)::geography,
              geom
            )
            ORDER BY lden_min DESC
            LIMIT 1
          ),
          beach AS (
            SELECT
              ST_Distance(geom, ST_MakePoint(${lng}::float, ${lat}::float)::geography)::int AS dist_m,
              nombre
            FROM beaches
            ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${lng}::float, ${lat}::float), 4326)
            LIMIT 1
          )
        SELECT
          mobility.ped_count,
          mobility.cyc_count,
          noise.lden_min   AS noise_lden,
          noise.lden_band  AS noise_band,
          noise.source     AS noise_source,
          CASE WHEN beach.dist_m <= 15000 THEN beach.dist_m  ELSE NULL END AS nearest_beach_m,
          CASE WHEN beach.dist_m <= 15000 THEN beach.nombre  ELSE NULL END AS nearest_beach_name
        FROM mobility
        LEFT JOIN noise  ON TRUE
        LEFT JOIN beach  ON TRUE`,
      'qol_extras',
    ),

  ]);

  // ---- Unwrap allSettled results with typed fallbacks -----------------------

  const flood        = settled(results[0],  [], 'flood');
  const catchment    = settled(results[1],  [], 'catchment');
  const fibre        = settled(results[2],  [], 'fibre');
  const nearestSchool = settled(results[3], [], 'nearest_school');
  const schoolCount  = settled(results[4],  [{ count: 0 }], 'school_count');
  const gpRow        = settled(results[5],  [{ nearest_name: null, nearest_dist_m: null, count_400m: 0 }], 'gp');
  const nearestEmerg = settled(results[6],  [], 'nearest_emergency');
  const busRow       = settled(results[7],  [{ nearest_name: null, nearest_type: null, nearest_dist_m: null, count_400m: 0 }], 'bus');
  const solar        = settled(results[8],  [], 'solar');
  const climate      = settled(results[9],  [], 'climate');
  const airports     = settled(results[10], [], 'airports');
  const vutRow       = settled(results[11], [{ count: 0 }], 'vut');
  const ecoRow       = settled(results[12], [], 'eco');
  const postalZone   = settled(results[13], [], 'postal_zone');
  const amenityRow   = settled(results[14], [{}], 'amenities');
  const qolExtras    = settled(results[15], [{ ped_count: 0, cyc_count: 0, noise_lden: null, noise_band: null, noise_source: null, nearest_beach_m: null, nearest_beach_name: null }], 'qol_extras');

  // ---- Typed accessors ------------------------------------------------------

  type CountRow        = { count: number };
  type SchoolRow       = { name: string; type: string; distance_m: number };
  type GPRow           = { nearest_name: string | null; nearest_dist_m: number | null; count_400m: number };
  type BusRow          = { nearest_name: string | null; nearest_type: string | null; nearest_dist_m: number | null; count_400m: number };
  type EmergRow        = { name: string; distance_m: number };
  type SolarRow        = { ghi_annual_kwh_m2: number };
  type AirportRow      = { name: string; iata_code: string; distance_km: number };
  type EcoRow          = { ecb_base_rate_pct: number; typical_bank_spread_pct: number };
  type AmenityMetrics  = {
    pharmacy_count: number; pharmacy_nearest_m: number | null;
    supermarket_count: number; supermarket_nearest_m: number | null;
    park_count: number; park_nearest_m: number | null;
    cafe_count: number; cafe_nearest_m: number | null;
    daily_needs_400m: number; park_area_sqm_500m: number; free_parking_1km: number;
  };
  type QolExtrasRow = {
    ped_count: number; cyc_count: number;
    noise_lden: number | null; noise_band: string | null; noise_source: string | null;
    nearest_beach_m: number | null; nearest_beach_name: string | null;
  };

  const gp     = (gpRow[0]  as GPRow  | undefined);
  const bus    = (busRow[0] as BusRow | undefined);
  const am     = (amenityRow[0] as AmenityMetrics | undefined);
  const qe     = (qolExtras[0]  as QolExtrasRow   | undefined);

  const catchmentData = (catchment[0] as { school_name: string; school_type: string } | undefined);

  // ---- Flood ----------------------------------------------------------------
  const riskLevels = new Set((flood as { risk_level: string }[]).map(r => r.risk_level));
  const floodResult = {
    in_t10:  riskLevels.has('T10'),
    in_t100: riskLevels.has('T100') || riskLevels.has('T10'),
    in_t500: riskLevels.has('T500') || riskLevels.has('T100') || riskLevels.has('T10'),
  };

  // ---- Financial estimate ---------------------------------------------------
  let financialEstimate: {
    mortgage_monthly: number; ibi_monthly: number;
    energy_monthly: number; community_monthly: number;
    mortgage_rate_pct: number; mortgage_term: number;
  } | null = null;

  if (priceNum !== null) {
    const eco = (ecoRow[0] as EcoRow | undefined);
    const annualRate = eco ? eco.ecb_base_rate_pct + eco.typical_bank_spread_pct : 4.6;
    financialEstimate = {
      mortgage_monthly:  calcMortgage(priceNum * 0.80, annualRate, 25),
      ibi_monthly:       Math.round(priceNum * 0.004 / 12),
      energy_monthly:    areaNum ? Math.round(areaNum * 8) : 80,
      community_monthly: 75,
      mortgage_rate_pct: annualRate,
      mortgage_term:     25,
    };
  }

  // ---- QoL scores -----------------------------------------------------------

  const dailyNeeds    = am?.daily_needs_400m    ?? 0;
  const parkSqm       = am?.park_area_sqm_500m  ?? 0;
  const pedCount      = qe?.ped_count           ?? 0;
  const cycCount      = qe?.cyc_count           ?? 0;
  const nearestBeachM = qe?.nearest_beach_m     ?? null;
  const noiseLden     = qe?.noise_lden          ?? null;

  // Daily Life Score (mirrors lib/indicators/daily-life-score.ts)
  const walkScore     = Math.min(dailyNeeds * 15, 60);
  const mobilityScore = Math.min(pedCount * 5, 20) + Math.min(cycCount * 3, 20);
  const greenScore    = Math.min((parkSqm / 1000) * 10, 20);
  const beachScore    = nearestBeachM != null ? Math.max(0, 20 - nearestBeachM / 250) : 0;
  const dailyLifeScore = Math.round(
    walkScore * 0.40 + mobilityScore * 0.30 + greenScore * 0.20 + beachScore * 0.10
  );

  // Sensory Environment Score (mirrors lib/indicators/sensory-environment.ts)
  const sNoiseScore  = noiseLden != null ? Math.max(0, 100 - (noiseLden - 35) * 3.5) : 65;
  const sGreenScore  = Math.min(parkSqm / 5000, 1.0) * 100;
  const sensoryScore = Math.round(sNoiseScore * 0.45 + 70 * 0.35 + sGreenScore * 0.20);

  // Community Stability Score (mirrors lib/indicators/community-stability.ts)
  const csVutScore     = Math.max(0, 100 - (vutRow[0] as CountRow).count * 2);
  const csNoiseScore   = noiseLden != null ? Math.max(0, 100 - (noiseLden - 40) * 4) : 70;
  const communityScore = Math.round(csVutScore * 0.40 + 60 * 0.20 + 50 * 0.20 + csNoiseScore * 0.20);

  // ---- Facilities summary ---------------------------------------------------

  const facilities = {
    gp_count:              gp?.count_400m        ?? 0,
    gp_nearest_m:          gp?.nearest_dist_m    ?? 0,
    pharmacy_count:        am?.pharmacy_count     ?? 0,
    pharmacy_nearest_m:    am?.pharmacy_nearest_m ?? 0,
    school_primary_count:  (schoolCount[0] as CountRow).count,
    school_nearest_m:      (nearestSchool[0] as SchoolRow | undefined)?.distance_m ?? 0,
    school_in_catchment:   catchmentData !== undefined,
    school_catchment_name: catchmentData?.school_name,
    metro_count:           0,   // not ingested — bus only
    metro_nearest_m:       0,
    bus_stops_count:       bus?.count_400m        ?? 0,
    bus_nearest_m:         bus?.nearest_dist_m    ?? 0,
    supermarket_count:     am?.supermarket_count  ?? 0,
    supermarket_nearest_m: am?.supermarket_nearest_m ?? 0,
    park_count:            am?.park_count         ?? 0,
    park_nearest_m:        am?.park_nearest_m     ?? 0,
    cafe_count:            am?.cafe_count         ?? 0,
    cafe_nearest_m:        am?.cafe_nearest_m     ?? 0,
  };

  // ---- Response -------------------------------------------------------------

  return NextResponse.json(
    {
      lat,
      lng,
      price_asking: priceNum,
      area_sqm:     areaNum,
      flood:        floodResult,
      catchment:    catchmentData
        ? { school_name: catchmentData.school_name, school_type: catchmentData.school_type }
        : null,
      fibre: fibre[0]
        ? { operator: (fibre[0] as { operator: string; coverage_type: string }).operator,
            coverage_type: (fibre[0] as { operator: string; coverage_type: string }).coverage_type }
        : null,
      nearest_school:    nearestSchool[0]    ?? null,
      nearest_gp:        gp?.nearest_name    ? { name: gp.nearest_name, distance_m: gp.nearest_dist_m } : null,
      nearest_emergency: (nearestEmerg[0] as EmergRow | undefined) ?? null,
      nearest_transport: bus?.nearest_name   ? { name: bus.nearest_name, type: bus.nearest_type, distance_m: bus.nearest_dist_m } : null,
      solar:   solar[0]   ? { ghi_annual_kwh_m2: (solar[0] as SolarRow).ghi_annual_kwh_m2 } : null,
      climate: climate[0] ?? null,
      airports: (airports as unknown) as AirportRow[],
      vut_count_200m: (vutRow[0] as CountRow).count,
      facilities,
      financial: financialEstimate,
      codigo_postal: (postalZone[0] as { codigo_postal: string } | undefined)?.codigo_postal ?? null,
      qol_scores: {
        daily_life_score:          dailyLifeScore,
        sensory_environment_score: sensoryScore,
        community_stability_score: communityScore,
        noise_lden:                noiseLden,
        noise_band:                qe?.noise_band          ?? null,
        nearest_beach_m:           nearestBeachM,
        nearest_beach_name:        qe?.nearest_beach_name  ?? null,
      },
      generated_at: new Date().toISOString(),
    },
    {
      headers: { 'Cache-Control': 'public, max-age=900' },
    }
  );
}
