/**
 * Tests for normalizeCompositeIndicators — the client-side workaround that
 * handles double-encoded composite_indicators from old cache rows.
 *
 * Bug: CHI-334 — some analysis_cache rows stored composite_indicators as a
 * JSON string inside a JSONB column. The fix (sql.json()) prevents new rows
 * from being double-encoded, but old rows still exist. normalizeCompositeIndicators
 * parses these on the client side.
 */
import { describe, it, expect } from 'vitest'

// ─── Extracted from AnalyseClient.tsx for isolated testing ───────────────────

type IndicatorData = {
  score: number | null
  confidence: string
  details: Record<string, unknown>
  alerts: unknown[]
}

type IndicatorKey = string

function normalizeCompositeIndicators(
  raw: Partial<Record<IndicatorKey, IndicatorData>> | string | unknown
): Partial<Record<IndicatorKey, IndicatorData>> {
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return {} }
  }
  if (raw && typeof raw === 'object') {
    return raw as Partial<Record<IndicatorKey, IndicatorData>>
  }
  return {}
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const SAMPLE_INDICATORS = {
  true_affordability: {
    score: null,
    confidence: 'high',
    details: { monthly_mortgage_eur: null },
    alerts: [],
  },
  health_security: {
    score: 60,
    confidence: 'high',
    details: { nearest_gp_m: 131 },
    alerts: [{ type: 'red', title: 'Urgencias muy alejadas' }],
  },
}

describe('normalizeCompositeIndicators', () => {
  describe('new rows (object — no double encoding)', () => {
    it('returns the object as-is when composite_indicators is already an object', () => {
      const result = normalizeCompositeIndicators(SAMPLE_INDICATORS)
      expect(result).toEqual(SAMPLE_INDICATORS)
    })

    it('preserves null scores', () => {
      const result = normalizeCompositeIndicators(SAMPLE_INDICATORS)
      expect(result.true_affordability?.score).toBeNull()
    })

    it('preserves nested details', () => {
      const result = normalizeCompositeIndicators(SAMPLE_INDICATORS)
      expect(result.health_security?.details.nearest_gp_m).toBe(131)
    })
  })

  describe('old rows (double-encoded string)', () => {
    it('parses a JSON string to an object', () => {
      const encoded = JSON.stringify(SAMPLE_INDICATORS)
      const result  = normalizeCompositeIndicators(encoded)
      expect(result).toEqual(SAMPLE_INDICATORS)
    })

    it('returns {} for an invalid JSON string', () => {
      const result = normalizeCompositeIndicators('not-valid-json')
      expect(result).toEqual({})
    })

    it('returns {} for an empty string', () => {
      const result = normalizeCompositeIndicators('')
      expect(result).toEqual({})
    })
  })

  describe('null / undefined / unexpected types', () => {
    it('returns {} for null', () => {
      expect(normalizeCompositeIndicators(null)).toEqual({})
    })

    it('returns {} for undefined', () => {
      expect(normalizeCompositeIndicators(undefined)).toEqual({})
    })

    it('returns {} for a number', () => {
      expect(normalizeCompositeIndicators(42)).toEqual({})
    })
  })
})
