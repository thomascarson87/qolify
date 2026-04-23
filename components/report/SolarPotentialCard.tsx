/**
 * components/report/SolarPotentialCard.tsx — CHI-380
 *
 * Displays solar panel potential for a property or zone.
 * Server-renderable (no client hooks). All data is passed as props.
 *
 * Four scenario variants (per CHI-380 spec):
 *   house_full          — full roof available
 *   apartment_top_floor — may have roof access
 *   apartment_shared    — community solar scenario
 *   apartment_lower     — community solar scenario
 *   zone_estimate       — no property data, zone-level estimate
 *
 * Tier gating:
 *   Free: scenario + headline annual saving only
 *   Pro+: full breakdown, monthly chart
 */

import type { SolarPotentialResult } from '@/lib/indicators/solar-potential';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function paybackBadgeColor(payback: number | null): { text: string; bg: string; border: string } {
  if (payback == null)  return { text: '#8A9BB0', bg: 'rgba(138,155,176,0.1)',  border: 'rgba(138,155,176,0.3)' };
  if (payback <= 8)     return { text: '#34C97A', bg: 'rgba(52,201,122,0.12)',  border: 'rgba(52,201,122,0.3)'  };
  if (payback <= 15)    return { text: '#D4820A', bg: 'rgba(212,130,10,0.12)',  border: 'rgba(212,130,10,0.3)'  };
  return                       { text: '#C94B1A', bg: 'rgba(201,75,26,0.12)',   border: 'rgba(201,75,26,0.3)'   };
}

function confidenceBadge(c: 'high' | 'medium' | 'low') {
  if (c === 'high')   return { label: 'High confidence',   color: '#34C97A' };
  if (c === 'medium') return { label: 'Medium confidence', color: '#D4820A' };
  return                     { label: 'Estimate',          color: '#8A9BB0' };
}

function orientationBadge(aspect: string | null, roofType: 'flat' | 'pitched' | 'unknown') {
  if (roofType === 'flat')    return { label: '▭ Flat roof — optimal install', color: '#34C97A' };
  if (!aspect)                return { label: 'Orientation unknown', color: '#8A9BB0' };
  const s = aspect.toUpperCase();
  if (s === 'S')              return { label: '☀ South-facing', color: '#34C97A' };
  if (s === 'SE' || s === 'SW') return { label: `☀ ${s}-facing`, color: '#34C97A' };
  if (s === 'E' || s === 'W') return { label: `↕ ${s}-facing`, color: '#D4820A' };
  return                             { label: `↓ ${s}-facing`, color: '#8A9BB0' };
}

