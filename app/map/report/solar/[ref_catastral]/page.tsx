/**
 * /map/report/solar/[ref_catastral] — CHI-368 / CHI-380
 *
 * Deep-dive Solar & Climate Intelligence report.
 *
 * Gate logic:
 *   - ref_catastral='none' AND no postcode/lat → show gate page (add street number)
 *   - ref_catastral='none' BUT postcode or lat available → show zone-level solar estimate
 *   - ref_catastral is a valid Catastro ref → show building-level solar (future: Catastro data)
 *
 * Phase 1: Zone-level solar estimate via PVGIS JRC PVcalc.
 * Building footprint / orientation from Catastro is deferred.
 *
 * Server-rendered. Monthly bar charts are server-side SVGs.
 */

import { notFound } from 'next/navigation';
import db from '@/lib/db';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { ThemeToggle } from '@/components/report/ThemeToggle';
import { callPvgisPvcalc, optimalTilt } from '@/lib/pvgis';
import { calcSolarPotential } from '@/lib/indicators/solar-potential';
import { SolarPotentialCard } from '@/components/report/SolarPotentialCard';

// ---------------------------------------------------------------------------
// Tier check
// ---------------------------------------------------------------------------

async function getUserTier(): Promise<string> {
  try {
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return 'free';
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('tier, tier_expires_at')
      .eq('id', session.user.id)
      .single();
    if (!profile) return 'free';
    if (profile.tier_expires_at && new Date(profile.tier_expires_at) < new Date()) return 'free';
    return profile.tier ?? 'free';
  } catch {
    return 'free';
  }
}

// ---------------------------------------------------------------------------
// Upgrade gate component
// ---------------------------------------------------------------------------

function UpgradeGate({ backUrl }: { backUrl: string }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)', color: 'var(--text)', fontFamily: 'var(--font-dm-sans)' }}>
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', height: 52,
        borderBottom: '1px solid rgba(0,0,0,0.07)',
        background: 'var(--surface-2)',
      }}>
        <a href={backUrl} style={{ fontSize: 13, color: '#8A9BB0', textDecoration: 'none' }}>
          ← Back
        </a>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <ThemeToggle />
          <span style={{ fontFamily: 'var(--font-playfair)', fontSize: 18, fontWeight: 600 }}>Qolify</span>
        </div>
      </nav>
      <main style={{ maxWidth: 520, margin: '80px auto', padding: '0 24px', textAlign: 'center' }}>
        <p style={{ fontSize: 11, letterSpacing: '0.12em', color: '#D4820A', textTransform: 'uppercase', marginBottom: 12 }}>
          Pro Feature
        </p>
        <h1 style={{ fontFamily: 'var(--font-playfair)', fontSize: 28, fontWeight: 700, marginBottom: 16 }}>
          Solar &amp; Climate Intelligence
        </h1>
        <p style={{ fontSize: 14, color: '#8A9BB0', lineHeight: 1.7, marginBottom: 32 }}>
          Upgrade to Pro to unlock the full Solar &amp; Climate report — including building orientation,
          solar yield projections, financial returns, and 30-year climate context.
        </p>
        <a
          href="/pricing"
          style={{
            display: 'inline-block', background: '#D4820A', color: '#fff',
            fontWeight: 700, fontSize: 14, padding: '12px 24px',
            borderRadius: 8, textDecoration: 'none',
          }}
        >
          Upgrade to Pro →
        </a>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Constants — Málaga 30yr monthly sunshine hours (AEMET normals, station 6155A)
// Used as a fallback when no zone-specific climate data is available.
// ---------------------------------------------------------------------------

const MALAGA_SUNSHINE_HOURS = [
  { month: 'Jan', hours: 185 },
  { month: 'Feb', hours: 195 },
  { month: 'Mar', hours: 227 },
  { month: 'Apr', hours: 240 },
  { month: 'May', hours: 270 },
  { month: 'Jun', hours: 305 },
  { month: 'Jul', hours: 345 },
  { month: 'Aug', hours: 325 },
  { month: 'Sep', hours: 255 },
  { month: 'Oct', hours: 215 },
  { month: 'Nov', hours: 190 },
  { month: 'Dec', hours: 175 },
];

