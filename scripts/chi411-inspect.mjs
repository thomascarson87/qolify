// Inspect the state of job 81bb1de7-2a68-4a72-8bed-9723d753f92a to diagnose
// why Catastro + solar enrichment didn't persist.
import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL_POOLER, { prepare: false, max: 1, idle_timeout: 5 })
const JOB_ID = '81bb1de7-2a68-4a72-8bed-9723d753f92a'

try {
  const [job] = await sql`
    SELECT id, source_url, status, step, error_message, cache_id,
           property_input, started_at, completed_at, retry_count, tier
      FROM analysis_jobs WHERE id = ${JOB_ID}
  `
  console.log('── job row ──')
  console.log(JSON.stringify(job, null, 2))

  if (job?.cache_id) {
    const [cache] = await sql`
      SELECT id, source_url, extracted_at, expires_at, extraction_version,
             ref_catastral, build_year, epc_rating, epc_potential,
             lat, lng, municipio, provincia, codigo_postal,
             price_asking, price_per_sqm, area_sqm,
             (solar_potential_result IS NOT NULL) AS has_solar,
             solar_potential_result
        FROM analysis_cache WHERE id = ${job.cache_id}
    `
    console.log('\n── cache row ──')
    console.log(JSON.stringify(cache, null, 2))
  } else {
    console.log('\nNo cache_id linked — job likely failed before step 4.')
  }
} finally {
  await sql.end()
}
