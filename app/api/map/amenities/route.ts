/**
 * GET /api/map/amenities
 *
 * CHI-370 — Returns all 7 amenity types for a pin in a single request.
 * Replaces the 7 separate /api/map/layer?type=X requests that were fired
 * in parallel from fetchPinAmenities, reducing HTTP overhead from 7 round
 * trips to 1.
 *
 * Query params: ?lat={lat}&lng={lng}&radius={metres}
 *
 * Response: { schools: Feature[], health: Feature[], pharmacy: Feature[],
 *              transport: Feature[], supermarket: Feature[], park: Feature[],
 *              cafe: Feature[] }
 *
 * Each feature has geometry { type: 'Point', coordinates: [lng, lat] }
 * and properties { name, distance_m, type? }.
 *
 * Category filters (same as /api/map/layer radius mode):
 *   pharmacy    — category='pharmacy' only
 *   supermarket — category='supermarket' only (no convenience/grocery corner shops)
 *   park        — category='park' only (no garden — private gardens)
 *   cafe        — display_category='cafe'
 */

import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

interface PointRow {
  name:       string;
  type?:      string;
  lat:        number;
  lng:        number;
  distance_m: number;
}

function toFeatures(rows: PointRow[]) {
  return rows.map(r => ({
    type:     'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [r.lng, r.lat] },
    properties: {
      name:       r.name,
      type:       r.type,
      distance_m: r.distance_m,
    },
  }));
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const latStr    = searchParams.get('lat');
  const lngStr    = searchParams.get('lng');
  const radiusStr = searchParams.get('radius') ?? '400';

  if (!latStr || !lngStr) {
    return NextResponse.json({ error: 'missing_params' }, { status: 400 });
  }

  const lat    = parseFloat(latStr);
  const lng    = parseFloat(lngStr);
  const radius = parseInt(radiusStr, 10);

  if (!isFinite(lat) || !isFinite(lng) || !isFinite(radius)) {
    return NextResponse.json({ error: 'invalid_params' }, { status: 400 });
  }

  try {
    const [schools, health, pharmacy, transport, supermarket, park, cafe] = await Promise.all([

      db`SELECT
          nombre                                                        AS name,
          tipo                                                          AS type,
          ST_X(geom::geometry)                                          AS lng,
          ST_Y(geom::geometry)                                          AS lat,
          ROUND(ST_Distance(geom::geography,
            ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography))::int AS distance_m
         FROM schools
         WHERE ST_DWithin(geom::geography,
           ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${radius})
         ORDER BY distance_m LIMIT 30`,

      db`SELECT
          nombre                                                        AS name,
          tipo                                                          AS type,
          ST_X(geom::geometry)                                          AS lng,
          ST_Y(geom::geometry)                                          AS lat,
          ROUND(ST_Distance(geom::geography,
            ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography))::int AS distance_m
         FROM health_centres
         WHERE ST_DWithin(geom::geography,
           ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${radius})
         ORDER BY distance_m LIMIT 20`,

      db`SELECT
          nombre                                                        AS name,
          ST_X(geom::geometry)                                          AS lng,
          ST_Y(geom::geometry)                                          AS lat,
          ROUND(ST_Distance(geom::geography,
            ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography))::int AS distance_m
         FROM amenities
         WHERE category = 'pharmacy'
           AND ST_DWithin(geom::geography,
             ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${radius})
         ORDER BY distance_m LIMIT 20`,

      db`SELECT
          nombre                                                        AS name,
          tipo                                                          AS type,
          ST_X(geom::geometry)                                          AS lng,
          ST_Y(geom::geometry)                                          AS lat,
          ROUND(ST_Distance(geom::geography,
            ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography))::int AS distance_m
         FROM transport_stops
         WHERE ST_DWithin(geom::geography,
           ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${radius})
         ORDER BY distance_m LIMIT 30`,

      db`SELECT
          nombre                                                        AS name,
          ST_X(geom::geometry)                                          AS lng,
          ST_Y(geom::geometry)                                          AS lat,
          ROUND(ST_Distance(geom::geography,
            ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography))::int AS distance_m
         FROM amenities
         WHERE category = 'supermarket'
           AND ST_DWithin(geom::geography,
             ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${radius})
         ORDER BY distance_m LIMIT 20`,

      db`SELECT
          nombre                                                        AS name,
          ST_X(geom::geometry)                                          AS lng,
          ST_Y(geom::geometry)                                          AS lat,
          ROUND(ST_Distance(geom::geography,
            ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography))::int AS distance_m
         FROM amenities
         WHERE category = 'park'
           AND ST_DWithin(geom::geography,
             ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${radius})
         ORDER BY distance_m LIMIT 20`,

      db`SELECT
          nombre                                                        AS name,
          ST_X(geom::geometry)                                          AS lng,
          ST_Y(geom::geometry)                                          AS lat,
          ROUND(ST_Distance(geom::geography,
            ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography))::int AS distance_m
         FROM amenities
         WHERE display_category = 'cafe'
           AND ST_DWithin(geom::geography,
             ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${radius})
         ORDER BY distance_m LIMIT 20`,
    ]);

    return NextResponse.json(
      {
        schools:     toFeatures(schools     as unknown as PointRow[]),
        health:      toFeatures(health      as unknown as PointRow[]),
        pharmacy:    toFeatures(pharmacy    as unknown as PointRow[]),
        transport:   toFeatures(transport   as unknown as PointRow[]),
        supermarket: toFeatures(supermarket as unknown as PointRow[]),
        park:        toFeatures(park        as unknown as PointRow[]),
        cafe:        toFeatures(cafe        as unknown as PointRow[]),
      },
      { headers: { 'Cache-Control': 'public, max-age=300' } }
    );

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[amenities API]', message);
    return NextResponse.json(
      { error: 'db_error', detail: process.env.VERCEL ? undefined : message },
      { status: 500 }
    );
  }
}
