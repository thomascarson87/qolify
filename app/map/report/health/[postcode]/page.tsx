/**
 * /map/report/health/[postcode] — CHI-391
 *
 * Health Security deep-dive report for a postcode.
 *
 * Shows: nearest GP, hospital, urgencias_24h with estimated drive times;
 * CCAA-level waiting times from health_waiting_times; pharmacy count;
 * AI narrative; data source footer.
 *
 * Tier gate: Intelligence. Lower tiers see an upgrade prompt.
 *
 * Server-rendered. Back link returns to map with pin coords if provided.
 */

import { notFound } from 'next/navigation';
import db from '@/lib/db';
import { createClient } from '@/lib/supabase/server';
import { generateHealthNarrative } from '@/app/actions/generateHealthNarrative';
import { ThemeToggle } from '@/components/report/ThemeToggle';

// ---------------------------------------------------------------------------
// Province → Comunidad Autónoma mapping
// ---------------------------------------------------------------------------

const PROV_TO_CCAA: Record<string, string> = {
  // Andalucía
  'Almería': 'Andalucía', 'Cádiz': 'Andalucía', 'Córdoba': 'Andalucía',
  'Granada': 'Andalucía', 'Huelva': 'Andalucía', 'Jaén': 'Andalucía',
  'Málaga':  'Andalucía', 'Sevilla': 'Andalucía',
  // Aragón
  'Huesca': 'Aragón', 'Teruel': 'Aragón', 'Zaragoza': 'Aragón',
  // Castilla y León
  'Ávila': 'Castilla y León', 'Burgos': 'Castilla y León', 'León': 'Castilla y León',
  'Palencia': 'Castilla y León', 'Salamanca': 'Castilla y León', 'Segovia': 'Castilla y León',
  'Soria': 'Castilla y León', 'Valladolid': 'Castilla y León', 'Zamora': 'Castilla y León',
  // Castilla-La Mancha
  'Albacete': 'Castilla-La Mancha', 'Ciudad Real': 'Castilla-La Mancha',
  'Cuenca': 'Castilla-La Mancha', 'Guadalajara': 'Castilla-La Mancha', 'Toledo': 'Castilla-La Mancha',
  // Cataluña
  'Barcelona': 'Cataluña', 'Girona': 'Cataluña', 'Lleida': 'Cataluña', 'Tarragona': 'Cataluña',
  // Comunitat Valenciana
  'Alicante': 'Comunitat Valenciana', 'Castellón': 'Comunitat Valenciana', 'Valencia': 'Comunitat Valenciana',
  // Others
  'Madrid':    'Comunidad de Madrid',
  'Navarra':   'Comunidad Foral de Navarra',
  'Cantabria': 'Cantabria',
  'Asturias':  'Principado de Asturias',
  'Murcia':    'Región de Murcia',
  'La Rioja':  'La Rioja',
  'Bizkaia': 'País Vasco', 'Gipuzkoa': 'País Vasco', 'Álava': 'País Vasco',
  'A Coruña': 'Galicia', 'Lugo': 'Galicia', 'Ourense': 'Galicia', 'Pontevedra': 'Galicia',
  'Badajoz': 'Extremadura', 'Cáceres': 'Extremadura',
  'Baleares': 'Illes Balears',
  'Las Palmas': 'Canarias', 'Santa Cruz de Tenerife': 'Canarias',
  'Ceuta': 'Ceuta', 'Melilla': 'Melilla',
};

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
// Data types
// ---------------------------------------------------------------------------

interface HealthCentre {
  nombre:       string;
  tipo:         string;
  is_24h:       boolean;
  distance_m:   number;
  provincia:    string | null;
  municipio:    string | null;
}

interface WaitingTimes {
  comunidad_autonoma:   string;
  avg_days_gp:          number | null;
  avg_days_specialist:  number | null;
  avg_days_surgery:     number | null;
  surgery_waiting_list: number | null;
  recorded_quarter:     string;
}

