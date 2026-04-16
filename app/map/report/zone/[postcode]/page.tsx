/**
 * /map/report/zone/[postcode] — Zone Intelligence Report
 *
 * Full deep-dive zone report for a postcode. Shows all 7 pillar scores,
 * flood safety status, nearest schools and health centres, community
 * character (VUT density + amenities), solar/climate summary, price
 * context, and active signals.
 *
 * Server-rendered — all data fetched directly from PostGIS. AI narrative
 * generated via Haiku server action. SVG bar chart rendered server-side.
 */

import { notFound } from 'next/navigation';
import db from '@/lib/db';
import { generateZoneNarrative } from '@/app/actions/generateZoneNarrative';
import { ThemeToggle } from '@/components/report/ThemeToggle';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ZoneRow {
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
  vut_density_pct:           number | null;
  vut_active:                number | null;
  has_t10_flood:             boolean;
  has_t100_flood:            boolean;
  nearest_school_m:          number | null;
  schools_400m:              number;
  nearest_gp_m:              number | null;
  nearest_emergency_m:       number | null;
  nearest_supermarket_m:     number | null;
  nearest_park_m:            number | null;
  daily_necessities_400m:    number;
  avg_ghi:                   number | null;
  signals:                   string[] | null;
}

interface SchoolRow {
  name:       string;
  type:       string;
  levels:     string[] | null;
  distance_m: number;
}

interface HealthRow {
  name:          string;
  type:          string;
  has_emergency: boolean;
  distance_m:    number;
}

interface AmenityRow {
  display_category: string;
  cnt:              number;
}

interface ClimateRow {
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
  hdd_annual:            number | null;
  cdd_annual:            number | null;
}

interface PriceRow {
  avg_price_sqm: number | null;
  sample_count:  number;
}

interface EnrichmentRow {
  avg_noise_lden:           number | null;
  max_noise_lden:           number | null;
  park_count_500m:          number | null;
  park_area_sqm_500m:       number | null;
  pedestrian_features_500m: number | null;
  cycle_features_500m:      number | null;
  free_parking_count_1km:   number | null;
  nearest_beach_m:          number | null;
  daily_needs_count_400m:   number | null;
  school_avg_diagnostic:    number | null;
  bilingual_schools_1km:    number | null;
  daily_life_score:         number | null;
}

// ---------------------------------------------------------------------------
// Data fetch
// ---------------------------------------------------------------------------

