/**
 * Supabase Edge Function: analyse-job
 *
 * The compute core of the async analysis pipeline (CHI-334).
 * Triggered fire-and-forget by POST /api/analyse after inserting an analysis_jobs row.
 *
 * Pipeline:
 *  1. Fetch listing via Parse.bot (15s timeout, fallback to property_input on failure)
 *  2. Catastro OVC lookup (10s timeout, graceful degradation on miss)
 *  3. Run 6 composite indicators (CTE-consolidated queries against PostGIS)
 *  4. UPSERT analysis_cache (composite_indicators as object — no double-encode)
 *  5. UPDATE analysis_jobs → complete
 *  6. INSERT property_price_history
 *
 * Deploy: supabase functions deploy analyse-job
 * Secrets: supabase secrets set PARSEBOT_API_KEY=xxx SUPABASE_SERVICE_ROLE_KEY=xxx DATABASE_URL=xxx
 *
 * Runtime: Deno (Supabase Edge Functions v2)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// @ts-ignore — npm: specifier works in Deno/Supabase Edge Functions
import postgres from 'npm:postgres'

// ─── Environment ──────────────────────────────────────────────────────────────

const APIFY_API_TOKEN         = Deno.env.get('APIFY_API_TOKEN')!
const SUPABASE_URL            = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const DATABASE_URL            = Deno.env.get('DATABASE_URL')!

// ─── Types ────────────────────────────────────────────────────────────────────

interface PropertyInput {
  lat: number
  lng: number
  price_asking: number
  area_sqm: number
  comunidad_autonoma?: string
  municipio?: string
  provincia?: string
  codigo_postal?: string
  ref_catastral?: string
  build_year?: number
  epc_rating?: string
  epc_potential?: string
  bedrooms?: number
  bathrooms?: number       // added: Apify returns this; stored in analysis_cache
  floor?: number
  seller_type?: string
  address?: string         // added: full street address from Apify ubication.title
  property_type?: string   // added: "flat", "house", etc. from Apify detailedType.typology
  condition?: string       // added: "good", "renew", etc. from Apify moreCharacteristics.status
  catastro_year_built?: number
  negotiation_gap_pct?: number
}

interface Alert {
  type: 'red' | 'amber' | 'green'
  category: string
  title: string
  description: string
}

interface IndicatorResult {
  score: number | null
  confidence: 'high' | 'medium' | 'low' | 'insufficient_data'
  details: Record<string, unknown>
  alerts: Alert[]
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function normalise(value: number, min: number, max: number): number {
  if (max === min) return 0
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
}

function distanceToScore(distanceM: number | null | undefined, optimal: number, max: number): number {
  if (distanceM == null) return 0
  if (distanceM <= optimal) return 100
  if (distanceM >= max) return 0
  return Math.round(100 - ((distanceM - optimal) / (max - optimal)) * 100)
}

function monthlyMortgage(principal: number, annualRate: number, years: number): number {
  const r = annualRate / 12
  const n = years * 12
  if (r === 0) return principal / n
  return (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)
}

function roundOrNull(n: number | null | undefined): number | null {
  return n == null ? null : Math.round(n)
}

async function fetchWithTimeout(url: string, options: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ms)
  try {
    const res = await fetch(url, { ...options, signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`)
    return res
  } finally {
    clearTimeout(timeout)
  }
}

function insufficientData(): IndicatorResult {
  return { score: null, confidence: 'insufficient_data', details: {}, alerts: [] }
}

// ─── Apify listing extraction ──────────────────────────────────────────────────
// Actor: dz_omar/idealista-scraper-api
// Accepts full Idealista property URLs, returns rich structured data.
// Cost: ~$0.006 per property (~$0.005 actor start + $0.0009 per result).
// Apify gives $5 free credit/month — covers ~800 lookups before any charges.

/**
 * Parse Apify's floor code to an integer for the SMALLINT DB column.
 * Apify returns strings: "1", "2" (parse to int), "bj" (ground=0), "ss" (basement=-1),
 * "en" (mezzanine, no clean integer → undefined).
 */
function parseFloor(raw: string | null | undefined): number | undefined {
  if (raw == null) return undefined
  const num = parseInt(raw, 10)
  if (!isNaN(num)) return num   // "1", "2", "3" → integer
  if (raw === 'bj') return 0    // planta baja = ground floor
  if (raw === 'ss') return -1   // sótano/subsótano = basement
  return undefined              // "en" (mezzanine) and other codes → null in DB
}

async function fetchListing(sourceUrl: string): Promise<Partial<PropertyInput> | null> {
  try {
    // Extract the property code from the URL.
    // Works for both English (/en/inmueble/...) and Spanish (/inmueble/...) paths.
    const match = sourceUrl.match(/\/inmueble\/(\d+)/)
    if (!match) {
      console.warn('[analyse-job] Could not extract property code from URL:', sourceUrl)
      return null
    }

    // Call Apify REST API synchronously — waits for run completion and returns dataset items.
    // The ~ in the actor ID is URL-encoded as %7E but the REST API also accepts ~.
    const res = await fetchWithTimeout(
      `https://api.apify.com/v2/acts/dz_omar~idealista-scraper-api/run-sync-get-dataset-items?token=${APIFY_API_TOKEN}&timeout=60&memory=256`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Property_urls: [{ url: sourceUrl }],
          desiredResults: 10,  // minimum accepted by actor; we only use first result
        }),
      },
      65_000,  // 65s fetch timeout — slightly above actor's own 60s timeout
    )

    const items: Record<string, unknown>[] = await res.json()
    const d = items?.[0]
    if (!d || d.status === 'error') {
      console.warn('[analyse-job] Apify returned no data for', sourceUrl, d?.error ?? '')
      return null
    }

    // Typed references to nested objects in the Apify response
    const more       = d.moreCharacteristics as Record<string, unknown> | undefined
    const ubic       = d.ubication           as Record<string, unknown> | undefined
    const dtype      = d.detailedType        as Record<string, unknown> | undefined
    const ci         = d.contactInfo         as Record<string, unknown> | undefined
    const energyCert = d.energyCertification as Record<string, unknown> | undefined
    const energyCons = energyCert?.energyConsumption as Record<string, unknown> | undefined
    const ciAddr     = ci?.address           as Record<string, unknown> | undefined

    return {
      lat:          typeof ubic?.latitude  === 'number' ? ubic.latitude  as number : undefined,
      lng:          typeof ubic?.longitude === 'number' ? ubic.longitude as number : undefined,
      price_asking: typeof d.price === 'number'         ? d.price        as number : undefined,
      // constructedArea is the built area; fall back to d.size (total listed area) if absent
      area_sqm:     typeof more?.constructedArea === 'number' ? more.constructedArea as number
                    : typeof d.size === 'number'              ? d.size              as number
                    : undefined,
      bedrooms:     typeof more?.roomNumber === 'number' ? more.roomNumber as number : undefined,
      bathrooms:    typeof more?.bathNumber === 'number' ? more.bathNumber as number : undefined,
      // EPC: try energyCertification.energyConsumption.type (current schema) first,
      // fall back to moreCharacteristics.energyCertificationType (older schema).
      // Apify returns lowercase — DB is CHAR(1), indicators call .toUpperCase()
      epc_rating:   typeof energyCons?.type === 'string'
                      ? (energyCons.type as string).toUpperCase()
                      : typeof more?.energyCertificationType === 'string'
                      ? (more.energyCertificationType as string).toUpperCase()
                      : undefined,
      // floor: prefer top-level d.floor; fall back to moreCharacteristics.floor
      floor:        parseFloor(
                      typeof d.floor === 'string' ? d.floor as string
                      : more?.floor               as string | undefined
                    ),
      seller_type:  typeof ci?.userType === 'string' ? ci.userType as string : undefined,
      // municipio: prefer d.municipality (direct field); fall back to administrativeAreaLevel2
      municipio:    typeof d.municipality === 'string'
                      ? d.municipality as string
                      : typeof ubic?.administrativeAreaLevel2 === 'string'
                      ? ubic.administrativeAreaLevel2 as string
                      : undefined,
      // codigo_postal: from contactInfo.address.postalCode — often present on Idealista listings
      codigo_postal: typeof ciAddr?.postalCode === 'string' ? ciAddr.postalCode as string : undefined,
      // Full street address e.g. "Avenida Doctor Marañon, 36"
      address:      typeof ubic?.title === 'string'     ? ubic.title     as string : undefined,
      // Property type e.g. "flat", "house", "penthouse"
      property_type: typeof dtype?.typology === 'string' ? dtype.typology as string : undefined,
      // Condition e.g. "good", "renew", "newDevelopment"
      condition:    typeof more?.status === 'string'    ? more.status    as string : undefined,
      // Fields Apify does not provide — left undefined so downstream steps fill them:
      //   ref_catastral  → not published on Idealista listings
      //   build_year     → Catastro OVC step fills this when ref_catastral is known
      //   codigo_postal  → PostGIS spatial join in reverse geocode step fills this
      //   comunidad_autonoma → Apify's administrativeAreaLevel1 is the province name, not the
      //                        comunidad — existing municipios reverse geocode fills it correctly
    }
  } catch (err) {
    console.warn('[analyse-job] Apify extraction failed (non-fatal):', err)
    return null
  }
}

