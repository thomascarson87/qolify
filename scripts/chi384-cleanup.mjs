// CHI-384: Null out historical sunshine_hours_* rows that were written as 0
// by precipitation-only AEMET stations (before this fix). Zero is factually
// wrong (no location in Spain has zero annual sunshine) and pollutes
// solar-potential scoring. NULL is the correct "missing" signal.
import postgres from 'postgres'
const sql = postgres(process.env.DATABASE_URL_POOLER, { prepare: false, max: 1, idle_timeout: 5 })
try {
  const [before] = await sql`
    SELECT COUNT(*)::int AS zero_sun,
           COUNT(*) FILTER (WHERE sunshine_hours_annual IS NULL)::int AS null_sun
    FROM climate_data
    WHERE sunshine_hours_annual = 0
  `
  console.log('Before:', before)

  const updated = await sql`
    UPDATE climate_data
    SET sunshine_hours_annual = NULL,
        sunshine_hours_jan = NULL, sunshine_hours_feb = NULL, sunshine_hours_mar = NULL,
        sunshine_hours_apr = NULL, sunshine_hours_may = NULL, sunshine_hours_jun = NULL,
        sunshine_hours_jul = NULL, sunshine_hours_aug = NULL, sunshine_hours_sep = NULL,
        sunshine_hours_oct = NULL, sunshine_hours_nov = NULL, sunshine_hours_dec = NULL
    WHERE sunshine_hours_annual = 0
    RETURNING municipio_code
  `
  console.log(`Nulled sunshine_* on ${updated.length} rows.`)
} finally {
  await sql.end()
}
