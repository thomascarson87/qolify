/**
 * Indicator 4 — Health Security Score
 *
 * What it tells the user: Practical access to healthcare — not just proximity,
 * but the right type at the right time.
 *
 * CTE consolidation (CHI-334): 3 separate queries merged into 1.
 * QoL Enrichment Layer (CHI-377): Added waiting time component from
 * health_waiting_times (avg_days_gp) matched by comunidad_autonoma.
 */
import type { Sql } from 'postgres'
import type { PropertyInput, IndicatorResult, Alert } from './types'
import { distanceToScore } from './utils'

export async function calcHealthSecurity(
  sql: Sql,
  property: PropertyInput,
): Promise<IndicatorResult & { details: Record<string, unknown> }> {
  const alerts: Alert[] = []

  // --- Single CTE: nearest GP + nearest 24h ER + pharmacy count + waiting times ---
  const [row] = await sql<{
    gp_dist_m:           number | null;  gp_nombre:         string | null
    er_dist_m:           number | null;  er_nombre:         string | null
    pharmacy_count:      number
    avg_days_gp:         number | null
    avg_days_specialist: number | null
    avg_days_surgery:    number | null
    wait_health_area:    string | null
  }[]>`
    WITH
      gp AS (
        SELECT
          ST_Distance(geom, ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY) AS dist_m,
          nombre
        FROM health_centres
        WHERE tipo = 'centro_salud'
        ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY
        LIMIT 1
      ),
      er AS (
        SELECT
          ST_Distance(geom, ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY) AS dist_m,
          nombre
        FROM health_centres
        WHERE is_24h = TRUE
        ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY
        LIMIT 1
      ),
      pharm AS (
        SELECT COUNT(*)::int AS count
        FROM amenities
        WHERE category = 'pharmacy'
          AND ST_DWithin(
            geom,
            ST_SetSRID(ST_MakePoint(${property.lng}, ${property.lat}), 4326)::GEOGRAPHY,
            500
          )
      ),
      wait AS (
        -- Latest quarterly data for this comunidad_autonoma
        -- health_area_code uses ISO 3166-2:ES format (e.g. ES-AND for Andalucía)
        SELECT
          avg_days_gp,
          avg_days_specialist,
          avg_days_surgery,
          health_area_name
        FROM health_waiting_times
        WHERE LOWER(comunidad_autonoma) = LOWER(${property.comunidad_autonoma ?? ''})
        ORDER BY recorded_quarter DESC
        LIMIT 1
      )
    SELECT
      gp.dist_m             AS gp_dist_m,    gp.nombre            AS gp_nombre,
      er.dist_m             AS er_dist_m,    er.nombre            AS er_nombre,
      pharm.count           AS pharmacy_count,
      wait.avg_days_gp      AS avg_days_gp,
      wait.avg_days_specialist AS avg_days_specialist,
      wait.avg_days_surgery AS avg_days_surgery,
      wait.health_area_name AS wait_health_area
    FROM (SELECT 1) dummy
    LEFT JOIN gp    ON TRUE
    LEFT JOIN er    ON TRUE
    CROSS JOIN pharm
    LEFT JOIN wait  ON TRUE
  `

  const gpDistM    = row?.gp_dist_m ? Math.round(row.gp_dist_m) : null
  const erDistM    = row?.er_dist_m ? Math.round(row.er_dist_m) : null
  const avgDaysGp  = row?.avg_days_gp ?? null

  const gpScore    = distanceToScore(gpDistM,  300,  3000)
  const erScore    = distanceToScore(erDistM, 1000,  8000)
  const pharmScore = Math.min((row?.pharmacy_count ?? 0) * 25, 100)

  // Waiting time score: 0 days = 100, 12+ days = 4
  // Neutral 60 when no data available (most areas < 5 days)
  const waitScore  = avgDaysGp != null
    ? Math.max(0, 100 - avgDaysGp * 8)
    : 60

  // Updated weights to include waiting time component (CHI-377)
  const score = Math.round(
    gpScore    * 0.35 +
    erScore    * 0.35 +
    pharmScore * 0.15 +
    waitScore  * 0.15,
  )

  if (gpDistM !== null && gpDistM > 3000) alerts.push({ type: 'amber', category: 'health', title: 'Centro de salud alejado',  description: `El centro de salud más cercano está a ${(gpDistM / 1000).toFixed(1)} km.` })
  if (erDistM !== null && erDistM > 8000) alerts.push({ type: 'red',   category: 'health', title: 'Urgencias muy alejadas',  description: `Las urgencias 24h más cercanas están a ${(erDistM / 1000).toFixed(1)} km.` })
  if (avgDaysGp !== null && avgDaysGp > 7) {
    alerts.push({
      type: 'amber',
      category: 'health',
      title: 'Espera larga para médico de cabecera',
      description: `Espera media de ${avgDaysGp.toFixed(0)} días en ${row?.wait_health_area ?? 'esta comunidad autónoma'}.`,
    })
  }

  const hasData = row?.gp_dist_m != null || row?.er_dist_m != null
  return {
    score: hasData ? score : null,
    confidence: hasData ? 'high' : 'low',
    details: {
      nearest_gp_m:             gpDistM,
      nearest_gp_nombre:        row?.gp_nombre ?? null,
      nearest_er_m:             erDistM,
      nearest_er_nombre:        row?.er_nombre ?? null,
      pharmacy_count_500m:      row?.pharmacy_count ?? 0,
      avg_days_gp_wait:         avgDaysGp,
      avg_days_specialist_wait: row?.avg_days_specialist ?? null,
      avg_days_surgery:         row?.avg_days_surgery    ?? null,
      wait_health_area:         row?.wait_health_area    ?? null,
    },
    alerts,
  }
}
