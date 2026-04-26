/**
 * /api/library — Property Library CRUD (CHI-library)
 *
 * GET   — List the authenticated user's saved analyses (card grid data).
 * POST  — Save a completed analysis into the library.
 *
 * Individual-row operations (view full, refresh, delete, notes) live under
 * /api/library/[id]/... — see those files.
 *
 * All routes are cookie-authenticated via the Supabase server client.
 * RLS on saved_analyses enforces per-user isolation at the DB level too.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveUserId }        from '@/lib/library-auth';
import sql                           from '@/lib/db';

export const runtime = 'nodejs';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Row shape returned by GET /api/library. Intentionally narrow — the full
 * analysis_json is only returned by GET /api/library/[id]. This keeps the
 * list response small even with dozens of saved properties.
 */
export interface LibraryListItem {
  id:                 string;
  source_url:         string;
  source:             'manual' | 'idealista_import';
  tvi_score:          number | null;
  notes:              string | null;
  analysed_at:        string;
  created_at:         string;
  updated_at:         string;
  import_batch_id:    string | null;
  analysis_cache_id:  string | null;
  // Headline facts pulled out of analysis_json for card rendering.
  address:            string | null;
  municipio:          string | null;
  price_asking:       number | null;
  area_sqm:           number | null;
  bedrooms:           number | null;
  // Per-pillar score breakdown, pulled from composite_indicators.
  // Null if analysis_json didn't contain it.
  pillars:            Record<string, number | null> | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Pull the narrow card-view fields out of a full analysis_json snapshot.
 * Keeping this mapping in one place means the card UI doesn't need to
 * traverse the full shape itself.
 */
function projectCardFields(analysisJson: unknown): {
  address:      string | null;
  municipio:    string | null;
  price_asking: number | null;
  area_sqm:     number | null;
  bedrooms:     number | null;
  pillars:      Record<string, number | null> | null;
} {
  const j = (analysisJson ?? {}) as Record<string, unknown>;
  const prop = (j.property ?? {}) as Record<string, unknown>;
  const comp = (j.composite_indicators ?? null) as Record<string, unknown> | null;

  // composite_indicators is a map of indicator-name → { score, ... }.
  // We flatten to { name: score } so the UI can iterate cheaply.
  let pillars: Record<string, number | null> | null = null;
  if (comp && typeof comp === 'object') {
    pillars = {};
    for (const [k, v] of Object.entries(comp)) {
      const vv = v as Record<string, unknown> | null;
      const s  = vv && typeof vv === 'object' && typeof vv.score === 'number' ? vv.score : null;
      pillars[k] = s;
    }
  }

  return {
    address:      typeof prop.address      === 'string' ? prop.address      : null,
    municipio:    typeof prop.municipio    === 'string' ? prop.municipio    : null,
    price_asking: typeof prop.price_asking === 'number' ? prop.price_asking : null,
    area_sqm:     typeof prop.area_sqm     === 'number' ? prop.area_sqm     : null,
    bedrooms:     typeof prop.bedrooms     === 'number' ? prop.bedrooms     : null,
    pillars,
  };
}

// ─── GET — list the user's saved analyses ──────────────────────────────────

export async function GET() {
  const userId = await getEffectiveUserId();
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const rows = await sql<{
    id:                string;
    source_url:        string;
    source:            'manual' | 'idealista_import';
    tvi_score:         string | number | null;
    notes:             string | null;
    analysed_at:       string;
    created_at:        string;
    updated_at:        string;
    import_batch_id:   string | null;
    analysis_cache_id: string | null;
    analysis_json:     unknown;
  }[]>`
    SELECT
      id,
      source_url,
      source,
      tvi_score,
      notes,
      analysed_at,
      created_at,
      updated_at,
      import_batch_id,
      analysis_cache_id,
      analysis_json
    FROM saved_analyses
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT 500
  `;

  const items: LibraryListItem[] = rows.map(r => ({
    id:                r.id,
    source_url:        r.source_url,
    source:            r.source,
    tvi_score:         r.tvi_score != null ? Number(r.tvi_score) : null,
    notes:             r.notes,
    analysed_at:       r.analysed_at,
    created_at:        r.created_at,
    updated_at:        r.updated_at,
    import_batch_id:   r.import_batch_id,
    analysis_cache_id: r.analysis_cache_id,
    ...projectCardFields(r.analysis_json),
  }));

  return NextResponse.json({ items });
}

// ─── POST — save an analysis into the library ──────────────────────────────
//
// Body: { analysis_id: string, notes?: string, source?: 'manual'|'idealista_import', import_batch_id?: string }
//
// `analysis_id` is the UUID returned from GET /api/analyse/status (i.e.
// analysis_cache.id). We look the row up in analysis_cache to snapshot the
// full result into saved_analyses. ON CONFLICT (user_id, source_url) updates
// the existing save — pressing Save twice becomes an idempotent upsert.

export async function POST(request: NextRequest) {
  const userId = await getEffectiveUserId();
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const analysisId    = typeof body.analysis_id === 'string' ? body.analysis_id : null;
  const notes         = typeof body.notes === 'string' ? body.notes.slice(0, 2000) : null;
  const source        = body.source === 'idealista_import' ? 'idealista_import' : 'manual';
  const importBatchId = typeof body.import_batch_id === 'string' ? body.import_batch_id : null;

  if (!analysisId) {
    return NextResponse.json({ error: 'analysis_id_required' }, { status: 400 });
  }

  // Fetch the full analysis from cache so we can snapshot it.
  const [cached] = await sql<{
    id:                         string;
    source_url:                 string;
    tvi_score:                  string | number | null;
    composite_indicators:       unknown;
    alerts:                     unknown;
    expires_at:                 string | null;
    lat:                        number | null;
    lng:                        number | null;
    price_asking:               number | null;
    price_per_sqm:              number | null;
    area_sqm:                   number | null;
    provincia:                  string | null;
    municipio:                  string | null;
    build_year:                 number | null;
    epc_rating:                 string | null;
    address:                    string | null;
    bedrooms:                   number | null;
    bathrooms:                  number | null;
    property_type:              string | null;
    floor:                      number | null;
    codigo_postal:              string | null;
    ref_catastral:              string | null;
    catastro_valor_referencia:  number | null;
    negotiation_gap_pct:        number | null;
    solar_potential_result:     unknown;
  }[]>`
    SELECT
      id, source_url, tvi_score, composite_indicators, alerts, expires_at,
      lat, lng, price_asking, price_per_sqm, area_sqm,
      provincia, municipio, build_year, epc_rating,
      address, bedrooms, bathrooms, property_type, floor,
      codigo_postal, ref_catastral, catastro_valor_referencia, negotiation_gap_pct,
      solar_potential_result
    FROM analysis_cache
    WHERE id = ${analysisId}
    LIMIT 1
  `;

  if (!cached) {
    return NextResponse.json({ error: 'analysis_not_found' }, { status: 404 });
  }

  // Build the snapshot (same shape as GET /api/analyse/status complete response).
  const snapshot = {
    id:                     cached.id,
    source_url:             cached.source_url,
    expires_at:             cached.expires_at,
    tvi_score:              cached.tvi_score != null ? Number(cached.tvi_score) : null,
    composite_indicators:   cached.composite_indicators,
    alerts:                 cached.alerts ?? [],
    solar_potential_result: cached.solar_potential_result ?? null,
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
      codigo_postal: cached.codigo_postal,
      ref_catastral: cached.ref_catastral,
      catastro_valor_referencia: cached.catastro_valor_referencia,
      negotiation_gap_pct:       cached.negotiation_gap_pct,
    },
  };

  const tviScore = cached.tvi_score != null ? Number(cached.tvi_score) : null;

  const [saved] = await sql<{ id: string; created_at: string; updated_at: string }[]>`
    INSERT INTO saved_analyses (
      user_id, source_url, analysis_cache_id, analysis_json,
      tvi_score, source, notes, analysed_at, import_batch_id
    )
    VALUES (
      ${userId},
      ${cached.source_url},
      ${cached.id},
      ${sql.json(snapshot as unknown as Parameters<typeof sql.json>[0])},
      ${tviScore},
      ${source},
      ${notes},
      NOW(),
      ${importBatchId}
    )
    ON CONFLICT (user_id, source_url) DO UPDATE
      SET analysis_cache_id = EXCLUDED.analysis_cache_id,
          analysis_json     = EXCLUDED.analysis_json,
          tvi_score         = EXCLUDED.tvi_score,
          analysed_at       = NOW(),
          updated_at        = NOW()
    RETURNING id, created_at, updated_at
  `;

  return NextResponse.json(saved, { status: 201 });
}
