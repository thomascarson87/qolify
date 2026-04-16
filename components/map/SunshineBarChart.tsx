'use client';

/**
 * SunshineBarChart — CHI-355
 *
 * 12 vertical bars representing average daily sunshine hours per month (Jan–Dec).
 * Used in:
 *   - Pin report Solar & Climate section
 *   - Zone panel Solar accordion (CHI-360)
 *
 * Visual spec (DATA_VIS_GRAMMAR.md Format 5):
 *   - Full card width (capped at 340px), 80px bar area
 *   - Bar fill: colour interpolated between Amber (#D4820A, shortest) and
 *     Emerald (#34C97A, tallest) by relative value within the dataset
 *   - Month labels: J F M A M J J A S O N D in DM Sans 9px
 *   - Hover tooltip: full month name + exact daily hours
 *   - Staggered mount animation: bars grow from 0 → full height, 40ms offset per bar
 *   - Auto-generated plain-English summary sentence below chart
 */

import { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SunshineBarChartProps {
  /** Jan–Dec average daily sunshine hours. Exactly 12 values. */
  monthlyHours: [
    number, number, number, number, number, number,
    number, number, number, number, number, number,
  ];
  /** Total annual sunshine hours (displayed in summary sentence). */
  annualTotal: number;
  /** Location name for summary context (e.g. "Málaga"). */
  locationName?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MONTHS_SHORT = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTHS_FULL  = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const BAR_HEIGHT_PX  = 80;
const ANIM_DURATION  = 600; // ms
const ANIM_STAGGER   = 40;  // ms per bar

// Design tokens
const COLOR_AMBER   = '#D4820A';
const COLOR_EMERALD = '#34C97A';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Linearly interpolate between two hex colours by t ∈ [0, 1]. */
function lerpColor(a: string, b: string, t: number): string {
  const hex = (s: string) => [
    parseInt(s.slice(1, 3), 16),
    parseInt(s.slice(3, 5), 16),
    parseInt(s.slice(5, 7), 16),
  ];
  const [ar, ag, ab] = hex(a);
  const [br, bg, bb] = hex(b);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
}

function buildSummary(hours: number[], annualTotal: number, locationName?: string): string {
  const minVal  = Math.min(...hours);
  const maxVal  = Math.max(...hours);
  const minIdx  = hours.indexOf(minVal);
  const maxIdx  = hours.indexOf(maxVal);
  const loc     = locationName ? `${locationName} averages ` : '';
  return (
    `${annualTotal.toLocaleString('es-ES')} sunshine hours per year. ` +
    `${MONTHS_FULL[minIdx]} averages ${minVal.toFixed(1)} daily hours; ` +
    `${MONTHS_FULL[maxIdx]} peaks at ${maxVal.toFixed(1)}.`
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SunshineBarChart({
  monthlyHours,
  annualTotal,
  locationName,
}: SunshineBarChartProps) {
  const [animated, setAnimated]     = useState(false);
  const [tooltip,  setTooltip]      = useState<{ idx: number; x: number; y: number } | null>(null);
  const containerRef                = useRef<HTMLDivElement>(null);

  // Trigger animation after mount
  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimated(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const minVal  = Math.min(...monthlyHours);
  const maxVal  = Math.max(...monthlyHours);
  const range   = maxVal - minVal || 1;

  const summary = buildSummary(Array.from(monthlyHours), annualTotal, locationName);

  return (
    <div ref={containerRef} style={{ width: '100%', maxWidth: 340 }}>
      {/* Bar area */}
      <div
        style={{
          display:       'flex',
          alignItems:    'flex-end',
          gap:           3,
          height:        BAR_HEIGHT_PX,
          paddingBottom: 0,
        }}
        role="img"
        aria-label={`Monthly sunshine hours chart. ${summary}`}
      >
        {monthlyHours.map((hours, i) => {
          const normalised = (hours - minVal) / range;            // 0 = shortest, 1 = tallest
          const heightPct  = 15 + normalised * 85;                // keep a visible min height
          const color      = lerpColor(COLOR_AMBER, COLOR_EMERALD, normalised);
          const delay      = i * ANIM_STAGGER;

          return (
            <div
              key={i}
              style={{
                flex:            1,
                position:        'relative',
                height:          '100%',
                display:         'flex',
                alignItems:      'flex-end',
              }}
              onMouseEnter={e => {
                const rect = containerRef.current?.getBoundingClientRect();
                const barRect = e.currentTarget.getBoundingClientRect();
                setTooltip({
                  idx: i,
                  x: barRect.left - (rect?.left ?? 0) + barRect.width / 2,
                  y: barRect.top - (rect?.top ?? 0),
                });
              }}
              onMouseLeave={() => setTooltip(null)}
            >
              <div
                style={{
                  width:           '100%',
                  height:          animated ? `${heightPct}%` : '0%',
                  background:      color,
                  borderRadius:    '2px 2px 0 0',
                  transition:      animated
                    ? `height ${ANIM_DURATION}ms ease-out ${delay}ms`
                    : 'none',
                  opacity:         0.9,
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Month labels */}
      <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>
        {MONTHS_SHORT.map((m, i) => (
          <div
            key={i}
            style={{
              flex:       1,
              textAlign:  'center',
              fontFamily: 'var(--font-dm-sans)',
              fontSize:   9,
              color:      '#4A6080',
            }}
          >
            {m}
          </div>
        ))}
      </div>

      {/* Hover tooltip */}
      {tooltip !== null && (
        <div
          style={{
            position:       'absolute',
            left:           tooltip.x,
            top:            tooltip.y - 36,
            transform:      'translateX(-50%)',
            background:     '#0D1B2A',
            border:         '1px solid #1E3050',
            borderRadius:   6,
            padding:        '4px 10px',
            pointerEvents:  'none',
            whiteSpace:     'nowrap',
            zIndex:         50,
            boxShadow:      '0 4px 12px rgba(0,0,0,0.4)',
          }}
        >
          <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11, color: '#8A9BB0' }}>
            {MONTHS_FULL[tooltip.idx]}
          </span>
          <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 12, color: '#FFFFFF', marginLeft: 6 }}>
            {monthlyHours[tooltip.idx].toFixed(1)} hrs/day
          </span>
        </div>
      )}

      {/* Summary sentence */}
      <p
        style={{
          fontFamily: 'var(--font-dm-sans)',
          fontSize:   11,
          color:      '#8A9BB0',
          lineHeight: 1.5,
          marginTop:  10,
        }}
      >
        {summary}
      </p>
    </div>
  );
}
