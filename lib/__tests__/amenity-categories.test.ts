/**
 * Unit tests for lib/amenity-categories.ts
 *
 * CHI-350 / CHI-351 — Amenity sub-category taxonomy
 *
 * Tests the pure mapping functions that underpin the walking proximity
 * summary. No DB or network calls — pure function tests only.
 */
import { describe, it, expect } from 'vitest'
import {
  AMENITY_CATEGORY_MAP,
  PROXIMITY_SUMMARY_ROWS,
  getDisplayCategory,
  getAmenityDisplay,
  type AmenityGroup,
} from '@/lib/amenity-categories'

// ─── getDisplayCategory ───────────────────────────────────────────────────────

describe('getDisplayCategory', () => {
  it('maps daily necessity categories correctly', () => {
    expect(getDisplayCategory('supermarket')).toBe('supermarket')
    expect(getDisplayCategory('convenience')).toBe('supermarket')
    expect(getDisplayCategory('grocery')).toBe('supermarket')
    expect(getDisplayCategory('bakery')).toBe('bakery')
    expect(getDisplayCategory('pastry')).toBe('bakery')
    expect(getDisplayCategory('bank')).toBe('bank')
    expect(getDisplayCategory('atm')).toBe('bank')
    expect(getDisplayCategory('pharmacy')).toBe('pharmacy')
  })

  it('maps lifestyle categories correctly', () => {
    expect(getDisplayCategory('cafe')).toBe('cafe')
    expect(getDisplayCategory('coffee_shop')).toBe('cafe')
    expect(getDisplayCategory('restaurant')).toBe('restaurant')
    expect(getDisplayCategory('fast_food')).toBe('restaurant')
    expect(getDisplayCategory('bar')).toBe('bar')
    expect(getDisplayCategory('pub')).toBe('bar')
    expect(getDisplayCategory('gym')).toBe('gym')
    expect(getDisplayCategory('sports_centre')).toBe('gym')
    expect(getDisplayCategory('swimming')).toBe('gym')
    expect(getDisplayCategory('park')).toBe('park')
    expect(getDisplayCategory('garden')).toBe('park')
    expect(getDisplayCategory('coworking')).toBe('coworking')
  })

  it('maps "other" categories to other', () => {
    expect(getDisplayCategory('library')).toBe('other')
    expect(getDisplayCategory('beach')).toBe('other')
    expect(getDisplayCategory('cinema')).toBe('other')
    expect(getDisplayCategory('theatre')).toBe('other')
    expect(getDisplayCategory('clinic')).toBe('other')
    expect(getDisplayCategory('kindergarten')).toBe('other')
  })

  it('returns other for completely unknown OSM categories', () => {
    expect(getDisplayCategory('unknown_tag')).toBe('other')
    expect(getDisplayCategory('')).toBe('other')
    expect(getDisplayCategory('SUPERMARKET')).toBe('supermarket') // case-insensitive
  })

  it('is case-insensitive', () => {
    expect(getDisplayCategory('CAFE')).toBe('cafe')
    expect(getDisplayCategory('Park')).toBe('park')
    expect(getDisplayCategory('SUPERMARKET')).toBe('supermarket')
  })
})

// ─── getAmenityDisplay ────────────────────────────────────────────────────────

describe('getAmenityDisplay', () => {
  it('returns full config for known categories', () => {
    const supermarket = getAmenityDisplay('supermarket')
    expect(supermarket).not.toBeNull()
    expect(supermarket?.displayCategory).toBe('supermarket')
    expect(supermarket?.label).toBe('Supermarket')
    expect(supermarket?.emoji).toBe('🛒')
    expect(supermarket?.group).toBe('daily_necessity')
  })

  it('returns correct group for daily necessities', () => {
    const categories = ['supermarket', 'convenience', 'bakery', 'bank', 'pharmacy']
    for (const cat of categories) {
      expect(getAmenityDisplay(cat)?.group).toBe('daily_necessity')
    }
  })

  it('returns correct group for lifestyle amenities', () => {
    const categories = ['cafe', 'restaurant', 'bar', 'gym', 'park', 'coworking']
    for (const cat of categories) {
      expect(getAmenityDisplay(cat)?.group, `${cat} should be lifestyle`).toBe('lifestyle')
    }
  })

  it('returns group=other for non-summary categories', () => {
    const categories = ['library', 'beach', 'cinema', 'theatre', 'clinic']
    for (const cat of categories) {
      expect(getAmenityDisplay(cat)?.group).toBe('other')
    }
  })

  it('returns null for unknown categories', () => {
    expect(getAmenityDisplay('unknown_osm_tag')).toBeNull()
    expect(getAmenityDisplay('')).toBeNull()
  })

  it('is case-insensitive', () => {
    expect(getAmenityDisplay('PARK')).not.toBeNull()
    expect(getAmenityDisplay('Supermarket')).not.toBeNull()
  })
})

