/**
 * lib/indicators/climate-solar.ts
 *
 * Composite Climate & Solar indicator (Indicator 8 per INDICATORS.md).
 *
 * Six sub-components combined into a single 0–100 quality-of-life score:
 *   8a — Annual sunshine hours                   weight 0.20
 *   8b — Heating Degree Days (HDD)               weight 0.15
 *   8c — Cooling Degree Days (CDD)               weight 0.10
 *   8d — Building solar orientation (aspect)      weight 0.15
 *   8e — Damp Risk Index                          weight 0.15
 *   8f — Extreme heat days                        weight 0.10
 *   8g — Winter sunshine (deep winter quality)    weight 0.15
 *
 * Data sources:
 *   - climate_data table  — AEMET 30-year normals (1991–2020), municipio-level
 *   - solar_radiation     — PVGIS JRC grid, nearest-neighbour KNN via PostGIS
 *   - building_orientation — from Catastro lookup (optional; falls back to null)
 *
 * A high composite score (closer to 100) means excellent climate for year-round
 * living: abundant sunshine, mild winters, manageable summers, dry conditions,
 * and good solar exposure.
 */

import type { Sql }           from 'postgres'
import type { PropertyInput, IndicatorResult } from './types'
import { normalise }          from './utils'

// ---------------------------------------------------------------------------
// Orientation scores (0–100 quality — S = best for solar + drying, N = worst)
// ---------------------------------------------------------------------------

const ORIENTATION_SOLAR_SCORE: Record<string, number> = {
  S:  100,
  SE: 88,
  SW: 85,
  E:  65,
  W:  60,
  NE: 35,
  NW: 30,
  N:  10,
}

// Damp risk by orientation — inverted: N = highest risk, S = lowest
const ORIENTATION_DAMP_RISK: Record<string, number> = {
  S:  0,
  SE: 15,
  SW: 20,
  E:  40,
  W:  45,
  NE: 70,
  NW: 75,
  N:  100,
}

// EPC damp risk — poor insulation allows moisture ingress
const EPC_DAMP_RISK: Record<string, number> = {
  A: 0,
  B: 10,
  C: 25,
  D: 45,
  E: 65,
  F: 80,
  G: 100,
}

// ---------------------------------------------------------------------------
// Damp Risk sub-indicator (0–100; 100 = maximum damp risk)
// ---------------------------------------------------------------------------

interface ClimateRow {
  rainfall_annual_mm: number | null
  humidity_annual_pct: number | null
  humidity_winter_pct: number | null
}

function calcDampRisk(
  climate: ClimateRow,
  aspect:     string | null | undefined,
  buildYear:  number | null | undefined,
  epcRating:  string | null | undefined,
  floor:      number | null | undefined,
): number {
  const currentYear = new Date().getFullYear()

  // Each component 0–100 (100 = highest damp contribution)

  // Rainfall: 200mm (SE Spain dry) → 2,000mm (Galicia Atlantic) = full range
  const rainfallComponent = normalise(climate.rainfall_annual_mm ?? 600, 200, 2000)

  // Humidity: use winter humidity (Oct–Mar) if available, else annual
  const humidity = climate.humidity_winter_pct ?? climate.humidity_annual_pct ?? 65
  const humidityComponent = normalise(humidity, 40, 90)

  // Orientation: north-facing = most damp risk (no sun for drying)
  const orientationComponent = aspect
    ? (ORIENTATION_DAMP_RISK[aspect.toUpperCase()] ?? 50)
    : 50   // unknown → neutral

  // Age: older buildings have more moisture ingress risk
  const buildAge = buildYear ? currentYear - buildYear : 40   // assume 40yr if unknown
  const ageComponent = normalise(buildAge, 0, 100)

  // EPC: poor insulation = higher damp risk
  const epcComponent = epcRating
    ? (EPC_DAMP_RISK[epcRating.toUpperCase()] ?? 50)
    : 50   // unknown → neutral

  // Floor: ground/basement most exposed, upper floors least
  let floorComponent: number
  if (floor == null)  floorComponent = 40  // unknown → moderate
  else if (floor <= 0) floorComponent = 90  // basement / ground
  else if (floor === 1) floorComponent = 55
  else if (floor === 2) floorComponent = 35
  else                  floorComponent = 15  // 3rd floor and above

  return Math.round(
    rainfallComponent  * 0.25 +
    humidityComponent  * 0.20 +
    orientationComponent * 0.25 +
    ageComponent       * 0.15 +
    epcComponent       * 0.10 +
    floorComponent     * 0.05,
  )
}

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface ClimateDataRow {
  sunshine_hours_annual:    number | null
  sunshine_hours_jan:       number | null
  sunshine_hours_feb:       number | null
  sunshine_hours_dec:       number | null
  hdd_annual:               number | null
  cdd_annual:               number | null
  rainfall_annual_mm:       number | null
  humidity_annual_pct:      number | null
  humidity_winter_pct:      number | null
  days_above_35c_annual:    number | null
  era5_gap_fill:            boolean | null
}

