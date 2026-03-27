/**
 * Indicator 5 — Education Opportunity Score
 *
 * What it tells the user: Not just "is there a school nearby" but how much
 * educational choice a family actually has.
 */
import type { Sql } from 'postgres'
import type { PropertyInput, IndicatorResult, Alert } from './types'

export async function calcEducationOpportunity(
  sql: Sql,
  property: PropertyInput,
): Promise<IndicatorResult & { details: Record<string, unknown> }> {
  const alerts: Alert[] = []

  // --- Schools within 1km by type ---
  const schoolRows = await sql<{ tipo: string; count: number }[]>`
    SELECT tipo, COUNT(*)::int AS count
    FROM schools
    WHERE ST_DWithin(
      geom,
      ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY,
      1000
    )
    GROUP BY tipo
  `

  const breakdown = { public: 0, concertado: 0, private: 0 }
  for (const row of schoolRows) {
    if (row.tipo === 'publico')    breakdown.public     += row.count
    if (row.tipo === 'concertado') breakdown.concertado += row.count
    if (row.tipo === 'privado')    breakdown.private    += row.count
  }
  const totalSchools = breakdown.public + breakdown.concertado + breakdown.private

  // --- School catchment intersection ---
  const [catchment] = await sql<{ in_catchment: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM school_catchments
      WHERE ST_Intersects(
        geom,
        ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY
      )
    ) AS in_catchment
  `
  const inCatchment = catchment?.in_catchment ?? false

  // --- Score ---
  const publicScore     = Math.min(breakdown.public * 20, 60)
  const concertadoScore = Math.min(breakdown.concertado * 15, 30)
  const privateScore    = Math.min(breakdown.private * 10, 20)
  const catchmentBonus  = inCatchment ? 15 : 0

  const score = Math.min(
    100,
    Math.round(publicScore + concertadoScore + privateScore + catchmentBonus),
  )

  // --- Alerts ---
  if (totalSchools === 0) {
    alerts.push({
      type: 'amber',
      category: 'education',
      title: 'Sin colegios en 1km',
      description: 'No se han encontrado centros educativos en un radio de 1 km.',
    })
  }

  const hasData = schoolRows.length > 0
  return {
    score: hasData ? score : null,
    confidence: inCatchment ? 'high' : hasData ? 'medium' : 'low',
    details: {
      school_count_1km: totalSchools,
      in_catchment:     inCatchment,
      breakdown,
    },
    alerts,
  }
}
