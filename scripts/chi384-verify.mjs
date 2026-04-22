// CHI-384: Verify sunshine_hours_annual is either > 0 or NULL (never 0).
import postgres from 'postgres'
const sql = postgres(process.env.DATABASE_URL_POOLER, { prepare: false, max: 1, idle_timeout: 5 })
try {
  const [summary] = await sql`
    SELECT COUNT(*)::int                                              AS total,
           COUNT(*) FILTER (WHERE sunshine_hours_annual = 0)::int     AS zero_sun,
           COUNT(*) FILTER (WHERE sunshine_hours_annual IS NULL)::int AS null_sun,
           COUNT(*) FILTER (WHERE sunshine_hours_annual > 0)::int     AS has_sun
    FROM climate_data
  `
  console.log('climate_data state:', summary)

  const malaga = await sql`
    SELECT municipio_code, municipio_name, aemet_station_id,
           sunshine_hours_annual, temp_mean_annual_c
    FROM climate_data
    WHERE municipio_code = '29067'
  `
  console.log('\nMálaga (29067):', malaga[0] ?? '(missing)')

  if (summary.zero_sun !== 0) {
    console.error(`\n✗ FAIL: ${summary.zero_sun} rows still have sunshine_hours_annual = 0`)
    process.exitCode = 1
  } else {
    console.log('\n✓ PASS: no rows have sunshine_hours_annual = 0')
  }
} finally {
  await sql.end()
}
