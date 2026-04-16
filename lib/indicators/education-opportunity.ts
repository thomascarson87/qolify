/**
 * Indicator 5 — Education Opportunity Score
 *
 * What it tells the user: Not just "is there a school nearby" but how much
 * educational choice a family actually has.
 *
 * CTE consolidation (CHI-334): 2 separate queries merged into 1.
 * Schools are aggregated by tipo in SQL (replacing application-side GROUP BY).
 *
 * QoL Enrichment Layer (CHI-377): Added diagnostic score bonus (up to 10 pts)
 * and bilingual school bonus (up to 16 pts) using enriched schools data.
 */
import type { Sql } from 'postgres'
import type { PropertyInput, IndicatorResult, Alert } from './types'

export async function calcEducationOpportunity(
  sql: Sql,
  property: PropertyInput,
): Promise<IndicatorResult & { details: Record<string, unknown> }> {
  const alerts: Alert[] = []

  // --- Single CTE: schools within 1km (aggregated by tipo) + catchment +
  //     diagnostic scores + bilingual count ---
  const [row] = await sql<{
    public_count:          number
    concertado_count:      number
    private_count:         number
    total_count:           number
    in_catchment:          boolean
    bilingual_count:       number
    avg_diagnostic_score:  number | null
    has_diagnostic_data:   boolean
  }[]>`
    WITH
      schools_agg AS (
        SELECT
          COALESCE(SUM(CASE WHEN tipo = 'publico'    THEN 1 ELSE 0 END), 0)::int AS public_count,
          COALESCE(SUM(CASE WHEN tipo = 'concertado' THEN 1 ELSE 0 END), 0)::int AS concertado_count,
          COALESCE(SUM(CASE WHEN tipo = 'privado'    THEN 1 ELSE 0 END), 0)::int AS private_count,
          COUNT(*)::int                                                           AS total_count,
          COUNT(*) FILTER (WHERE bilingual_languages IS NOT NULL)::int           AS bilingual_count,
          AVG(diagnostic_score)                                                   AS avg_diagnostic_score,
          BOOL_OR(diagnostic_score IS NOT NULL)                                  AS has_diagnostic_data
        FROM schools
        WHERE ST_DWithin(
          geom,
          ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY,
          1000
        )
      ),
      catchment AS (
        SELECT EXISTS (
          SELECT 1 FROM school_catchments
          WHERE ST_Intersects(
            geom,
            ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY
          )
        ) AS in_catchment
      )
    SELECT s.*, c.in_catchment
    FROM schools_agg s
    CROSS JOIN catchment c
  `

  const totalSchools    = row?.total_count      ?? 0
  const inCatchment     = row?.in_catchment     ?? false
  const bilingualCount  = row?.bilingual_count  ?? 0
  const avgDiagnostic   = row?.avg_diagnostic_score ?? null
  const hasDiagnostic   = row?.has_diagnostic_data  ?? false

  const publicScore  = Math.min((row?.public_count     ?? 0) * 20, 60)
  const concertScore = Math.min((row?.concertado_count ?? 0) * 15, 30)
  const privateScore = Math.min((row?.private_count    ?? 0) * 10, 20)
  const catchBonus   = inCatchment ? 15 : 0

  // Quality bonus: avg diagnostic score (0-100) × 0.10 → up to 10 pts
  // Only applied when diagnostic data is available for schools in this area
  const qualityBonus   = (hasDiagnostic && avgDiagnostic != null)
    ? avgDiagnostic * 0.10
    : 0

  // Bilingual bonus: 8 pts per bilingual school, capped at 16 pts
  const bilingualBonus = Math.min(bilingualCount * 8, 16)

  const score = Math.min(
    100,
    Math.round(publicScore + concertScore + privateScore + catchBonus + qualityBonus + bilingualBonus),
  )

  if (totalSchools === 0) {
    alerts.push({ type: 'amber', category: 'education', title: 'Sin colegios en 1km', description: 'No se han encontrado centros educativos en un radio de 1 km.' })
  }

  if (bilingualCount > 0) {
    alerts.push({
      type: 'green',
      category: 'education',
      title: `${bilingualCount} colegio${bilingualCount > 1 ? 's' : ''} bilingüe${bilingualCount > 1 ? 's' : ''} en 1 km`,
      description: 'Centros con programa de educación bilingüe cerca de la propiedad.',
    })
  }

  return {
    score: totalSchools > 0 ? score : null,
    confidence: inCatchment ? 'high' : totalSchools > 0 ? 'medium' : 'low',
    details: {
      school_count_1km:         totalSchools,
      in_catchment:             inCatchment,
      bilingual_schools_1km:    bilingualCount,
      avg_diagnostic_score_1km: avgDiagnostic != null ? Math.round(avgDiagnostic * 10) / 10 : null,
      diagnostic_data_available: hasDiagnostic,
      breakdown: {
        public:     row?.public_count     ?? 0,
        concertado: row?.concertado_count ?? 0,
        private:    row?.private_count    ?? 0,
      },
      bonuses: {
        quality_bonus:   Math.round(qualityBonus * 10) / 10,
        bilingual_bonus: bilingualBonus,
        catchment_bonus: catchBonus,
      },
    },
    alerts,
  }
}