// ---------------------------------------------------------------------------
// Gate page — shown when ref_catastral is 'none' AND no postcode/coords given
// ---------------------------------------------------------------------------

function GatePage({ backUrl }: { backUrl: string }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)', color: 'var(--text)', fontFamily: 'var(--font-dm-sans)' }}>
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', height: 52,
        borderBottom: '1px solid rgba(0,0,0,0.07)',
        background: 'var(--surface-2)',
      }}>
        <a href={backUrl} style={{ fontSize: 13, color: '#8A9BB0', textDecoration: 'none' }}>
          ← Back to map
        </a>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <ThemeToggle />
          <span style={{ fontFamily: 'var(--font-playfair)', fontSize: 18, fontWeight: 600 }}>Qolify</span>
        </div>
      </nav>
      <main style={{ maxWidth: 560, margin: '80px auto', padding: '0 24px', textAlign: 'center' }}>
        <p style={{ fontSize: 11, letterSpacing: '0.12em', color: '#34C97A', textTransform: 'uppercase', marginBottom: 12 }}>
          Solar &amp; Climate Intelligence
        </p>
        <h1 style={{ fontFamily: 'var(--font-playfair)', fontSize: 28, fontWeight: 700, marginBottom: 16 }}>
          Add your address to unlock this report
        </h1>
        <p style={{ fontSize: 14, color: '#8A9BB0', lineHeight: 1.7, marginBottom: 32 }}>
          To see your building&apos;s precise solar orientation and annual sunshine analysis,
          we need your street address to look up the Catastro building reference.
        </p>
        <a
          href={`${backUrl}${backUrl.includes('?') ? '&' : '?'}enrichment=open`}
          style={{
            display:      'inline-block',
            background:   '#34C97A',
            color:        '#0D1B2A',
            fontWeight:   700,
            fontSize:     14,
            padding:      '12px 24px',
            borderRadius: 8,
            textDecoration: 'none',
          }}
        >
          Add street number →
        </a>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

interface ZoneSolar {
  avg_ghi:              number | null;
  solar_score_norm:     number | null;
  sunshine_hours_annual: number | null;
  sunshine_hours_jan:   number | null;
  sunshine_hours_feb:   number | null;
  sunshine_hours_mar:   number | null;
  sunshine_hours_apr:   number | null;
  sunshine_hours_may:   number | null;
  sunshine_hours_jun:   number | null;
  sunshine_hours_jul:   number | null;
  sunshine_hours_aug:   number | null;
  sunshine_hours_sep:   number | null;
  sunshine_hours_oct:   number | null;
  sunshine_hours_nov:   number | null;
  sunshine_hours_dec:   number | null;
  hdd_annual:           number | null;
  cdd_annual:           number | null;
  municipio:            string | null;
  codigo_postal:        string | null;
}

interface EcoConstants {
  electricity_pvpc_kwh_eur:   number;
  solar_export_rate_eur:      number;
  solar_install_cost_per_kwp: number;
}

interface BuildingOrientation {
  aspect:           string | null;
  aspect_degrees:   number | null;
  source:           string | null;
  confidence:       string | null;
  footprint_area_m2: number | null;
}

// ---------------------------------------------------------------------------
// Data fetchers
// ---------------------------------------------------------------------------

/**
 * Fetch zone solar + climate data. Tries postcode first, falls back to municipio.
 * If neither postcode nor municipio is known, falls back to Málaga defaults.
 */
