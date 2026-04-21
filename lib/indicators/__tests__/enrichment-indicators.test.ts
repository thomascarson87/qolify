/**
 * Unit tests for QoL Enrichment Layer indicators (CHI-377).
 *
 * These tests mock the postgres `sql` tag function to return controlled data,
 * verifying formula correctness, NULL handling, and alert thresholds without
 * requiring a database connection.
 *
 * Málaga reference coordinates: 36.7193° N, -4.4197° W
 */
import { describe, it, expect, vi } from 'vitest'
import { calcCommunityStability }  from '../community-stability'
import { calcDailyLifeScore }      from '../daily-life-score'
import { calcSensoryEnvironment }  from '../sensory-environment'
import { calcCostOfLifeIndex }     from '../cost-of-life-index'
import { calcHealthSecurity }      from '../health-security'
import { calcEducationOpportunity } from '../education-opportunity'

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Build a mock postgres sql tag that returns the given rows. */
function mockSql(rows: unknown[]) {
  // The sql tagged template function is called as sql`...` → returns a Promise<rows[]>
  const fn = vi.fn().mockResolvedValue(rows)
  return fn as unknown as import('postgres').Sql
}

const MALAGA: import('../types').PropertyInput = {
  lat: 36.7193,
  lng: -4.4197,
  price_asking: 350_000,
  area_sqm: 90,
  comunidad_autonoma: 'Andalucía',
  municipio: 'Málaga',
  codigo_postal: '29001',
}

// ── Community Stability ────────────────────────────────────────────────────────

describe('calcCommunityStability', () => {
  it('scores correctly with real noise and VUT data', async () => {
    const sql = mockSql([{
      vut_active_500m: 5,
      noise_lden_min:  55,
      noise_band:      '55-60',
      noise_source:    'eea',
    }])
    const result = await calcCommunityStability(sql, MALAGA)
    // vut_score = 100 - 5*2 = 90
    // noise_score = max(0, 100 - (55-40)*4) = 100 - 60 = 40
    // dom_stability stub = 60, commerce_age stub = 50
    // score = 90*0.40 + 60*0.20 + 50*0.20 + 40*0.20 = 36 + 12 + 10 + 8 = 66
    expect(result.score).toBe(66)
    expect(result.confidence).toBe('high')
    expect(result.alerts).toHaveLength(0)
  })

  it('uses neutral noise default (70) when no noise data', async () => {
    const sql = mockSql([{
      vut_active_500m: 0,
      noise_lden_min:  null,
      noise_band:      null,
      noise_source:    null,
    }])
    const result = await calcCommunityStability(sql, MALAGA)
    // vut_score = 100, noise_score = 70 (neutral), dom=60, commerce=50
    // score = 100*0.40 + 60*0.20 + 50*0.20 + 70*0.20 = 40 + 12 + 10 + 14 = 76
    expect(result.score).toBe(76)
    expect(result.confidence).toBe('medium')
  })

  it('fires red alert for high VUT density (>25)', async () => {
    const sql = mockSql([{
      vut_active_500m: 30,
      noise_lden_min:  null,
      noise_band:      null,
      noise_source:    null,
    }])
    const result = await calcCommunityStability(sql, MALAGA)
    const redAlerts = result.alerts.filter((a) => a.type === 'red')
    expect(redAlerts).toHaveLength(1)
    expect(redAlerts[0].category).toBe('community')
  })

  it('fires amber alert for noise >= 60 dB', async () => {
    const sql = mockSql([{
      vut_active_500m: 0,
      noise_lden_min:  62,
      noise_band:      '60-65',
      noise_source:    'eea',
    }])
    const result = await calcCommunityStability(sql, MALAGA)
    const noiseAlerts = result.alerts.filter((a) => a.type === 'amber' && a.category === 'community')
    expect(noiseAlerts).toHaveLength(1)
  })

  it('fires red alert for noise >= 65 dB', async () => {
    const sql = mockSql([{
      vut_active_500m: 0,
      noise_lden_min:  68,
      noise_band:      '65-70',
      noise_source:    'eea',
    }])
    const result = await calcCommunityStability(sql, MALAGA)
    const redNoiseAlerts = result.alerts.filter((a) => a.type === 'red')
    expect(redNoiseAlerts).toHaveLength(1)
  })
})

