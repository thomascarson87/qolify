/**
 * /api/map/pin/save — Saved pins CRUD (CHI-362 / D-039)
 *
 * POST  — Save a new pin drop for the authenticated user.
 *         Body: { lat, lng, name, address?, listing_url? }
 *         Returns: { id, name, created_at }
 *
 * GET   — List the current user's saved pins.
 *         Returns: SavedPin[]
 *
 * Both routes require an authenticated Supabase session (cookie-based).
 * RLS on saved_pins enforces per-user isolation at the DB level as well.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@/lib/supabase/server';
import db                            from '@/lib/db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SavedPin {
  id:           string;
  lat:          number;
  lng:          number;
  name:         string;
  address:      string | null;
  listing_urls: string[];
  created_at:   string;
}

// ---------------------------------------------------------------------------
// POST — create a saved pin
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // Verify auth
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const lat  = typeof body.lat  === 'number' ? body.lat  : parseFloat(body.lat  as string);
  const lng  = typeof body.lng  === 'number' ? body.lng  : parseFloat(body.lng  as string);
  const name = typeof body.name === 'string' && body.name.trim()
    ? body.name.trim().slice(0, 120)
    : 'Unnamed pin';
  const address     = typeof body.address     === 'string' ? body.address.slice(0, 300)  : null;
  const listingUrl  = typeof body.listing_url === 'string' && body.listing_url.trim()
    ? body.listing_url.trim()
    : null;

  // Validate coordinates — Spain bounds
  if (
    !isFinite(lat) || !isFinite(lng) ||
    lat < 27.5 || lat > 44.5 ||
    lng < -20  || lng > 5
  ) {
    return NextResponse.json({ error: 'invalid_coordinates' }, { status: 400 });
  }

  // Build listing_urls array — Phase 1: at most one URL
  const listingUrls = listingUrl ? [listingUrl] : [];

  // geom uses ST_MakePoint via db.unsafe — lat/lng are validated floats above
  const geomExpr = db.unsafe(
    `ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`
  );

  const rows = await db`
    INSERT INTO saved_pins (user_id, lat, lng, geom, name, address, listing_urls)
    VALUES (
      ${user.id},
      ${lat},
      ${lng},
      ${geomExpr},
      ${name},
      ${address},
      ${db.array(listingUrls)}
    )
    RETURNING id, name, created_at`;

  return NextResponse.json(rows[0], { status: 201 });
}

// ---------------------------------------------------------------------------
// GET — list user's saved pins
// ---------------------------------------------------------------------------

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const rows = await db`
    SELECT
      id,
      lat::float8           AS lat,
      lng::float8           AS lng,
      name,
      address,
      listing_urls,
      created_at
    FROM saved_pins
    WHERE user_id = ${user.id}
    ORDER BY created_at DESC
    LIMIT 100`;

  return NextResponse.json(rows as unknown as SavedPin[]);
}
