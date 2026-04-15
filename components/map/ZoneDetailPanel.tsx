'use client';

/**
 * ZoneDetailPanel — CHI-344 + CHI-360
 *
 * Revised for the visualisation grammar sprint (CHI-360):
 *   - Pillar score grid: horizontal bars, all clickable → expand accordion below
 *   - Accordion content per pillar: facts + consequence statements, not sub-scores
 *   - Solar accordion: <SunshineBarChart>
 *   - Community accordion: VUT count + inline <TrendSparkline> if history available
 *   - Flood accordion: zone-level % with explicit two-level truth note
 *   - Schools accordion: nearest school details + catchment note
 *   - Health accordion: GP + emergency walking distances
 *   - Infrastructure accordion: NTI signal + projects (Investor profile only)
 *   - Price context sparkline below pillar grid
 *
 * Profile prop controls Infrastructure accordion visibility.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TVIRing } from '@/components/ui/TVIRing';
import { SunshineBarChart } from '@/components/map/SunshineBarChart';
import { TrendSparkline, type DataPoint } from '@/components/map/TrendSparkline';
import { ntiConsequence, type NtiSignal } from '@/lib/consequence-statements';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface School {
  name:       string;
  type:       string;
  levels:     string[] | null;
  distance_m: number;
}

interface HealthCentre {
  name:         string;
  type:         string;
  has_emergency: boolean;
  distance_m:   number;
}

interface AmenityCount {
  display_category: string;
  cnt:              number;
}

interface ClimateData {
  sunshine_hours_annual: number | null;
  sunshine_hours_jan:    number | null;
  sunshine_hours_feb:    number | null;
  sunshine_hours_mar:    number | null;
  sunshine_hours_apr:    number | null;
  sunshine_hours_may:    number | null;
  sunshine_hours_jun:    number | null;
  sunshine_hours_jul:    number | null;
  sunshine_hours_aug:    number | null;
  sunshine_hours_sep:    number | null;
  sunshine_hours_oct:    number | null;
  sunshine_hours_nov:    number | null;
  sunshine_hours_dec:    number | null;
  temp_mean_annual_c:    number | null;
  temp_mean_jan_c:       number | null;
  temp_mean_jul_c:       number | null;
  rainfall_annual_mm:    number | null;
  humidity_annual_pct:   number | null;
  days_above_35c_annual: number | null;
  hdd_annual:            number | null;
  cdd_annual:            number | null;
}

interface MonthlyGhi {
  ghi_jan: number | null; ghi_feb: number | null; ghi_mar: number | null;
  ghi_apr: number | null; ghi_may: number | null; ghi_jun: number | null;
  ghi_jul: number | null; ghi_aug: number | null; ghi_sep: number | null;
  ghi_oct: number | null; ghi_nov: number | null; ghi_dec: number | null;
  ghi_annual_kwh_m2: number | null;
}

/** Pre-computed per-postcode enrichment scores from zone_enrichment_scores view (migration 013). */
interface EnrichmentData {
  avg_noise_lden:           number | null;
  park_area_sqm_500m:       number | null;
  pedestrian_features_500m: number | null;
  cycle_features_500m:      number | null;
  nearest_beach_m:          number | null;
  daily_needs_count_400m:   number | null;
  school_avg_diagnostic:    number | null;
  bilingual_schools_1km:    number | null;
  daily_life_score:         number | null;
}

interface ZoneDetail {
  codigo_postal:             string;
  municipio:                 string | null;
  zone_tvi:                  number;
  school_score_norm:         number;
  health_score_norm:         number;
  community_score_norm:      number;
  flood_risk_score:          number;
  solar_score_norm:          number;
  connectivity_score_norm:   number;
  infrastructure_score_norm: number;
  nearest_school_m:          number | null;
  schools_400m:              number | null;
  nearest_gp_m:              number | null;
  nearest_emergency_m:       number | null;
  nearest_metro_m:           number | null;
  stops_400m:                number | null;
  avg_ghi:                   number | null;
  has_t10_flood:             boolean;
  has_t100_flood:            boolean;
  t10_coverage_pct:          number | null;
  vut_density_pct:           number | null;
  vut_active:                number | null;
  project_count:             number | null;
  schools_list:              School[];
  health_list:               HealthCentre[];
  amenity_context:           AmenityCount[];
  climate:                   ClimateData | null;
  signals:                   string[] | null;
  price_context:             { avg_price_sqm: number; sample_count: number } | null;
  vut_trend:                 DataPoint[] | null;
  monthly_ghi:               MonthlyGhi | null;
  enrichment:                EnrichmentData | null;
}

