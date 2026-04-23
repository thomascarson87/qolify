// Verify Expat Liveability score is non-null on recent jobs (CHI-336).
import postgres from 'postgres'
const sql = postgres(process.env.DATABASE_URL_POOLER, { prepare: false, max: 1, idle_timeout: 5 })
try {
  const rows = await sql`
    SELECT property_id, expat_liveability_score, calculated_at
      FROM composite_indicators
     ORDER BY calculated_at DESC
     LIMIT 5
  `
  console.log('Recent expat_liveability_score values:')
  for (const r of rows) console.log(`  ${r.calculated_at?.toISOString?.() ?? r.calculated_at}  score=${r.expat_liveability_score}`)
} finally {
  await sql.end()
}
