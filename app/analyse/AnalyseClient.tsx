"use client"

/**
 * AnalyseClient — URL input page.
 *
 * Responsibilities:
 *  - Accept a property URL
 *  - POST /api/analyse
 *  - On cache hit → router.push(`/analyse/${cacheId}`)
 *  - On new job   → router.push(`/analyse/${jobId}`)
 *
 * Accepts optional ?lat=&lng= query params from the map pin report CTA.
 * When present, a "📍 Location context" badge is shown above the input —
 * reinforcing that map view and analyse view are the same intelligence,
 * accessed from different entry points (D-039).
 *
 * All result rendering, polling, and step progress live in /analyse/[jobId]/ResultView.tsx.
 * This component has no layout or scroll concerns — it just navigates away.
 */

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ThemeToggle } from '@/components/report/ThemeToggle'

interface RecentItem {
  id: string
  url: string
  municipio: string
  price: number
  tvi: number
  analysedAt: string
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
}

export function AnalyseClient() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const [url, setUrl]       = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState('')
  const [recent, setRecent] = useState<RecentItem[]>([])

  // Coordinates from map pin CTA — e.g. /analyse?lat=36.72&lng=-4.42
  const latParam = searchParams.get('lat')
  const lngParam = searchParams.get('lng')
  const hasLocationContext = latParam && lngParam &&
    isFinite(parseFloat(latParam)) && isFinite(parseFloat(lngParam))

  useEffect(() => {
    try {
      const stored = localStorage.getItem('qolify_recent')
      if (stored) setRecent(JSON.parse(stored))
    } catch { /* localStorage unavailable */ }
  }, [])

  const submit = async (submitUrl: string) => {
    if (!submitUrl.trim() || loading) return
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: submitUrl.trim() }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => null)
        throw new Error(err?.message ?? err?.error ?? `Server error (HTTP ${res.status})`)
      }

      const data = await res.json()

      if (data.jobId) {
        router.push(`/analyse/${data.jobId}`)
      } else if (data.cached && data.id) {
        router.push(`/analyse/${data.id}`)
      } else {
        throw new Error('Unexpected response. Please try again.')
      }
    } catch (err) {
      setLoading(false)
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    }
    // Note: don't setLoading(false) on success — the page navigates away
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    submit(url)
  }

  return (
    <div
      style={{
        minHeight:   '100vh',
        background:  'var(--background)',
        display:     'flex',
        flexDirection: 'column',
        alignItems:  'center',
        justifyContent: 'center',
        padding:     '40px 24px',
      }}
    >
      {/* Theme toggle — top-right */}
      <div style={{ position: 'fixed', top: 14, right: 16, zIndex: 50 }}>
        <ThemeToggle />
      </div>

      <div style={{ width: '100%', maxWidth: 560 }}>

        {/* Brand */}
        <div style={{ marginBottom: 40, textAlign: 'center' }}>
          <h1 style={{ fontFamily: 'var(--font-playfair)', fontSize: 32, fontWeight: 700, color: 'var(--navy-deep)', letterSpacing: '-0.02em', marginBottom: 8 }}>
            Qolify
          </h1>
          <p style={{ fontFamily: 'var(--font-playfair)', fontStyle: 'italic', fontSize: 17, color: 'var(--text-mid)' }}>
            Invest in your life, not just a postcode.
          </p>
        </div>

        {/* Location context badge — shown when arriving from map pin CTA */}
        {hasLocationContext && (
          <div style={{
            display:      'flex',
            alignItems:   'center',
            gap:          8,
            background:   'rgba(52,201,122,0.07)',
            border:       '1px solid rgba(52,201,122,0.2)',
            borderRadius: 10,
            padding:      '10px 14px',
            marginBottom: 16,
          }}>
            <span style={{ fontSize: 14 }}>📍</span>
            <div>
              <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, fontWeight: 600, color: '#34C97A', marginBottom: 2 }}>
                Location context loaded
              </p>
              <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 11, color: '#8A9BB0' }}>
                {parseFloat(latParam!).toFixed(4)}° N · {Math.abs(parseFloat(lngParam!)).toFixed(4)}° W
              </p>
            </div>
            <a
              href="/map"
              style={{ marginLeft: 'auto', fontFamily: 'var(--font-dm-sans)', fontSize: 11, color: '#4A6080', textDecoration: 'none', whiteSpace: 'nowrap' }}
            >
              ← Back to map
            </a>
          </div>
        )}

        {/* URL form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste an Idealista listing URL…"
            required
            disabled={loading}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'var(--surface-2)', border: 'none', outline: 'none',
              borderRadius: 14, padding: '16px 20px',
              fontFamily: 'var(--font-dm-sans)', fontSize: 15, color: 'var(--text)',
              boxShadow: '0 0 0 1.5px var(--border)', transition: 'box-shadow 150ms',
              opacity: loading ? 0.6 : 1,
            }}
            onFocus={(e) => (e.target.style.boxShadow = '0 0 0 2px var(--navy-light)')}
            onBlur={(e)  => (e.target.style.boxShadow = '0 0 0 1.5px var(--border)')}
          />

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              background: loading ? 'var(--navy-mid)' : 'var(--navy-deep)',
              color: '#34C97A', border: 'none', borderRadius: 14,
              padding: '16px', fontFamily: 'var(--font-dm-sans)',
              fontSize: 15, fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'background 150ms',
            }}
          >
            {loading ? 'Starting analysis…' : 'Analyse →'}
          </button>

          {error && (
            <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, color: 'var(--risk)', background: 'rgba(201,75,26,0.06)', borderRadius: 8, padding: '10px 14px' }}>
              {error}
            </p>
          )}
        </form>

        {/* Example insight cards */}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12, marginTop: 40 }}>
          {[
            { icon: '🏗️', label: 'ITE Building Status',  teaser: 'Is a major repair levy coming?' },
            { icon: '💰', label: 'True Monthly Cost',     teaser: 'Mortgage + tax + energy, combined.' },
            { icon: '🌊', label: 'Flood Risk Zone',       teaser: 'Is the plot on a SNCZI risk map?' },
            { icon: '🏥', label: 'Health Security',       teaser: 'Nearest GP, ER, and pharmacy.' },
          ].map((c) => (
            <div
              key={c.label}
              style={{
                background: 'var(--surface-2)', borderRadius: 12, padding: '12px 16px',
                boxShadow: 'var(--shadow-sm)', display: 'flex', alignItems: 'flex-start',
                gap: 10, flex: '1 1 130px', minWidth: 130, maxWidth: 170,
              }}
            >
              <span style={{ fontSize: 20 }}>{c.icon}</span>
              <div>
                <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>{c.label}</p>
                <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11, color: 'var(--text-mid)' }}>{c.teaser}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Recent analyses */}
        {recent.length > 0 && (
          <div style={{ marginTop: 40 }}>
            <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11, fontWeight: 600, color: 'var(--text-light)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
              Recent
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {recent.map((item) => (
                <button
                  key={item.id}
                  onClick={() => submit(item.url)}
                  disabled={loading}
                  style={{
                    background: 'var(--surface-2)', border: 'none', borderRadius: 10,
                    padding: '10px 14px', cursor: loading ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                    boxShadow: 'var(--shadow-sm)', textAlign: 'left',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }}>
                      {item.municipio}
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

      </div>
    </div>
  )
}
