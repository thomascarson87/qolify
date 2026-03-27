/**
 * Indicator 12 — Expat Liveability Score
 *
 * What it tells the user: International buyer suitability —
 * airport access, English-speaking amenities, expat community signals.
 *
 * Phase 0: Airport proximity only (data available from seed).
 * Later phases: add expat community signals, English services.
 */
import type { Sql } from 'postgres'
import type { PropertyInput, IndicatorResult, Alert } from './types'
import { distanceToScore } from './utils'

export async function calcExpatLiveability(
  sql: Sql,
  property: PropertyInput,
): Promise<IndicatorResult & { details: Record<string, unknown> }> {
  const alerts: Alert[] = []

  // --- Nearest airport ---
  const [airport] = await sql<{
    dist_m: number
    nombre: string
    iata_code: string
    weekly_flights: number
  }[]>`
    SELECT
      ST_Distance(geom, ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY) AS dist_m,
      nombre,
      iata_code,
      weekly_flights
    FROM airports
    ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY
    LIMIT 1
  `

  // --- Second nearest (for international coverage) ---
  const [airport2] = await sql<{
    dist_m: number
    iata_code: string
    weekly_flights: number
  }[]>`
    SELECT
      ST_Distance(geom, ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY) AS dist_m,
      iata_code,
      weekly_flights
    FROM airports
    WHERE iata_code != ${airport?.iata_code ?? ''}
    ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY
    LIMIT 1
  `

  const distM   = airport?.dist_m ? Math.round(airport.dist_m) : null
  const distKm  = distM != null ? distM / 1000 : null

  // Airport score: 100 at ≤ 20km, 0 at 150km
  const airportScore = distanceToScore(distM, 20_000, 150_000)

  // Flight frequency bonus: large airports (>2000 weekly) get a bonus
  const flightBonus = airport
    ? Math.min((airport.weekly_flights / 100), 20)  // up to 20 pts
    : 0

  const score = Math.min(100, Math.round(airportScore * 0.80 + flightBonus))

  // --- Alerts ---
  if (distKm !== null && distKm > 100) {
    alerts.push({
      type: 'amber',
      category: 'expat',
      title: 'Aeropuerto alejado',
      description: `El aeropuerto más cercano (${airport?.iata_code}) está a ${Math.round(distKm)} km.`,
    })
  }

  return {
    score: airport ? score : null,
    confidence: airport ? 'high' : 'low',
    details: {
      nearest_airport_km:            distKm != null ? Math.round(distKm) : null,
      nearest_airport_iata:          airport?.iata_code ?? null,
      nearest_airport_nombre:        airport?.nombre ?? null,
      nearest_airport_weekly_flights: airport?.weekly_flights ?? null,
      second_airport_iata:           airport2?.iata_code ?? null,
      second_airport_km:             airport2?.dist_m ? Math.round(airport2.dist_m / 1000) : null,
    },
    alerts,
  }
}
