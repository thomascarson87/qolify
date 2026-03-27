/**
 * POST /api/analyse
 *
 * On-demand property analysis pipeline (Model B).
 *
 * Flow:
 *  1. Check analysis_cache for a non-expired result
 *  2. If fresh cache hit → return immediately
 *  3. Otherwise:
 *     a. Extract listing data (Parse.bot or manual input for Phase 0 testing)
 *     b. Run all composite indicators via PostGIS
 *     c. Write to analysis_cache + property_price_history
 *  4. Return full analysis result
 *
 * Phase 0 testing:
 *   Pass `property` object directly to bypass Parse.bot extraction.
 *   Example:
 *   {
 *     "url": "https://www.idealista.com/inmueble/12345/",
 *     "property": {
 *       "lat": 36.720, "lng": -4.420, "price_asking": 350000,
 *       "area_sqm": 90, "comunidad_autonoma": "Andalucía",
 *       "municipio": "Málaga", "build_year": 1995, "epc_rating": "D"
 *     }
 *   }
 */
import { NextRequest, NextResponse } from 'next/server'
import sql from '@/lib/db'
import { runAllIndicators, collectAlerts, calcTviScore } from '@/lib/indicators'
import type { PropertyInput } from '@/lib/indicators/types'

export const runtime = 'nodejs'
export const maxDuration = 90  // seconds — spatial queries can be slow on cold start

interface AnalyseRequest {
  url: string
  property?: Partial<PropertyInput>  // manual override for Phase 0 testing
  buyer_age?: number
}

