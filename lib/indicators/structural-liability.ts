/**
 * Indicator 2 — Structural Liability Index
 *
 * What it tells the user: The probability that the buyer will face
 * a large unexpected repair levy (derrama) within 5 years of purchase.
 */
import type { Sql } from 'postgres'
import type { PropertyInput, IndicatorResult, Alert } from './types'
import { normalise } from './utils'

const EPC_RISK: Record<string, number> = {
  A: 0, B: 10, C: 20, D: 40, E: 65, F: 80, G: 100,
}

const ITE_RISK: Record<string, number> = {
  passed:       0,
  pending:      60,
  failed:       100,
  not_required: 15,
}

function sliToLiabilityBand(sli: number): string {
  if (sli < 25) return '0'
  if (sli < 50) return '2k-5k'
  if (sli < 75) return '5k-15k'
  return '15k+'
}

export async function calcStructuralLiability(
  sql: Sql,
  property: PropertyInput,
): Promise<IndicatorResult & { details: Record<string, unknown> }> {
  const alerts: Alert[] = []

  // --- ITE lookup ---
  const [ite] = await sql<{ status: string; inspection_date: string | null }[]>`
    SELECT status, inspection_date
    FROM ite_status
    WHERE ref_catastral = ${property.ref_catastral ?? ''}
       OR (
         ST_DWithin(
           geom,
           ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY,
           30
         )
       )
    ORDER BY inspection_date DESC NULLS LAST
    LIMIT 1
  `

  // --- Flood zone lookup ---
  // Returns the highest-risk zone the property falls within (T10 > T100 > T500)
  const [flood] = await sql<{ risk_level: string }[]>`
    SELECT risk_level
    FROM flood_zones
    WHERE ST_Intersects(
      geom,
      ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY
    )
    ORDER BY
      CASE risk_level
        WHEN 'T10'  THEN 0
        WHEN 'T100' THEN 1
        WHEN 'T500' THEN 2
        ELSE 3
      END
    LIMIT 1
  `

  // --- Score components ---
  const buildYear = property.build_year ?? property.catastro_year_built ?? null
  const buildAge = buildYear != null ? 2026 - buildYear : null

  // Age score: 0-80 years mapped to 0-100
  const ageScore = buildAge != null ? normalise(buildAge, 0, 80) : 50  // unknown: median risk

  // ITE score
  const iteStatus = ite?.status ?? null
  const iteScore = iteStatus != null ? (ITE_RISK[iteStatus] ?? 40) : 40  // unknown: moderate risk

  // EPC score
  const epcRating = property.epc_rating?.toUpperCase() ?? null
  const epcScore = epcRating ? (EPC_RISK[epcRating] ?? 40) : 40  // unknown: moderate risk

  // Permit score: years since last ITE inspection (as proxy for maintenance)
  let permitScore = 50  // default: unknown
  if (ite?.inspection_date) {
    const inspYear = new Date(ite.inspection_date).getFullYear()
    const yearsSince = 2026 - inspYear
    permitScore = normalise(yearsSince, 0, 30)
  }

  // Flood penalty: additive on top of weighted composite
  // T10 = 10-year return period (highest risk), T100 = moderate, T500 = low
  const floodRiskLevel = flood?.risk_level ?? null
  const floodPenalty = floodRiskLevel === 'T10' ? 25 : floodRiskLevel === 'T100' ? 15 : floodRiskLevel === 'T500' ? 5 : 0

  // Weighted composite + flood penalty
  const sli = Math.min(100, Math.round(
    ageScore    * 0.30 +
    iteScore    * 0.40 +
    epcScore    * 0.20 +
    permitScore * 0.10 +
    floodPenalty,
  ))

  // --- Alerts ---
  if (floodRiskLevel === 'T10') {
    alerts.push({
      type: 'red',
      category: 'flood',
      title: 'Zona de inundación de alto riesgo',
      description: 'Esta propiedad está en una zona con periodo de retorno de 10 años (T10). Riesgo de inundación muy alto. Verificar seguro obligatorio.',
    })
  } else if (floodRiskLevel === 'T100') {
    alerts.push({
      type: 'amber',
      category: 'flood',
      title: 'Zona inundable (T100)',
      description: 'La propiedad está en una zona con periodo de retorno de 100 años. Consultar el SNCZI antes de comprar.',
    })
  } else if (floodRiskLevel === 'T500') {
    alerts.push({
      type: 'amber',
      category: 'flood',
      title: 'Zona inundable (T500)',
      description: 'La propiedad está en una zona de inundación de periodo de retorno de 500 años. Riesgo bajo pero verificar cobertura de seguro.',
    })
  }

  if (sli > 75) {
    alerts.push({
      type: 'red',
      category: 'structural',
      title: 'Alto riesgo de derrama',
      description:
        iteStatus === 'failed'
          ? 'El edificio tiene una ITE desfavorable. Riesgo muy alto de derrama inminente.'
          : 'Edificio antiguo con alta probabilidad de gastos estructurales inesperados.',
    })
  } else if (sli > 55) {
    alerts.push({
      type: 'amber',
      category: 'structural',
      title: 'Riesgo moderado de derrama',
      description: 'El edificio tiene factores de riesgo estructural. Recomendamos revisar el libro del edificio.',
    })
  }

  // Confidence: high only if ITE data found; flood zone lookup always runs
  const confidence = ite ? 'high' : buildYear ? 'medium' : 'low'

  return {
    score: sli,
    confidence,
    details: {
      build_year:           buildYear,
      build_age:            buildAge,
      ite_status:           iteStatus,
      ite_inspection_date:  ite?.inspection_date ?? null,
      epc_risk:             epcRating,
      flood_risk_zone:      floodRiskLevel,
      est_liability_band:   sliToLiabilityBand(sli),
    },
    alerts,
  }
}