async function getZoneData(postcode: string) {
  // Use allSettled so a slow query (e.g. price spatial join) can't cancel the page.
  // Each result is checked individually; failed queries return empty arrays.
  const [zoneRes, schoolRes, healthRes, amenityRes, climateRes, priceRes, enrichmentRes] =
    await Promise.allSettled([

      db`
        SELECT
          codigo_postal, municipio,
          zone_tvi::float,
          school_score_norm::float, health_score_norm::float,
          community_score_norm::float, flood_risk_score::float,
          solar_score_norm::float, connectivity_score_norm::float,
          infrastructure_score_norm::float,
          vut_density_pct::float, vut_active::int,
          has_t10_flood, has_t100_flood,
          nearest_school_m::float, schools_400m::int,
          nearest_gp_m::float, nearest_emergency_m::float,
          nearest_supermarket_m::float, nearest_park_m::float,
          daily_necessities_400m::int, avg_ghi::float, signals
        FROM zone_scores
        WHERE codigo_postal = ${postcode}
        LIMIT 1`,

      db`
        SELECT
          nombre AS name, tipo AS type, etapas AS levels,
          ROUND(ST_Distance(
            geom,
            (SELECT centroid::geography FROM postal_zones WHERE codigo_postal = ${postcode})
          )::numeric, 0) AS distance_m
        FROM schools
        WHERE ST_DWithin(
          geom,
          (SELECT centroid::geography FROM postal_zones WHERE codigo_postal = ${postcode}),
          1500
        )
        ORDER BY distance_m
        LIMIT 8`,

      db`
        SELECT
          nombre AS name, tipo AS type, is_24h AS has_emergency,
          ROUND(ST_Distance(
            geom,
            (SELECT centroid::geography FROM postal_zones WHERE codigo_postal = ${postcode})
          )::numeric, 0) AS distance_m
        FROM health_centres
        WHERE ST_DWithin(
          geom,
          (SELECT centroid::geography FROM postal_zones WHERE codigo_postal = ${postcode}),
          3000
        )
        ORDER BY distance_m
        LIMIT 6`,

      db`
        SELECT display_category, COUNT(DISTINCT nombre)::int AS cnt
        FROM amenities
        WHERE geom IS NOT NULL
          AND display_category != 'other'
          AND ST_DWithin(
            geom,
            (SELECT centroid::geography FROM postal_zones WHERE codigo_postal = ${postcode}),
            500
          )
        GROUP BY display_category
        ORDER BY cnt DESC`,

      db`
        SELECT
          sunshine_hours_annual::int,
          sunshine_hours_jan::float,  sunshine_hours_feb::float, sunshine_hours_mar::float,
          sunshine_hours_apr::float,  sunshine_hours_may::float, sunshine_hours_jun::float,
          sunshine_hours_jul::float,  sunshine_hours_aug::float, sunshine_hours_sep::float,
          sunshine_hours_oct::float,  sunshine_hours_nov::float, sunshine_hours_dec::float,
          temp_mean_annual_c::float, temp_mean_jan_c::float, temp_mean_jul_c::float,
          rainfall_annual_mm::int, hdd_annual::int, cdd_annual::int
        FROM climate_data
        WHERE municipio_name = (
          SELECT municipio FROM zone_scores WHERE codigo_postal = ${postcode} LIMIT 1
        )
        LIMIT 1`,

      db`
        SELECT ROUND(AVG(pph.price_per_sqm))::int AS avg_price_sqm, COUNT(*)::int AS sample_count
        FROM property_price_history pph
        JOIN analysis_cache ac ON pph.cache_id = ac.id
        WHERE pph.price_per_sqm IS NOT NULL
          AND ST_Intersects(
            ac.geom,
            (SELECT geom::geography FROM postal_zones WHERE codigo_postal = ${postcode})
          )
        HAVING COUNT(*) >= 3`,

      // QoL enrichment — zone_enrichment_scores materialized view (migration 013).
      // Fails gracefully if the view hasn't been created yet.
      db`
        SELECT
          avg_noise_lden::float,
          max_noise_lden::int,
          park_count_500m::int,
          park_area_sqm_500m::int,
          pedestrian_features_500m::int,
          cycle_features_500m::int,
          free_parking_count_1km::int,
          nearest_beach_m::int,
          daily_needs_count_400m::int,
          school_avg_diagnostic::float,
          bilingual_schools_1km::int,
          daily_life_score::float
        FROM zone_enrichment_scores
        WHERE codigo_postal = ${postcode}
        LIMIT 1`.catch(() => []),
    ]);

  const zoneRows       = zoneRes.status       === 'fulfilled' ? zoneRes.value       : [];
  const schoolRows     = schoolRes.status     === 'fulfilled' ? schoolRes.value     : [];
  const healthRows     = healthRes.status     === 'fulfilled' ? healthRes.value     : [];
  const amenityRows    = amenityRes.status    === 'fulfilled' ? amenityRes.value    : [];
  const climateRows    = climateRes.status    === 'fulfilled' ? climateRes.value    : [];
  const priceRows      = priceRes.status      === 'fulfilled' ? priceRes.value      : [];
  const enrichmentRows = enrichmentRes.status === 'fulfilled' ? enrichmentRes.value : [];

  return {
    zone:       (zoneRows[0]       as unknown as ZoneRow)       ?? null,
    schools:    schoolRows         as unknown as SchoolRow[],
    health:     healthRows         as unknown as HealthRow[],
    amenities:  amenityRows        as unknown as AmenityRow[],
    climate:    (climateRows[0]    as unknown as ClimateRow)    ?? null,
    price:      (priceRows[0]      as unknown as PriceRow)      ?? null,
    enrichment: (enrichmentRows[0] as unknown as EnrichmentRow) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTH_LABELS  = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Fallback: Málaga 30yr monthly sunshine totals (hours/month)
const MALAGA_MONTHLY_H = [185, 195, 227, 240, 270, 305, 345, 325, 255, 215, 190, 175];

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

function walkTime(m: number): string {
  const mins = Math.round(m / 80);
  if (mins < 1) return '< 1 min';
  return `${mins} min`;
}

function fmtDist(m: number): string {
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

const SIGNAL_META: Record<string, { label: string; variant: 'green' | 'amber' | 'red' }> = {
  school_rich:    { label: 'School-Rich Zone',    variant: 'green' },
  gp_close:       { label: 'GP Within 300m',      variant: 'green' },
  low_vut:        { label: 'Low Airbnb Density',  variant: 'green' },
  metro_incoming: { label: 'Metro Incoming',      variant: 'green' },
  high_solar:     { label: 'High Solar Exposure', variant: 'amber' },
  high_vut:       { label: 'High Airbnb Density', variant: 'amber' },
  flood_t10:      { label: 'T10 Flood Risk',      variant: 'red'   },
};

const SIGNAL_COLOURS: Record<'green' | 'amber' | 'red', { bg: string; text: string; border: string }> = {
  green: { bg: 'rgba(52,201,122,0.12)',  text: '#34C97A', border: 'rgba(52,201,122,0.3)'  },
  amber: { bg: 'rgba(212,130,10,0.12)',  text: '#D4820A', border: 'rgba(212,130,10,0.3)'  },
  red:   { bg: 'rgba(201,75,26,0.12)',   text: '#F5A07A', border: 'rgba(201,75,26,0.3)'   },
};

// Friendly names for amenity display categories
const AMENITY_LABELS: Record<string, string> = {
  restaurant:   'Restaurants',
  bar:          'Bars & Cafés',
  cafe:         'Cafés',
  supermarket:  'Supermarkets',
  park:         'Parks',
  pharmacy:     'Pharmacies',
  gym:          'Gyms',
  bank:         'Banks',
  school:       'Schools',
  health:       'Health',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{
      fontFamily:    'var(--font-dm-sans)',
      fontSize:      11,
      fontWeight:    700,
      letterSpacing: '0.1em',
      color:         '#8A9BB0',
      textTransform: 'uppercase' as const,
      marginBottom:  16,
      marginTop:     0,
    }}>
      {children}
    </h2>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background:   'var(--surface-2)',
      border:       '1px solid #E2E8F4',
      borderRadius: 10,
      padding:      '16px 18px',
      ...style,
    }}>
      {children}
    </div>
  );
}

