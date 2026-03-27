/**
 * CHI-327 validation test
 *
 * 1. Loads .env.local
 * 2. Deletes the stale cache row for the test URL
 * 3. Calls POST /api/analyse (requires `next dev` running on :3000)
 * 4. Prints tvi_score and all indicator scores
 *
 * Usage:
 *   node scripts/chi327-test.mjs
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import postgres from 'postgres'

// --- Load .env.local ---
const envPath = resolve(process.cwd(), '.env.local')
try {
  const lines = readFileSync(envPath, 'utf8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    process.env[key] ??= val
  }
} catch {
  console.error('⚠️  Could not read .env.local — ensure DATABASE_URL_POOLER is set in env')
}

const TEST_URL = 'https://www.idealista.com/inmueble/12345/'
const TEST_PROPERTY = {
  lat: 36.7213,
  lng: -4.4214,
  price_asking: 350000,
  area_sqm: 90,
  comunidad_autonoma: 'Andalucía',
  municipio: 'Málaga',
  build_year: 1995,
  epc_rating: 'D',
}

// --- Connect to DB ---
const dbUrl = process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL
if (!dbUrl) {
  console.error('❌ No DATABASE_URL_POOLER or DATABASE_URL found')
  process.exit(1)
}

const isPooler = dbUrl.includes('pooler.supabase.com')
const sql = postgres(dbUrl, {
  ssl: 'require',
  max: 1,
  idle_timeout: 5,
  connect_timeout: 10,
  prepare: !isPooler,
})

// --- 1. Clear stale cache ---
console.log(`🗑  Deleting cached row for: ${TEST_URL}`)
const deleted = await sql`
  DELETE FROM analysis_cache WHERE source_url = ${TEST_URL} RETURNING id
`
if (deleted.length > 0) {
  console.log(`   Deleted ${deleted.length} row(s) — id: ${deleted[0].id}`)
} else {
  console.log('   No cached row found (already clean)')
}

await sql.end()

// --- 2. Hit the API ---
// BASE_URL env var allows testing against a Vercel preview deployment.
// Defaults to localhost:3000 for local `next dev` usage.
const baseUrl = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '')
console.log(`\n🚀 Calling POST ${baseUrl}/api/analyse (fresh run)...`)
const start = Date.now()

let res
try {
  res = await fetch(`${baseUrl}/api/analyse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: TEST_URL, property: TEST_PROPERTY }),
  })
} catch (err) {
  console.error(`\n❌ Fetch failed — is the server running at ${baseUrl}?`)
  console.error(err.message)
  process.exit(1)
}

const elapsed = Date.now() - start
const data = await res.json()

console.log(`\n📊 Status: ${res.status} — ${elapsed}ms`)

if (!res.ok) {
  console.error('❌ API error:', JSON.stringify(data, null, 2))
  process.exit(1)
}

// --- 3. Print results ---
const tvi = data.tvi_score
const tviOk = tvi !== null && !Number.isNaN(tvi)
console.log(`\n${tviOk ? '✅' : '❌'} tvi_score: ${tvi}`)
console.log(`   cached:    ${data.cached}`)
console.log(`   id:        ${data.id}`)

console.log('\n📋 Indicator scores:')
for (const [key, ind] of Object.entries(data.composite_indicators ?? {})) {
  const score = ind.score
  const ok = score === null || (!Number.isNaN(score))
  console.log(`   ${ok ? '✓' : '⚠'} ${key.padEnd(28)} score=${score ?? 'null'} (${ind.confidence})`)
}

if (data.alerts?.length) {
  console.log(`\n⚠️  Alerts (${data.alerts.length}):`)
  for (const a of data.alerts) {
    console.log(`   [${a.type}] ${a.title}`)
  }
}

console.log(tviOk
  ? '\n✅ CHI-327 PASS — fresh 200, non-NaN tvi_score'
  : '\n❌ CHI-327 FAIL — tvi_score is still null or NaN')
