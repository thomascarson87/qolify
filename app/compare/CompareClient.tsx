'use client';

/**
 * CompareClient — side-by-side comparison of 2–4 saved properties.
 *
 * Reads ?ids=a,b,c from the URL, fetches the full saved_analyses list once
 * (cheap — same endpoint /library uses), and filters down. All re-weighting
 * and re-scoring is purely client-side from the cached `pillars` map.
 *
 * Strongest property per row is highlighted in emerald. Property type is
 * "best wins" — for the personalised TVI and each pillar, higher is better.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { TVIRing } from '@/components/ui/TVIRing';
import { ProfilePicker } from '@/components/preferences/ProfilePicker';
import {
  loadPreferences,
  savePreferences,
  computePersonalisedTVI,
  computeAllPillarScores,
  PILLAR_ORDER,
  PILLAR_LABEL,
  type StoredPreferences,
  type Pillar,
} from '@/lib/preferences';

interface LibraryListItem {
  id:                string;
  source_url:        string;
  source:            'manual' | 'idealista_import';
  tvi_score:         number | null;
  notes:             string | null;
  analysed_at:       string;
  analysis_cache_id: string | null;
  address:           string | null;
  municipio:         string | null;
  price_asking:      number | null;
  area_sqm:          number | null;
  bedrooms:          number | null;
  pillars:           Record<string, number | null> | null;
}

function formatCurrency(n: number | null): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}

function pricePerSqm(p: number | null, a: number | null): string {
  if (p == null || a == null || a === 0) return '—';
  return `€${Math.round(p / a).toLocaleString('es-ES')}/m²`;
}

function scoreColour(score: number | null): string {
  if (score == null) return 'var(--text-light)';
  if (score >= 75) return '#34C97A';
  if (score >= 50) return '#D4820A';
  return '#C94B1A';
}

/** Index of the best (highest, non-null) score across columns. -1 = no winner. */
function bestIndex(scores: Array<number | null>): number {
  let best = -1;
  let bestVal = -Infinity;
  scores.forEach((s, i) => {
    if (s != null && s > bestVal) { best = i; bestVal = s; }
  });
  return best;
}