interface ZoneScore {
  health_score_norm: number | null;
  municipio:         string | null;
}

// ---------------------------------------------------------------------------
// Data fetchers
// ---------------------------------------------------------------------------

async function getHealthData(postcode: string): Promise<{
  gp:            HealthCentre | null;
  hospital:      HealthCentre | null;
  urgencias:     HealthCentre | null;
  pharmacies:    number;
  zone:          ZoneScore | null;
}> {
  const [centresRows, pharmacyRows, zoneRows] = await Promise.all([
    db`
      SELECT
        nombre,
        tipo,
        is_24h,
        ROUND(ST_Distance(
          geom,
          (SELECT centroid::geography FROM postal_zones WHERE codigo_postal = ${postcode})
        )::numeric, 0) AS distance_m,
        provincia,
        municipio
      FROM health_centres
      WHERE ST_DWithin(
        geom,
        (SELECT centroid::geography FROM postal_zones WHERE codigo_postal = ${postcode}),
        25000
      )
      ORDER BY distance_m
      LIMIT 30`,

    db`
      SELECT COUNT(*)::int AS cnt
      FROM amenities
      WHERE display_category = 'pharmacy'
        AND ST_DWithin(
          geom,
          (SELECT centroid::geography FROM postal_zones WHERE codigo_postal = ${postcode}),
          500
        )`,

    db`
      SELECT health_score_norm::float, municipio
      FROM zone_scores
      WHERE codigo_postal = ${postcode}
      LIMIT 1`,
  ]);

  const centres = centresRows as unknown as HealthCentre[];

  const gp        = centres.find(c => c.tipo === 'centro_salud') ?? null;
  const hospital  = centres.find(c => c.tipo === 'hospital') ?? null;
  const urgencias = centres.find(c => c.tipo === 'urgencias_24h' || c.is_24h) ?? null;
  const pharmacies = (pharmacyRows[0] as unknown as { cnt: number }).cnt ?? 0;
  const zone       = (zoneRows[0] as unknown as ZoneScore) ?? null;

  return { gp, hospital, urgencias, pharmacies, zone };
}

