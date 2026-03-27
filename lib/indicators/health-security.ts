/**
 * Indicator 4 — Health Security Score
 *
 * What it tells the user: Practical access to healthcare — not just proximity,
 * but the right type at the right time.
 */
import type { Sql } from 'postgres'
import type { PropertyInput, IndicatorResult, Alert } from './types'
import { distanceToScore } from './utils'

export async function calcHealthSecurity(
  sql: Sql,
  property: PropertyInput,
): Promise<IndicatorResult & { details: Record<string, unknown> }> {
  const alerts: Alert[] = []

  // --- Nearest GP (centro de salud) ---
  const [gp] = await sql<{ dist_m: number; nombre: string | null }[]>`
    SELECT
      ST_Distance(geom, ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY) AS dist_m,
      nombre
    FROM health_centres
    WHERE tipo = 'centro_salud'
    ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY
    LIMIT 1
  `

  // --- Nearest 24h emergency ---
  const [er] = await sql<{ dist_m: number; nombre: string | null }[]>`
    SELECT
      ST_Distance(geom, ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY) AS dist_m,
      nombre
    FROM health_centres
    WHERE is_24h = TRUE
    ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY
    LIMIT 1
  `

  // --- Pharmacies within 500m ---
  const [pharmResult] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM amenities
    WHERE category = 'pharmacy'
      AND ST_DWithin(
        geom,
        ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY,
        500
      )
  `
  const pharmacyCount = pharmResult?.count ?? 0

  // --- Scores ---
  const gpDistM    = gp?.dist_m    ? Math.round(gp.dist_m)    : null
  const erDistM    = er?.dist_m    ? Math.round(er.dist_m)    : null

  const gpScore    = distanceToScore(gpDistM,  300,  3000)
  const erScore    = distanceToScore(erDistM, 1000,  8000)
  const pharmScore = Math.min(pharmacyCount * 25, 100)

  const score = Math.round(gpScore * 0.40 + erScore * 0.40 + pharmScore * 0.20)

  // --- Alerts ---
  if (gpDistM !== null && gpDistM > 3000) {
    alerts.push({
      type: 'amber',
      category: 'health',
      title: 'Centro de salud alejado',
      description: `El centro de salud más cercano está a ${(gpDistM / 1000).toFixed(1)} km.`,
    })
  }
  if (erDistM !== null && erDistM > 8000) {
    alerts.push({
      type: 'red',
      category: 'health',
      title: 'Urgencias muy alejadas',
      description: `Las urgencias 24h más cercanas están a ${(erDistM / 1000).toFixed(1)} km.`,
    })
  }

  const hasData = gp !== undefined || er !== undefined
  return {
    score: hasData ? score : null,
    confidence: hasData ? 'high' : 'low',
    details: {
      nearest_gp_m:        gpDistM,
      nearest_gp_nombre:   gp?.nombre ?? null,
      nearest_er_m:        erDistM,
      nearest_er_nombre:   er?.nombre ?? null,
      pharmacy_count_500m: pharmacyCount,
    },
    alerts,
  }
}
