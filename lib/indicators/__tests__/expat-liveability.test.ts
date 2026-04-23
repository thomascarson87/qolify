/**
 * Unit tests for Expat Liveability (CHI-336 / CHI-405).
 *
 * Regression guard: postgres.js can return ROW_NUMBER() as BigInt or string
 * depending on runtime (Deno vs Node, config). Any strict `=== 1` comparison
 * against that value silently fails and the score becomes null.
 *
 * The CTE now casts to ::int AND the JS code uses Number(r.rn), so these tests
 * pass for every realistic driver return shape.
 */
import { describe, it, expect, vi } from 'vitest'
import { calcExpatLiveability } from '../expat-liveability'
import type { PropertyInput } from '../types'

function mockSql(rows: unknown[]) {
  const fn = vi.fn().mockResolvedValue(rows)
  return fn as unknown as import('postgres').Sql
}

const MALAGA: PropertyInput = {
  lat: 36.7193,
  lng: -4.4197,
  price_asking: 350_000,
  area_sqm: 90,
  comunidad_autonoma: 'Andalucía',
  municipio: 'Málaga',
  codigo_postal: '29001',
}

const AGP = { dist_m: 8661, nombre: 'Málaga–Costa del Sol', iata_code: 'AGP', weekly_flights: 1800 }
const GRX = { dist_m: 115_000, nombre: 'Federico García Lorca',   iata_code: 'GRX', weekly_flights:   60 }

describe('calcExpatLiveability — BigInt rn regression guard', () => {
  it('returns a non-null score when rn comes back as number', async () => {
    const sql = mockSql([{ ...AGP, rn: 1 }, { ...GRX, rn: 2 }])
    const r = await calcExpatLiveability(sql, MALAGA)
    expect(r.score).not.toBeNull()
    expect(r.details.nearest_airport_iata).toBe('AGP')
  })

  it('returns a non-null score when rn comes back as BigInt', async () => {
    const sql = mockSql([
      { ...AGP, rn: BigInt(1) as unknown as number },
      { ...GRX, rn: BigInt(2) as unknown as number },
    ])
    const r = await calcExpatLiveability(sql, MALAGA)
    expect(r.score).not.toBeNull()
    expect(r.details.nearest_airport_iata).toBe('AGP')
    expect(r.details.second_airport_iata).toBe('GRX')
  })

  it("returns a non-null score when rn comes back as string ('1')", async () => {
    const sql = mockSql([
      { ...AGP, rn: '1' as unknown as number },
      { ...GRX, rn: '2' as unknown as number },
    ])
    const r = await calcExpatLiveability(sql, MALAGA)
    expect(r.score).not.toBeNull()
    expect(r.details.nearest_airport_iata).toBe('AGP')
  })

  it('computes expected central-Málaga score (~87)', async () => {
    // distanceToScore(8661, 20_000, 150_000) = 100 → airportScore
    // flightBonus = min(1800/100, 20) = 20
    // score = min(100, round(100*0.80 + 20)) = 100
    const sql = mockSql([{ ...AGP, rn: 1 }, { ...GRX, rn: 2 }])
    const r = await calcExpatLiveability(sql, MALAGA)
    expect(r.score).toBeGreaterThanOrEqual(85)
    expect(r.confidence).toBe('high')
  })

  it('returns null/low-confidence when no airports returned', async () => {
    const sql = mockSql([])
    const r = await calcExpatLiveability(sql, MALAGA)
    expect(r.score).toBeNull()
    expect(r.confidence).toBe('low')
  })

  it('emits amber alert when nearest airport > 100km', async () => {
    const sql = mockSql([
      { dist_m: 150_000, nombre: 'Far', iata_code: 'XXX', weekly_flights: 100, rn: 1 },
    ])
    const r = await calcExpatLiveability(sql, MALAGA)
    expect(r.alerts.some(a => a.type === 'amber' && a.category === 'expat')).toBe(true)
  })
})
