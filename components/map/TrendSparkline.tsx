'use client';

/**
 * TrendSparkline — CHI-359
 *
 * SVG-based trend line for price/m², crime rate, and VUT application trends.
 * Direction of change matters as much as the current value — snapshot numbers
 * alone are not surfaced without trend context (DATA_VIS_GRAMMAR.md Format 4).
 *
 * Two sizes:
 *   inline — 120×36px, used in card/list contexts (zone panel, summary rows)
 *   panel  — full card width × 180px, used in detail sections
 *
 * Context-sensitive colour (price trends only):
 *   buyer    → rising price = Risk (bad news), falling = Emerald (good)
 *   investor → rising price = Emerald (good),  falling = Risk (bad)
 *   Crime trends always use Emerald-for-falling regardless of context.
 *
 * Direction pill: always shown alongside the chart.
 * Inflection annotation: when trend reverses direction, a dashed vertical
 * line and label mark the reversal month.
 */

import { useMemo, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DataPoint {
  /** ISO date string or "YYYY-MM" label. */
  date:  string;
  value: number;
}

export type SparklineSize    = 'inline' | 'panel';
export type SparklineContext = 'buyer' | 'investor' | 'crime';

export interface TrendSparklineProps {
  data:       DataPoint[];
  unit:       string;         // e.g. "€/m²" or "per 1,000"
  size?:      SparklineSize;
  context?:   SparklineContext;
  /**
   * If provided, the sparkline is unlabelled and uses this as the accessible
   * description. Otherwise a default description is derived from data.
   */
  ariaLabel?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLORS = {
  emerald: '#34C97A',
  risk:    '#C94B1A',
  amber:   '#D4820A',
  slate:   '#4A6080',
  navy:    '#1E3050',
} as const;

const SIZE_CONFIG = {
  inline: { width: 120, height: 36,  paddingX: 4,  paddingY: 4,  showAxes: false },
  panel:  { width: '100%' as const, height: 180, paddingX: 40, paddingY: 16, showAxes: true },
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  // Accepts "YYYY-MM" or full ISO — returns "Jan 2025"
  try {
    const d = new Date(iso.length === 7 ? iso + '-01' : iso);
    return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

function formatShortMonth(iso: string): string {
  try {
    const d = new Date(iso.length === 7 ? iso + '-01' : iso);
    return d.toLocaleDateString('en-GB', { month: 'short' });
  } catch {
    return iso.slice(5, 7);
  }
}

/**
 * Compute the fill colour for the overall trend based on context.
 * A "positive" slope means rising values.
 */
function trendColor(
  risingIsPositive: boolean,
  rising: boolean,
  flat: boolean,
): string {
  if (flat) return COLORS.slate;
  const goodColor = COLORS.emerald;
  const badColor  = COLORS.risk;
  if (rising) return risingIsPositive ? goodColor : badColor;
  return risingIsPositive ? badColor : goodColor;
}

function contextToRisingIsPositive(ctx: SparklineContext): boolean {
  // Crime: falling = good → rising is NOT positive
  if (ctx === 'crime')    return false;
  if (ctx === 'investor') return true;
  // buyer: rising prices = bad
  return false;
}

/**
 * Find inflection index: first index where slope sign changes.
 * Returns -1 if no inflection.
 */
function findInflection(values: number[]): number {
  if (values.length < 3) return -1;
  const slopes = values.slice(1).map((v, i) => v - values[i]);
  const firstSign = Math.sign(slopes[0]);
  for (let i = 1; i < slopes.length; i++) {
    const s = Math.sign(slopes[i]);
    if (s !== 0 && s !== firstSign) return i; // index in original values array
  }
  return -1;
}

/** Map normalised data values to SVG pixel coordinates. */
function toPoints(
  values: number[],
  minV: number,
  maxV: number,
  svgW: number,
  svgH: number,
  padX: number,
  padY: number,
): Array<{ x: number; y: number }> {
  const plotW = svgW - padX * 2;
  const plotH = svgH - padY * 2;
  const range = maxV - minV || 1;
  return values.map((v, i) => ({
    x: padX + (i / (values.length - 1)) * plotW,
    y: padY + plotH - ((v - minV) / range) * plotH,
  }));
}

/** Build SVG polyline points string. */
function polylinePoints(pts: Array<{ x: number; y: number }>): string {
  return pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

/** Build closed area path (line + back along bottom). */
function areaPath(pts: Array<{ x: number; y: number }>, svgH: number, padY: number): string {
  if (pts.length === 0) return '';
  const bottom = svgH - padY;
  const line   = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  return `${line} L ${pts[pts.length - 1].x.toFixed(1)} ${bottom} L ${pts[0].x.toFixed(1)} ${bottom} Z`;
}

// ---------------------------------------------------------------------------
// Direction pill
// ---------------------------------------------------------------------------

function DirectionPill({
  changePct,
  color,
  period,
}: {
  changePct: number;
  color:     string;
  period:    string;
}) {
  const flat   = Math.abs(changePct) < 0.5;
  const arrow  = flat ? '→' : changePct > 0 ? '↑' : '↓';
  const label  = flat
    ? 'Stable'
    : `${arrow} ${Math.abs(changePct).toFixed(1)}% over ${period}`;

  return (
    <span
      style={{
        display:      'inline-flex',
        alignItems:   'center',
        gap:          4,
        fontFamily:   'var(--font-dm-mono)',
        fontSize:     11,
        fontWeight:   600,
        color:        flat ? COLORS.slate : color,
        background:   flat ? 'rgba(74,96,128,0.12)' : `${color}18`,
        border:       `1px solid ${flat ? 'rgba(74,96,128,0.25)' : color + '35'}`,
        borderRadius: 20,
        padding:      '2px 8px',
        whiteSpace:   'nowrap',
      }}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

interface TooltipState {
  x:     number;
  y:     number;
  date:  string;
  value: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TrendSparkline({
  data,
  unit,
  size    = 'inline',
  context = 'buyer',
  ariaLabel,
}: TrendSparklineProps) {
  const svgRef   = useRef<SVGSVGElement>(null);
  const [tip, setTip] = useState<TooltipState | null>(null);

  const cfg    = SIZE_CONFIG[size];
  const svgH   = cfg.height;
  const padX   = cfg.paddingX;
  const padY   = cfg.paddingY;
  const isPanel = size === 'panel';

  // Derive a fixed numeric width for inline; panel uses 100% flex
  const svgW = isPanel ? 340 : (cfg.width as number);

  const values = useMemo(() => data.map(d => d.value), [data]);
  const minV   = useMemo(() => Math.min(...values), [values]);
  const maxV   = useMemo(() => Math.max(...values), [values]);

  const pts = useMemo(
    () => toPoints(values, minV, maxV, svgW, svgH, padX, padY),
    [values, minV, maxV, svgW, svgH, padX, padY],
  );

  // Overall direction
  const first      = values[0] ?? 0;
  const last       = values[values.length - 1] ?? 0;
  const changePct  = first !== 0 ? ((last - first) / Math.abs(first)) * 100 : 0;
  const rising     = changePct > 0.5;
  const falling    = changePct < -0.5;
  const flat       = !rising && !falling;
  const risingGood = contextToRisingIsPositive(context);
  const lineColor  = trendColor(risingGood, rising, flat);

  // Period label from data span
  const periodLabel = data.length >= 12 ? '12m' : data.length >= 6 ? '6m' : '3m';

  // Inflection
  const inflIdx = useMemo(() => findInflection(values), [values]);

  // Hover handler
  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || pts.length === 0) return;
    const mouseX = e.clientX - rect.left;
    // Find nearest point
    let nearest = 0;
    let minDist = Infinity;
    pts.forEach((p, i) => {
      const d = Math.abs(p.x - mouseX);
      if (d < minDist) { minDist = d; nearest = i; }
    });
    setTip({
      x:     pts[nearest].x,
      y:     pts[nearest].y,
      date:  formatDate(data[nearest].date),
      value: data[nearest].value,
    });
  }

  const uniqueId = `sparkline-grad-${size}-${context}`;

  if (data.length < 2) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: isPanel ? '100%' : 'auto' }}>
      {/* Direction pill */}
      <div>
        <DirectionPill changePct={changePct} color={lineColor} period={periodLabel} />
      </div>

      {/* SVG chart */}
      <div style={{ position: 'relative', width: isPanel ? '100%' : svgW }}>
        <svg
          ref={svgRef}
          width={isPanel ? '100%' : svgW}
          height={svgH}
          viewBox={`0 0 ${svgW} ${svgH}`}
          preserveAspectRatio="none"
          aria-label={ariaLabel ?? `Trend chart: ${changePct >= 0 ? 'up' : 'down'} ${Math.abs(changePct).toFixed(1)}% over ${periodLabel}`}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setTip(null)}
          style={{ cursor: 'crosshair', overflow: 'visible' }}
        >
          <defs>
            <linearGradient id={uniqueId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={lineColor} stopOpacity={0.25} />
              <stop offset="100%" stopColor={lineColor} stopOpacity={0.02} />
            </linearGradient>
          </defs>

          {/* Baseline */}
          <line
            x1={padX} y1={svgH - padY}
            x2={svgW - padX} y2={svgH - padY}
            stroke={COLORS.navy} strokeWidth={1}
          />

          {/* Filled area */}
          <path
            d={areaPath(pts, svgH, padY)}
            fill={`url(#${uniqueId})`}
          />

          {/* Line */}
          <polyline
            points={polylinePoints(pts)}
            fill="none"
            stroke={lineColor}
            strokeWidth={isPanel ? 2 : 1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Panel-only: start + end callout annotations */}
          {isPanel && (
            <>
              {/* Start value */}
              <text
                x={pts[0].x}
                y={pts[0].y - 8}
                textAnchor="middle"
                style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 10 }}
                fill="#8A9BB0"
              >
                {values[0].toLocaleString('es-ES')} {unit}
              </text>
              {/* End value + delta */}
              <text
                x={pts[pts.length - 1].x}
                y={pts[pts.length - 1].y - 8}
                textAnchor="end"
                style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 10 }}
                fill={lineColor}
              >
                {last.toLocaleString('es-ES')} {unit}
              </text>
            </>
          )}

          {/* Inflection annotation */}
          {inflIdx > 0 && inflIdx < pts.length && (
            <>
              <line
                x1={pts[inflIdx].x} y1={padY}
                x2={pts[inflIdx].x} y2={svgH - padY}
                stroke={COLORS.amber}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              {isPanel && (
                <text
                  x={pts[inflIdx].x + 4}
                  y={padY + 10}
                  style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 9 }}
                  fill={COLORS.amber}
                >
                  trend reversed
                </text>
              )}
            </>
          )}

          {/* Panel-only: x-axis month labels (every ~3 months) */}
          {isPanel && data.map((d, i) => {
            if (i % Math.max(1, Math.floor(data.length / 6)) !== 0) return null;
            return (
              <text
                key={i}
                x={pts[i].x}
                y={svgH - 2}
                textAnchor="middle"
                style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 9 }}
                fill="#4A6080"
              >
                {formatShortMonth(d.date)}
              </text>
            );
          })}

          {/* Most recent data point dot */}
          <circle
            cx={pts[pts.length - 1].x}
            cy={pts[pts.length - 1].y}
            r={isPanel ? 4 : 3}
            fill={lineColor}
          />

          {/* Tooltip dot */}
          {tip && (
            <circle
              cx={tip.x}
              cy={tip.y}
              r={isPanel ? 5 : 3.5}
              fill="#FFFFFF"
              stroke={lineColor}
              strokeWidth={1.5}
            />
          )}
        </svg>

        {/* Tooltip bubble */}
        {tip && (
          <div
            style={{
              position:      'absolute',
              left:          tip.x,
              top:           tip.y - (isPanel ? 42 : 38),
              transform:     'translateX(-50%)',
              background:    '#0D1B2A',
              border:        '1px solid #1E3050',
              borderRadius:  6,
              padding:       '4px 10px',
              pointerEvents: 'none',
              whiteSpace:    'nowrap',
              zIndex:        50,
              boxShadow:     '0 4px 12px rgba(0,0,0,0.4)',
            }}
          >
            <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 10, color: '#8A9BB0' }}>
              {tip.date}
            </span>
            <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 12, color: '#FFFFFF', marginLeft: 6 }}>
              {tip.value.toLocaleString('es-ES')} {unit}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
