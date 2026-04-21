/**
 * /map/report/education/[postcode] — CHI-368 / CHI-392
 *
 * Education Opportunity deep-dive report for a postcode.
 *
 * Shows: school list with type / distance / diagnostic score / bilingual flags;
 * "Best nearby" shortlist ranked by diagnostic score;
 * type breakdown; AI narrative; zone score context.
 *
 * Tier gate: Pro+. Free users see an upgrade prompt.
 *
 * Server-rendered. Back link returns to map with pin coords if provided.
 */

import { notFound } from 'next/navigation';
import db from '@/lib/db';
import { createClient } from '@/lib/supabase/server';
import { generateEducationNarrative } from '@/app/actions/generateEducationNarrative';
import { ThemeToggle } from '@/components/report/ThemeToggle';

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
// Data fetch
// ---------------------------------------------------------------------------

interface School {
  name:               string;
  type:               string;
  levels:             string[] | null;
  distance_m:         number;
  diagnostic_score:   number | null;
  diagnostic_year:    number | null;
  bilingual_languages: string[] | null;
  teacher_ratio:       number | null;
  has_canteen:         boolean;
  has_sports_facilities: boolean;
  etapas_range:        string | null;
}

interface ZoneScore {
  school_score_norm:       number | null;
  municipio:               string | null;
  bilingual_schools_1km:   number | null;
  school_avg_diagnostic:   number | null;
}

