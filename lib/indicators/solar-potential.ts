/**
 * lib/indicators/solar-potential.ts — CHI-380
 *
 * Calculates solar panel potential for a property or zone.
 * Pure TypeScript — no DB calls, no HTTP calls. All inputs are passed in.
 *
 * Two usage modes:
 *   1. Zone-level estimate — no Catastro data, uses assumed standard system.
 *      Input: { lat, lng, ghi_annual, pvgisResult }
 *      Output: scenario = 'zone_estimate', confidence = 'low'
 *
 *   2. Property-level — with Catastro building data.
 *      Input: all fields populated
 *      Output: scenario based on floor + type, confidence = 'high' or 'medium'
 *
 * Financial constants are passed in from eco_constants rather than hardcoded
 * so they update when the DB row is refreshed quarterly.
 */

import { ASPECT_TO_AZIMUTH, optimalTilt, type PVcalcResult } from '@/lib/pvgis';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SolarPotentialInput {
  lat:             number;
  lng:             number;

  /** GHI annual kWh/m² from solar_radiation table. Used for sanity checks. */
  ghi_annual:      number | null;

  /** Pre-fetched PVGIS PVcalc result. null = PVGIS timed out. */
  pvgisResult:     PVcalcResult | null;

  /** Financial constants from eco_constants */
  electricity_pvpc_kwh_eur:      number;   // e.g. 0.185
  solar_export_rate_eur:         number;   // e.g. 0.070
  solar_install_cost_per_kwp:    number;   // e.g. 1200

  // ── Property-level inputs (all optional — if absent → zone_estimate) ──
  footprint_area_m2?:   number | null;
  num_floors?:          number | null;
  floor?:               number | null;     // which floor the property is on
  property_type?:       string | null;     // 'chalet', 'piso', etc.
  aspect?:              string | null;     // 'S', 'SE', 'N', etc. from Catastro
  area_sqm?:            number | null;     // listing area as fallback
}

export interface SolarPotentialResult {
  // System
  installed_kwp:           number;
  panel_count:             number;
  usable_roof_area_m2:     number;
  roof_type:               'flat' | 'pitched' | 'unknown';
  aspect:                  string | null;
  optimal_tilt_deg:        number;
  optimal_azimuth_deg:     number;

  // Yield
  annual_kwh_yield:        number | null;   // null if PVGIS unavailable
  pvgis_monthly_kwh:       number[] | null; // null if PVGIS unavailable

  // Financial
  annual_kwh_self:         number;
  annual_kwh_export:       number;
  annual_saving_eur:       number;
  annual_export_eur:       number;
  annual_total_benefit_eur: number;
  system_cost_eur:         number;
  payback_years:           number | null;
  co2_offset_kg_annual:    number;

  // Classification
  scenario:   'house_full' | 'apartment_top_floor' | 'apartment_shared' | 'apartment_lower' | 'zone_estimate' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  confidence_reason: string;
  catastro_footprint_source: 'catastro_footprint' | 'listing_area_fallback' | 'zone_estimate';
}

// ---------------------------------------------------------------------------
// Scenario classification
// ---------------------------------------------------------------------------

export type Scenario = SolarPotentialResult['scenario'];

function classifyScenario(
  numFloors: number | null | undefined,
  floor: number | null | undefined,
  propertyType: string | null | undefined,
): Scenario {
  const t = (propertyType ?? '').toLowerCase();
  const isHouse = ['chalet', 'casa', 'unifamiliar', 'adosado', 'pareado', 'villa',
                   'house', 'detached', 'semi-detached'].some(k => t.includes(k));

  if (isHouse) return 'house_full';
  if (numFloors == null || floor == null) return 'zone_estimate';

  const isTop    = floor >= numFloors;
  const isNearTop = floor >= numFloors - 1;

  if (isTop)     return 'apartment_top_floor';
  if (isNearTop) return 'apartment_shared';
  return 'apartment_lower';
}

// ---------------------------------------------------------------------------
// Roof type detection
// ---------------------------------------------------------------------------

