/**
 * Indicator 2 — Structural Liability Index
 *
 * What it tells the user: The probability that the buyer will face
 * a large unexpected repair levy (derrama) within 5 years of purchase.
 *
 * CTE consolidation (CHI-334): 2 separate queries merged into 1.
 */
import type { Sql } from 'postgres'
import type { PropertyInput, IndicatorResult, Alert } from './types'
import { normalise } from './utils'

const EPC_RISK: Record<string, number> = { A: 0, B: 10, C: 20, D: 40, E: 65, F: 80, G: 100 }
const ITE_RISK: Record<string, number> = { passed: 0, pending: 60, failed: 100, not_required: 15 }

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

  // --- Single CTE: ite_status + flood_zones ---
  const [row] = await sql<{
    ite_status: string | null
    ite_inspection_date: string | null
    flood_risk_level: string | null
  }[]>`
    WITH
      ite AS (
        SELECT status, inspection_date
        FROM ite_status
        WHERE ref_catastral = ${property.ref_catastral ?? ''}
           OR ST_DWithin(
                geom,
                ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY,
                30
              )
        ORDER BY inspection_date DESC NULLS LAST
        LIMIT 1
      ),
      flood AS (
        SELECT risk_level
        FROM flood_zones
        WHERE ST_Intersects(
          geom,
          ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY
        )
        ORDER BY
          CASE risk_level WHEN 'T10' THEN 0 WHEN 'T100' THEN 1 WHEN 'T500' THEN 2 ELSE 3 END
        LIMIT 1
      )
    SELECT
      ite.status           AS ite_status,
      ite.inspection_date  AS ite_inspection_date,
      flood.risk_level     AS flood_risk_level
    FROM (SELECT 1) dummy
    LEFT JOIN ite   ON TRUE
    LEFT JOIN flood ON TRUE
  `

  const buildYear = property.build_year ?? property.catastro_year_built ?? null
  const buildAge  = buildYear != null ? 2026 - buildYear : null

  const ageScore  = buildAge != null ? normalise(buildAge, 0, 80) : 50
  const iteScore  = row?.ite_status ? (ITE_RISK[row.ite_status] ?? 40) : 40
  const epcScore  = property.epc_rating ? (EPC_RISK[property.epc_rating.toUpperCase()] ?? 40) : 40

  let permitScore = 50
  if (row?.ite_inspection_date) {
    const yearsSince = 2026 - new Date(row.ite_inspection_date).getFullYear()
    permitScore = normalise(yearsSince, 0, 30)
  }

  const floodLevel   = row?.flood_risk_level ?? null
  const floodPenalty = floodLevel === 'T10' ? 25 : floodLevel === 'T100' ? 15 : floodLevel === 'T500' ? 5 : 0

  const sli = Math.min(100, Math.round(
    ageScore    * 0.30 +
    iteScore    * 0.40 +
    epcScore    * 0.20 +
    permitScore * 0.10 +
    floodPenalty,
  ))

  if (floodLevel === 'T10') {
    alerts.push({ type: 'red',   category: 'flood',    title: 'Zona de inundación de alto riesgo', description: 'Esta propiedad está en una zona con periodo de retorno de 10 años (T10). Riesgo de inundación muy alto. Verificar seguro obligatorio.' })
  } else if (floodLevel === 'T100') {
    alerts.push({ type: 'amber', category: 'flood',    title: 'Zona inundable (T100)',            description: 'La propiedad está en una zona con periodo de retorno de 100 años. Consultar el SNCZI antes de comprar.' })
  } else if (floodLevel === 'T500') {
    alerts.push({ type: 'amber', category: 'flood',    title: 'Zona inundable (T500)',            description: 'La propiedad está en una zona de inundación de periodo de retorno de 500 años. Riesgo bajo pero verificar cobertura de seguro.' })
  }

  if (sli > 75) {
    alerts.push({ type: 'red',   category: 'structural', title: 'Alto riesgo de derrama',     description: row?.ite_status === 'failed' ? 'El edificio tiene una ITE desfavorable. Riesgo muy alto de derrama inminente.' : 'Edificio antiguo con alta probabilidad de gastos estructurales inesperados.' })
  } else if (sli > 55) {
    alerts.push({ type: 'amber', category: 'structural', title: 'Riesgo moderado de derrama', description: 'El edificio tiene factores de riesgo estructural. Recomendamos revisar el libro del edificio.' })
  }

  return {
    score: sli,
    confidence: row?.ite_status ? 'high' : buildYear ? 'medium' : 'low',
    details: {
      build_year:          buildYear,
      build_age:           buildAge,
      ite_status:          row?.ite_status ?? null,
      ite_inspection_date: row?.ite_inspection_date ?? null,
      epc_risk:            property.epc_rating?.toUpperCase() ?? null,
      flood_risk_zone:     floodLevel,
      est_liability_band:  sliToLiabilityBand(sli),
    },
    alerts,
  }
}
