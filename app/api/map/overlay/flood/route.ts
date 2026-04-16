/**
 * GET /api/map/overlay/flood?bbox=minLng,minLat,maxLng,maxLat
 *
 * CHI-362 — Returns a GeoJSON FeatureCollection of flood zone polygons
 * (SNCZI T10 / T100 / T500) intersecting the current map viewport bbox.
 *
 * The flood_zones table uses:
 *   geom       GEOGRAPHY(MULTIPOLYGON, 4326)
 *   risk_level TEXT — values: 'T10' | 'T100' | 'T500'
 *
 * Each returned feature carries `risk_level` in its properties so MapLibre
 * can filter layers by return period.
 *
 * LIMIT 500 — the SNCZI dataset is dense; server-side cap prevents oversized
 * GeoJSON responses. At city-level zoom this limit is never reached.
 */
import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const rawBbox = searchParams.get('bbox');

  if (!rawBbox) {
    return NextResponse.json({ error: 'invalid_params' }, { status: 400 });
  }

  const parts = rawBbox.split(',').map(Number);
  if (parts.length !== 4 || parts.some(n => !isFinite(n))) {
    return NextResponse.json({ error: 'invalid_params' }, { status: 400 });
  }

  const [minLng, minLat, maxLng, maxLat] = parts;

  // ST_MakeEnvelope is a SQL expression — use db.unsafe() so postgres.js
  // passes it as raw SQL rather than a parameterised text literal.
  const envelope = db.unsafe(
    `ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326)`
  );

  const rows = await db`
    SELECT
      risk_level,
      ST_AsGeoJSON(geom)::json AS geometry
    FROM flood_zones
    WHERE ST_Intersects(
      geom,
      ${envelope}
    )
    LIMIT 500`;

  const geojson = {
    type: 'FeatureCollection' as const,
    features: rows.map(r => ({
      type:       'Feature' as const,
      geometry:   r.geometry as GeoJSON.MultiPolygon,
      properties: { risk_level: r.risk_level as string },
    })),
  };

  return NextResponse.json(geojson, {
    // Flood zone boundaries change infrequently — 10-min client cache is safe.
    headers: { 'Cache-Control': 'public, max-age=600' },
  });
}
