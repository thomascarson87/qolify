'use client';

/**
 * CommunityCharacterSection — CHI-358
 *
 * Pin report Community Character section. Shows VUT (tourist rental licence)
 * count within 200m of the pin, a density benchmark against local average,
 * a consequence statement, and an optional map link to show individual VUT
 * addresses at street level.
 *
 * Three density states (by count within 200m):
 *   0–3    → green  "Predominantly residential"
 *   4–10   → amber  "Some tourist rental activity nearby"
 *   11+    → red    "High tourist rental density"
 *
 * All consequence text from lib/consequence-statements.ts vutConsequence().
 *
 * Map interaction: "Show individual VUT addresses →" activates the
 * `vut-individual` MapLibre layer. Only visible at zoom ≥15. The component
 * accepts an `onShowOnMap` callback — the parent is responsible for
 * animating to zoom 15 if needed before activating the layer.
 */

import { vutConsequence } from '@/lib/consequence-statements';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommunityCharacterSectionProps {
  /** Total active VUT licences within 200m radius of the pin. */
  vutCount200m: number;
  /**
   * Contextual benchmark string from the API, e.g.:
   * "above the Málaga average of 8.4%" or "below the Málaga average of 8.4%"
   * Displayed as secondary line beneath count. Omit if not available.
   */
  vutDensityContext?: string;
  /**
   * Called when user clicks "Show individual VUT addresses →".
   * Parent handles zoom-to-15 and layer activation.
   * Only rendered for medium (4–10) and high (11+) states.
   */
  onShowOnMap?: () => void;
}

// ---------------------------------------------------------------------------
// Signal → design tokens
// ---------------------------------------------------------------------------

const SIGNAL_TOKENS = {
  green:   { border: '#34C97A', bg: 'rgba(52,201,122,0.08)',  icon: '✓', iconColor: '#34C97A', iconBg: 'rgba(52,201,122,0.15)'  },
  amber:   { border: '#D4820A', bg: 'rgba(212,130,10,0.08)',  icon: '⚠', iconColor: '#D4820A', iconBg: 'rgba(212,130,10,0.15)'  },
  red:     { border: '#C94B1A', bg: 'rgba(201,75,26,0.09)',   icon: '⚠', iconColor: '#F5A07A', iconBg: 'rgba(201,75,26,0.18)'   },
  neutral: { border: '#2A4060', bg: 'rgba(42,64,96,0.07)',    icon: 'ℹ', iconColor: '#8A9BB0', iconBg: 'rgba(138,155,176,0.12)' },
} as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CommunityCharacterSection({
  vutCount200m,
  vutDensityContext,
  onShowOnMap,
}: CommunityCharacterSectionProps) {
  const stmt = vutConsequence(vutCount200m);
  const tok  = SIGNAL_TOKENS[stmt.signal as keyof typeof SIGNAL_TOKENS];

  // Map link visible for medium and high density states
  const showMapLink = vutCount200m >= 4;

  return (
    <section aria-label="Community character">
      {/* Section label */}
      <p
        style={{
          fontFamily:    'var(--font-dm-sans)',
          fontSize:      10,
          letterSpacing: '0.1em',
          marginBottom:  8,
        }}
        className="uppercase text-[#8A9BB0]"
      >
        Community Character
      </p>

      {/* Card */}
      <div
        style={{
          borderLeft:    `3px solid ${tok.border}`,
          background:    tok.bg,
          borderRadius:  '0 8px 8px 0',
          padding:       '14px 16px',
          display:       'flex',
          gap:           14,
          alignItems:    'flex-start',
        }}
      >
        {/* Icon */}
        <div
          aria-hidden="true"
          style={{
            width:          36,
            height:         36,
            borderRadius:   '50%',
            background:     tok.iconBg,
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            fontSize:       18,
            color:          tok.iconColor,
            flexShrink:     0,
            fontWeight:     700,
          }}
        >
          {tok.icon}
        </div>

        {/* Text block */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Title */}
          <p
            style={{
              fontFamily: 'var(--font-dm-sans)',
              fontSize:   14,
              fontWeight: 600,
              color:      '#FFFFFF',
              lineHeight: 1.4,
              marginBottom: 6,
            }}
          >
            {stmt.title}
          </p>

          {/* Body */}
          <p
            style={{
              fontFamily:   'var(--font-dm-sans)',
              fontSize:     13,
              color:        '#C5D5E8',
              lineHeight:   1.6,
              marginBottom: vutDensityContext || stmt.action || showMapLink ? 6 : 0,
            }}
          >
            {stmt.body}
          </p>

          {/* Benchmark context line */}
          {vutDensityContext && (
            <p
              style={{
                fontFamily:   'var(--font-dm-sans)',
                fontSize:     12,
                color:        '#8A9BB0',
                lineHeight:   1.4,
                marginBottom: stmt.action || showMapLink ? 8 : 0,
              }}
            >
              {vutDensityContext}
            </p>
          )}

          {/* Action sentence */}
          {stmt.action && (
            <p
              style={{
                fontFamily:   'var(--font-dm-sans)',
                fontSize:     13,
                color:        '#C5D5E8',
                lineHeight:   1.6,
                marginBottom: showMapLink ? 10 : 0,
              }}
            >
              {stmt.action}
            </p>
          )}

          {/* Map link */}
          {showMapLink && onShowOnMap && (
            <button
              onClick={onShowOnMap}
              style={{
                fontFamily:         'var(--font-dm-sans)',
                fontSize:           12,
                fontWeight:         500,
                color:              tok.border,
                background:         'transparent',
                border:             'none',
                padding:            0,
                cursor:             'pointer',
                textDecoration:     'underline',
                textUnderlineOffset: 3,
              }}
            >
              Show individual VUT addresses on map →
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
