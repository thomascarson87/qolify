/**
 * Tests for the property input merge logic used in the Edge Function (analyse-job).
 *
 * Bug: CHI-334 — `{ ...listing, ...propInput }` let null values from an empty manual
 * form override non-null values returned by Parse.bot. Fix: strip null/undefined from
 * propInput before merging so only explicitly-provided values take precedence.
 */
import { describe, it, expect } from 'vitest'

// ─── The merge helper extracted from the Edge Function ────────────────────────
// (Duplicated here so we can unit-test it in isolation without the Deno runtime.)

type Partial<T> = { [K in keyof T]?: T[K] | null }

interface PropertyInput {
  lat: number
  lng: number
  price_asking: number
  area_sqm: number
  comunidad_autonoma?: string | null
  municipio?: string | null
  codigo_postal?: string | null
  ref_catastral?: string | null
  build_year?: number | null
  epc_rating?: string | null
  bedrooms?: number | null
  floor?: number | null
}

function mergePropInput(
  listing: Partial<PropertyInput> | null,
  propInput: Partial<PropertyInput>,
): Partial<PropertyInput> {
  const cleanPropInput = Object.fromEntries(
    Object.entries(propInput).filter(([, v]) => v != null)
  ) as Partial<PropertyInput>
  return { ...(listing ?? {}), ...cleanPropInput }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('mergePropInput', () => {
  describe('Parse.bot provides coordinates, form is empty', () => {
    it('uses Parse.bot lat/lng when propInput lat/lng are null', () => {
      const listing = { lat: 36.52, lng: -4.88, price_asking: 420_000 }
      const propInput = { lat: null, lng: null, price_asking: null }

      const merged = mergePropInput(listing, propInput)

      expect(merged.lat).toBe(36.52)
      expect(merged.lng).toBe(-4.88)
      expect(merged.price_asking).toBe(420_000)
    })

    it('uses Parse.bot lat/lng when propInput lat/lng are undefined', () => {
      const listing = { lat: 36.52, lng: -4.88 }
      const propInput = {}

      const merged = mergePropInput(listing, propInput)

      expect(merged.lat).toBe(36.52)
      expect(merged.lng).toBe(-4.88)
    })
  })

  describe('Manual form overrides Parse.bot when provided', () => {
    it('manual non-null values override Parse.bot values', () => {
      const listing = { lat: 36.52, lng: -4.88, price_asking: 420_000, municipio: 'Málaga' }
      const propInput = { lat: 36.72, lng: -4.42, price_asking: 350_000 }

      const merged = mergePropInput(listing, propInput)

      expect(merged.lat).toBe(36.72)
      expect(merged.lng).toBe(-4.42)
      expect(merged.price_asking).toBe(350_000)
      // Non-overridden field retained from Parse.bot
      expect(merged.municipio).toBe('Málaga')
    })

    it('only the fields that were explicitly set override', () => {
      const listing  = { lat: 36.52, lng: -4.88, price_asking: 420_000, bedrooms: 3 }
      const propInput = { lat: 36.72, lng: -4.42 }  // price_asking not provided

      const merged = mergePropInput(listing, propInput)

      expect(merged.lat).toBe(36.72)
      expect(merged.lng).toBe(-4.42)
      expect(merged.price_asking).toBe(420_000)  // retained from Parse.bot
      expect(merged.bedrooms).toBe(3)
    })
  })

  describe('Both sources empty', () => {
    it('returns empty object when both listing and propInput are empty', () => {
      const merged = mergePropInput(null, {})
      expect(merged).toEqual({})
    })

    it('returns empty object when listing is null and propInput has only nulls', () => {
      const merged = mergePropInput(null, { lat: null, lng: null })
      expect(merged).toEqual({})
    })
  })

  describe('Edge cases', () => {
    it('treats 0 as a valid value (not stripped)', () => {
      // 0 is falsy but not null/undefined — a floor of 0 should be kept
      const listing  = { lat: 36.52, lng: -4.88, floor: 5 }
      const propInput = { floor: 0 }

      const merged = mergePropInput(listing, propInput)

      expect(merged.floor).toBe(0)
    })

    it('treats empty string as valid (not stripped)', () => {
      // Empty string is falsy but not null/undefined
      const listing  = { lat: 36.52, lng: -4.88, epc_rating: 'D' }
      const propInput = { epc_rating: '' }

      const merged = mergePropInput(listing, propInput)

      expect(merged.epc_rating).toBe('')
    })

    it('Parse.bot fields not in propInput are always retained', () => {
      const listing  = { lat: 36.52, lng: -4.88, ref_catastral: '1234ABC', codigo_postal: '29001' }
      const propInput = { lat: 36.72 }

      const merged = mergePropInput(listing, propInput)

      expect(merged.ref_catastral).toBe('1234ABC')
      expect(merged.codigo_postal).toBe('29001')
    })
  })
})
