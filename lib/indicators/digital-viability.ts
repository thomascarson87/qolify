/**
 * Indicator 3 — Digital Viability Score
 *
 * What it tells the user: Whether this property supports reliable remote work.
 *
 * CTE consolidation (CHI-334): 2 separate queries merged into 1.
 */
import type { Sql } from 'postgres'
import type { PropertyInput, IndicatorResult, Alert } from './types'

const FIBRE_SCORE: Record<string, number> = { FTTP: 100, FTTC: 60, HFC: 45, none: 0 }

export async function calcDigitalViability(
  sql: Sql,
  property: PropertyInput,
): Promise<IndicatorResult & { details: Record<string, unknown> }> {
  const alerts: Alert[] = []

  // --- Single CTE: fibre_coverage + amenities (coworking count) ---
  const [row] = await sql<{
    coverage_type: string | null
    max_speed_mbps: number | null
    coworking_count: number
  }[]>`
    WITH
      fibre AS (
        SELECT coverage_type, max_speed_mbps
        FROM fibre_coverage
        WHERE ST_DWithin(
          geom,
          ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY,
          100
        )
        ORDER BY
          CASE coverage_type WHEN 'FTTP' THEN 0 WHEN 'HFC' THEN 1 WHEN 'FTTC' THEN 2 ELSE 3 END
        LIMIT 1
      ),
      cowork AS (
        SELECT COUNT(*)::int AS count
        FROM amenities
        WHERE category = 'coworking'
          AND ST_DWithin(
            geom,
            ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY,
            2000
          )
      )
    SELECT
      fibre.coverage_type,
      fibre.max_speed_mbps,
      cowork.count AS coworking_count
    FROM (SELECT 1) dummy
    LEFT JOIN fibre  ON TRUE
    CROSS JOIN cowork
  `

  const fibreType  = row?.coverage_type ?? null
  const fibreScore = fibreType ? (FIBRE_SCORE[fibreType] ?? 0) : 0
  const coworkBonus = Math.min((row?.coworking_count ?? 0) * 8, 20)
  const score = Math.min(100, Math.round(fibreScore + coworkBonus))

  if (!fibreType || fibreType === 'none') {
    alerts.push({ type: 'red',   category: 'connectivity', title: 'Sin cobertura de fibra', description: 'Esta propiedad no tiene cobertura de fibra óptica registrada.' })
  } else if (fibreType === 'FTTC' || fibreType === 'HFC') {
    alerts.push({ type: 'amber', category: 'connectivity', title: 'Fibra parcial',           description: `La cobertura disponible es ${fibreType}, no fibra directa al hogar (FTTP).` })
  }

  return {
    score: fibreType !== null ? score : null,
    confidence: fibreType !== null ? 'high' : 'low',
    details: {
      fibre_type:          fibreType,
      max_speed_mbps:      row?.max_speed_mbps ?? null,
      coworking_count_2km: row?.coworking_count ?? 0,
    },
    alerts,
  }
}