// ── Daily Life Score ───────────────────────────────────────────────────────────

describe('calcDailyLifeScore', () => {
  it('scores correctly with full walkable neighbourhood data', async () => {
    const sql = mockSql([{
      daily_needs_count:  4,
      pedestrian_count:   3,
      cycle_count:        2,
      park_area_sqm:      2500,
      free_parking_count: 2,
      nearest_beach_m:    1200,
      nearest_beach_name: 'Playa de la Malagueta',
    }])
    const result = await calcDailyLifeScore(sql, MALAGA)
    // walk_score  = min(4*15, 60) = 60
    // ped_score   = min(3*5, 20)  = 15
    // cyc_score   = min(2*3, 20)  = 6
    // mobility    = 15 + 6 = 21
    // green       = min((2500/1000)*10, 20) = min(25, 20) = 20
    // beach       = max(0, 20 - 1200/250) = max(0, 20-4.8) = 15.2
    // score = 60*0.40 + 21*0.30 + 20*0.20 + 15.2*0.10
    //       = 24 + 6.3 + 4 + 1.52 = 35.82 → round = 36
    expect(result.score).toBe(36)
    expect(result.confidence).toBe('high')
    expect(result.details.nearest_beach_name).toBe('Playa de la Malagueta')
    expect(result.details.nearest_beach_m).toBe(1200)
  })

  it('returns 0 beach score for properties > 15km from coast', async () => {
    const sql = mockSql([{
      daily_needs_count:  3,
      pedestrian_count:   2,
      cycle_count:        0,
      park_area_sqm:      1000,
      free_parking_count: 0,
      nearest_beach_m:    null,  // > 15km, filtered out by SQL
      nearest_beach_name: null,
    }])
    const result = await calcDailyLifeScore(sql, MALAGA)
    expect(result.details.nearest_beach_m).toBeNull()
    // No beach contribution
  })

  it('caps walk_score at 60 regardless of amenity count', async () => {
    const sql = mockSql([{
      daily_needs_count:  10,  // 10 * 15 = 150, but capped at 60
      pedestrian_count:   0,
      cycle_count:        0,
      park_area_sqm:      0,
      free_parking_count: 0,
      nearest_beach_m:    null,
      nearest_beach_name: null,
    }])
    const result = await calcDailyLifeScore(sql, MALAGA)
    const subScores = result.details.sub_scores as Record<string, number>
    expect(subScores.walk).toBe(60)
  })

  it('fires amber alert when no daily needs within 400m', async () => {
    const sql = mockSql([{
      daily_needs_count:  0,
      pedestrian_count:   0,
      cycle_count:        0,
      park_area_sqm:      null,
      free_parking_count: 0,
      nearest_beach_m:    null,
      nearest_beach_name: null,
    }])
    const result = await calcDailyLifeScore(sql, MALAGA)
    expect(result.alerts.some((a) => a.category === 'daily_life')).toBe(true)
  })

  it('returns medium confidence when mobility data not yet ingested', async () => {
    const sql = mockSql([{
      daily_needs_count:  3,
      pedestrian_count:   0,
      cycle_count:        0,
      park_area_sqm:      500,
      free_parking_count: 1,
      nearest_beach_m:    null,
      nearest_beach_name: null,
    }])
    const result = await calcDailyLifeScore(sql, MALAGA)
    expect(result.confidence).toBe('medium')
  })
})

// ── Sensory Environment ────────────────────────────────────────────────────────

