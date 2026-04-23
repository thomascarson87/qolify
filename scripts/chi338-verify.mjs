// CHI-338: Verify property_price_history writes are landing and backfill
// any analysis_cache rows that never got a matching history row.
import postgres from 'postgres'
const sql = postgres(process.env.DATABASE_URL_POOLER, { prepare: false, max: 1, idle_timeout: 5 })
try {
  const [{ total }] = await sql`SELECT COUNT(*)::int AS total FROM property_price_history`
  const latest = await sql`
    SELECT cache_id, source_url, codigo_postal, price, price_per_sqm, observed_at, source
    FROM property_price_history
    ORDER BY observed_at DESC
    LIMIT 5
  `
  console.log(`property_price_history: ${total} rows`)
  console.log('\nLatest 5:')
  for (const r of latest) {
    console.log(`  ${r.observed_at.toISOString?.() ?? r.observed_at}  CP=${r.codigo_postal}  €${r.price}  (€${r.price_per_sqm}/m²)  src=${r.source}`)
  }

  // Cache rows with no price history (candidates for backfill)
  const orphaned = await sql`
    SELECT ac.id, ac.source_url, ac.price_asking, ac.price_per_sqm,
           ac.codigo_postal, ac.extracted_at, ac.price_logged
    FROM analysis_cache ac
    LEFT JOIN property_price_history ph ON ph.cache_id = ac.id
    WHERE ph.id IS NULL
      AND ac.price_asking IS NOT NULL
      AND ac.price_asking > 0
    ORDER BY ac.extracted_at DESC
  `
  console.log(`\nOrphaned cache rows (cache but no history): ${orphaned.length}`)
  if (orphaned.length > 0) {
    console.log('Sample 3:', orphaned.slice(0, 3).map(r => ({
      cache_id: r.id, price: r.price_asking, cp: r.codigo_postal
    })))
  }
} finally {
  await sql.end()
}