// ─── Catastro OVC lookup ───────────────────────────────────────────────────────

async function fetchCatastro(
  refCatastral: string | null | undefined,
  lat: number,
  lng: number,
): Promise<{ build_year?: number; ref_catastral?: string } | null> {
  // Catastro OVC API: if we have a ref_catastral, fetch the building year directly.
  // Graceful degradation: return null on any failure.
  if (!refCatastral) return null

  try {
    const res = await fetchWithTimeout(
      `https://ovc.catastro.meh.es/OVCServWeb/OVCWcfCallejero/COVCCoordenadas.svc/json/Consulta_DNPRC?SRS=EPSG:4326&RC=${encodeURIComponent(refCatastral)}`,
      { method: 'GET' },
      10_000,
    )
    const data = await res.json()
    const building = data?.consulta_dnprcResult?.bico?.bi
    const yearBuilt = building?.debi?.anoc ? parseInt(building.debi.anoc, 10) : undefined

    return {
      ref_catastral: refCatastral,
      build_year:    yearBuilt && !isNaN(yearBuilt) ? yearBuilt : undefined,
    }
  } catch {
    return null
  }
}

// ─── PVGIS & Solar Potential (inlined from lib/pvgis.ts + lib/indicators/solar-potential.ts) ──
// Inlined so the function remains a single deployable file for the Supabase dashboard.
// Keep in sync with the lib/ counterparts when logic changes.

const PVGIS_BASE = 'https://re.jrc.ec.europa.eu/api/v5_2'
const PVGIS_TIMEOUT_MS = 10_000

/** PVGIS azimuth convention: 0=South, 90=West, -90=East, 180=North */
const ASPECT_TO_AZIMUTH: Record<string, number> = {
  S:   0, SE: -45, SW:  45,
  E: -90, W:   90,
  NE: -135, NW: 135, N: 180,
}

/** Optimal panel tilt for Spain: latitude − 10°, clamped to [20°, 40°] */
function optimalTilt(lat: number): number {
  return Math.max(20, Math.min(40, Math.round(lat - 10)))
}

interface PVcalcResult {
  annual_kwh:  number
  monthly_kwh: number[]
  tilt_deg:    number
  azimuth_deg: number
}

/**
 * Call PVGIS /PVcalc to get annual + monthly kWh yield for the given PV system.
 * Returns null on timeout or API error — callers degrade gracefully.
 */
async function callPvgisPvcalc(
  lat:          number,
  lng:          number,
  peakpowerKwp: number,
  aspectDeg     = 0,
  tiltDeg       = 30,
): Promise<PVcalcResult | null> {
  const url = new URL(`${PVGIS_BASE}/PVcalc`)
  url.searchParams.set('lat',           lat.toFixed(5))
  url.searchParams.set('lon',           lng.toFixed(5))
  url.searchParams.set('peakpower',     peakpowerKwp.toFixed(2))
  url.searchParams.set('loss',          '14')          // 14% system losses
  url.searchParams.set('aspect',        aspectDeg.toString())
  url.searchParams.set('angle',         tiltDeg.toString())
  url.searchParams.set('outputformat',  'json')
  url.searchParams.set('pvtechchoice',  'crystSi')     // monocrystalline silicon
  url.searchParams.set('mountingplace', 'building')

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PVGIS_TIMEOUT_MS)
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
      // No next: { revalidate } — not supported in Deno
    })
    clearTimeout(timer)

    if (!res.ok) {
      console.warn(`[pvgis] PVcalc HTTP ${res.status} lat=${lat} lon=${lng}`)
      return null
    }

    const data = await res.json() as {
      outputs: {
        totals:  { fixed: { E_y: number } }
        monthly: { fixed: Array<{ month: number; E_m: number }> }
      }
    }

    const annualKwh  = data?.outputs?.totals?.fixed?.E_y
    const monthlyArr = data?.outputs?.monthly?.fixed
    if (!annualKwh || !Array.isArray(monthlyArr) || monthlyArr.length < 12) return null

    const sorted = [...monthlyArr].sort((a, b) => a.month - b.month)
    return {
      annual_kwh:  Math.round(annualKwh),
      monthly_kwh: sorted.map(m => Math.round(m.E_m * 10) / 10),
      tilt_deg:    tiltDeg,
      azimuth_deg: aspectDeg,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[pvgis] PVcalc failed:', msg.includes('abort') ? 'timeout' : msg)
    return null
  }
}

// ── Solar Potential types ──────────────────────────────────────────────────────

interface SolarPotentialInput {
  lat:  number
  lng:  number
  ghi_annual:                 number | null
  pvgisResult:                PVcalcResult | null
  electricity_pvpc_kwh_eur:   number
  solar_export_rate_eur:      number
  solar_install_cost_per_kwp: number
  footprint_area_m2?:  number | null
  num_floors?:         number | null
  floor?:              number | null
  property_type?:      string | null
  aspect?:             string | null
  area_sqm?:           number | null
}

interface SolarPotentialResult {
  installed_kwp:            number
  panel_count:              number
  usable_roof_area_m2:      number
  roof_type:                'flat' | 'pitched' | 'unknown'
  aspect:                   string | null
  optimal_tilt_deg:         number
  optimal_azimuth_deg:      number
  annual_kwh_yield:         number | null
  pvgis_monthly_kwh:        number[] | null
  annual_kwh_self:          number
  annual_kwh_export:        number
  annual_saving_eur:        number
  annual_export_eur:        number
  annual_total_benefit_eur: number
  system_cost_eur:          number
  payback_years:            number | null
  co2_offset_kg_annual:     number
  scenario:   'house_full' | 'apartment_top_floor' | 'apartment_shared' | 'apartment_lower' | 'zone_estimate' | 'unknown'
  confidence: 'high' | 'medium' | 'low'
  confidence_reason:        string
  catastro_footprint_source: 'catastro_footprint' | 'listing_area_fallback' | 'zone_estimate'
}