// ─── AMENITY_CATEGORY_MAP integrity ──────────────────────────────────────────

describe('AMENITY_CATEGORY_MAP', () => {
  it('every entry has required fields', () => {
    for (const [key, config] of Object.entries(AMENITY_CATEGORY_MAP)) {
      expect(config.displayCategory, `${key}: missing displayCategory`).toBeTruthy()
      expect(config.label, `${key}: missing label`).toBeTruthy()
      expect(config.emoji, `${key}: missing emoji`).toBeTruthy()
      expect(['daily_necessity', 'lifestyle', 'other']).toContain(config.group)
    }
  })

  it('multiple OSM tags that share a display category all map to the same value', () => {
    // Consolidation groups: these OSM keys should map to the same display_category
    const groups: [string[], string][] = [
      [['supermarket', 'convenience', 'grocery'], 'supermarket'],
      [['bakery', 'pastry'],                       'bakery'],
      [['bank', 'atm'],                             'bank'],
      [['cafe', 'coffee_shop'],                     'cafe'],
      [['restaurant', 'fast_food'],                 'restaurant'],
      [['bar', 'pub'],                              'bar'],
      [['gym', 'sports_centre', 'swimming'],        'gym'],
      [['park', 'garden'],                          'park'],
    ]
    for (const [keys, expected] of groups) {
      for (const key of keys) {
        expect(getDisplayCategory(key), `${key} → ${expected}`).toBe(expected)
      }
    }
  })
})

// ─── PROXIMITY_SUMMARY_ROWS integrity ────────────────────────────────────────

describe('PROXIMITY_SUMMARY_ROWS', () => {
  it('contains exactly 10 rows', () => {
    expect(PROXIMITY_SUMMARY_ROWS).toHaveLength(10)
  })

  it('has no duplicate displayCategory values', () => {
    const cats = PROXIMITY_SUMMARY_ROWS.map(r => r.displayCategory)
    const unique = new Set(cats)
    expect(unique.size).toBe(cats.length)
  })

  it('daily_necessity rows come before lifestyle rows', () => {
    const groups = PROXIMITY_SUMMARY_ROWS.map(r => r.group)
    const firstLifestyle = groups.indexOf('lifestyle')
    const lastDailyNecessity = groups.lastIndexOf('daily_necessity')
    // All daily_necessity rows must appear before the first lifestyle row
    expect(lastDailyNecessity).toBeLessThan(firstLifestyle)
  })

  it('contains no other-group rows', () => {
    for (const row of PROXIMITY_SUMMARY_ROWS) {
      expect(row.group).not.toBe('other')
    }
  })

  it('every row has all required fields', () => {
    const validGroups: AmenityGroup[] = ['daily_necessity', 'lifestyle', 'other']
    for (const row of PROXIMITY_SUMMARY_ROWS) {
      expect(row.displayCategory).toBeTruthy()
      expect(row.label).toBeTruthy()
      expect(row.emoji).toBeTruthy()
      expect(validGroups).toContain(row.group)
    }
  })

  it('includes the key daily necessities', () => {
    const cats = PROXIMITY_SUMMARY_ROWS.map(r => r.displayCategory)
    expect(cats).toContain('supermarket')
    expect(cats).toContain('pharmacy')
    expect(cats).toContain('bakery')
    expect(cats).toContain('bank')
  })

  it('includes the key lifestyle amenities', () => {
    const cats = PROXIMITY_SUMMARY_ROWS.map(r => r.displayCategory)
    expect(cats).toContain('cafe')
    expect(cats).toContain('park')
    expect(cats).toContain('gym')
    expect(cats).toContain('restaurant')
  })
})
