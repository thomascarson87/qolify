/**
 * Indicator 4 — Health Security Score
 *
 * What it tells the user: Practical access to healthcare — not just proximity,
 * but the right type at the right time.
 *
 * CTE consolidation (CHI-334): 3 separate queries merged into 1.
 * QoL Enrichment Layer (CHI-377): Added waiting time component from
 * health_waiting_times (avg_days_gp) matched by comunidad_autonoma.
 * Facility quality (CHI-385): Wait component prefers facility-level
 * surgery_wait_days at the nearest hospital when present, falls back to
 * CCAA average otherwise. ACSA accreditation is display-only on the
 * deep-dive; it does NOT influence the score.
 */
import type { Sql } from 'postgres'
import type { PropertyInput, IndicatorResult, Alert } from './types'
import { distanceToScore } from './utils'

export async function calcHealthSecurity(
  sql: Sql,
  property: PropertyInput,
): Promise<IndicatorResult & { details: Record<string, unknown> }> {
  const alerts: Alert[] = []

  // --- Single CTE: nearest GP + nearest 24h ER + nearest hospital quality + pharmacy count + waiting times ---
  const [row] = await sql<{
    gp_dist_m:               number | null;  gp_nombre:         string | null
    er_dist_m:               number | null;  er_nombre:         string | null
    hosp_surgery_wait_days:  number | null
    hosp_wait_quarter:       string | null
    hosp_nombre:             string | null
    pharmacy_count:          number
    avg_days_gp:             number | null
    avg_days_specialist:     number | null
    avg_days_surgery:        number | null
    wait_health_area:        string | null
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
      -- Nearest hospital with a published surgery wait (CHI-385).
      -- Used to override the CCAA-level wait when facility data is present.
      nearest_hosp_with_wait AS (
        SELECT
          surgery_wait_days,
          wait_recorded_quarter,
          nombre
        FROM health_centres
        WHERE tipo = 'hospital'
          AND surgery_wait_days IS NOT NULL
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
      gp.dist_m                          AS gp_dist_m,
      gp.nombre                          AS gp_nombre,
      er.dist_m                          AS er_dist_m,
      er.nombre                          AS er_nombre,
      nearest_hosp_with_wait.surgery_wait_days     AS hosp_surgery_wait_days,
      nearest_hosp_with_wait.wait_recorded_quarter AS hosp_wait_quarter,
      nearest_hosp_with_wait.nombre                AS hosp_nombre,
      pharm.count                        AS pharmacy_count,
      wait.avg_days_gp                   AS avg_days_gp,
      wait.avg_days_specialist           AS avg_days_specialist,
      wait.avg_days_surgery              AS avg_days_surgery,
      wait.health_area_name              AS wait_health_area
    FROM (SELECT 1) dummy
    LEFT JOIN gp                     ON TRUE
    LEFT JOIN er                     ON TRUE
    LEFT JOIN nearest_hosp_with_wait ON TRUE
    CROSS JOIN pharm
    LEFT JOIN wait                   ON TRUE
  `

  // postgres.js returns DECIMAL columns as strings — coerce before arithmetic/.toFixed()
  const gpDistM     = row?.gp_dist_m ? Math.round(row.gp_dist_m) : null
  const erDistM     = row?.er_dist_m ? Math.round(row.er_dist_m) : null
  const avgDaysGp   = row?.avg_days_gp != null ? Number(row.avg_days_gp) : null
  const ccaaSurgery = row?.avg_days_surgery != null ? Number(row.avg_days_surgery) : null
  const facilitySurgery = row?.hosp_surgery_wait_days != null ? Number(row.hosp_surgery_wait_days) : null

  const gpScore    = distanceToScore(gpDistM,  300,  3000)
  const erScore    = distanceToScore(erDistM, 1000,  8000)
  const pharmScore = Math.min((row?.pharmacy_count ?? 0) * 25, 100)

  // Wait component (CHI-385):
  //   1. Prefer facility-level surgery wait at the nearest hospital that
  //      publishes one (SAS quarterly). Surgery waits run 30–200+ days,
  //      so anchor the curve at 30/200 to keep scores legible.
  //   2. Else use CCAA-level GP wait (most areas < 5 days, >12 = poor).
  //   3. Else neutral 60.
  let waitScore: number
  let waitSource: 'facility_surgery' | 'ccaa_gp' | 'none'
  if (facilitySurgery != null) {
    waitScore = Math.max(0, Math.min(100, 100 - (facilitySurgery - 30) * 0.5))
    waitSource = 'facility_surgery'
  } else if (avgDaysGp != null) {
    waitScore = Math.max(0, 100 - avgDaysGp * 8)
    waitSource = 'ccaa_gp'
  } else {
    waitScore = 60
    waitSource = 'none'
  }

  // Weights unchanged from CHI-377 — wait now uses a better source when available,
  // weight stays 0.15 to avoid over-tuning on partial coverage.
  const score = Math.round(
    gpScore    * 0.35 +
    erScore    * 0.35 +
    pharmScore * 0.15 +
    waitScore  * 0.15,
  )

  if (gpDistM !== null && gpDistM > 3000) alerts.push({ type: 'amber', category: 'health', title: 'GP surgery is far away',          description: `Nearest GP surgery is ${(gpDistM / 1000).toFixed(1)} km away.` })
  if (erDistM !== null && erDistM > 8000) alerts.push({ type: 'red',   category: 'health', title: 'Emergency services are far away', description: `Nearest 24h emergency services are ${(erDistM / 1000).toFixed(1)} km away.` })
  if (avgDaysGp !== null && avgDaysGp > 7) {
    alerts.push({
      type: 'amber',
      category: 'health',
      title: 'Long wait for GP appointment',
      description: `Average wait of ${avgDaysGp.toFixed(0)} days in ${row?.wait_health_area ?? 'this region'}.`,
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
      avg_days_specialist_wait: row?.avg_days_specialist != null ? Number(row.avg_days_specialist) : null,
      avg_days_surgery:         ccaaSurgery,
      wait_health_area:         row?.wait_health_area    ?? null,
      facility_surgery_wait_days: facilitySurgery,
      facility_wait_quarter:    row?.hosp_wait_quarter ?? null,
      facility_wait_hospital:   row?.hosp_nombre ?? null,
      wait_source:              waitSource,
    },
    alerts,
  }
}