// Standard 400Wp panel: ~2m² footprint → 0.2 kWp/m²
const KWP_PER_SQM    = 0.20
const PANEL_KWP      = 0.40
const SELF_RATE      = 0.70   // 70% of generation self-consumed
const CO2_KG_PER_KWH = 0.25  // Spain grid CO₂ factor
const ZONE_EST_KWP   = 4.0
const ZONE_EST_ROOF  = 20.0

function solarScenario(
  numFloors:    number | null | undefined,
  floor:        number | null | undefined,
  propertyType: string | null | undefined,
): SolarPotentialResult['scenario'] {
  const t = (propertyType ?? '').toLowerCase()
  const isHouse = ['chalet', 'casa', 'unifamiliar', 'adosado', 'pareado', 'villa',
                   'house', 'detached', 'semi-detached'].some(k => t.includes(k))
  if (isHouse) return 'house_full'
  if (numFloors == null || floor == null) return 'zone_estimate'
  if (floor >= numFloors)     return 'apartment_top_floor'
  if (floor >= numFloors - 1) return 'apartment_shared'
  return 'apartment_lower'
}

function calcSolarPotential(input: SolarPotentialInput): SolarPotentialResult {
  const {
    lat, pvgisResult,
    electricity_pvpc_kwh_eur, solar_export_rate_eur, solar_install_cost_per_kwp,
    footprint_area_m2, num_floors, floor, property_type, aspect, area_sqm,
  } = input

  const scenario = solarScenario(num_floors, floor, property_type)
  const roofType: SolarPotentialResult['roof_type'] =
    num_floors != null && num_floors >= 3 ? 'flat' : 'unknown'

  // ── Usable roof area ──────────────────────────────────────────────────────
  let usableRoofM2: number
  let catastroSource: SolarPotentialResult['catastro_footprint_source']

  if (scenario === 'zone_estimate') {
    usableRoofM2  = ZONE_EST_ROOF
    catastroSource = 'zone_estimate'
  } else if (footprint_area_m2 && footprint_area_m2 > 0) {
    const floors   = num_floors ?? 1
    const perFloor = footprint_area_m2 / floors
    if (scenario === 'house_full' || scenario === 'apartment_top_floor') {
      usableRoofM2 = Math.round(perFloor * 0.75 * 10) / 10
    } else {
      // shared / lower apartment — divide across estimated units
      const unitsEst = floors * 4
      usableRoofM2 = Math.round((footprint_area_m2 * 0.75 / unitsEst) * 10) / 10
    }
    catastroSource = 'catastro_footprint'
  } else {
    usableRoofM2  = Math.round((area_sqm ?? 80) * 0.75 * 10) / 10
    catastroSource = 'listing_area_fallback'
  }

  // ── System sizing ─────────────────────────────────────────────────────────
  const installedKwp = scenario === 'zone_estimate'
    ? ZONE_EST_KWP
    : Math.round(usableRoofM2 * KWP_PER_SQM * 100) / 100
  const panelCount = Math.max(1, Math.round(installedKwp / PANEL_KWP))

  // ── Orientation (flat roofs always south-facing) ──────────────────────────
  const effectiveAspect = roofType === 'flat' ? 'S' : (aspect ?? null)
  const azimuthDeg      = effectiveAspect ? (ASPECT_TO_AZIMUTH[effectiveAspect] ?? 0) : 0
  const tiltDeg         = optimalTilt(lat)

  // ── Yield ──────────────────────────────────────────────────────────────────
  const annualKwh   = pvgisResult?.annual_kwh  ?? null
  const monthlyKwh  = pvgisResult?.monthly_kwh ?? null
  // GHI fallback when PVGIS unavailable: kWh ≈ kWp × GHI × PR(0.75)
  const fallbackKwh = input.ghi_annual
    ? Math.round(installedKwp * input.ghi_annual * 0.75)
    : null
  const effKwh = annualKwh ?? fallbackKwh ?? 0

  // ── Financial ─────────────────────────────────────────────────────────────
  const kwhSelf   = Math.round(effKwh * SELF_RATE)
  const kwhExport = effKwh - kwhSelf
  const savingEur = Math.round(kwhSelf   * electricity_pvpc_kwh_eur)
  const exportEur = Math.round(kwhExport * solar_export_rate_eur)
  const totalEur  = savingEur + exportEur
  const costEur   = Math.round(installedKwp * solar_install_cost_per_kwp)
  const payback   = totalEur > 0 ? Math.round((costEur / totalEur) * 10) / 10 : null
  const co2       = Math.round(effKwh * CO2_KG_PER_KWH)

  // ── Confidence ────────────────────────────────────────────────────────────
  let confidence:       SolarPotentialResult['confidence']
  let confidence_reason: string
  if (scenario === 'zone_estimate') {
    confidence        = 'low'
    confidence_reason = 'Zone-level estimate — assumes a typical 10-panel south-facing installation.'
  } else if (catastroSource === 'catastro_footprint' && aspect != null) {
    confidence        = 'high'
    confidence_reason = 'Catastro building footprint and orientation confirmed.'
  } else if (catastroSource === 'catastro_footprint') {
    confidence        = 'medium'
    confidence_reason = 'Catastro footprint confirmed; south-facing assumed (orientation not yet available).'
  } else {
    confidence        = 'low'
    confidence_reason = 'Roof area estimated from listing size — Catastro footprint unavailable.'
  }

  return {
    installed_kwp:            installedKwp,
    panel_count:              panelCount,
    usable_roof_area_m2:      usableRoofM2,
    roof_type:                roofType,
    aspect:                   effectiveAspect,
    optimal_tilt_deg:         tiltDeg,
    optimal_azimuth_deg:      azimuthDeg,
    annual_kwh_yield:         annualKwh,
    pvgis_monthly_kwh:        monthlyKwh,
    annual_kwh_self:          kwhSelf,
    annual_kwh_export:        kwhExport,
    annual_saving_eur:        savingEur,
    annual_export_eur:        exportEur,
    annual_total_benefit_eur: totalEur,
    system_cost_eur:          costEur,
    payback_years:            payback,
    co2_offset_kg_annual:     co2,
    scenario,
    confidence,
    confidence_reason,
    catastro_footprint_source: catastroSource,
  }
}

// ─── Indicator engine ──────────────────────────────────────────────────────────
// All queries are CTE-consolidated (single round-trip per indicator).

