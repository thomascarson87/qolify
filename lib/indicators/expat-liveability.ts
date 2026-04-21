/**
 * Indicator 12 — Expat Liveability Score
 *
 * What it tells the user: International buyer suitability —
 * airport access, English-speaking amenities, expat community signals.
 *
 * Phase 0: Airport proximity only (data available from seed).
 * Later phases: add expat community signals, English services.
 *
 * CTE consolidation (CHI-334): 2 separate queries merged into 1 using RANK().
 */
import type { Sql } from 'postgres'
import type { PropertyInput, IndicatorResult, Alert } from './types'
import { distanceToScore } from './utils'

export async function calcExpatLiveability(
  sql: Sql,
  property: PropertyInput,
): Promise<IndicatorResult & { details: Record<string, unknown> }> {
  const alerts: Alert[] = []

  // --- Single CTE: top-2 nearest airports using ROW_NUMBER() ---
  // Note: ROW_NUMBER() returns BIGINT, which postgres.js returns as a BigInt
  // (or string, depending on config). Cast to INT in SQL AND use Number(r.rn) in JS
  // so the strict === comparison below can never silently return undefined.
  // Historical bug (CHI-405): without this, expat_liveability.score was always null.
  const rows = await sql<{
    dist_m: number; nombre: string; iata_code: string; weekly_flights: number; rn: number
  }[]>`
    WITH ranked AS (
      SELECT
        ST_Distance(
          geom,
          ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY
        ) AS dist_m,
        nombre,
        iata_code,
        weekly_flights,
        ROW_NUMBER() OVER (
          ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY
        )::int AS rn
      FROM airports
    )
    SELECT dist_m, nombre, iata_code, weekly_flights, rn
    FROM ranked
    WHERE rn <= 2
  `

  const nearest = rows.find((r) => Number(r.rn) === 1) ?? null
  const second  = rows.find((r) => Number(r.rn) === 2) ?? null

  const distM  = nearest?.dist_m ? Math.round(nearest.dist_m) : null
  const distKm = distM != null ? distM / 1000 : null

  const airportScore = distanceToScore(distM, 20_000, 150_000)
  const flightBonus  = nearest ? Math.min(nearest.weekly_flights / 100, 20) : 0
  const score        = Math.min(100, Math.round(airportScore * 0.80 + flightBonus))

  if (distKm !== null && distKm > 100) {
    alerts.push({ type: 'amber', category: 'expat', title: 'Airport is far away', description: `Nearest airport (${nearest?.iata_code}) is ${Math.round(distKm)} km away.` })
  }

  return {
    score: nearest ? score : null,
    confidence: nearest ? 'high' : 'low',
    details: {
      nearest_airport_km:             distKm != null ? Math.round(distKm) : null,
      nearest_airport_iata:           nearest?.iata_code ?? null,
      nearest_airport_nombre:         nearest?.nombre ?? null,
      nearest_airport_weekly_flights: nearest?.weekly_flights ?? null,
      second_airport_iata:            second?.iata_code ?? null,
      second_airport_km:              second?.dist_m ? Math.round(second.dist_m / 1000) : null,
    },
    alerts,
  }
}
