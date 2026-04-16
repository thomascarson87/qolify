/**
 * lib/indicators/registry.ts
 *
 * Single source of truth for all indicator metadata.
 *
 * When a new indicator is added to lib/indicators/:
 *   1. Add it to AllIndicators in types.ts
 *   2. Register it here with label, icon, tier, category, summarise, dataRows
 *   3. Set live: true once real data is available
 *
 * Consumed by:
 *   - components/ui/IndicatorCard.tsx      (label, icon, summary, data rows)
 *   - app/analyse/[jobId]/ResultView.tsx   (indicator grid, pillar composition)
 *   - components/map/PinReportPanel.tsx    (QoL score bars in neighbourhood overview)
 */

import type { AllIndicators } from './types'

export type IndicatorKey = keyof AllIndicators

export interface IndicatorMeta {
  key:      IndicatorKey
  label:    string
  icon:     string
  /** Which computation tier this indicator belongs to. */
  tier:     1 | 2 | 3
  /** Grouping used by the pillar summary and zone report sections. */
  category: 'financial' | 'health' | 'education' | 'structural' | 'connectivity' | 'community' | 'qol' | 'market'
  /**
   * True when real PostGIS data is available and the score is reliably non-null.
   * False means the IndicatorCard renders as a "coming soon" skeleton.
   */
  live:     boolean
  /** One-sentence plain-English description derived from the indicator's details object. */
  summarise: (details: Record<string, unknown>) => string
  /** Key/value rows shown in the expanded card view. Empty array = no expand button shown. */
  dataRows:  (details: Record<string, unknown>) => Array<{ label: string; value: string }>
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function fmt(v: unknown, suffix = ''): string {
  if (v == null) return '—'
  if (typeof v === 'number') return v.toLocaleString('es-ES') + suffix
  return String(v) + suffix
}

function fmtEur(v: unknown): string {
  if (v == null) return '—'
  return `€${Number(v).toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}/mo`
}

function fmtDist(v: unknown): string {
  if (v == null) return '—'
  const m = Number(v)
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`
}

// ── Indicator definitions ─────────────────────────────────────────────────────

export const INDICATOR_REGISTRY: IndicatorMeta[] = [

  // ── Tier 1 ─────────────────────────────────────────────────────────────────

  {
    key:      'true_affordability',
    label:    'True Affordability',
    icon:     '💰',
    tier:     1,
    category: 'financial',
    live:     true,
    summarise(d) {
      const total = d.monthly_total_eur as number | null
      if (!total) return 'Monthly cost estimate pending — mortgage rate data unavailable.'
      return `Estimated true cost of €${total.toLocaleString('es-ES')}/month including mortgage, tax, and climate-adjusted energy.`
    },
    dataRows(d) {
      return [
        { label: 'Mortgage (30yr, 80%)',  value: fmtEur(d.monthly_mortgage_eur)  },
        { label: 'IBI property tax',      value: fmtEur(d.monthly_ibi_eur)       },
        { label: 'Energy',                value: fmtEur(d.monthly_energy_eur)    },
        { label: 'Comunidad fees',        value: fmtEur(d.monthly_comunidad_eur) },
      ]
    },
  },

  {
    key:      'structural_liability',
    label:    'Structural Liability',
    icon:     '🏗️',
    tier:     1,
    category: 'structural',
    live:     true,
    summarise(d) {
      const year  = d.build_year as number | null
      const age   = d.build_age  as number | null
      const epc   = d.epc_risk   as string | null
      const flood = d.flood_risk_zone as string | null
      if (year == null) return 'Structural liability data not available.'
      return `Built ${year} (${age ?? '?'} years old), EPC ${epc ?? 'unknown'}${flood ? `, flood zone: ${flood}` : ''}. ${(age ?? 0) > 30 ? 'May be approaching ITE inspection window — check building registry.' : 'Relatively modern construction.'}`
    },
    dataRows(d) {
      return [
        { label: 'Build year',       value: fmt(d.build_year)           },
        { label: 'EPC risk band',    value: fmt(d.epc_risk)             },
        { label: 'Est. liability',   value: fmt(d.est_liability_band)   },
        { label: 'Flood risk zone',  value: d.flood_risk_zone ? fmt(d.flood_risk_zone) : 'None detected' },
      ]
    },
  },

  {
    key:      'digital_viability',
    label:    'Digital Viability',
    icon:     '📡',
    tier:     1,
    category: 'connectivity',
    live:     true,
    summarise(d) {
      const fibre = d.fibre_type as string | null
      const speed = d.max_speed_mbps as number | null
      if (!fibre || fibre === 'none') return 'No registered fibre coverage at this address.'
      return `${fibre} fibre coverage${speed != null ? ` — up to ${speed} Mbps` : ''}. ${fibre === 'FTTP' ? 'Full fibre to the home.' : 'Not full fibre to the home — shared last-mile segment.'}`
    },
    dataRows(d) {
      return [
        { label: 'Fibre type',      value: fmt(d.fibre_type)           },
        { label: 'Max speed',       value: d.max_speed_mbps != null ? `${d.max_speed_mbps} Mbps` : '—' },
        { label: 'Coworking (2km)', value: fmt(d.coworking_count_2km)  },
      ]
    },
  },

  {
    key:      'health_security',
    label:    'Health Security',
    icon:     '🏥',
    tier:     1,
    category: 'health',
    live:     true,
    summarise(d) {
      const gpM = d.nearest_gp_m as number | null
      const erM = d.nearest_er_m as number | null
      if (gpM == null) return 'Health facility data not available for this location.'
      return `Nearest GP ${gpM}m away${erM != null ? `, A&E at ${erM < 1000 ? erM + 'm' : (erM / 1000).toFixed(1) + 'km'}` : ''}. ${gpM < 300 ? 'Excellent' : gpM < 600 ? 'Good' : 'Moderate'} healthcare access.`
    },
    dataRows(d) {
      return [
        { label: 'Nearest GP',              value: fmtDist(d.nearest_gp_m)           },
        { label: 'Nearest A&E',             value: fmtDist(d.nearest_er_m)           },
        { label: 'Pharmacies (500m)',        value: fmt(d.pharmacy_count_500m)        },
        { label: 'GP wait (days)',           value: d.avg_days_gp_wait != null ? `~${d.avg_days_gp_wait}d` : '—' },
        { label: 'Specialist wait (days)',   value: d.avg_days_specialist_wait != null ? `~${d.avg_days_specialist_wait}d` : '—' },
      ]
    },
  },

  {
    key:      'education_opportunity',
    label:    'Education Opportunity',
    icon:     '🎓',
    tier:     1,
    category: 'education',
    live:     true,
    summarise(d) {
      const count      = d.school_count_1km  as number | null
      const inCatchment = d.in_catchment     as boolean | null
      const bilingual  = d.bilingual_count   as number | null
      if (count == null) return 'School catchment data not available for this location.'
      return `${count} school${count !== 1 ? 's' : ''} within 1km${bilingual ? `, ${bilingual} bilingual` : ''}. ${inCatchment ? 'Property is within a school catchment area.' : 'Not currently in a named catchment — verify with local authority.'}`
    },
    dataRows(d) {
      const b = d.breakdown as { public?: number; concertado?: number } | null
      return [
        { label: 'Schools within 1km',   value: fmt(d.school_count_1km)                       },
        { label: 'In catchment area',    value: d.in_catchment ? 'Yes' : 'No'                  },
        { label: 'Public / Concertado',  value: b ? `${b.public ?? 0} / ${b.concertado ?? 0}` : '—' },
        { label: 'Bilingual schools',    value: d.bilingual_count != null ? fmt(d.bilingual_count) : '—' },
      ]
    },
  },

  // ── Tier 2 ─────────────────────────────────────────────────────────────────

  {
    key:      'expat_liveability',
    label:    'Expat Liveability',
    icon:     '✈️',
    tier:     2,
    category: 'connectivity',
    live:     true,
    summarise(d) {
      const km   = d.nearest_airport_km   as number | null
      const iata = d.nearest_airport_iata as string | null
      if (km == null) return 'Airport proximity data not available.'
      return `${km}km to ${iata ?? 'nearest airport'} — ${km < 10 ? 'excellent' : km < 30 ? 'good' : 'acceptable'} connectivity for expats and frequent travellers.`
    },
    dataRows(d) {
      return [
        { label: 'Airport',          value: fmt(d.nearest_airport_iata)                                                   },
        { label: 'Distance',         value: d.nearest_airport_km != null ? `${d.nearest_airport_km}km` : '—'              },
        { label: 'Weekly flights',   value: fmt(d.nearest_airport_weekly_flights)                                          },
        { label: 'Second airport',   value: d.second_airport_iata ? `${d.second_airport_iata} (${d.second_airport_km}km)` : '—' },
      ]
    },
  },

  {
    key:      'community_stability',
    label:    'Community Stability',
    icon:     '🏘️',
    tier:     2,
    category: 'community',
    live:     true,
    summarise(d) {
      const vut   = d.vut_active_500m as number | null
      const noise = d.noise_lden      as number | null
      if (vut == null) return 'Community stability data being computed.'
      const vutDesc  = vut === 0 ? 'No tourist licences within 500m.' : `${vut} active tourist licence${vut !== 1 ? 's' : ''} within 500m.`
      const noiseDesc = noise != null ? ` Noise level: Lden ${noise} dB.` : ''
      return vutDesc + noiseDesc
    },
    dataRows(d) {
      return [
        { label: 'Tourist licences (500m)', value: fmt(d.vut_active_500m)                                       },
        { label: 'Noise level (Lden)',       value: d.noise_lden != null ? `${d.noise_lden} dB` : '—'           },
        { label: 'Noise band',              value: fmt(d.noise_band)                                             },
        { label: 'Dom. stability',          value: d.dom_stability_stub ? 'Stub (Phase 3+)' : fmt(d.dom_stability) },
      ]
    },
  },

  {
    key:      'neighbourhood_transition',
    label:    'Neighbourhood Transition',
    icon:     '📈',
    tier:     2,
    category: 'market',
    live:     false,
    summarise()  { return 'Neighbourhood transition signals require historical zone metrics. Available in Phase 3.' },
    dataRows()   { return [] },
  },

  {
    key:      'climate_solar',
    label:    'Climate & Solar',
    icon:     '☀️',
    tier:     2,
    category: 'qol',
    live:     true,
    summarise(d) {
      const ghi    = d.ghi_annual_kwh_m2     as number | null
      const sun    = d.sunshine_hours_annual as number | null
      const hdd    = d.hdd_annual            as number | null
      const cdd    = d.cdd_annual            as number | null
      const aspect = d.building_aspect       as string | null
      const damp   = d.damp_risk_index       as number | null
      if (ghi == null && sun == null) return 'Climate data being computed for this location.'
      const parts: string[] = []
      if (ghi != null)  parts.push(`${ghi.toLocaleString('es-ES')} kWh/m²/yr solar irradiance`)
      else if (sun != null) parts.push(`${sun.toLocaleString('es-ES')} sunshine hrs/yr`)
      if (hdd != null)  parts.push(`Heating: ${hdd} HDD`)
      if (cdd != null)  parts.push(`Cooling: ${cdd} CDD`)
      if (aspect)       parts.push(`${aspect}-facing`)
      if (damp != null) parts.push(`Damp risk: ${damp}/100`)
      return parts.join('. ') + '.'
    },
    dataRows(d) {
      const ss = d.sub_scores as Record<string, number> | null
      return [
        { label: 'Solar irradiance (GHI)', value: d.ghi_annual_kwh_m2 != null ? `${d.ghi_annual_kwh_m2} kWh/m²/yr` : '—' },
        { label: 'AEMET sunshine hours',   value: d.sunshine_hours_annual != null ? `${Number(d.sunshine_hours_annual).toLocaleString('es-ES')} hrs/yr` : '—' },
        { label: 'Heating (HDD)',          value: d.hdd_annual   != null ? `${d.hdd_annual} HDD` : '—'   },
        { label: 'Cooling (CDD)',          value: d.cdd_annual   != null ? `${d.cdd_annual} CDD` : '—'   },
        { label: 'Building orientation',   value: d.building_aspect ? String(d.building_aspect) : '—'    },
        { label: 'Damp risk index',        value: d.damp_risk_index != null ? `${d.damp_risk_index}/100` : '—' },
        { label: 'Days above 35°C',        value: d.days_above_35c_annual != null ? String(d.days_above_35c_annual) : '—' },
        { label: 'Solar resource score',   value: ss ? `${ss.solar_resource}/100` : '—' },
        { label: 'HDD score',              value: ss ? `${ss.hdd}/100`            : '—' },
      ]
    },
  },

  {
    key:      'infrastructure_arbitrage',
    label:    'Infrastructure Arbitrage',
    icon:     '🚇',
    tier:     2,
    category: 'market',
    live:     false,
    summarise()  { return 'Infrastructure pipeline data (planned metro, road upgrades) coming soon.' },
    dataRows()   { return [] },
  },

  {
    key:      'motivated_seller',
    label:    'Motivated Seller Index',
    icon:     '🤝',
    tier:     2,
    category: 'market',
    live:     false,
    summarise()  { return 'Seller motivation signals require listing history data. Coming in Phase 4.' },
    dataRows()   { return [] },
  },

  {
    key:      'rental_trap',
    label:    'Rental Trap Index',
    icon:     '🔑',
    tier:     2,
    category: 'market',
    live:     false,
    summarise()  { return 'Rent-vs-buy comparison requires current rental market data. Coming soon.' },
    dataRows()   { return [] },
  },

  // ── QoL Enrichment Layer (CHI-377) ─────────────────────────────────────────

  {
    key:      'daily_life_score',
    label:    'Daily Life Score',
    icon:     '🚶',
    tier:     2,
    category: 'qol',
    live:     true,
    summarise(d) {
      const needs  = d.daily_needs_count_400m as number | null
      const beach  = d.nearest_beach_m        as number | null
      const walk   = d.walkability_sub_score  as number | null
      if (needs == null) return 'Daily life walkability data being computed.'
      const beachStr = beach != null ? ` Nearest beach ${(beach / 1000).toFixed(1)}km.` : ''
      return `${needs} daily needs (pharmacy, supermarket, café, GP) within 400m. Walkability score: ${walk ?? '—'}/100.${beachStr}`
    },
    dataRows(d) {
      const ss = d.sub_scores as Record<string, number> | null
      return [
        { label: 'Daily needs (400m)', value: fmt(d.daily_needs_count_400m)                                          },
        { label: 'Walkability',        value: ss ? `${ss.walk}/60 pts` : '—'                                         },
        { label: 'Mobility score',     value: ss ? `${ss.mobility}/40 pts` : '—'                                     },
        { label: 'Green space (500m)', value: d.park_area_sqm_500m != null ? `${Math.round(Number(d.park_area_sqm_500m)).toLocaleString('es-ES')} m²` : '—' },
        { label: 'Nearest beach',      value: d.nearest_beach_m != null ? `${(Number(d.nearest_beach_m) / 1000).toFixed(1)} km` : '—' },
      ]
    },
  },

  {
    key:      'sensory_environment',
    label:    'Sensory Environment',
    icon:     '🌿',
    tier:     2,
    category: 'qol',
    live:     true,
    summarise(d) {
      const lden  = d.noise_lden      as number | null
      const aqi   = d.aqi_annual_avg  as number | null
      if (lden == null && aqi == null) return 'Noise and air quality data pending. Using statistical baseline.'
      const parts: string[] = []
      if (lden != null) parts.push(`Lden noise: ${lden} dB`)
      if (aqi  != null) parts.push(`AQI avg: ${aqi}`)
      return parts.join('. ') + '. Lower noise and AQI mean a quieter, healthier living environment.'
    },
    dataRows(d) {
      const ss = d.sub_scores as Record<string, number> | null
      return [
        { label: 'Noise (Lden)',     value: d.noise_lden != null ? `${d.noise_lden} dB` : '—'   },
        { label: 'Noise band',       value: fmt(d.noise_band)                                     },
        { label: 'AQI annual avg',   value: d.aqi_annual_avg != null ? String(d.aqi_annual_avg) : '—' },
        { label: 'PM2.5',            value: d.pm25_ugm3 != null ? `${d.pm25_ugm3} μg/m³` : '—'  },
        { label: 'NO₂',              value: d.no2_ugm3  != null ? `${d.no2_ugm3} μg/m³` : '—'   },
        { label: 'Park area (500m)', value: d.park_area_sqm_500m != null ? `${Math.round(Number(d.park_area_sqm_500m)).toLocaleString('es-ES')} m²` : '—' },
        { label: 'Noise sub-score',  value: ss ? String(ss.noise) : '—'                           },
        { label: 'AQI sub-score',    value: ss ? String(ss.aqi)   : '—'                           },
      ]
    },
  },

  {
    key:      'cost_of_life_index',
    label:    'Cost of Life Index',
    icon:     '🛒',
    tier:     2,
    category: 'qol',
    live:     false,   // blocked on CHI-376 (Numbeo API key)
    summarise(d) {
      const coffee = d.coffee_eur as number | null
      if (coffee == null) return 'Cost of living data pending Numbeo API integration (CHI-376).'
      const grocery = d.grocery_index as number | null
      return `Coffee ~€${coffee}/cup${grocery != null ? `, grocery index ${grocery}/100` : ''}. City-level estimate — postcode precision coming in Phase 3.`
    },
    dataRows(d) {
      return [
        { label: 'Coffee',                value: d.coffee_eur       != null ? `€${d.coffee_eur}`       : '—' },
        { label: 'Cheap meal',            value: d.meal_cheap_eur   != null ? `€${d.meal_cheap_eur}`   : '—' },
        { label: 'Mid-range meal',        value: d.meal_midrange_eur!= null ? `€${d.meal_midrange_eur}`: '—' },
        { label: 'Grocery index',         value: d.grocery_index    != null ? `${d.grocery_index}/100` : '—' },
        { label: 'Supermarkets (500m)',   value: fmt(d.total_supermarkets_500m)                              },
        { label: 'Discount supers (500m)',value: fmt(d.discount_supermarkets)                                },
      ]
    },
  },

]

// ── Lookup map ────────────────────────────────────────────────────────────────

export const INDICATOR_MAP: Record<string, IndicatorMeta> = Object.fromEntries(
  INDICATOR_REGISTRY.map(m => [m.key, m])
)

// ── Grouped subsets ───────────────────────────────────────────────────────────

/** All indicators where live === true — used to filter the IndicatorCard grid. */
export const LIVE_INDICATORS = INDICATOR_REGISTRY.filter(m => m.live)

/** QoL Enrichment indicators (CHI-377) — daily life, sensory, cost of life. */
export const QOL_INDICATORS  = INDICATOR_REGISTRY.filter(m => m.category === 'qol' && m.live)

/**
 * Pillar groupings for the score summary bar chart in ResultView.
 * Each pillar aggregates one or more indicator scores.
 */
export const PILLAR_GROUPS = [
  {
    label:    'Financial',
    keys:     ['true_affordability'] as IndicatorKey[],
    invert:   [] as IndicatorKey[],
  },
  {
    label:    'Lifestyle',
    keys:     ['health_security', 'education_opportunity', 'daily_life_score', 'sensory_environment'] as IndicatorKey[],
    invert:   [] as IndicatorKey[],
  },
  {
    label:    'Risk',
    keys:     ['structural_liability'] as IndicatorKey[],
    invert:   ['structural_liability'] as IndicatorKey[],   // lower SLI = better
  },
  {
    label:    'Community',
    keys:     ['expat_liveability', 'community_stability'] as IndicatorKey[],
    invert:   [] as IndicatorKey[],
  },
]
