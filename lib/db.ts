/**
 * PostgreSQL connection for PostGIS spatial queries.
 * Uses the `postgres` package (sql template tag — safe from injection).
 *
 * This client is server-only. Never import from client components.
 *
 * Always prefer DATABASE_URL_POOLER (Supabase transaction-mode pooler, :6543).
 * The session-mode pooler / direct connection (:5432) has a hard client cap
 * and throws `MaxClientsInSessionMode` under serverless concurrency.
 * Transaction mode multiplexes a pool of real connections across many
 * clients, which is what Vercel Fluid Compute needs.
 */
import postgres from 'postgres'

const url = process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL

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
