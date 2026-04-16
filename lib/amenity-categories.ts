/**
 * lib/amenity-categories.ts
 *
 * Maps raw OSM category values (stored in amenities.category) to
 * human-readable display categories for the walking proximity summary.
 *
 * This is the canonical source of truth for category display logic.
 * The migration (009_amenity_display_category.sql) and ingest script
 * (ingest_amenities.py) must both reflect this mapping.
 *
 * Reference: CHI-350, DATA_VIS_GRAMMAR.md §Amenity Sub-Category Grammar
 *
 * Groups:
 *   'daily_necessity' — shown first: supermarkets, pharmacies, bakeries, banks
 *   'lifestyle'       — cafés, parks, gyms, restaurants
 *   'other'           — present in DB but not surfaced in proximity summary
 *
 * Note: health centres (GP, hospital) and transport stops (bus, metro)
 * live in their own tables and are NOT routed through this mapping.
 * Pharmacies in the amenities table are a fallback for gaps in health_centres.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type AmenityGroup = 'daily_necessity' | 'lifestyle' | 'other';

export interface AmenityDisplayConfig {
  /** Value stored in amenities.display_category */
  displayCategory: string;
  /** Human-readable label used in proximity summary rows */
  label: string;
  /**
   * Emoji icon for proximity summary rows.
   * NOT used on map pins — emoji rendering is inconsistent across platforms.
   * Map pins use SVG icons from the Lucide set.
   */
  emoji: string;
  /** Controls ordering in the proximity summary: daily_necessity before lifestyle */
  group: AmenityGroup;
}

// ─── Category map ─────────────────────────────────────────────────────────────

/**
 * Maps OSM category keys (amenities.category) → display config.
 * Keys must match values written by ingest_amenities.py QUERY_GROUPS.
 */
export const AMENITY_CATEGORY_MAP: Record<string, AmenityDisplayConfig> = {

  // ── Daily necessities ─────────────────────────────────────────────────────

  supermarket: {
    displayCategory: 'supermarket',
    label: 'Supermarket',
    emoji: '🛒',
    group: 'daily_necessity',
  },
  // 'convenience' and 'grocery' are alternative OSM tags for the same display row
  convenience: {
    displayCategory: 'supermarket',
    label: 'Supermarket',
    emoji: '🛒',
    group: 'daily_necessity',
  },
  grocery: {
    displayCategory: 'supermarket',
    label: 'Supermarket',
    emoji: '🛒',
    group: 'daily_necessity',
  },

  bakery: {
    displayCategory: 'bakery',
    label: 'Bakery',
    emoji: '🥐',
    group: 'daily_necessity',
  },
  pastry: {
    displayCategory: 'bakery',
    label: 'Bakery',
    emoji: '🥐',
    group: 'daily_necessity',
  },

  bank: {
    displayCategory: 'bank',
    label: 'Bank / ATM',
    emoji: '🏦',
    group: 'daily_necessity',
  },
  atm: {
    displayCategory: 'bank',
    label: 'Bank / ATM',
    emoji: '🏦',
    group: 'daily_necessity',
  },

  // Pharmacy: health_centres table is the primary source.
  // OSM amenities.pharmacy is a fallback where health_centres has gaps.
  pharmacy: {
    displayCategory: 'pharmacy',
    label: 'Pharmacy',
    emoji: '💊',
    group: 'daily_necessity',
  },

  // ── Lifestyle ─────────────────────────────────────────────────────────────

  cafe: {
    displayCategory: 'cafe',
    label: 'Café / bar',
    emoji: '☕',
    group: 'lifestyle',
  },
  coffee_shop: {
    displayCategory: 'cafe',
    label: 'Café / bar',
    emoji: '☕',
    group: 'lifestyle',
  },

  restaurant: {
    displayCategory: 'restaurant',
    label: 'Restaurant',
    emoji: '🍽️',
    group: 'lifestyle',
  },
  fast_food: {
    displayCategory: 'restaurant',
    label: 'Restaurant',
    emoji: '🍽️',
    group: 'lifestyle',
  },

  bar: {
    displayCategory: 'bar',
    label: 'Bar',
    emoji: '🍺',
    group: 'lifestyle',
  },
  pub: {
    displayCategory: 'bar',
    label: 'Bar',
    emoji: '🍺',
    group: 'lifestyle',
  },

  gym: {
    displayCategory: 'gym',
    label: 'Gym / sports',
    emoji: '🏃',
    group: 'lifestyle',
  },
  sports_centre: {
    displayCategory: 'gym',
    label: 'Gym / sports',
    emoji: '🏃',
    group: 'lifestyle',
  },
  // 'swimming' is the ingest_amenities.py key for [leisure=swimming_pool]
  swimming: {
    displayCategory: 'gym',
    label: 'Gym / sports',
    emoji: '🏃',
    group: 'lifestyle',
  },

  park: {
    displayCategory: 'park',
    label: 'Park',
    emoji: '🌳',
    group: 'lifestyle',
  },
  // 'garden' is stored separately by the ingest script but maps to the same display row
  garden: {
    displayCategory: 'park',
    label: 'Park',
    emoji: '🌳',
    group: 'lifestyle',
  },

  coworking: {
    displayCategory: 'coworking',
    label: 'Coworking',
    emoji: '💻',
    group: 'lifestyle',
  },

  // ── Other: stored in DB but not shown in proximity summary ─────────────────

  clinic: {
    displayCategory: 'other',
    label: 'Clinic',
    emoji: '🏥',
    group: 'other',
  },
  kindergarten: {
    displayCategory: 'other',
    label: 'Kindergarten',
    emoji: '🏫',
    group: 'other',
  },
  library: {
    displayCategory: 'other',
    label: 'Library',
    emoji: '📚',
    group: 'other',
  },
  beach: {
    displayCategory: 'other',
    label: 'Beach',
    emoji: '🏖️',
    group: 'other',
  },
  theatre: {
    displayCategory: 'other',
    label: 'Theatre',
    emoji: '🎭',
    group: 'other',
  },
  cinema: {
    displayCategory: 'other',
    label: 'Cinema',
    emoji: '🎬',
    group: 'other',
  },
};

