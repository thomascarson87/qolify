/**
 * Indicator engine entry point.
 *
 * Runs all Tier 1 and Tier 2 indicators in parallel against live PostGIS data.
 * Returns a combined result object that maps directly to analysis_cache.composite_indicators.
 *
 * Tier 3 indicators (price velocity, gentrification, seasonal) require historical data
 * and are not computed here — they're populated by the zone-metrics cron.
 *
 * QoL Enrichment Layer (CHI-377): Added community_stability (real), daily_life_score,
 * sensory_environment, and cost_of_life_index.
 */
import type { Sql } from 'postgres'
import type { PropertyInput, AllIndicators } from './types'
import { calcTrueAffordability }    from './true-affordability'
import { calcStructuralLiability }  from './structural-liability'
import { calcDigitalViability }     from './digital-viability'
import { calcHealthSecurity }       from './health-security'
import { calcEducationOpportunity } from './education-opportunity'
import { calcExpatLiveability }     from './expat-liveability'
import { calcCommunityStability }   from './community-stability'
import { calcDailyLifeScore }       from './daily-life-score'
import { calcSensoryEnvironment }   from './sensory-environment'
import { calcCostOfLifeIndex }      from './cost-of-life-index'
import { calcClimateSolar }         from './climate-solar'

/** Stub result for indicators without data yet. */
function insufficientData() {
  return {
    score: null as null,
    confidence: 'insufficient_data' as const,
    details: {},
    alerts: [],
  }
}

export async function runAllIndicators(
  sql: Sql,
  property: PropertyInput,
  buyerAge?: number | null,
): Promise<AllIndicators> {
  // Run all indicators in parallel — each is independent
  const [
    trueAffordability,
    structuralLiability,
    digitalViability,
    healthSecurity,
    educationOpportunity,
    expatLiveability,
    communityStability,
    climateSolar,
    dailyLifeScore,
    sensoryEnvironment,
    costOfLifeIndex,
  ] = await Promise.all([
    calcTrueAffordability(sql, property, buyerAge),
    calcStructuralLiability(sql, property),
    calcDigitalViability(sql, property),
    calcHealthSecurity(sql, property),
    calcEducationOpportunity(sql, property),
    calcExpatLiveability(sql, property),
    calcCommunityStability(sql, property),
    calcClimateSolar(sql, property),
    calcDailyLifeScore(sql, property),
    calcSensoryEnvironment(sql, property),
    calcCostOfLifeIndex(sql, property),
  ])

  return {
    // Tier 1
    true_affordability:    trueAffordability,
    structural_liability:  structuralLiability,
    digital_viability:     digitalViability,
    health_security:       healthSecurity,
    education_opportunity: educationOpportunity,

    // Tier 2
    neighbourhood_transition: { ...insufficientData(), details: { nti_signal: null } },
    community_stability:      communityStability,
    climate_solar:            climateSolar,
    infrastructure_arbitrage: insufficientData(),
    motivated_seller:         insufficientData(),
    rental_trap:              insufficientData(),
    expat_liveability:        expatLiveability,

    // QoL Enrichment Layer (CHI-377)
    daily_life_score:    dailyLifeScore,
    sensory_environment: sensoryEnvironment,
    cost_of_life_index:  costOfLifeIndex,
  }
}

/** Collect all alerts from all indicators into a flat array. */
export function collectAlerts(indicators: AllIndicators) {
  return Object.values(indicators).flatMap((ind) => ind.alerts ?? [])
}

/** Compute a simple composite TVI score from available Tier 1 scores. */
export function calcTviScore(indicators: AllIndicators): number | null {
  const tier1 = [
    indicators.true_affordability.score,
    indicators.structural_liability.score != null
      ? 100 - indicators.structural_liability.score  // invert: lower SLI is better
      : null,
    indicators.digital_viability.score,
    indicators.health_security.score,
    indicators.education_opportunity.score,
  ].filter((s): s is number => s != null && !isNaN(s))

  if (tier1.length === 0) return null
  return Math.round(tier1.reduce((a, b) => a + b, 0) / tier1.length)
}
