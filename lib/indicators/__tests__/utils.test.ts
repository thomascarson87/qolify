import { describe, it, expect } from 'vitest'
import { normalise, distanceToScore, monthlyMortgage, roundOrNull, EPC_U_VALUES } from '../utils'

// ─── normalise ────────────────────────────────────────────────────────────────

describe('normalise', () => {
  it('returns 0 when max === min (degenerate range)', () => {
    expect(normalise(50, 50, 50)).toBe(0)
  })

  it('returns 0 at the minimum', () => {
    expect(normalise(0, 0, 100)).toBe(0)
  })

  it('returns 100 at the maximum', () => {
    expect(normalise(100, 0, 100)).toBe(100)
  })

  it('returns 50 at midpoint', () => {
    expect(normalise(50, 0, 100)).toBe(50)
  })

  it('clamps to 0 below min', () => {
    expect(normalise(-10, 0, 100)).toBe(0)
  })

  it('clamps to 100 above max', () => {
    expect(normalise(150, 0, 100)).toBe(100)
  })

  it('handles non-zero min correctly', () => {
    expect(normalise(150, 100, 200)).toBe(50)
  })
})

// ─── distanceToScore ──────────────────────────────────────────────────────────

describe('distanceToScore', () => {
  it('returns 0 for null distance', () => {
    expect(distanceToScore(null, 500, 2000)).toBe(0)
  })

  it('returns 0 for undefined distance', () => {
    expect(distanceToScore(undefined, 500, 2000)).toBe(0)
  })

  it('returns 100 at exactly the optimal distance', () => {
    expect(distanceToScore(500, 500, 2000)).toBe(100)
  })

  it('returns 100 below the optimal distance', () => {
    expect(distanceToScore(0, 500, 2000)).toBe(100)
    expect(distanceToScore(200, 500, 2000)).toBe(100)
  })

  it('returns 0 at exactly the max distance', () => {
    expect(distanceToScore(2000, 500, 2000)).toBe(0)
  })

  it('returns 0 beyond the max distance', () => {
    expect(distanceToScore(5000, 500, 2000)).toBe(0)
  })

  it('decays linearly between optimal and max', () => {
    // halfway between 500 and 2000 = 1250 → score should be 50
    expect(distanceToScore(1250, 500, 2000)).toBe(50)
  })

  it('uses the correct scale for airport distances (20km optimal, 150km max)', () => {
    // 20km → 100
    expect(distanceToScore(20_000, 20_000, 150_000)).toBe(100)
    // 150km → 0
    expect(distanceToScore(150_000, 20_000, 150_000)).toBe(0)
    // 85km (midpoint) → 50
    expect(distanceToScore(85_000, 20_000, 150_000)).toBe(50)
  })
})

// ─── monthlyMortgage ──────────────────────────────────────────────────────────

describe('monthlyMortgage', () => {
  it('returns principal/n when rate is zero', () => {
    // 240,000 over 20 years at 0% = 1,000/mo
    expect(monthlyMortgage(240_000, 0, 20)).toBeCloseTo(1000, 2)
  })

  it('calculates correctly for a typical Spanish mortgage', () => {
    // 280,000 (80% of 350k) at 3.5% over 25 years
    // Known result via annuity formula: ~1,401/mo
    const payment = monthlyMortgage(280_000, 0.035, 25)
    expect(payment).toBeGreaterThan(1350)
    expect(payment).toBeLessThan(1450)
  })

  it('higher rate means higher payment', () => {
    const low  = monthlyMortgage(200_000, 0.03, 25)
    const high = monthlyMortgage(200_000, 0.06, 25)
    expect(high).toBeGreaterThan(low)
  })

  it('longer term means lower payment', () => {
    const short = monthlyMortgage(200_000, 0.04, 20)
    const long  = monthlyMortgage(200_000, 0.04, 30)
    expect(long).toBeLessThan(short)
  })
})

// ─── roundOrNull ─────────────────────────────────────────────────────────────

describe('roundOrNull', () => {
  it('returns null for null', () => {
    expect(roundOrNull(null)).toBeNull()
  })

  it('returns null for undefined', () => {
    expect(roundOrNull(undefined)).toBeNull()
  })

  it('rounds positive floats', () => {
    expect(roundOrNull(3.6)).toBe(4)
    expect(roundOrNull(3.4)).toBe(3)
  })

  it('rounds negative floats', () => {
    expect(roundOrNull(-1.5)).toBe(-1)
  })

  it('returns integer unchanged', () => {
    expect(roundOrNull(42)).toBe(42)
  })
})

// ─── EPC_U_VALUES ─────────────────────────────────────────────────────────────

describe('EPC_U_VALUES', () => {
  it('has all 7 ratings A–G', () => {
    const ratings = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
    for (const r of ratings) {
      expect(EPC_U_VALUES[r]).toBeDefined()
    }
  })

  it('U-values increase from A (best) to G (worst)', () => {
    const ratings = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
    for (let i = 1; i < ratings.length; i++) {
      expect(EPC_U_VALUES[ratings[i]]).toBeGreaterThan(EPC_U_VALUES[ratings[i - 1]])
    }
  })
})