export async function POST(req: NextRequest) {
  let body: AnalyseRequest

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { url, property: manualProperty, buyer_age } = body

  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'url is required' }, { status: 400 })
  }

  // --- 1. Cache check ---
  const [cached] = await sql<{ id: string; composite_indicators: unknown; tvi_score: number | null; expires_at: string }[]>`
    SELECT id, composite_indicators, tvi_score, expires_at
    FROM analysis_cache
    WHERE source_url = ${url}
      AND expires_at > NOW()
    LIMIT 1
  `

  if (cached) {
    return NextResponse.json({
      id:                   cached.id,
      source_url:           url,
      cached:               true,
      expires_at:           cached.expires_at,
      tvi_score:            cached.tvi_score,
      composite_indicators: cached.composite_indicators,
    })
  }

  // --- 2. Property data ---
  // Phase 0: use manual property if provided.
  // Production: call Parse.bot here to extract from URL.
  let propertyInput: PropertyInput | null = null

  if (manualProperty && manualProperty.lat && manualProperty.lng && manualProperty.price_asking) {
    propertyInput = {
      lat:                 manualProperty.lat,
      lng:                 manualProperty.lng,
      price_asking:        manualProperty.price_asking,
      area_sqm:            manualProperty.area_sqm ?? 80,
      comunidad_autonoma:  manualProperty.comunidad_autonoma ?? 'Madrid',
      municipio:           manualProperty.municipio,
      codigo_postal:       manualProperty.codigo_postal,
      ref_catastral:       manualProperty.ref_catastral,
      build_year:          manualProperty.build_year,
      epc_rating:          manualProperty.epc_rating,
      epc_potential:       manualProperty.epc_potential,
      bedrooms:            manualProperty.bedrooms,
      floor:               manualProperty.floor,
      seller_type:         manualProperty.seller_type,
      catastro_year_built: manualProperty.catastro_year_built,
      negotiation_gap_pct: manualProperty.negotiation_gap_pct,
    }
  } else {
    // TODO: Parse.bot extraction (Phase 1)
    // For now, return a clear error asking for manual property data
    return NextResponse.json(
      {
        error: 'Parse.bot not yet integrated. Pass a `property` object for Phase 0 testing.',
        example: {
          url,
          property: {
            lat: 36.720,
            lng: -4.420,
            price_asking: 350000,
            area_sqm: 90,
            comunidad_autonoma: 'Andalucía',
            municipio: 'Málaga',
            build_year: 1995,
            epc_rating: 'D',
          },
        },
      },
      { status: 422 },
    )
  }

  // --- 3. Run indicator engine ---
  let indicators
  try {
    indicators = await runAllIndicators(sql, propertyInput, buyer_age)
  } catch (err) {
    console.error('[analyse] indicator engine error:', err)
    return NextResponse.json(
      { error: 'Indicator calculation failed', detail: String(err) },
      { status: 500 },
    )
  }

  const allAlerts  = collectAlerts(indicators)
  const tviScore   = calcTviScore(indicators)
  const pricePerSqm = propertyInput.area_sqm > 0
    ? Math.round(propertyInput.price_asking / propertyInput.area_sqm)
    : null

  // --- 4. Write to analysis_cache ---
  const [record] = await sql<{ id: string; expires_at: string }[]>`
    INSERT INTO analysis_cache (
      source_url,
      lat, lng, geom,
      municipio,
      codigo_postal,
      price_asking,
      price_per_sqm,
      area_sqm,
      build_year,
      epc_rating,
      ref_catastral,
      bedrooms,
      floor,
      seller_type,
      composite_indicators,
      alerts,
      tvi_score,
      extracted_at,
      expires_at
    ) VALUES (
      ${url},
      ${propertyInput.lat},
      ${propertyInput.lng},
      ST_SetSRID(ST_MakePoint(${propertyInput.lng}, ${propertyInput.lat}), 4326)::GEOGRAPHY,
      ${propertyInput.municipio ?? null},
      ${propertyInput.codigo_postal ?? null},
      ${propertyInput.price_asking},
      ${pricePerSqm},
      ${propertyInput.area_sqm},
      ${propertyInput.build_year ?? propertyInput.catastro_year_built ?? null},
      ${propertyInput.epc_rating ?? null},
      ${propertyInput.ref_catastral ?? null},
      ${propertyInput.bedrooms ?? null},
      ${propertyInput.floor ?? null},
      ${propertyInput.seller_type ?? null},
      ${JSON.stringify(indicators)},
      ${JSON.stringify(allAlerts)},
      ${tviScore},
      NOW(),
      NOW() + INTERVAL '48 hours'
    )
    ON CONFLICT (source_url) DO UPDATE SET
      composite_indicators = EXCLUDED.composite_indicators,
      alerts               = EXCLUDED.alerts,
      tvi_score            = EXCLUDED.tvi_score,
      extracted_at         = NOW(),
      expires_at           = NOW() + INTERVAL '48 hours',
      price_logged         = FALSE
    RETURNING id, expires_at
  `

  // --- 5. Write to property_price_history ---
  if (record) {
    await sql`
      INSERT INTO property_price_history (
        cache_id, source_url, codigo_postal,
        price, price_per_sqm, observed_at, source
      ) VALUES (
        ${record.id},
        ${url},
        ${propertyInput.codigo_postal ?? null},
        ${propertyInput.price_asking},
        ${pricePerSqm},
        NOW(),
        'user_submission'
      )
    `
    // Mark as logged
    await sql`
      UPDATE analysis_cache SET price_logged = TRUE WHERE id = ${record.id}
    `
  }

  return NextResponse.json({
    id:                   record?.id,
    source_url:           url,
    cached:               false,
    expires_at:           record?.expires_at,
    tvi_score:            tviScore,
    composite_indicators: indicators,
    alerts:               allAlerts,
    property: {
      lat:                 propertyInput.lat,
      lng:                 propertyInput.lng,
      price_asking:        propertyInput.price_asking,
      price_per_sqm:       pricePerSqm,
      area_sqm:            propertyInput.area_sqm,
      comunidad_autonoma:  propertyInput.comunidad_autonoma,
      municipio:           propertyInput.municipio,
      build_year:          propertyInput.build_year,
      epc_rating:          propertyInput.epc_rating,
    },
  })
}
