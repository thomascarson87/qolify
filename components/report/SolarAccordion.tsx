'use client';

/**
 * SolarAccordion — collapsed-by-default wrapper around <SolarPotentialCard/>.
 *
 * Solar Potential is detailed but niche, so we reveal only the headline
 * verdict + annual benefit by default. Expanding shows the bar chart,
 * system specs, and disclaimers rendered by SolarPotentialCard.
 *
 * The underlying card component is untouched — this wrapper just hides or
 * shows it. Headline values (verdict label, €/yr) are read directly from
 * the SolarPotentialResult so the collapsed summary stays in sync with
 * whatever the card would display once expanded.
 */

import { useState } from 'react';
import { SolarPotentialCard } from '@/components/report/SolarPotentialCard';
import type { SolarPotentialResult } from '@/lib/indicators/solar-potential';

export interface SolarAccordionProps {
  result: SolarPotentialResult;
  locked: boolean;
  city:   string;
}

// Verdict short-label per payback band — mirrors copy shown inside the card's
// hero row so the collapsed summary reads consistently with the expanded view.
function verdictLabel(result: SolarPotentialResult): string {
  const payback = result.payback_years;
  if (payback == null) return 'Solar estimate';
  if (payback <= 6)  return 'Good solar ROI';
  if (payback <= 9)  return 'Reasonable solar ROI';
  if (payback <= 12) return 'Marginal solar ROI';
  return 'Poor solar ROI';
}

function formatEuros(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}

export function SolarAccordion({ result, locked, city }: SolarAccordionProps) {
  const [expanded, setExpanded] = useState(false);

  const verdict  = verdictLabel(result);
  const payback  = result.payback_years;
  const annualEuro = result.annual_total_benefit_eur;

  return (
    <div style={{ background: 'var(--surface-2)', borderRadius: 18, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
      {/* ── Collapsed header — always visible, acts as the toggle ─────── */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        style={{
          width: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 16,
          padding: '18px 24px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-light)', textTransform: 'uppercase', margin: 0 }}>
            Solar Potential
          </p>
          <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: 0, lineHeight: 1.3 }}>
            {verdict}
            {payback != null && (
              <span style={{ fontFamily: 'var(--font-dm-mono)', color: 'var(--text-mid)', fontWeight: 400 }}>
                {' · '}~{payback.toFixed(1)} yr payback
              </span>
            )}
          </p>
          {annualEuro != null && (
            <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, color: 'var(--text-mid)', margin: 0 }}>
              Estimated annual benefit:{' '}
              <span style={{ fontFamily: 'var(--font-dm-mono)', color: 'var(--text)' }}>
                {formatEuros(annualEuro)}
              </span>
              /year
            </p>
          )}
        </div>
        <span
          aria-hidden="true"
          style={{
            fontFamily: 'var(--font-dm-sans)',
            fontSize:   18,
            color:      'var(--text-mid)',
            flexShrink: 0,
            transform:  expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 180ms',
          }}
        >
          ⌄
        </span>
      </button>

      {/* ── Expanded body — full SolarPotentialCard ─────────────────────── */}
      {expanded && (
        <div style={{ padding: '4px 24px 24px' }}>
          <SolarPotentialCard result={result} locked={locked} city={city} />
        </div>
      )}
    </div>
  );
}
