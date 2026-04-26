'use client';

/**
 * LibraryClient — full-page Property Library.
 *
 * Renders a card grid of saved analyses. Each card carries:
 *  - address / municipio / price / TVI ring
 *  - small bar chart of pillar scores (composite_indicators map)
 *  - source badge (Manual vs Idealista import)
 *  - relative "analysed N days ago" timestamp
 *  - View · Refresh · Delete · Notes actions
 *
 * Refresh flow is two-step on the client (so the analyse pipeline stays
 * single-sourced):
 *   1. POST /api/library/[id]/refresh  → returns either an immediate cache
 *      hit ({ id, cached: true, ... }) or { jobId } for a fresh run.
 *   2. Poll /api/analyse/status?jobId=… until status === 'complete'.
 *   3. POST /api/library with { analysis_id } to overwrite the snapshot.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { TVIRing } from '@/components/ui/TVIRing';
import { ProfilePicker } from '@/components/preferences/ProfilePicker';
import {
  loadPreferences,
  savePreferences,
  computePersonalisedTVI,
  type StoredPreferences,
} from '@/lib/preferences';

interface LibraryListItem {
  id:                string;
  source_url:        string;
  source:            'manual' | 'idealista_import';
  tvi_score:         number | null;
  notes:             string | null;
  analysed_at:       string;
  created_at:        string;
  updated_at:        string;
  import_batch_id:   string | null;
  analysis_cache_id: string | null;
  address:           string | null;
  municipio:         string | null;
  price_asking:      number | null;
  area_sqm:          number | null;
  bedrooms:          number | null;
  pillars:           Record<string, number | null> | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
  }).format(n);
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const days = Math.floor(diff / 86_400_000);
  if (days < 1)   return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30)  return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

/**
 * Group raw composite_indicators scores into the four headline pillars used
 * across the report, then average. Mirrors the grouping in REPORT_PAGE_SPEC
 * but kept inline here (small + UI-only) so /library has no dependency on
 * the indicator registry.
 */
function pillarBreakdown(pillars: Record<string, number | null> | null): Array<{ label: string; score: number }> {
  if (!pillars) return [];
  const groups: Array<{ label: string; keys: string[] }> = [
    { label: 'Financial', keys: ['true_affordability', 'cost_of_life_index'] },
    { label: 'Lifestyle', keys: ['daily_life_score', 'expat_liveability', 'climate_solar', 'sensory_environment'] },
    { label: 'Risk',      keys: ['structural_liability', 'health_security'] },
    { label: 'Community', keys: ['community_stability', 'education_opportunity'] },
  ];
  const out: Array<{ label: string; score: number }> = [];
  for (const g of groups) {
    const vals = g.keys.map(k => pillars[k]).filter((v): v is number => typeof v === 'number');
    if (vals.length === 0) continue;
    out.push({ label: g.label, score: Math.round(vals.reduce((a,b)=>a+b,0) / vals.length) });
  }
  return out;
}

function pillarColour(score: number): string {
  if (score >= 75) return '#34C97A';
  if (score >= 50) return '#D4820A';
  return '#C94B1A';
}

// ─── Card ──────────────────────────────────────────────────────────────────

