/**
 * Indicator 17 — Sensory Environment Score
 *
 * What it tells the user: What this place actually feels and sounds like to live
 * in — the sensory quality of the immediate environment, combining noise,
 * air quality, and green exposure.
 *
 * New indicator introduced in the QoL Enrichment Layer (CHI-377).
 *
 * Inputs:
 * - Noise Lden at property coordinates — from noise_zones (EEA / ENAIRE)
 * - Annual AQI average — from air_quality_readings (nearest station)
 * - Park area within 500m — from amenities (category='park')
 */
import type { Sql } from 'postgres'
import type { PropertyInput, IndicatorResult, Alert } from './types'

export async function calcSensoryEnvironment(
  sql: Sql,
  property: PropertyInput,
): Promise<IndicatorResult & { details: Record<string, unknown> }> {
  const alerts: Alert[] = []

  // --- Single CTE: noise zone, nearest AQI station, green space ---
  const [row] = await sql<{
    noise_lden_min:    number | null
    noise_band:        string | null
    aqi_annual_avg:    number | null
    aqi_station_name:  string | null
    aqi_station_dist:  number | null
    pm25_ugm3:         number | null
    no2_ugm3:          number | null
    park_area_sqm:     number | null
    nearest_park_m:    number | null
  }[]>`
    WITH
      noise AS (
        SELECT lden_min, lden_band
        FROM noise_zones
        WHERE ST_Intersects(
          ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY,
          geom
        )
        ORDER BY lden_min DESC
        LIMIT 1
      ),
      aqi AS (
        SELECT
          aqi_annual_avg,
          station_name,
          pm25_ugm3,
          no2_ugm3,
          ST_Distance(
            geom,
            ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY
          )::int AS dist_m
        FROM air_quality_readings
        WHERE geom IS NOT NULL
          AND aqi_annual_avg IS NOT NULL
        ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY
        LIMIT 1
      ),
      green AS (
        SELECT
          COALESCE(SUM(area_sqm), 0)::int AS total_sqm,
          MIN(
            ST_Distance(
              geom,
              ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY
            )
          )::int AS nearest_m
        FROM amenities
        WHERE category = 'park'
          AND ST_DWithin(
            geom,
            ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY,
            500
          )
      )
    SELECT
      noise.lden_min         AS noise_lden_min,
      noise.lden_band        AS noise_band,
      aqi.aqi_annual_avg     AS aqi_annual_avg,
      aqi.station_name       AS aqi_station_name,
      aqi.dist_m             AS aqi_station_dist,
      aqi.pm25_ugm3          AS pm25_ugm3,
      aqi.no2_ugm3           AS no2_ugm3,
      green.total_sqm        AS park_area_sqm,
      green.nearest_m        AS nearest_park_m
    FROM (SELECT 1) dummy
    LEFT JOIN noise ON TRUE
    LEFT JOIN aqi   ON TRUE
    LEFT JOIN green ON TRUE
  `

  const noiseLden   = row?.noise_lden_min ?? null
  const aqiAvg      = row?.aqi_annual_avg ?? null
  const parkAreaSqm = row?.park_area_sqm  ?? 0

  // --- Noise score ---
  // 35 dB (countryside quiet) = 100, 75 dB (heavy road) = 0
  // Neutral default 65 when no EEA data available (urban assumption)
  const noiseScore = noiseLden != null
    ? Math.max(0, 100 - (noiseLden - 35) * 3.5)
    : 65

  // --- Air quality score ---
  // AQI 0 = 100 (perfect), AQI 50 = 0 (very poor)
  // Neutral default 70 (national average assumption)
  const aqiScore = aqiAvg != null
    ? Math.max(0, 100 - aqiAvg * 2)
    : 70

  // --- Green exposure score ---
  // Ratio of park area to 5000 sqm cap, scaled to 0-100
  const greenRatio = Math.min(parkAreaSqm / 5000, 1.0)
  const greenScore = greenRatio * 100

  // --- Final weighted score ---
  const score = Math.round(
    noiseScore * 0.45 +
    aqiScore   * 0.35 +
    greenScore * 0.20,
  )

  // --- Confidence ---
  // High if noise data available (most reliable input, geographically precise)
  // Medium if only AQI available (station may be km away)
  // Low if neither
  const confidence = noiseLden != null ? 'high'
    : aqiAvg != null ? 'medium'
    : 'low'

  // --- Alerts ---
  if (noiseLden !== null && noiseLden >= 65) {
    alerts.push({
      type: 'red',
      category: 'sensory',
      title: 'Zona de alto ruido',
      description: `Nivel de ruido Lden de ${noiseLden} dB — equivalente a una calle muy transitada. Fuente: Mapa Estratégico de Ruido UE.`,
    })
  } else if (noiseLden !== null && noiseLden >= 60) {
    alerts.push({
      type: 'amber',
      category: 'sensory',
      title: 'Ruido moderado-alto',
      description: `Nivel de ruido Lden de ${noiseLden} dB. Fuente: Mapa Estratégico de Ruido UE.`,
    })
  }

  if (aqiAvg !== null && aqiAvg > 35) {
    alerts.push({
      type: 'amber',
      category: 'sensory',
      title: 'Calidad del aire mejorable',
      description: `ICA medio anual: ${aqiAvg.toFixed(0)}. Por encima del promedio nacional (~25).`,
    })
  }

  return {
    score,
    confidence,
    details: {
      noise_lden:          noiseLden,
      noise_band:          row?.noise_band ?? null,
      aqi_annual_avg:      aqiAvg != null ? Math.round(aqiAvg * 10) / 10 : null,
      aqi_station_name:    row?.aqi_station_name ?? null,
      aqi_station_dist_m:  row?.aqi_station_dist ?? null,
      pm25_ugm3:           row?.pm25_ugm3 ?? null,
      no2_ugm3:            row?.no2_ugm3  ?? null,
      park_area_sqm_500m:  parkAreaSqm,
      nearest_green_m:     row?.nearest_park_m ?? null,
      sub_scores: {
        noise: Math.round(noiseScore),
        aqi:   Math.round(aqiScore),
        green: Math.round(greenScore),
      },
    },
    alerts,
  }
}