type PillarKey =
  | 'school_score_norm'
  | 'health_score_norm'
  | 'community_score_norm'
  | 'flood_risk_score'
  | 'solar_score_norm'
  | 'connectivity_score_norm'
  | 'infrastructure_score_norm';

export type ZonePanelProfile = 'family' | 'nomad' | 'retiree' | 'investor';

export interface ZoneDetailPanelProps {
  codigoPostal: string | null;
  onClose:      () => void;
  profile?:     ZonePanelProfile;
  /** Called to activate a named MapLibre layer from within an accordion. */
  onActivateLayer?: (layerId: string) => void;
  /**
   * When true, renders the zone content as an inline section inside another
   * panel (e.g. the pin report panel) rather than as a slide-in side panel.
   * No panel shell, no close button, no absolute positioning.
   */
  inline?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDist(m: number | null | undefined): string {
  if (m == null || m === 0) return '—';
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

function walkMins(m: number | null | undefined): string {
  if (m == null || m <= 0) return '—';
  const mins = Math.round(m / 80);
  return mins < 1 ? '< 1 min' : `≈${mins} min`;
}

function gradeLetter(score: number): string {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'E';
}

function gradeColour(score: number): { text: string; bg: string; border: string } {
  if (score >= 85) return { text: '#00C464', bg: 'rgba(0,196,100,0.12)',  border: '#00C464' };
  if (score >= 70) return { text: '#34C97A', bg: 'rgba(52,201,122,0.12)', border: '#34C97A' };
  if (score >= 55) return { text: '#D4820A', bg: 'rgba(212,130,10,0.12)', border: '#D4820A' };
  if (score >= 40) return { text: '#FBBF24', bg: 'rgba(251,191,36,0.12)', border: '#FBBF24' };
  return              { text: '#C94B1A', bg: 'rgba(201,75,26,0.12)',   border: '#C94B1A' };
}

function barColor(score: number): string {
  if (score >= 70) return '#34C97A';
  if (score >= 50) return '#D4820A';
  return '#C94B1A';
}

const SCHOOL_TYPE_LABEL: Record<string, string> = {
  publico: 'Public', concertado: 'Concertado', privado: 'Private',
};

const SIGNAL_META: Record<string, { label: string; variant: 'green' | 'amber' | 'red' }> = {
  school_rich:    { label: 'School-Rich Zone',    variant: 'green' },
  gp_close:       { label: 'GP Within 300m',      variant: 'green' },
  low_vut:        { label: 'Low Airbnb Density',  variant: 'green' },
  metro_incoming: { label: 'Metro Incoming',      variant: 'green' },
  high_solar:     { label: 'High Solar Exposure', variant: 'amber' },
  high_vut:       { label: 'High Airbnb Density', variant: 'amber' },
  flood_t10:      { label: 'T10 Flood Risk',      variant: 'red'   },
};

const SIGNAL_TAG_STYLES: Record<'green' | 'amber' | 'red', { bg: string; text: string; border: string }> = {
  green: { bg: 'rgba(52,201,122,0.12)',  text: '#34C97A', border: 'rgba(52,201,122,0.3)'  },
  amber: { bg: 'rgba(212,130,10,0.12)',  text: '#D4820A', border: 'rgba(212,130,10,0.3)'  },
  red:   { bg: 'rgba(201,75,26,0.12)',   text: '#F5A07A', border: 'rgba(201,75,26,0.3)'   },
};

// NTI signal derived from signals array (placeholder until dedicated column added)
function deriveNtiSignal(signals: string[] | null): NtiSignal | null {
  if (!signals) return null;
  if (signals.includes('prime_buy')) return 'prime_buy';
  if (signals.includes('nti_risk'))  return 'risk';
  if (signals.includes('too_late'))  return 'too_late';
  return null;
}

// ---------------------------------------------------------------------------
// Pillar config
// ---------------------------------------------------------------------------

const PILLARS: { key: PillarKey; label: string; icon: string; accordionId: string }[] = [
  { key: 'school_score_norm',         label: 'Schools',        icon: '🏫', accordionId: 'schools'     },
  { key: 'health_score_norm',         label: 'Health',         icon: '🏥', accordionId: 'health'      },
  { key: 'community_score_norm',      label: 'Community',      icon: '🏘', accordionId: 'community'   },
  { key: 'flood_risk_score',          label: 'Flood Safety',   icon: '🌊', accordionId: 'flood'       },
  { key: 'solar_score_norm',          label: 'Solar',          icon: '☀',  accordionId: 'solar'       },
  { key: 'connectivity_score_norm',   label: 'Connectivity',   icon: '🚇', accordionId: 'connectivity'},
  { key: 'infrastructure_score_norm', label: 'Future Value',   icon: '🏗', accordionId: 'infra'       },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 10, letterSpacing: '0.1em' }}
       className="uppercase text-[#8A9BB0] mb-2">
      {children}
    </p>
  );
}

