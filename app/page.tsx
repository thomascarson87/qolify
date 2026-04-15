'use client';

/**
 * Landing page — Qolify
 *
 * Entry points:
 *   1. Address search  → geocodes with MapTiler, navigates to /map?lat=&lng=&name=
 *   2. Idealista URL   → POST /api/analyse → navigate to /analyse/[jobId]
 *
 * Session C additions:
 *   - ICP profile selector (5a) — stored in localStorage, passed to API
 *   - "What Qolify reveals" preview cards (5b) — static, non-clickable
 *   - Recent analyses list (5c) — from localStorage, links to /analyse/[id]
 *
 * ThemeToggle removed from this page — it now lives in TopNav globally.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GeocodingFeature {
  place_name: string;
  geometry:   { coordinates: [number, number] }; // [lng, lat]
}

interface RecentItem {
  id:         string;
  url:        string;
  address?:   string | null; // added Session C — falls back to municipio if null
  municipio:  string;
  price:      number;
  tvi:        number;
  analysedAt: string;
}

type IcpProfile = 'family' | 'nomad' | 'retiree' | 'investor';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAPTILER_URL = 'https://api.maptiler.com/geocoding';
const MALAGA_PROX  = '-4.4214,36.7213';

const ICP_PILLS: { value: IcpProfile; label: string }[] = [
  { value: 'family',   label: 'Family'   },
  { value: 'nomad',    label: 'Nomad'    },
  { value: 'retiree',  label: 'Retiree'  },
  { value: 'investor', label: 'Investor' },
];

// "What Qolify reveals" cards — static, non-clickable
const PREVIEW_CARDS = [
  { icon: '🏗️', label: 'ITE Building Status',      teaser: 'Is a major repair levy coming?' },
  { icon: '💰', label: 'True Monthly Cost',          teaser: 'Mortgage + tax + energy, combined.' },
  { icon: '🌊', label: 'Flood Risk Zone',            teaser: 'Is the plot on a SNCZI risk map?' },
  { icon: '🏥', label: 'Health Security',            teaser: 'Nearest GP, ER, and pharmacy.' },
  { icon: '🏘️', label: 'Neighbourhood Transition',  teaser: 'Is this area improving before prices reflect it?' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs  < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}

// ---------------------------------------------------------------------------
// AddressInput — geocode search, navigates to /map on select
// ---------------------------------------------------------------------------

function AddressInput({ onNavigate }: { onNavigate: (lat: number, lng: number, name: string) => void }) {
  const [query,     setQuery]     = useState('');
  const [results,   setResults]   = useState<GeocodingFeature[]>([]);
  const [open,      setOpen]      = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [loading,   setLoading]   = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef  = useRef<HTMLDivElement>(null);

  const fetchResults = useCallback(async (q: string) => {
    const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
    if (!key || q.trim().length < 2) { setResults([]); setOpen(false); return; }
    setLoading(true);
    try {
      const url = `${MAPTILER_URL}/${encodeURIComponent(q)}.json` +
        `?key=${key}&country=es&proximity=${MALAGA_PROX}&limit=5&types=address,poi,place`;
      const res  = await fetch(url);
      const data = await res.json();
      const features: GeocodingFeature[] = data.features ?? [];
      setResults(features);
      setOpen(features.length > 0);
      setActiveIdx(-1);
    } catch {
      setResults([]); setOpen(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); setOpen(false); return; }
    debounceRef.current = setTimeout(() => fetchResults(query), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, fetchResults]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function select(feature: GeocodingFeature) {
    const [lng, lat] = feature.geometry.coordinates;
    setQuery(feature.place_name);
    setOpen(false);
    onNavigate(lat, lng, feature.place_name);
  }

  function handleKey(e: React.KeyboardEvent) {
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, results.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && activeIdx >= 0) select(results[activeIdx]);
    if (e.key === 'Escape') setOpen(false);
  }

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width: '100%' }}>
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onKeyDown={handleKey}
          placeholder="Search an address or area in Málaga…"
          autoComplete="off"
          style={{
            width:        '100%',
            boxSizing:    'border-box',
            background:   'var(--input-bg)',
            border:       '1.5px solid var(--input-border)',
            borderRadius: 10,
            padding:      '13px 44px 13px 16px',
            fontFamily:   'var(--font-dm-sans)',
            fontSize:     14,
            color:        'var(--text)',
            outline:      'none',
            transition:   'border-color 0.15s',
          }}
          onMouseOver={e => (e.currentTarget.style.borderColor = '#34C97A')}
          onMouseOut={e  => (e.currentTarget.style.borderColor = open ? '#34C97A' : 'var(--input-border)')}
        />
        <span aria-hidden style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: loading ? '#34C97A' : 'var(--text-light)', fontSize: 16, pointerEvents: 'none' }}>
          {loading ? '⟳' : '⌕'}
        </span>
      </div>

      {open && results.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 10, overflow: 'hidden', zIndex: 50, boxShadow: 'var(--shadow-lg)' }}>
          {results.map((f, i) => (
            <button
              key={i}
              onMouseDown={() => select(f)}
              style={{
                display:      'block',
                width:        '100%',
                textAlign:    'left',
                padding:      '10px 16px',
                fontFamily:   'var(--font-dm-sans)',
                fontSize:     13,
                color:        i === activeIdx ? '#34C97A' : 'var(--text-mid)',
                background:   i === activeIdx ? 'rgba(52,201,122,0.08)' : 'transparent',
                border:       'none',
                cursor:       'pointer',
                borderBottom: i < results.length - 1 ? '1px solid var(--divider)' : 'none',
              }}
            >
              {f.place_name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Home() {
  const router = useRouter();

  // URL form state
  const [idealistaUrl, setIdealistaUrl] = useState('');
  const [urlError,     setUrlError]     = useState('');
  const [submitting,   setSubmitting]   = useState(false);

  // ICP profile — persisted to localStorage (5a)
  const [icpProfile, setIcpProfile] = useState<IcpProfile | null>(null);

  // Recent analyses — read from localStorage (5c)
  const [recent, setRecent] = useState<RecentItem[]>([]);

  useEffect(() => {
    // Load ICP profile
    try {
      const p = localStorage.getItem('qolify_icp_profile') as IcpProfile | null;
      if (p) setIcpProfile(p);
    } catch { /* localStorage unavailable */ }

    // Load recent analyses
    try {
      const stored = localStorage.getItem('qolify_recent');
      if (stored) setRecent(JSON.parse(stored));
    } catch { /* localStorage unavailable */ }
  }, []);

  function selectProfile(p: IcpProfile) {
    // Clicking the active pill deselects it
    const next = icpProfile === p ? null : p;
    setIcpProfile(next);
    try {
      if (next) localStorage.setItem('qolify_icp_profile', next);
      else      localStorage.removeItem('qolify_icp_profile');
    } catch { /* localStorage unavailable */ }
  }

  function handleAddressNav(lat: number, lng: number, name: string) {
    const params = new URLSearchParams({ lat: String(lat), lng: String(lng), name });
    router.push(`/map?${params.toString()}`);
  }

  async function handleUrlSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = idealistaUrl.trim();
    if (!trimmed) { setUrlError('Please paste an Idealista listing URL.'); return; }
    if (!trimmed.includes('idealista.com')) {
      setUrlError('Please paste a valid Idealista URL (idealista.com/inmueble/…).');
      return;
    }
    setUrlError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/analyse', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        // profile included so the API can tailor indicator weighting per ICP (5a)
        body:    JSON.stringify({ url: trimmed, profile: icpProfile }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.message ?? err?.error ?? `Server error (HTTP ${res.status})`);
      }
      const data = await res.json();
      if (data.jobId)              router.push(`/analyse/${data.jobId}`);
      else if (data.cached && data.id) router.push(`/analyse/${data.id}`);
      else throw new Error('Unexpected response. Please try again.');
      // Note: don't setSubmitting(false) on success — page navigates away
    } catch (err) {
      setSubmitting(false);
      setUrlError(err instanceof Error ? err.message : 'Something went wrong.');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, background: 'var(--background)' }}>

      <main style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '40px 24px 64px', textAlign: 'center' }}>

        {/* Wordmark */}
        <div style={{ marginBottom: 32 }}>
          <h1 className="font-[family-name:var(--font-playfair)]" style={{ fontSize: 48, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--navy-deep)', marginBottom: 8 }}>
            Qolify
          </h1>
          <p className="font-[family-name:var(--font-playfair)]" style={{ fontStyle: 'italic', fontSize: 15, color: 'var(--text-mid)' }}>
            Know what you&apos;re really buying.
          </p>
        </div>

        {/* Sub-headline */}
        <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 15, lineHeight: 1.75, color: 'var(--text-light)', maxWidth: 440, marginBottom: 40 }}>
          Property intelligence for Spain that no portal will show you.{' '}
          <span style={{ color: 'var(--text-mid)' }}>Flood zones. Tourist saturation. Catastro building data. Solar exposure. Price context.</span>
          {' '}All in one place.
        </p>

        {/* ---- Address search ---- */}
        <div style={{ width: '100%', maxWidth: 520, marginBottom: 16 }}>
          <AddressInput onNavigate={handleAddressNav} />
          <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: 'var(--text-light)', marginTop: 8 }}>
            Search an address to explore zone intelligence and drop a pin.
          </p>
        </div>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', maxWidth: 520, marginBottom: 16 }}>
          <div style={{ flex: 1, height: 1, background: 'var(--divider)' }} />
          <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: 'var(--text-light)' }}>or</span>
          <div style={{ flex: 1, height: 1, background: 'var(--divider)' }} />
        </div>

        {/* ---- Idealista URL form ---- */}
        <div style={{ width: '100%', maxWidth: 520, marginBottom: 20 }}>
          <form onSubmit={handleUrlSubmit}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="url"
                value={idealistaUrl}
                onChange={e => { setIdealistaUrl(e.target.value); setUrlError(''); }}
                placeholder="Paste an Idealista listing URL…"
                style={{
                  flex:         1,
                  background:   'var(--input-bg)',
                  border:       '1.5px solid var(--input-border)',
                  borderRadius: 10,
                  padding:      '13px 16px',
                  fontFamily:   'var(--font-dm-sans)',
                  fontSize:     14,
                  color:        'var(--text)',
                  outline:      'none',
                  minWidth:     0,
                  transition:   'border-color 0.15s',
                }}
              />
              <button
                type="submit"
                disabled={submitting}
                style={{
                  fontFamily:  'var(--font-dm-sans)',
                  fontSize:    13,
                  fontWeight:  600,
                  color:       '#0D1B2A',
                  background:  '#34C97A',
                  border:      'none',
                  borderRadius: 10,
                  padding:     '0 20px',
                  cursor:      submitting ? 'not-allowed' : 'pointer',
                  whiteSpace:  'nowrap',
                  flexShrink:  0,
                  opacity:     submitting ? 0.6 : 1,
                  transition:  'opacity 150ms',
                }}
              >
                {submitting ? 'Starting…' : 'Analyse →'}
              </button>
            </div>
            {urlError && (
              <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: 'var(--risk)', marginTop: 8, textAlign: 'left' }}>
                {urlError}
              </p>
            )}
          </form>
          <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: 'var(--text-light)', marginTop: 8, textAlign: 'left' }}>
            Get Catastro data, ITE status, solar context, and price benchmarks for any listing.
          </p>
        </div>

        {/* ---- 5a: ICP profile selector ---- */}
        <div style={{ width: '100%', maxWidth: 520, marginBottom: 32 }}>
          <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, fontWeight: 600, color: 'var(--text-light)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>
            Who are you buying for?
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            {ICP_PILLS.map(({ value, label }) => {
              const active = icpProfile === value;
              return (
                <button
                  key={value}
                  onClick={() => selectProfile(value)}
                  style={{
                    fontFamily:   'var(--font-dm-sans)',
                    fontSize:     13,
                    fontWeight:   active ? 600 : 400,
                    color:        active ? '#FFFFFF' : 'var(--text-mid)',
                    background:   active ? '#0D2B4E' : 'transparent',
                    border:       `1.5px solid ${active ? '#0D2B4E' : 'var(--border)'}`,
                    borderRadius: 20,
                    padding:      '7px 18px',
                    cursor:       'pointer',
                    transition:   'background 150ms, color 150ms, border-color 150ms',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ---- 5b: "What Qolify reveals" preview cards ---- */}
        <div style={{ width: '100%', maxWidth: 600, marginBottom: 40 }}>
          <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, fontWeight: 600, color: 'var(--text-light)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 14 }}>
            What Qolify reveals
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 10 }}>
            {PREVIEW_CARDS.map(({ icon, label, teaser }) => (
              <div
                key={label}
                style={{
                  background:  'var(--surface-2)',
                  borderRadius: 12,
                  padding:     '12px 16px',
                  boxShadow:   'var(--shadow-sm)',
                  display:     'flex',
                  alignItems:  'flex-start',
                  gap:         10,
                  flex:        '1 1 140px',
                  minWidth:    140,
                  maxWidth:    180,
                  textAlign:   'left',
                  // Non-clickable — no cursor, no hover behaviour
                  userSelect:  'none',
                }}
              >
                <span style={{ fontSize: 20, flexShrink: 0 }}>{icon}</span>
                <div>
                  <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>{label}</p>
                  <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11, color: 'var(--text-mid)', lineHeight: 1.5 }}>{teaser}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ---- 5c: Recent analyses ---- */}
        {recent.length > 0 && (
          <div style={{ width: '100%', maxWidth: 520, marginBottom: 40 }}>
            <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, fontWeight: 600, color: 'var(--text-light)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>
              Recent
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {recent.map((item) => (
                <button
                  key={item.id}
                  onClick={() => router.push(`/analyse/${item.id}`)}
                  style={{
                    background:  'var(--surface-2)',
                    border:      'none',
                    borderRadius: 10,
                    padding:     '10px 14px',
                    cursor:      'pointer',
                    display:     'flex',
                    alignItems:  'center',
                    justifyContent: 'space-between',
                    gap:         12,
                    boxShadow:   'var(--shadow-sm)',
                    textAlign:   'left',
                    width:       '100%',
                    transition:  'box-shadow 120ms',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.boxShadow = 'var(--shadow-md, var(--shadow-sm))')}
                  onMouseLeave={e => (e.currentTarget.style.boxShadow = 'var(--shadow-sm)')}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Address if available, municipio as fallback (5c) */}
                    <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }}>
                      {item.address ?? item.municipio}
                    </p>
                    <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11, color: 'var(--text-light)' }}>
                      {formatCurrency(item.price)} · {timeAgo(item.analysedAt)}
                    </p>
                  </div>
                  <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 13, fontWeight: 600, color: 'var(--navy-deep)', flexShrink: 0 }}>
                    TVI {item.tvi}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ---- Three-step journey ---- */}
        <div style={{ width: '100%', maxWidth: 640, marginBottom: 40 }}>
          <div className="relative flex flex-col sm:flex-row items-stretch gap-0 sm:gap-0">

            {/* Step connector line — desktop only */}
            <div
              className="hidden sm:block absolute top-8 left-[calc(33.33%-1px)] right-[calc(33.33%-1px)] h-px"
              style={{ background: `linear-gradient(90deg, var(--divider) 0%, #34C97A 50%, var(--divider) 100%)` }}
              aria-hidden
            />

            {[
              { n: '1', title: 'Explore the map',    body: 'Find areas that match your life. Filter by schools, flood risk, solar exposure, and community character.' },
              { n: '2', title: 'Drop a pin',          body: 'Get instant flood zone status, walkability, and neighbourhood intelligence for any exact address.' },
              { n: '3', title: 'Analyse a listing',   body: 'Paste an Idealista URL above. Get the full hidden picture — Catastro, ITE, price context, and more.' },
            ].map(({ n, title, body }) => (
              <div key={n} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '24px 16px' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--surface-1)', border: '1.5px solid #34C97A', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12, position: 'relative', zIndex: 1 }}>
                  <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 13, fontWeight: 500, color: '#34C97A' }}>{n}</span>
                </div>
                <p className="font-[family-name:var(--font-playfair)]" style={{ fontWeight: 600, fontSize: 15, color: 'var(--navy-deep)', marginBottom: 8 }}>
                  {title}
                </p>
                <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, lineHeight: 1.6, color: 'var(--text-light)' }}>
                  {body}
                </p>
              </div>
            ))}

          </div>
        </div>

        {/* Open map CTA */}
        <a
          href="/map"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '12px 32px', background: '#34C97A', color: '#0D1B2A', borderRadius: 12, textDecoration: 'none', fontFamily: 'var(--font-dm-sans)', fontSize: 14, fontWeight: 600, transition: 'opacity 150ms' }}
          onMouseOver={e => (e.currentTarget.style.opacity = '0.88')}
          onMouseOut={e  => (e.currentTarget.style.opacity = '1')}
        >
          Open the map →
        </a>

        {/* Phase indicator */}
        <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: 'var(--text-light)', marginTop: 40 }}>
          Phase 0 — Málaga data. More cities coming.
        </p>

      </main>
    </div>
  );
}