async function calcTrueAffordability(
  sql: ReturnType<typeof postgres>,
  prop: PropertyInput,
  buyerAge?: number | null,
): Promise<IndicatorResult> {
  const alerts: Alert[] = []

  const [row] = await sql<{
    ecb_base_rate_pct: number; typical_bank_spread_pct: number
    gas_price_kwh_eur: number; electricity_pvpc_kwh_eur: number
    u_value_epc_a: number; u_value_epc_b: number; u_value_epc_c: number
    u_value_epc_d: number; u_value_epc_e: number; u_value_epc_f: number; u_value_epc_g: number
    solar_gain_s: number; solar_gain_se_sw: number; solar_gain_e_w: number
    solar_gain_ne_nw: number; solar_gain_n: number
    itp_rate: number | null
    ico_max_price: number | null; ico_max_age: number | null; ico_guarantee_pct: number | null
    hdd_annual: number | null; cdd_annual: number | null
    aspect: string | null
  }[]>`
    WITH
      constants AS (
        SELECT * FROM eco_constants ORDER BY valid_from DESC LIMIT 1
      ),
      itp AS (
        SELECT standard_rate_pct
        FROM itp_rates
        WHERE comunidad_autonoma = ${prop.comunidad_autonoma ?? ''}
        LIMIT 1
      ),
      ico AS (
        SELECT max_price_eur, max_age, guarantee_pct
        FROM ico_caps
        WHERE comunidad_autonoma = ${prop.comunidad_autonoma ?? ''}
        LIMIT 1
      ),
      climate AS (
        SELECT hdd_annual, cdd_annual
        FROM climate_data
        WHERE municipio_code = ${prop.codigo_postal ?? ''}
           OR municipio_name = ${prop.municipio ?? ''}
        LIMIT 1
      ),
      orientation AS (
        SELECT aspect
        FROM building_orientation
        WHERE ref_catastral = ${prop.ref_catastral ?? ''}
        LIMIT 1
      )
    SELECT
      c.ecb_base_rate_pct, c.typical_bank_spread_pct,
      c.gas_price_kwh_eur, c.electricity_pvpc_kwh_eur,
      c.u_value_epc_a, c.u_value_epc_b, c.u_value_epc_c,
      c.u_value_epc_d, c.u_value_epc_e, c.u_value_epc_f, c.u_value_epc_g,
      c.solar_gain_s, c.solar_gain_se_sw, c.solar_gain_e_w,
      c.solar_gain_ne_nw, c.solar_gain_n,
      itp.standard_rate_pct  AS itp_rate,
      ico.max_price_eur       AS ico_max_price,
      ico.max_age             AS ico_max_age,
      ico.guarantee_pct       AS ico_guarantee_pct,
      climate.hdd_annual,
      climate.cdd_annual,
      orientation.aspect
    FROM constants c
    LEFT JOIN itp        ON TRUE
    LEFT JOIN ico        ON TRUE
    LEFT JOIN climate    ON TRUE
    LEFT JOIN orientation ON TRUE
  `

  if (!row) return { ...insufficientData(), details: { error: 'eco_constants not seeded' } }

  // EPC U-value
  const epcUMap: Record<string, number> = {
    A: row.u_value_epc_a, B: row.u_value_epc_b, C: row.u_value_epc_c, D: row.u_value_epc_d,
    E: row.u_value_epc_e, F: row.u_value_epc_f, G: row.u_value_epc_g,
  }
  const uValue = (prop.epc_rating ? epcUMap[prop.epc_rating.toUpperCase()] : null) ?? row.u_value_epc_d

  // Solar gain
  const aspectUpper = row.aspect?.toUpperCase() ?? null
  const solarGain =
    aspectUpper === 'S'                       ? row.solar_gain_s     :
    aspectUpper === 'SE' || aspectUpper === 'SW' ? row.solar_gain_se_sw :
    aspectUpper === 'E'  || aspectUpper === 'W'  ? row.solar_gain_e_w   :
    aspectUpper === 'NE' || aspectUpper === 'NW' ? row.solar_gain_ne_nw :
    aspectUpper === 'N'                       ? row.solar_gain_n     :
    row.solar_gain_e_w  // neutral fallback

  const hdd = row.hdd_annual ?? 1500
  const cdd = row.cdd_annual ?? 500

  // ICO eligibility
  const icoEligible =
    row.ico_max_price != null &&
    prop.price_asking <= row.ico_max_price &&
    (buyerAge == null || row.ico_max_age == null || buyerAge <= row.ico_max_age)

  // Deposit & mortgage
  const depositPct = icoEligible ? 0.05 : 0.20
  const principal = prop.price_asking * (1 - depositPct)
  const annualRate = ((row.ecb_base_rate_pct ?? 3.5) + (row.typical_bank_spread_pct ?? 1.0)) / 100
  const mortgageMonthly = monthlyMortgage(principal, annualRate, 30)

  // Energy
  const heatingKwh = hdd * prop.area_sqm * uValue * 0.024 * (1 - solarGain)
  const heatingCostAnnual = heatingKwh * (row.gas_price_kwh_eur ?? 0.07)
  const coolingKwh = cdd * prop.area_sqm * uValue * 0.4 * 0.024
  const coolingCostAnnual = coolingKwh * (row.electricity_pvpc_kwh_eur ?? 0.15)
  const energyMonthly = (heatingCostAnnual + coolingCostAnnual) / 12

  // IBI + comunidad
  const ibiMonthly = (prop.price_asking * 0.60 * 0.004) / 12
  const buildYear = prop.build_year ?? prop.catastro_year_built ?? null
  const comunidadRatePerSqm = buildYear == null ? 5.0 : buildYear < 1970 ? 8.0 : buildYear < 1990 ? 5.0 : buildYear < 2010 ? 3.5 : 2.5
  const comunidadMonthly = (comunidadRatePerSqm * prop.area_sqm) / 12

  const totalMonthly = mortgageMonthly + energyMonthly + ibiMonthly + comunidadMonthly
  const rawScore = normalise(totalMonthly, 500, 6000)
  const score = Math.round(100 - rawScore)

  const costRatio = totalMonthly / 2000  // proxy income
  if (costRatio > 0.5) {
    alerts.push({ type: 'red', category: 'affordability', title: 'Coste excede el 50% de ingreso mediano', description: `El coste mensual estimado de €${Math.round(totalMonthly)} supera el 50% del ingreso mensual mediano.` })
  } else if (costRatio > 0.4) {
    alerts.push({ type: 'amber', category: 'affordability', title: 'Coste supera el 40% de ingreso mediano', description: `El coste mensual estimado de €${Math.round(totalMonthly)} supera el 40% del ingreso mensual mediano.` })
  }

  return {
    score,
    confidence: row.hdd_annual ? 'high' : 'medium',
    details: {
      monthly_total_eur:    roundOrNull(totalMonthly),
      monthly_mortgage_eur: roundOrNull(mortgageMonthly),
      monthly_energy_eur:   roundOrNull(energyMonthly),
      monthly_ibi_eur:      roundOrNull(ibiMonthly),
      monthly_comunidad_eur: roundOrNull(comunidadMonthly),
      itp_rate_pct:         row.itp_rate ?? 8.0,
      itp_total_eur:        roundOrNull(prop.price_asking * ((row.itp_rate ?? 8.0) / 100)),
      ico_eligible:         icoEligible,
      deposit_pct:          depositPct * 100,
      loan_rate_pct:        annualRate * 100,
      hdd_used:             hdd,
      cdd_used:             cdd,
      building_aspect:      row.aspect ?? null,
    },
    alerts,
  }
}

