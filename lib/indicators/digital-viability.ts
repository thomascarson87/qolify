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

  // --- Single CTE: fibre_coverage + mobile_coverage + amenities ---
  const [row] = await sql<{
    coverage_type: string | null
    max_speed_mbps: number | null
    has_5g: boolean
    has_4g: boolean
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
      mobile AS (
        SELECT
          BOOL_OR(technology = '5G') AS has_5g,
          BOOL_OR(technology = '4G') AS has_4g
        FROM mobile_coverage
        WHERE ST_DWithin(
          geom,
          ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY,
          0
        )
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
      COALESCE(mobile.has_5g, FALSE) AS has_5g,
      COALESCE(mobile.has_4g, FALSE) AS has_4g,
      cowork.count AS coworking_count
    FROM (SELECT 1) dummy
    LEFT JOIN fibre  ON TRUE
    LEFT JOIN mobile ON TRUE
    CROSS JOIN cowork
  `

  const fibreType = row?.coverage_type ?? null
  const has5G = row?.has_5g ?? false
  const has4G = row?.has_4g ?? has5G  // 5G cell implies 4G
  const mobileClass = has5G ? '5G' : has4G ? '4G' : 'none'

  const fibreScore = fibreType ? (FIBRE_SCORE[fibreType] ?? 0) : 0
  const mobileScore = has5G ? 75 : has4G ? 40 : 0
  const baseScore = Math.max(fibreScore, mobileScore)
  const coworkBonus = Math.min((row?.coworking_count ?? 0) * 8, 20)
  const score = Math.min(100, Math.round(baseScore + coworkBonus))

  const hasAnySignal = fibreType !== null || has5G || has4G

  if (!fibreType || fibreType === 'none') {
    if (has5G) {
      alerts.push({ type: 'amber', category: 'connectivity', title: 'Sin fibra — 5G disponible', description: 'La banda ancha móvil 5G es la opción principal para teletrabajo aquí.' })
    } else if (has4G) {
      alerts.push({ type: 'amber', category: 'connectivity', title: 'Sin fibra — solo 4G',       description: '4G es la única opción de banda ancha. Suficiente para teletrabajo ligero, no para cargas intensivas.' })
    } else {
      alerts.push({ type: 'red',   category: 'connectivity', title: 'Sin cobertura de banda ancha', description: 'No hay cobertura registrada de fibra ni móvil para esta propiedad.' })
    }
  } else if (fibreType === 'FTTC' || fibreType === 'HFC') {
    alerts.push({ type: 'amber', category: 'connectivity', title: 'Fibra parcial', description: `La cobertura disponible es ${fibreType}, no fibra directa al hogar (FTTP).` })
  }

  return {
    score: hasAnySignal ? score : null,
    confidence: fibreType !== null && (has5G || has4G) ? 'high' : hasAnySignal ? 'medium' : 'low',
    details: {
      fibre_type:          fibreType,
      max_speed_mbps:      row?.max_speed_mbps ?? null,
      mobile_class:        mobileClass,
      has_5g:              has5G,
      has_4g:              has4G,
      coworking_count_2km: row?.coworking_count ?? 0,
    },
    alerts,
  }
}
