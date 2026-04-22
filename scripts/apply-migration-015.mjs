// Apply migration 015 (CHI-347: durable analysis reports).
// Run with:  set -a && . ./.env.local && set +a && node scripts/apply-migration-015.mjs
import postgres from 'postgres'
import { readFileSync } from 'node:fs'

const url = process.env.DATABASE_URL_POOLER
if (!url) {
  console.error('DATABASE_URL_POOLER missing — did you `set -a && . ./.env.local && set +a` first?')
  process.exit(1)
}

const sql = postgres(url, { prepare: false, max: 1, idle_timeout: 5 })
const migration = readFileSync(new URL('../supabase/migrations/015_analysis_cache_durable.sql', import.meta.url), 'utf8')

try {
  // Audit before
  const [before] = await sql`
    SELECT
      COUNT(*)                                      AS total,
      COUNT(*) FILTER (WHERE expires_at IS NULL)    AS already_durable,
      COUNT(*) FILTER (WHERE expires_at IS NOT NULL) AS will_be_backfilled
    FROM analysis_cache
  `
  console.log('Before:', before)

  // Apply
  await sql.unsafe(migration)

  // Audit after
  const [after] = await sql`
    SELECT
      COUNT(*)                                      AS total,
      COUNT(*) FILTER (WHERE expires_at IS NULL)    AS durable,
      COUNT(*) FILTER (WHERE expires_at IS NOT NULL) AS still_has_expiry
    FROM analysis_cache
  `
  console.log('After: ', after)

  // Verify default was dropped
  const [def] = await sql`
    SELECT column_default
      FROM information_schema.columns
     WHERE table_name = 'analysis_cache' AND column_name = 'expires_at'
  `
  console.log('expires_at default is now:', def?.column_default ?? 'NULL (good)')

  console.log('\n✅ Migration 015 applied.')
} catch (err) {
  console.error('❌ Migration failed:', err)
  process.exitCode = 1
} finally {
  await sql.end()
}