async function getZoneSolarData(
  postcode: string | null,
  municipio?: string | null,
): Promise<ZoneSolar | null> {
  const select = db`
    SELECT
      zs.avg_ghi::float,
      zs.solar_score_norm::float,
      cd.sunshine_hours_annual::int,
      cd.sunshine_hours_jan::float, cd.sunshine_hours_feb::float, cd.sunshine_hours_mar::float,
      cd.sunshine_hours_apr::float, cd.sunshine_hours_may::float, cd.sunshine_hours_jun::float,
      cd.sunshine_hours_jul::float, cd.sunshine_hours_aug::float, cd.sunshine_hours_sep::float,
      cd.sunshine_hours_oct::float, cd.sunshine_hours_nov::float, cd.sunshine_hours_dec::float,
      cd.hdd_annual::int, cd.cdd_annual::int,
      zs.municipio,
      zs.codigo_postal
    FROM zone_scores zs
    LEFT JOIN climate_data cd ON cd.municipio_name = zs.municipio
  `;

  // 1. Try exact postcode match
  if (postcode) {
    const rows = await db`
      SELECT
        zs.avg_ghi::float,
        zs.solar_score_norm::float,
        cd.sunshine_hours_annual::int,
        cd.sunshine_hours_jan::float, cd.sunshine_hours_feb::float, cd.sunshine_hours_mar::float,
        cd.sunshine_hours_apr::float, cd.sunshine_hours_may::float, cd.sunshine_hours_jun::float,
        cd.sunshine_hours_jul::float, cd.sunshine_hours_aug::float, cd.sunshine_hours_sep::float,
        cd.sunshine_hours_oct::float, cd.sunshine_hours_nov::float, cd.sunshine_hours_dec::float,
        cd.hdd_annual::int, cd.cdd_annual::int,
        zs.municipio,
        zs.codigo_postal
      FROM zone_scores zs
      LEFT JOIN climate_data cd ON cd.municipio_name = zs.municipio
      WHERE zs.codigo_postal = ${postcode}
      LIMIT 1`;
    if (rows[0]) return rows[0] as unknown as ZoneSolar;
  }

  // 2. Fall back to best zone in the given municipio
  const fallback = municipio ?? 'Málaga';
  const rows = await db`
    SELECT
      zs.avg_ghi::float,
      zs.solar_score_norm::float,
      cd.sunshine_hours_annual::int,
      cd.sunshine_hours_jan::float, cd.sunshine_hours_feb::float, cd.sunshine_hours_mar::float,
      cd.sunshine_hours_apr::float, cd.sunshine_hours_may::float, cd.sunshine_hours_jun::float,
      cd.sunshine_hours_jul::float, cd.sunshine_hours_aug::float, cd.sunshine_hours_sep::float,
      cd.sunshine_hours_oct::float, cd.sunshine_hours_nov::float, cd.sunshine_hours_dec::float,
      cd.hdd_annual::int, cd.cdd_annual::int,
      zs.municipio,
      zs.codigo_postal
    FROM zone_scores zs
    LEFT JOIN climate_data cd ON cd.municipio_name = zs.municipio
    WHERE zs.municipio = ${fallback}
    ORDER BY zs.zone_tvi DESC
    LIMIT 1`;

  return (rows[0] as unknown as ZoneSolar) ?? null;
}

/**
 * Fetch building orientation from Catastro data stored during analysis.
 * Returns null gracefully when ref is 'none' or row is not yet populated.
 */
