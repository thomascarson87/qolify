'use client';

/**
 * FloodIntelligenceCard — CHI-417 / analysis-page-UX-restructure
 *
 * Collapsed-by-default Environment sub-card for flood safety.
 *
 * The internal MapLibre instance that used to live here has moved into the
 * shared <NeighbourhoodMap/> at the top of the Environment section — the card
 * now owns only the verdict line and detail body.
 *
 * Collapsed state: verdict headline + signal dot + "Show detail ↓" toggle.
 * Expanded state : full FloodSafetySection + Spanish insurance-impact block.
 */

import { useState } from 'react';
import { FloodSafetySection, type FloodResult } from '@/components/map/FloodSafetySection';
import { floodInsuranceImpact } from '@/lib/flood-insurance';
import { floodConsequence, type FloodZoneMembership } from '@/lib/consequence-statements';

export interface FloodIntelligenceCardProps {
  floodResult?: FloodResult;
}

function membershipFrom(r?: FloodResult): FloodZoneMembership {
  if (!r) return 'none';
  if (r.in_t10)  return 'in_t10';
  if (r.in_t100) return 'in_t100';
  if (r.in_t500) return 'in_t500';
  return 'none';
}

// Signal → dot colour for the collapsed verdict line.
const DOT = {
  green:   '#34C97A',
  amber:   '#D4820A',
  red:     '#C94B1A',
  neutral: '#8A9BB0',
} as const;

// Left-border colour per severity — mirrors FloodSafetySection so the
// insurance block visually matches the consequence block above it.
const IMPACT_STYLES = {
  green:   { border: '#34C97A', background: 'rgba(52, 201, 122, 0.08)', icon: '✓', iconColor: '#34C97A', iconBg: 'rgba(52, 201, 122, 0.15)' },
  amber:   { border: '#D4820A', background: 'rgba(212, 130, 10, 0.08)', icon: '€', iconColor: '#D4820A', iconBg: 'rgba(212, 130, 10, 0.15)' },
  red:     { border: '#C94B1A', background: 'rgba(201, 75, 26, 0.08)',  icon: '€', iconColor: '#F5A07A', iconBg: 'rgba(201, 75, 26, 0.18)'  },
  neutral: { border: '#2A4060', background: 'rgba(42, 64, 96, 0.08)',   icon: '€', iconColor: '#8A9BB0', iconBg: 'rgba(138, 155, 176, 0.12)' },
} as const;

export function FloodIntelligenceCard({ floodResult }: FloodIntelligenceCardProps) {
  const [expanded, setExpanded] = useState(false);

  const membership  = membershipFrom(floodResult);
  const stmt        = floodConsequence(membership);
  const impact      = floodInsuranceImpact(membership);
  const impactStyles = IMPACT_STYLES[impact.signal];

  return (
    <div>
      {/* ── Verdict row ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span
            aria-hidden="true"
            style={{
              width: 10, height: 10, borderRadius: '50%',
              background: DOT[stmt.signal], flexShrink: 0,
              boxShadow: `0 0 0 3px ${DOT[stmt.signal]}22`,
            }}
          />
          <div style={{ minWidth: 0 }}>
            <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-light)', textTransform: 'uppercase', margin: 0, marginBottom: 2 }}>
              Flood
            </p>
            <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 14, fontWeight: 600, color: 'var(--text)', margin: 0, lineHeight: 1.3 }}>
              {floodResult ? stmt.title : 'Flood zone data unavailable'}
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
          <FloodSafetySection floodResult={floodResult} />

          {floodResult && (
            <section aria-label="Insurance impact">
              <p
                style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 10, letterSpacing: '0.1em', marginBottom: 8 }}
                className="uppercase text-[#8A9BB0]"
              >
                Insurance Impact
              </p>
              <div
                style={{
                  borderLeft:   `3px solid ${impactStyles.border}`,
                  background:   impactStyles.background,
                  borderRadius: '0 8px 8px 0',
                  padding:      '14px 16px',
                  display:      'flex',
                  gap:          14,
                  alignItems:   'flex-start',
                }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: impactStyles.iconBg,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18, color: impactStyles.iconColor, flexShrink: 0, fontWeight: 700,
                  }}
                >
                  {impactStyles.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 14, fontWeight: 600, color: '#FFFFFF', lineHeight: 1.4, marginBottom: 6 }}>
                    {impact.headline}
                  </p>
                  <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, color: '#C5D5E8', lineHeight: 1.6, marginBottom: impact.action ? 8 : 0 }}>
                    {impact.body}
                  </p>
                  {impact.action && (
                    <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, color: '#C5D5E8', lineHeight: 1.6 }}>
                      {impact.action}
                    </p>
                  )}
                </div>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
