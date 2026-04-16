/**
 * GET /api/map/layer
 *
 * CHI-340 — Returns a GeoJSON FeatureCollection of point features for the
 * requested layer type. Supports two query modes:
 *
 * 1. Radius mode (pin-scoped — CHI-370):
 *    ?type={type}&lat={lat}&lng={lng}&radius={metres}
 *    Uses ST_DWithin for circle-based filtering. Returns distance_m in properties.
 *    Supported types: schools | health | transport | pharmacy | supermarket | park | cafe
 *
 * 2. Bbox mode (city overview — original CHI-340 behaviour):
 *    ?type={type}&bbox={minLng},{minLat},{maxLng},{maxLat}
 *    Uses ST_MakeEnvelope for rectangle-based filtering.
 *    Supported types: schools | health | transport | infrastructure | vut_points
 *
 * Column names use the actual DB schema (Spanish names):
 *   schools:        nombre, tipo, etapas
 *   health_centres: nombre, tipo, is_24h
 *   transport_stops: nombre, tipo
 *   infrastructure_projects: nombre, type
 *   vut_licences:   address, status
 *   amenities:      nombre, display_category  (pharmacy / supermarket / park / cafe)
 *
 * GEOGRAPHY → GEOMETRY cast: all geom columns are GEOGRAPHY; we cast to
 * GEOMETRY for the && bbox operator and ST_X/ST_Y extraction.
 */
