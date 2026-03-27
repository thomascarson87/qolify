/**
 * Indicator 1 — True Affordability Score
 *
 * What it tells the user: Not what the property costs to buy,
 * but what it costs to live in every month.
 */
import type { Sql } from 'postgres'
import type { PropertyInput, IndicatorResult, Alert } from './types'
import {
  normalise,
  EPC_U_VALUES,
  monthlyMortgage,
  roundOrNull,
} from './utils'

interface EcoConstants {
  ecb_base_rate_pct: number
  typical_bank_spread_pct: number
  gas_price_kwh_eur: number
  electricity_pvpc_kwh_eur: number
  u_value_epc_a: number
  u_value_epc_b: number
  u_value_epc_c: number
  u_value_epc_d: number
  u_value_epc_e: number
  u_value_epc_f: number
  u_value_epc_g: number
  solar_gain_s: number
  solar_gain_se_sw: number
  solar_gain_e_w: number
  solar_gain_ne_nw: number
  solar_gain_n: number
}

interface ITPRate {
  standard_rate_pct: number
  reduced_rate_pct: number
}

interface ICOCap {
  max_price_eur: number
  max_age: number
  max_income_eur: number
  guarantee_pct: number
}

// National range for normalisation (calibrate from real data over time)
const MONTHLY_COST_NATIONAL_MIN = 500   // EUR/month (very affordable)
const MONTHLY_COST_NATIONAL_MAX = 6000  // EUR/month (very expensive)

// IBI estimate: Spanish average ~0.4% of cadastral value per year
// We approximate cadastral value as 60% of asking price
const IBI_RATE = 0.004
const CATASTRO_PRICE_RATIO = 0.60

// Comunidad fee estimate by build year (annual EUR/m²)
function estimateComunidadMonthly(buildYear: number | null, areaSqm: number): number {
  const year = buildYear ?? 1990
  const ratePerSqm = year < 1970 ? 8.0 : year < 1990 ? 5.0 : year < 2010 ? 3.5 : 2.5
  return (ratePerSqm * areaSqm) / 12
}

// EPC U-values using eco_constants from DB (or fallback to static table)
function getUValue(epc: string | null | undefined, constants: EcoConstants): number {
  if (!epc) return EPC_U_VALUES['D']  // unknown: assume median D
  const map: Record<string, number> = {
    A: constants.u_value_epc_a,
    B: constants.u_value_epc_b,
    C: constants.u_value_epc_c,
    D: constants.u_value_epc_d,
    E: constants.u_value_epc_e,
    F: constants.u_value_epc_f,
    G: constants.u_value_epc_g,
  }
  return map[epc.toUpperCase()] ?? EPC_U_VALUES['D']
}

function getSolarGain(aspect: string | null | undefined, constants: EcoConstants): number {
  if (!aspect) return constants.solar_gain_e_w  // unknown: neutral
  const a = aspect.toUpperCase()
  if (a === 'S')             return constants.solar_gain_s
  if (a === 'SE' || a === 'SW') return constants.solar_gain_se_sw
  if (a === 'E' || a === 'W')   return constants.solar_gain_e_w
  if (a === 'NE' || a === 'NW') return constants.solar_gain_ne_nw
  return constants.solar_gain_n
}

