"use client"

/**
 * ResultView — full-page analysis result view.
 *
 * Handles three phases from the poller:
 *  - loading     → step progress (full-page centered)
 *  - needs_input → minimal form for missing fields (Parse.bot couldn't scrape them)
 *  - complete    → full Hidden DNA Report
 *  - error       → error state with retry link
 *
 * No sidebar. No two-panel layout. No scroll hacks needed.
 */

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { TVIRing } from '@/components/ui/TVIRing'
import { AlertPill } from '@/components/ui/AlertPill'
import { IndicatorCard, type IndicatorData } from '@/components/ui/IndicatorCard'
import { PillarScoreBar } from '@/components/ui/PillarScoreBar'
import { SkeletonCard } from '@/components/ui/SkeletonCard'
import { pollJob, type AnalysisResult, type PollState } from '@/lib/analysePoller'
import { ThemeToggle } from '@/components/report/ThemeToggle'
import { INDICATOR_REGISTRY, PILLAR_GROUPS } from '@/lib/indicators/registry'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { MiniMapCard } from '@/components/report/MiniMapCard'
import { ProximitySummary, type FacilityCounts } from '@/components/map/ProximitySummary'

// ─── Constants ────────────────────────────────────────────────────────────────

const STEP_LABELS = [
  'Queued…',
  'Fetching listing from Idealista…',
  'Looking up Catastro records…',
  'Running indicators…',
  'Saving analysis…',
]

const MALAGA_MEDIAN_PSM = 3200

const MISSING_FIELD_LABELS: Record<string, string> = {
  lat:          'Latitude',
  lng:          'Longitude',
  price_asking: 'Asking price (€)',
}

const MISSING_FIELD_PLACEHOLDERS: Record<string, string> = {
  lat:          '36.720',
  lng:          '-4.420',
  price_asking: '350000',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TopBar({
  backToMap,
  backLat,
  backLng,
}: {
  backToMap?: boolean;
  backLat?:   string;
  backLng?:   string;
}) {
  const backHref = backToMap && backLat && backLng
    ? `/map?lat=${backLat}&lng=${backLng}&pin=true`
    : '/analyse'
  const backLabel = backToMap && backLat && backLng
    ? '← Back to map'
    : '← Analyse another property'

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 24px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface-2)',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}
    >
      <span style={{ fontFamily: 'var(--font-playfair)', fontSize: 20, fontWeight: 700, color: 'var(--navy-deep)', letterSpacing: '-0.02em' }}>
        Qolify
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <ThemeToggle />
        <a
          href={backHref}
          style={{
            fontFamily:     'var(--font-dm-sans)',
            fontSize:       13,
            color:          'var(--text-mid)',
            textDecoration: 'none',
            padding:        '6px 14px',
            borderRadius:   8,
            boxShadow:      '0 0 0 1px var(--border)',
            transition:     'color 150ms',
          }}
        >
          {backLabel}
        </a>
      </div>
    </div>
  )
}

function CentredShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', padding: '40px 24px', gap: 24 }}>
      {children}
    </div>
  )
}

function StepProgress({ step }: { step: number }) {
  return (
    <CentredShell>
      <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
        Analysing property…
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {STEP_LABELS.map((label, i) => {
          const done   = i < step
          const active = i === step
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 280 }}>
              <span
                style={{
                  width: 22, height: 22, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  background: done ? '#34C97A' : active ? 'var(--navy-mid)' : 'var(--border)',
                  fontSize: 11, color: done || active ? '#fff' : 'var(--text-light)',
                  transition: 'background 200ms',
                }}
              >
                {done ? '✓' : active ? (
                  <span style={{ width: 8, height: 8, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', animation: 'spin 0.7s linear infinite', display: 'block' }} />
                ) : '·'}
              </span>
              <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, color: active ? 'var(--text)' : done ? 'var(--text-mid)' : 'var(--text-light)', transition: 'color 200ms' }}>
                {label}
              </span>
            </div>
          )
        })}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </CentredShell>
  )
}

