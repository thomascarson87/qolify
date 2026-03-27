/**
 * Shared utility functions for indicator calculations.
 */

/**
 * Linear normalisation: maps value from [min, max] to [0, 100].
 * Values outside the range are clamped.
 */
export function normalise(value: number, min: number, max: number): number {
  if (max === min) return 0
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
}

/**
 * Distance-to-score: 100 at or below `optimal` metres, decays linearly to 0 at `max` metres.
 */
export function distanceToScore(
  distanceM: number | null | undefined,
  optimal: number,
  max: number,
): number {
  if (distanceM == null) return 0
  if (distanceM <= optimal) return 100
  if (distanceM >= max) return 0
  return Math.round(100 - ((distanceM - optimal) / (max - optimal)) * 100)
}

/** EPC rating → U-value (W/m²K) — from INDICATORS.md */
export const EPC_U_VALUES: Record<string, number> = {
  A: 0.3,
  B: 0.5,
  C: 0.7,
  D: 1.0,
  E: 1.4,
  F: 1.8,
  G: 2.3,
}

/** Building orientation → solar gain fraction — from INDICATORS.md */
export const SOLAR_GAIN_FACTORS: Record<string, number> = {
  S:  0.15,
  SE: 0.10,
  SW: 0.10,
  E:  0.05,
  W:  0.05,
  NE: 0.02,
  NW: 0.02,
  N:  0.00,
}

/**
 * Estimate monthly mortgage payment (annuity formula).
 * @param principal - loan amount in EUR
 * @param annualRate - annual interest rate as decimal (e.g. 0.045 for 4.5%)
 * @param years - loan term in years
 */
export function monthlyMortgage(
  principal: number,
  annualRate: number,
  years: number,
): number {
  const r = annualRate / 12
  const n = years * 12
  if (r === 0) return principal / n
  return (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)
}

/**
 * Round to nearest integer, or return null if undefined/null.
 */
export function roundOrNull(n: number | null | undefined): number | null {
  return n == null ? null : Math.round(n)
}
