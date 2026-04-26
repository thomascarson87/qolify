'use client';

/**
 * SaveToLibraryButton — Save / Saved toggle shown on the analysis result page.
 *
 * Behaviour:
 *  - On mount, asks /api/library if a row already exists for this analysis_id
 *    (cheap — list endpoint is keyed on user; we filter client-side).
 *  - Click → POST /api/library { analysis_id }. Server upserts on
 *    (user_id, source_url) so re-saving a refreshed analysis is fine.
 *  - Re-click while "Saved" → DELETE /api/library/[id] to remove from library.
 */

import { useEffect, useState } from 'react';

interface Props {
  analysisId: string;
  /** Optional callback so parents can refresh related UI. */
  onChange?: (savedId: string | null) => void;
}

export function SaveToLibraryButton({ analysisId, onChange }: Props) {
  // null = unknown (still loading), string = saved (with row id), false = not saved
  const [savedId, setSavedId] = useState<string | null | false>(null);
  const [busy,    setBusy]    = useState(false);

  // Probe on mount — find an existing saved row whose analysis_json.id matches.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/library', { cache: 'no-store' });
        if (!res.ok) { if (!cancelled) setSavedId(false); return; }
        const data = await res.json() as { items: Array<{ id: string; analysis_cache_id: string | null }> };
        const hit = data.items.find(it => it.analysis_cache_id === analysisId)?.id ?? null;
        if (!cancelled) setSavedId(hit ?? false);
      } catch {
        if (!cancelled) setSavedId(false);
      }
    })();
    return () => { cancelled = true; };
  }, [analysisId]);

  async function onSave() {
    setBusy(true);
    try {
      const res = await fetch('/api/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ analysis_id: analysisId }),
      });
      if (res.ok) {
        const body = await res.json() as { id: string };
        setSavedId(body.id);
        onChange?.(body.id);
      }
    } finally {
      setBusy(false);
    }
  }

  async function onUnsave() {
    if (!savedId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/library/${savedId}`, { method: 'DELETE' });
      if (res.ok) {
        setSavedId(false);
        onChange?.(null);
      }
    } finally {
      setBusy(false);
    }
  }

  const isSaved   = typeof savedId === 'string';
  const isLoading = savedId === null;

  return (
    <button
      type="button"
      onClick={isSaved ? onUnsave : onSave}
      disabled={busy || isLoading}
      aria-pressed={isSaved}
      style={{
        display:        'inline-flex',
        alignItems:     'center',
        gap:            6,
        background:     isSaved ? 'var(--surface-2)' : 'var(--navy-deep)',
        color:          isSaved ? 'var(--text)' : '#34C97A',
        border:         'none',
        boxShadow:      isSaved ? '0 0 0 1px var(--border)' : 'none',
        borderRadius:   10,
        padding:        '8px 14px',
        fontFamily:     'var(--font-dm-sans)',
        fontSize:       13,
        fontWeight:     600,
        cursor:         busy || isLoading ? 'wait' : 'pointer',
        opacity:        isLoading ? 0.5 : 1,
        whiteSpace:     'nowrap',
        transition:     'opacity 120ms',
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <path d="M3 2h8v10l-4-2.5L3 12V2z" strokeLinejoin="round" />
      </svg>
      {isLoading ? '…' : isSaved ? 'Saved to Library' : 'Save to Library'}
    </button>
  );
}