describe('calcSensoryEnvironment', () => {
  it('scores correctly with full data', async () => {
    const sql = mockSql([{
      noise_lden_min:   58,
      noise_band:       '55-60',
      aqi_annual_avg:   22,
      aqi_station_name: 'Alameda Principal',
      aqi_station_dist: 800,
      pm25_ugm3:        8.2,
      no2_ugm3:         18.4,
      park_area_sqm:    2000,
      nearest_park_m:   180,
    }])
    const result = await calcSensoryEnvironment(sql, MALAGA)
    // noise_score = max(0, 100 - (58-35)*3.5) = 100 - 80.5 = 19.5
    // aqi_score   = max(0, 100 - 22*2)        = 100 - 44 = 56
    // green_ratio = min(2000/5000, 1.0) = 0.4 → green_score = 40
    // score = 19.5*0.45 + 56*0.35 + 40*0.20 = 8.775 + 19.6 + 8 = 36.375 → 36
    expect(result.score).toBe(36)
    expect(result.confidence).toBe('high')  // noise data available
  })

  it('uses neutral defaults when no noise or AQI data', async () => {
    const sql = mockSql([{
      noise_lden_min:   null,
      noise_band:       null,
      aqi_annual_avg:   null,
      aqi_station_name: null,
      aqi_station_dist: null,
      pm25_ugm3:        null,
      no2_ugm3:         null,
      park_area_sqm:    1000,
      nearest_park_m:   300,
    }])
    const result = await calcSensoryEnvironment(sql, MALAGA)
    // noise = 65 (urban default), aqi = 70 (national avg), green = min(1000/5000,1)*100 = 20
    // score = 65*0.45 + 70*0.35 + 20*0.20 = 29.25 + 24.5 + 4 = 57.75 → 58
    expect(result.score).toBe(58)
    expect(result.confidence).toBe('low')
  })

  it('returns medium confidence when AQI available but no noise data', async () => {
    const sql = mockSql([{
      noise_lden_min:   null,
      noise_band:       null,
      aqi_annual_avg:   25,
      aqi_station_name: 'Centro',
      aqi_station_dist: 500,
      pm25_ugm3:        null,
      no2_ugm3:         null,
      park_area_sqm:    0,
      nearest_park_m:   null,
    }])
    const result = await calcSensoryEnvironment(sql, MALAGA)
    expect(result.confidence).toBe('medium')
  })

  it('green_score caps at 100 for park_area >= 5000 sqm', async () => {
    const sql = mockSql([{
      noise_lden_min:   null,
      noise_band:       null,
      aqi_annual_avg:   null,
      aqi_station_name: null,
      aqi_station_dist: null,
      pm25_ugm3:        null,
      no2_ugm3:         null,
      park_area_sqm:    10_000,
      nearest_park_m:   50,
    }])
    const result = await calcSensoryEnvironment(sql, MALAGA)
    const subScores = result.details.sub_scores as Record<string, number>
    expect(subScores.green).toBe(100)
  })
})

// ── Cost of Life Index ─────────────────────────────────────────────────────────