function NeedsInputForm({
  missing,
  sourceUrl,
  onSubmit,
}: {
  missing: string[]
  sourceUrl: string
  onSubmit: (values: Record<string, string>) => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    onSubmit(values)
  }

  return (
    <CentredShell>
      <div style={{ maxWidth: 420, width: '100%' }}>
        <h2 style={{ fontFamily: 'var(--font-playfair)', fontSize: 22, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
          A few details needed
        </h2>
        {sourceUrl && (
          <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: 'var(--text-light)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {sourceUrl}
          </p>
        )}
        <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, color: 'var(--text-mid)', marginBottom: 24, lineHeight: 1.5 }}>
          We couldn&apos;t read all the required details from this listing automatically. Please fill in the missing fields to complete the analysis.
        </p>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {missing.map((field) => (
            <div key={field}>
              <label style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11, fontWeight: 600, color: 'var(--text-light)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {MISSING_FIELD_LABELS[field] ?? field}
              </label>
              <input
                type="text"
                value={values[field] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.value }))}
                placeholder={MISSING_FIELD_PLACEHOLDERS[field] ?? ''}
                required
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: 'var(--surface-2)', border: 'none', outline: 'none',
                  borderRadius: 10, padding: '11px 14px',
                  fontFamily: 'var(--font-dm-mono)', fontSize: 14, color: 'var(--text)',
                  boxShadow: '0 0 0 1.5px var(--border)', transition: 'box-shadow 150ms',
                }}
                onFocus={(e) => (e.target.style.boxShadow = '0 0 0 2px var(--navy-light)')}
                onBlur={(e)  => (e.target.style.boxShadow = '0 0 0 1.5px var(--border)')}
              />
            </div>
          ))}
          <button
            type="submit"
            disabled={submitting}
            style={{
              marginTop: 8, width: '100%',
              background: submitting ? 'var(--navy-mid)' : 'var(--navy-deep)',
              color: '#34C97A', border: 'none', borderRadius: 12,
              padding: '14px 16px', fontFamily: 'var(--font-dm-sans)',
              fontSize: 14, fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? 'Starting analysis…' : 'Run Analysis →'}
          </button>
        </form>
      </div>
    </CentredShell>
  )
}

// ─── Tier helpers ─────────────────────────────────────────────────────────────

type UserTier = 'free' | 'pro' | 'explorer' | 'intelligence'

/**
 * Maps a user tier string to a numeric rank so we can compare it against
 * the indicator's tier number from the registry.
 *
 * Registry tier 1 = all users (free and above)
 * Registry tier 2 = pro and above
 * Registry tier 3 = intelligence only
 */
function tierRank(tier: UserTier): number {
  switch (tier) {
    case 'free':         return 1
    case 'pro':          return 2
    case 'explorer':     return 2
    case 'intelligence': return 3
  }
}

