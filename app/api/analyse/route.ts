/**
 * POST /api/analyse
 *
 * Thin gateway for the async on-demand analysis pipeline (CHI-334).
 *
 * Flow:
 *  1. Check analysis_cache — return immediately on a fresh hit (fast path unchanged)
 *  2. Rate limit check (TODO: Upstash Redis — Phase 1)
 *  3. Insert analysis_jobs row
 *  4. Fire-and-forget Supabase Edge Function `analyse-job`
 *  5. Return { jobId, status: "pending" } in <300ms
 *
 * The Edge Function does all compute: Parse.bot → Catastro → indicators → DB write.
 * The client polls GET /api/analyse/status?jobId=xxx for progress and results.
 */
import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import sql from '@/lib/db'

export const runtime = 'nodejs'

// --- Environment guards (fail fast — prevents hanging for 116s on missing config) ---
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SUPABASE_URL           = process.env.NEXT_PUBLIC_SUPABASE_URL

interface AnalyseRequest {
  url: string
  property?: {
    lat?: number
    lng?: number
    price_asking?: number
    area_sqm?: number
    comunidad_autonoma?: string
    municipio?: string
    codigo_postal?: string
    ref_catastral?: string
    build_year?: number
    epc_rating?: string
    epc_potential?: string
    bedrooms?: number
    floor?: number
    seller_type?: string
    catastro_year_built?: number
    negotiation_gap_pct?: number
  }
  buyer_age?: number
  tier?: string
}

export async function POST(req: NextRequest) {
  // Fail fast if service is not fully configured
  if (!SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_URL) {
    return NextResponse.json(
      {
        error: 'service_not_configured',
        message: 'Analysis service is not fully configured. Set SUPABASE_SERVICE_ROLE_KEY in environment variables.',
      },
      { status: 503 },
    )
  }

  let body: AnalyseRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const {
    url,
    property: manualProperty,
    // Flat pre-enrichment fields from the pin panel (CHI-369)
    lat,
    lng,
    price,
    area,
    source,
    tier = 'free',
  } = body as {
    url?: string;
    property?: AnalyseRequest['property'];
    lat?: number;
    lng?: number;
    price?: number;
    area?: number;
    source?: string;
    tier?: string;
  }

  // Allow url: null (coordinates-only jobs from the map Full Report CTA).
  // Reject only if a value is provided but is not a string.
  if (url !== null && url !== undefined && typeof url !== 'string') {
    return NextResponse.json({ error: 'invalid url' }, { status: 400 })
  }

  // Build the canonical source identifier. Idealista URLs are used as-is.
  // Coordinates-only jobs (url: null) get a stable pin: URI so source_url
  // satisfies the NOT NULL constraint and cache lookups are deterministic.
  const sourceUrl = url ?? `pin:${lat},${lng}`

  // Merge flat fields into property_input — flat fields act as pre-enrichment overrides.
  // The edge function merges property_input on top of Parse.bot, so these take precedence
  // over whatever Parse.bot extracts. If Parse.bot fills a field we didn't provide, it wins.
  const mergedProperty: AnalyseRequest['property'] = {
    ...manualProperty,
    ...(lat   != null ? { lat }             : {}),
    ...(lng   != null ? { lng }             : {}),
    ...(price != null ? { price_asking: price } : {}),
    ...(area  != null ? { area_sqm: area }  : {}),
  }

  void source // stored implicitly via property_input; no separate column needed

  // --- 1. Cache check (fast path — unchanged) ---
  const [cached] = await sql<{
    id: string
    composite_indicators: unknown
    alerts: unknown
    tvi_score: number | null
    expires_at: string
    lat: number | null
    lng: number | null
    price_asking: number | null
    price_per_sqm: number | null
    area_sqm: number | null
    provincia: string | null
    municipio: string | null
    build_year: number | null
    epc_rating: string | null
    address: string | null
    bedrooms: number | null
    bathrooms: number | null
    property_type: string | null
    floor: number | null
  }[]>`
    SELECT
      id, composite_indicators, alerts, tvi_score, expires_at,
      lat, lng, price_asking, price_per_sqm, area_sqm,
      provincia, municipio, build_year, epc_rating,
      address, bedrooms, bathrooms, property_type, floor
    FROM analysis_cache
    WHERE source_url = ${sourceUrl}
      AND (expires_at IS NULL OR expires_at > NOW())
    LIMIT 1
  `

  if (cached) {
    return NextResponse.json({
      id:                   cached.id,
      source_url:           sourceUrl,
      cached:               true,
      expires_at:           cached.expires_at,
      tvi_score:            cached.tvi_score,
      composite_indicators: cached.composite_indicators,
      alerts:               cached.alerts ?? [],
      property: {
        lat:           cached.lat,
        lng:           cached.lng,
        price_asking:  cached.price_asking,
        price_per_sqm: cached.price_per_sqm,
        area_sqm:      cached.area_sqm,
        provincia:     cached.provincia,
        municipio:     cached.municipio,
        build_year:    cached.build_year,
        epc_rating:    cached.epc_rating,
        address:       cached.address,
        bedrooms:      cached.bedrooms,
        bathrooms:     cached.bathrooms,
        property_type: cached.property_type,
        floor:         cached.floor,
      },
    })
  }

  // --- 2. Rate limit check (TODO: Upstash Redis — Phase 1) ---

  // --- 3. Insert job row ---
  const [job] = await sql<{ id: string }[]>`
    INSERT INTO analysis_jobs (source_url, property_input, tier)
    VALUES (
      ${sourceUrl},
      ${Object.keys(mergedProperty).length > 0 ? sql.json(mergedProperty) : null},
      ${tier}
    )
    RETURNING id
  `

  if (!job) {
    return NextResponse.json({ error: 'Failed to create analysis job' }, { status: 500 })
  }

  const jobId = job.id

  // --- 4. Trigger Edge Function via after() (CHI-347) ---
  // We do NOT want to block the HTTP response on the Edge Function's own runtime
  // (which can take 30-60s), but we DO need to guarantee the trigger fetch() is
  // actually sent. A bare fire-and-forget `fetch(...)` in a Vercel serverless
  // function can be cancelled when the response returns, leaving jobs stuck
  // 'pending' forever. `after()` keeps the invocation alive until the callback
  // completes, and we await the fetch inside it so we know the Edge Function
  // accepted the trigger. If the trigger itself fails, mark the job as errored
  // so the UI can show a useful message instead of polling forever.
  after(async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/analyse-job`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jobId }),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        console.error('[analyse] Edge Function trigger returned non-OK:', res.status, body)
        await sql`
          UPDATE analysis_jobs
             SET status = 'error',
                 error_message = ${`edge_trigger_failed: ${res.status} ${body.slice(0, 200)}`},
                 completed_at = NOW()
           WHERE id = ${jobId}
             AND status = 'pending'
        `
      }
    } catch (err) {
      console.error('[analyse] Edge Function trigger threw:', err)
      await sql`
        UPDATE analysis_jobs
           SET status = 'error',
               error_message = ${`edge_trigger_threw: ${(err as Error).message ?? String(err)}`},
               completed_at = NOW()
         WHERE id = ${jobId}
           AND status = 'pending'
      `.catch(() => { /* swallow — nothing more we can do */ })
    }
  })

  // --- 5. Return job reference immediately ---
  return NextResponse.json({ jobId, status: 'pending' }, { status: 202 })
}
