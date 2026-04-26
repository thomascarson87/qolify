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
import postgres, { type Sql } from 'postgres'

// Lazy proxy: build-time page-data collection on Vercel evaluates this module
// without runtime env vars, so we must NOT throw or open a connection at
// import time. The real client is constructed on first query.
let _sql: Sql | null = null

function getSql(): Sql {
  if (_sql) return _sql

  const url = process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL or DATABASE_URL_POOLER must be set')
  }

  const isPooler = url.includes('pooler.supabase.com')

  _sql = postgres(url, {
    ssl: 'require',
    max: 6,
    idle_timeout: 5,
    connect_timeout: 10,
    // Supabase Supavisor (pooler) doesn't support prepared statements
    prepare: !isPooler,
    connection: {
      statement_timeout: 30000,  // 30s cap per query
    },
  })
  return _sql
}

// Proxy forwards every call/property access to the lazily-created client so
// existing `sql\`...\`` and `sql.unsafe(...)` call sites keep working.
const sql = new Proxy(function () {} as unknown as Sql, {
  apply(_t, _thisArg, args: unknown[]) {
    const client = getSql() as unknown as (...a: unknown[]) => unknown
    return client(...args)
  },
  get(_t, prop) {
    const client = getSql() as unknown as Record<string | symbol, unknown>
    const value = client[prop]
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(client) : value
  },
}) as Sql

export default sql