function GradeBadge({ score }: { score: number }) {
  const grade = gradeLetter(score);
  const { text, bg, border } = gradeColour(score);
  return (
    <span style={{
      fontFamily: 'var(--font-dm-mono)', fontSize: 13, fontWeight: 700,
      color: text, background: bg, border: `1px solid ${border}`,
      borderRadius: 6, padding: '2px 8px', lineHeight: 1.4,
    }}>
      Grade {grade}
    </span>
  );
}

function SignalTag({ signal }: { signal: string }) {
  const meta  = SIGNAL_META[signal] ?? { label: signal.replace(/_/g, ' '), variant: 'amber' as const };
  const style = SIGNAL_TAG_STYLES[meta.variant];
  return (
    <span style={{
      fontFamily: 'var(--font-dm-sans)', fontSize: 11, fontWeight: 500,
      color: style.text, background: style.bg, border: `1px solid ${style.border}`,
      borderRadius: 20, padding: '3px 10px', whiteSpace: 'nowrap',
    }}>
      {meta.label}
    </span>
  );
}

/** Clickable horizontal pillar bar row */
function PillarBar({
  icon, label, score, open, onClick,
}: {
  icon: string; label: string; score: number; open: boolean; onClick: () => void;
}) {
  const color = barColor(score);
  const warn  = score < 50;
  return (
    <button
      onClick={onClick}
      style={{
        display:        'flex',
        alignItems:     'center',
        gap:            8,
        width:          '100%',
        background:     open ? 'rgba(255,255,255,0.04)' : 'transparent',
        border:         'none',
        borderRadius:   6,
        padding:        '7px 8px',
        cursor:         'pointer',
        transition:     'background 120ms',
      }}
    >
      <span aria-hidden style={{ fontSize: 13, width: 18, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
      <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#8A9BB0', width: 88, textAlign: 'left', flexShrink: 0 }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 8, background: '#1E3050', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${score}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 500ms ease-out' }} />
      </div>
      <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 12, color: '#FFFFFF', width: 24, textAlign: 'right', flexShrink: 0 }}>
        {Math.round(score)}
      </span>
      {warn && <span aria-label="Below average" style={{ fontSize: 11, flexShrink: 0 }}>⚠</span>}
      <span style={{ fontSize: 10, color: '#4A6080', flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
    </button>
  );
}

/** Accordion body wrapper */
function Accordion({ open, children }: { open: boolean; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div style={{
      background:   'rgba(255,255,255,0.03)',
      border:       '1px solid #1E3050',
      borderRadius: '0 0 8px 8px',
      padding:      '12px 14px',
      marginBottom: 4,
    }}>
      {children}
    </div>
  );
}

function AccordionRow({ label, value, link, onLink }: { label: string; value: string; link?: string; onLink?: () => void }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
      <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#8A9BB0' }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#C5D5E8' }}>
        {value}
        {link && onLink && (
          <button onClick={onLink} style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11, color: '#34C97A', background: 'none', border: 'none', marginLeft: 8, cursor: 'pointer', textDecoration: 'underline' }}>
            {link}
          </button>
        )}
      </span>
    </div>
  );
}

function AccordionNote({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11, color: '#4A6080', lineHeight: 1.5, marginTop: 6 }}>
      {children}
    </p>
  );
}

