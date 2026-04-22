// CHI-384: KNN backfill for municipios whose nearest AEMET station is precip-only.
//
// After the code fix, 247/339 climate_data rows have sunshine_hours_annual = NULL
// (their assigned station lacks inso_md). For each such row, copy the sunshine
// fields from the geographically nearest climate_data row that DOES have data.
//
// We keep aemet_station_id pointing at the original (precip-only) station so
// the row still records the temp/rain/humidity source; we add a flag by writing
// era5_gap_fill = true to mark "sunshine borrowed from nearby station".
import postgres from 'postgres'
const sql = postgres(process.env.DATABASE_URL_POOLER, { prepare: false, max: 1, idle_timeout: 5 })
try {
  const [before] = await sql`
    SELECT COUNT(*) FILTER (WHERE sunshine_hours_annual IS NULL)::int AS null_sun,
           COUNT(*) FILTER (WHERE sunshine_hours_annual > 0)::int     AS has_sun
    FROM climate_data
  `
  console.log('Before:', before)

  // For every NULL-sunshine row, find nearest municipio that has sunshine data.
  // CROSS JOIN LATERAL with ORDER BY distance LIMIT 1 → true KNN.
  const updated = await sql`
    WITH backfill AS (
      SELECT
        cd_null.municipio_code,
        nearest.municipio_code AS source_code,
        nearest.sunshine_hours_annual,
        nearest.sunshine_hours_jan, nearest.sunshine_hours_feb, nearest.sunshine_hours_mar,
        nearest.sunshine_hours_apr, nearest.sunshine_hours_may, nearest.sunshine_hours_jun,
        nearest.sunshine_hours_jul, nearest.sunshine_hours_aug, nearest.sunshine_hours_sep,
        nearest.sunshine_hours_oct, nearest.sunshine_hours_nov, nearest.sunshine_hours_dec,
        nearest.dist_km
      FROM climate_data cd_null
      JOIN municipios m_null ON m_null.municipio_code = cd_null.municipio_code
      CROSS JOIN LATERAL (
        SELECT cd_src.municipio_code,
               cd_src.sunshine_hours_annual,
               cd_src.sunshine_hours_jan, cd_src.sunshine_hours_feb, cd_src.sunshine_hours_mar,
               cd_src.sunshine_hours_apr, cd_src.sunshine_hours_may, cd_src.sunshine_hours_jun,
               cd_src.sunshine_hours_jul, cd_src.sunshine_hours_aug, cd_src.sunshine_hours_sep,
               cd_src.sunshine_hours_oct, cd_src.sunshine_hours_nov, cd_src.sunshine_hours_dec,
               ST_Distance(m_null.geom::geography, m_src.geom::geography) / 1000 AS dist_km
        FROM climate_data cd_src
        JOIN municipios m_src ON m_src.municipio_code = cd_src.municipio_code
        WHERE cd_src.sunshine_hours_annual > 0
          AND cd_src.municipio_code <> cd_null.municipio_code
        ORDER BY m_null.geom <-> m_src.geom
        LIMIT 1
      ) nearest
      WHERE cd_null.sunshine_hours_annual IS NULL
    )
    UPDATE climate_data cd
    SET sunshine_hours_annual = b.sunshine_hours_annual,
        sunshine_hours_jan = b.sunshine_hours_jan, sunshine_hours_feb = b.sunshine_hours_feb,
        sunshine_hours_mar = b.sunshine_hours_mar, sunshine_hours_apr = b.sunshine_hours_apr,
        sunshine_hours_may = b.sunshine_hours_may, sunshine_hours_jun = b.sunshine_hours_jun,
        sunshine_hours_jul = b.sunshine_hours_jul, sunshine_hours_aug = b.sunshine_hours_aug,
        sunshine_hours_sep = b.sunshine_hours_sep, sunshine_hours_oct = b.sunshine_hours_oct,
        sunshine_hours_nov = b.sunshine_hours_nov, sunshine_hours_dec = b.sunshine_hours_dec,
        era5_gap_fill = TRUE
    FROM backfill b
    WHERE cd.municipio_code = b.municipio_code
    RETURNING cd.municipio_code, b.source_code, b.dist_km::numeric(10,2) AS dist_km
  `
  console.log(`Backfilled ${updated.length} rows.`)
  console.log('Sample:', updated.slice(0, 5))

  const [after] = await sql`
    SELECT COUNT(*) FILTER (WHERE sunshine_hours_annual IS NULL)::int AS null_sun,
           COUNT(*) FILTER (WHERE sunshine_hours_annual > 0)::int     AS has_sun,
           COUNT(*) FILTER (WHERE era5_gap_fill = TRUE)::int          AS gap_filled
    FROM climate_data
  `
  console.log('After: ', after)

  const [malaga] = await sql`
    SELECT municipio_code, municipio_name, aemet_station_id, sunshine_hours_annual, era5_gap_fill
    FROM climate_data WHERE municipio_code = '29067'
  `
  console.log('Málaga (29067):', malaga)
} finally {
  await sql.end()
}
