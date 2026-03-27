/**
 * GET /api/cron/zone-metrics
 *
 * Nightly cron (02:00 UTC) — snapshots zone-level market metrics into
 * `zone_metrics_history` for both codigo_postal and municipio zones.
 *
 * Aggregates from `properties` (Model A scraper data) and supplements
 * with `analysis_cache` (Model B user submissions) for zones with no
 * scraper coverage yet (Phase 0).
 *
 * Protected by CRON_SECRET header — set the same value in vercel.json
 * and Vercel Environment Variables.
 *
 * Dead-man's switch: emits Sentry captureCheckIn at start + end.
 * Requires @sentry/nextjs to be installed (CHI-313). Until then,
 * check-ins are silently skipped — the job still runs correctly.
 */
import { NextRequest, NextResponse } from 'next/server'
import sql from '@/lib/db'

export const runtime = 'nodejs'
export const maxDuration = 300  // 5 min — may process many zones

// ---------------------------------------------------------------------------
// Sentry dead-man's switch (no-op until CHI-313 installs @sentry/nextjs)
// ---------------------------------------------------------------------------

const MONITOR_SLUG = 'zone-metrics-cron'

async function cronCheckIn(
  status: 'in_progress' | 'ok' | 'error',
  checkInId?: string,
): Promise<string | undefined> {
  if (!process.env.SENTRY_DSN) return undefined
  try {
    // Dynamic import — safe no-op if @sentry/nextjs not yet installed
    const { captureCheckIn } = await import('@sentry/nextjs' as string) as {
      captureCheckIn: (opts: { monitorSlug: string; status: string }, id?: { checkInId: string }) => string
    }
    return captureCheckIn(
      { monitorSlug: MONITOR_SLUG, status },
      checkInId ? { checkInId } : undefined,
    )
  } catch {
    // @sentry/nextjs not installed yet — install it as part of CHI-313
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Aggregation SQL helpers
// ---------------------------------------------------------------------------

/** Snapshot all codigo_postal zones from the properties table. */
const POSTAL_SNAPSHOT_SQL = `
INSERT INTO zone_metrics_history (
  zone_type, zone_id, recorded_date,
  active_listings,
  median_price_sqm,
  median_dom,
  new_listings_7d,
  removed_listings_7d,
  price_reductions_7d,
  data_source
)
SELECT
  'codigo_postal'                                                        AS zone_type,
  codigo_postal                                                          AS zone_id,
  CURRENT_DATE                                                           AS recorded_date,
  COUNT(*) FILTER (WHERE is_active = TRUE)                              AS active_listings,
  PERCENTILE_CONT(0.5) WITHIN GROUP (
    ORDER BY price_per_sqm
  ) FILTER (WHERE is_active AND price_per_sqm > 0)                      AS median_price_sqm,
  PERCENTILE_CONT(0.5) WITHIN GROUP (
    ORDER BY days_on_market
  ) FILTER (WHERE is_active AND days_on_market IS NOT NULL)             AS median_dom,
  COUNT(*) FILTER (
    WHERE is_active AND first_seen_at >= NOW() - INTERVAL '7 days'
  )                                                                      AS new_listings_7d,
  COUNT(*) FILTER (
    WHERE is_active = FALSE AND last_seen_at >= NOW() - INTERVAL '7 days'
  )                                                                      AS removed_listings_7d,
  COUNT(*) FILTER (
    WHERE price_changed_at >= NOW() - INTERVAL '7 days'
      AND price_previous IS NOT NULL
      AND price_previous > price_asking
  )                                                                      AS price_reductions_7d,
  'scraper'                                                              AS data_source
FROM properties
WHERE codigo_postal IS NOT NULL
GROUP BY codigo_postal
HAVING COUNT(*) FILTER (WHERE is_active) > 0
ON CONFLICT (zone_type, zone_id, recorded_date) DO UPDATE SET
  active_listings      = EXCLUDED.active_listings,
  median_price_sqm     = EXCLUDED.median_price_sqm,
  median_dom           = EXCLUDED.median_dom,
  new_listings_7d      = EXCLUDED.new_listings_7d,
  removed_listings_7d  = EXCLUDED.removed_listings_7d,
  price_reductions_7d  = EXCLUDED.price_reductions_7d,
  data_source          = EXCLUDED.data_source
`

/** Snapshot all municipio zones from the properties table. */
const MUNICIPIO_SNAPSHOT_SQL = `
INSERT INTO zone_metrics_history (
  zone_type, zone_id, recorded_date,
  active_listings,
  median_price_sqm,
  median_dom,
  new_listings_7d,
  removed_listings_7d,
  price_reductions_7d,
  data_source
)
SELECT
  'municipio'                                                            AS zone_type,
  municipio                                                              AS zone_id,
  CURRENT_DATE                                                           AS recorded_date,
  COUNT(*) FILTER (WHERE is_active = TRUE)                              AS active_listings,
  PERCENTILE_CONT(0.5) WITHIN GROUP (
    ORDER BY price_per_sqm
  ) FILTER (WHERE is_active AND price_per_sqm > 0)                      AS median_price_sqm,
  PERCENTILE_CONT(0.5) WITHIN GROUP (
    ORDER BY days_on_market
  ) FILTER (WHERE is_active AND days_on_market IS NOT NULL)             AS median_dom,
  COUNT(*) FILTER (
    WHERE is_active AND first_seen_at >= NOW() - INTERVAL '7 days'
  )                                                                      AS new_listings_7d,
  COUNT(*) FILTER (
    WHERE is_active = FALSE AND last_seen_at >= NOW() - INTERVAL '7 days'
  )                                                                      AS removed_listings_7d,
  COUNT(*) FILTER (
    WHERE price_changed_at >= NOW() - INTERVAL '7 days'
      AND price_previous IS NOT NULL
      AND price_previous > price_asking
  )                                                                      AS price_reductions_7d,
  'scraper'                                                              AS data_source
FROM properties
WHERE municipio IS NOT NULL
GROUP BY municipio
HAVING COUNT(*) FILTER (WHERE is_active) > 0
ON CONFLICT (zone_type, zone_id, recorded_date) DO UPDATE SET
  active_listings      = EXCLUDED.active_listings,
  median_price_sqm     = EXCLUDED.median_price_sqm,
  median_dom           = EXCLUDED.median_dom,
  new_listings_7d      = EXCLUDED.new_listings_7d,
  removed_listings_7d  = EXCLUDED.removed_listings_7d,
  price_reductions_7d  = EXCLUDED.price_reductions_7d,
  data_source          = EXCLUDED.data_source
`

/**
 * Phase 0 supplement: snapshot from analysis_cache submissions for zones
 * that have no scraper coverage yet (no row in properties for that zone today).
 */
const CACHE_SUPPLEMENT_SQL = `
INSERT INTO zone_metrics_history (
  zone_type, zone_id, recorded_date,
  active_listings,
  median_price_sqm,
  data_source
)
SELECT
  'codigo_postal'                                                        AS zone_type,
  codigo_postal                                                          AS zone_id,
  CURRENT_DATE                                                           AS recorded_date,
  COUNT(*)                                                               AS active_listings,
  PERCENTILE_CONT(0.5) WITHIN GROUP (
    ORDER BY price_per_sqm
  ) FILTER (WHERE price_per_sqm > 0)                                    AS median_price_sqm,
  'submissions_only'                                                     AS data_source
FROM analysis_cache
WHERE codigo_postal IS NOT NULL
  AND expires_at > NOW()
  AND NOT EXISTS (
    SELECT 1 FROM zone_metrics_history zmh
    WHERE zmh.zone_type   = 'codigo_postal'
      AND zmh.zone_id     = analysis_cache.codigo_postal
      AND zmh.recorded_date = CURRENT_DATE
  )
GROUP BY codigo_postal
HAVING COUNT(*) > 0
ON CONFLICT (zone_type, zone_id, recorded_date) DO NOTHING
`

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  // --- Auth ---
  const secret = process.env.CRON_SECRET
  if (secret) {
    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  } else {
    console.warn('[zone-metrics-cron] CRON_SECRET not set — endpoint is unprotected')
  }

  const startedAt = Date.now()
  const checkInId = await cronCheckIn('in_progress')

  console.log(`[zone-metrics-cron] Starting snapshot for ${new Date().toISOString()}`)

  try {
    // Run postal + municipio aggregations in parallel
    const [postalResult, municipioResult] = await Promise.all([
      sql.unsafe(POSTAL_SNAPSHOT_SQL),
      sql.unsafe(MUNICIPIO_SNAPSHOT_SQL),
    ])

    // Supplement with analysis_cache for zones with no scraper data (Phase 0)
    const cacheResult = await sql.unsafe(CACHE_SUPPLEMENT_SQL)

    const postalCount    = postalResult.count    ?? 0
    const municipioCount = municipioResult.count ?? 0
    const cacheCount     = cacheResult.count     ?? 0
    const durationMs     = Date.now() - startedAt

    console.log(
      `[zone-metrics-cron] Done in ${durationMs}ms — ` +
      `postal=${postalCount} municipio=${municipioCount} cache_supplement=${cacheCount}`,
    )

    await cronCheckIn('ok', checkInId)

    return NextResponse.json({
      ok:                true,
      recorded_date:     new Date().toISOString().split('T')[0],
      zones_postal:      postalCount,
      zones_municipio:   municipioCount,
      zones_cache_only:  cacheCount,
      duration_ms:       durationMs,
    })
  } catch (err) {
    console.error('[zone-metrics-cron] FAILED:', err)
    await cronCheckIn('error', checkInId)
    return NextResponse.json(
      { error: 'Cron job failed', detail: String(err) },
      { status: 500 },
    )
  }
}