interface SolarRadiationRow {
  ghi_annual_kwh_m2:  number | null
}

interface OrientationRow {
  aspect: string | null
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

export async function calcClimateSolar(
  sql: Sql,
  property: PropertyInput,
): Promise<IndicatorResult> {

  const { lat, lng, ref_catastral, build_year, epc_rating, floor } = property

  // ── 1. Climate data — joined spatially via municipios table ───────────────
  // We join climate_data → municipios on municipio_code then KNN sort by the
  // municipio centroid so we pick the correct administratve unit for the coords.
  const [climateRow] = await sql<ClimateDataRow[]>`
    SELECT
      cd.sunshine_hours_annual,
      cd.sunshine_hours_jan,
      cd.sunshine_hours_feb,
      cd.sunshine_hours_dec,
      cd.hdd_annual,
      cd.cdd_annual,
      cd.rainfall_annual_mm,
      cd.humidity_annual_pct,
      cd.humidity_winter_pct,
      cd.days_above_35c_annual,
      cd.era5_gap_fill
    FROM climate_data cd
    JOIN municipios m ON m.municipio_code = cd.municipio_code
    ORDER BY m.geom <-> ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
    LIMIT 1
  `

  // If no climate data found, return insufficient_data rather than crash
  if (!climateRow) {
    return {
      score:      null,
      confidence: 'insufficient_data',
      details: {
        sunshine_hours_annual: null,
        hdd_annual:            null,
        cdd_annual:            null,
        building_aspect:       null,
        damp_risk_index:       null,
        days_above_35c_annual: null,
        ghi_annual_kwh_m2:     null,
        municipio_climate_source: null,
      },
      alerts: [],
    }
  }

  // ── 2. Solar irradiance — nearest PVGIS grid point (KNN) ─────────────────
  const [solarRow] = await sql<SolarRadiationRow[]>`
    SELECT ghi_annual_kwh_m2
    FROM solar_radiation
    ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
    LIMIT 1
  `

  // ── 3. Building orientation — from Catastro lookup (optional) ─────────────
  let aspect: string | null = null
  if (ref_catastral) {
    const [orientRow] = await sql<OrientationRow[]>`
      SELECT aspect
      FROM building_orientation
      WHERE ref_catastral = ${ref_catastral}
      LIMIT 1
    `
    aspect = orientRow?.aspect ?? null
  }

  // ── 4. Sub-component scores (each 0–100; 100 = best for QoL) ──────────────

  // 8a — Solar resource (PVGIS GHI): primary signal for annual sunshine quality.
  //
  // Why PVGIS instead of AEMET sunshine_hours_annual:
  //   Many AEMET stations are precipitation-only and record 0h sunshine — giving
  //   artificially low scores for genuinely sunny municipalities like Málaga.
  //   PVGIS GHI (Global Horizontal Irradiance) is EU Commission satellite data on a
  //   0.1° grid (~8 km), always populated, location-precise, and the correct signal
  //   for "how much solar energy does this location receive".
  //
  //   Range: 1,300 kWh/m²/yr (Galicia coast, Atlantic rainy) → 2,100 (Almería, SE)
  //   Málaga: ~1,870 kWh/m²/yr → score ≈ 71 ✓
  //
  // AEMET sunshine_hours_annual is kept in details for display only.
  const ghiAnnual       = solarRow?.ghi_annual_kwh_m2 ?? null
  const solarResourceScore = ghiAnnual != null
    ? normalise(ghiAnnual, 1300, 2100)
    : 50   // no PVGIS data (very unlikely) → neutral

  // Keep AEMET annual sunshine for display — treat 0 as a data gap
  const sunshineRaw    = climateRow.sunshine_hours_annual
  const sunshineAnnual = sunshineRaw != null && sunshineRaw > 0 ? sunshineRaw : null

  // 8g — Winter sunshine: deep winter (Dec, Jan, Feb) daily average hours.
  //      Uses AEMET monthly data when available; falls back to 50 (neutral) if
  //      the station is precipitation-only and all monthly values are 0.
  //      2.0h/day (Galicia winter) → 6.5h/day (Andalucía winter)
  const winJ = (climateRow.sunshine_hours_jan ?? 0) > 0 ? climateRow.sunshine_hours_jan : null
  const winF = (climateRow.sunshine_hours_feb ?? 0) > 0 ? climateRow.sunshine_hours_feb : null
  const winD = (climateRow.sunshine_hours_dec ?? 0) > 0 ? climateRow.sunshine_hours_dec : null
  const winterAvail = [winJ, winF, winD].filter((v): v is number => v != null)
  const winterDailyAvg = winterAvail.length > 0
    ? winterAvail.reduce((a, b) => a + b, 0) / winterAvail.length
    : null
  // If no AEMET monthly sunshine, derive winter estimate from GHI (70% of annual avg)
  const winterScoreFromGhi = ghiAnnual != null
    ? normalise((ghiAnnual / 365) * 0.70 * (1 / 0.278), 2.0, 6.5)  // kWh/m²/day → h/day approx
    : 50
  const winterScore = winterDailyAvg != null
    ? normalise(winterDailyAvg, 2.0, 6.5)
    : winterScoreFromGhi   // fall back to GHI-derived estimate

  // 8b — HDD: lower is milder (better). Invert: score 100 when HDD is minimal.
  //      150 (Canarias) → 3,000 (Castilla highlands)
  const hddAnnual = climateRow.hdd_annual
  const hddScore  = hddAnnual != null
    ? 100 - normalise(hddAnnual, 150, 3000)
    : 50

  // 8c — CDD: lower is cooler (better). Score 100 when no cooling load.
  //      0 (northern coast) → 1,500 (Sevilla interior)
  const cddAnnual = climateRow.cdd_annual
  const cddScore  = cddAnnual != null
    ? 100 - normalise(cddAnnual, 0, 1500)
    : 50

  // 8d — Building solar orientation
  const orientationScore = aspect
    ? (ORIENTATION_SOLAR_SCORE[aspect.toUpperCase()] ?? 50)
    : 50   // no Catastro data → neutral

  // 8e — Damp risk index (0–100, 100 = most damp risk)
  const dampRiskIndex = calcDampRisk(
    climateRow,
    aspect,
    build_year,
    epc_rating,
    floor,
  )
  const dampScore = 100 - dampRiskIndex   // invert: lower risk = higher score

  // 8f — Extreme heat: days above 35°C (0 = ideal, 80 = extreme)
  const heatDays  = climateRow.days_above_35c_annual
  const heatScore = heatDays != null
    ? 100 - normalise(heatDays, 0, 80)
    : 50

  // ── 5. Composite score (weights per INDICATORS.md §8) ─────────────────────
  const composite = Math.round(
    solarResourceScore * 0.20 +   // 8a — PVGIS GHI (replaces unreliable AEMET sunshine_hours)
    winterScore        * 0.15 +
    hddScore        * 0.15 +
    cddScore        * 0.10 +
    orientationScore * 0.15 +
    dampScore       * 0.15 +
    heatScore       * 0.10,
  )

  // ── 6. Confidence ─────────────────────────────────────────────────────────
  const confidence = climateRow.era5_gap_fill
    ? 'medium'   // ERA5 gap-fill used — AEMET station was distant
    : 'high'

  // ── 7. Alerts ─────────────────────────────────────────────────────────────
  const alerts: IndicatorResult['alerts'] = []

  if (dampRiskIndex >= 75) {
    alerts.push({
      type:        'red',
      category:    'climate',
      title:       'High Damp Risk',
      description: `Damp risk index ${dampRiskIndex}/100 — high humidity, north-facing, or old construction. Commission a pre-purchase damp survey.`,
    })
  } else if (dampRiskIndex >= 55) {
    alerts.push({
      type:        'amber',
      category:    'climate',
      title:       'Elevated Damp Risk',
      description: `Damp risk index ${dampRiskIndex}/100 — verify insulation and ventilation quality during viewing.`,
    })
  }

  if (heatDays != null && heatDays >= 40) {
    alerts.push({
      type:        'amber',
      category:    'climate',
      title:       'Extreme Heat Exposure',
      description: `${heatDays} days above 35°C per year. Air conditioning is essential; check EPC and insulation quality.`,
    })
  }

  if (aspect === 'N' || aspect === 'NE' || aspect === 'NW') {
    alerts.push({
      type:        'amber',
      category:    'climate',
      title:       'North-Facing Property',
      description: `${aspect}-facing orientation receives limited direct sunlight — higher heating bills and damp risk compared to south-facing equivalents.`,
    })
  }

  // ── 8. Return ──────────────────────────────────────────────────────────────
  return {
    score:      composite,
    confidence,
    details: {
      sunshine_hours_annual:    sunshineAnnual,   // AEMET station data — null if station is precipitation-only
      hdd_annual:               hddAnnual,
      cdd_annual:               cddAnnual,
      building_aspect:          aspect,
      damp_risk_index:          dampRiskIndex,
      days_above_35c_annual:    heatDays,
      ghi_annual_kwh_m2:        solarRow?.ghi_annual_kwh_m2 ?? null,
      // Sub-scores (useful for detail cards)
      sub_scores: {
        solar_resource: Math.round(solarResourceScore),  // primary: PVGIS GHI
        winter:         Math.round(winterScore),
        hdd:         Math.round(hddScore),
        cdd:         Math.round(cddScore),
        orientation: Math.round(orientationScore),
        damp:        Math.round(dampScore),
        heat:        Math.round(heatScore),
      },
      municipio_climate_source: climateRow.era5_gap_fill ? 'era5_gap_fill' : 'aemet',
    },
    alerts,
  }
}
