/**
 * Shared types for Qolify's composite indicator engine.
 */

/** Property data extracted from listing + Catastro. Input to all indicators. */
export interface PropertyInput {
  lat: number
  lng: number
  price_asking: number
  area_sqm: number
  comunidad_autonoma: string
  municipio?: string
  municipio_code?: string        // 5-digit INE code (for municipio_income + climate_data joins)
  codigo_postal?: string
  ref_catastral?: string
  build_year?: number | null
  epc_rating?: string | null    // 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'
  epc_potential?: string | null
  bedrooms?: number | null
  floor?: number | null
  seller_type?: string | null
  catastro_year_built?: number | null
  negotiation_gap_pct?: number | null
}

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'insufficient_data'

export interface Alert {
  type: 'green' | 'amber' | 'red'
  category: string
  title: string
  description: string
}

export interface IndicatorResult {
  score: number | null            // 0-100 unless stated otherwise
  confidence: ConfidenceLevel
  details: Record<string, unknown>
  alerts: Alert[]
}

/** All computed Tier 1 + Tier 2 indicators combined. Written to analysis_cache. */
export interface AllIndicators {
  // Tier 1
  true_affordability:    IndicatorResult
  structural_liability:  IndicatorResult
  digital_viability:     IndicatorResult
  health_security:       IndicatorResult
  education_opportunity: IndicatorResult

  // Tier 2
  neighbourhood_transition: IndicatorResult
  community_stability:      IndicatorResult
  climate_solar:            IndicatorResult
  infrastructure_arbitrage: IndicatorResult
  motivated_seller:         IndicatorResult
  rental_trap:              IndicatorResult
  expat_liveability:        IndicatorResult

  // QoL Enrichment Layer — new indicators (CHI-377)
  daily_life_score:         IndicatorResult  // Indicator 16
  sensory_environment:      IndicatorResult  // Indicator 17
  cost_of_life_index:       IndicatorResult  // Indicator 18
}
