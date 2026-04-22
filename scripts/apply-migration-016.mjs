// Apply migration 016 (CHI-410: centroid = ST_PointOnSurface).
import postgres from 'postgres'
import { readFileSync } from 'node:fs'

const sql = postgres(process.env.DATABASE_URL_POOLER, { prepare: false, max: 1, idle_timeout: 5 })
const migration = readFileSync(new URL('../supabase/migrations/016_postal_zones_centroid_point_on_surface.sql', import.meta.url), 'utf8')

try {
  const [before] = await sql`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE ST_Y(centroid::geometry) BETWEEN 27 AND 44
                              AND ST_X(centroid::geometry) BETWEEN -19 AND 5)::int AS in_spain
    FROM postal_zones
  `
  console.log('Before:', before)

  await sql.unsafe(migration)

  const [after] = await sql`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE ST_Y(centroid::geometry) BETWEEN 27 AND 44
                              AND ST_X(centroid::geometry) BETWEEN -19 AND 5)::int AS in_spain
    FROM postal_zones
  `
  console.log('After: ', after)
  console.log('\n✅ Migration 016 applied. (geom polygons still need re-ingest to fix remaining bad rows.)')
} finally {
  await sql.end()
}
