// Re-invoke the analyse-job edge function for the affected job and verify the
// enrichment columns populate. Writes a full before/after snapshot.
import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL_POOLER, { prepare: false, max: 1, idle_timeout: 5 })
const JOB_ID = '81bb1de7-2a68-4a72-8bed-9723d753f92a'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY

async function snapshot(label) {
  const [job] = await sql`SELECT status, step, cache_id, error_message FROM analysis_jobs WHERE id = ${JOB_ID}`
  const [cache] = job?.cache_id
    ? await sql`SELECT ref_catastral, build_year, epc_rating, codigo_postal,
                       (solar_potential_result IS NOT NULL) AS has_solar,
                       extracted_at
                  FROM analysis_cache WHERE id = ${job.cache_id}`
    : [null]
  console.log(`── ${label} ──`)
  console.log('job:  ', JSON.stringify(job))
  console.log('cache:', JSON.stringify(cache))
}

try {
  await snapshot('BEFORE')

  // Reset so the edge function re-enters the pipeline (status guard on its side)
  await sql`
    UPDATE analysis_jobs
       SET status = 'pending', step = 0, error_message = NULL,
           started_at = NULL, completed_at = NULL
     WHERE id = ${JOB_ID}
  `

  console.log('\nInvoking edge function…')
  const res = await fetch(`${SUPABASE_URL}/functions/v1/analyse-job`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_ROLE}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jobId: JOB_ID }),
  })
  console.log(`edge fn response: ${res.status}`)
  const txt = await res.text().catch(() => '')
  if (txt) console.log(`body: ${txt.slice(0, 500)}`)

  // Poll for completion
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const [j] = await sql`SELECT status, step FROM analysis_jobs WHERE id = ${JOB_ID}`
    process.stdout.write(`\r  poll ${i}: status=${j.status} step=${j.step}   `)
    if (j.status === 'complete' || j.status === 'error') break
  }
  console.log()

  await snapshot('AFTER')
} finally {
  await sql.end()
}
