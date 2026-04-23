// CHI-410: Delete postal_zones rows whose geom/centroid is outside Spain bbox.
// Safe to run before re-ingest — upsert re-creates the good rows; the bad
// rows are foreign (German 29xxx) and have no legitimate postcode match.
import postgres from 'postgres'
const sql = postgres(process.env.DATABASE_URL_POOLER, { prepare: false, max: 1, idle_timeout: 5 })
try {
  const [before] = await sql`SELECT COUNT(*)::int AS n FROM postal_zones`
  const deleted = await sql`
    DELETE FROM postal_zones
    WHERE ST_Y(centroid::geometry) NOT BETWEEN 27 AND 44
       OR ST_X(centroid::geometry) NOT BETWEEN -19 AND 5
    RETURNING codigo_postal
  `
  const [after]  = await sql`SELECT COUNT(*)::int AS n FROM postal_zones`
  console.log(`Deleted ${deleted.length} out-of-Spain rows.  before=${before.n}  after=${after.n}`)
} finally {
  await sql.end()
}
