'use client';

/**
 * ProximitySummary — CHI-354
 *
 * Second major data section of the pin report (after flood safety).
 * Displays counts and walking distances for all facility types within a
 * configurable walking radius.
 *
 * Per D-036: always counts + distances in minutes — never a score.
 *
 * Key rules:
 *   - Walking time = Math.round(distance_m / 80) minutes (80m/min standard)
 *   - If < 1 minute: "< 1 min"
 *   - Zero-count rows are always shown — "None within X min · nearest Xm"
 *     makes absence visible rather than hiding it
 *   - School row: shows catchment school name + "in catchment ✓" badge when
 *     in_catchment = true (authoritative ST_Within result from the API)
 *   - School row hidden by default in non-Family profiles; shown via expand link
 */

import { useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FacilityCounts {
  gp_count:               number;
  gp_nearest_m:           number;
  pharmacy_count:         number;
  pharmacy_nearest_m:     number;
  school_primary_count:   number;
  school_nearest_m:       number;
  school_in_catchment:    boolean;
  school_catchment_name?: string;
  metro_count:            number;
  metro_nearest_m:        number;
  bus_stops_count:        number;
  bus_nearest_m:          number;
  supermarket_count:      number;
  supermarket_nearest_m:  number;
  park_count:             number;
  park_nearest_m:         number;
  cafe_count:             number;
  cafe_nearest_m:         number;
}

export type UserProfile = 'family' | 'nomad' | 'retiree' | 'investor';

export interface ProximitySummaryProps {
  facilities:       FacilityCounts;
  radiusM:          400 | 800;
  onExpandRadius:   () => void;
  onCollapseRadius?: () => void;
  /** Controls whether school row is shown by default. Defaults to true (visible). */
  profile?:       UserProfile;
  /**
   * When true, shows only the 4 highest-priority rows (School, GP, Supermarket,
   * Park) with a "Show all amenities →" toggle to expand the rest.
   * Spec: Triage card pin panel — D-036.
   */
  compact?:       boolean;
}

// ---------------------------------------------------------------------------
// Walking time helper
// ---------------------------------------------------------------------------

/**
 * Converts a distance in metres to a walking time string.
 * Uses 80m/min (standard pedestrian planning rate).
 */
function walkTime(distanceM: number): string {
  if (distanceM <= 0) return '< 1 min';
  const mins = Math.round(distanceM / 80);
  if (mins < 1) return '< 1 min';
  return `≈${mins} min walk`;
}

function fmtDist(m: number): string {
  if (m <= 0) return '—';
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface BaseRow {
  emoji:   string;
  label:   string;
}

interface CountRow extends BaseRow {
  count:     number;
  nearestM:  number;
  /**
   * Optional extra node shown after the distance (e.g. catchment badge).
   * Rendered after the distance string.
   */
  extra?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/**
 * A single facility row — emoji, label, count, nearest distance + walk time.
 * Always rendered regardless of count (zero state uses "None within X min").
 */
function FacilityRow({
  row,
  radiusM,
}: {
  row:     CountRow;
  radiusM: 400 | 800;
}) {
  const radiusMins = radiusM === 400 ? 5 : 10;
  const hasAny = row.count > 0;

  return (
    <div
      style={{
        display:       'flex',
        alignItems:    'baseline',
        gap:           10,
        paddingTop:    8,
        paddingBottom: 8,
        borderBottom:  '1px solid rgba(30, 48, 80, 0.6)',
      }}
    >
      {/* Emoji + label */}
      <span
        aria-hidden="true"
        style={{ fontSize: 14, flexShrink: 0, lineHeight: 1 }}
      >
        {row.emoji}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-dm-sans)',
          fontSize:   13,
          color:      '#8A9BB0',
          minWidth:   120,
          flexShrink: 0,
        }}
      >
        {row.label}
      </span>

      {/* Count + distance */}
      <span
        style={{
          fontFamily: 'var(--font-dm-sans)',
          fontSize:   13,
          color:      '#C5D5E8',
          flex:       1,
        }}
      >
        {hasAny ? (
          <>
            <span
              style={{
                fontFamily: 'var(--font-dm-mono)',
                fontWeight: 600,
                color:      '#FFFFFF',
              }}
            >
              {row.count}
            </span>
            {' · nearest '}
            <span style={{ fontFamily: 'var(--font-dm-mono)' }}>
              {fmtDist(row.nearestM)}
            </span>
            {' '}
            <span style={{ color: '#4A6080', fontSize: 11 }}>
              ({walkTime(row.nearestM)})
            </span>
            {row.extra && <> · {row.extra}</>}
          </>
        ) : (
          <span style={{ color: '#4A6080', fontStyle: 'italic' }}>
            None within {radiusMins} min
            {row.nearestM > 0 && (
              <> · nearest{' '}
                <span style={{ fontFamily: 'var(--font-dm-mono)' }}>
                  {fmtDist(row.nearestM)}
                </span>
              </>
            )}
          </span>
        )}
      </span>
    </div>
  );
}

