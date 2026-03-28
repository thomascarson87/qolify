/**
 * Direct PostgreSQL connection for PostGIS spatial queries.
 * Uses the `postgres` package (sql template tag — safe from injection).
 *
 * This client is server-only. Never import from client components.
 *
 * Connection priority:
 *   1. DATABASE_URL (direct connection, port 5432) — preferred in production (Vercel)
 *   2. DATABASE_URL_POOLER (transaction pooler, port 6543) — used locally where direct DNS doesn't resolve
 */
import postgres from 'postgres'

const url = process.env.DATABASE_URL || process.env.DATABASE_URL_POOLER

if (!url) {
  throw new Error('DATABASE_URL or DATABASE_URL_POOLER must be set')
}

// For Next.js serverless: keep connection count low.
// ssl: 'require' works with Supabase direct + pooler connections.
const isPooler = url.includes('pooler.supabase.com')

const sql = postgres(url, {
  ssl: 'require',
  max: 3,
  idle_timeout: 5,      // close idle connections quickly — prevents stale pooler connections
  connect_timeout: 10,
  // Supabase Supavisor (pooler) doesn't support prepared statements
  prepare: !isPooler,
})

export default sql
