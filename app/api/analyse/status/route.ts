/**
 * GET /api/analyse/status?jobId=xxx
 *
 * Polling endpoint for the async analysis pipeline (CHI-334).
 *
 * Returns:
 *  - { status: 'pending' | 'processing', step: 0-4 }  — while the Edge Function is running
 *  - Full analysis result (same shape as old POST response) when complete
 *  - { status: 'needs_input', missing: string[], sourceUrl: string } — Parse.bot couldn't scrape required fields
 *  - { status: 'error', message: '...' }  — if the Edge Function failed
 *  - 404 if neither a job nor a cache entry with this ID exists
 *
 * Also handles direct links to cached results: if jobId is not found in analysis_jobs,
 * falls back to looking it up in analysis_cache by id. This makes cached result URLs
 * bookmarkable and shareable without requiring a job row.
 *
 * Step values (set by the Edge Function):
 *  0 = queued
 *  1 = fetching listing (Parse.bot)
 *  2 = looking up Catastro records
 *  3 = running indicators
 *  4 = saving analysis
 *  5 = complete
 */
import { NextRequest, NextResponse } from 'next/server'
import sql from '@/lib/db'

export const runtime = 'nodejs'

// ─── Shared result shape builder ──────────────────────────────────────────────

function buildCompleteResponse(row: {
  cache_id: string | null
  tvi_score: number | null
  composite_indicators: unknown
  alerts: unknown
  expires_at: string | null
  source_url_cache: string | null
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
  codigo_postal: string | null
  ref_catastral: string | null
  catastro_valor_referencia: number | null
  negotiation_gap_pct: number | null
  solar_potential_result?: unknown
}) {
  return {
    status:               'complete',
    id:                   row.cache_id,
    source_url:           row.source_url_cache,
    cached:               false,
    expires_at:           row.expires_at,
    tvi_score:            row.tvi_score,
    composite_indicators: row.composite_indicators,
    alerts:               row.alerts ?? [],
    solar_potential_result: row.solar_potential_result ?? null,
    property: {
      lat:           row.lat,
      lng:           row.lng,
      price_asking:  row.price_asking,
      price_per_sqm: row.price_per_sqm,
      area_sqm:      row.area_sqm,
      provincia:     row.provincia,
      municipio:     row.municipio,
      build_year:    row.build_year,
      epc_rating:    row.epc_rating,
      address:       row.address,
      bedrooms:      row.bedrooms,
      bathrooms:     row.bathrooms,
      property_type: row.property_type,
      floor:         row.floor,
      codigo_postal: row.codigo_postal,
      ref_catastral: row.ref_catastral,
      catastro_valor_referencia: row.catastro_valor_referencia,
      negotiation_gap_pct:       row.negotiation_gap_pct,
    },
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const jobId = searchParams.get('jobId')

  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
  }

  // --- 1. Look up as an analysis job (primary path) ---
  const [row] = await sql<{
    status: string
    step: number
    error_message: string | null
    source_url: string | null
    cache_id: string | null
    // From analysis_cache (only present when complete)
    tvi_score: number | null
    composite_indicators: unknown
    alerts: unknown
    expires_at: string | null
    source_url_cache: string | null
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
    codigo_postal: string | null
    ref_catastral: string | null
    catastro_valor_referencia: number | null
    negotiation_gap_pct: number | null
    solar_potential_result: unknown
  }[]>`
    SELECT
      j.status,
      j.step,
      j.error_message,
      j.source_url,
      j.cache_id,
      c.tvi_score,
      c.composite_indicators,
      c.alerts,
      c.expires_at,
      c.source_url          AS source_url_cache,
      c.lat,
      c.lng,
      c.price_asking,
      c.price_per_sqm,
      c.area_sqm,
      c.provincia,
      c.municipio,
      c.build_year,
      c.epc_rating,
      c.address,
      c.bedrooms,
      c.bathrooms,
      c.property_type,
      c.floor,
      c.codigo_postal,
      c.ref_catastral,
      c.catastro_valor_referencia,
      c.negotiation_gap_pct,
      c.solar_potential_result
    FROM analysis_jobs j
    LEFT JOIN analysis_cache c ON j.cache_id = c.id
    WHERE j.id = ${jobId}
    LIMIT 1
  `

  if (row) {
    // Still running — return progress only
    if (row.status === 'pending' || row.status === 'processing') {
      return NextResponse.json({ status: row.status, step: row.step ?? 0 })
    }

    // Failed — check for structured "needs input" errors first
    if (row.status === 'error') {
      const msg = row.error_message ?? ''
      if (msg.startsWith('NEEDS_INPUT:')) {
        const missing = msg.slice('NEEDS_INPUT:'.length).split(',').filter(Boolean)
        return NextResponse.json({
          status: 'needs_input',
          missing,
          sourceUrl: row.source_url ?? '',
        })
      }
      return NextResponse.json({
        status: 'error',
        message: msg || 'Analysis failed. Please try again.',
      })
    }

    // Complete — return full result
    if (row.status === 'complete') {
      return NextResponse.json(buildCompleteResponse(row))
    }
  }

  // --- 2. Fallback: look up directly in analysis_cache by id ---
  // Handles shared/bookmarked URLs where the job row may no longer exist.
  const [cached] = await sql<{
    id: string
    tvi_score: number | null
    composite_indicators: unknown
    alerts: unknown
    expires_at: string | null
    source_url: string | null
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
    codigo_postal: string | null
    ref_catastral: string | null
    catastro_valor_referencia: number | null
    negotiation_gap_pct: number | null
    solar_potential_result: unknown
  }[]>`
    SELECT
      id, tvi_score, composite_indicators, alerts, expires_at, source_url,
      lat, lng, price_asking, price_per_sqm, area_sqm,
      provincia, municipio, build_year, epc_rating,
      address, bedrooms, bathrooms, property_type, floor,
      codigo_postal, ref_catastral, catastro_valor_referencia, negotiation_gap_pct,
      solar_potential_result
    FROM analysis_cache
    WHERE id = ${jobId}
    LIMIT 1
  `

  if (cached) {
    return NextResponse.json(buildCompleteResponse({
      cache_id:               cached.id,
      tvi_score:              cached.tvi_score,
      composite_indicators:   cached.composite_indicators,
      alerts:                 cached.alerts,
      expires_at:             cached.expires_at,
      source_url_cache:       cached.source_url,
      lat:                    cached.lat,
      lng:                    cached.lng,
      price_asking:           cached.price_asking,
      price_per_sqm:          cached.price_per_sqm,
      area_sqm:               cached.area_sqm,
      provincia:              cached.provincia,
      municipio:              cached.municipio,
      build_year:             cached.build_year,
      epc_rating:             cached.epc_rating,
      address:                cached.address,
      bedrooms:               cached.bedrooms,
      bathrooms:              cached.bathrooms,
      property_type:          cached.property_type,
      floor:                  cached.floor,
      codigo_postal:             cached.codigo_postal,
      ref_catastral:             cached.ref_catastral,
      catastro_valor_referencia: cached.catastro_valor_referencia,
      negotiation_gap_pct:       cached.negotiation_gap_pct,
      solar_potential_result:    cached.solar_potential_result,
    }))
  }

  return NextResponse.json({ error: 'not_found' }, { status: 404 })
}