async function getBuildingOrientation(ref_catastral: string): Promise<BuildingOrientation | null> {
  if (!ref_catastral || ref_catastral === 'none') return null;
  try {
    const rows = await db`
      SELECT aspect, aspect_degrees, source, confidence, footprint_area_m2::float
      FROM building_orientation
      WHERE ref_catastral = ${ref_catastral}
      LIMIT 1`;
    return (rows[0] as unknown as BuildingOrientation) ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetch financial constants for solar calculations.
 * Falls back to sensible Spanish market defaults if the table is empty.
 */
async function getEcoConstants(): Promise<EcoConstants> {
  try {
    const rows = await db`
      SELECT
        electricity_pvpc_kwh_eur::float,
        solar_export_rate_eur::float,
        solar_install_cost_per_kwp::int
      FROM eco_constants
      ORDER BY updated_at DESC
      LIMIT 1`;
    const row = rows[0] as unknown as Partial<EcoConstants> | undefined;
    if (row?.electricity_pvpc_kwh_eur && row?.solar_export_rate_eur && row?.solar_install_cost_per_kwp) {
      return row as EcoConstants;
    }
  } catch { /* fall through to defaults */ }

  return {
    electricity_pvpc_kwh_eur:   0.185,
    solar_export_rate_eur:      0.070,
    solar_install_cost_per_kwp: 1200,
  };
}

// ---------------------------------------------------------------------------
// AI narrative
// ---------------------------------------------------------------------------

async function generateSolarNarrative(data: {
  annualHours: number;
  ghi:         number | null;
  hdd:         number | null;
  cdd:         number | null;
  city:        string;
}): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const client = new Anthropic();
  try {
    const message = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 140,
      messages:   [{
        role: 'user',
        content: `Write 2-3 sentences about what the solar and climate conditions mean for someone buying a property in ${data.city}, Spain.

Data: ${data.annualHours} sunshine hours/year${data.ghi ? `, ${Math.round(data.ghi)} kWh/m² annual solar irradiance` : ''}${data.hdd ? `, ${data.hdd} heating degree days` : ''}${data.cdd ? `, ${data.cdd} cooling degree days` : ''}.

Plain English. What does this mean practically for energy costs, comfort, solar panels?`,
      }],
    });
    return message.content[0].type === 'text' ? message.content[0].text : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Monthly sunshine bar chart (SVG rendered server-side)
// ---------------------------------------------------------------------------

function SunshineBarChart({
  data,
}: {
  data: Array<{ month: string; hours: number }>;
}) {
  const maxHours = Math.max(...data.map(d => d.hours));
  const chartH = 80;
  const barW = 22;
  const gap = 6;
  const totalW = data.length * (barW + gap) - gap;

  return (
    <div>
      <svg
        width={totalW}
        height={chartH + 20}
        viewBox={`0 0 ${totalW} ${chartH + 20}`}
        style={{ width: '100%', maxWidth: 400 }}
      >
        {data.map((d, i) => {
          const barH = Math.round((d.hours / maxHours) * chartH);
          const x = i * (barW + gap);
          const y = chartH - barH;
          // Gradient: amber in winter (low) → emerald in summer (high)
          const ratio = d.hours / maxHours;
          const r = Math.round(52  + (212 - 52)  * (1 - ratio));
          const g = Math.round(201 + (130 - 201) * (1 - ratio));
          const b = Math.round(122 + (10  - 122) * (1 - ratio));
          const fill = `rgb(${r},${g},${b})`;
          return (
            <g key={d.month}>
              <rect x={x} y={y} width={barW} height={barH} fill={fill} rx={3} opacity={0.9} />
              <text
                x={x + barW / 2}
                y={chartH + 14}
                textAnchor="middle"
                fill="#4A6080"
                fontSize={9}
                fontFamily="var(--font-dm-sans)"
              >
                {d.month[0]}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

interface Props {
  params:      Promise<{ ref_catastral: string }>;
  searchParams: Promise<{ lat?: string; lng?: string; postcode?: string; jobId?: string }>;
}

export default async function SolarReportPage({ params, searchParams }: Props) {
  const { ref_catastral } = await params;
  const sp = await searchParams;

  const lat = sp.lat ? parseFloat(sp.lat) : null;
  const lng = sp.lng ? parseFloat(sp.lng) : null;

  const jobId   = sp.jobId ?? null;
  const backUrl = jobId
    ? `/analyse/${jobId}`
    : (lat != null && lng != null ? `/map?lat=${sp.lat}&lng=${sp.lng}&pin=true` : '/map');
  const backLabel = jobId ? '← DNA Report' : '← Back to map';

  // Gate: ref_catastral = 'none' AND no location context → ask for address
  const isPlaceholder = !ref_catastral || ref_catastral === 'none';
  const hasLocation   = !!sp.postcode || (lat != null && lng != null);

  if (isPlaceholder && !hasLocation) {
    return <GatePage backUrl={backUrl} />;
  }

  // Tier check — Pro required
  const tier = await getUserTier();
  const isPro = tier === 'pro' || tier === 'intelligence';
  if (!isPro) {
    return <UpgradeGate backUrl={backUrl} />;
  }

  // Fetch zone data, eco constants, building orientation, and PVGIS in parallel
  const postcode = sp.postcode ?? null;

  const [zoneData, ecoConstants, orientation] = await Promise.all([
    getZoneSolarData(postcode),
    getEcoConstants(),
    getBuildingOrientation(ref_catastral),
  ]);

  // PVGIS PVcalc — uses the clicked lat/lng, or falls back to null (financial calc uses GHI)
  // We call with a zone_estimate 4 kWp system, south-facing, optimal tilt
  const pvgisResult = (lat != null && lng != null)
    ? await callPvgisPvcalc(
        lat,
        lng,
        4.0,                      // zone_estimate default: 4 kWp
        0,                        // azimuth = South (0 = optimal in PVGIS convention)
        optimalTilt(lat),         // tilt = latitude − 10, clamped [20, 40]
      )
    : null;

  // Compute solar potential
  const solarResult = calcSolarPotential({
    lat:  lat ?? 36.7,            // fallback to Málaga lat if no pin
    lng:  lng ?? -4.4,
    ghi_annual: zoneData?.avg_ghi ?? null,
    pvgisResult,
    electricity_pvpc_kwh_eur:   ecoConstants.electricity_pvpc_kwh_eur,
    solar_export_rate_eur:      ecoConstants.solar_export_rate_eur,
    solar_install_cost_per_kwp: ecoConstants.solar_install_cost_per_kwp,
    // No Catastro property data at this point → scenario = zone_estimate
  });

  // Build the monthly sunshine array — prefer zone climate data, fall back to Málaga constants
  const monthlyData = zoneData?.sunshine_hours_jan != null
    ? [
        { month: 'Jan', hours: zoneData.sunshine_hours_jan ?? 0 },
        { month: 'Feb', hours: zoneData.sunshine_hours_feb ?? 0 },
        { month: 'Mar', hours: zoneData.sunshine_hours_mar ?? 0 },
        { month: 'Apr', hours: zoneData.sunshine_hours_apr ?? 0 },
        { month: 'May', hours: zoneData.sunshine_hours_may ?? 0 },
        { month: 'Jun', hours: zoneData.sunshine_hours_jun ?? 0 },
        { month: 'Jul', hours: zoneData.sunshine_hours_jul ?? 0 },
        { month: 'Aug', hours: zoneData.sunshine_hours_aug ?? 0 },
        { month: 'Sep', hours: zoneData.sunshine_hours_sep ?? 0 },
        { month: 'Oct', hours: zoneData.sunshine_hours_oct ?? 0 },
        { month: 'Nov', hours: zoneData.sunshine_hours_nov ?? 0 },
        { month: 'Dec', hours: zoneData.sunshine_hours_dec ?? 0 },
      ]
    : MALAGA_SUNSHINE_HOURS;

  const annualHours = zoneData?.sunshine_hours_annual
    ?? monthlyData.reduce((s, d) => s + d.hours, 0);

  const city     = zoneData?.municipio ?? 'Málaga';
  const dispCode = postcode ?? zoneData?.codigo_postal ?? '';

  const narrative = await generateSolarNarrative({
    annualHours,
    ghi:  zoneData?.avg_ghi ?? null,
    hdd:  zoneData?.hdd_annual ?? null,
    cdd:  zoneData?.cdd_annual ?? null,
    city,
  });

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)', color: 'var(--text)', fontFamily: 'var(--font-dm-sans)' }}>

      {/* ── Nav strip ── */}
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', height: 52, borderBottom: '1px solid rgba(0,0,0,0.07)',
        position: 'sticky', top: 0, background: 'var(--surface-2)', zIndex: 10,
      }}>
        <a href={backUrl} style={{ fontSize: 13, color: '#8A9BB0', textDecoration: 'none' }}>
          {backLabel}
        </a>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <ThemeToggle />
          <span style={{ fontFamily: 'var(--font-playfair)', fontSize: 18, fontWeight: 600 }}>Qolify</span>
        </div>
      </nav>

      <main style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px 80px' }}>

        {/* Page title */}
        <p style={{ fontSize: 11, letterSpacing: '0.12em', color: '#D4820A', textTransform: 'uppercase', marginBottom: 8 }}>
          Solar &amp; Climate Intelligence
        </p>
        <h1 style={{ fontFamily: 'var(--font-playfair)', fontSize: 32, fontWeight: 700, lineHeight: 1.15, margin: 0, marginBottom: 4 }}>
          Solar Analysis
        </h1>
        <p style={{ fontSize: 14, color: '#8A9BB0', marginBottom: 8 }}>
          {dispCode && `Postcode ${dispCode} · `}{city}
        </p>
        {!isPlaceholder && (
          <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 11, color: '#4A6080', marginBottom: 32 }}>
            Ref. catastral: {ref_catastral}
          </p>
        )}

        <div style={{ height: 1, background: 'rgba(0,0,0,0.07)', marginBottom: 32 }} />

        {/* ── Building Orientation ── */}
        {orientation && (
          <section style={{ marginBottom: 40 }}>
            <h2 style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
              color: '#8A9BB0', textTransform: 'uppercase', marginBottom: 16,
            }}>
              Building Orientation
            </h2>
            <div style={{
              background: 'var(--surface-2)', border: '1px solid rgba(0,0,0,0.07)',
              borderRadius: 10, padding: '20px 18px',
              display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '16px 24px', alignItems: 'start',
            }}>
              {/* Compass rose */}
              <div style={{
                width: 72, height: 72, borderRadius: '50%',
                border: '2px solid rgba(212,130,10,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                position: 'relative', background: 'rgba(212,130,10,0.05)',
              }}>
                {/* Compass arrow rotated to aspect_degrees */}
                <div style={{
                  width: 4, height: 28,
                  background: '#D4820A',
                  borderRadius: 2,
                  transform: `rotate(${orientation.aspect_degrees ?? 0}deg)`,
                  transformOrigin: 'bottom center',
                  position: 'absolute',
                  bottom: '50%',
                  left: 'calc(50% - 2px)',
                }} />
                <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 14, fontWeight: 700, color: '#D4820A', zIndex: 1 }}>
                  {orientation.aspect ?? '—'}
                </span>
              </div>

              <div>
                <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 26, fontWeight: 500, color: 'var(--navy-deep)', margin: 0 }}>
                  {orientation.aspect ?? 'Unknown'}
                  {orientation.aspect_degrees != null && (
                    <span style={{ fontSize: 14, color: '#8A9BB0', fontWeight: 400, marginLeft: 8 }}>
                      ({orientation.aspect_degrees}°)
                    </span>
                  )}
                </p>
                <p style={{ fontSize: 13, color: '#4A5D74', marginTop: 6, lineHeight: 1.5 }}>
                  {(() => {
                    const a = orientation.aspect;
                    if (a === 'S')  return 'South-facing — maximum solar gain year-round. Ideal for solar panels and passive heating.';
                    if (a === 'SE') return 'South-east facing — excellent morning sun with strong solar gain. Very good for panels.';
                    if (a === 'SW') return 'South-west facing — good afternoon sun with strong solar gain. Well-suited for panels.';
                    if (a === 'E')  return 'East-facing — good morning sun but reduced afternoon solar gain. Moderate panel yield.';
                    if (a === 'W')  return 'West-facing — afternoon sun exposure. Useful for summer cooling and moderate panel yield.';
                    if (a === 'N')  return 'North-facing — limited direct sun. Panels not recommended on this façade.';
                    if (a === 'NE') return 'North-east facing — minimal solar gain. Panels not recommended on this façade.';
                    if (a === 'NW') return 'North-west facing — minimal solar gain. Panels not recommended on this façade.';
                    return 'Orientation data not available.';
                  })()}
                </p>
                {orientation.footprint_area_m2 != null && (
                  <p style={{ fontSize: 12, color: '#8A9BB0', marginTop: 8 }}>
                    Building footprint:{' '}
                    <span style={{ fontFamily: 'var(--font-dm-mono)', color: '#4A5D74' }}>
                      {Math.round(orientation.footprint_area_m2)} m²
                    </span>
                  </p>
                )}
                {orientation.confidence && (
                  <p style={{ fontSize: 11, color: '#8A9BB0', marginTop: 4 }}>
                    Source: {orientation.source ?? 'Catastro'} · Confidence: {orientation.confidence}
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

        {/* AI narrative */}
        {narrative && (
          <p style={{
            fontSize: 15, color: '#4A5D74', lineHeight: 1.7, marginBottom: 36,
            borderLeft: '3px solid #D4820A', paddingLeft: 16,
          }}>
            {narrative}
          </p>
        )}

        {/* ── Solar Panel Potential (CHI-380) ── */}
        <section style={{ marginBottom: 40 }}>
          <h2 style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
            color: '#8A9BB0', textTransform: 'uppercase', marginBottom: 16,
          }}>
            Solar Panel Potential
          </h2>
          <div style={{
            background: 'var(--surface-2)', border: '1px solid rgba(0,0,0,0.07)',
            borderRadius: 10, padding: '20px 18px',
          }}>
            <SolarPotentialCard result={solarResult} locked={false} city={city} />
          </div>
        </section>

        {/* ── Annual sunshine bar chart ── */}
        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: '#8A9BB0', textTransform: 'uppercase', marginBottom: 16 }}>
            Annual Sunshine — {city}
          </h2>
          <div style={{
            background: 'var(--surface-2)', border: '1px solid rgba(0,0,0,0.07)',
            borderRadius: 10, padding: '20px 18px',
          }}>
            <SunshineBarChart data={monthlyData} />
            <p style={{ fontSize: 13, color: '#4A5D74', marginTop: 16 }}>
              <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 22, fontWeight: 500 }}>
                {annualHours.toLocaleString('es-ES')}
              </span>
              <span style={{ fontSize: 12, color: '#8A9BB0', marginLeft: 8 }}>
                sunshine hours per year
              </span>
            </p>
            {(() => {
              const peak = monthlyData.reduce((a, b) => a.hours > b.hours ? a : b);
              const dark = monthlyData.reduce((a, b) => a.hours < b.hours ? a : b);
              return (
                <p style={{ fontSize: 12, color: '#8A9BB0', marginTop: 6 }}>
                  Peak: <span style={{ color: '#34C97A' }}>{peak.month}</span> ({peak.hours} hrs)
                  {' · '}
                  Darkest: <span style={{ color: '#D4820A' }}>{dark.month}</span> ({dark.hours} hrs)
                </p>
              );
            })()}
            {zoneData?.avg_ghi && (
              <p style={{ fontSize: 12, color: '#8A9BB0', marginTop: 4 }}>
                Annual solar irradiance:{' '}
                <span style={{ fontFamily: 'var(--font-dm-mono)', color: '#4A5D74' }}>
                  {Math.round(zoneData.avg_ghi).toLocaleString('es-ES')} kWh/m²
                </span>
              </p>
            )}
          </div>
        </section>

        {/* ── Climate context ── */}
        {(zoneData?.hdd_annual || zoneData?.cdd_annual) && (
          <section style={{ marginBottom: 40 }}>
            <h2 style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: '#8A9BB0', textTransform: 'uppercase', marginBottom: 16 }}>
              Climate Context
            </h2>
            <div style={{
              background: 'var(--surface-2)', border: '1px solid rgba(0,0,0,0.07)',
              borderRadius: 10, padding: '16px 18px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16,
            }}>
              {zoneData.hdd_annual != null && (
                <div>
                  <p style={{ fontSize: 11, color: '#4A6080', marginBottom: 4 }}>Heating Degree Days</p>
                  <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 20, color: 'var(--navy-deep)' }}>
                    {zoneData.hdd_annual}
                  </p>
                  <p style={{ fontSize: 11, color: '#34C97A', marginTop: 4 }}>
                    {zoneData.hdd_annual < 500 ? 'Low heating costs' : 'Moderate heating costs'}
                  </p>
                </div>
              )}
              {zoneData.cdd_annual != null && (
                <div>
                  <p style={{ fontSize: 11, color: '#4A6080', marginBottom: 4 }}>Cooling Degree Days</p>
                  <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 20, color: 'var(--navy-deep)' }}>
                    {zoneData.cdd_annual}
                  </p>
                  <p style={{ fontSize: 11, color: '#D4820A', marginTop: 4 }}>
                    {zoneData.cdd_annual < 400 ? 'Moderate cooling costs' : 'Higher cooling costs'}
                  </p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── Data source footer ── */}
        <footer style={{ borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 20, marginTop: 20 }}>
          <p style={{ fontSize: 11, color: '#4A6080', lineHeight: 1.6 }}>
            Solar yield: PVGIS (JRC European Commission), 5-year average.
            Irradiance: Spain solar radiation database (zone-level).
            Climate: AEMET 30-year normals.
            Financial constants: quarterly-updated Spanish market rates.
            Building orientation and footprint from Catastro (pending full integration).
          </p>
        </footer>

      </main>
    </div>
  );
}
