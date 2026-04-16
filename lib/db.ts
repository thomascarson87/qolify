/**
 * Direct PostgreSQL connection for PostGIS spatial queries.
 * Uses the `postgres` package (sql template tag — safe from injection).
 *
 * This client is server-only. Never import from client components.
 *
 * Connection priority:
 *   - On Vercel: DATABASE_URL (direct connection, port 5432) — DNS resolves in Vercel infra
 *   - Locally:   DATABASE_URL_POOLER (transaction pooler, port 6543) — direct host DNS
 *                doesn't resolve from local dev; pooler works from everywhere
 *
 * Why: db.btnnaoitbrgyjjzpwoze.supabase.co is a DNS-restricted direct host that
 * only resolves inside Vercel's eu-west-1 region. Locally the connection times out
 * causing the first SQL query to throw an unhandled error and return a 500.
 */
import postgres from 'postgres'

const isVercel = Boolean(process.env.VERCEL)

const url = isVercel
  ? (process.env.DATABASE_URL || process.env.DATABASE_URL_POOLER)
  : (process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL)

if (!url) {
  throw new Error('DATABASE_URL or DATABASE_URL_POOLER must be set')
}

// For Next.js serverless: keep connection count low.
// ssl: 'require' works with Supabase direct + pooler connections.
const isPooler = url.includes('pooler.supabase.com')

const sql = postgres(url, {
  ssl: 'require',
  max: 6,
  idle_timeout: 5,      // close idle connections quickly — prevents stale pooler connections
  connect_timeout: 10,
  // Supabase Supavisor (pooler) doesn't support prepared statements
  prepare: !isPooler,
  // statement_timeout is a session-level Postgres parameter (not a postgres.js constructor option)
  connection: {
    statement_timeout: 30000,  // 30s cap per query — prevents infinite hang on cold DB wake-up
  },
})

export default sql
