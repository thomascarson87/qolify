/**
 * GET /api/map/overlay/noise?bbox=minLng,minLat,maxLng,maxLat
 *
 * CHI-417 — GeoJSON FeatureCollection of noise_zones polygons intersecting
 * the bbox. Used by NoiseExposureCard's mini-map to render coloured Lden
 * contour bands around the property coordinate.
 *
 * Table columns surfaced as feature properties:
 *   lden_min     SMALLINT  — lower dB bound of the band (55/60/65/70/75)
 *   lden_band    TEXT      — display label, e.g. "60-65"
 *   source_type  TEXT      — 'road' | 'rail' | 'airport' | 'industry'
 *
 * LIMIT 300 — EEA contour datasets are dense; at card-level zoom the limit
 * is never reached. Responses are safe to cache for 10 minutes since noise
 * polygons only change between EU reporting rounds (5-year cadence).
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

  const envelope = db.unsafe(
    `ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326)`
  );

  const rows = await db`
    SELECT
      lden_min,
      lden_band,
      source_type,
      ST_AsGeoJSON(geom)::json AS geometry
    FROM noise_zones
    WHERE ST_Intersects(geom, ${envelope})
    LIMIT 300`;

  const geojson = {
    type: 'FeatureCollection' as const,
    features: rows.map(r => ({
      type:     'Feature' as const,
      geometry: r.geometry as GeoJSON.MultiPolygon,
      properties: {
        lden_min:    r.lden_min as number,
        lden_band:   r.lden_band as string,
        source_type: r.source_type as string,
      },
    })),
  };

  return NextResponse.json(geojson, {
    headers: { 'Cache-Control': 'public, max-age=600' },
  });
}