function LibraryCard({
  item,
  onDelete,
  onRefresh,
  onNotes,
  busy,
  prefs,
  selected,
  onToggleSelect,
}: {
  item: LibraryListItem;
  onDelete: (id: string) => void;
  onRefresh: (item: LibraryListItem) => void;
  onNotes: (item: LibraryListItem) => void;
  busy: 'idle' | 'refreshing' | 'deleting';
  prefs: StoredPreferences;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const pillars = useMemo(() => pillarBreakdown(item.pillars), [item.pillars]);
  const personalisedTVI = useMemo(
    () => computePersonalisedTVI(item.pillars, prefs.weights),
    [item.pillars, prefs.weights],
  );
  const headline = item.address
    ?? item.municipio
    ?? item.source_url.replace(/^https?:\/\/(www\.)?/, '');

  return (
    <article style={{
      background:    'var(--surface-2)',
      borderRadius:  16,
      padding:       18,
      boxShadow:     'var(--shadow-sm)',
      display:       'flex',
      flexDirection: 'column',
      gap:           14,
      minHeight:     280,
    }}>
      {/* Header: name + TVI */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{
            fontFamily:   'var(--font-playfair)',
            fontSize:     17,
            fontWeight:   600,
            color:        'var(--text)',
            lineHeight:   1.25,
            overflow:     'hidden',
            textOverflow: 'ellipsis',
            display:      '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}>
            {headline}
          </p>
          {item.municipio && item.address && (
            <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: 'var(--text-light)', marginTop: 2 }}>
              {item.municipio}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <TVIRing score={item.tvi_score} size="sm" />
          {personalisedTVI != null && personalisedTVI !== item.tvi_score && (
            <span
              title="Personalised TVI under your current weighting"
              style={{
                fontFamily:    'var(--font-dm-sans)',
                fontSize:      10,
                fontWeight:    600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                padding:       '2px 7px',
                borderRadius:  6,
                background:    pillarColour(personalisedTVI),
                color:         '#fff',
              }}
            >
              You: {personalisedTVI}
            </span>
          )}
        </div>
      </div>

      {/* Facts row */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {item.price_asking != null && (
          <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>
            {formatCurrency(item.price_asking)}
          </span>
        )}
        {item.area_sqm != null && (
          <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 12, color: 'var(--text-mid)' }}>
            {item.area_sqm}m²
          </span>
        )}
        {item.bedrooms != null && (
          <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 12, color: 'var(--text-mid)' }}>
            {item.bedrooms} bed
          </span>
        )}
      </div>

      {/* Pillar breakdown */}
      {pillars.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {pillars.map(p => (
            <div key={p.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                fontFamily: 'var(--font-dm-sans)',
                fontSize:   10,
                color:      'var(--text-light)',
                width:      66,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}>{p.label}</span>
              <div style={{ flex: 1, height: 5, borderRadius: 3, background: 'var(--border)' }}>
                <div style={{
                  width:        `${p.score}%`,
                  height:       '100%',
                  background:   pillarColour(p.score),
                  borderRadius: 3,
                }} />
              </div>
              <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 11, color: 'var(--text-mid)', width: 22, textAlign: 'right' }}>
                {p.score}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Notes (if present) */}
      {item.notes && (
        <p style={{
          fontFamily:   'var(--font-playfair)',
          fontStyle:    'italic',
          fontSize:     12,
          color:        'var(--text-mid)',
          lineHeight:   1.4,
          background:   'rgba(13,43,78,0.04)',
          padding:      '8px 10px',
          borderRadius: 8,
          margin:       0,
          overflow:     'hidden',
          textOverflow: 'ellipsis',
          display:      '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
        }}>
          {item.notes}
        </p>
      )}

      {/* Footer: meta + actions */}
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{
            fontFamily:    'var(--font-dm-sans)',
            fontSize:      10,
            fontWeight:    600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            padding:       '3px 8px',
            borderRadius:  4,
            background:    item.source === 'idealista_import' ? 'rgba(52,201,122,0.12)' : 'var(--border)',
            color:         item.source === 'idealista_import' ? '#1a7a47' : 'var(--text-mid)',
          }}>
            {item.source === 'idealista_import' ? 'Idealista' : 'Manual'}
          </span>
          <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11, color: 'var(--text-light)' }}>
            Analysed {relativeTime(item.analysed_at)}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {item.analysis_cache_id && (
            <Link
              href={`/analyse/${item.analysis_cache_id}`}
              style={actionStyle('primary')}
            >
              View
            </Link>
          )}
          <button onClick={() => onRefresh(item)} disabled={busy !== 'idle'} style={actionStyle('ghost', busy === 'refreshing')}>
            {busy === 'refreshing' ? 'Refreshing…' : 'Refresh'}
          </button>
          <button onClick={() => onNotes(item)} disabled={busy !== 'idle'} style={actionStyle('ghost')}>
            Notes
          </button>
          <button onClick={() => onDelete(item.id)} disabled={busy !== 'idle'} style={actionStyle('danger', busy === 'deleting')}>
            {busy === 'deleting' ? 'Deleting…' : 'Delete'}
          </button>
          <label style={{
            marginLeft:    'auto',
            display:       'inline-flex',
            alignItems:    'center',
            gap:           6,
            fontFamily:    'var(--font-dm-sans)',
            fontSize:      12,
            fontWeight:    600,
            color:         selected ? 'var(--navy-deep)' : 'var(--text-mid)',
            cursor:        'pointer',
            userSelect:    'none',
          }}>
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect(item.id)}
              style={{ accentColor: 'var(--navy-deep)', cursor: 'pointer' }}
            />
            Compare
          </label>
        </div>
      </div>
    </article>
  );
}