function ConsequenceCard({ signal, title, body }: { signal: 'green' | 'amber' | 'red'; title: string; body: string }) {
  const colors = {
    green: { border: '#34C97A', bg: 'rgba(52,201,122,0.07)' },
    amber: { border: '#D4820A', bg: 'rgba(212,130,10,0.07)' },
    red:   { border: '#C94B1A', bg: 'rgba(201,75,26,0.09)'  },
  }[signal];
  return (
    <div style={{ borderLeft: `3px solid ${colors.border}`, background: colors.bg, borderRadius: '0 6px 6px 0', padding: '10px 12px', marginBottom: 8 }}>
      <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, fontWeight: 600, color: '#FFFFFF', marginBottom: 4 }}>{title}</p>
      <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#C5D5E8', lineHeight: 1.5 }}>{body}</p>
    </div>
  );
}

function MapLink({ label, onClick }: { label: string; onClick?: () => void }) {
  if (!onClick) return null;
  return (
    <button onClick={onClick} style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11, color: '#34C97A', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline', marginTop: 6 }}>
      {label} →
    </button>
  );
}

function PanelSkeleton() {
  return (
    <div className="flex flex-col gap-5 animate-pulse">
      <div className="flex items-center gap-4">
        <div className="w-20 h-20 rounded-full bg-[#1E3050]" />
        <div className="flex-1 flex flex-col gap-2">
          <div className="h-7 w-24 rounded bg-[#1E3050]" />
          <div className="h-5 w-20 rounded bg-[#1E3050]" />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {[...Array(6)].map((_, i) => <div key={i} className="h-8 rounded bg-[#1E3050]" />)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Accordion content per pillar
// ---------------------------------------------------------------------------

function SchoolsAccordion({ data, onActivateLayer }: { data: ZoneDetail; onActivateLayer?: (l: string) => void }) {
  const nearby  = data.schools_list ?? [];
  const nearest = nearby[0];
  const pubCount  = nearby.filter(s => s.type === 'publico').length;
  const concCount = nearby.filter(s => s.type === 'concertado').length;
  const privCount = nearby.filter(s => s.type === 'privado').length;
  const typeSummary = [
    pubCount > 0  && `${pubCount} public`,
    concCount > 0 && `${concCount} concertado`,
    privCount > 0 && `${privCount} private`,
  ].filter(Boolean).join(', ');

  return (
    <>
      {nearest && (
        <AccordionRow
          label="Nearest school"
          value={`${nearest.name} · ${SCHOOL_TYPE_LABEL[nearest.type] ?? nearest.type} · ${walkMins(nearest.distance_m)}`}
        />
      )}
      {typeSummary && <AccordionRow label={`Within 1km (${nearby.length} total)`} value={typeSummary} />}
      <AccordionNote>
        School catchment boundaries overlap postcodes. Drop a pin for your specific address to confirm your catchment school.
      </AccordionNote>
      <MapLink label="Show schools on map" onClick={onActivateLayer ? () => onActivateLayer('schools') : undefined} />
    </>
  );
}

function HealthAccordion({ data, onActivateLayer }: { data: ZoneDetail; onActivateLayer?: (l: string) => void }) {
  const gp        = data.health_list?.find(h => h.type === 'centro_salud');
  const emergency = data.health_list?.find(h => h.has_emergency);
  const pharmacies = data.amenity_context?.find(a => a.display_category === 'pharmacy')?.cnt ?? 0;

  return (
    <>
      <AccordionRow label="Nearest GP"            value={gp        ? `${gp.name} · ${walkMins(gp.distance_m)}`        : '—'} />
      <AccordionRow label="Nearest 24h emergency" value={emergency ? `${emergency.name} · ${walkMins(emergency.distance_m)}` : '—'} />
      <AccordionRow label="Pharmacies within 500m" value={pharmacies > 0 ? `${pharmacies}` : 'None recorded'} />
      <MapLink label="Show health facilities on map" onClick={onActivateLayer ? () => onActivateLayer('health') : undefined} />
    </>
  );
}

function FloodAccordion({ data }: { data: ZoneDetail }) {
  const hasT10 = data.has_t10_flood;
  const pct    = data.t10_coverage_pct;

  if (hasT10 && pct != null) {
    return (
      <>
        <ConsequenceCard
          signal="red"
          title={`${pct.toFixed(1)}% of this postcode is within the T10 flood zone.`}
          body="Drop a property pin to check any specific address — the zone percentage does not tell you whether a specific property is inside or outside the polygon boundary."
        />
        <AccordionNote>Source: SNCZI (Spain&apos;s national flood mapping authority).</AccordionNote>
      </>
    );
  }
  return (
    <>
      <ConsequenceCard
        signal="green"
        title="No T10 flood zone exposure in this postcode."
        body="No properties in this postcode fall within the highest-risk T10 SNCZI designation."
      />
      <AccordionNote>Source: SNCZI (Spain&apos;s national flood mapping authority).</AccordionNote>
    </>
  );
}

function CommunityAccordion({ data }: { data: ZoneDetail }) {
  const vutActive  = data.vut_active ?? 0;
  const density    = data.vut_density_pct;
  const malagaAvg  = 8.4;
  const vsAvg      = density != null
    ? density > malagaAvg ? `${density.toFixed(1)}% — above the Málaga average of ${malagaAvg}%`
                          : `${density.toFixed(1)}% — below the Málaga average of ${malagaAvg}%`
    : null;

  const vutSignal = vutActive >= 11 ? 'red' : vutActive >= 4 ? 'amber' : 'green';

  return (
    <>
      <ConsequenceCard
        signal={vutSignal}
        title={`${vutActive} active tourist rental licence${vutActive === 1 ? '' : 's'} in this postcode.`}
        body={vsAvg ?? 'Tourist rental density data not available for this postcode.'}
      />
      {data.vut_trend && data.vut_trend.length >= 3 && (
        <div style={{ marginTop: 10 }}>
          <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 10, color: '#4A6080', marginBottom: 4, letterSpacing: '0.06em' }} className="uppercase">
            VUT application trend — 12 months
          </p>
          <TrendSparkline
            data={data.vut_trend}
            unit="applications/mo"
            size="inline"
            context="buyer"
          />
        </div>
      )}
    </>
  );
}

function SolarAccordion({ data }: { data: ZoneDetail }) {
  const c   = data.climate;
  const ghi = data.avg_ghi ?? data.monthly_ghi?.ghi_annual_kwh_m2 ?? null;

  // Prefer AEMET monthly sunshine hours; fall back to PVGIS monthly GHI.
  // Both represent seasonal solar variation — GHI (kWh/m²/day) is used as a
  // proxy for day length when AEMET data hasn't been ingested yet.
  const hasAemetMonthly = c &&
    c.sunshine_hours_jan != null && (c.sunshine_hours_jan > 0 || c.sunshine_hours_jul != null && c.sunshine_hours_jul > 0);

  const hasGhiMonthly = data.monthly_ghi &&
    data.monthly_ghi.ghi_jan != null && data.monthly_ghi.ghi_jul != null &&
    (data.monthly_ghi.ghi_jun ?? 0) > 0;

  type TwelveNums = [number,number,number,number,number,number,number,number,number,number,number,number];

  // Build chart values — AEMET hrs/day (preferred) or PVGIS kWh/m²/day (fallback)
  let chartValues: TwelveNums | null = null;
  let chartAnnual = 0;
  let chartUnit: 'hrs/day' | 'kWh/m²/day' = 'hrs/day';

  if (hasAemetMonthly) {
    chartValues = [
      c!.sunshine_hours_jan ?? 0, c!.sunshine_hours_feb ?? 0, c!.sunshine_hours_mar ?? 0,
      c!.sunshine_hours_apr ?? 0, c!.sunshine_hours_may ?? 0, c!.sunshine_hours_jun ?? 0,
      c!.sunshine_hours_jul ?? 0, c!.sunshine_hours_aug ?? 0, c!.sunshine_hours_sep ?? 0,
      c!.sunshine_hours_oct ?? 0, c!.sunshine_hours_nov ?? 0, c!.sunshine_hours_dec ?? 0,
    ];
    chartAnnual = c!.sunshine_hours_annual ?? 0;
    chartUnit   = 'hrs/day';
  } else if (hasGhiMonthly) {
    const g = data.monthly_ghi!;
    chartValues = [
      g.ghi_jan ?? 0, g.ghi_feb ?? 0, g.ghi_mar ?? 0, g.ghi_apr ?? 0,
      g.ghi_may ?? 0, g.ghi_jun ?? 0, g.ghi_jul ?? 0, g.ghi_aug ?? 0,
      g.ghi_sep ?? 0, g.ghi_oct ?? 0, g.ghi_nov ?? 0, g.ghi_dec ?? 0,
    ];
    chartAnnual = Math.round(g.ghi_annual_kwh_m2 ?? 0);
    chartUnit   = 'kWh/m²/day';
  }

  const ghiContext = ghi != null
    ? ghi >= 1800 ? 'One of the sunniest postcodes in Málaga.'
    : ghi >= 1600 ? 'Average solar exposure for Málaga.'
    : 'Below average solar exposure for the region.'
    : null;

  return (
    <>
      {ghi != null && (
        <div style={{ marginBottom: 10 }}>
          <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 20, fontWeight: 500, color: '#FFFFFF' }}>
            {Math.round(ghi).toLocaleString('es-ES')}
          </span>
          <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#8A9BB0', marginLeft: 6 }}>
            kWh/m² annual solar irradiance
          </span>
          {ghiContext && (
            <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11, color: '#8A9BB0', marginTop: 4 }}>{ghiContext}</p>
          )}
        </div>
      )}
      {chartValues && (
        <>
          <SunshineBarChart
            monthlyHours={chartValues}
            annualTotal={chartAnnual}
            locationName={data.municipio ?? undefined}
          />
          {chartUnit === 'kWh/m²/day' && (
            <AccordionNote>
              Bars show monthly solar irradiance (kWh/m²/day) from PVGIS.
              Sunshine hour data from AEMET not yet ingested for this station.
            </AccordionNote>
          )}
        </>
      )}
      {!chartValues && <AccordionNote>Monthly solar data not available for this postcode.</AccordionNote>}
    </>
  );
}