async function getSchoolsForPostcode(postcode: string): Promise<{
  schools:   School[];
  zone:      ZoneScore | null;
}> {
  const [schoolRows, zoneRows] = await Promise.all([
    db`
      SELECT
        nombre                                AS name,
        tipo                                 AS type,
        etapas                               AS levels,
        ROUND(ST_Distance(
          geom,
          (SELECT centroid::geography FROM postal_zones WHERE codigo_postal = ${postcode})
        )::numeric, 0)                       AS distance_m,
        diagnostic_score::float,
        diagnostic_year,
        bilingual_languages,
        teacher_ratio::float,
        has_canteen,
        has_sports_facilities,
        etapas_range
      FROM schools
      WHERE ST_DWithin(
        geom,
        (SELECT centroid::geography FROM postal_zones WHERE codigo_postal = ${postcode}),
        1500
      )
      ORDER BY distance_m
      LIMIT 30`,

    db`
      SELECT
        zs.school_score_norm::float,
        zs.municipio,
        ze.bilingual_schools_1km::float,
        ze.school_avg_diagnostic::float
      FROM zone_scores zs
      LEFT JOIN zone_enrichment_scores ze ON ze.codigo_postal = zs.codigo_postal
      WHERE zs.codigo_postal = ${postcode}
      LIMIT 1`,
  ]);

  return {
    schools: schoolRows as unknown as School[],
    zone:    (zoneRows[0] as unknown as ZoneScore) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function walkTime(m: number): string {
  const mins = Math.round(m / 80);
  if (mins < 1) return '< 1 min';
  return `${mins} min`;
}

function fmtDist(m: number): string {
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

function scoreColour(score: number): string {
  if (score >= 70) return '#34C97A';
  if (score >= 40) return '#D4820A';
  return '#C94B1A';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SchoolTypeBadge({ type }: { type: string }) {
  const t = (type ?? '').toLowerCase();
  const label =
    t === 'publico'    ? 'Public' :
    t === 'concertado' ? 'Concertado' :
    t === 'privado'    ? 'Private' :
    t.includes('internacional') || t.includes('international') ? 'International' :
    type;
  const color =
    t === 'publico'    ? '#34C97A' :
    t === 'concertado' ? '#D4820A' :
    t === 'privado'    ? '#A78BFA' :
    '#8A9BB0';

  return (
    <span style={{
      fontFamily: 'var(--font-dm-sans)', fontSize: 10, fontWeight: 600,
      color, background: `${color}20`, border: `1px solid ${color}40`,
      borderRadius: 4, padding: '1px 7px', whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}

function DiagnosticBadge({ score, year }: { score: number; year: number | null }) {
  const colour = score >= 7 ? '#34C97A' : score >= 5 ? '#D4820A' : '#C94B1A';
  return (
    <span style={{
      fontFamily: 'var(--font-dm-mono)', fontSize: 10, fontWeight: 600,
      color: colour, background: `${colour}15`, border: `1px solid ${colour}30`,
      borderRadius: 4, padding: '1px 7px', whiteSpace: 'nowrap',
    }}>
      ★ {score.toFixed(1)}{year ? `/${year.toString().slice(2)}` : ''}
    </span>
  );
}

function ScoreBar({ score, color = '#34C97A' }: { score: number; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, height: 8, background: 'rgba(0,0,0,0.07)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${score}%`, height: '100%', background: color, borderRadius: 4 }} />
      </div>
      <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 14, color: 'var(--navy-deep)', minWidth: 28, textAlign: 'right' }}>
        {score}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gate page — shown when tier < pro
// ---------------------------------------------------------------------------

function UpgradeGate({ backUrl }: { backUrl: string }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)', color: 'var(--text)', fontFamily: 'var(--font-dm-sans)' }}>
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', height: 52, borderBottom: '1px solid rgba(0,0,0,0.07)',
        background: 'var(--surface-2)',
      }}>
        <a href={backUrl} style={{ fontSize: 13, color: '#8A9BB0', textDecoration: 'none' }}>← Back</a>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <ThemeToggle />
          <span style={{ fontFamily: 'var(--font-playfair)', fontSize: 18, fontWeight: 600 }}>Qolify</span>
        </div>
      </nav>
      <main style={{ maxWidth: 520, margin: '80px auto', padding: '0 24px', textAlign: 'center' }}>
        <span style={{ fontSize: 32 }}>🔒</span>
        <h1 style={{ fontFamily: 'var(--font-playfair)', fontSize: 26, fontWeight: 700, margin: '16px 0 12px' }}>
          Education deep-dive requires Pro
        </h1>
        <p style={{ fontSize: 14, color: '#8A9BB0', lineHeight: 1.7, marginBottom: 28 }}>
          This report includes diagnostic test scores, bilingual school data, teacher ratios, and school quality rankings.
          Upgrade to Pro to unlock the full picture.
        </p>
        <a href="/account/upgrade" style={{
          display: 'inline-block', background: '#34C97A', color: '#0D1B2A',
          fontWeight: 700, fontSize: 14, padding: '12px 28px',
          borderRadius: 8, textDecoration: 'none',
        }}>
          Upgrade to Pro →
        </a>
      </main>
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

export default async function EducationReportPage({ params, searchParams }: Props) {
  const { postcode } = await params;
  const sp = await searchParams;

  if (!/^\d{5}$/.test(postcode)) notFound();

  // Tier gate disabled during dev — everything open while we exercise the full report.
  // TODO(re-enable when billing ships): restore Pro+ gate using getUserTier() + UpgradeGate.
  void getUserTier; void UpgradeGate;
  const backUrl = sp.lat && sp.lng
    ? `/map?lat=${sp.lat}&lng=${sp.lng}&pin=true`
    : '/map';

  const { schools, zone } = await getSchoolsForPostcode(postcode);

  const city      = zone?.municipio ?? 'Málaga';
  const zoneScore = zone?.school_score_norm != null ? Math.round(zone.school_score_norm) : null;

  // Count by type
  const typeBreakdown = schools.reduce<Record<string, number>>((acc, s) => {
    const key = s.type ?? 'other';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  // Best schools ranked by diagnostic score (top 3 with a score)
  const topByDiagnostic = [...schools]
    .filter(s => s.diagnostic_score != null)
    .sort((a, b) => (b.diagnostic_score ?? 0) - (a.diagnostic_score ?? 0))
    .slice(0, 3);

  const aiNarrative = await generateEducationNarrative({
    postcode,
    city,
    schoolCount:     schools.length,
    nearestSchoolM:  schools[0]?.distance_m ?? 0,
    zoneSchoolScore: zone?.school_score_norm ?? null,
  });

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
          <span style={{ fontFamily: 'var(--font-playfair)', fontSize: 18, fontWeight: 600, color: 'var(--navy-deep)', letterSpacing: '-0.02em' }}>
            Qolify
          </span>
        </div>
      </nav>

      {/* ── Report body ── */}
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px 80px' }}>

        {/* Page title */}
        <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11, letterSpacing: '0.12em', color: '#34C97A', textTransform: 'uppercase', marginBottom: 8 }}>
          Education Intelligence
        </p>
        <h1 style={{ fontFamily: 'var(--font-playfair)', fontSize: 32, fontWeight: 700, lineHeight: 1.15, margin: 0, marginBottom: 4 }}>
          Schools near {postcode}
        </h1>
        <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 14, color: '#8A9BB0', marginBottom: 32 }}>
          Postcode {postcode} · {city}
        </p>

        <div style={{ height: 1, background: 'rgba(0,0,0,0.07)', marginBottom: 32 }} />

        {/* AI narrative */}
        {aiNarrative && (
          <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 15, color: '#4A5D74', lineHeight: 1.7, marginBottom: 36, borderLeft: '3px solid #34C97A', paddingLeft: 16 }}>
            {aiNarrative}
          </p>
        )}

        {/* ── Summary stats ── */}
        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: '#8A9BB0', textTransform: 'uppercase', marginBottom: 16 }}>
            Overview
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>

            <div style={{ background: 'var(--surface-2)', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 10, padding: '14px 16px' }}>
              <p style={{ fontSize: 11, color: '#8A9BB0', marginBottom: 4 }}>Schools within 1.5km</p>
              <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 24, fontWeight: 500, color: 'var(--navy-deep)' }}>{schools.length}</p>
            </div>

            {typeBreakdown['publico'] != null && (
              <div style={{ background: 'var(--surface-2)', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 10, padding: '14px 16px' }}>
                <p style={{ fontSize: 11, color: '#8A9BB0', marginBottom: 4 }}>Public</p>
                <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 24, fontWeight: 500, color: '#34C97A' }}>{typeBreakdown['publico']}</p>
              </div>
            )}

            {typeBreakdown['concertado'] != null && (
              <div style={{ background: 'var(--surface-2)', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 10, padding: '14px 16px' }}>
                <p style={{ fontSize: 11, color: '#8A9BB0', marginBottom: 4 }}>Concertado</p>
                <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 24, fontWeight: 500, color: '#D4820A' }}>{typeBreakdown['concertado']}</p>
              </div>
            )}

            {zone?.bilingual_schools_1km != null && (
              <div style={{ background: 'var(--surface-2)', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 10, padding: '14px 16px' }}>
                <p style={{ fontSize: 11, color: '#8A9BB0', marginBottom: 4 }}>Bilingual (1km)</p>
                <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 24, fontWeight: 500, color: 'var(--navy-deep)' }}>
                  {Math.round(zone.bilingual_schools_1km)}
                </p>
              </div>
            )}

          </div>
        </section>

        {/* ── Best schools by diagnostic score ── */}
        {topByDiagnostic.length > 0 && (
          <section style={{ marginBottom: 40 }}>
            <h2 style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: '#8A9BB0', textTransform: 'uppercase', marginBottom: 12 }}>
              Highest-Rated Nearby Schools
            </h2>
            <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#4A6080', marginBottom: 16 }}>
              Ranked by official diagnostic test score (MEFP / regional evaluation). Based on {topByDiagnostic[0]?.diagnostic_year ?? 'most recent'} data.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {topByDiagnostic.map((s, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: 'var(--surface-2)', border: '1px solid rgba(0,0,0,0.07)',
                  borderRadius: 10, padding: '12px 16px', gap: 12,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 14, fontWeight: 500, color: 'var(--navy-deep)', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.name}
                    </p>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <SchoolTypeBadge type={s.type} />
                      {s.bilingual_languages && s.bilingual_languages.length > 0 && (
                        <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 10, fontWeight: 600, color: '#A78BFA', background: '#A78BFA20', border: '1px solid #A78BFA40', borderRadius: 4, padding: '1px 7px' }}>
                          Bilingual {s.bilingual_languages.join('/')}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    {s.diagnostic_score != null && (
                      <DiagnosticBadge score={s.diagnostic_score} year={s.diagnostic_year} />
                    )}
                    <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 12, color: '#8A9BB0', marginTop: 4 }}>
                      {fmtDist(s.distance_m)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Full school list ── */}
        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: '#8A9BB0', textTransform: 'uppercase', marginBottom: 12 }}>
            All Schools within 1.5km
          </h2>

          {schools.length === 0 ? (
            <p style={{ color: '#4A6080', fontSize: 14 }}>
              No schools found within 1.5km of this postcode centroid.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {schools.map((s, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: 'var(--surface-2)', border: '1px solid rgba(0,0,0,0.07)',
                  borderRadius: 10, padding: '10px 16px', gap: 12,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, fontWeight: 500, color: 'var(--navy-deep)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.name}
                    </p>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      <SchoolTypeBadge type={s.type} />
                      {s.bilingual_languages && s.bilingual_languages.length > 0 && (
                        <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 10, color: '#A78BFA', background: '#A78BFA15', border: '1px solid #A78BFA30', borderRadius: 4, padding: '1px 7px' }}>
                          Bilingual
                        </span>
                      )}
                      {s.has_canteen && (
                        <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 10, color: '#8A9BB0', background: 'rgba(138,155,176,0.12)', borderRadius: 4, padding: '1px 7px' }}>
                          Canteen
                        </span>
                      )}
                      {s.teacher_ratio != null && (
                        <span
                          title="Students per teacher"
                          style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 10, color: '#4A6080', background: 'rgba(74,96,128,0.10)', borderRadius: 4, padding: '1px 7px' }}
                        >
                          {s.teacher_ratio.toFixed(1)}:1 ratio
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    {s.diagnostic_score != null ? (
                      <DiagnosticBadge score={s.diagnostic_score} year={s.diagnostic_year} />
                    ) : (
                      <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 10, color: '#4A6080' }}>Score unavailable</span>
                    )}
                    <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 12, color: '#8A9BB0', marginTop: 2 }}>
                      {fmtDist(s.distance_m)}
                    </p>
                    <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 10, color: '#4A6080' }}>
                      ≈{walkTime(s.distance_m)} walk
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Zone context */}
        {zoneScore != null && (
          <section style={{ marginBottom: 40 }}>
            <h2 style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: '#8A9BB0', textTransform: 'uppercase', marginBottom: 16 }}>
              Zone Education Score
            </h2>
            <div style={{ background: 'var(--surface-2)', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 10, padding: '16px 18px' }}>
              <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#8A9BB0', marginBottom: 8 }}>Schools score</p>
              <ScoreBar score={zoneScore} color={scoreColour(zoneScore)} />
              {zone?.school_avg_diagnostic != null && (
                <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#4A6080', marginTop: 10 }}>
                  Average diagnostic score across schools in this zone:{' '}
                  <span style={{ fontFamily: 'var(--font-dm-mono)', color: 'var(--navy-deep)' }}>
                    {zone.school_avg_diagnostic.toFixed(1)}/10
                  </span>
                </p>
              )}
              {zoneScore >= 80 && <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#34C97A', marginTop: 8 }}>Top tier for school density in this area.</p>}
              {zoneScore >= 60 && zoneScore < 80 && <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#D4820A', marginTop: 8 }}>Above-average school access.</p>}
              {zoneScore < 60 && <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#8A9BB0', marginTop: 8 }}>Below-average school density — check specific schools for quality.</p>}
            </div>
          </section>
        )}

        {/* Data source footer */}
        <footer style={{ borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 20, marginTop: 20 }}>
          <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11, color: '#4A6080', lineHeight: 1.6 }}>
            School locations and types: MINEDU + OSM contributors. Diagnostic scores: MEFP LOMCE evaluation
            and regional supplements (Andalucía, Madrid). Bilingual data from Gobierno centre codes.
            Distances from postcode centroid — drop a pin for exact walking distances from your specific address.
            Score coverage varies by region: highest in Madrid, Andalucía, and Cataluña.
          </p>
        </footer>

      </main>
    </div>
  );
}