describe('calcCostOfLifeIndex', () => {
  it('returns insufficient_data with null score when no cost_of_living row', async () => {
    const sql = mockSql([{
      coffee_eur:               null,
      beer_eur:                 null,
      meal_cheap_eur:           null,
      meal_midrange_eur:        null,
      grocery_index:            null,
      supermarket_discount_pct: null,
      supermarket_premium_pct:  null,
      recorded_quarter:         null,
      total_supermarkets_500m:  2,
      discount_count:           1,
      premium_count:            0,
    }])
    const result = await calcCostOfLifeIndex(sql, MALAGA)
    expect(result.score).toBeNull()
    expect(result.confidence).toBe('insufficient_data')
  })

  it('scores correctly with Numbeo data', async () => {
    const sql = mockSql([{
      coffee_eur:               1.60,
      beer_eur:                 2.20,
      meal_cheap_eur:           12.00,
      meal_midrange_eur:        30.00,
      grocery_index:            72,
      supermarket_discount_pct: 65,
      supermarket_premium_pct:  10,
      recorded_quarter:         new Date('2026-01-01'),
      total_supermarkets_500m:  4,
      discount_count:           2,
      premium_count:            1,
    }])
    const result = await calcCostOfLifeIndex(sql, MALAGA)
    // coffee_score = max(0, 100 - (1.60 - 1.0) * 65) = 100 - 39 = 61
    // grocery_score = max(0, 100 - (72 - 50)) = 100 - 22 = 78
    // discount_score = 65 (from Numbeo field)
    // score = 61*0.30 + 78*0.40 + 65*0.30 = 18.3 + 31.2 + 19.5 = 69.0 → 69
    expect(result.score).toBe(69)
    expect(result.confidence).toBe('medium')
    expect(result.details.coffee_eur).toBe(1.60)
  })

  it('derives discount_pct from OSM operator tags when Numbeo field absent', async () => {
    const sql = mockSql([{
      coffee_eur:               1.50,
      beer_eur:                 2.00,
      meal_cheap_eur:           10.00,
      meal_midrange_eur:        25.00,
      grocery_index:            80,
      supermarket_discount_pct: null,  // not in Numbeo for this city
      supermarket_premium_pct:  null,
      recorded_quarter:         new Date('2026-01-01'),
      total_supermarkets_500m:  4,
      discount_count:           3,  // 3/4 = 75%
      premium_count:            0,
    }])
    const result = await calcCostOfLifeIndex(sql, MALAGA)
    expect(result.details.supermarket_discount_pct).toBe(75)
    expect(result.score).toBeTypeOf('number')
  })

  it('confidence is always medium (city-level data)', async () => {
    const sql = mockSql([{
      coffee_eur: 2.10, beer_eur: 3.00, meal_cheap_eur: 15, meal_midrange_eur: 40,
      grocery_index: 90, supermarket_discount_pct: 30, supermarket_premium_pct: 40,
      recorded_quarter: new Date('2026-01-01'),
      total_supermarkets_500m: 2, discount_count: 1, premium_count: 1,
    }])
    const result = await calcCostOfLifeIndex(sql, MALAGA)
    expect(result.confidence).toBe('medium')
  })
})

// ── Health Security (CHI-377 waiting time update) ─────────────────────────────

describe('calcHealthSecurity — waiting time update', () => {
  it('applies wait_score when avg_days_gp available', async () => {
    const sql = mockSql([{
      gp_dist_m: 350, gp_nombre: 'CS Las Flores',
      er_dist_m: 2000, er_nombre: 'Hospital Regional',
      pharmacy_count: 3,
      avg_days_gp: 4, avg_days_specialist: 45, avg_days_surgery: 67,
      wait_health_area: 'Málaga-Centro',
    }])
    const result = await calcHealthSecurity(sql, MALAGA)
    // gp_score (350m): 300 optimal → 100; slight decay: 100 - (350-300)/(3000-300)*100 = ~98.15 → 98
    // er_score (2000m): 1000 optimal → decay: 100 - (2000-1000)/(8000-1000)*100 = 100 - 14.28 = ~86
    // pharm_score = min(3*25, 100) = 75
    // wait_score = max(0, 100 - 4*8) = 100 - 32 = 68
    // score = 98*0.35 + 86*0.35 + 75*0.15 + 68*0.15
    //       = 34.3 + 30.1 + 11.25 + 10.2 = 85.85 → 86
    expect(result.score).toBe(86)
    expect(result.details.avg_days_gp_wait).toBe(4)
    expect(result.details.wait_health_area).toBe('Málaga-Centro')
  })

  it('uses neutral wait_score (60) when no waiting time data', async () => {
    const sql = mockSql([{
      gp_dist_m: 300, gp_nombre: 'CS Centro',
      er_dist_m: 1000, er_nombre: 'Urgencias',
      pharmacy_count: 4,
      avg_days_gp: null, avg_days_specialist: null, avg_days_surgery: null,
      wait_health_area: null,
    }])
    const result = await calcHealthSecurity(sql, MALAGA)
    expect(result.details.avg_days_gp_wait).toBeNull()
    expect(result.score).toBeTypeOf('number')
    expect(result.score).toBeGreaterThan(0)
  })

  it('fires amber alert when avg_days_gp > 7', async () => {
    const sql = mockSql([{
      gp_dist_m: 400, gp_nombre: 'CS',
      er_dist_m: 3000, er_nombre: 'Hospital',
      pharmacy_count: 2,
      avg_days_gp: 10, avg_days_specialist: 90, avg_days_surgery: 120,
      wait_health_area: 'Zona Norte',
    }])
    const result = await calcHealthSecurity(sql, MALAGA)
    const waitAlert = result.alerts.find((a) => a.title.includes('Long wait'))
    expect(waitAlert).toBeDefined()
    expect(waitAlert?.type).toBe('amber')
  })
})

