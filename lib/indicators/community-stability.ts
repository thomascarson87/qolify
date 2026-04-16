/**
 * Indicator 7 — Community Stability Score
 *
 * What it tells the user: How stable, liveable, and quiet this neighbourhood
 * is — free from tourist-rental churn, noise pollution, and commercial flux.
 *
 * Inputs:
 * - VUT tourist licence density (active licences within 500m)
 * - Noise Lden at property coordinates from EEA noise_zones
 * - dom_stability: stub neutral (60) — requires zone_metrics_history (Phase 3+)
 * - commerce_age: stub neutral (50) — requires zone_metrics_history (Phase 3+)
 *
 * QoL Enrichment Layer (CHI-377): noise_score now uses real EEA data.
 */
import type { Sql } from 'postgres'
import type { PropertyInput, IndicatorResult, Alert } from './types'
import { normalise } from './utils'

export async function calcCommunityStability(
  sql: Sql,
  property: PropertyInput,
): Promise<IndicatorResult & { details: Record<string, unknown> }> {
  const alerts: Alert[] = []

  // --- Single CTE: VUT density count within 500m + noise zone intersection ---
  const [row] = await sql<{
    vut_active_500m: number
    noise_lden_min:  number | null
    noise_band:      string | null
    noise_source:    string | null
  }[]>`
    WITH
      vut AS (
        -- geom IS NOT NULL guard: OpenRTA returns no coordinates so all rows
        -- currently have geom = NULL. Without this guard ST_DWithin forces a
        -- full seq scan of 192K+ rows.
        SELECT COUNT(*)::int AS active_count
        FROM vut_licences
        WHERE status = 'active'
          AND geom IS NOT NULL
          AND ST_DWithin(
            geom,
            ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY,
            500
          )
      ),
      noise AS (
        SELECT lden_min, lden_band, source
        FROM noise_zones
        WHERE ST_Intersects(
          ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY,
          geom
        )
        ORDER BY lden_min DESC
        LIMIT 1
      )
    SELECT
      vut.active_count          AS vut_active_500m,
      noise.lden_min            AS noise_lden_min,
      noise.lden_band           AS noise_band,
      noise.source              AS noise_source
    FROM vut
    LEFT JOIN noise ON TRUE
  `

  // --- VUT score ---
  // vut_density_pct proxy: active count within 500m
  // 0 = 100 pts, 50+ = 0 pts (formula: 100 - count * 2)
  const vutActive   = row?.vut_active_500m ?? 0
  const vutScore    = Math.max(0, 100 - vutActive * 2)

  // --- Noise score (EEA Lden) ---
  // 40 dB (quiet) = 100, 65 dB (busy road) = 0
  // Neutral default 70 when no EEA data ingested yet
  const noiseLden   = row?.noise_lden_min ?? null
  const noiseScore  = noiseLden != null
    ? Math.max(0, 100 - (noiseLden - 40) * 4)
    : 70

  // --- dom_stability: neutral stub (Phase 3+ — zone_metrics_history required) ---
  const domStability = 60

  // --- commerce_age: neutral stub (Phase 3+ — avg_amenity_age_months required) ---
  // Normalise avg age 0–60 months; stub at 30 months → score = 50
  const commerceAge  = 50

  // --- Final weighted score ---
  const score = Math.round(
    vutScore     * 0.40 +
    domStability * 0.20 +
    commerceAge  * 0.20 +
    noiseScore   * 0.20,
  )

  // --- Alerts ---
  if (vutActive > 25) {
    alerts.push({
      type: 'red',
      category: 'community',
      title: 'Alta concentración de VUT',
      description: `${vutActive} viviendas turísticas activas en un radio de 500 m. El barrio puede tener alta rotación de residentes.`,
    })
  } else if (vutActive > 10) {
    alerts.push({
      type: 'amber',
      category: 'community',
      title: 'Densidad VUT moderada',
      description: `${vutActive} viviendas turísticas activas en un radio de 500 m.`,
    })
  }

  if (noiseLden !== null && noiseLden >= 65) {
    alerts.push({
      type: 'red',
      category: 'community',
      title: 'Zona de alto ruido',
      description: `Nivel de ruido Lden de ${noiseLden} dB — equivalente a una calle muy transitada. Fuente: Mapa Estratégico de Ruido UE.`,
    })
  } else if (noiseLden !== null && noiseLden >= 60) {
    alerts.push({
      type: 'amber',
      category: 'community',
      title: 'Zona de ruido moderado-alto',
      description: `Nivel de ruido Lden de ${noiseLden} dB. Fuente: Mapa Estratégico de Ruido UE.`,
    })
  }

  // Confidence: high if both VUT geocoding and noise data available
  // medium if VUT data but no noise
  // low if neither source has spatial data
  const hasNoise = noiseLden !== null
  const confidence = hasNoise ? 'high' : 'medium'

  return {
    score,
    confidence,
    details: {
      vut_active_500m:    vutActive,
      vut_score:          vutScore,
      noise_lden:         noiseLden,
      noise_band:         row?.noise_band ?? null,
      noise_source:       row?.noise_source ?? null,
      noise_score:        noiseScore,
      dom_stability_stub: true,    // placeholder until zone_metrics_history available
      commerce_age_stub:  true,
    },
    alerts,
  }
}
