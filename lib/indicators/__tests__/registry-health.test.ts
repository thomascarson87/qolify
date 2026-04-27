/**
 * Unit tests for the health_security entry of INDICATOR_REGISTRY (CHI-391).
 *
 * The registry's summarise() and dataRows() drive the DNA Report's Health
 * Security card. These tests pin the surfaced text so refactors don't
 * silently regress what the user sees.
 */
import { describe, it, expect } from 'vitest'
import { INDICATOR_MAP } from '../registry'

const meta = INDICATOR_MAP['health_security']

describe('registry.health_security.summarise', () => {
  it('returns unavailable text when GP distance is missing', () => {
    expect(meta.summarise({ nearest_gp_m: null })).toMatch(/not available/i)
  })

  it('mentions GP distance, A&E, pharmacies and waiting time when all present', () => {
    const out = meta.summarise({
      nearest_gp_m:        350,
      nearest_er_m:        2100,
      pharmacy_count_500m: 3,
      avg_days_gp_wait:    5,
    })
    expect(out).toContain('350m')
    expect(out).toContain('A&E')
    expect(out).toContain('2.1km')
    expect(out).toContain('3 pharmacies')
    expect(out).toContain('5 days')
  })

  it('uses singular pharmacy when count is 1', () => {
    const out = meta.summarise({
      nearest_gp_m:        500,
      pharmacy_count_500m: 1,
    })
    expect(out).toContain('1 pharmacy')
    expect(out).not.toContain('pharmacies')
  })

  it('omits A&E and waiting time clauses when fields are null', () => {
    const out = meta.summarise({
      nearest_gp_m:        450,
      nearest_er_m:        null,
      pharmacy_count_500m: 0,
      avg_days_gp_wait:    null,
    })
    expect(out).not.toContain('A&E')
    expect(out).not.toContain('Regional GP wait')
  })

  it('grades access as Excellent under 300m and Moderate above 600m', () => {
    expect(meta.summarise({ nearest_gp_m: 250 })).toContain('Excellent')
    expect(meta.summarise({ nearest_gp_m: 800 })).toContain('Moderate')
  })
})

describe('registry.health_security.dataRows', () => {
  it('emits all 7 rows including surgery wait and wait region', () => {
    const rows = meta.dataRows({
      nearest_gp_m: 320, nearest_gp_nombre: 'CS Las Flores',
      nearest_er_m: 4200, nearest_er_nombre: 'Hospital Regional',
      pharmacy_count_500m: 4,
      avg_days_gp_wait: 5.2,
      avg_days_specialist_wait: 42.7,
      avg_days_surgery: 88,
      wait_health_area: 'Andalucía',
    })
    expect(rows).toHaveLength(7)
    expect(rows[0].value).toContain('CS Las Flores')
    expect(rows[1].value).toContain('Hospital Regional')
    expect(rows[3].value).toBe('~5 days')
    expect(rows[4].value).toBe('~43 days')
    expect(rows[5].value).toBe('~88 days')
    expect(rows[6].value).toBe('Andalucía')
  })

  it('shows em-dashes when numerical wait fields are null', () => {
    const rows = meta.dataRows({
      nearest_gp_m: 500, nearest_gp_nombre: null,
      nearest_er_m: null, nearest_er_nombre: null,
      pharmacy_count_500m: 0,
      avg_days_gp_wait: null,
      avg_days_specialist_wait: null,
      avg_days_surgery: null,
      wait_health_area: null,
    })
    expect(rows[3].value).toBe('—')
    expect(rows[4].value).toBe('—')
    expect(rows[5].value).toBe('—')
    expect(rows[6].value).toBe('—')
  })
})