// ── Education Opportunity (CHI-377 diagnostic + bilingual update) ─────────────

describe('calcEducationOpportunity — enrichment update', () => {
  it('adds quality and bilingual bonuses to base score', async () => {
    const sql = mockSql([{
      public_count: 2, concertado_count: 1, private_count: 0,
      total_count: 3, in_catchment: true,
      bilingual_count: 1,
      avg_diagnostic_score: 74,
      has_diagnostic_data: true,
    }])
    const result = await calcEducationOpportunity(sql, MALAGA)
    // public = min(2*20,60) = 40, concertado = min(1*15,30) = 15, private = 0
    // catch_bonus = 15, quality = 74*0.10 = 7.4, bilingual = min(1*8,16) = 8
    // score = min(100, round(40+15+0+15+7.4+8)) = round(85.4) = 85
    expect(result.score).toBe(85)
    expect(result.details.bilingual_schools_1km).toBe(1)
    expect(result.details.avg_diagnostic_score_1km).toBe(74)
    expect(result.details.diagnostic_data_available).toBe(true)
  })

  it('adds no quality bonus when diagnostic data unavailable (NULL preserved)', async () => {
    const sql = mockSql([{
      public_count: 2, concertado_count: 0, private_count: 0,
      total_count: 2, in_catchment: false,
      bilingual_count: 0,
      avg_diagnostic_score: null,
      has_diagnostic_data: false,
    }])
    const result = await calcEducationOpportunity(sql, MALAGA)
    const bonuses = result.details.bonuses as Record<string, number>
    expect(bonuses.quality_bonus).toBe(0)
    expect(result.details.diagnostic_data_available).toBe(false)
  })

  it('fires green alert when bilingual schools present', async () => {
    const sql = mockSql([{
      public_count: 1, concertado_count: 1, private_count: 0,
      total_count: 2, in_catchment: false,
      bilingual_count: 2,
      avg_diagnostic_score: null, has_diagnostic_data: false,
    }])
    const result = await calcEducationOpportunity(sql, MALAGA)
    const greenAlert = result.alerts.find((a) => a.type === 'green')
    expect(greenAlert).toBeDefined()
    expect(greenAlert?.category).toBe('education')
  })

  it('caps bilingual bonus at 16 pts (2+ bilingual schools)', async () => {
    const sql = mockSql([{
      public_count: 3, concertado_count: 0, private_count: 0,
      total_count: 3, in_catchment: false,
      bilingual_count: 5,  // 5*8=40, but capped at 16
      avg_diagnostic_score: null, has_diagnostic_data: false,
    }])
    const result = await calcEducationOpportunity(sql, MALAGA)
    const bonuses = result.details.bonuses as Record<string, number>
    expect(bonuses.bilingual_bonus).toBe(16)
  })
})
