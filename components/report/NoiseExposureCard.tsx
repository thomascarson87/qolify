'use client';

/**
 * NoiseExposureCard — analysis-page-UX-restructure
 *
 * Collapsed-by-default Environment sub-card for mapped Lden noise exposure.
 *
 * The internal thermal-contour map that used to live here has moved into the
 * shared <NeighbourhoodMap/> at the top of the Environment section. This card
 * now owns only the verdict line and the detail body (dB ladder + consequence).
 *
 * Collapsed state: verdict headline + signal dot + "Show detail ↓" toggle.
 * Expanded state : dB ladder visualisation + consequence + action.
 */

import { useState } from 'react';
import {
  noiseConsequence,
  DB_REFERENCE_POINTS,
  type NoiseExposure,
} from '@/lib/noise-exposure';

export interface NoiseExposureCardProps {
  exposure: NoiseExposure;
}

const SOURCE_ACCENT: Record<string, string> = {
  road:     '#D4820A',
  rail:     '#6B4CC9',
  airport:  '#1E7FC9',
  industry: '#8A7A4C',
};

const DOT = {
  green:   '#34C97A',
  amber:   '#D4820A',
  red:     '#C94B1A',
  neutral: '#8A9BB0',
} as const;

const CONSEQUENCE_STYLES = {
  green:   { border: '#34C97A', background: 'rgba(52, 201, 122, 0.08)', label: 'Quiet',     labelColor: '#34C97A' },
  amber:   { border: '#D4820A', background: 'rgba(212, 130, 10, 0.08)', label: 'Noticeable', labelColor: '#D4820A' },
  red:     { border: '#C94B1A', background: 'rgba(201, 75, 26, 0.08)',  label: 'Loud',       labelColor: '#F5A07A' },
  neutral: { border: '#2A4060', background: 'rgba(42, 64, 96, 0.08)',   label: 'Moderate',   labelColor: '#8A9BB0' },
} as const;

function ladderPosition(lden: number, min = 30, max = 80): number {
  return Math.max(0, Math.min(1, (lden - min) / (max - min)));
}

export function NoiseExposureCard({ exposure }: NoiseExposureCardProps) {
  const [expanded, setExpanded] = useState(false);

  const consequence = noiseConsequence(exposure);
  const cStyles     = CONSEQUENCE_STYLES[consequence.signal];

  // Verdict line — short, single-glance summary.
  const verdict = exposure.lden == null
    ? 'Below mapped noise thresholds'
    : `${consequence.title}`;

  const readingDb = exposure.lden == null ? null
                  : exposure.lden >= 75    ? 77
                  : exposure.lden + 2;
  const markerPos = readingDb != null ? ladderPosition(readingDb) : null;

  return (
    <div>
      {/* ── Verdict row ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span
            aria-hidden="true"
            style={{
              width: 10, height: 10, borderRadius: '50%',
              background: DOT[consequence.signal], flexShrink: 0,
              boxShadow: `0 0 0 3px ${DOT[consequence.signal]}22`,
            }}
          />
          <div style={{ minWidth: 0 }}>
            <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-light)', textTransform: 'uppercase', margin: 0, marginBottom: 2 }}>
              Noise
              {exposure.source_type && (
                <span style={{
                  marginLeft:    8,
                  color:         SOURCE_ACCENT[exposure.source_type] ?? '#8A9BB0',
                  letterSpacing: '0.08em',
                }}>
                  · {exposure.source_type}
                </span>
              )}
            </p>
            <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 14, fontWeight: 600, color: 'var(--text)', margin: 0, lineHeight: 1.3 }}>
              {verdict}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          style={{
            fontFamily: 'var(--font-dm-sans)', fontSize: 12, fontWeight: 500,
            color: 'var(--text-mid)', background: 'transparent',
            border: '1px solid var(--border)', borderRadius: 8,
            padding: '5px 10px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          {expanded ? 'Hide detail ↑' : 'Show detail ↓'}
        </button>
      </div>

      {/* ── Expanded detail ─────────────────────────────────────────────── */}
      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
          {/* dB ladder — the defining noise-card visual */}
          <div style={{
            padding:      '14px 16px',
            borderRadius: 8,
            background:   'rgba(42, 64, 96, 0.04)',
            border:       '1px solid rgba(42, 64, 96, 0.15)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11, color: '#8A9BB0', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Everyday sound reference
              </span>
              {readingDb != null && (
                <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 12, color: '#FFFFFF', fontWeight: 600 }}>
                  {exposure.band} dB Lden
                </span>
              )}
            </div>

            <div style={{ position: 'relative', height: 10, borderRadius: 5,
              background: 'linear-gradient(90deg, #2A4060 0%, #2A4060 8%, #F2D03C 50%, #E06B2A 72%, #8A1A0A 100%)',
            }}>
              {markerPos != null && (
                <>
                  <div style={{
                    position: 'absolute',
                    left:     `calc(${(markerPos * 100).toFixed(1)}% - 1px)`,
                    top:      -4,
                    width:    2,
                    height:   18,
                    background: '#FFFFFF',
                    boxShadow: '0 0 0 1px rgba(13, 27, 42, 0.9)',
                  }} />
                  <div style={{
                    position: 'absolute',
                    left:     `calc(${(markerPos * 100).toFixed(1)}% - 14px)`,
                    top:      -20,
                    width:    28,
                    textAlign: 'center',
                    fontFamily: 'var(--font-dm-mono)',
                    fontSize:   9,
                    color:      '#FFFFFF',
                  }}>
                    HERE
                  </div>
                </>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
              {DB_REFERENCE_POINTS.filter((_, i) => i % 2 === 0).map(p => (
                <span key={p.lden} style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 9, color: '#8A9BB0' }}>
                  {p.lden}
                </span>
              ))}
            </div>

            <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11, color: '#C5D5E8', marginTop: 10, lineHeight: 1.5 }}>
              <span style={{ color: '#8A9BB0' }}>Equivalent to: </span>
              <span style={{ color: '#FFFFFF' }}>{consequence.reference}</span>
            </p>
          </div>

          {/* Consequence block */}
          <div
            style={{
              borderLeft:   `3px solid ${cStyles.border}`,
              background:   cStyles.background,
              borderRadius: '0 8px 8px 0',
              padding:      '14px 16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
              <span style={{
                fontFamily:    'var(--font-dm-sans)',
                fontSize:      10,
                fontWeight:    700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color:         cStyles.labelColor,
              }}>
                {cStyles.label}
              </span>
              <span style={{ color: '#4A6080', fontSize: 11 }}>—</span>
              <span style={{
                fontFamily: 'var(--font-dm-sans)',
                fontSize:   14,
                fontWeight: 600,
                color:      '#FFFFFF',
                lineHeight: 1.3,
              }}>
                {consequence.title}
              </span>
            </div>
            <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, color: '#C5D5E8', lineHeight: 1.6, margin: 0 }}>
              {consequence.body}
            </p>
            {consequence.action && (
              <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, color: '#C5D5E8', lineHeight: 1.6, marginTop: 8, marginBottom: 0 }}>
                {consequence.action}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