async function calcStructuralLiability(
  sql: ReturnType<typeof postgres>,
  prop: PropertyInput,
): Promise<IndicatorResult> {
  const alerts: Alert[] = []

  const [row] = await sql<{
    ite_status: string | null
    ite_inspection_date: string | null
    flood_risk_level: string | null
  }[]>`
    WITH
      ite AS (
        SELECT status, inspection_date
        FROM ite_status
        WHERE ref_catastral = ${prop.ref_catastral ?? ''}
           OR ST_DWithin(
                geom,
                ST_SetSRID(ST_MakePoint(${prop.lng}, ${prop.lat}), 4326)::GEOGRAPHY,
                30
              )
        ORDER BY inspection_date DESC NULLS LAST
        LIMIT 1
      ),
      flood AS (
        SELECT risk_level
        FROM flood_zones
        WHERE ST_Intersects(
          geom,
          ST_SetSRID(ST_MakePoint(${prop.lng}, ${prop.lat}), 4326)::GEOGRAPHY
        )
        ORDER BY
          CASE risk_level WHEN 'T10' THEN 0 WHEN 'T100' THEN 1 WHEN 'T500' THEN 2 ELSE 3 END
        LIMIT 1
      )
    SELECT
      ite.status           AS ite_status,
      ite.inspection_date  AS ite_inspection_date,
      flood.risk_level     AS flood_risk_level
    FROM (SELECT 1) dummy
    LEFT JOIN ite   ON TRUE
    LEFT JOIN flood ON TRUE
  `

  const ITE_RISK: Record<string, number> = { passed: 0, pending: 60, failed: 100, not_required: 15 }
  const EPC_RISK: Record<string, number> = { A: 0, B: 10, C: 20, D: 40, E: 65, F: 80, G: 100 }

  const buildYear = prop.build_year ?? prop.catastro_year_built ?? null
  const buildAge  = buildYear != null ? 2026 - buildYear : null
  const ageScore  = buildAge != null ? normalise(buildAge, 0, 80) : 50
  const iteScore  = row?.ite_status ? (ITE_RISK[row.ite_status] ?? 40) : 40
  const epcScore  = prop.epc_rating ? (EPC_RISK[prop.epc_rating.toUpperCase()] ?? 40) : 40

  let permitScore = 50
  if (row?.ite_inspection_date) {
    const yearsSince = 2026 - new Date(row.ite_inspection_date).getFullYear()
    permitScore = normalise(yearsSince, 0, 30)
  }

  const floodLevel = row?.flood_risk_level ?? null
  const floodPenalty = floodLevel === 'T10' ? 25 : floodLevel === 'T100' ? 15 : floodLevel === 'T500' ? 5 : 0

  const sli = Math.min(100, Math.round(ageScore * 0.30 + iteScore * 0.40 + epcScore * 0.20 + permitScore * 0.10 + floodPenalty))

  if (floodLevel === 'T10')  alerts.push({ type: 'red',   category: 'flood',    title: 'Zona de inundación de alto riesgo', description: 'Esta propiedad está en una zona con periodo de retorno de 10 años (T10). Riesgo de inundación muy alto.' })
  else if (floodLevel === 'T100') alerts.push({ type: 'amber', category: 'flood',    title: 'Zona inundable (T100)',            description: 'La propiedad está en una zona con periodo de retorno de 100 años.' })
  else if (floodLevel === 'T500') alerts.push({ type: 'amber', category: 'flood',    title: 'Zona inundable (T500)',            description: 'Zona de inundación de periodo de retorno de 500 años. Riesgo bajo.' })

  if (sli > 75) alerts.push({ type: 'red',   category: 'structural', title: 'Alto riesgo de derrama',     description: row?.ite_status === 'failed' ? 'El edificio tiene una ITE desfavorable.' : 'Edificio antiguo con alta probabilidad de gastos estructurales inesperados.' })
  else if (sli > 55) alerts.push({ type: 'amber', category: 'structural', title: 'Riesgo moderado de derrama', description: 'El edificio tiene factores de riesgo estructural. Recomendamos revisar el libro del edificio.' })

  return {
    score: sli,
    confidence: row?.ite_status ? 'high' : buildYear ? 'medium' : 'low',
    details: {
      build_year: buildYear, build_age: buildAge,
      ite_status: row?.ite_status ?? null, ite_inspection_date: row?.ite_inspection_date ?? null,
      epc_risk: prop.epc_rating ?? null, flood_risk_zone: floodLevel,
      est_liability_band: sli < 25 ? '0' : sli < 50 ? '2k-5k' : sli < 75 ? '5k-15k' : '15k+',
    },
    alerts,
  }
}

async function calcDigitalViability(
  sql: ReturnType<typeof postgres>,
  prop: PropertyInput,
): Promise<IndicatorResult> {
  const alerts: Alert[] = []

  const [row] = await sql<{
    coverage_type: string | null
    max_speed_mbps: number | null
    coworking_count: number
  }[]>`
    WITH
      fibre AS (
        SELECT coverage_type, max_speed_mbps
        FROM fibre_coverage
        WHERE ST_DWithin(
          geom,
          ST_SetSRID(ST_MakePoint(${prop.lng}, ${prop.lat}), 4326)::GEOGRAPHY,
          100
        )
        ORDER BY CASE coverage_type WHEN 'FTTP' THEN 0 WHEN 'HFC' THEN 1 WHEN 'FTTC' THEN 2 ELSE 3 END
        LIMIT 1
      ),
      cowork AS (
        SELECT COUNT(*)::int AS count
        FROM amenities
        WHERE category = 'coworking'
          AND ST_DWithin(
            geom,
            ST_SetSRID(ST_MakePoint(${prop.lng}, ${prop.lat}), 4326)::GEOGRAPHY,
            2000
          )
      )
    SELECT
      fibre.coverage_type,
      fibre.max_speed_mbps,
      cowork.count AS coworking_count
    FROM (SELECT 1) dummy
    LEFT JOIN fibre  ON TRUE
    CROSS JOIN cowork
  `

  const FIBRE_SCORE: Record<string, number> = { FTTP: 100, FTTC: 60, HFC: 45, none: 0 }
  const fibreType = row?.coverage_type ?? null
  const fibreScore = fibreType ? (FIBRE_SCORE[fibreType] ?? 0) : 0
  const coworkBonus = Math.min((row?.coworking_count ?? 0) * 8, 20)
  const score = Math.min(100, Math.round(fibreScore + coworkBonus))

  if (!fibreType || fibreType === 'none') {
    alerts.push({ type: 'red',   category: 'connectivity', title: 'Sin cobertura de fibra',  description: 'Esta propiedad no tiene cobertura de fibra óptica registrada.' })
  } else if (fibreType === 'FTTC' || fibreType === 'HFC') {
    alerts.push({ type: 'amber', category: 'connectivity', title: 'Fibra parcial',            description: `La cobertura disponible es ${fibreType}, no fibra directa al hogar (FTTP).` })
  }

  return {
    score: fibreType != null ? score : null,
    confidence: fibreType != null ? 'high' : 'low',
    details: { fibre_type: fibreType, max_speed_mbps: row?.max_speed_mbps ?? null, coworking_count_2km: row?.coworking_count ?? 0 },
    alerts,
  }
}