function PillarBar({ label, score }: { label: string; score: number }) {
  const color = barColor(score);
  const grade = gradeLetter(score);
  const gc    = gradeColour(score);
  return (
    <div style={{ marginBottom: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, color: '#4A5D74' }}>
          {label}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 13, color: 'var(--navy-deep)' }}>
            {Math.round(score)}
          </span>
          <span style={{
            fontFamily:   'var(--font-dm-mono)',
            fontSize:     10,
            fontWeight:   700,
            color:        gc.text,
            background:   gc.bg,
            border:       `1px solid ${gc.border}`,
            borderRadius: 4,
            padding:      '1px 5px',
          }}>
            {grade}
          </span>
        </div>
      </div>
      <div style={{ height: 6, background: 'rgba(0,0,0,0.07)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(score, 2)}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
    </div>
  );
}

function DistanceRow({
  label,
  distanceM,
  extra,
}: {
  label:     string;
  distanceM: number | null | undefined;
  extra?:    React.ReactNode;
}) {
  if (distanceM == null) return null;
  return (
    <div style={{
      display:        'flex',
      justifyContent: 'space-between',
      alignItems:     'center',
      padding:        '10px 0',
      borderBottom:   '1px solid rgba(0,0,0,0.06)',
    }}>
      <div>
        <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 14, color: '#4A5D74' }}>{label}</span>
        {extra && <div style={{ marginTop: 2 }}>{extra}</div>}
      </div>
      <div style={{ textAlign: 'right' }}>
        <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 13, color: 'var(--navy-deep)', margin: 0 }}>
          {fmtDist(distanceM)}
        </p>
        <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11, color: '#4A6080', margin: 0 }}>
          ≈{walkTime(distanceM)}
        </p>
      </div>
    </div>
  );
}