async function getWaitingTimes(provincia: string | null): Promise<WaitingTimes | null> {
  const ccaa = provincia ? (PROV_TO_CCAA[provincia] ?? null) : null;
  if (!ccaa) return null;

  try {
    const rows = await db`
      SELECT
        comunidad_autonoma,
        avg_days_gp::float,
        avg_days_specialist::float,
        avg_days_surgery::float,
        surgery_waiting_list::int,
        recorded_quarter::text
      FROM health_waiting_times
      WHERE comunidad_autonoma = ${ccaa}
      ORDER BY recorded_quarter DESC
      LIMIT 1`;
    return (rows[0] as unknown as WaitingTimes) ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDist(m: number): string {
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

function driveTime(m: number): string {
  const mins = Math.round((m / 1000) / 30 * 60);
  if (mins < 1) return '< 1 min drive';
  if (mins < 5) return `${mins} min drive`;
  return `${mins} min drive`;
}

function walkTime(m: number): string {
  const mins = Math.round(m / 80);
  if (mins < 1) return '< 1 min walk';
  return `${mins} min walk`;
}

function scoreColour(score: number): string {
  if (score >= 70) return '#34C97A';
  if (score >= 40) return '#D4820A';
  return '#C94B1A';
}

// ---------------------------------------------------------------------------
// Gate page — shown when tier < intelligence
// ---------------------------------------------------------------------------

function UpgradeGate({ backUrl }: { backUrl: string }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)', color: 'var(--text)', fontFamily: 'var(--font-dm-sans)' }}>
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', height: 52, borderBottom: '1px solid rgba(0,0,0,0.07)',
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
        <span style={{ fontSize: 32 }}>🔒</span>
        <h1 style={{ fontFamily: 'var(--font-playfair)', fontSize: 26, fontWeight: 700, margin: '16px 0 12px' }}>
          Health Intelligence requires Intelligence tier
        </h1>
        <p style={{ fontSize: 14, color: '#8A9BB0', lineHeight: 1.7, marginBottom: 28 }}>
          This report includes CCAA waiting times, hospital quality scores, and full healthcare proximity analysis.
          Upgrade to Intelligence to unlock it.
        </p>
        <a
          href="/account/upgrade"
          style={{
            display: 'inline-block', background: '#34C97A', color: '#0D1B2A',
            fontWeight: 700, fontSize: 14, padding: '12px 28px',
            borderRadius: 8, textDecoration: 'none',
          }}
        >
          Upgrade to Intelligence →
        </a>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row component
// ---------------------------------------------------------------------------

function DataRow({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '8px 0', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
      <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, color: '#4A6080' }}>{label}</span>
      <span style={{ fontFamily: mono ? 'var(--font-dm-mono)' : 'var(--font-dm-sans)', fontSize: 13, color: 'var(--navy-deep)' }}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

interface Props {
  params:       Promise<{ postcode: string }>;
  searchParams: Promise<{ lat?: string; lng?: string; jobId?: string }>;
}

export default async function HealthReportPage({ params, searchParams }: Props) {
  const { postcode } = await params;
  const sp = await searchParams;

  if (!/^\d{5}$/.test(postcode)) notFound();

  // Tier gate disabled during dev — everything open while we exercise the full report.
  // TODO(re-enable when billing ships): restore Intelligence-only gate using getUserTier() + UpgradeGate.
  void getUserTier; void UpgradeGate;
  const backUrl = sp.lat && sp.lng
    ? `/map?lat=${sp.lat}&lng=${sp.lng}&pin=true`
    : '/map';

  // Fetch health data in parallel
  const { gp, hospital, urgencias, pharmacies, zone } = await getHealthData(postcode);

  // Derive province for waiting times lookup
  const provincia = gp?.provincia ?? hospital?.provincia ?? urgencias?.provincia ?? null;
  const waitTimes = await getWaitingTimes(provincia);

  const city      = zone?.municipio ?? 'Málaga';
  const zoneScore = zone?.health_score_norm != null ? Math.round(zone.health_score_norm) : null;

  const narrative = await generateHealthNarrative({
    postcode,
    city,
    nearestGpM:         gp       ? gp.distance_m         : null,
    nearestHospitalKm:  hospital  ? hospital.distance_m / 1000  : null,
    nearestUrgenciasKm: urgencias ? urgencias.distance_m / 1000 : null,
    pharmacies500m:     pharmacies,
    avgDaysGp:          waitTimes?.avg_days_gp         ?? null,
    avgDaysSurgery:     waitTimes?.avg_days_surgery     ?? null,
  });

  // Back-to-report link
  const reportBackUrl = sp.jobId ? `/analyse/${sp.jobId}` : null;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)', color: 'var(--text)', fontFamily: 'var(--font-dm-sans)' }}>

      {/* ── Nav strip ── */}
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', height: 52, borderBottom: '1px solid rgba(0,0,0,0.07)',
        position: 'sticky', top: 0, background: 'var(--surface-2)', zIndex: 10,
      }}>
        <a href={backUrl} style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, color: '#8A9BB0', textDecoration: 'none' }}>
          ← Back to map
        </a>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {reportBackUrl && (
            <a href={reportBackUrl} style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#34C97A', textDecoration: 'none' }}>
              ← DNA Report
            </a>
          )}
          <ThemeToggle />
          <span style={{ fontFamily: 'var(--font-playfair)', fontSize: 18, fontWeight: 600 }}>Qolify</span>
        </div>
      </nav>

      <main style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px 80px' }}>

        {/* Page title */}
        <p style={{ fontSize: 11, letterSpacing: '0.12em', color: '#C94B1A', textTransform: 'uppercase', marginBottom: 8 }}>
          Health Security Intelligence
        </p>
        <h1 style={{ fontFamily: 'var(--font-playfair)', fontSize: 32, fontWeight: 700, lineHeight: 1.15, margin: 0, marginBottom: 4 }}>
          Healthcare near {postcode}
        </h1>
        <p style={{ fontSize: 14, color: '#8A9BB0', marginBottom: 32 }}>
          Postcode {postcode} · {city}
        </p>

        <div style={{ height: 1, background: 'rgba(0,0,0,0.07)', marginBottom: 32 }} />

        {/* AI narrative */}
        {narrative && (
          <p style={{
            fontSize: 15, color: '#4A5D74', lineHeight: 1.7, marginBottom: 36,
            borderLeft: '3px solid #C94B1A', paddingLeft: 16,
          }}>
            {narrative}
          </p>
        )}

        {/* ── Hero stat cards ── */}
        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: '#8A9BB0', textTransform: 'uppercase', marginBottom: 16 }}>
            Proximity Overview
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>

            {/* GP */}
            <div style={{ background: 'var(--surface-2)', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 10, padding: '16px 18px' }}>
              <p style={{ fontSize: 11, color: '#8A9BB0', marginBottom: 6 }}>Nearest GP (Centro de Salud)</p>
              {gp ? (
                <>
                  <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 22, fontWeight: 500, color: 'var(--navy-deep)', marginBottom: 2 }}>
                    {fmtDist(gp.distance_m)}
                  </p>
                  <p style={{ fontSize: 11, color: '#4A6080' }}>{walkTime(gp.distance_m)}</p>
                  <p style={{ fontSize: 12, color: '#8A9BB0', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {gp.nombre}
                  </p>
                </>
              ) : (
                <p style={{ fontSize: 13, color: '#4A6080', marginTop: 4 }}>No data</p>
              )}
            </div>

            {/* Hospital */}
            <div style={{ background: 'var(--surface-2)', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 10, padding: '16px 18px' }}>
              <p style={{ fontSize: 11, color: '#8A9BB0', marginBottom: 6 }}>Nearest Hospital</p>
              {hospital ? (
                <>
                  <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 22, fontWeight: 500, color: 'var(--navy-deep)', marginBottom: 2 }}>
                    {fmtDist(hospital.distance_m)}
                  </p>
                  <p style={{ fontSize: 11, color: '#4A6080' }}>{driveTime(hospital.distance_m)}</p>
                  <p style={{ fontSize: 12, color: '#8A9BB0', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {hospital.nombre}
                  </p>
                </>
              ) : (
                <p style={{ fontSize: 13, color: '#4A6080', marginTop: 4 }}>No data</p>
              )}
            </div>

            {/* 24h Urgencias */}
            <div style={{ background: 'var(--surface-2)', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 10, padding: '16px 18px' }}>
              <p style={{ fontSize: 11, color: '#8A9BB0', marginBottom: 6 }}>Nearest 24h Urgencias</p>
              {urgencias ? (
                <>
                  <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 22, fontWeight: 500, color: 'var(--navy-deep)', marginBottom: 2 }}>
                    {fmtDist(urgencias.distance_m)}
                  </p>
                  <p style={{ fontSize: 11, color: '#4A6080' }}>{driveTime(urgencias.distance_m)}</p>
                  <p style={{ fontSize: 12, color: '#8A9BB0', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {urgencias.nombre}
                  </p>
                </>
              ) : (
                <p style={{ fontSize: 13, color: '#4A6080', marginTop: 4 }}>No data</p>
              )}
            </div>

            {/* Pharmacies */}
            <div style={{ background: 'var(--surface-2)', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 10, padding: '16px 18px' }}>
              <p style={{ fontSize: 11, color: '#8A9BB0', marginBottom: 6 }}>Pharmacies within 500m</p>
              <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 22, fontWeight: 500, color: 'var(--navy-deep)', marginBottom: 2 }}>
                {pharmacies}
              </p>
              <p style={{ fontSize: 11, color: pharmacies > 0 ? '#34C97A' : '#D4820A' }}>
                {pharmacies > 2 ? 'Excellent pharmacy access' : pharmacies > 0 ? 'Some pharmacy access' : 'None recorded'}
              </p>
            </div>

          </div>
        </section>

        {/* ── Waiting times ── */}
        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: '#8A9BB0', textTransform: 'uppercase', marginBottom: 16 }}>
            Regional Waiting Times
          </h2>
          {waitTimes ? (
            <div style={{ background: 'var(--surface-2)', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 10, padding: '16px 18px' }}>
              <DataRow label="GP appointment wait"    value={waitTimes.avg_days_gp != null ? `~${waitTimes.avg_days_gp} days` : 'Not published'} />
              <DataRow label="Specialist wait"        value={waitTimes.avg_days_specialist != null ? `~${waitTimes.avg_days_specialist} days` : '—'} />
              <DataRow label="Surgical waiting list"  value={waitTimes.avg_days_surgery != null ? `~${Math.round(waitTimes.avg_days_surgery)} days avg` : '—'} />
              <DataRow label="Surgery list (total)"   value={waitTimes.surgery_waiting_list != null ? waitTimes.surgery_waiting_list.toLocaleString('es-ES') + ' patients' : '—'} />
              <p style={{ fontSize: 11, color: '#4A6080', marginTop: 12, lineHeight: 1.5 }}>
                {waitTimes.comunidad_autonoma} · Data from {waitTimes.recorded_quarter.slice(0, 7)} · Based on CCAA average — individual health area may differ.
              </p>
            </div>
          ) : (
            <div style={{ background: 'var(--surface-2)', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 10, padding: '16px 18px' }}>
              <p style={{ fontSize: 13, color: '#4A6080' }}>
                Waiting times data not yet available for this region. MSCBS quarterly data is ingested each January, April, July, and October.
              </p>
            </div>
          )}
        </section>

        {/* ── Zone health score ── */}
        {zoneScore != null && (
          <section style={{ marginBottom: 40 }}>
            <h2 style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: '#8A9BB0', textTransform: 'uppercase', marginBottom: 16 }}>
              Zone Health Score
            </h2>
            <div style={{ background: 'var(--surface-2)', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 10, padding: '16px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <div style={{ flex: 1, height: 8, background: 'rgba(0,0,0,0.07)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${zoneScore}%`, height: '100%', background: scoreColour(zoneScore), borderRadius: 4 }} />
                </div>
                <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 18, color: 'var(--navy-deep)', minWidth: 32 }}>
                  {zoneScore}
                </span>
              </div>
              <p style={{ fontSize: 12, color: zoneScore >= 70 ? '#34C97A' : zoneScore >= 40 ? '#D4820A' : '#C94B1A' }}>
                {zoneScore >= 70 ? 'Strong healthcare access for this postcode.' : zoneScore >= 40 ? 'Moderate healthcare access — check specific facilities.' : 'Below-average healthcare proximity in this area.'}
              </p>
            </div>
          </section>
        )}

        {/* ── Data source footer ── */}
        <footer style={{ borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 20, marginTop: 20 }}>
          <p style={{ fontSize: 11, color: '#4A6080', lineHeight: 1.6 }}>
            Health facility locations: RESC (Registro de Establecimientos Sanitarios Autorizados de Cataluña) and regional equivalents, sourced via OSM.
            Distances measured from postcode centroid.
            Waiting times: MSCBS Lista de Espera Quirúrgica (quarterly) + regional GP supplements (Andalucía, Madrid).
            Data is CCAA-level — individual health area figures may differ.
          </p>
        </footer>

      </main>
    </div>
  );
}
