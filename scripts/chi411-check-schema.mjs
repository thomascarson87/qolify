// Verify building_orientation columns in the live DB — does geom exist?
import postgres from 'postgres'
const sql = postgres(process.env.DATABASE_URL_POOLER, { prepare: false, max: 1, idle_timeout: 5 })
try {
  const cols = await sql`
    SELECT column_name, data_type
      FROM information_schema.columns
     WHERE table_name = 'building_orientation'
     ORDER BY ordinal_position
  `
  console.log('building_orientation columns:')
  for (const c of cols) console.log(`  ${c.column_name.padEnd(25)} ${c.data_type}`)

  const [count] = await sql`SELECT COUNT(*) AS n FROM building_orientation`
  console.log(`\nbuilding_orientation row count: ${count.n}`)

  // Also check if analyse-job's solar query would error
  try {
    await sql`SELECT geom FROM building_orientation LIMIT 0`
    console.log('geom column exists ✅')
  } catch (e) {
    console.log(`geom column missing — edge function solar query would error: ${e.message}`)
  }
} finally {
  await sql.end()
}