async function calcHealthSecurity(
  sql: ReturnType<typeof postgres>,
  prop: PropertyInput,
): Promise<IndicatorResult> {
  const alerts: Alert[] = []

  const [row] = await sql<{
    gp_dist_m: number | null; gp_nombre: string | null
    er_dist_m: number | null; er_nombre: string | null
    pharmacy_count: number
  }[]>`
    WITH
      gp AS (
        SELECT
          ST_Distance(geom, ST_SetSRID(ST_MakePoint(${prop.lng}, ${prop.lat}), 4326)::GEOGRAPHY) AS dist_m,
          nombre
        FROM health_centres
        WHERE tipo = 'centro_salud'
        ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${prop.lng}, ${prop.lat}), 4326)::GEOGRAPHY
        LIMIT 1
      ),
      er AS (
        SELECT
          ST_Distance(geom, ST_SetSRID(ST_MakePoint(${prop.lng}, ${prop.lat}), 4326)::GEOGRAPHY) AS dist_m,
          nombre
        FROM health_centres
        WHERE is_24h = TRUE
        ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${prop.lng}, ${prop.lat}), 4326)::GEOGRAPHY
        LIMIT 1
      ),
      pharm AS (
        SELECT COUNT(*)::int AS count
        FROM amenities
        WHERE category = 'pharmacy'
          AND ST_DWithin(
            geom,
            ST_SetSRID(ST_MakePoint(${prop.lng}, ${prop.lat}), 4326)::GEOGRAPHY,
            500
          )
      )
    SELECT
      gp.dist_m   AS gp_dist_m,  gp.nombre   AS gp_nombre,
      er.dist_m   AS er_dist_m,  er.nombre   AS er_nombre,
      pharm.count AS pharmacy_count
    FROM (SELECT 1) dummy
    LEFT JOIN gp    ON TRUE
    LEFT JOIN er    ON TRUE
    CROSS JOIN pharm
  `

  const gpDistM = row?.gp_dist_m ? Math.round(row.gp_dist_m) : null
  const erDistM = row?.er_dist_m ? Math.round(row.er_dist_m) : null

  const gpScore    = distanceToScore(gpDistM, 300, 3000)
  const erScore    = distanceToScore(erDistM, 1000, 8000)
  const pharmScore = Math.min((row?.pharmacy_count ?? 0) * 25, 100)
  const score      = Math.round(gpScore * 0.40 + erScore * 0.40 + pharmScore * 0.20)

  if (gpDistM != null && gpDistM > 3000) alerts.push({ type: 'amber', category: 'health', title: 'Centro de salud alejado',  description: `El centro de salud más cercano está a ${(gpDistM / 1000).toFixed(1)} km.` })
  if (erDistM != null && erDistM > 8000) alerts.push({ type: 'red',   category: 'health', title: 'Urgencias muy alejadas', description: `Las urgencias 24h más cercanas están a ${(erDistM / 1000).toFixed(1)} km.` })

  const hasData = row?.gp_dist_m != null || row?.er_dist_m != null
  return {
    score: hasData ? score : null,
    confidence: hasData ? 'high' : 'low',
    details: {
      nearest_gp_m: gpDistM, nearest_gp_nombre: row?.gp_nombre ?? null,
      nearest_er_m: erDistM, nearest_er_nombre: row?.er_nombre ?? null,
      pharmacy_count_500m: row?.pharmacy_count ?? 0,
    },
    alerts,
  }
}

async function calcEducationOpportunity(
  sql: ReturnType<typeof postgres>,
  prop: PropertyInput,
): Promise<IndicatorResult> {
  const alerts: Alert[] = []

  const [row] = await sql<{
    public_count: number; concertado_count: number; private_count: number; total_count: number
    in_catchment: boolean
  }[]>`
    WITH
      schools_agg AS (
        SELECT
          COALESCE(SUM(CASE WHEN tipo = 'publico'     THEN 1 ELSE 0 END), 0)::int AS public_count,
          COALESCE(SUM(CASE WHEN tipo = 'concertado'  THEN 1 ELSE 0 END), 0)::int AS concertado_count,
          COALESCE(SUM(CASE WHEN tipo = 'privado'     THEN 1 ELSE 0 END), 0)::int AS private_count,
          COUNT(*)::int AS total_count
        FROM schools
        WHERE ST_DWithin(
          geom,
          ST_SetSRID(ST_MakePoint(${prop.lng}, ${prop.lat}), 4326)::GEOGRAPHY,
          1000
        )
      ),
      catchment AS (
        SELECT EXISTS (
          SELECT 1 FROM school_catchments
          WHERE ST_Intersects(
            geom,
            ST_SetSRID(ST_MakePoint(${prop.lng}, ${prop.lat}), 4326)::GEOGRAPHY
          )
        ) AS in_catchment
      )
    SELECT s.*, c.in_catchment
    FROM schools_agg s
    CROSS JOIN catchment c
  `

  const totalSchools  = row?.total_count ?? 0
  const inCatchment   = row?.in_catchment ?? false
  const publicScore   = Math.min((row?.public_count ?? 0) * 20, 60)
  const concertScore  = Math.min((row?.concertado_count ?? 0) * 15, 30)
  const privateScore  = Math.min((row?.private_count ?? 0) * 10, 20)
  const catchBonus    = inCatchment ? 15 : 0
  const score         = Math.min(100, Math.round(publicScore + concertScore + privateScore + catchBonus))

  if (totalSchools === 0) alerts.push({ type: 'amber', category: 'education', title: 'Sin colegios en 1km', description: 'No se han encontrado centros educativos en un radio de 1 km.' })

  return {
    score: totalSchools > 0 ? score : null,
    confidence: inCatchment ? 'high' : totalSchools > 0 ? 'medium' : 'low',
    details: {
      school_count_1km: totalSchools,
      in_catchment: inCatchment,
      breakdown: { public: row?.public_count ?? 0, concertado: row?.concertado_count ?? 0, private: row?.private_count ?? 0 },
    },
    alerts,
  }
}

async function calcExpatLiveability(
  sql: ReturnType<typeof postgres>,
  prop: PropertyInput,
): Promise<IndicatorResult> {
  const alerts: Alert[] = []

  // CHI-405: cast ROW_NUMBER() (BIGINT) to INT in SQL — without this, postgres
  // returns a BigInt/string that fails strict equality in the Number(r.rn) === 1
  // comparison below, and the function always returns score: null.
  const rows = await sql<{
    dist_m: number; nombre: string; iata_code: string; weekly_flights: number; rn: number
  }[]>`
    WITH ranked AS (
      SELECT
        ST_Distance(geom, ST_SetSRID(ST_MakePoint(${prop.lng}, ${prop.lat}), 4326)::GEOGRAPHY) AS dist_m,
        nombre, iata_code, weekly_flights,
        ROW_NUMBER() OVER (ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${prop.lng}, ${prop.lat}), 4326)::GEOGRAPHY)::int AS rn
      FROM airports
    )
    SELECT dist_m, nombre, iata_code, weekly_flights, rn
    FROM ranked
    WHERE rn <= 2
  `

  const nearest  = rows.find((r) => Number(r.rn) === 1) ?? null
  const second   = rows.find((r) => Number(r.rn) === 2) ?? null
  const distM    = nearest?.dist_m ? Math.round(nearest.dist_m) : null
  const distKm   = distM != null ? distM / 1000 : null

  const airportScore = distanceToScore(distM, 20_000, 150_000)
  const flightBonus  = nearest ? Math.min(nearest.weekly_flights / 100, 20) : 0
  const score        = Math.min(100, Math.round(airportScore * 0.80 + flightBonus))

  if (distKm != null && distKm > 100) alerts.push({ type: 'amber', category: 'expat', title: 'Aeropuerto alejado', description: `El aeropuerto más cercano (${nearest?.iata_code}) está a ${Math.round(distKm)} km.` })

  return {
    score: nearest ? score : null,
    confidence: nearest ? 'high' : 'low',
    details: {
      nearest_airport_km:             distKm != null ? Math.round(distKm) : null,
      nearest_airport_iata:           nearest?.iata_code ?? null,
      nearest_airport_nombre:         nearest?.nombre ?? null,
      nearest_airport_weekly_flights: nearest?.weekly_flights ?? null,
      second_airport_iata:            second?.iata_code ?? null,
      second_airport_km:              second?.dist_m ? Math.round(second.dist_m / 1000) : null,
    },
    alerts,
  }
}