function FullReport({ result }: { result: AnalysisResult }) {
  const [compressed, setCompressed] = useState(false)
  const [userTier, setUserTier] = useState<UserTier>('free')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => setCompressed(el.scrollTop > 80)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // Fetch the authenticated user's tier from Supabase JWT claims.
  // Defaults to 'free' for unauthenticated users so locked cards render correctly.
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data }) => {
      const tier = data.session?.user?.app_metadata?.tier as UserTier | undefined
      if (tier) setUserTier(tier)
    })
  }, [])

  const ci = result.composite_indicators as Partial<Record<string, IndicatorData>>

  function pillarScores() {
    const bars: Array<{ label: string; score: number }> = []

    for (const pillar of PILLAR_GROUPS) {
      const scores = pillar.keys
        .map(key => {
          const s = ci[key]?.score
          if (s == null) return null
          return pillar.invert.includes(key) ? 100 - s : s
        })
        .filter((s): s is number => s != null)
      if (scores.length > 0) {
        bars.push({
          label: pillar.label,
          score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
        })
      }
    }

    bars.push({ label: 'Overall TVI', score: result.tvi_score })
    return bars
  }

  const addressLine = result.property
    ? `${result.property.municipio ?? ''}, ${result.property.provincia ?? ''}`
    : result.source_url.replace(/https?:\/\/(www\.)?/, '').split('/')[0]

  return (
    <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', height: 'calc(100vh - 57px)' }}>
      {/* Sticky property header */}
      <div
        style={{
          position: 'sticky', top: 0, zIndex: 40,
          background: 'var(--background)',
          boxShadow: compressed ? 'var(--shadow-sm)' : 'none',
          transition: 'box-shadow 200ms',
        }}
      >
        <div style={{ padding: compressed ? '12px 24px' : '20px 24px', display: 'flex', alignItems: compressed ? 'center' : 'flex-start', justifyContent: 'space-between', gap: 16, transition: 'padding 200ms' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {!compressed && (
              <h1 style={{ fontFamily: 'var(--font-playfair)', fontSize: 'clamp(20px, 3vw, 28px)', fontWeight: 600, color: 'var(--text)', lineHeight: 1.2, marginBottom: 4 }}>
                Property Analysis
              </h1>
            )}
            <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, color: 'var(--text-light)', marginBottom: compressed ? 0 : 6 }}>
              {addressLine}
            </p>
            {!compressed && result.property?.price_asking && (
              <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 22, fontWeight: 500, color: 'var(--text)' }}>
                {formatCurrency(result.property.price_asking)}
              </p>
            )}
          </div>
          <TVIRing score={result.tvi_score} size={compressed ? 'sm' : 'lg'} />
        </div>
      </div>

      <div style={{ padding: '0 24px 80px', maxWidth: 900, margin: '0 auto' }}>

        {/* Alert banners */}
        {(result.alerts?.length ?? 0) > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 32, marginTop: 8 }}>
            {[...result.alerts]
              .sort((a, b) => ({ red: 0, amber: 1, green: 2 }[a.type] ?? 3) - ({ red: 0, amber: 1, green: 2 }[b.type] ?? 3))
              .map((alert, i) => (
                <AlertPill key={i} variant={alert.type} title={alert.title} description={(alert as Record<string, unknown>).description as string} />
              ))}
          </div>
        )}

        {/* Financial Intelligence */}
        <section style={{ marginBottom: 48 }}>
          <h2 style={{ fontFamily: 'var(--font-playfair)', fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
            Financial Intelligence
          </h2>
          <p style={{ fontFamily: 'var(--font-playfair)', fontStyle: 'italic', fontSize: 16, color: 'var(--text-mid)', marginBottom: 24 }}>
            The real cost of this property.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>

            {ci.true_affordability ? (
              <div style={{ background: 'var(--surface-2)', borderRadius: 12, padding: 20, boxShadow: 'var(--shadow-sm)' }}>
                <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, fontWeight: 600, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>
                  True Monthly Cost
                </p>
                {([
                  ['Mortgage (30yr, 80%)',     ci.true_affordability.details.monthly_mortgage_eur],
                  ['IBI property tax',          ci.true_affordability.details.monthly_ibi_eur],
                  ['Energy (climate-adjusted)', ci.true_affordability.details.monthly_energy_eur],
                ] as [string, unknown][]).map(([label, val]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: 'var(--text-mid)' }}>{label}</span>
                    <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 13, color: 'var(--text)' }}>
                      {val != null ? `${formatCurrency(Number(val))}/mo` : '—'}
                    </span>
                  </div>
                ))}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Total estimated monthly</span>
                  <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 18, fontWeight: 500, color: 'var(--text)' }}>
                    {ci.true_affordability.details.monthly_total_eur != null
                      ? `${formatCurrency(Number(ci.true_affordability.details.monthly_total_eur))}/mo` : '—'}
                  </span>
                </div>
              </div>
            ) : <SkeletonCard label="True Monthly Cost" />}

            {result.property?.price_per_sqm != null ? (
              <div style={{ background: 'var(--surface-2)', borderRadius: 12, padding: 20, boxShadow: 'var(--shadow-sm)' }}>
                <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, fontWeight: 600, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>Price Intelligence</p>
                <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 28, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>
                  {formatCurrency(result.property.price_per_sqm)}<span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-light)' }}>/m²</span>
                </p>
                <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: 'var(--text-mid)' }}>
                  vs. Málaga median <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 12, color: 'var(--text)' }}>{formatCurrency(MALAGA_MEDIAN_PSM)}/m²</span>
                </p>
                <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, marginTop: 8, color: result.property.price_per_sqm > MALAGA_MEDIAN_PSM ? 'var(--risk)' : 'var(--emerald-bright)' }}>
                  {result.property.price_per_sqm > MALAGA_MEDIAN_PSM
                    ? `${formatCurrency(result.property.price_per_sqm - MALAGA_MEDIAN_PSM)}/m² above median`
                    : `${formatCurrency(MALAGA_MEDIAN_PSM - result.property.price_per_sqm)}/m² below median`}
                </p>
              </div>
            ) : <SkeletonCard label="Price Intelligence" />}

            {result.property ? (
              <div style={{ background: 'var(--surface-2)', borderRadius: 12, padding: 20, boxShadow: 'var(--shadow-sm)' }}>
                <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, fontWeight: 600, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>Property</p>
                {[
                  ['Built',    String(result.property.build_year ?? '—')],
                  ['Size',     result.property.area_sqm != null ? `${result.property.area_sqm}m²` : '—'],
                  ['EPC',      result.property.epc_rating ?? '—'],
                  ['Location', `${result.property.municipio ?? ''}, ${result.property.provincia ?? ''}`],
                ].map(([label, val]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: 'var(--text-mid)' }}>{label}</span>
                    <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 12, color: 'var(--text)' }}>{val}</span>
                  </div>
                ))}
              </div>
            ) : <SkeletonCard label="Property" />}

          </div>
        </section>

        {/* All indicators — driven by registry */}
        <section style={{ marginBottom: 48 }}>
          <h2 style={{ fontFamily: 'var(--font-playfair)', fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
            The {INDICATOR_REGISTRY.length} signals
          </h2>
          <p style={{ fontFamily: 'var(--font-playfair)', fontStyle: 'italic', fontSize: 16, color: 'var(--text-mid)', marginBottom: 24 }}>
            What the listing doesn&apos;t tell you.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
            {INDICATOR_REGISTRY.map(({ key, label, live, tier }) => {
              // Not yet built as a live feature — show "coming soon" skeleton unchanged
              if (!live) return <SkeletonCard key={key} label={label} />

              // User's tier doesn't cover this indicator — show locked state
              if (tierRank(userTier) < tier) {
                return <IndicatorCard key={key} indicatorKey={key} locked />
              }

              // Live indicator, data present with a real score — show full loaded card.
              // score === null means the pipeline ran but had insufficient data;
              // treat that the same as absent data so UnavailableCard renders
              // rather than an ambiguous loaded card with an empty badge.
              const data = ci[key]
              if (data && data.score !== null) {
                return <IndicatorCard key={key} indicatorKey={key} data={data} />
              }

              // Live indicator, no data or null score — show unavailable
              return <IndicatorCard key={key} indicatorKey={key} />
            })}
          </div>
        </section>

        {/* Section 4 — Life Proximity + Mini-Map */}
        {/* Per REPORT_PAGE_SPEC.md §4: two-column, LEFT=MiniMapCard 220px, RIGHT=ProximitySummary full categories */}
        <section style={{ marginBottom: 48 }}>
          <h2 style={{ fontFamily: 'var(--font-playfair)', fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
            Life Proximity
          </h2>
          <p style={{ fontFamily: 'var(--font-playfair)', fontStyle: 'italic', fontSize: 16, color: 'var(--text-mid)', marginBottom: 24 }}>
            What&apos;s within a 5-minute walk.
          </p>

          {result.property.lat != null && result.property.lng != null ? (
            <div style={{
              display:             'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap:                 24,
              alignItems:          'start',
            }}>
              <MiniMapCard lat={result.property.lat} lng={result.property.lng} />
              <ProximitySummaryFromCoords lat={result.property.lat} lng={result.property.lng} />
            </div>
          ) : (
            /* Coordinates null — proximity data cannot be fetched */
            <div style={{ background: 'var(--surface-2)', borderRadius: 12, padding: 20 }}>
              <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, color: 'var(--text-mid)', marginBottom: 12 }}>
                Location data not available for this property.
              </p>
              <Link
                href="/analyse"
                style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, color: 'var(--emerald-bright)', textDecoration: 'none' }}
              >
                Add an Idealista URL to unlock location intelligence →
              </Link>
            </div>
          )}
        </section>

        {/* Pillar Scores */}
        <section style={{ marginBottom: 48 }}>
          <h2 style={{ fontFamily: 'var(--font-playfair)', fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 600, color: 'var(--text)', marginBottom: 24 }}>
            How this property scores
          </h2>
          <div style={{ background: 'var(--surface-2)', borderRadius: 18, padding: 24, boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 520 }}>
            {pillarScores().map((p, i) => (
              <PillarScoreBar key={p.label} label={p.label} score={p.score} delayMs={i * 60} />
            ))}
          </div>
          <p style={{ fontFamily: 'var(--font-playfair)', fontStyle: 'italic', fontSize: 13, color: 'var(--text-light)', marginTop: 16 }}>
            Overall TVI based on available live signals. More indicators unlock as data is ingested.
          </p>
        </section>

        {/* Cache notice */}
        {result.cached && (
          <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: 'var(--text-light)' }}>
            Analysis from {formatDate(result.expires_at)} — refreshes automatically after 48 hours.
          </p>
        )}

      </div>
    </div>
  )
}

