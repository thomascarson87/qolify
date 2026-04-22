// CHI-383: Verify postal-zone lookup resolves for boundary-adjacent points.
// Runs both the legacy ST_Within query and the fixed ST_Contains + ST_DWithin(50m)
// query against the live postal_zones table; asserts the fixed version resolves
// every known test point while the legacy may miss some.
import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL_POOLER, { prepare: false, max: 1, idle_timeout: 5 })

// Test points: mix of clearly-interior and boundary-sensitive locations in Málaga/Costa del Sol.
const POINTS = [
  { label: 'Málaga centre (Calle Larios)', lng: -4.4212, lat: 36.7213 },
  { label: 'Avenida Doctor Marañón',       lng: -4.4288, lat: 36.7278 },
  { label: 'Poeta Agustín Ruano 1',        lng: -4.441,  lat: 36.722  },
  { label: 'Malagueta beach edge',         lng: -4.4109, lat: 36.7199 },
]

async function lookupLegacy(lng, lat) {
  const [row] = await sql`
    SELECT codigo_postal FROM postal_zones
    WHERE ST_Within(ST_SetSRID(ST_MakePoint(${lng}::float, ${lat}::float), 4326), geom)
    LIMIT 1
  `
  return row?.codigo_postal ?? null
}
async function lookupFixed(lng, lat) {
  const [row] = await sql`
    SELECT codigo_postal FROM postal_zones
    WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint(${lng}::float, ${lat}::float), 4326))
       OR ST_DWithin(geom::geography, ST_MakePoint(${lng}::float, ${lat}::float)::geography, 50)
    ORDER BY ST_Distance(geom::geography, ST_MakePoint(${lng}::float, ${lat}::float)::geography)
    LIMIT 1
  `
  return row?.codigo_postal ?? null
}

try {
  let fixedMisses = 0
  for (const p of POINTS) {
    const legacy = await lookupLegacy(p.lng, p.lat)
    const fixed  = await lookupFixed(p.lng, p.lat)
    const tag    = fixed ? '✅' : '❌'
    console.log(`${tag} ${p.label.padEnd(32)} legacy=${legacy ?? 'NULL'}  fixed=${fixed ?? 'NULL'}`)
    if (!fixed) fixedMisses++
  }
  if (fixedMisses === 0) console.log('\nAll test points resolve with the fixed query.')
  else { console.log(`\n${fixedMisses} point(s) still miss.`); process.exitCode = 1 }
} finally {
  await sql.end()
}