// Server-side SVG monthly generation bar chart
function MonthlyBarChart({ monthlyKwh }: { monthlyKwh: number[] }) {
  const labels = ['J','F','M','A','M','J','J','A','S','O','N','D'];
  const max    = Math.max(...monthlyKwh.filter(v => isFinite(v)), 1);
  const chartH = 60;
  const barW   = 18;
  const gap    = 5;
  const totalW = 12 * (barW + gap) - gap;

  return (
    <svg
      width={totalW}
      height={chartH + 18}
      viewBox={`0 0 ${totalW} ${chartH + 18}`}
      style={{ width: '100%', maxWidth: 320, display: 'block' }}
    >
      {monthlyKwh.map((kwh, i) => {
        const barH = Math.max(Math.round((kwh / max) * chartH), 2);
        const x    = i * (barW + gap);
        const y    = chartH - barH;
        // Emerald gradient: low months are lighter, peak months full emerald
        const ratio = kwh / max;
        const r = Math.round(52  + (200 - 52)  * (1 - ratio));
        const g = Math.round(201 + (220 - 201) * (1 - ratio));
        const b = Math.round(122 + (200 - 122) * (1 - ratio));
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={barH} fill={`rgb(${r},${g},${b})`} rx={2} opacity={0.9} />
            <text x={x + barW / 2} y={chartH + 13} textAnchor="middle" fill="#4A6080" fontSize={8} fontFamily="var(--font-dm-sans)">
              {labels[i]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Sub-layouts per scenario
// ---------------------------------------------------------------------------

function HouseFullCard({ s, locked }: { s: SolarPotentialResult; locked: boolean }) {
  const pb   = paybackBadgeColor(s.payback_years);
  const obadge = orientationBadge(s.aspect, s.roof_type);
  return (
    <>
      {/* Orientation + system overview */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        <span style={{
          fontFamily: 'var(--font-dm-sans)', fontSize: 11, fontWeight: 600,
          color: obadge.color, background: `${obadge.color}15`,
          border: `1px solid ${obadge.color}40`, borderRadius: 20, padding: '3px 10px',
        }}>
          {obadge.label}
        </span>
        <span style={{
          fontFamily: 'var(--font-dm-sans)', fontSize: 11, fontWeight: 600,
          color: '#4A5D74', background: 'rgba(0,0,0,0.04)',
          border: '1px solid rgba(0,0,0,0.08)', borderRadius: 20, padding: '3px 10px',
        }}>
          {s.usable_roof_area_m2} m² usable roof
        </span>
      </div>

      {/* Key stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 24px', marginBottom: 20 }}>
        <div>
          <p style={{ fontSize: 11, color: '#4A6080', marginBottom: 3 }}>Estimated system</p>
          <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 17, color: 'var(--navy-deep)', margin: 0 }}>
            {s.installed_kwp} kWp
          </p>
          <p style={{ fontSize: 11, color: '#8A9BB0', marginTop: 2 }}>{s.panel_count} panels</p>
        </div>

        {s.annual_kwh_yield != null ? (
          <div>
            <p style={{ fontSize: 11, color: '#4A6080', marginBottom: 3 }}>Annual generation</p>
            <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 17, color: 'var(--navy-deep)', margin: 0 }}>
              ~{s.annual_kwh_yield.toLocaleString('es-ES')} kWh
            </p>
          </div>
        ) : null}

        <div>
          <p style={{ fontSize: 11, color: '#4A6080', marginBottom: 3 }}>Annual grid saving</p>
          <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 17, color: '#34C97A', margin: 0 }}>
            ~€{s.annual_saving_eur.toLocaleString('es-ES')}
          </p>
        </div>

        {locked ? (
          <div style={{ opacity: 0.4, filter: 'blur(3px)', userSelect: 'none' }}>
            <p style={{ fontSize: 11, color: '#4A6080', marginBottom: 3 }}>Payback period</p>
            <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 17, color: 'var(--navy-deep)', margin: 0 }}>~X.X yr</p>
          </div>
        ) : (
          <>
            <div>
              <p style={{ fontSize: 11, color: '#4A6080', marginBottom: 3 }}>Export income</p>
              <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 17, color: 'var(--navy-deep)', margin: 0 }}>
                ~€{s.annual_export_eur.toLocaleString('es-ES')}
              </p>
            </div>
            <div>
              <p style={{ fontSize: 11, color: '#4A6080', marginBottom: 3 }}>System cost</p>
              <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 17, color: 'var(--navy-deep)', margin: 0 }}>
                ~€{s.system_cost_eur.toLocaleString('es-ES')}
              </p>
            </div>
            <div>
              <p style={{ fontSize: 11, color: '#4A6080', marginBottom: 3 }}>Payback period</p>
              <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 17, color: 'var(--navy-deep)', margin: 0 }}>
                {s.payback_years != null ? `~${s.payback_years} years` : '—'}
              </p>
            </div>
            <div>
              <p style={{ fontSize: 11, color: '#4A6080', marginBottom: 3 }}>CO₂ offset</p>
              <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 17, color: '#34C97A', margin: 0 }}>
                ~{s.co2_offset_kg_annual.toLocaleString('es-ES')} kg/yr
              </p>
            </div>
          </>
        )}
      </div>

      {/* Monthly chart — Pro+ only */}
      {!locked && s.pvgis_monthly_kwh && s.pvgis_monthly_kwh.length === 12 && (
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 11, color: '#4A6080', marginBottom: 8 }}>Monthly generation (kWh)</p>
          <MonthlyBarChart monthlyKwh={s.pvgis_monthly_kwh} />
        </div>
      )}
    </>
  );
}

function ApartmentTopFloorCard({ s, locked }: { s: SolarPotentialResult; locked: boolean }) {
  return (
    <>
      <p style={{ fontSize: 13, color: '#4A5D74', lineHeight: 1.6, marginBottom: 16 }}>
        As the top floor, you may have access to exclusive roof space — worth
        confirming with your comunidad de propietarios.
      </p>
      <HouseFullCard s={s} locked={locked} />
    </>
  );
}

function CommunityCard({ s }: { s: SolarPotentialResult }) {
  return (
    <div>
      <p style={{ fontSize: 13, color: '#4A5D74', lineHeight: 1.6, marginBottom: 16 }}>
        Under Spain&apos;s <em>autoconsumo colectivo</em> rules (RD 244/2019), your
        comunidad de propietarios could install a shared solar system on the building roof.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 24px', marginBottom: 16 }}>
        <div>
          <p style={{ fontSize: 11, color: '#4A6080', marginBottom: 3 }}>Estimated building system</p>
          <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 17, color: 'var(--navy-deep)', margin: 0 }}>
            ~{(s.installed_kwp * 4).toFixed(0)} kWp total
          </p>
        </div>
        <div>
          <p style={{ fontSize: 11, color: '#4A6080', marginBottom: 3 }}>Your estimated share</p>
          <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 17, color: '#34C97A', margin: 0 }}>
            ~€{Math.round(s.annual_saving_eur / 4)}–{Math.round(s.annual_saving_eur / 3)}/yr
          </p>
        </div>
      </div>
      <p style={{ fontSize: 12, color: '#8A9BB0' }}>
        Worth raising at your next junta de comunidad.
      </p>
    </div>
  );
}

function ZoneEstimateCard({ s, locked }: { s: SolarPotentialResult; locked: boolean }) {
  return (
    <>
      <p style={{ fontSize: 13, color: '#4A5D74', lineHeight: 1.6, marginBottom: 16 }}>
        Based on a typical 10-panel ({s.installed_kwp} kWp) south-facing installation.
        Add your address for a building-specific calculation.
      </p>
      <HouseFullCard s={s} locked={locked} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface Props {
  result:   SolarPotentialResult;
  /** If true, full breakdown and monthly chart are hidden (free tier). */
  locked?:  boolean;
  /** City name for contextual copy. */
  city?:    string;
}

export function SolarPotentialCard({ result: s, locked = false, city = 'Málaga' }: Props) {
  const pb     = paybackBadgeColor(s.payback_years);
  const cbadge = confidenceBadge(s.confidence);
  const isCommunity = s.scenario === 'apartment_shared' || s.scenario === 'apartment_lower';

  return (
    <div>
      {/* Header row: payback badge + confidence badge */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        {/* Payback badge */}
        {s.payback_years != null && (
          <span style={{
            fontFamily: 'var(--font-dm-mono)', fontSize: 11, fontWeight: 700,
            color: pb.text, background: pb.bg, border: `1px solid ${pb.border}`,
            borderRadius: 6, padding: '3px 10px',
          }}>
            {s.payback_years <= 8 ? 'Good solar ROI' : s.payback_years <= 15 ? 'Moderate solar ROI' : 'Long payback'}
            {' · '}~{s.payback_years} yr
          </span>
        )}

        {/* Confidence badge */}
        <span style={{
          fontFamily: 'var(--font-dm-sans)', fontSize: 10, fontWeight: 600,
          color: cbadge.color, background: `${cbadge.color}12`,
          border: `1px solid ${cbadge.color}30`, borderRadius: 20, padding: '2px 8px',
        }}>
          {cbadge.label}
        </span>
      </div>

      {/* Annual saving headline — always visible */}
      <div style={{ marginBottom: 20 }}>
        <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#4A6080', marginBottom: 4 }}>
          Estimated annual benefit
        </p>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 28, fontWeight: 600, color: '#34C97A' }}>
            ~€{s.annual_total_benefit_eur.toLocaleString('es-ES')}
          </span>
          <span style={{ fontSize: 12, color: '#8A9BB0' }}>/ year</span>
        </div>
        <p style={{ fontSize: 11, color: '#8A9BB0', marginTop: 4 }}>
          {city} receives excellent sunshine — one of the best solar locations in Europe.
        </p>
      </div>

      {/* Locked free-tier gate */}
      {locked ? (
        <div style={{
          background:   'rgba(0,0,0,0.04)',
          border:       '1px dashed rgba(0,0,0,0.12)',
          borderRadius: 8,
          padding:      '14px 16px',
          textAlign:    'center',
          marginBottom: 16,
        }}>
          <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, color: '#4A5D74', marginBottom: 8 }}>
            Upgrade to Pro for full payback analysis, monthly generation profile, and CO₂ offset.
          </p>
          <a href="/pricing" style={{
            display:      'inline-block',
            background:   '#34C97A',
            color:        '#0D1B2A',
            fontWeight:   700,
            fontSize:     13,
            padding:      '8px 20px',
            borderRadius: 6,
            textDecoration: 'none',
          }}>
            Upgrade to Pro →
          </a>
        </div>
      ) : (
        // Full scenario card
        <>
          {(s.scenario === 'house_full') && <HouseFullCard s={s} locked={false} />}
          {(s.scenario === 'apartment_top_floor') && <ApartmentTopFloorCard s={s} locked={false} />}
          {(isCommunity) && <CommunityCard s={s} />}
          {(s.scenario === 'zone_estimate' || s.scenario === 'unknown') && <ZoneEstimateCard s={s} locked={false} />}
        </>
      )}

      {/* Confidence reason */}
      {s.confidence !== 'high' && (
        <p style={{ fontSize: 11, color: '#8A9BB0', marginTop: 8, fontStyle: 'italic' }}>
          {s.confidence_reason}
        </p>
      )}

      {/* Disclaimer — always shown */}
      <p style={{
        fontSize:   10,
        color:      '#8A9BB0',
        lineHeight: 1.6,
        marginTop:  16,
        paddingTop: 12,
        borderTop:  '1px solid rgba(0,0,0,0.06)',
      }}>
        Estimates based on EU solar irradiance data (PVGIS JRC), Catastro building data,
        and current Spanish electricity tariffs. Assumes open-sky exposure — shading from
        adjacent buildings not captured. System sizing assumes standard 400W monocrystalline
        panels. Financial figures use current PVPC rate and estimated export compensation;
        actual values will vary. Does not replace a professional solar survey.
      </p>
    </div>
  );
}