// ─── ProximitySummaryFromCoords ───────────────────────────────────────────────
//
// Fetches /api/map/amenities for a coordinate pair and derives the FacilityCounts
// shape that ProximitySummary expects. Used in ResultView where FacilityCounts
// is not pre-loaded (unlike PinReportPanel which receives it from POST /api/map/pin).
//
// onExpandRadius is a no-op here: there is no map canvas in the report context
// to sync with. The "Show all →" toggle works normally — it is internal state.

interface RawFeature {
  properties: { type?: string; distance_m: number };
}

interface AmenitiesRaw {
  schools?:     RawFeature[];
  health?:      RawFeature[];
  pharmacy?:    RawFeature[];
  transport?:   RawFeature[];
  supermarket?: RawFeature[];
  park?:        RawFeature[];
  cafe?:        RawFeature[];
}

function ProximitySummaryFromCoords({ lat, lng }: { lat: number; lng: number }) {
  const [facilities, setFacilities] = useState<FacilityCounts | null>(null);

  useEffect(() => {
    fetch(`/api/map/amenities?lat=${lat}&lng=${lng}&radius=400`)
      .then(r => r.ok ? r.json() as Promise<AmenitiesRaw> : null)
      .then((data: AmenitiesRaw | null) => {
        if (!data) return;

        // Returns the distance_m of the nearest item, or 0 if none
        const nearest = (arr: RawFeature[]) =>
          arr.length > 0 ? arr[0].properties.distance_m : 0;

        // Split transport by tipo — metro vs bus/other
        const metros = (data.transport ?? []).filter(f =>
          (f.properties.type ?? '').toLowerCase().includes('metro'));
        const buses  = (data.transport ?? []).filter(f =>
          !(f.properties.type ?? '').toLowerCase().includes('metro'));

        setFacilities({
          gp_count:              data.health?.length        ?? 0,
          gp_nearest_m:          nearest(data.health        ?? []),
          pharmacy_count:        data.pharmacy?.length      ?? 0,
          pharmacy_nearest_m:    nearest(data.pharmacy      ?? []),
          school_primary_count:  data.schools?.length       ?? 0,
          school_nearest_m:      nearest(data.schools       ?? []),
          school_in_catchment:   false,  // catchment requires pin-level query; not available here
          metro_count:           metros.length,
          metro_nearest_m:       nearest(metros),
          bus_stops_count:       buses.length,
          bus_nearest_m:         nearest(buses),
          supermarket_count:     data.supermarket?.length   ?? 0,
          supermarket_nearest_m: nearest(data.supermarket   ?? []),
          park_count:            data.park?.length          ?? 0,
          park_nearest_m:        nearest(data.park          ?? []),
          cafe_count:            data.cafe?.length          ?? 0,
          cafe_nearest_m:        nearest(data.cafe          ?? []),
        });
      })
      .catch(() => { /* fail silently — section shows unavailable appearance */ });
  }, [lat, lng]);

  if (!facilities) {
    // Loading shimmer — matches ProximitySummary row height
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            style={{ height: 32, borderRadius: 6, background: 'var(--surface-2)', animation: 'shimmer 1.4s infinite' }}
          />
        ))}
      </div>
    );
  }

  return (
    <ProximitySummary
      facilities={facilities}
      radiusM={400}
      onExpandRadius={() => {}}  // no-op: no map canvas in report context
      compact={false}            // full categories — not the 4-category triage subset
    />
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ResultView({
  jobId,
  backToMap,
  backLat,
  backLng,
}: {
  jobId:      string;
  backToMap?: boolean;
  backLat?:   string;
  backLng?:   string;
}) {
  const router = useRouter()
  const [state, setState] = useState<PollState>({ phase: 'loading', step: 0 })
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    abortRef.current = new AbortController()
    let cancelled = false

    ;(async () => {
      for await (const next of pollJob(jobId)) {
        if (cancelled) break
        setState(next)
        if (next.phase === 'complete') {
          // Persist to recent-analyses list in localStorage
          try {
            const r = next.result
            if (r.property?.municipio && r.property?.price_asking) {
              const item = { id: r.id, url: r.source_url, municipio: r.property.municipio, price: r.property.price_asking, tvi: r.tvi_score, analysedAt: new Date().toISOString() }
              const stored = JSON.parse(localStorage.getItem('qolify_recent') ?? '[]') as unknown[]
              const updated = [item, ...(stored as typeof item[]).filter((x) => x.id !== r.id)].slice(0, 3)
              localStorage.setItem('qolify_recent', JSON.stringify(updated))
            }
          } catch { /* localStorage unavailable */ }
        }
        if (next.phase !== 'loading') break
      }
    })()

    return () => {
      cancelled = true
      abortRef.current?.abort()
    }
  }, [jobId])

  // Re-submit handler for the needs_input case.
  // POSTs a new job with the same URL + the user-supplied missing fields,
  // then navigates to the new job's result page.
  async function handleNeedsInputSubmit(
    sourceUrl: string,
    values: Record<string, string>,
  ) {
    const manualProperty: Record<string, number | string> = {}
    for (const [key, val] of Object.entries(values)) {
      if (!val.trim()) continue
      if (key === 'lat' || key === 'lng')   manualProperty[key] = parseFloat(val)
      else if (key === 'price_asking')      manualProperty[key] = parseInt(val, 10)
      else                                  manualProperty[key] = val
    }

    const res = await fetch('/api/analyse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: sourceUrl, property: manualProperty }),
    })

    if (!res.ok) {
      setState({ phase: 'error', message: `Could not start analysis (HTTP ${res.status}).` })
      return
    }

    const data = await res.json()
    if (data.jobId) {
      router.push(`/analyse/${data.jobId}`)
    } else if (data.cached && data.id) {
      router.push(`/analyse/${data.id}`)
    } else {
      setState({ phase: 'error', message: 'Unexpected response. Please try again.' })
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)', display: 'flex', flexDirection: 'column' }}>
      <TopBar backToMap={backToMap} backLat={backLat} backLng={backLng} />

      {state.phase === 'loading' && <StepProgress step={state.step} />}

      {state.phase === 'needs_input' && (
        <NeedsInputForm
          missing={state.missing}
          sourceUrl={state.sourceUrl}
          onSubmit={(values) => handleNeedsInputSubmit(state.sourceUrl, values)}
        />
      )}

      {state.phase === 'complete' && <FullReport result={state.result} />}

      {state.phase === 'error' && (
        <CentredShell>
          <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 14, color: 'var(--risk)', background: 'rgba(201,75,26,0.06)', borderRadius: 10, padding: '12px 18px', maxWidth: 420, textAlign: 'center' }}>
            {state.message}
          </p>
          <Link href="/analyse" style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, color: 'var(--navy-deep)', textDecoration: 'none' }}>
            ← Try a different property
          </Link>
        </CentredShell>
      )}

      {state.phase === 'timeout' && (
        <CentredShell>
          <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 14, color: 'var(--text-mid)', maxWidth: 380, textAlign: 'center', lineHeight: 1.6 }}>
            The analysis is taking longer than expected. The job is still running — <a href={`/analyse/${jobId}`} style={{ color: 'var(--navy-deep)' }}>reload this page</a> in a minute to see the result.
          </p>
        </CentredShell>
      )}
    </div>
  )
}
