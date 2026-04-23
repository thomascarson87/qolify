// CHI-410: Diagnose postal_zones centroid corruption.
import postgres from 'postgres'
const sql = postgres(process.env.DATABASE_URL_POOLER, { prepare: false, max: 1, idle_timeout: 5 })
try {
  const [{ total }]  = await sql`SELECT COUNT(*)::int AS total FROM postal_zones`
  const [{ bad }]    = await sql`
    SELECT COUNT(*)::int AS bad FROM postal_zones
    WHERE ST_Y(centroid::geometry) NOT BETWEEN 27 AND 44
       OR ST_X(centroid::geometry) NOT BETWEEN -19 AND 5
  `
  const [{ nogeom }] = await sql`SELECT COUNT(*)::int AS nogeom FROM postal_zones WHERE geom IS NULL`
  console.log(`total=${total}  bad_centroid=${bad}  null_geom=${nogeom}`)

  const samples = await sql`
    SELECT codigo_postal, ST_X(centroid::geometry) AS lng, ST_Y(centroid::geometry) AS lat,
           ST_X(ST_PointOnSurface(geom)) AS fixed_lng, ST_Y(ST_PointOnSurface(geom)) AS fixed_lat
    FROM postal_zones
    WHERE ST_Y(centroid::geometry) NOT BETWEEN 27 AND 44
       OR ST_X(centroid::geometry) NOT BETWEEN -19 AND 5
    LIMIT 5
  `
  console.log('\nBad samples (current → fixed via ST_PointOnSurface):')
  for (const s of samples) {
    console.log(`  ${s.codigo_postal}: current=(${s.lng?.toFixed(3)}, ${s.lat?.toFixed(3)}) → fixed=(${s.fixed_lng?.toFixed(3)}, ${s.fixed_lat?.toFixed(3)})`)
  }
} finally {
  await sql.end()
}