export function CompareClient() {
  const params = useSearchParams();
  const idsParam = params.get('ids') ?? '';
  const ids = useMemo(() => idsParam.split(',').filter(Boolean).slice(0, 4), [idsParam]);

  const [items, setItems] = useState<LibraryListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<StoredPreferences | null>(null);

  useEffect(() => { setPrefs(loadPreferences()); }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/library', { cache: 'no-store' });
        if (!res.ok) { if (!cancelled) setError('Could not load library.'); return; }
        const data = await res.json() as { items: LibraryListItem[] };
        if (cancelled) return;
        // Preserve the order requested in ?ids= so the user controls layout.
        const byId = new Map(data.items.map(i => [i.id, i]));
        const ordered = ids.map(id => byId.get(id)).filter((i): i is LibraryListItem => !!i);
        setItems(ordered);
      } catch {
        if (!cancelled) setError('Network error.');
      }
    })();
    return () => { cancelled = true; };
  }, [ids]);

  function updatePrefs(next: StoredPreferences) {
    setPrefs(next);
    savePreferences(next);
  }

  if (ids.length < 2) {
    return (
      <Page>
        <EmptyHint message="Pick at least 2 properties from your library to compare." />
      </Page>
    );
  }

  if (error) {
    return <Page><p style={{ fontFamily: 'var(--font-dm-sans)', color: 'var(--risk)' }}>{error}</p></Page>;
  }

  if (items === null || prefs === null) {
    return (
      <Page>
        <div style={{ height: 360, background: 'var(--surface-2)', borderRadius: 16, opacity: 0.7 }} />
      </Page>
    );
  }

  if (items.length === 0) {
    return <Page><EmptyHint message="None of those library entries could be found." /></Page>;
  }

  // Pre-compute per-property derived scores once per render.
  const personalised = items.map(it => computePersonalisedTVI(it.pillars, prefs.weights));
  const pillarScores: Record<Pillar, Array<number | null>> = {
    financial: [], lifestyle: [], risk: [], community: [],
  };
  items.forEach(it => {
    const all = computeAllPillarScores(it.pillars);
    PILLAR_ORDER.forEach(p => pillarScores[p].push(all[p]));
  });

  const tviWinner          = bestIndex(items.map(i => i.tvi_score));
  const personalisedWinner = bestIndex(personalised);
  const pillarWinners: Record<Pillar, number> = {
    financial: bestIndex(pillarScores.financial),
    lifestyle: bestIndex(pillarScores.lifestyle),
    risk:      bestIndex(pillarScores.risk),
    community: bestIndex(pillarScores.community),
  };

  return (
    <Page>
      <div style={{ marginBottom: 22 }}>
        <ProfilePicker prefs={prefs} onChange={updatePrefs} variant="full" />
      </div>

      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table style={{
          borderCollapse: 'separate',
          borderSpacing:  0,
          width:          '100%',
          minWidth:       items.length * 240 + 200,
          fontFamily:     'var(--font-dm-sans)',
        }}>
          <thead>
            <tr>
              <th style={thLabelStyle()} />
              {items.map(it => (
                <th key={it.id} style={thCellStyle()}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{
                      fontFamily: 'var(--font-playfair)',
                      fontSize:   16,
                      fontWeight: 600,
                      color:      'var(--text)',
                      lineHeight: 1.25,
                    }}>
                      {it.address ?? it.municipio ?? it.source_url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)}
                    </span>
                    {it.municipio && (
                      <span style={{ fontSize: 12, color: 'var(--text-light)' }}>{it.municipio}</span>
                    )}
                    {it.analysis_cache_id && (
                      <Link
                        href={`/analyse/${it.analysis_cache_id}`}
                        style={{ fontSize: 11, color: 'var(--navy-deep)', textDecoration: 'underline', marginTop: 2 }}
                      >
                        View full report →
                      </Link>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Facts */}
            <Row label="Asking price">
              {items.map(it => <Cell key={it.id} value={formatCurrency(it.price_asking)} mono />)}
            </Row>
            <Row label="€ / m²">
              {items.map(it => <Cell key={it.id} value={pricePerSqm(it.price_asking, it.area_sqm)} mono />)}
            </Row>
            <Row label="Area">
              {items.map(it => <Cell key={it.id} value={it.area_sqm != null ? `${it.area_sqm} m²` : '—'} mono />)}
            </Row>
            <Row label="Bedrooms">
              {items.map(it => <Cell key={it.id} value={it.bedrooms != null ? String(it.bedrooms) : '—'} mono />)}
            </Row>

            {/* Original TVI */}
            <Row label="Original TVI" group>
              {items.map((it, i) => (
                <td key={it.id} style={tdStyle(i === tviWinner)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <TVIRing score={it.tvi_score} size="sm" />
                    <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 18, fontWeight: 600, color: scoreColour(it.tvi_score) }}>
                      {it.tvi_score ?? '—'}
                    </span>
                  </div>
                </td>
              ))}
            </Row>

            {/* Personalised TVI */}
            <Row label="Personalised TVI" group highlight>
              {items.map((it, i) => (
                <td key={it.id} style={tdStyle(i === personalisedWinner)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <TVIRing score={personalised[i]} size="sm" />
                    <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 18, fontWeight: 600, color: scoreColour(personalised[i]) }}>
                      {personalised[i] ?? '—'}
                    </span>
                  </div>
                </td>
              ))}
            </Row>

            {/* Per-pillar */}
            {PILLAR_ORDER.map(p => (
              <Row key={p} label={PILLAR_LABEL[p]}>
                {items.map((it, i) => {
                  const s = pillarScores[p][i];
                  return (
                    <td key={it.id} style={tdStyle(i === pillarWinners[p])}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, maxWidth: 120 }}>
                          <div style={{
                            width:      `${s ?? 0}%`,
                            height:     '100%',
                            background: scoreColour(s),
                            borderRadius: 3,
                          }} />
                        </div>
                        <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 13, fontWeight: 600, color: 'var(--text)', width: 28, textAlign: 'right' }}>
                          {s ?? '—'}
                        </span>
                      </div>
                    </td>
                  );
                })}
              </Row>
            ))}

            {/* Notes */}
            <Row label="Notes">
              {items.map(it => (
                <td key={it.id} style={tdStyle(false)}>
                  {it.notes ? (
                    <p style={{ fontFamily: 'var(--font-playfair)', fontStyle: 'italic', fontSize: 13, color: 'var(--text-mid)', margin: 0, lineHeight: 1.5 }}>
                      {it.notes}
                    </p>
                  ) : (
                    <span style={{ color: 'var(--text-light)', fontSize: 12 }}>—</span>
                  )}
                </td>
              ))}
            </Row>
          </tbody>
        </table>
      </div>
    </Page>
  );
}

