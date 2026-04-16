/**
 * /map/report/education/[postcode] — CHI-368
 *
 * Deep-dive Education Intelligence report for a postcode.
 * Fetches zone data server-side, generates an AI narrative, then renders
 * the full school list with distances, types, and zone context.
 *
 * Server-rendered — no client JS required. Back link returns to the map
 * with pin coords in URL so the pin panel re-opens automatically.
 */

import { notFound } from 'next/navigation';
import db from '@/lib/db';
import { generateEducationNarrative } from '@/app/actions/generateEducationNarrative';
import { ThemeToggle } from '@/components/report/ThemeToggle';

// ---------------------------------------------------------------------------
// Data fetch
// ---------------------------------------------------------------------------

interface School {
  name:       string;
  type:       string;
  levels:     string[] | null;
  distance_m: number;
}

interface ZoneScore {
  school_score_norm: number | null;
  municipio:         string | null;
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
        )::numeric, 0)                       AS distance_m
      FROM schools
      WHERE ST_DWithin(
        geom,
        (SELECT centroid::geography FROM postal_zones WHERE codigo_postal = ${postcode}),
        1000
      )
      ORDER BY distance_m
      LIMIT 20`,

    db`
      SELECT school_score_norm::float, municipio
      FROM zone_scores
      WHERE codigo_postal = ${postcode}
      LIMIT 1`,
  ]);

  return {
    schools: schoolRows as unknown as School[],
    zone:    (zoneRows[0] as unknown as ZoneScore) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Walking time helper
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

// ---------------------------------------------------------------------------
// Type badge
// ---------------------------------------------------------------------------

function SchoolTypeBadge({ type }: { type: string }) {
  const t = (type ?? '').toLowerCase();
  const isPrimary = t.includes('ceip') || t.includes('primaria') || t.includes('infantil') || t.includes('primary');
  const isSecondary = t.includes('ies') || t.includes('secundaria') || t.includes('bachiller') || t.includes('secondary');
  const isInt = t.includes('internacional') || t.includes('international') || t.includes('british') || t.includes('american');

  const color = isInt ? '#A78BFA' : isPrimary ? '#34C97A' : isSecondary ? '#D4820A' : '#8A9BB0';
  const label = isInt ? 'International' : isPrimary ? 'Primary' : isSecondary ? 'Secondary' : type;

  return (
    <span style={{
      fontFamily:  'var(--font-dm-sans)',
      fontSize:    10,
      fontWeight:  600,
      color,
      background:  `${color}20`,
      border:      `1px solid ${color}40`,
      borderRadius: 4,
      padding:     '1px 7px',
      whiteSpace:  'nowrap',
    }}>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Score bar (horizontal)
// ---------------------------------------------------------------------------

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
// Page component
// ---------------------------------------------------------------------------

interface Props {
  params: Promise<{ postcode: string }>;
  searchParams: Promise<{ lat?: string; lng?: string }>;
}

export default async function EducationReportPage({ params, searchParams }: Props) {
  const { postcode } = await params;
  const sp = await searchParams;

  // Validate postcode format
  if (!/^\d{5}$/.test(postcode)) notFound();

  const { schools, zone } = await getSchoolsForPostcode(postcode);

  const aiNarrative = await generateEducationNarrative({
    postcode,
    city:            zone?.municipio ?? 'Málaga',
    schoolCount:     schools.length,
    nearestSchoolM:  schools[0]?.distance_m ?? 0,
    zoneSchoolScore: zone?.school_score_norm ?? null,
  });

  // Back-to-map URL — if coords were passed, re-open the pin panel
  const backUrl = sp.lat && sp.lng
    ? `/map?lat=${sp.lat}&lng=${sp.lng}&pin=true`
    : '/map';

  const city      = zone?.municipio ?? 'Málaga';
  const zoneScore = zone?.school_score_norm != null ? Math.round(zone.school_score_norm) : null;

  return (
    <div
      style={{
        minHeight:       '100vh',
        background:      'var(--background)',
        color:           'var(--text)',
        fontFamily:      'var(--font-dm-sans)',
      }}
    >
      {/* ── Nav strip ──────────────────────────────────────────────── */}
      <nav style={{
        display:      'flex',
        alignItems:   'center',
        justifyContent: 'space-between',
        padding:      '0 24px',
        height:       52,
        borderBottom: '1px solid rgba(0,0,0,0.07)',
        position:     'sticky',
        top:          0,
        background:   'var(--surface-2)',
        zIndex:       10,
      }}>
        <a
          href={backUrl}
          style={{
            fontFamily:     'var(--font-dm-sans)',
            fontSize:       13,
            color:          '#8A9BB0',
            textDecoration: 'none',
            display:        'flex',
            alignItems:     'center',
            gap:            6,
            transition:     'color 0.15s',
          }}
        >
          ← Back to map
        </a>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <ThemeToggle />
          <span style={{
            fontFamily: 'var(--font-playfair)',
            fontSize:   18,
            fontWeight: 600,
            color:      'var(--navy-deep)',
            letterSpacing: '-0.02em',
          }}>
            Qolify
          </span>
        </div>
      </nav>

      {/* ── Report body ───────────────────────────────────────────── */}
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px 80px' }}>

        {/* Page title */}
        <p style={{
          fontFamily:    'var(--font-dm-sans)',
          fontSize:      11,
          letterSpacing: '0.12em',
          color:         '#34C97A',
          textTransform: 'uppercase',
          marginBottom:  8,
        }}>
          Education Intelligence
        </p>
        <h1 style={{
          fontFamily:   'var(--font-playfair)',
          fontSize:     32,
          fontWeight:   700,
          lineHeight:   1.15,
          margin:       0,
          marginBottom: 4,
        }}>
          Schools near {postcode}
        </h1>
        <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 14, color: '#8A9BB0', marginBottom: 32 }}>
          Postcode {postcode} · {city}
        </p>

        <div style={{ height: 1, background: 'rgba(0,0,0,0.07)', marginBottom: 32 }} />

        {/* AI narrative */}
        {aiNarrative && (
          <p style={{
            fontFamily:  'var(--font-dm-sans)',
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

        {/* Schools within 1km */}
        <section style={{ marginBottom: 40 }}>
          <h2 style={{
            fontFamily:    'var(--font-dm-sans)',
            fontSize:      11,
            fontWeight:    700,
            letterSpacing: '0.1em',
            color:         '#8A9BB0',
            textTransform: 'uppercase',
            marginBottom:  12,
          }}>
            Schools within 1km
          </h2>

          {schools.length === 0 ? (
            <p style={{ color: '#4A6080', fontSize: 14 }}>
              No schools found within 1km of this postcode centroid.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {schools.map((s, i) => (
                <div
                  key={i}
                  style={{
                    display:      'flex',
                    alignItems:   'center',
                    justifyContent: 'space-between',
                    background:   'var(--surface-2)',
                    border:       '1px solid rgba(0,0,0,0.07)',
                    borderRadius: 10,
                    padding:      '12px 16px',
                    gap:          12,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      fontFamily:  'var(--font-dm-sans)',
                      fontSize:    14,
                      fontWeight:  500,
                      color:       'var(--navy-deep)',
                      marginBottom: 4,
                      overflow:    'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace:  'nowrap',
                    }}>
                      {s.name}
                    </p>
                    <SchoolTypeBadge type={s.type} />
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 14, color: 'var(--navy-deep)', marginBottom: 2 }}>
                      {fmtDist(s.distance_m)}
                    </p>
                    <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11, color: '#4A6080' }}>
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
            <h2 style={{
              fontFamily:    'var(--font-dm-sans)',
              fontSize:      11,
              fontWeight:    700,
              letterSpacing: '0.1em',
              color:         '#8A9BB0',
              textTransform: 'uppercase',
              marginBottom:  16,
            }}>
              Zone Context
            </h2>
            <div style={{
              background:   'var(--surface-2)',
              border:       '1px solid rgba(0,0,0,0.07)',
              borderRadius: 10,
              padding:      '16px 18px',
            }}>
              <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#8A9BB0', marginBottom: 8 }}>
                Schools score
              </p>
              <ScoreBar score={zoneScore} />
              {zoneScore >= 80 && (
                <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#34C97A', marginTop: 10 }}>
                  This postcode ranks in the top tier for school density in Málaga.
                </p>
              )}
              {zoneScore >= 60 && zoneScore < 80 && (
                <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#D4820A', marginTop: 10 }}>
                  Above-average school access for the Málaga area.
                </p>
              )}
              {zoneScore < 60 && (
                <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#8A9BB0', marginTop: 10 }}>
                  Below-average school density for this region — check specific schools for quality.
                </p>
              )}
            </div>
          </section>
        )}

        {/* Data source footer */}
        <footer style={{
          borderTop:   '1px solid rgba(0,0,0,0.06)',
          paddingTop:  20,
          marginTop:   20,
        }}>
          <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11, color: '#4A6080', lineHeight: 1.6 }}>
            School data: OpenStreetMap contributors via Overpass API. Updated monthly.
            Distances measured from postcode centroid — drop a pin for exact walking distances from your specific address.
          </p>
        </footer>

      </main>
    </div>
  );
}
