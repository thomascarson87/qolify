/**
 * POST /api/library/[id]/refresh
 *
 * Re-runs the analysis for a saved property, then updates the saved row
 * with the new snapshot.
 *
 * Design:
 *  - Expires the existing analysis_cache row (sets expires_at = NOW()) so
 *    the next /api/analyse call skips the cache and triggers a fresh job.
 *  - Delegates to the normal async pipeline by POST-ing to /api/analyse
 *    with the saved property's source_url plus any pre-enrichment lat/lng
 *    we already have. Returns { jobId } — the client polls status, then
 *    calls POST /api/library again with the resulting analysis_id to
 *    overwrite the saved snapshot via the existing upsert.
 *
 * This keeps the pipeline single-sourced: we never duplicate the analyse
 * logic, and refresh just becomes "invalidate + re-run + upsert".
 */
import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveUserId }        from '@/lib/library-auth';
import sql                           from '@/lib/db';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Params) {
  const { id } = await ctx.params;

  const userId = await getEffectiveUserId();
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  // Load the saved row + pull lat/lng/price/area out of the snapshot so we
  // can re-submit them as pre-enrichment overrides.
  const [row] = await sql<{
    id:            string;
    source_url:    string;
    analysis_json: { property?: { lat?: number; lng?: number; price_asking?: number; area_sqm?: number } };
  }[]>`
    SELECT id, source_url, analysis_json
    FROM saved_analyses
    WHERE id = ${id} AND user_id = ${userId}
    LIMIT 1
  `;

  if (!row) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Invalidate the cache row for this source_url so /api/analyse
  // doesn't short-circuit back to the stale result.
  await sql`
    UPDATE analysis_cache
       SET expires_at = NOW()
     WHERE source_url = ${row.source_url}
  `;

  const prop = row.analysis_json?.property ?? {};

  // Re-submit to /api/analyse. We forward cookies so the (optional) auth
  // context is preserved, though /api/analyse doesn't require auth today.
  const origin = new URL(req.url).origin;
  const res = await fetch(`${origin}/api/analyse`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'cookie':       req.headers.get('cookie') ?? '',
    },
    body: JSON.stringify({
      // Pin-URI source_urls (pin:lat,lng) become coord-only jobs —
      // /api/analyse handles `url: null` by rebuilding the pin URI.
      url:   row.source_url.startsWith('pin:') ? null : row.source_url,
      lat:   prop.lat,
      lng:   prop.lng,
      price: prop.price_asking,
      area:  prop.area_sqm,
      tier:  'free',
    }),
  });

  const body = await res.json().catch(() => ({}));

  // Forward the analyse response verbatim — may contain { id } (cache hit),
  // { jobId, status: 'pending' } (new job), or an error.
  return NextResponse.json(body, { status: res.status });
}