function ConnectivityAccordion({ data }: { data: ZoneDetail }) {
  return (
    <>
      <AccordionRow label="Nearest metro stop" value={fmtDist(data.nearest_metro_m)} />
      <AccordionRow label="Transit stops within 400m" value={data.stops_400m != null ? `${data.stops_400m}` : '—'} />
      <AccordionNote>
        Connectivity score reflects metro proximity, bus stop density, and infrastructure quality for this postcode.
      </AccordionNote>
    </>
  );
}

function InfrastructureAccordion({ data }: { data: ZoneDetail }) {
  const ntiSignal = deriveNtiSignal(data.signals);
  const ntiStmt   = ntiSignal ? ntiConsequence(ntiSignal) : null;
  const projectCount = data.project_count ?? 0;

  return (
    <>
      {ntiStmt ? (
        <ConsequenceCard
          signal={ntiStmt.signal === 'neutral' ? 'green' : ntiStmt.signal as 'green' | 'amber' | 'red'}
          title={ntiStmt.title}
          body={ntiStmt.body}
        />
      ) : (
        <AccordionNote>No NTI transition signal identified for this postcode.</AccordionNote>
      )}
      <AccordionRow
        label="Infrastructure projects within 2km"
        value={projectCount > 0 ? `${projectCount} project${projectCount > 1 ? 's' : ''}` : 'None approved'}
      />
      {data.signals?.includes('metro_incoming') && (
        <ConsequenceCard
          signal="green"
          title="Metro infrastructure project in progress nearby."
          body="Approved transit projects typically precede property price appreciation in adjacent zones."
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// QoL Enrichment section — shown below pillars when migration 013 data exists
// ---------------------------------------------------------------------------

/** Non-clickable horizontal bar row for enrichment scores */
function EnrichmentScoreRow({
  icon, label, score,
}: {
  icon: string; label: string; score: number | null;
}) {
  const color = score != null ? barColor(score) : '#2A4060';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px' }}>
      <span aria-hidden style={{ fontSize: 13, width: 18, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
      <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#8A9BB0', width: 110, textAlign: 'left', flexShrink: 0 }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 8, background: '#1E3050', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: score != null ? `${Math.min(score, 100)}%` : '0%', height: '100%', background: color, borderRadius: 4, transition: 'width 500ms ease-out' }} />
      </div>
      <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 12, color: score != null ? '#FFFFFF' : '#4A6080', width: 40, textAlign: 'right', flexShrink: 0 }}>
        {score != null ? Math.round(score) : '—'}
      </span>
    </div>
  );
}

/** Single stat fact row for non-scored enrichment fields */
function EnrichmentStatRow({ label, value }: { label: string; value: string }) {
  const isPending = value === 'Data pending';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '4px 8px' }}>
      <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#8A9BB0' }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 12, color: isPending ? '#4A6080' : '#C5D5E8', fontStyle: isPending ? 'italic' : 'normal' }}>
        {value}
      </span>
    </div>
  );
}