function actionStyle(kind: 'primary' | 'ghost' | 'danger', loading = false): React.CSSProperties {
  const base: React.CSSProperties = {
    fontFamily:     'var(--font-dm-sans)',
    fontSize:       12,
    fontWeight:     600,
    padding:        '6px 12px',
    borderRadius:   8,
    border:         'none',
    cursor:         loading ? 'wait' : 'pointer',
    textDecoration: 'none',
    display:        'inline-flex',
    alignItems:     'center',
  };
  if (kind === 'primary') return { ...base, background: 'var(--navy-deep)', color: '#34C97A' };
  if (kind === 'danger')  return { ...base, background: 'transparent', color: 'var(--risk)', boxShadow: '0 0 0 1px rgba(201,75,26,0.3)' };
  return { ...base, background: 'transparent', color: 'var(--text-mid)', boxShadow: '0 0 0 1px var(--border)' };
}

// ─── Notes modal ───────────────────────────────────────────────────────────

function NotesModal({
  item, onClose, onSave,
}: {
  item:   LibraryListItem;
  onClose: () => void;
  onSave:  (id: string, notes: string) => Promise<void>;
}) {
  const [value, setValue] = useState(item.notes ?? '');
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try { await onSave(item.id, value); onClose(); }
    finally { setSaving(false); }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        background: 'rgba(13,43,78,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--background)', borderRadius: 16, padding: 20,
          width: '100%', maxWidth: 480,
          boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
        }}
      >
        <h3 style={{ fontFamily: 'var(--font-playfair)', fontSize: 18, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>
          Notes
        </h3>
        <textarea
          autoFocus
          value={value}
          onChange={e => setValue(e.target.value)}
          rows={6}
          maxLength={2000}
          placeholder="Anything worth remembering about this property…"
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'var(--surface-2)', border: 'none', outline: 'none',
            borderRadius: 10, padding: 12,
            fontFamily: 'var(--font-dm-sans)', fontSize: 13, color: 'var(--text)',
            boxShadow: '0 0 0 1.5px var(--border)', resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button onClick={onClose} style={actionStyle('ghost')} disabled={saving}>Cancel</button>
          <button onClick={submit} style={actionStyle('primary', saving)} disabled={saving}>
            {saving ? 'Saving…' : 'Save notes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Top-level component ───────────────────────────────────────────────────

export function LibraryClient() {
  const router = useRouter();
  const [items,    setItems]    = useState<LibraryListItem[] | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const [busy,     setBusy]     = useState<Record<string, 'idle' | 'refreshing' | 'deleting'>>({});
  const [editing,  setEditing]  = useState<LibraryListItem | null>(null);
  const [prefs,    setPrefs]    = useState<StoredPreferences | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Hydrate preferences from localStorage after mount (SSR-safe).
  useEffect(() => { setPrefs(loadPreferences()); }, []);

  function updatePrefs(next: StoredPreferences) {
    setPrefs(next);
    savePreferences(next);
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 4) next.add(id);
      return next;
    });
  }

  function openCompare() {
    if (selected.size < 2) return;
    const ids = Array.from(selected).join(',');
    router.push(`/compare?ids=${ids}`);
  }

  const setItemBusy = (id: string, state: 'idle' | 'refreshing' | 'deleting') =>
    setBusy(prev => ({ ...prev, [id]: state }));

  async function load() {
    setError(null);
    try {
      const res = await fetch('/api/library', { cache: 'no-store' });
      if (!res.ok) {
        setError('Could not load library.');
        setItems([]);
        return;
      }
      const data = await res.json() as { items: LibraryListItem[] };
      setItems(data.items);
    } catch {
      setError('Network error.');
      setItems([]);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(id: string) {
    if (!confirm('Remove this property from your library?')) return;
    setItemBusy(id, 'deleting');
    try {
      const res = await fetch(`/api/library/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setItems(items => (items ?? []).filter(i => i.id !== id));
      }
    } finally {
      setItemBusy(id, 'idle');
    }
  }

  async function handleNotesSave(id: string, notes: string) {
    const res = await fetch(`/api/library/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ notes: notes.length > 0 ? notes : null }),
    });
    if (res.ok) {
      const updated = await res.json() as { notes: string | null; updated_at: string };
      setItems(items => (items ?? []).map(i =>
        i.id === id ? { ...i, notes: updated.notes, updated_at: updated.updated_at } : i
      ));
    }
  }

  /**
   * Refresh: invalidate cache → poll new analyse job → re-save snapshot.
   * Updates the row in place when complete.
   */
  async function handleRefresh(item: LibraryListItem) {
    setItemBusy(item.id, 'refreshing');
    try {
      const r = await fetch(`/api/library/${item.id}/refresh`, { method: 'POST' });
      if (!r.ok) { setItemBusy(item.id, 'idle'); return; }
      const trigger = await r.json() as
        | { jobId: string; status: 'pending' }
        | { id: string; cached: boolean }
        | { error: string };

      let analysisId: string | null = null;

      if ('jobId' in trigger) {
        // Poll until complete (max ~3 min — same envelope as the analyse page).
        for (let i = 0; i < 90; i++) {
          await new Promise(r => setTimeout(r, 2000));
          const s = await fetch(`/api/analyse/status?jobId=${trigger.jobId}`, { cache: 'no-store' });
          if (!s.ok) break;
          const body = await s.json() as { status?: string; id?: string };
          if (body.status === 'complete' && body.id) { analysisId = body.id; break; }
          if (body.status === 'error' || body.status === 'needs_input') break;
        }
      } else if ('id' in trigger) {
        analysisId = trigger.id;
      }

      if (analysisId) {
        // Re-save — POST upserts on (user_id, source_url).
        await fetch('/api/library', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ analysis_id: analysisId }),
        });
        await load();
      }
    } finally {
      setItemBusy(item.id, 'idle');
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  const toolbar = prefs && items && items.length > 0 ? (
    <div style={{
      display:       'grid',
      gridTemplateColumns: 'minmax(0, 1fr) auto',
      gap:           14,
      alignItems:    'start',
      marginBottom:  22,
    }}>
      <ProfilePicker prefs={prefs} onChange={updatePrefs} />
      <CompareBar selectedCount={selected.size} onCompare={openCompare} onClear={() => setSelected(new Set())} />
    </div>
  ) : null;

  if (items === null) {
    return (
      <Page>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {[...Array(6)].map((_, i) => (
            <div key={i} style={{
              background: 'var(--surface-2)', borderRadius: 16, height: 280,
              opacity: 0.7, animation: 'shimmer 1.4s infinite',
            }} />
          ))}
        </div>
      </Page>
    );
  }

  if (error) {
    return (
      <Page>
        <p style={{ fontFamily: 'var(--font-dm-sans)', color: 'var(--risk)' }}>{error}</p>
      </Page>
    );
  }

  if (items.length === 0) {
    return (
      <Page>
        <div style={{
          background: 'var(--surface-2)', borderRadius: 18, padding: '48px 32px',
          textAlign: 'center', maxWidth: 520, margin: '40px auto',
        }}>
          <h2 style={{ fontFamily: 'var(--font-playfair)', fontSize: 22, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
            Your library is empty
          </h2>
          <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 14, color: 'var(--text-mid)', marginBottom: 20, lineHeight: 1.5 }}>
            Save analyses you want to revisit. Hit Save on any DNA Report,
            or import a whole shortlist from Idealista.
          </p>
          <Link href="/analyse" style={{
            display: 'inline-block',
            background: 'var(--navy-deep)', color: '#34C97A',
            fontFamily: 'var(--font-dm-sans)', fontSize: 14, fontWeight: 600,
            padding: '12px 22px', borderRadius: 12, textDecoration: 'none',
          }}>
            Analyse a property →
          </Link>
        </div>
      </Page>
    );
  }

  return (
    <Page>
      {toolbar}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
        gap: 18,
      }}>
        {items.map(item => (
          <LibraryCard
            key={item.id}
            item={item}
            onDelete={handleDelete}
            onRefresh={handleRefresh}
            onNotes={(it) => setEditing(it)}
            busy={busy[item.id] ?? 'idle'}
            prefs={prefs ?? { profile: 'balanced', weights: { financial: 25, lifestyle: 25, risk: 25, community: 25 } }}
            selected={selected.has(item.id)}
            onToggleSelect={toggleSelect}
          />
        ))}
      </div>
      {editing && (
        <NotesModal
          item={editing}
          onClose={() => setEditing(null)}
          onSave={handleNotesSave}
        />
      )}
    </Page>
  );
}