import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const type = searchParams.get('type');

  if (!type) {
    return NextResponse.json({ error: 'invalid_params' }, { status: 400 });
  }

  const latStr = searchParams.get('lat');
  const lngStr = searchParams.get('lng');

  // ─── Radius mode (pin-scoped queries for CHI-370) ─────────────────────────
  if (latStr !== null && lngStr !== null) {
    const latNum = parseFloat(latStr);
    const lngNum = parseFloat(lngStr);
    const radius = parseInt(searchParams.get('radius') ?? '400', 10);

    if (!isFinite(latNum) || !isFinite(lngNum) || !isFinite(radius)) {
      return NextResponse.json({ error: 'invalid_params' }, { status: 400 });
    }

    let rows: Record<string, unknown>[];

    switch (type) {
      case 'schools':
        rows = await db`
          SELECT
            nombre                                AS name,
            tipo                                  AS type,
            ST_X(geom::geometry)                  AS lng,
            ST_Y(geom::geometry)                  AS lat,
            ROUND(ST_Distance(
              geom::geography,
              ST_SetSRID(ST_MakePoint(${lngNum}, ${latNum}), 4326)::geography
            ))::int                               AS distance_m
          FROM schools
          WHERE ST_DWithin(
            geom::geography,
            ST_SetSRID(ST_MakePoint(${lngNum}, ${latNum}), 4326)::geography,
            ${radius}
          )
          ORDER BY distance_m
          LIMIT 50`;
        break;

      case 'health':
        rows = await db`
          SELECT
            nombre                                AS name,
            tipo                                  AS type,
            is_24h                                AS has_emergency,
            ST_X(geom::geometry)                  AS lng,
            ST_Y(geom::geometry)                  AS lat,
            ROUND(ST_Distance(
              geom::geography,
              ST_SetSRID(ST_MakePoint(${lngNum}, ${latNum}), 4326)::geography
            ))::int                               AS distance_m
          FROM health_centres
          WHERE ST_DWithin(
            geom::geography,
            ST_SetSRID(ST_MakePoint(${lngNum}, ${latNum}), 4326)::geography,
            ${radius}
          )
          ORDER BY distance_m
          LIMIT 50`;
        break;

      case 'transport':
        rows = await db`
          SELECT
            nombre                                AS name,
            tipo                                  AS type,
            ST_X(geom::geometry)                  AS lng,
            ST_Y(geom::geometry)                  AS lat,
            ROUND(ST_Distance(
              geom::geography,
              ST_SetSRID(ST_MakePoint(${lngNum}, ${latNum}), 4326)::geography
            ))::int                               AS distance_m
          FROM transport_stops
          WHERE ST_DWithin(
            geom::geography,
            ST_SetSRID(ST_MakePoint(${lngNum}, ${latNum}), 4326)::geography,
            ${radius}
          )
          ORDER BY distance_m
          LIMIT 50`;
        break;

      // Amenities table — filtered by raw OSM category, not display_category,
      // to avoid inflated counts from overly-broad tag groupings.
      //
      // 'pharmacy'    — only category='pharmacy' (no problematic catch-alls)
      // 'supermarket' — only category='supermarket', excludes 'convenience'/'grocery'
      //                 (corner shops) which inflate counts to implausible numbers
      // 'park'        — only category='park', excludes 'garden' which includes
      //                 private gardens and inflates counts to hundreds
      // 'cafe'        — display_category='cafe' is fine (cafe + coffee_shop both valid)
      case 'pharmacy': {
        rows = await db`
          SELECT
            nombre                                AS name,
            display_category,
            ST_X(geom::geometry)                  AS lng,
            ST_Y(geom::geometry)                  AS lat,
            ROUND(ST_Distance(
              geom::geography,
              ST_SetSRID(ST_MakePoint(${lngNum}, ${latNum}), 4326)::geography
            ))::int                               AS distance_m
          FROM amenities
          WHERE category = 'pharmacy'
            AND ST_DWithin(
              geom::geography,
              ST_SetSRID(ST_MakePoint(${lngNum}, ${latNum}), 4326)::geography,
              ${radius}
            )
          ORDER BY distance_m
          LIMIT 50`;
        break;
      }
      case 'supermarket': {
        rows = await db`
          SELECT
            nombre                                AS name,
            display_category,
            ST_X(geom::geometry)                  AS lng,
            ST_Y(geom::geometry)                  AS lat,
            ROUND(ST_Distance(
              geom::geography,
              ST_SetSRID(ST_MakePoint(${lngNum}, ${latNum}), 4326)::geography
            ))::int                               AS distance_m
          FROM amenities
          WHERE category = 'supermarket'
            AND ST_DWithin(
              geom::geography,
              ST_SetSRID(ST_MakePoint(${lngNum}, ${latNum}), 4326)::geography,
              ${radius}
            )
          ORDER BY distance_m
          LIMIT 50`;
        break;
      }
      case 'park': {
        rows = await db`
          SELECT
            nombre                                AS name,
            display_category,
            ST_X(geom::geometry)                  AS lng,
            ST_Y(geom::geometry)                  AS lat,
            ROUND(ST_Distance(
              geom::geography,
              ST_SetSRID(ST_MakePoint(${lngNum}, ${latNum}), 4326)::geography
            ))::int                               AS distance_m
          FROM amenities
          WHERE category = 'park'
            AND ST_DWithin(
              geom::geography,
              ST_SetSRID(ST_MakePoint(${lngNum}, ${latNum}), 4326)::geography,
              ${radius}
            )
          ORDER BY distance_m
          LIMIT 50`;
        break;
      }
      case 'cafe': {
        rows = await db`
          SELECT
            nombre                                AS name,
            display_category,
            ST_X(geom::geometry)                  AS lng,
            ST_Y(geom::geometry)                  AS lat,
            ROUND(ST_Distance(
              geom::geography,
              ST_SetSRID(ST_MakePoint(${lngNum}, ${latNum}), 4326)::geography
            ))::int                               AS distance_m
          FROM amenities
          WHERE display_category = 'cafe'
            AND ST_DWithin(
              geom::geography,
              ST_SetSRID(ST_MakePoint(${lngNum}, ${latNum}), 4326)::geography,
              ${radius}
            )
          ORDER BY distance_m
          LIMIT 50`;
        break;
      }

      default:
        return NextResponse.json({ error: 'unknown_type' }, { status: 400 });
    }

    const geojson = {
      type: 'FeatureCollection' as const,
      features: rows.map(r => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [r.lng as number, r.lat as number],
        },
        properties: Object.fromEntries(
          Object.entries(r).filter(([k]) => k !== 'lng' && k !== 'lat')
        ),
      })),
    };

    return NextResponse.json(geojson, {
      headers: { 'Cache-Control': 'public, max-age=300' },
    });
  }

  // ─── Bbox mode (city overview — original CHI-340 behaviour) ───────────────
  const rawBbox = searchParams.get('bbox');

  if (!rawBbox) {
    return NextResponse.json({ error: 'invalid_params' }, { status: 400 });
  }

  const parts = rawBbox.split(',').map(Number);
  if (parts.length !== 4 || parts.some(n => !isFinite(n))) {
    return NextResponse.json({ error: 'invalid_params' }, { status: 400 });
  }

  const [minLng, minLat, maxLng, maxLat] = parts;

  // ST_MakeEnvelope is a SQL expression, not a value — use db.unsafe() so
  // postgres.js passes it as raw SQL rather than a parameterised text literal.
  const envelope = db.unsafe(
    `ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326)`
  );

  let rows: Record<string, unknown>[];

  switch (type) {
    case 'schools':
      // tipo: 'publico' | 'concertado' | 'privado'
      // etapas: text[] — education stages
      rows = await db`
        SELECT
          nombre                              AS name,
          tipo                               AS type,
          etapas                             AS levels,
          ST_X(geom::geometry)               AS lng,
          ST_Y(geom::geometry)               AS lat
        FROM schools
        WHERE geom::geometry && ${envelope}
        LIMIT 500`;
      break;

    case 'health':
      // tipo: 'centro_salud' | 'hospital' | 'urgencias_24h' | 'farmacia' | 'clinica'
      // is_24h: boolean — true for emergency / 24h facilities
      rows = await db`
        SELECT
          nombre                              AS name,
          tipo                               AS type,
          is_24h                             AS has_emergency,
          ST_X(geom::geometry)               AS lng,
          ST_Y(geom::geometry)               AS lat
        FROM health_centres
        WHERE geom::geometry && ${envelope}
        LIMIT 500`;
      break;

    case 'transport':
      rows = await db`
        SELECT
          nombre                              AS name,
          tipo                               AS type,
          operator                           AS line,
          ST_X(geom::geometry)               AS lng,
          ST_Y(geom::geometry)               AS lat
        FROM transport_stops
        WHERE geom::geometry && ${envelope}
        LIMIT 1000`;
      break;

    case 'infrastructure':
      // Only approved projects; nombre maps to name; expected_date for year context
      rows = await db`
        SELECT
          nombre                              AS name,
          type,
          status,
          EXTRACT(YEAR FROM expected_date)::int AS expected_year,
          ST_X(geom::geometry)               AS lng,
          ST_Y(geom::geometry)               AS lat
        FROM infrastructure_projects
        WHERE status = 'approved'
          AND geom::geometry && ${envelope}`;
      break;

    case 'vut_points':
      // geom IS NOT NULL: all 192K rows currently have geom = NULL (OpenRTA
      // returns no coordinates); guard prevents seq scan on bbox filter.
      rows = await db`
        SELECT
          address,
          status,
          ST_X(geom::geometry)               AS lng,
          ST_Y(geom::geometry)               AS lat
        FROM vut_licences
        WHERE status = 'active'
          AND geom IS NOT NULL
          AND geom::geometry && ${envelope}
        LIMIT 1000`;
      break;

    default:
      return NextResponse.json({ error: 'unknown_type' }, { status: 400 });
  }

  const geojson = {
    type: 'FeatureCollection' as const,
    features: rows.map(r => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [r.lng as number, r.lat as number],
      },
      properties: Object.fromEntries(
        Object.entries(r).filter(([k]) => k !== 'lng' && k !== 'lat')
      ),
    })),
  };

  return NextResponse.json(geojson, {
    headers: { 'Cache-Control': 'public, max-age=300' }, // 5 min — layers change slowly
  });
}
