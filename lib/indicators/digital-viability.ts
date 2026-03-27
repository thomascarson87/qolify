/**
 * Indicator 3 — Digital Viability Score
 *
 * What it tells the user: Whether this property supports reliable remote work.
 */
import type { Sql } from 'postgres'
import type { PropertyInput, IndicatorResult, Alert } from './types'

const FIBRE_SCORE: Record<string, number> = {
  FTTP: 100,
  FTTC: 60,
  HFC:  45,
  none: 0,
}

export async function calcDigitalViability(
  sql: Sql,
  property: PropertyInput,
): Promise<IndicatorResult & { details: Record<string, unknown> }> {
  const alerts: Alert[] = []

  // --- Fibre coverage at property coordinates ---
  const [fibre] = await sql<{ coverage_type: string; max_speed_mbps: number | null }[]>`
    SELECT coverage_type, max_speed_mbps
    FROM fibre_coverage
    WHERE ST_DWithin(
      geom,
      ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY,
      100
    )
    ORDER BY
      CASE coverage_type
        WHEN 'FTTP' THEN 0
        WHEN 'HFC'  THEN 1
        WHEN 'FTTC' THEN 2
        ELSE 3
      END
    LIMIT 1
  `

  // --- Coworking spaces within 2km ---
  const [coworkResult] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM amenities
    WHERE category = 'coworking'
      AND ST_DWithin(
        geom,
        ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY,
        2000
      )
  `
  const coworkingCount = coworkResult?.count ?? 0

  // --- Score ---
  const fibreType = fibre?.coverage_type ?? null
  const fibreScore = fibreType ? (FIBRE_SCORE[fibreType] ?? 0) : 0
  const coworkBonus = Math.min(coworkingCount * 8, 20)
  const score = Math.min(100, Math.round(fibreScore + coworkBonus))

  // --- Alerts ---
  if (!fibreType || fibreType === 'none') {
    alerts.push({
      type: 'red',
      category: 'connectivity',
      title: 'Sin cobertura de fibra',
      description: 'Esta propiedad no tiene cobertura de fibra óptica registrada.',
    })
  } else if (fibreType === 'FTTC' || fibreType === 'HFC') {
    alerts.push({
      type: 'amber',
      category: 'connectivity',
      title: 'Fibra parcial',
      description: `La cobertura disponible es ${fibreType}, no fibra directa al hogar (FTTP).`,
    })
  }

  return {
    score: fibreType !== null ? score : null,
    confidence: fibreType !== null ? 'high' : 'low',
    details: {
      fibre_type:           fibreType,
      max_speed_mbps:       fibre?.max_speed_mbps ?? null,
      coworking_count_2km:  coworkingCount,
    },
    alerts,
  }
}