export async function calcTrueAffordability(
  sql: Sql,
  property: PropertyInput,
  buyerAge?: number | null,
): Promise<IndicatorResult & { details: Record<string, unknown> }> {
  const alerts: Alert[] = []

  // --- Fetch constants from DB ---
  const [constants] = await sql<EcoConstants[]>`
    SELECT * FROM eco_constants ORDER BY valid_from DESC LIMIT 1
  `
  if (!constants) throw new Error('eco_constants not seeded')

  const [itp] = await sql<ITPRate[]>`
    SELECT standard_rate_pct, reduced_rate_pct, reduced_conditions
    FROM itp_rates
    WHERE comunidad_autonoma = ${property.comunidad_autonoma}
    LIMIT 1
  `

  const [ico] = await sql<ICOCap[]>`
    SELECT max_price_eur, max_age, max_income_eur, guarantee_pct
    FROM ico_caps
    WHERE comunidad_autonoma = ${property.comunidad_autonoma}
    LIMIT 1
  `

  // --- Climate data for energy calculation ---
  const [climate] = await sql<{ hdd_annual: number | null; cdd_annual: number | null }[]>`
    SELECT hdd_annual, cdd_annual
    FROM climate_data
    WHERE municipio_code = ${property.codigo_postal ?? ''}
       OR municipio_name = ${property.municipio ?? ''}
    LIMIT 1
  `

  // --- Building orientation for solar gain ---
  const [orientation] = await sql<{ aspect: string | null }[]>`
    SELECT aspect FROM building_orientation
    WHERE ref_catastral = ${property.ref_catastral ?? ''}
    LIMIT 1
  `

  // --- ITP: use standard rate (reduced rates need buyer age/income context) ---
  const itpRate = itp?.standard_rate_pct ?? 8.0
  const itpCost = property.price_asking * (itpRate / 100)

  // --- ICO eligibility (basic: price <= cap, age <= max) ---
  const icoEligible =
    ico != null &&
    property.price_asking <= ico.max_price_eur &&
    (buyerAge == null || buyerAge <= ico.max_age)

  // --- Deposit & mortgage ---
  const depositPct = icoEligible ? 0.05 : 0.20  // ICO covers up to 20% guarantee → 5% deposit
  const deposit = property.price_asking * depositPct
  const principal = property.price_asking - deposit
  const annualRate = (constants.ecb_base_rate_pct + constants.typical_bank_spread_pct) / 100
  const mortgageMonthly = monthlyMortgage(principal, annualRate, 30)

  // --- Energy cost (climate-adjusted) ---
  const uValue = getUValue(property.epc_rating, constants)
  const aspect = orientation?.aspect ?? null
  const solarGain = getSolarGain(aspect, constants)
  const hdd = climate?.hdd_annual ?? 1500   // Spain avg if no data
  const cdd = climate?.cdd_annual ?? 500

  // Heating: HDD × area × U-value × 0.024 × (1 - solar_gain)
  const heatingKwh = hdd * property.area_sqm * uValue * 0.024 * (1 - solarGain)
  const heatingCostAnnual = heatingKwh * constants.gas_price_kwh_eur

  // Cooling: CDD × area × cooling_factor × 0.024
  // cooling_factor: inversely proportional to EPC (better insulation = less cooling too)
  const coolingFactor = uValue * 0.4  // simplified
  const coolingKwh = cdd * property.area_sqm * coolingFactor * 0.024
  const coolingCostAnnual = coolingKwh * constants.electricity_pvpc_kwh_eur

  const energyMonthly = (heatingCostAnnual + coolingCostAnnual) / 12

  // --- IBI (annual property tax) ---
  const ibiAnnual = property.price_asking * CATASTRO_PRICE_RATIO * IBI_RATE
  const ibiMonthly = ibiAnnual / 12

  // --- Comunidad fee ---
  const comunidadMonthly = estimateComunidadMonthly(
    property.build_year ?? property.catastro_year_built ?? null,
    property.area_sqm,
  )

  // --- Total monthly cost ---
  const totalMonthly = mortgageMonthly + energyMonthly + ibiMonthly + comunidadMonthly

  // --- Score ---
  // Higher score = more affordable (inverted normalisation)
  const rawScore = normalise(totalMonthly, MONTHLY_COST_NATIONAL_MIN, MONTHLY_COST_NATIONAL_MAX)
  const score = Math.round(100 - rawScore)

  // --- Alerts ---
  // We don't have local income data yet; use a fixed proxy of €2,000/month net
  const incomeMonthly = 2000
  const costRatio = totalMonthly / incomeMonthly
  if (costRatio > 0.5) {
    alerts.push({
      type: 'red',
      category: 'affordability',
      title: 'Coste excede el 50% de ingreso mediano',
      description: `El coste mensual estimado de €${Math.round(totalMonthly)} supera el 50% del ingreso mensual mediano.`,
    })
  } else if (costRatio > 0.4) {
    alerts.push({
      type: 'amber',
      category: 'affordability',
      title: 'Coste supera el 40% de ingreso mediano',
      description: `El coste mensual estimado de €${Math.round(totalMonthly)} supera el 40% del ingreso mensual mediano.`,
    })
  }

  return {
    score,
    confidence: climate ? 'high' : 'medium',
    details: {
      monthly_total_eur:    roundOrNull(totalMonthly),
      monthly_mortgage_eur: roundOrNull(mortgageMonthly),
      monthly_energy_eur:   roundOrNull(energyMonthly),
      monthly_ibi_eur:      roundOrNull(ibiMonthly),
      monthly_comunidad_eur: roundOrNull(comunidadMonthly),
      itp_rate_pct:         itpRate,
      itp_total_eur:        roundOrNull(itpCost),
      ico_eligible:         icoEligible,
      deposit_pct:          depositPct * 100,
      loan_rate_pct:        annualRate * 100,
      hdd_used:             hdd,
      cdd_used:             cdd,
      building_aspect:      aspect,
    },
    alerts,
  }
}