// ─── Helper functions ─────────────────────────────────────────────────────────

/**
 * Returns the full display config for a given OSM category string.
 * Returns null for unmapped categories — these should not appear in the UI.
 * Logs a warning in non-production environments to help catch new OSM tags.
 */
export function getAmenityDisplay(osmCategory: string): AmenityDisplayConfig | null {
  const config = AMENITY_CATEGORY_MAP[osmCategory.toLowerCase()];
  if (!config) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[amenity-categories] Unmapped OSM category: "${osmCategory}"`);
    }
    return null;
  }
  return config;
}

/**
 * Returns the display_category string for a given OSM category.
 * This is the value stored in amenities.display_category.
 * Unmapped categories return 'other'.
 */
export function getDisplayCategory(osmCategory: string): string {
  return AMENITY_CATEGORY_MAP[osmCategory.toLowerCase()]?.displayCategory ?? 'other';
}

// ─── Proximity summary row definitions ───────────────────────────────────────

/**
 * Ordered list of rows to render in the walking proximity summary.
 * Each entry corresponds to one display_category value in the amenities table.
 *
 * Note: GP, hospital, pharmacy (health_centres), school (schools table),
 * and metro/bus (transport_stops) are added by the API alongside these rows
 * — they are not in the amenities table.
 *
 * Row order: daily necessities → lifestyle.
 * Zero-count rows must always be shown ("None within 5 min · nearest Xm")
 * — never hidden. See DATA_VIS_GRAMMAR.md §Walking Radius Display.
 */
export const PROXIMITY_SUMMARY_ROWS: Array<{
  displayCategory: string;
  label: string;
  emoji: string;
  group: AmenityGroup;
}> = [
  // Daily necessities
  { displayCategory: 'supermarket', label: 'Supermarket',  emoji: '🛒', group: 'daily_necessity' },
  { displayCategory: 'pharmacy',    label: 'Pharmacy',     emoji: '💊', group: 'daily_necessity' },
  { displayCategory: 'bakery',      label: 'Bakery',       emoji: '🥐', group: 'daily_necessity' },
  { displayCategory: 'bank',        label: 'Bank / ATM',   emoji: '🏦', group: 'daily_necessity' },
  // Lifestyle
  { displayCategory: 'cafe',        label: 'Café / bar',   emoji: '☕', group: 'lifestyle' },
  { displayCategory: 'restaurant',  label: 'Restaurant',   emoji: '🍽️', group: 'lifestyle' },
  { displayCategory: 'bar',         label: 'Bar',          emoji: '🍺', group: 'lifestyle' },
  { displayCategory: 'gym',         label: 'Gym / sports', emoji: '🏃', group: 'lifestyle' },
  { displayCategory: 'park',        label: 'Park',         emoji: '🌳', group: 'lifestyle' },
  { displayCategory: 'coworking',   label: 'Coworking',    emoji: '💻', group: 'lifestyle' },
];