// Server-side SVG sunshine bar chart (monthly totals, hours/month)
function SunshineBars({ monthlyH }: { monthlyH: number[] }) {
  const chartH = 72;
  const barW   = 20;
  const gap    = 5;
  const totalW = 12 * (barW + gap) - gap;
  // Guard against all-zero or missing data — prevents NaN in SVG attributes
  const maxH   = Math.max(...monthlyH.filter(h => isFinite(h)), 1);

  return (
    <svg
      width={totalW}
      height={chartH + 18}
      viewBox={`0 0 ${totalW} ${chartH + 18}`}
      style={{ width: '100%', maxWidth: 380, display: 'block' }}
    >
      {monthlyH.map((h, i) => {
        const barH = Math.max(Math.round((h / maxH) * chartH), 2);
        const x    = i * (barW + gap);
        const y    = chartH - barH;
        const ratio = h / maxH;
        // amber (low) → emerald (high) gradient
        const r    = Math.round(212 + (52  - 212) * ratio);
        const g    = Math.round(130 + (201 - 130) * ratio);
        const b    = Math.round(10  + (122 - 10)  * ratio);
        return (
          <g key={MONTH_LABELS[i]}>
            <rect x={x} y={y} width={barW} height={barH} fill={`rgb(${r},${g},${b})`} rx={3} opacity={0.9} />
            <text
              x={x + barW / 2}
              y={chartH + 13}
              textAnchor="middle"
              fill="#4A6080"
              fontSize={8}
              fontFamily="var(--font-dm-sans)"
            >
              {MONTH_LABELS[i][0]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface Props {
  params:      Promise<{ postcode: string }>;
  searchParams: Promise<{ lat?: string; lng?: string }>;
}

export default async function ZoneReportPage({ params, searchParams }: Props) {
  const { postcode } = await params;
  const sp = await searchParams;

  if (!/^\d{5}$/.test(postcode)) notFound();

  const { zone, schools, health, amenities, climate, price, enrichment } = await getZoneData(postcode);

  if (!zone) notFound();

  const backUrl = sp.lat && sp.lng
    ? `/map?lat=${sp.lat}&lng=${sp.lng}&pin=true`
    : '/map';

  const city     = zone.municipio ?? 'Málaga';
  const tvi      = Math.round(zone.zone_tvi);
  const grade    = gradeLetter(zone.zone_tvi);
  const gc       = gradeColour(zone.zone_tvi);
  const floodSafe = !zone.has_t10_flood && !zone.has_t100_flood;

  // ── Monthly sunshine hours ─────────────────────────────────────────────────
  const rawMonthlyH = climate?.sunshine_hours_jan != null
    ? [
        climate.sunshine_hours_jan  ?? 0,
        climate.sunshine_hours_feb  ?? 0,
        climate.sunshine_hours_mar  ?? 0,
        climate.sunshine_hours_apr  ?? 0,
        climate.sunshine_hours_may  ?? 0,
        climate.sunshine_hours_jun  ?? 0,
        climate.sunshine_hours_jul  ?? 0,
        climate.sunshine_hours_aug  ?? 0,
        climate.sunshine_hours_sep  ?? 0,
        climate.sunshine_hours_oct  ?? 0,
        climate.sunshine_hours_nov  ?? 0,
        climate.sunshine_hours_dec  ?? 0,
      ]
    : null;

  // Fall back to Málaga constants if the climate row has all-zero sunshine values
  // (indicates data was ingested but the sunshine columns were not populated).
  const monthlyH: number[] =
    rawMonthlyH && rawMonthlyH.some(h => h > 0) ? rawMonthlyH : MALAGA_MONTHLY_H;

  // Use || not ?? — sunshine_hours_annual can be 0 in the DB when not yet ingested,
  // and 0 ?? fallback = 0 (nullish coalescing ignores 0). We want the monthly sum fallback.
  const annualSunshineH = climate?.sunshine_hours_annual || monthlyH.reduce((s, h) => s + h, 0);

  const maxMonthlyH = Math.max(...monthlyH);
  const peakIdx     = monthlyH.indexOf(maxMonthlyH);
  const darkIdx     = monthlyH.indexOf(Math.min(...monthlyH));

  // ── AI narrative ──────────────────────────────────────────────────────────
  const aiNarrative = await generateZoneNarrative({
    postcode,
    city,
    tvi:             zone.zone_tvi,
    grade,
    floodSafe,
    hasT10Flood:     zone.has_t10_flood,
    schoolScore:     zone.school_score_norm,
    nearestSchoolM:  zone.nearest_school_m,
    schoolsIn400m:   zone.schools_400m,
    healthScore:     zone.health_score_norm,
    nearestGpM:      zone.nearest_gp_m,
    communityScore:  zone.community_score_norm,
    vutDensityPct:   zone.vut_density_pct,
    solarScore:      zone.solar_score_norm,
    annualSunshineH,
    avgPriceSqm:     price?.avg_price_sqm ?? null,
  });

  // ── Pillar rows ────────────────────────────────────────────────────────────
  const pillars = [
    { label: 'Schools',       score: zone.school_score_norm         },
    { label: 'Health',        score: zone.health_score_norm         },
    { label: 'Community',     score: zone.community_score_norm      },
    { label: 'Flood Safety',  score: zone.flood_risk_score          },
    { label: 'Solar',         score: zone.solar_score_norm          },
    { label: 'Connectivity',  score: zone.connectivity_score_norm   },
    { label: 'Future Value',  score: zone.infrastructure_score_norm },
  ];

  // ── Active signals ─────────────────────────────────────────────────────────
  const signals = Array.isArray(zone.signals) ? zone.signals : [];

  return (
    <div style={{
      minHeight:  '100vh',
      background: 'var(--background)',
      color:      'var(--text)',
      fontFamily: 'var(--font-dm-sans)',
    }}>

      {/* ── Sticky nav ──────────────────────────────────────────────────── */}
      <nav style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        padding:        '0 24px',
        height:         52,
        borderBottom:   '1px solid rgba(0,0,0,0.07)',
        position:       'sticky',
        top:            0,
        background:     'var(--surface-2)',
        zIndex:         10,
      }}>
        <a href={backUrl} style={{ fontSize: 13, color: '#8A9BB0', textDecoration: 'none' }}>
          ← Back to map
        </a>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <ThemeToggle />
          <span style={{ fontFamily: 'var(--font-playfair)', fontSize: 18, fontWeight: 600 }}>Qolify</span>
        </div>
      </nav>

      <main style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px 80px' }}>

        {/* ── Header ──────────────────────────────────────────────────── */}
        <p style={{
          fontSize:      11,
          letterSpacing: '0.12em',
          color:         '#8A9BB0',
          textTransform: 'uppercase',
          marginBottom:  8,
        }}>
          Zone Intelligence
        </p>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 4 }}>
          <h1 style={{
            fontFamily:   'var(--font-playfair)',
            fontSize:     32,
            fontWeight:   700,
            lineHeight:   1.15,
            margin:       0,
          }}>
            Postcode {postcode}
          </h1>
          {/* TVI grade badge */}
          <div style={{
            display:       'flex',
            flexDirection: 'column',
            alignItems:    'flex-end',
            gap:           2,
          }}>
            <span style={{
              fontFamily:   'var(--font-dm-mono)',
              fontSize:     11,
              fontWeight:   700,
              letterSpacing: '0.1em',
              color:        gc.text,
              background:   gc.bg,
              border:       `1px solid ${gc.border}`,
              borderRadius: 6,
              padding:      '3px 10px',
            }}>
              Grade {grade}
            </span>
            <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 22, fontWeight: 700, color: gc.text }}>
              {tvi}<span style={{ fontSize: 12, color: '#8A9BB0', fontWeight: 400 }}>/100</span>
            </span>
          </div>
        </div>
        <p style={{ fontSize: 14, color: '#8A9BB0', marginBottom: 8 }}>
          {city} · Zone Quality of Life Report
        </p>

        {/* Signals strip */}
        {signals.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 24 }}>
            {signals.map((sig) => {
              const meta   = SIGNAL_META[sig] ?? { label: sig.replace(/_/g, ' '), variant: 'amber' as const };
              const colours = SIGNAL_COLOURS[meta.variant];
              return (
                <span key={sig} style={{
                  fontFamily: 'var(--font-dm-sans)',
                  fontSize:   11,
                  fontWeight: 500,
                  color:      colours.text,
                  background: colours.bg,
                  border:     `1px solid ${colours.border}`,
                  borderRadius: 20,
                  padding:    '3px 10px',
                  whiteSpace: 'nowrap',
                }}>
                  {meta.label}
                </span>
              );
            })}
          </div>
        )}

        <div style={{ height: 1, background: 'rgba(0,0,0,0.07)', marginBottom: 32 }} />

        {/* ── AI narrative ────────────────────────────────────────────── */}
        {aiNarrative && (
          <p style={{
            fontSize:    15,
            color:       '#4A5D74',
            lineHeight:  1.7,
            marginBottom: 36,
            borderLeft:  '3px solid #34C97A',
            paddingLeft: 16,
          }}>
            {aiNarrative}
          </p>
        )}

        {/* ── Pillar scores ────────────────────────────────────────────── */}
        <section style={{ marginBottom: 40 }}>
          <SectionHeading>Pillar Scores</SectionHeading>
          <Card>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px 32px' }}>
              {pillars.map((p) => (
                <PillarBar key={p.label} label={p.label} score={p.score} />
              ))}
            </div>
          </Card>
        </section>

        {/* ── Flood safety ─────────────────────────────────────────────── */}
        <section style={{ marginBottom: 40 }}>
          <SectionHeading>Flood Safety</SectionHeading>
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: zone.has_t10_flood || zone.has_t100_flood ? 12 : 0 }}>
              <span style={{ fontSize: 20 }}>{floodSafe ? '✓' : '⚠'}</span>
              <div>
                <p style={{
                  fontFamily: 'var(--font-dm-sans)',
                  fontSize:   14,
                  fontWeight: 600,
                  color:      floodSafe ? '#34C97A' : zone.has_t10_flood ? '#F5A07A' : '#D4820A',
                  margin:     0,
                }}>
                  {floodSafe
                    ? 'Outside all SNCZI flood zones'
                    : zone.has_t10_flood
                      ? 'T10 flood zone — high frequency risk'
                      : 'T100 flood zone — lower frequency risk'}
                </p>
                <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#8A9BB0', margin: '3px 0 0' }}>
                  {floodSafe
                    ? 'No recorded flood risk from SNCZI. Check individual plots for local drainage issues.'
                    : zone.has_t10_flood
                      ? 'This postcode intersects a zone that floods on average every 10 years. Affects insurance, mortgage, and resale.'
                      : 'This postcode is in a T100 zone (floods less than once per century on average). Worth noting on insurance.'}
                </p>
              </div>
            </div>
          </Card>
        </section>

        {/* ── Schools ─────────────────────────────────────────────────── */}
        <section style={{ marginBottom: 40 }}>
          <SectionHeading>Schools within 1.5km</SectionHeading>
          {schools.length === 0 ? (
            <Card>
              <p style={{ fontSize: 14, color: '#4A6080' }}>No schools found within 1.5km of this postcode centroid.</p>
            </Card>
          ) : (
            <Card style={{ padding: '4px 18px' }}>
              {schools.map((s, i) => {
                const t    = (s.type ?? '').toLowerCase();
                const isInt = t.includes('internacional') || t.includes('international') || t.includes('british');
                const isPri = t.includes('ceip') || t.includes('primaria') || t.includes('infantil');
                const isSec = t.includes('ies') || t.includes('secundaria') || t.includes('bachiller');
                const badgeColor = isInt ? '#A78BFA' : isPri ? '#34C97A' : isSec ? '#D4820A' : '#8A9BB0';
                const badgeLabel = isInt ? 'International' : isPri ? 'Primary' : isSec ? 'Secondary' : s.type;
                return (
                  <DistanceRow
                    key={i}
                    label={s.name}
                    distanceM={s.distance_m}
                    extra={
                      <span style={{
                        fontSize: 10, fontWeight: 600,
                        color: badgeColor, background: `${badgeColor}20`,
                        border: `1px solid ${badgeColor}40`,
                        borderRadius: 4, padding: '1px 7px',
                      }}>
                        {badgeLabel}
                      </span>
                    }
                  />
                );
              })}
            </Card>
          )}
          <p style={{ fontSize: 11, color: '#4A6080', marginTop: 8 }}>
            {zone.schools_400m} school{zone.schools_400m !== 1 ? 's' : ''} within 400m of postcode centroid.{' '}
            <a
              href={`/map/report/education/${postcode}?lat=${sp.lat ?? ''}&lng=${sp.lng ?? ''}`}
              style={{ color: '#34C97A', textDecoration: 'none' }}
            >
              Full education report →
            </a>
          </p>
        </section>

        {/* ── Healthcare ──────────────────────────────────────────────── */}
        {health.length > 0 && (
          <section style={{ marginBottom: 40 }}>
            <SectionHeading>Healthcare within 3km</SectionHeading>
            <Card style={{ padding: '4px 18px' }}>
              {health.map((h, i) => (
                <DistanceRow
                  key={i}
                  label={h.name}
                  distanceM={h.distance_m}
                  extra={
                    h.has_emergency ? (
                      <span style={{
                        fontSize: 10, fontWeight: 600, color: '#F5A07A',
                        background: 'rgba(201,75,26,0.12)',
                        border: '1px solid rgba(201,75,26,0.3)',
                        borderRadius: 4, padding: '1px 7px',
                      }}>
                        24h Emergency
                      </span>
                    ) : undefined
                  }
                />
              ))}
            </Card>
          </section>
        )}

        {/* ── Community & Amenities ─────────────────────────────────── */}
        <section style={{ marginBottom: 40 }}>
          <SectionHeading>Community Character</SectionHeading>
          <Card>
            {/* VUT density */}
            <div style={{ marginBottom: amenities.length > 0 ? 16 : 0 }}>
              <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#8A9BB0', marginBottom: 6 }}>
                Tourist rental density (VUT)
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, height: 6, background: 'rgba(0,0,0,0.07)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    width:        `${Math.min(zone.vut_density_pct ?? 0, 100)}%`,
                    height:       '100%',
                    background:   (zone.vut_density_pct ?? 0) > 10 ? '#C94B1A' : (zone.vut_density_pct ?? 0) > 5 ? '#D4820A' : '#34C97A',
                    borderRadius: 3,
                  }} />
                </div>
                <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 13, color: 'var(--navy-deep)', minWidth: 48 }}>
                  {zone.vut_density_pct != null ? `${zone.vut_density_pct.toFixed(1)}%` : '—'}
                </span>
              </div>
              {zone.vut_active != null && (
                <p style={{ fontSize: 12, color: '#8A9BB0', marginTop: 5 }}>
                  {zone.vut_active} active tourist rental licence{zone.vut_active !== 1 ? 's' : ''} in postcode
                </p>
              )}
            </div>

            {/* Amenity counts grid */}
            {amenities.length > 0 && (
              <>
                <div style={{ height: 1, background: 'rgba(0,0,0,0.06)', margin: '12px 0' }} />
                <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#8A9BB0', marginBottom: 10 }}>
                  Amenities within 500m
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px 12px' }}>
                  {amenities.map((a) => (
                    <div key={a.display_category}>
                      <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 18, fontWeight: 600, color: 'var(--navy-deep)', margin: 0 }}>
                        {a.cnt}
                      </p>
                      <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11, color: '#8A9BB0', margin: 0 }}>
                        {AMENITY_LABELS[a.display_category] ?? a.display_category}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>
          <p style={{ fontSize: 11, color: '#4A6080', marginTop: 8 }}>
            <a
              href={`/map/report/community/${postcode}?lat=${sp.lat ?? ''}&lng=${sp.lng ?? ''}`}
              style={{ color: '#34C97A', textDecoration: 'none' }}
            >
              Full community report →
            </a>
          </p>
        </section>

        {/* ── Solar & Climate ──────────────────────────────────────────── */}
        <section style={{ marginBottom: 40 }}>
          <SectionHeading>Solar &amp; Climate — {city}</SectionHeading>
          <Card>
            {/* Sunshine bar chart */}
            <SunshineBars monthlyH={monthlyH} />

            <div style={{ marginTop: 14 }}>
              <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 24, fontWeight: 600, color: 'var(--navy-deep)' }}>
                {annualSunshineH.toLocaleString('es-ES')}
              </span>
              <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#8A9BB0', marginLeft: 8 }}>
                sunshine hours per year
              </span>
            </div>
            <p style={{ fontSize: 12, color: '#8A9BB0', marginTop: 4 }}>
              Peak month: <span style={{ color: '#34C97A' }}>{MONTH_LABELS[peakIdx]}</span> ({monthlyH[peakIdx]} hrs)
              {' · '}
              Lowest: <span style={{ color: '#D4820A' }}>{MONTH_LABELS[darkIdx]}</span> ({monthlyH[darkIdx]} hrs)
            </p>

            {zone.avg_ghi != null && (
              <p style={{ fontSize: 12, color: '#8A9BB0', marginTop: 2 }}>
                Annual solar irradiance:{' '}
                <span style={{ fontFamily: 'var(--font-dm-mono)', color: '#4A5D74' }}>
                  {Math.round(zone.avg_ghi).toLocaleString('es-ES')} kWh/m²
                </span>
              </p>
            )}

            {/* Temperature + rainfall row */}
            {(climate?.temp_mean_annual_c != null || climate?.rainfall_annual_mm != null) && (
              <>
                <div style={{ height: 1, background: 'rgba(0,0,0,0.06)', margin: '14px 0' }} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                  {climate?.temp_mean_annual_c != null && (
                    <div>
                      <p style={{ fontSize: 11, color: '#4A6080', marginBottom: 2 }}>Annual mean temp</p>
                      <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 18, color: 'var(--navy-deep)', margin: 0 }}>
                        {climate.temp_mean_annual_c.toFixed(1)}°C
                      </p>
                    </div>
                  )}
                  {climate?.rainfall_annual_mm != null && (
                    <div>
                      <p style={{ fontSize: 11, color: '#4A6080', marginBottom: 2 }}>Annual rainfall</p>
                      <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 18, color: 'var(--navy-deep)', margin: 0 }}>
                        {climate.rainfall_annual_mm} mm
                      </p>
                    </div>
                  )}
                  {climate?.hdd_annual != null && (
                    <div>
                      <p style={{ fontSize: 11, color: '#4A6080', marginBottom: 2 }}>Heating degree days</p>
                      <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 18, color: 'var(--navy-deep)', margin: 0 }}>
                        {climate.hdd_annual}
                      </p>
                      <p style={{ fontSize: 11, color: '#34C97A', marginTop: 2 }}>
                        {climate.hdd_annual < 500 ? 'Low heating costs' : 'Moderate heating costs'}
                      </p>
                    </div>
                  )}
                  {climate?.cdd_annual != null && (
                    <div>
                      <p style={{ fontSize: 11, color: '#4A6080', marginBottom: 2 }}>Cooling degree days</p>
                      <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 18, color: 'var(--navy-deep)', margin: 0 }}>
                        {climate.cdd_annual}
                      </p>
                      <p style={{ fontSize: 11, color: '#D4820A', marginTop: 2 }}>
                        {climate.cdd_annual < 400 ? 'Moderate cooling costs' : 'Higher cooling costs'}
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}

            <p style={{ fontSize: 11, color: '#4A6080', marginTop: 14 }}>
              <a
                href={`/map/report/solar/none?postcode=${postcode}&lat=${sp.lat ?? ''}&lng=${sp.lng ?? ''}`}
                style={{ color: '#D4820A', textDecoration: 'none' }}
              >
                Full solar analysis for a specific building →
              </a>
            </p>
          </Card>
        </section>

        {/* ── Price context ────────────────────────────────────────────── */}
        <section style={{ marginBottom: 40 }}>
          <SectionHeading>Price Context</SectionHeading>
          {price?.avg_price_sqm != null ? (
            <Card>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 28, fontWeight: 600, color: 'var(--navy-deep)' }}>
                  €{price.avg_price_sqm.toLocaleString('es-ES')}
                </span>
                <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, color: '#8A9BB0' }}>
                  per m²
                </span>
              </div>
              <p style={{ fontSize: 12, color: '#4A6080', marginTop: 6 }}>
                Based on {price.sample_count} on-demand analys{price.sample_count === 1 ? 'is' : 'es'} within this postcode.
                Not a formal valuation — use as a rough benchmark only.
              </p>
            </Card>
          ) : (
            <Card>
              <p style={{ fontSize: 14, color: '#4A6080' }}>
                No price data yet for this postcode — we need at least 3 analysed properties to show a benchmark.
                Analyse a property in this area to contribute to the dataset.
              </p>
            </Card>
          )}
        </section>

        {/* ── Proximity overview ───────────────────────────────────────── */}
        <section style={{ marginBottom: 40 }}>
          <SectionHeading>Key Distances from Zone Centroid</SectionHeading>
          <Card style={{ padding: '4px 18px' }}>
            <DistanceRow label="Nearest school"       distanceM={zone.nearest_school_m} />
            <DistanceRow label="Nearest GP surgery"   distanceM={zone.nearest_gp_m} />
            {zone.nearest_emergency_m != null && zone.nearest_emergency_m < 5000 && (
              <DistanceRow label="Nearest emergency centre" distanceM={zone.nearest_emergency_m} />
            )}
            <DistanceRow label="Nearest supermarket"  distanceM={zone.nearest_supermarket_m} />
            <DistanceRow label="Nearest park"         distanceM={zone.nearest_park_m} />
          </Card>
          <p style={{ fontSize: 11, color: '#4A6080', marginTop: 8 }}>
            Distances measured from postcode centroid. Drop a pin for distances from your exact address.
          </p>
        </section>

        {/* ── QoL Enrichment ───────────────────────────────────────────── */}
        {/* Only renders when at least one real enrichment value is present.      */}
        {/* daily_life_score = 0 means the view exists but ingest hasn't run yet  */}
        {/* — we suppress the section rather than show 0/100 for every indicator. */}
        {enrichment != null && (
          (enrichment.daily_life_score != null && enrichment.daily_life_score > 0)
          || enrichment.avg_noise_lden != null
          || enrichment.nearest_beach_m != null
          || (enrichment.park_count_500m != null && enrichment.park_count_500m > 0)
        ) && (
          <section style={{ marginBottom: 40 }}>
            <SectionHeading>Quality of Life Enrichment</SectionHeading>
            <Card>

              {/* Daily Life Score — pre-computed in zone_enrichment_scores */}
              {enrichment.daily_life_score != null && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, color: '#4A5D74' }}>
                      Daily Life Score
                    </span>
                    <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 13, color: 'var(--navy-deep)' }}>
                      {Math.round(enrichment.daily_life_score)}/100
                    </span>
                  </div>
                  <div style={{ height: 6, background: 'rgba(0,0,0,0.07)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{
                      width:        `${Math.max(enrichment.daily_life_score, 2)}%`,
                      height:       '100%',
                      background:   barColor(enrichment.daily_life_score),
                      borderRadius: 3,
                    }} />
                  </div>
                  <p style={{ fontSize: 11, color: '#4A6080', marginTop: 4 }}>
                    Walkability · mobility · green space · beach proximity
                  </p>
                </div>
              )}

              {/* Data grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px 24px' }}>

                {enrichment.avg_noise_lden != null && (
                  <div>
                    <p style={{ fontSize: 11, color: '#4A6080', marginBottom: 2 }}>Avg noise (Lden)</p>
                    <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 17, color: 'var(--navy-deep)', margin: 0 }}>
                      {enrichment.avg_noise_lden} dB
                    </p>
                    <p style={{ fontSize: 11, color: enrichment.avg_noise_lden >= 65 ? '#C94B1A' : enrichment.avg_noise_lden >= 55 ? '#D4820A' : '#34C97A', marginTop: 2 }}>
                      {enrichment.avg_noise_lden >= 65 ? 'High noise area' : enrichment.avg_noise_lden >= 55 ? 'Moderate noise' : 'Quiet zone'}
                    </p>
                  </div>
                )}

                {enrichment.park_area_sqm_500m != null && (
                  <div>
                    <p style={{ fontSize: 11, color: '#4A6080', marginBottom: 2 }}>Park area (500m)</p>
                    <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 17, color: 'var(--navy-deep)', margin: 0 }}>
                      {enrichment.park_area_sqm_500m.toLocaleString('es-ES')} m²
                    </p>
                    {enrichment.park_count_500m != null && (
                      <p style={{ fontSize: 11, color: '#4A6080', marginTop: 2 }}>
                        {enrichment.park_count_500m} park{enrichment.park_count_500m !== 1 ? 's' : ''}
                      </p>
                    )}
                  </div>
                )}

                {(enrichment.pedestrian_features_500m != null || enrichment.cycle_features_500m != null) && (
                  <div>
                    <p style={{ fontSize: 11, color: '#4A6080', marginBottom: 2 }}>Active mobility (500m)</p>
                    <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 17, color: 'var(--navy-deep)', margin: 0 }}>
                      {(enrichment.pedestrian_features_500m ?? 0) + (enrichment.cycle_features_500m ?? 0)}
                    </p>
                    <p style={{ fontSize: 11, color: '#4A6080', marginTop: 2 }}>
                      pedestrian &amp; cycle features
                    </p>
                  </div>
                )}

                {enrichment.nearest_beach_m != null && (
                  <div>
                    <p style={{ fontSize: 11, color: '#4A6080', marginBottom: 2 }}>Nearest beach</p>
                    <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 17, color: 'var(--navy-deep)', margin: 0 }}>
                      {enrichment.nearest_beach_m < 1000
                        ? `${enrichment.nearest_beach_m} m`
                        : `${(enrichment.nearest_beach_m / 1000).toFixed(1)} km`}
                    </p>
                  </div>
                )}

                {enrichment.bilingual_schools_1km != null && enrichment.bilingual_schools_1km > 0 && (
                  <div>
                    <p style={{ fontSize: 11, color: '#4A6080', marginBottom: 2 }}>Bilingual schools (1km)</p>
                    <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 17, color: '#34C97A', margin: 0 }}>
                      {enrichment.bilingual_schools_1km}
                    </p>
                  </div>
                )}

                {enrichment.school_avg_diagnostic != null && (
                  <div>
                    <p style={{ fontSize: 11, color: '#4A6080', marginBottom: 2 }}>School diagnostic avg</p>
                    <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 17, color: 'var(--navy-deep)', margin: 0 }}>
                      {Math.round(enrichment.school_avg_diagnostic)}/100
                    </p>
                  </div>
                )}

              </div>

              <p style={{ fontSize: 11, color: '#4A6080', marginTop: 14 }}>
                QoL data from EEA noise maps, OSM pedestrian infrastructure, and school diagnostic results.
                Updated nightly.
              </p>
            </Card>
          </section>
        )}

        {/* ── Footer ───────────────────────────────────────────────────── */}
        <footer style={{
          borderTop:  '1px solid rgba(0,0,0,0.06)',
          paddingTop: 20,
          marginTop:  20,
        }}>
          <p style={{ fontSize: 11, color: '#4A6080', lineHeight: 1.7 }}>
            Zone scores calculated from OpenStreetMap (schools, health, amenities), SNCZI (flood zones),
            PVGIS/JRC (solar), AEMET (climate normals), and on-demand property analyses.
            Data updated monthly. Not a substitute for professional surveying or legal due diligence.
          </p>
        </footer>

      </main>
    </div>
  );
}
