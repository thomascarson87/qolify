/**
 * GET /api/map/overlay/solar
 *
 * Returns PVGIS solar grid points as a GeoJSON FeatureCollection.
 * Used by the Solar Exposure overlay in MapClient — rendered as a circle
 * heatmap (circle-blur) with colour interpolated from GHI values.
 *
 * Unlike the previous approach (zones-fill with Nominatim bounding boxes),
 * this uses the actual solar_radiation measurement points, which are on a
 * 1–5 km PVGIS grid and produce a smooth, geographically accurate heatmap.
 *
 * Query params:
 *   bbox  — "west,south,east,north" in EPSG:4326 (required)
 *
 * Response:
 *   GeoJSON FeatureCollection — Point features with { ghi: number } property.
 */

import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const bboxParam = searchParams.get('bbox');

  if (!bboxParam) {
    return NextResponse.json({ error: 'bbox_required' }, { status: 400 });
  }

  const parts = bboxParam.split(',').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) {
    return NextResponse.json({ error: 'invalid_bbox' }, { status: 400 });
  }

  const [west, south, east, north] = parts;

  try {
    const rows = await db<{ lng: number; lat: number; ghi: number }[]>`
      SELECT
        ST_X(geom::geometry)::float AS lng,
        ST_Y(geom::geometry)::float AS lat,
        ghi_annual_kwh_m2::float    AS ghi
      FROM solar_radiation
      WHERE geom && ST_MakeEnvelope(${west}::float, ${south}::float, ${east}::float, ${north}::float, 4326)
      LIMIT 2000
    `;

    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: rows.map(row => ({
        type:       'Feature',
        geometry:   { type: 'Point', coordinates: [row.lng, row.lat] },
        properties: { ghi: row.ghi },
      })),
    };

    return NextResponse.json(geojson, {
      headers: { 'Cache-Control': 'public, max-age=86400' }, // solar data is stable — 24h cache
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[solar overlay API]', message);
    return NextResponse.json(
      { error: 'db_error', detail: process.env.VERCEL ? undefined : message },
      { status: 500 }
    );
  }
}