/** Green "in catchment ✓" badge */
function CatchmentBadge() {
  return (
    <span
      style={{
        fontFamily:  'var(--font-dm-sans)',
        fontSize:    10,
        fontWeight:  600,
        color:       '#34C97A',
        background:  'rgba(52, 201, 122, 0.12)',
        border:      '1px solid rgba(52, 201, 122, 0.3)',
        borderRadius: 4,
        padding:     '1px 6px',
        whiteSpace:  'nowrap',
        verticalAlign: 'middle',
      }}
    >
      in catchment ✓
    </span>
  );
}

/** Slate "outside catchment" note */
function OutsideCatchmentNote() {
  return (
    <span
      style={{
        fontFamily: 'var(--font-dm-sans)',
        fontSize:   11,
        color:      '#4A6080',
        fontStyle:  'italic',
      }}
    >
      outside catchment
    </span>
  );
}

// ---------------------------------------------------------------------------
// Profiles where the school row is hidden by default
// ---------------------------------------------------------------------------

const SCHOOL_HIDDEN_PROFILES: UserProfile[] = ['nomad', 'investor'];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProximitySummary({
  facilities: f,
  radiusM,
  onExpandRadius,
  onCollapseRadius,
  profile = 'family',
  compact = false,
}: ProximitySummaryProps) {
  const [schoolVisible, setSchoolVisible] = useState(
    !SCHOOL_HIDDEN_PROFILES.includes(profile)
  );
  // In compact mode, the secondary rows (pharmacy, metro, bus, café) are hidden
  // until the user expands with "Show all amenities →"
  const [allVisible, setAllVisible] = useState(!compact);

  const radiusMins = radiusM === 400 ? 5 : 10;

  // ---- Build school extra node ----
  let schoolExtra: React.ReactNode = null;
  if (f.school_primary_count > 0) {
    if (f.school_catchment_name) {
      schoolExtra = (
        <>
          {f.school_catchment_name}
          {f.school_in_catchment
            ? <> <CatchmentBadge /></>
            : <> <OutsideCatchmentNote /></>
          }
        </>
      );
    } else if (f.school_in_catchment) {
      schoolExtra = <CatchmentBadge />;
    }
  }

  // ---- Row definitions (fixed order per spec) ----
  // Primary rows — always shown in compact mode (School, GP, Supermarket, Park)
  const primaryRows: CountRow[] = [
    {
      emoji:    '🏥',
      label:    'GP surgery',
      count:    f.gp_count,
      nearestM: f.gp_nearest_m,
    },
    {
      emoji:    '🛒',
      label:    'Supermarket',
      count:    f.supermarket_count,
      nearestM: f.supermarket_nearest_m,
    },
    {
      emoji:    '🌳',
      label:    'Park',
      count:    f.park_count,
      nearestM: f.park_nearest_m,
    },
  ];

  // Secondary rows — hidden in compact mode until expanded
  const secondaryRows: CountRow[] = [
    {
      emoji:    '💊',
      label:    'Pharmacy',
      count:    f.pharmacy_count,
      nearestM: f.pharmacy_nearest_m,
    },
    {
      emoji:    '🚇',
      label:    'Metro stop',
      count:    f.metro_count,
      nearestM: f.metro_nearest_m,
    },
    {
      emoji:    '🚌',
      label:    'Bus stop',
      count:    f.bus_stops_count,
      nearestM: f.bus_nearest_m,
    },
    {
      emoji:    '☕',
      label:    'Café / bar',
      count:    f.cafe_count,
      nearestM: f.cafe_nearest_m,
    },
  ];

  // In non-compact mode, show all rows together as before
  const rows = allVisible ? [...primaryRows, ...secondaryRows] : primaryRows;

  const schoolRow: CountRow = {
    emoji:    '🏫',
    label:    'School (primary)',
    count:    f.school_primary_count,
    nearestM: f.school_nearest_m,
    extra:    schoolExtra ?? undefined,
  };

  return (
    <section aria-label="Walking proximity summary">
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
        Within a {radiusMins}-minute walk ({radiusM}m)
      </p>

      {/* Divider */}
      <div style={{ borderBottom: '1px solid #1E3050', marginBottom: 2 }} />

      {/* Row list */}
      <div>
        {/* School row — conditionally visible based on profile */}
        {schoolVisible ? (
          <FacilityRow row={schoolRow} radiusM={radiusM} />
        ) : (
          <div
            style={{
              paddingTop:    8,
              paddingBottom: 8,
              borderBottom:  '1px solid rgba(30, 48, 80, 0.6)',
            }}
          >
            <button
              onClick={() => setSchoolVisible(true)}
              style={{
                fontFamily:     'var(--font-dm-sans)',
                fontSize:       12,
                color:          '#4A6080',
                background:     'transparent',
                border:         'none',
                padding:        0,
                cursor:         'pointer',
                textDecoration: 'underline',
                textUnderlineOffset: 3,
              }}
            >
              🏫 Show schools →
            </button>
          </div>
        )}

        {rows.map(row => (
          <FacilityRow key={row.label} row={row} radiusM={radiusM} />
        ))}

        {/* Show all / collapse toggle (compact mode only) */}
        {compact && (
          <div style={{ paddingTop: 8, paddingBottom: 4 }}>
            <button
              onClick={() => setAllVisible(v => !v)}
              style={{
                fontFamily:     'var(--font-dm-sans)',
                fontSize:       12,
                fontWeight:     500,
                color:          '#8A9BB0',
                background:     'transparent',
                border:         'none',
                padding:        0,
                cursor:         'pointer',
                textDecoration: 'underline',
                textUnderlineOffset: 3,
              }}
            >
              {allVisible ? '− Hide secondary amenities' : '+ Show all amenities →'}
            </button>
          </div>
        )}
      </div>

      {/* Divider */}
      <div style={{ borderBottom: '1px solid #1E3050', marginBottom: 10 }} />

      {/* Radius toggle CTA */}
      {radiusM === 400 ? (
        <button
          onClick={onExpandRadius}
          style={{
            fontFamily:  'var(--font-dm-sans)',
            fontSize:    12,
            fontWeight:  500,
            color:       '#8A9BB0',
            background:  'rgba(255,255,255,0.04)',
            border:      '1px solid #1E3050',
            borderRadius: 6,
            padding:     '6px 14px',
            cursor:      'pointer',
            width:       '100%',
            textAlign:   'center',
            transition:  'color 150ms, background 150ms',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.color = '#FFFFFF';
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.color = '#8A9BB0';
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)';
          }}
        >
          Expand to 10 minutes (800m) →
        </button>
      ) : (
        <button
          onClick={onCollapseRadius}
          style={{
            fontFamily:  'var(--font-dm-sans)',
            fontSize:    12,
            fontWeight:  500,
            color:       '#34C97A',
            background:  'rgba(52,201,122,0.06)',
            border:      '1px solid rgba(52,201,122,0.25)',
            borderRadius: 6,
            padding:     '6px 14px',
            cursor:      'pointer',
            width:       '100%',
            textAlign:   'center',
            transition:  'color 150ms, background 150ms',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(52,201,122,0.12)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(52,201,122,0.06)';
          }}
        >
          ← Back to 5 minutes (400m)
        </button>
      )}
    </section>
  );
}