// ─── Compare bar ───────────────────────────────────────────────────────────

function CompareBar({
  selectedCount, onCompare, onClear,
}: {
  selectedCount: number;
  onCompare: () => void;
  onClear:   () => void;
}) {
  const ready = selectedCount >= 2;
  return (
    <div style={{
      background:    'var(--surface-2)',
      borderRadius:  14,
      padding:       '14px 16px',
      boxShadow:     '0 0 0 1px var(--border)',
      display:       'flex',
      flexDirection: 'column',
      gap:           6,
      minWidth:      220,
    }}>
      <span style={{
        fontFamily:    'var(--font-dm-sans)',
        fontSize:      11,
        fontWeight:    600,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color:         'var(--text-light)',
      }}>
        Compare
      </span>
      <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, color: 'var(--text)' }}>
        {selectedCount === 0
          ? 'Pick 2–4 properties.'
          : `${selectedCount} selected${selectedCount >= 4 ? ' (max).' : '.'}`}
      </span>
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <button
          onClick={onCompare}
          disabled={!ready}
          style={{
            flex:        1,
            background:  ready ? 'var(--navy-deep)' : 'var(--border)',
            color:       ready ? '#34C97A' : 'var(--text-light)',
            fontFamily:  'var(--font-dm-sans)',
            fontSize:    12,
            fontWeight:  600,
            border:      'none',
            borderRadius: 8,
            padding:     '8px 10px',
            cursor:      ready ? 'pointer' : 'not-allowed',
          }}
        >
          Compare →
        </button>
        {selectedCount > 0 && (
          <button
            onClick={onClear}
            style={{
              background:  'transparent',
              color:       'var(--text-mid)',
              fontFamily:  'var(--font-dm-sans)',
              fontSize:    12,
              fontWeight:  600,
              border:      'none',
              boxShadow:   '0 0 0 1px var(--border)',
              borderRadius: 8,
              padding:     '8px 10px',
              cursor:      'pointer',
            }}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Page chrome ───────────────────────────────────────────────────────────

function Page({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px 80px' }}>
      <header style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: 'var(--font-playfair)', fontSize: 'clamp(24px, 3vw, 32px)', fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
          Property Library
        </h1>
        <p style={{ fontFamily: 'var(--font-playfair)', fontStyle: 'italic', fontSize: 16, color: 'var(--text-mid)' }}>
          Every property you&rsquo;re considering — kept in one place.
        </p>
      </header>
      {children}
    </main>
  );
}
