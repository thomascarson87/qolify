/**
 * Indicator 1 — True Affordability Score
 *
 * What it tells the user: Not what the property costs to buy,
 * but what it costs to live in every month.
 *
 * CTE consolidation (CHI-334): 5 separate queries merged into 1.
 */
import type { Sql } from 'postgres'
import type { PropertyInput, IndicatorResult, Alert } from './types'
import {
  normalise,
  monthlyMortgage,
  roundOrNull,
} from './utils'

// National range for normalisation
const MONTHLY_COST_NATIONAL_MIN = 500
const MONTHLY_COST_NATIONAL_MAX = 6000

// IBI estimate: ~0.4% of cadastral value (approx 60% of asking price)
const IBI_RATE = 0.004
const CATASTRO_PRICE_RATIO = 0.60

function estimateComunidadMonthly(buildYear: number | null, areaSqm: number): number {
  const year = buildYear ?? 1990
  const ratePerSqm = year < 1970 ? 8.0 : year < 1990 ? 5.0 : year < 2010 ? 3.5 : 2.5
  return (ratePerSqm * areaSqm) / 12
}

export async function calcTrueAffordability(
  sql: Sql,
  property: PropertyInput,
  buyerAge?: number | null,
): Promise<IndicatorResult & { details: Record<string, unknown> }> {
  const alerts: Alert[] = []

  // --- Single CTE: eco_constants + itp_rates + ico_caps + climate_data + building_orientation ---
  const [row] = await sql<{
    ecb_base_rate_pct: number; typical_bank_spread_pct: number
    gas_price_kwh_eur: number; electricity_pvpc_kwh_eur: number
    u_value_epc_a: number; u_value_epc_b: number; u_value_epc_c: number
    u_value_epc_d: number; u_value_epc_e: number; u_value_epc_f: number; u_value_epc_g: number
    solar_gain_s: number; solar_gain_se_sw: number; solar_gain_e_w: number
    solar_gain_ne_nw: number; solar_gain_n: number
    itp_rate: number | null
    ico_max_price: number | null; ico_max_age: number | null; ico_guarantee_pct: number | null
    hdd_annual: number | null; cdd_annual: number | null
    aspect: string | null
  }[]>`
    WITH
      constants AS (
        SELECT * FROM eco_constants ORDER BY valid_from DESC LIMIT 1
      ),
      itp AS (
        SELECT standard_rate_pct
        FROM itp_rates
        WHERE comunidad_autonoma = ${property.comunidad_autonoma ?? ''}
        LIMIT 1
      ),
      ico AS (
        SELECT max_price_eur, max_age, guarantee_pct
        FROM ico_caps
        WHERE comunidad_autonoma = ${property.comunidad_autonoma ?? ''}
        LIMIT 1
      ),
      climate AS (
        SELECT hdd_annual, cdd_annual
        FROM climate_data
        WHERE municipio_code = ${property.codigo_postal ?? ''}
           OR municipio_name = ${property.municipio ?? ''}
        LIMIT 1
      ),
      orientation AS (
        SELECT aspect
        FROM building_orientation
        WHERE ref_catastral = ${property.ref_catastral ?? ''}
        LIMIT 1
      )
    SELECT
      c.ecb_base_rate_pct, c.typical_bank_spread_pct,
      c.gas_price_kwh_eur, c.electricity_pvpc_kwh_eur,
      c.u_value_epc_a, c.u_value_epc_b, c.u_value_epc_c,
      c.u_value_epc_d, c.u_value_epc_e, c.u_value_epc_f, c.u_value_epc_g,
      c.solar_gain_s, c.solar_gain_se_sw, c.solar_gain_e_w,
      c.solar_gain_ne_nw, c.solar_gain_n,
      itp.standard_rate_pct   AS itp_rate,
      ico.max_price_eur        AS ico_max_price,
      ico.max_age              AS ico_max_age,
      ico.guarantee_pct        AS ico_guarantee_pct,
      climate.hdd_annual,
      climate.cdd_annual,
      orientation.aspect
    FROM constants c
    LEFT JOIN itp         ON TRUE
    LEFT JOIN ico         ON TRUE
    LEFT JOIN climate     ON TRUE
    LEFT JOIN orientation ON TRUE
  `

  if (!row) throw new Error('eco_constants not seeded')

  // EPC U-value from DB constants
  const epcUMap: Record<string, number> = {
    A: row.u_value_epc_a, B: row.u_value_epc_b, C: row.u_value_epc_c, D: row.u_value_epc_d,
    E: row.u_value_epc_e, F: row.u_value_epc_f, G: row.u_value_epc_g,
  }
  const uValue = (property.epc_rating ? epcUMap[property.epc_rating.toUpperCase()] : null) ?? row.u_value_epc_d

  // Solar gain
  const aspectUpper = row.aspect?.toUpperCase() ?? null
  const solarGain =
    aspectUpper === 'S'                            ? row.solar_gain_s     :
    aspectUpper === 'SE' || aspectUpper === 'SW'   ? row.solar_gain_se_sw :
    aspectUpper === 'E'  || aspectUpper === 'W'    ? row.solar_gain_e_w   :
    aspectUpper === 'NE' || aspectUpper === 'NW'   ? row.solar_gain_ne_nw :
    aspectUpper === 'N'                            ? row.solar_gain_n     :
    row.solar_gain_e_w  // neutral fallback for unknown orientation

  const hdd = row.hdd_annual ?? 1500
  const cdd = row.cdd_annual ?? 500

  // ICO eligibility
  const icoEligible =
    row.ico_max_price != null &&
    property.price_asking <= row.ico_max_price &&
    (buyerAge == null || row.ico_max_age == null || buyerAge <= row.ico_max_age)

  // Deposit & mortgage
  const depositPct = icoEligible ? 0.05 : 0.20
  const principal  = property.price_asking * (1 - depositPct)
  const annualRate = ((row.ecb_base_rate_pct ?? 3.5) + (row.typical_bank_spread_pct ?? 1.0)) / 100
  const mortgageMonthly = monthlyMortgage(principal, annualRate, 30)

  // Energy cost (climate-adjusted)
  const heatingKwh        = hdd * property.area_sqm * uValue * 0.024 * (1 - solarGain)
  const heatingCostAnnual = heatingKwh * (row.gas_price_kwh_eur ?? 0.07)
  const coolingKwh        = cdd * property.area_sqm * uValue * 0.4 * 0.024
  const coolingCostAnnual = coolingKwh * (row.electricity_pvpc_kwh_eur ?? 0.15)
  const energyMonthly     = (heatingCostAnnual + coolingCostAnnual) / 12

  // IBI + comunidad
  const ibiMonthly = (property.price_asking * CATASTRO_PRICE_RATIO * IBI_RATE) / 12
  const comunidadMonthly = estimateComunidadMonthly(
    property.build_year ?? property.catastro_year_built ?? null,
    property.area_sqm,
  )

  const totalMonthly = mortgageMonthly + energyMonthly + ibiMonthly + comunidadMonthly
  const rawScore = normalise(totalMonthly, MONTHLY_COST_NATIONAL_MIN, MONTHLY_COST_NATIONAL_MAX)
  const score = Math.round(100 - rawScore)

  const itpRate = row.itp_rate ?? 8.0
  const costRatio = totalMonthly / 2000  // proxy income (local income data: Phase 1)
  if (costRatio > 0.5) {
    alerts.push({ type: 'red',   category: 'affordability', title: 'Coste excede el 50% de ingreso mediano', description: `El coste mensual estimado de €${Math.round(totalMonthly)} supera el 50% del ingreso mensual mediano.` })
  } else if (costRatio > 0.4) {
    alerts.push({ type: 'amber', category: 'affordability', title: 'Coste supera el 40% de ingreso mediano', description: `El coste mensual estimado de €${Math.round(totalMonthly)} supera el 40% del ingreso mensual mediano.` })
  }

  return {
    score,
    confidence: row.hdd_annual ? 'high' : 'medium',
    details: {
      monthly_total_eur:     roundOrNull(totalMonthly),
      monthly_mortgage_eur:  roundOrNull(mortgageMonthly),
      monthly_energy_eur:    roundOrNull(energyMonthly),
      monthly_ibi_eur:       roundOrNull(ibiMonthly),
      monthly_comunidad_eur: roundOrNull(comunidadMonthly),
      itp_rate_pct:          itpRate,
      itp_total_eur:         roundOrNull(property.price_asking * (itpRate / 100)),
      ico_eligible:          icoEligible,
      deposit_pct:           depositPct * 100,
      loan_rate_pct:         annualRate * 100,
      hdd_used:              hdd,
      cdd_used:              cdd,
      building_aspect:       row.aspect ?? null,
    },
    alerts,
  }
}
