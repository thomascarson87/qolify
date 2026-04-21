/**
 * Indicator 16 — Daily Life Score
 *
 * What it tells the user: Whether this location supports a walkable, car-optional
 * daily life — a question portals never answer and that determines daily quality
 * of life more than almost any other factor.
 *
 * New indicator introduced in the QoL Enrichment Layer (CHI-377).
 *
 * Inputs:
 * - Daily needs (pharmacy, supermarket, café, GP) within 400m — from amenities
 * - Pedestrian zone features within 500m — from pedestrian_cycling_zones
 * - Cycling infrastructure within 500m — from pedestrian_cycling_zones
 * - Free parking within 1km — from amenities (category='parking_free')
 * - Nearest park area_sqm within 500m — from amenities
 * - Nearest beach distance — from beaches (optional)
 */
import type { Sql } from 'postgres'
import type { PropertyInput, IndicatorResult, Alert } from './types'

export async function calcDailyLifeScore(
  sql: Sql,
  property: PropertyInput,
): Promise<IndicatorResult & { details: Record<string, unknown> }> {
  const alerts: Alert[] = []

  // --- Single CTE covering all daily life data sources ---
  const [row] = await sql<{
    daily_needs_count:   number
    pedestrian_count:    number
    cycle_count:         number
    park_area_sqm:       number | null
    free_parking_count:  number
    nearest_beach_m:     number | null
    nearest_beach_name:  string | null
  }[]>`
    WITH
      daily_needs AS (
        SELECT COUNT(*)::int AS cnt
        FROM amenities
        WHERE category IN ('pharmacy', 'supermarket', 'cafe', 'centro_salud')
          AND ST_DWithin(
            geom,
            ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY,
            400
          )
      ),
      mobility AS (
        SELECT
          COUNT(*) FILTER (WHERE zone_type LIKE 'pedestrian%')::int AS ped_count,
          COUNT(*) FILTER (WHERE zone_type LIKE 'cycle%' OR zone_type = 'shared_path')::int AS cyc_count
        FROM pedestrian_cycling_zones
        WHERE ST_DWithin(
          geom,
          ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY,
          500
        )
      ),
      green AS (
        SELECT COALESCE(SUM(area_sqm), 0)::int AS total_sqm
        FROM amenities
        WHERE category = 'park'
          AND ST_DWithin(
            geom,
            ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY,
            500
          )
      ),
      parking AS (
        SELECT COUNT(*)::int AS cnt
        FROM amenities
        WHERE category = 'parking_free'
          AND ST_DWithin(
            geom,
            ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY,
            1000
          )
      ),
      beach AS (
        SELECT
          ST_Distance(
            geom,
            ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY
          )::int AS dist_m,
          nombre
        FROM beaches
        ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY
        LIMIT 1
      )
    SELECT
      dn.cnt                AS daily_needs_count,
      mo.ped_count          AS pedestrian_count,
      mo.cyc_count          AS cycle_count,
      gr.total_sqm          AS park_area_sqm,
      pk.cnt                AS free_parking_count,
      -- Only expose beach if within 15km (not relevant beyond that distance)
      CASE WHEN b.dist_m <= 15000 THEN b.dist_m ELSE NULL END AS nearest_beach_m,
      CASE WHEN b.dist_m <= 15000 THEN b.nombre  ELSE NULL END AS nearest_beach_name
    FROM daily_needs dn
    CROSS JOIN mobility mo
    CROSS JOIN green gr
    CROSS JOIN parking pk
    LEFT JOIN beach b ON TRUE
  `

  const dailyNeedsCount  = row?.daily_needs_count  ?? 0
  const pedestrianCount  = row?.pedestrian_count   ?? 0
  const cycleCount       = row?.cycle_count        ?? 0
  const parkAreaSqm      = row?.park_area_sqm      ?? 0
  const freeParkingCount = row?.free_parking_count ?? 0
  const nearestBeachM    = row?.nearest_beach_m    ?? null

  // --- Sub-scores ---
  // Walkability: daily needs within 400m (max 60 pts)
  const walkScore     = Math.min(dailyNeedsCount * 15, 60)

  // Active mobility: pedestrian + cycling features within 500m (max 40 pts)
  const pedScore      = Math.min(pedestrianCount * 5, 20)
  const cycScore      = Math.min(cycleCount * 3, 20)
  const mobilityScore = pedScore + cycScore

  // Green space: park area within 500m — 2000 sqm = 20 pts (max 20 pts)
  const greenScore    = Math.min((parkAreaSqm / 1000) * 10, 20)

  // Parking: free car parks within 1km (max 15 pts)
  // (not in the ICP-weighted formula, used as context)
  const parkingScore  = Math.min(freeParkingCount * 5, 15)

  // Beach: 0m = 20 pts, 5km = 0 pts
  const beachScore    = nearestBeachM != null
    ? Math.max(0, 20 - nearestBeachM / 250)
    : 0

  // --- Base score (ICP reweighting applied at TVI composition, not here) ---
  const score = Math.round(
    walkScore     * 0.40 +
    mobilityScore * 0.30 +
    greenScore    * 0.20 +
    beachScore    * 0.10,
  )

  // Walkability sub-score (normalised to 0-100 for display)
  const walkabilitySubScore = Math.round(Math.min(walkScore / 0.60, 100))

  // --- Alerts ---
  if (dailyNeedsCount === 0) {
    alerts.push({
      type: 'amber',
      category: 'daily_life',
      title: 'No walkable daily services',
      description: 'No pharmacy, supermarket, café or GP found within 400m.',
    })
  }

  if (pedestrianCount === 0 && cycleCount === 0) {
    alerts.push({
      type: 'amber',
      category: 'daily_life',
      title: 'No pedestrian or cycling infrastructure',
      description: 'No pedestrian zones or cycle lanes detected within 500m.',
    })
  }

  // Confidence: high once mobility data is ingested (pedestrian or cycle features found),
  // medium if daily needs data exists but no mobility data yet
  const confidence = (pedestrianCount > 0 || cycleCount > 0) ? 'high' : 'medium'

  return {
    score,
    confidence,
    details: {
      walkability_sub_score:    walkabilitySubScore,
      daily_needs_count_400m:   dailyNeedsCount,
      pedestrian_count_500m:    pedestrianCount,
      cycle_count_500m:         cycleCount,
      park_area_sqm_500m:       parkAreaSqm,
      free_parking_count_1km:   freeParkingCount,
      nearest_beach_m:          nearestBeachM,
      nearest_beach_name:       row?.nearest_beach_name ?? null,
      sub_scores: {
        walk:     Math.round(walkScore),
        mobility: Math.round(mobilityScore),
        green:    Math.round(greenScore),
        beach:    Math.round(beachScore),
        parking:  Math.round(parkingScore),
      },
    },
    alerts,
  }
}