// ─── Table primitives ──────────────────────────────────────────────────────

function Row({
  label, children, group = false, highlight = false,
}: {
  label: string;
  children: React.ReactNode;
  group?: boolean;
  highlight?: boolean;
}) {
  return (
    <tr style={{ background: highlight ? 'rgba(13,43,78,0.04)' : undefined }}>
      <th scope="row" style={rowLabelStyle(group)}>
        {label}
      </th>
      {children}
    </tr>
  );
}

function Cell({ value, mono = false }: { value: string; mono?: boolean }) {
  return (
    <td style={tdStyle(false)}>
      <span style={{
        fontFamily: mono ? 'var(--font-dm-mono)' : 'var(--font-dm-sans)',
        fontSize:   14,
        color:      'var(--text)',
      }}>
        {value}
      </span>
    </td>
  );
}

function thLabelStyle(): React.CSSProperties {
  return {
    width:      180,
    padding:    '14px 14px 14px 0',
    textAlign:  'left',
    background: 'transparent',
  };
}
function thCellStyle(): React.CSSProperties {
  return {
    padding:    '14px 16px',
    textAlign:  'left',
    background: 'var(--surface-2)',
    borderTopLeftRadius:  10,
    borderTopRightRadius: 10,
    verticalAlign: 'top',
    minWidth:   200,
  };
}
function rowLabelStyle(group: boolean): React.CSSProperties {
  return {
    padding:       '12px 14px 12px 0',
    textAlign:     'left',
    fontFamily:    'var(--font-dm-sans)',
    fontSize:      group ? 13 : 12,
    fontWeight:    600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color:         group ? 'var(--text)' : 'var(--text-light)',
    borderTop:     '1px solid var(--border)',
    verticalAlign: 'middle',
  };
}
function tdStyle(winner: boolean): React.CSSProperties {
  return {
    padding:       '12px 16px',
    borderTop:     '1px solid var(--border)',
    background:    winner ? 'rgba(52,201,122,0.10)' : 'transparent',
    boxShadow:     winner ? 'inset 3px 0 0 #34C97A' : undefined,
    verticalAlign: 'middle',
    minWidth:      200,
  };
}

// ─── Page chrome ───────────────────────────────────────────────────────────

function EmptyHint({ message }: { message: string }) {
  return (
    <div style={{
      background: 'var(--surface-2)', borderRadius: 18, padding: '48px 32px',
      textAlign: 'center', maxWidth: 520, margin: '40px auto',
    }}>
      <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 14, color: 'var(--text-mid)', marginBottom: 18 }}>
        {message}
      </p>
      <Link href="/library" style={{
        display: 'inline-block',
        background: 'var(--navy-deep)', color: '#34C97A',
        fontFamily: 'var(--font-dm-sans)', fontSize: 14, fontWeight: 600,
        padding: '12px 22px', borderRadius: 12, textDecoration: 'none',
      }}>
        Back to Library →
      </Link>
    </div>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 24px 80px' }}>
      <header style={{ marginBottom: 22 }}>
        <Link href="/library" style={{
          fontFamily: 'var(--font-dm-sans)', fontSize: 12, fontWeight: 600,
          color: 'var(--text-light)', textDecoration: 'none', textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          ← Library
        </Link>
        <h1 style={{ fontFamily: 'var(--font-playfair)', fontSize: 'clamp(24px, 3vw, 32px)', fontWeight: 600, color: 'var(--text)', marginTop: 6, marginBottom: 4 }}>
          Compare properties
        </h1>
        <p style={{ fontFamily: 'var(--font-playfair)', fontStyle: 'italic', fontSize: 16, color: 'var(--text-mid)' }}>
          Side-by-side under your weighting. Strongest result per row in green.
        </p>
      </header>
      {children}
    </main>
  );
}
