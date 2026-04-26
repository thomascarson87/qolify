/**
 * lib/preferences.ts
 *
 * Pure, frontend-only weighting logic for personalised TVI.
 *
 * The DB stores one TVI score per analysis (unweighted average of 5 tier-1
 * indicators — see supabase/functions/analyse-job/index.ts). This module
 * lets the user re-weight the four headline pillars (Financial, Lifestyle,
 * Risk, Community) and recompute a personalised TVI on the client without
 * re-running any analysis.
 *
 * Persistence: chosen profile + custom weights live in localStorage under
 * `qolify.prefs.v1`. No network calls.
 *
 * Pillar membership mirrors lib/indicators/registry.ts → PILLAR_GROUPS.
 * We duplicate it here (rather than import) so this module stays usable
 * from server components and edge runtimes that shouldn't pull the full
 * indicator metadata bundle.
 */
import type { Pillar, ProfilePreset } from './preferences-types';

export type { Pillar, ProfilePreset } from './preferences-types';

// ─── Pillar membership ────────────────────────────────────────────────────

/**
 * Which composite_indicator keys feed each pillar, and which are inverted
 * (lower raw score = better for the user, e.g. structural liability).
 */
export const PILLAR_DEFINITION: Record<Pillar, { keys: string[]; invert: string[] }> = {
  financial: {
    keys:   ['true_affordability', 'cost_of_life_index'],
    invert: [],
  },
  lifestyle: {
    keys:   ['health_security', 'education_opportunity', 'daily_life_score', 'sensory_environment', 'climate_solar', 'digital_viability'],
    invert: [],
  },
  risk: {
    keys:   ['structural_liability'],
    invert: ['structural_liability'],
  },
  community: {
    keys:   ['expat_liveability', 'community_stability'],
    invert: [],
  },
};

export const PILLAR_LABEL: Record<Pillar, string> = {
  financial: 'Financial',
  lifestyle: 'Lifestyle',
  risk:      'Risk',
  community: 'Community',
};

export const PILLAR_ORDER: Pillar[] = ['financial', 'lifestyle', 'risk', 'community'];

// ─── Weights ──────────────────────────────────────────────────────────────

export type Weights = Record<Pillar, number>;

/**
 * Preset profiles. Weights sum to 100 by convention but `computePersonalisedTVI`
 * normalises anyway, so a user dragging sliders to e.g. {40,40,40,40} still
 * yields a valid score.
 */
export const PROFILE_PRESETS: Record<ProfilePreset, { label: string; description: string; weights: Weights }> = {
  balanced: {
    label:       'Balanced',
    description: 'Equal weight across every pillar.',
    weights:     { financial: 25, lifestyle: 25, risk: 25, community: 25 },
  },
  first_time_buyer: {
    label:       'First-time Buyer',
    description: 'Cost matters most, structural risk close behind.',
    weights:     { financial: 40, lifestyle: 25, risk: 25, community: 10 },
  },
  remote_worker: {
    label:       'Remote Worker',
    description: 'Lifestyle and community drive day-to-day satisfaction.',
    weights:     { financial: 20, lifestyle: 35, risk: 15, community: 30 },
  },
  investor: {
    label:       'Investor',
    description: 'Affordability + structural risk dominate ROI.',
    weights:     { financial: 45, lifestyle: 15, risk: 30, community: 10 },
  },
  family: {
    label:       'Family',
    description: 'Schools, healthcare, and quiet neighbourhoods.',
    weights:     { financial: 20, lifestyle: 45, risk: 15, community: 20 },
  },
};

export const DEFAULT_PROFILE: ProfilePreset = 'balanced';

// ─── Persistence ──────────────────────────────────────────────────────────

const STORAGE_KEY = 'qolify.prefs.v1';

export interface StoredPreferences {
  profile:  ProfilePreset | 'custom';
  weights:  Weights;
}

/**
 * Read the user's saved preferences, or fall back to the Balanced preset.
 * Safe to call during SSR — returns the default when `localStorage` is
 * unavailable.
 */
export function loadPreferences(): StoredPreferences {
  if (typeof window === 'undefined') {
    return { profile: DEFAULT_PROFILE, weights: PROFILE_PRESETS[DEFAULT_PROFILE].weights };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { profile: DEFAULT_PROFILE, weights: PROFILE_PRESETS[DEFAULT_PROFILE].weights };
    const parsed = JSON.parse(raw) as Partial<StoredPreferences>;
    const profile = parsed.profile && (parsed.profile === 'custom' || parsed.profile in PROFILE_PRESETS)
      ? parsed.profile
      : DEFAULT_PROFILE;
    const weights = isValidWeights(parsed.weights)
      ? parsed.weights
      : PROFILE_PRESETS[DEFAULT_PROFILE].weights;
    return { profile, weights };
  } catch {
    return { profile: DEFAULT_PROFILE, weights: PROFILE_PRESETS[DEFAULT_PROFILE].weights };
  }
}

export function savePreferences(prefs: StoredPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch { /* quota / private mode — silent */ }
}

function isValidWeights(w: unknown): w is Weights {
  if (!w || typeof w !== 'object') return false;
  return PILLAR_ORDER.every(p => typeof (w as Record<string, unknown>)[p] === 'number');
}

// ─── Pillar score computation ─────────────────────────────────────────────

/**
 * For one pillar, average the per-indicator scores from a `pillars` map
 * (the projection returned by GET /api/library or extracted from
 * analysis_json.composite_indicators). Returns null if the pillar has no
 * data — keeps the personalised TVI from being skewed by missing pillars.
 */
export function computePillarScore(
  pillars: Record<string, number | null> | null | undefined,
  pillar: Pillar,
): number | null {
  if (!pillars) return null;
  const def = PILLAR_DEFINITION[pillar];
  const vals: number[] = [];
  for (const k of def.keys) {
    const raw = pillars[k];
    if (typeof raw !== 'number' || Number.isNaN(raw)) continue;
    vals.push(def.invert.includes(k) ? 100 - raw : raw);
  }
  if (vals.length === 0) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

/**
 * Compute all four pillar scores in one pass — convenient for the compare
 * table and library card.
 */
export function computeAllPillarScores(
  pillars: Record<string, number | null> | null | undefined,
): Record<Pillar, number | null> {
  return {
    financial: computePillarScore(pillars, 'financial'),
    lifestyle: computePillarScore(pillars, 'lifestyle'),
    risk:      computePillarScore(pillars, 'risk'),
    community: computePillarScore(pillars, 'community'),
  };
}

// ─── Personalised TVI ─────────────────────────────────────────────────────

/**
 * Weighted average of the four pillar scores. Pillars with no data are
 * dropped entirely AND their weight is removed from the denominator —
 * otherwise a property with missing community data would always score
 * lower than one with full data, which isn't what the user wants.
 *
 * Returns null only when no pillar has any data.
 */
export function computePersonalisedTVI(
  pillars: Record<string, number | null> | null | undefined,
  weights: Weights,
): number | null {
  if (!pillars) return null;
  let weightedSum = 0;
  let weightTotal = 0;
  for (const p of PILLAR_ORDER) {
    const score = computePillarScore(pillars, p);
    if (score == null) continue;
    const w = Math.max(0, weights[p]);
    if (w === 0) continue;
    weightedSum += score * w;
    weightTotal += w;
  }
  if (weightTotal === 0) return null;
  return Math.round(weightedSum / weightTotal);
}
