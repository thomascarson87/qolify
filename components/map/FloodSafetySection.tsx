'use client';

/**
 * FloodSafetySection — CHI-353
 *
 * The most safety-critical display in the product. Per D-035:
 *   - Always binary (in / not in each flood zone)
 *   - Always a Consequence Statement — never a score, never a bar
 *   - Always the first data section shown after the location header
 *   - Never hidden, collapsed, or conditionally suppressed
 *   - Renders in all three states — including the clean green state,
 *     which is reassuring and builds trust
 *
 * API fields consumed (from POST /api/map/pin response):
 *   flood_result.in_t10        boolean
 *   flood_result.in_t100       boolean
 *   flood_result.in_t500       boolean
 *   flood_result.source_date   string  e.g. "March 2026"
 *
 * Consequence text comes from lib/consequence-statements.ts floodConsequence().
 */

import { floodConsequence, type FloodZoneMembership } from '@/lib/consequence-statements';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FloodResult {
  in_t10:       boolean;
  in_t100:      boolean;
  in_t500:      boolean;
  source_date?: string;
}

interface FloodSafetySectionProps {
  floodResult?: FloodResult;
  /**
   * Called when the user clicks "Show flood boundary on map →".
   * Only rendered for T10/T100 states — wire this to the MapLibre layer toggle.
   */
  onShowOnMap?: () => void;
  /**
   * Optional zone-level T10 context shown only when the pin itself is safe.
   * Use this to reconcile "pin is outside flood zones" with "postcode contains T10 areas"
   * — e.g. "Other parts of postcode 29001 include T10 zones — this coordinate is clear."
   */
  zoneT10Warning?: string;
}

// ---------------------------------------------------------------------------
// Design tokens — signal → colour set
// ---------------------------------------------------------------------------

const SIGNAL_STYLES = {
  green: {
    border:     '#34C97A',
    background: 'rgba(52, 201, 122, 0.08)',
    icon:       '✓',
    iconColor:  '#34C97A',
    iconBg:     'rgba(52, 201, 122, 0.15)',
  },
  amber: {
    border:     '#D4820A',
    background: 'rgba(212, 130, 10, 0.08)',
    icon:       '⚠',
    iconColor:  '#D4820A',
    iconBg:     'rgba(212, 130, 10, 0.15)',
  },
  red: {
    border:     '#C94B1A',
    background: 'rgba(201, 75, 26, 0.08)',
    icon:       '⚠',
    iconColor:  '#F5A07A',
    iconBg:     'rgba(201, 75, 26, 0.18)',
  },
  neutral: {
    border:     '#2A4060',
    background: 'rgba(42, 64, 96, 0.08)',
    icon:       'ℹ',
    iconColor:  '#8A9BB0',
    iconBg:     'rgba(138, 155, 176, 0.12)',
  },
} as const;

// ---------------------------------------------------------------------------
// Helper — derive flood zone membership from the three booleans
// ---------------------------------------------------------------------------

function getMembership(r: FloodResult): FloodZoneMembership {
  if (r.in_t10)  return 'in_t10';
  if (r.in_t100) return 'in_t100';
  if (r.in_t500) return 'in_t500';
  return 'none';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FloodSafetySection({ floodResult, onShowOnMap, zoneT10Warning }: FloodSafetySectionProps) {

  // ── UNAVAILABLE: API failed or returned no data ───────────────────────────
  // Per INDICATOR_CARD_SPEC §4: flood risk is NEVER hidden regardless of tier.
  // When data is absent we must always show this state — never omit the section.
  if (!floodResult) {
    return (
      <section aria-label="Flood safety">
        <p
          style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 10, letterSpacing: '0.1em', marginBottom: 8 }}
          className="uppercase text-[#8A9BB0]"
        >
          Flood Safety
        </p>
        <div
          style={{
            borderLeft:   '3px solid #2A4060',
            background:   'rgba(42,64,96,0.08)',
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
              background: 'rgba(138,155,176,0.12)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, color: '#8A9BB0', flexShrink: 0,
            }}
          >
            ℹ
          </div>
          <div>
            <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 14, fontWeight: 600, color: '#FFFFFF', lineHeight: 1.4, marginBottom: 6 }}>
              Flood zone data could not be retrieved.
            </p>
            <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, color: '#C5D5E8', lineHeight: 1.6 }}>
              Check SNCZI directly before proceeding.
            </p>
          </div>
        </div>
      </section>
    )
  }

  // ── LOADED: data present, derive membership and render consequence ─────────
  const membership = getMembership(floodResult);
  const stmt       = floodConsequence(membership, floodResult.source_date);
  const styles     = SIGNAL_STYLES[stmt.signal];

  const showMapLink = membership === 'in_t10' || membership === 'in_t100';

  return (
    <section aria-label="Flood safety">
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
        Flood Safety
      </p>

      {/* Card */}
      <div
        style={{
          borderLeft:  `3px solid ${styles.border}`,
          background:  styles.background,
          borderRadius: '0 8px 8px 0',
          padding:     '14px 16px',
          display:     'flex',
          gap:         14,
          alignItems:  'flex-start',
        }}
      >
        {/* Icon */}
        <div
          aria-hidden="true"
          style={{
            width:          36,
            height:         36,
            borderRadius:   '50%',
            background:     styles.iconBg,
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            fontSize:       18,
            color:          styles.iconColor,
            flexShrink:     0,
            fontWeight:     700,
          }}
        >
          {styles.icon}
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
              fontFamily: 'var(--font-dm-sans)',
              fontSize:   13,
              fontWeight: 400,
              color:      '#C5D5E8',
              lineHeight: 1.6,
              marginBottom: stmt.action ? 8 : 0,
            }}
          >
            {stmt.body}
          </p>

          {/* Action sentence (T10 / T100 only) */}
          {stmt.action && (
            <p
              style={{
                fontFamily: 'var(--font-dm-sans)',
                fontSize:   13,
                color:      '#C5D5E8',
                lineHeight: 1.6,
                marginBottom: showMapLink ? 10 : 0,
              }}
            >
              {stmt.action}
            </p>
          )}

          {/* Show on map link */}
          {showMapLink && onShowOnMap && (
            <button
              onClick={onShowOnMap}
              style={{
                fontFamily:  'var(--font-dm-sans)',
                fontSize:    12,
                fontWeight:  500,
                color:       styles.border,
                background:  'transparent',
                border:      'none',
                padding:     0,
                cursor:      'pointer',
                textDecoration: 'underline',
                textUnderlineOffset: 3,
              }}
            >
              Show flood boundary on map →
            </button>
          )}

          {/* Source / freshness */}
          {stmt.source && (
            <p
              style={{
                fontFamily:  'var(--font-dm-sans)',
                fontSize:    10,
                color:       '#4A6080',
                marginTop:   showMapLink && onShowOnMap ? 8 : (stmt.action ? 8 : 6),
                lineHeight:  1.4,
              }}
            >
              {stmt.source}
            </p>
          )}

          {/* Zone-level T10 context — only shown when pin itself is safe */}
          {zoneT10Warning && membership === 'none' && (
            <p
              style={{
                fontFamily:  'var(--font-dm-sans)',
                fontSize:    11,
                color:       '#D4820A',
                marginTop:   8,
                lineHeight:  1.5,
                paddingTop:  8,
                borderTop:   '1px solid rgba(212,130,10,0.2)',
              }}
            >
              ⚠ {zoneT10Warning}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