function detectRoofType(numFloors: number | null | undefined): 'flat' | 'pitched' | 'unknown' {
  if (numFloors == null) return 'unknown';
  // Spanish apartment blocks (3+ floors) are almost always flat roof
  if (numFloors >= 3) return 'flat';
  // Modern single-floor construction tends flat; older buildings more often pitched
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Core calculation
// ---------------------------------------------------------------------------

// Standard panel: 400Wp monocrystalline, ~2m² footprint → 0.2 kWp/m²
const KWP_PER_SQM   = 0.20;
const PANEL_KWP     = 0.40;
const SELF_RATE     = 0.70;   // 70% of generation self-consumed
const CO2_KG_PER_KWH = 0.25; // Spain grid emission factor (kg CO₂/kWh)

// Default system for zone_estimate (typical 10-panel 2-bed apartment)
const ZONE_ESTIMATE_KWP = 4.0;
const ZONE_ESTIMATE_ROOF_M2 = 20.0;

export function calcSolarPotential(input: SolarPotentialInput): SolarPotentialResult {
  const {
    lat,
    pvgisResult,
    electricity_pvpc_kwh_eur,
    solar_export_rate_eur,
    solar_install_cost_per_kwp,
    footprint_area_m2,
    num_floors,
    floor,
    property_type,
    aspect,
    area_sqm,
  } = input;

  // ── Scenario ──────────────────────────────────────────────────────────────
  const scenario = classifyScenario(num_floors, floor, property_type);
  const roofType = detectRoofType(num_floors);

  // ── Usable roof area ──────────────────────────────────────────────────────
  let usableRoofM2: number;
  let catastroSource: SolarPotentialResult['catastro_footprint_source'];

  if (scenario === 'zone_estimate') {
    // No property data — use standard 4kWp assumption
    usableRoofM2    = ZONE_ESTIMATE_ROOF_M2;
    catastroSource  = 'zone_estimate';
  } else if (footprint_area_m2 && footprint_area_m2 > 0) {
    const floors      = num_floors ?? 1;
    const roofPerFloor = footprint_area_m2 / floors;

    if (scenario === 'house_full') {
      usableRoofM2 = Math.round(roofPerFloor * 0.75 * 10) / 10;
    } else if (scenario === 'apartment_top_floor') {
      usableRoofM2 = Math.round(roofPerFloor * 0.75 * 10) / 10;
    } else {
      // apartment_shared / apartment_lower — share roof across estimated units
      const unitsEst = floors * 4;
      usableRoofM2 = Math.round((footprint_area_m2 * 0.75 / unitsEst) * 10) / 10;
    }
    catastroSource = 'catastro_footprint';
  } else {
    // Fall back to listing area
    const fallbackArea = area_sqm ?? 80;
    usableRoofM2    = Math.round(fallbackArea * 0.75 * 10) / 10;
    catastroSource  = 'listing_area_fallback';
  }

  // ── System sizing ─────────────────────────────────────────────────────────
  const installedKwp = scenario === 'zone_estimate'
    ? ZONE_ESTIMATE_KWP
    : Math.round(usableRoofM2 * KWP_PER_SQM * 100) / 100;

  const panelCount = Math.max(1, Math.round(installedKwp / PANEL_KWP));

  // ── Orientation ───────────────────────────────────────────────────────────
  // Flat roofs: always install south-facing (optimal)
  const effectiveAspect = roofType === 'flat' ? 'S' : (aspect ?? null);
  const azimuthDeg      = effectiveAspect ? (ASPECT_TO_AZIMUTH[effectiveAspect] ?? 0) : 0;
  const tiltDeg         = optimalTilt(lat);

  // ── Yield (from PVGIS PVcalc) ─────────────────────────────────────────────
  const annualKwh   = pvgisResult?.annual_kwh    ?? null;
  const monthlyKwh  = pvgisResult?.monthly_kwh   ?? null;

  // ── Fallback yield estimate using GHI when PVGIS unavailable ─────────────
  // Rough formula: annual_kwh ≈ installedKwp × (ghi × performance_ratio)
  // PR ≈ 0.75 for a typical roof system. Used ONLY for financial calc when
  // PVGIS has timed out so we don't show €0 savings.
  const fallbackKwh = input.ghi_annual
    ? Math.round(installedKwp * input.ghi_annual * 0.75)
    : null;

  const effectiveAnnualKwh = annualKwh ?? fallbackKwh ?? 0;

  // ── Financial calculation ─────────────────────────────────────────────────
  const kwh_self    = Math.round(effectiveAnnualKwh * SELF_RATE);
  const kwh_export  = effectiveAnnualKwh - kwh_self;
  const saving_eur  = Math.round(kwh_self   * electricity_pvpc_kwh_eur);
  const export_eur  = Math.round(kwh_export * solar_export_rate_eur);
  const total_eur   = saving_eur + export_eur;
  const system_cost = Math.round(installedKwp * solar_install_cost_per_kwp);
  const payback     = total_eur > 0 ? Math.round((system_cost / total_eur) * 10) / 10 : null;
  const co2_offset  = Math.round(effectiveAnnualKwh * CO2_KG_PER_KWH);

  // ── Confidence ────────────────────────────────────────────────────────────
  let confidence:       SolarPotentialResult['confidence'];
  let confidence_reason: string;

  if (scenario === 'zone_estimate') {
    confidence        = 'low';
    confidence_reason = 'Zone-level estimate — assumes a typical 10-panel south-facing installation. Add your address for a building-specific calculation.';
  } else if (catastroSource === 'catastro_footprint' && aspect != null) {
    confidence        = 'high';
    confidence_reason = 'Catastro building footprint and orientation confirmed.';
  } else if (catastroSource === 'catastro_footprint') {
    confidence        = 'medium';
    confidence_reason = 'Catastro footprint confirmed; south-facing assumed (orientation not yet available).';
  } else {
    confidence        = 'low';
    confidence_reason = 'Roof area estimated from listing size — Catastro footprint unavailable.';
  }

  return {
    installed_kwp:            installedKwp,
    panel_count:              panelCount,
    usable_roof_area_m2:      usableRoofM2,
    roof_type:                roofType,
    aspect:                   effectiveAspect,
    optimal_tilt_deg:         tiltDeg,
    optimal_azimuth_deg:      azimuthDeg,
    annual_kwh_yield:         annualKwh,       // null if PVGIS unavailable
    pvgis_monthly_kwh:        monthlyKwh,
    annual_kwh_self:          kwh_self,
    annual_kwh_export:        kwh_export,
    annual_saving_eur:        saving_eur,
    annual_export_eur:        export_eur,
    annual_total_benefit_eur: total_eur,
    system_cost_eur:          system_cost,
    payback_years:            payback,
    co2_offset_kg_annual:     co2_offset,
    scenario,
    confidence,
    confidence_reason,
    catastro_footprint_source: catastroSource,
  };
}