async function runAllIndicators(
  db: ReturnType<typeof postgres>,
  prop: PropertyInput,
  buyerAge?: number | null,
) {
  const [
    trueAffordability,
    structuralLiability,
    digitalViability,
    healthSecurity,
    educationOpportunity,
    expatLiveability,
  ] = await Promise.all([
    calcTrueAffordability(db, prop, buyerAge),
    calcStructuralLiability(db, prop),
    calcDigitalViability(db, prop),
    calcHealthSecurity(db, prop),
    calcEducationOpportunity(db, prop),
    calcExpatLiveability(db, prop),
  ])

  return {
    true_affordability:    trueAffordability,
    structural_liability:  structuralLiability,
    digital_viability:     digitalViability,
    health_security:       healthSecurity,
    education_opportunity: educationOpportunity,
    neighbourhood_transition: { ...insufficientData(), details: { nti_signal: null } },
    community_stability:      insufficientData(),
    climate_solar: {
      ...insufficientData(),
      details: { sunshine_hours_annual: null, hdd_annual: null, cdd_annual: null, building_aspect: null, damp_risk_index: null },
    },
    infrastructure_arbitrage: insufficientData(),
    motivated_seller:         insufficientData(),
    rental_trap:              insufficientData(),
    expat_liveability:        expatLiveability,
  }
}

/**
 * Compute solar potential for a property after Catastro lookup.
 *
 * Pipeline:
 *   1. Read financial constants from eco_constants
 *   2. Read GHI annual from solar_radiation (nearest point within 5km)
 *   3. Read building orientation + Catastro footprint/floors from building_orientation
 *   4. Size the PV system (first-pass calc, no PVGIS yet)
 *   5. Call PVGIS PVcalc API with actual system size
 *   6. Final calcSolarPotential with PVGIS yield
 *
 * Non-fatal: returns null on any error so the rest of the pipeline continues.
 */
async function computeSolarPotential(
  sql:  ReturnType<typeof postgres>,
  prop: PropertyInput,
): Promise<SolarPotentialResult | null> {
  if (!prop.lat || !prop.lng) return null

  try {
    // 1. Financial constants — graceful defaults if solar columns not yet seeded
    const [consts] = await sql<{
      electricity_pvpc_kwh_eur:   number | null
      solar_export_rate_eur:      number | null
      solar_install_cost_per_kwp: number | null
    }[]>`
      SELECT electricity_pvpc_kwh_eur,
             solar_export_rate_eur,
             solar_install_cost_per_kwp
      FROM eco_constants
      ORDER BY valid_from DESC LIMIT 1
    `

    // 2. GHI annual irradiance at nearest grid point (within 5km)
    // Column name is ghi_annual_kwh_m2 in the solar_radiation table
    const [solarRow] = await sql<{ ghi_annual_kwh_m2: number | null }[]>`
      SELECT ghi_annual_kwh_m2
      FROM solar_radiation
      WHERE ST_DWithin(
        geom,
        ST_SetSRID(ST_MakePoint(${prop.lng}, ${prop.lat}), 4326)::geography,
        5000
      )
      ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${prop.lng}, ${prop.lat}), 4326)::geography
      LIMIT 1
    `

    // 3. Building orientation + Catastro footprint/floors
    const [buildRow] = await sql<{
      aspect:           string | null
      footprint_area_m2: number | null
      num_floors:        number | null
    }[]>`
      SELECT aspect, footprint_area_m2, num_floors
      FROM building_orientation
      WHERE ref_catastral = ${prop.ref_catastral ?? ''}
         OR ST_DWithin(
              geom,
              ST_SetSRID(ST_MakePoint(${prop.lng}, ${prop.lat}), 4326)::geography,
              30
            )
      ORDER BY
        CASE WHEN ref_catastral = ${prop.ref_catastral ?? ''} THEN 0 ELSE 1 END
      LIMIT 1
    `

    const pvpc      = consts?.electricity_pvpc_kwh_eur     ?? 0.185
    const exportR   = consts?.solar_export_rate_eur        ?? 0.070
    const installC  = consts?.solar_install_cost_per_kwp   ?? 1200
    const ghiAnnual = solarRow?.ghi_annual_kwh_m2          ?? null
    const aspect    = buildRow?.aspect                     ?? null
    const footprint = buildRow?.footprint_area_m2          ?? null
    const numFloors = buildRow?.num_floors                 ?? null

    // 4. First-pass calc (no PVGIS yet) — determines installed_kwp for the API call
    const prelim = calcSolarPotential({
      lat: prop.lat, lng: prop.lng,
      ghi_annual: ghiAnnual, pvgisResult: null,
      electricity_pvpc_kwh_eur: pvpc,
      solar_export_rate_eur: exportR,
      solar_install_cost_per_kwp: installC,
      footprint_area_m2: footprint,
      num_floors: numFloors,
      floor: prop.floor,
      property_type: prop.property_type,
      aspect,
      area_sqm: prop.area_sqm,
    })

    // 5. PVGIS API call with the correctly-sized system
    const tilt    = optimalTilt(prop.lat)
    const azimuth = aspect ? (ASPECT_TO_AZIMUTH[aspect] ?? 0) : 0
    const pvgisResult = await callPvgisPvcalc(
      prop.lat, prop.lng, prelim.installed_kwp, azimuth, tilt,
    )

    // 6. Final calc with PVGIS yield (falls back to GHI estimate if PVGIS timed out)
    return calcSolarPotential({
      lat: prop.lat, lng: prop.lng,
      ghi_annual: ghiAnnual, pvgisResult,
      electricity_pvpc_kwh_eur: pvpc,
      solar_export_rate_eur: exportR,
      solar_install_cost_per_kwp: installC,
      footprint_area_m2: footprint,
      num_floors: numFloors,
      floor: prop.floor,
      property_type: prop.property_type,
      aspect,
      area_sqm: prop.area_sqm,
    })
  } catch (err) {
    console.warn('[analyse-job] Solar computation failed (non-fatal):', err)
    return null
  }
}

function collectAlerts(indicators: Awaited<ReturnType<typeof runAllIndicators>>): Alert[] {
  return Object.values(indicators).flatMap((ind) => (ind as IndicatorResult).alerts ?? [])
}

function calcTviScore(indicators: Awaited<ReturnType<typeof runAllIndicators>>): number | null {
  const tier1 = [
    indicators.true_affordability.score,
    indicators.structural_liability.score != null ? 100 - indicators.structural_liability.score : null,
    indicators.digital_viability.score,
    indicators.health_security.score,
    indicators.education_opportunity.score,
  ].filter((s): s is number => s != null && !isNaN(s))

  if (tier1.length === 0) return null
  return Math.round(tier1.reduce((a, b) => a + b, 0) / tier1.length)
}