function QolEnrichmentSection({ enrichment }: { enrichment: EnrichmentData | null }) {
  const pending = 'Data pending';

  const noiseLden = enrichment?.avg_noise_lden;
  const noiseLabel = noiseLden != null
    ? `${Math.round(noiseLden)} dB Lden`
    : pending;

  const beachM = enrichment?.nearest_beach_m;
  const beachLabel = beachM != null
    ? beachM < 1000 ? `${Math.round(beachM)}m` : `${(beachM / 1000).toFixed(1)}km`
    : pending;

  const bilingual = enrichment?.bilingual_schools_1km;
  const bilingualLabel = bilingual != null
    ? bilingual === 0 ? 'None within 1km' : `${bilingual} within 1km`
    : pending;

  // Noise converted to a 0-100 score: 35dB or below → 100, 70dB → 0
  const noiseScore = noiseLden != null ? Math.max(0, Math.min(100, Math.round((70 - noiseLden) / 35 * 100))) : null;

  return (
    <section>
      <SectionLabel>Quality of Life</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <EnrichmentScoreRow
          icon="🚶"
          label="Daily Life"
          score={enrichment?.daily_life_score ?? null}
        />
        <EnrichmentScoreRow
          icon="🔊"
          label="Noise Level"
          score={noiseScore}
        />
        <EnrichmentStatRow label="Avg noise (Lden)" value={noiseLabel} />
        <EnrichmentStatRow label="Nearest beach"    value={beachLabel} />
        <EnrichmentStatRow label="Bilingual schools" value={bilingualLabel} />
        <EnrichmentStatRow label="Cost of living"   value={pending} />
      </div>
      {!enrichment && (
        <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11, color: '#4A6080', marginTop: 6 }}>
          Enrichment data is ingested nightly — check back after the first data run.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ZoneDetailPanel({
  codigoPostal,
  onClose,
  profile = 'family',
  onActivateLayer,
  inline = false,
}: ZoneDetailPanelProps) {
  const [data,       setData]       = useState<ZoneDetail | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [openPillar, setOpenPillar] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!codigoPostal) { setData(null); setError(null); setOpenPillar(null); return; }
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true); setData(null); setError(null); setOpenPillar(null);
    fetch(`/api/map/zone/${codigoPostal}`)
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json() as Promise<ZoneDetail>; })
      .then(json => { if (!cancelled) { setData(json); setLoading(false); } })
      .catch(() => { if (!cancelled) { setError('Could not load zone data. Please try again.'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [codigoPostal]);

  const isOpen = Boolean(codigoPostal);

  function togglePillar(id: string) {
    setOpenPillar(prev => prev === id ? null : id);
  }

  // ---- Shared content (rendered in both panel and inline modes) ----
  const content = (
    <>
      {loading && <PanelSkeleton />}
      {error && !loading && (
        <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13 }} className="text-[#F5A07A] text-center mt-4">
          {error}
        </p>
      )}
      {!loading && !error && !data && codigoPostal && (
        <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#4A6080' }}>
          Zone data not available for postcode {codigoPostal}.
        </p>
      )}

      {data && !loading && (
        <>
          {/* ---- 1. Header ---- */}
          <div className="flex items-center gap-4">
            <TVIRing score={data.zone_tvi} size="lg" />
            <div className="flex-1 min-w-0">
              <p style={{ fontFamily: 'var(--font-playfair)', fontSize: inline ? 22 : 28, lineHeight: 1.1 }}
                 className="text-white font-semibold">{data.codigo_postal}</p>
              {data.municipio && (
                <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11 }} className="text-[#8A9BB0] mt-0.5">{data.municipio}</p>
              )}
              <div className="flex items-center gap-2 mt-1.5">
                <GradeBadge score={data.zone_tvi} />
                {data.price_context && (
                  <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 12 }} className="text-[#8A9BB0]">
                    ~€{data.price_context.avg_price_sqm.toLocaleString()}/m²
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ---- 2. Signal badges ---- */}
          {data.signals && data.signals.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {data.signals.map(sig => <SignalTag key={sig} signal={sig} />)}
            </div>
          )}

          {/* ---- 3. Pillar score grid + accordions ---- */}
          <section>
            <SectionLabel>Zone Intelligence</SectionLabel>
            <div className="flex flex-col gap-0.5">
              {PILLARS.map(({ key, label, icon, accordionId }) => {
                if (accordionId === 'infra' && profile !== 'investor') return null;
                const score = typeof data[key] === 'number' ? Math.round(data[key] as number) : 50;
                const isExpanded = openPillar === accordionId;
                return (
                  <div key={key}>
                    <PillarBar
                      icon={icon}
                      label={label}
                      score={score}
                      open={isExpanded}
                      onClick={() => togglePillar(accordionId)}
                    />
                    <Accordion open={isExpanded}>
                      {accordionId === 'schools'      && <SchoolsAccordion      data={data} onActivateLayer={onActivateLayer} />}
                      {accordionId === 'health'       && <HealthAccordion       data={data} onActivateLayer={onActivateLayer} />}
                      {accordionId === 'flood'        && <FloodAccordion        data={data} />}
                      {accordionId === 'community'    && <CommunityAccordion    data={data} />}
                      {accordionId === 'solar'        && <SolarAccordion        data={data} />}
                      {accordionId === 'connectivity' && <ConnectivityAccordion data={data} />}
                      {accordionId === 'infra'        && <InfrastructureAccordion data={data} />}
                    </Accordion>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ---- 4. QoL Enrichment ---- */}
          <QolEnrichmentSection enrichment={data.enrichment ?? null} />

          {/* ---- 5. Price context ---- */}
          {data.price_context && (
            <section>
              <SectionLabel>Price Context</SectionLabel>
              <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 18, color: '#FFFFFF' }}>
                ~€{data.price_context.avg_price_sqm.toLocaleString()}/m²
              </p>
              <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11, color: '#4A6080', marginTop: 2 }}>
                Based on {data.price_context.sample_count} on-demand analyses in this postcode.
              </p>
            </section>
          )}

          {/* ---- 6. CTA — differs between panel and inline modes ---- */}
          {!inline && (
            <div className="mt-auto pt-2">
              <Link
                href="/"
                className="flex items-center justify-center gap-2 w-full py-3 rounded-lg text-sm font-semibold transition-colors"
                style={{ fontFamily: 'var(--font-dm-sans)', background: '#34C97A', color: '#0D1B2A', textDecoration: 'none' }}
              >
                Analyse a property in this zone →
              </Link>
            </div>
          )}
        </>
      )}
    </>
  );

  // ---- Inline mode: render as a plain section, no panel shell ----
  if (inline) {
    if (!codigoPostal) return null;
    return (
      <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <SectionLabel>Zone Intelligence</SectionLabel>
        {content}
      </section>
    );
  }

  // ---- Panel mode: slide-in side panel ----
  return (
    <div
      aria-label="Zone detail panel"
      className="absolute top-0 right-0 h-full z-20 flex flex-col overflow-hidden"
      style={{
        width: 380,
        background: 'rgba(13, 27, 42, 0.95)',
        backdropFilter: 'blur(24px)',
        borderLeft: '1px solid #1E3050',
        transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 250ms cubic-bezier(0.4, 0, 0.2, 1)',
        willChange: 'transform',
      }}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between px-5 pt-5 pb-4 shrink-0 border-b border-[#1E3050]">
        <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 10, letterSpacing: '0.1em' }}
           className="uppercase text-[#8A9BB0]">Zone Detail</p>
        <button onClick={onClose} aria-label="Close zone panel"
                className="text-[#8A9BB0] hover:text-white transition-colors leading-none text-lg">✕</button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">
        {content}
      </div>
    </div>
  );
}