// ─── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 })
  }

  let jobId: string
  try {
    const body = await req.json()
    jobId = body.jobId
    if (!jobId) throw new Error('missing jobId')
  } catch {
    return new Response(JSON.stringify({ error: 'jobId required' }), { status: 400 })
  }

  // Supabase client for CRUD (job status, cache write, price history)
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Postgres.js for PostGIS indicator queries
  const db = postgres(DATABASE_URL, {
    ssl: 'require',
    max: 1,           // one connection per Edge Function invocation
    idle_timeout: 20,
    prepare: false,   // required for Supabase connection pooler compatibility
  })

  try {
    // --- Mark processing ---
    await supabase
      .from('analysis_jobs')
      .update({ status: 'processing', started_at: new Date().toISOString(), step: 0 })
      .eq('id', jobId)

    // Fetch job row
    const { data: job, error: jobErr } = await supabase
      .from('analysis_jobs')
      .select('source_url, property_input, tier')
      .eq('id', jobId)
      .single()

    if (jobErr || !job) throw new Error(`Job not found: ${jobId}`)

    const propInput: Partial<PropertyInput> = job.property_input ?? {}

    // --- Step 1: Parse.bot ---
    await supabase.from('analysis_jobs').update({ step: 1 }).eq('id', jobId)
    const listing = await fetchListing(job.source_url)

    // Merge: Parse.bot provides the base; manual propInput overrides ONLY if the value is non-null.
    // Null means "field was not filled in", not "explicitly set to null" — don't let empty form
    // fields wipe out coordinates that Parse.bot successfully extracted.
    const cleanPropInput = Object.fromEntries(
      Object.entries(propInput).filter(([, v]) => v != null)
    ) as Partial<PropertyInput>
    const merged: Partial<PropertyInput> = { ...listing, ...cleanPropInput }

    // --- Step 2: Catastro ---
    await supabase.from('analysis_jobs').update({ step: 2 }).eq('id', jobId)
    const catastro = await fetchCatastro(merged.ref_catastral, merged.lat ?? 0, merged.lng ?? 0)
    const prop: PropertyInput = {
      lat:                merged.lat ?? 0,
      lng:                merged.lng ?? 0,
      price_asking:       merged.price_asking ?? 0,
      area_sqm:           merged.area_sqm ?? 80,
      comunidad_autonoma: merged.comunidad_autonoma,
      municipio:          merged.municipio,
      codigo_postal:      merged.codigo_postal,
      ref_catastral:      catastro?.ref_catastral ?? merged.ref_catastral,
      build_year:         catastro?.build_year ?? merged.build_year,
      epc_rating:         merged.epc_rating,
      epc_potential:      merged.epc_potential,
      bedrooms:           merged.bedrooms,
      bathrooms:          merged.bathrooms,
      floor:              merged.floor,
      seller_type:        merged.seller_type,
      address:            merged.address,
      property_type:      merged.property_type,
      condition:          merged.condition,
      catastro_year_built: merged.catastro_year_built,
      negotiation_gap_pct: merged.negotiation_gap_pct,
    }

    // --- Reverse geocode: populate municipio / comunidad_autonoma / provincia from PostGIS ---
    // Parse.bot rarely returns Spanish municipality names, so we derive them from coordinates.
    // municipios.geom is GEOGRAPHY(POINT) — nearest centroid, not polygon containment.
    // ST_Contains(geography, geometry) does not exist in PostGIS; use distance ordering instead.
    if (prop.lat && prop.lng && (!prop.municipio || !prop.comunidad_autonoma)) {
      const [geoRow] = await db<{ municipio_name: string; comunidad: string; provincia: string }[]>`
        SELECT municipio_name, comunidad, provincia
        FROM municipios
        WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint(${prop.lng}, ${prop.lat}), 4326)::geography, 25000)
        ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${prop.lng}, ${prop.lat}), 4326)::geography
        LIMIT 1
      `
      if (geoRow) {
        prop.municipio          = prop.municipio          ?? geoRow.municipio_name
        prop.comunidad_autonoma = prop.comunidad_autonoma ?? geoRow.comunidad
        prop.provincia          = prop.provincia          ?? geoRow.provincia
      }
    }

    // Derive codigo_postal from coordinates if not already set.
    // postal_zones contains polygon geometries for every Spanish postal code area.
    // Required for climate_data lookups and zone-level report linking.
    if (prop.lat && prop.lng && !prop.codigo_postal) {
      const [postalRow] = await db<{ codigo_postal: string }[]>`
        SELECT codigo_postal
        FROM postal_zones
        WHERE ST_Intersects(geom, ST_SetSRID(ST_MakePoint(${prop.lng}, ${prop.lat}), 4326)::geography)
        LIMIT 1
      `
      if (postalRow) prop.codigo_postal = postalRow.codigo_postal
    }

    // If essential fields are missing after merging Parse.bot + manual input, report exactly
    // which fields are needed so the client can show a targeted mini-form rather than a generic error.
    const missing: string[] = []
    if (!prop.lat)          missing.push('lat')
    if (!prop.lng)          missing.push('lng')
    if (!prop.price_asking) missing.push('price_asking')
    if (missing.length > 0) {
      // Structured error: client detects NEEDS_INPUT: prefix and extracts field names
      throw new Error(`NEEDS_INPUT:${missing.join(',')}`)
    }

    // --- Step 3: Run indicators ---
    await supabase.from('analysis_jobs').update({ step: 3 }).eq('id', jobId)
    const indicators = await runAllIndicators(db, prop)

    // --- Step 3b: Solar potential ---
    // Runs after indicators so PVGIS latency (~5s) doesn't block the indicator engine.
    // Non-fatal: a null result leaves solar_potential_result as NULL in the cache row.
    const solarResult = await computeSolarPotential(db, prop)

    const alerts      = collectAlerts(indicators)
    const tviScore    = calcTviScore(indicators)
    const pricePerSqm = prop.area_sqm > 0 ? Math.round(prop.price_asking / prop.area_sqm) : null

    // --- Step 4: Write analysis_cache ---
    await supabase.from('analysis_jobs').update({ step: 4 }).eq('id', jobId)

    // Pass composite_indicators as object — supabase-js serialises JSONB correctly (no double-encode)
    const { data: cacheRow, error: cacheErr } = await supabase
      .from('analysis_cache')
      .upsert(
        {
          source_url:           job.source_url,
          composite_indicators: indicators,  // object, NOT JSON.stringify() — fixes CHI-331 Bug 6
          alerts,
          tvi_score:            tviScore,
          lat:                  prop.lat,
          lng:                  prop.lng,
          geom:                 `SRID=4326;POINT(${prop.lng} ${prop.lat})`,
          address:              prop.address       ?? null,
          price_asking:         prop.price_asking,
          price_per_sqm:        pricePerSqm,
          area_sqm:             prop.area_sqm,
          municipio:            prop.municipio     ?? null,
          provincia:            prop.provincia     ?? null,
          codigo_postal:        prop.codigo_postal ?? null,
          ref_catastral:        prop.ref_catastral ?? null,
          build_year:           prop.build_year    ?? null,
          epc_rating:           prop.epc_rating    ?? null,
          bedrooms:             prop.bedrooms      ?? null,
          bathrooms:            prop.bathrooms     ?? null,
          floor:                prop.floor         ?? null,
          seller_type:          prop.seller_type   ?? null,
          property_type:        prop.property_type ?? null,
          condition:            prop.condition     ?? null,
          solar_potential_result: solarResult ?? null,
          extracted_at:         new Date().toISOString(),
          expires_at:           new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
          extraction_version:   '2.0',  // bumped: marks Apify migration
          price_logged:         false,
        },
        { onConflict: 'source_url' },
      )
      .select('id')
      .single()

    if (cacheErr || !cacheRow) throw new Error(`Cache write failed: ${cacheErr?.message}`)

    // --- Mark job complete (step 5) ---
    await supabase
      .from('analysis_jobs')
      .update({ status: 'complete', step: 5, cache_id: cacheRow.id, completed_at: new Date().toISOString() })
      .eq('id', jobId)

    // --- Log to property_price_history ---
    await supabase.from('property_price_history').insert({
      cache_id:     cacheRow.id,
      source_url:   job.source_url,
      codigo_postal: prop.codigo_postal ?? null,
      price:        prop.price_asking,
      price_per_sqm: pricePerSqm,
      observed_at:  new Date().toISOString(),
      source:       'user_submission',
    })

    return new Response(JSON.stringify({ success: true, cacheId: cacheRow.id }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('[analyse-job] error:', err)
    await supabase
      .from('analysis_jobs')
      .update({
        status:        'error',
        error_message: err instanceof Error ? err.message : String(err),
        completed_at:  new Date().toISOString(),
      })
      .eq('id', jobId)

    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  } finally {
    // Clean up postgres connection
    await db.end().catch(() => {})
  }
})
