'use client';

/**
 * StatusBadgeGrid — CHI-357
 *
 * 2-column grid of compact status cards for binary/categorical facts.
 * Used in the pin report for: ITE inspection status, fibre connection,
 * EPC energy rating, building orientation, and ICO eligibility.
 *
 * Per DATA_VIS_GRAMMAR.md Format 6:
 *   - Never convert these to a score or progress bar
 *   - Never leave a field blank — always render "Not available" in slate
 *   - EPC gets special EU energy label colour strip treatment
 *   - Building orientation gets a 100px SVG compass with filled arc
 *
 * Consequence text sourced from lib/consequence-statements.ts (CHI-352).
 */

import {
  iteConsequence,
  fibreConsequence,
  orientationConsequence,
  epcConsequence,
  type IteStatus,
  type FibreCoverageType,
  type BuildingAspect,
  type EpcRating,
} from '@/lib/consequence-statements';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IteStatusInput {
  type:   'ite';
  status: IteStatus;
  year?:  number;
}

export interface FibreStatusInput {
  type:       'fibre';
  coverage:   FibreCoverageType;
  sourceYear?: string;
}

export interface EpcStatusInput {
  type:            'epc';
  rating:          EpcRating;
  heatingCostEur?: number;
  coolingCostEur?: number;
}

export interface OrientationStatusInput {
  type:   'orientation';
  aspect: BuildingAspect;
}

export interface IcoStatusInput {
  type:      'ico';
  eligible:  boolean;
  maxAgency?: string; // e.g. "Junta de Andalucía"
}

export type StatusItem =
  | IteStatusInput
  | FibreStatusInput
  | EpcStatusInput
  | OrientationStatusInput
  | IcoStatusInput;

export interface StatusBadgeGridProps {
  items: StatusItem[];
}

// ---------------------------------------------------------------------------
// Signal → visual tokens
// ---------------------------------------------------------------------------

const SIGNAL_TOKENS = {
  green:   { border: '#34C97A', bg: 'rgba(52,201,122,0.07)',  text: '#34C97A' },
  amber:   { border: '#D4820A', bg: 'rgba(212,130,10,0.07)',  text: '#D4820A' },
  red:     { border: '#C94B1A', bg: 'rgba(201,75,26,0.09)',   text: '#F5A07A' },
  neutral: { border: '#2A4060', bg: 'rgba(42,64,96,0.07)',    text: '#8A9BB0' },
} as const;

// ---------------------------------------------------------------------------
// EU EPC colour strip
// A=dark-green → G=red (official EU label palette)
// ---------------------------------------------------------------------------

const EPC_COLORS: Record<EpcRating, string> = {
  A: '#00A651',
  B: '#52B153',
  C: '#B5CE47',
  D: '#FFF200',
  E: '#F7A600',
  F: '#F15A24',
  G: '#ED1B24',
};

const EPC_RATINGS: EpcRating[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

function EpcStrip({ rating }: { rating: EpcRating }) {
  return (
    <div style={{ display: 'flex', gap: 2, marginTop: 6, alignItems: 'center' }}>
      {EPC_RATINGS.map(r => (
        <div
          key={r}
          style={{
            width:      r === rating ? 20 : 14,
            height:     r === rating ? 20 : 14,
            borderRadius: 2,
            background: EPC_COLORS[r],
            opacity:    r === rating ? 1 : 0.35,
            display:    'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            transition: 'width 150ms, height 150ms',
          }}
        >
          {r === rating && (
            <span
              style={{
                fontFamily: 'var(--font-dm-mono)',
                fontSize:   10,
                fontWeight: 700,
                color:      ['D', 'C', 'B', 'A'].includes(r) ? '#0D1B2A' : '#FFFFFF',
              }}
            >
              {r}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SVG Compass for building orientation
// ---------------------------------------------------------------------------

const ASPECT_DEGREES: Record<BuildingAspect, number> = {
  N:  0,
  NE: 45,
  E:  90,
  SE: 135,
  S:  180,
  SW: 225,
  W:  270,
  NW: 315,
};

const ASPECT_SIGNAL: Record<BuildingAspect, 'green' | 'amber' | 'red'> = {
  S:  'green', SE: 'green', SW: 'green',
  E:  'amber', W:  'amber',
  N:  'red',   NE: 'red',   NW: 'red',
};

function CompassSvg({ aspect }: { aspect: BuildingAspect }) {
  const cx      = 36;
  const cy      = 36;
  const r       = 28;
  const degrees = ASPECT_DEGREES[aspect];
  const signal  = ASPECT_SIGNAL[aspect];
  const color   = signal === 'green' ? '#34C97A' : signal === 'amber' ? '#D4820A' : '#C94B1A';

  // Arc: ±45° from facing direction, drawn as SVG arc path
  // Convert to radians, offset by -90° so 0° = top (North)
  const toRad = (deg: number) => ((deg - 90) * Math.PI) / 180;
  const startDeg = degrees - 45;
  const endDeg   = degrees + 45;
  const startRad = toRad(startDeg);
  const endRad   = toRad(endDeg);
  const x1 = cx + r * Math.cos(startRad);
  const y1 = cy + r * Math.sin(startRad);
  const x2 = cx + r * Math.cos(endRad);
  const y2 = cy + r * Math.sin(endRad);

  // Cardinal labels
  const LABELS = [
    { label: 'N', deg: 0   },
    { label: 'E', deg: 90  },
    { label: 'S', deg: 180 },
    { label: 'W', deg: 270 },
  ];

  return (
    <svg width={72} height={72} viewBox="0 0 72 72" aria-label={`Building facing ${aspect}`}>
      {/* Outer ring */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1E3050" strokeWidth={1.5} />

      {/* Filled arc (pie slice) */}
      <path
        d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2} Z`}
        fill={color}
        opacity={0.7}
      />

      {/* Cardinal labels */}
      {LABELS.map(({ label, deg }) => {
        const rad   = toRad(deg);
        const lr    = r + 10;
        const lx    = cx + lr * Math.cos(rad);
        const ly    = cy + lr * Math.sin(rad);
        return (
          <text
            key={label}
            x={lx}
            y={ly}
            textAnchor="middle"
            dominantBaseline="middle"
            style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 8 }}
            fill="#4A6080"
          >
            {label}
          </text>
        );
      })}

      {/* Centre dot */}
      <circle cx={cx} cy={cy} r={2.5} fill={color} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Individual card renderers
// ---------------------------------------------------------------------------

function StatusCard({
  icon,
  label,
  value,
  signal,
  extra,
}: {
  icon:    string;
  label:   string;
  value:   string;
  signal:  keyof typeof SIGNAL_TOKENS;
  extra?:  React.ReactNode;
}) {
  const tok = SIGNAL_TOKENS[signal];
  return (
    <div
      style={{
        borderLeft:   `3px solid ${tok.border}`,
        background:   tok.bg,
        borderRadius: '0 6px 6px 0',
        padding:      '8px 10px',
        minHeight:    48,
        display:      'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap:          2,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span aria-hidden="true" style={{ fontSize: 14 }}>{icon}</span>
        <span
          style={{
            fontFamily: 'var(--font-dm-sans)',
            fontSize:   11,
            fontWeight: 600,
            color:      '#8A9BB0',
            lineHeight: 1.2,
          }}
        >
          {label}
        </span>
      </div>
      <p
        style={{
          fontFamily: 'var(--font-dm-sans)',
          fontSize:   12,
          color:      '#FFFFFF',
          lineHeight: 1.3,
          marginLeft: 20,
        }}
      >
        {value}
      </p>
      {extra}
    </div>
  );
}

function UnavailableCard({ label, icon }: { label: string; icon: string }) {
  return (
    <StatusCard
      icon={icon}
      label={label}
      value="Not available"
      signal="neutral"
    />
  );
}

// ---------------------------------------------------------------------------
// Per-type renderers
// ---------------------------------------------------------------------------

function renderItem(item: StatusItem, key: number): React.ReactNode {
  switch (item.type) {
    case 'ite': {
      const stmt = iteConsequence(item.status, item.year);
      const valueMap: Record<IteStatus, string> = {
        passed:       item.year ? `Passed — ${item.year}` : 'Passed',
        failed:       item.year ? `Failed — ${item.year}` : 'Failed',
        pending:      'Inspection pending',
        not_required: 'Not required',
        unavailable:  'Not available',
      };
      return (
        <StatusCard
          key={key}
          icon="🏗"
          label="ITE Inspection"
          value={valueMap[item.status]}
          signal={stmt.signal === 'neutral' ? 'neutral' : stmt.signal}
        />
      );
    }

    case 'fibre': {
      const stmt = fibreConsequence(item.coverage, item.sourceYear);
      const valueMap: Record<FibreCoverageType, string> = {
        FTTP: 'Full-fibre (FTTP)',
        FTTC: 'Fibre to cabinet (FTTC)',
        HFC:  'Cable (HFC)',
        none: 'No fibre coverage',
      };
      return (
        <StatusCard
          key={key}
          icon="📶"
          label="Fibre Connection"
          value={valueMap[item.coverage]}
          signal={stmt.signal === 'neutral' ? 'neutral' : stmt.signal}
        />
      );
    }

    case 'epc': {
      const stmt   = epcConsequence(item.rating, item.heatingCostEur, item.coolingCostEur);
      const signal = stmt.signal === 'neutral' ? 'neutral' : stmt.signal;
      return (
        <div
          key={key}
          style={{
            borderLeft:   `3px solid ${SIGNAL_TOKENS[signal].border}`,
            background:   SIGNAL_TOKENS[signal].bg,
            borderRadius: '0 6px 6px 0',
            padding:      '8px 10px',
            gridColumn:   'span 2',  // EPC strip is wider — takes full row
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <span aria-hidden="true" style={{ fontSize: 14 }}>⚡</span>
            <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11, fontWeight: 600, color: '#8A9BB0' }}>
              Energy Certificate
            </span>
          </div>
          <EpcStrip rating={item.rating} />
          {stmt.body && (
            <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11, color: '#8A9BB0', marginTop: 6, lineHeight: 1.4 }}>
              {stmt.body}
            </p>
          )}
        </div>
      );
    }

    case 'orientation': {
      const stmt   = orientationConsequence(item.aspect);
      const signal = stmt.signal === 'neutral' ? 'neutral' : stmt.signal;
      return (
        <div
          key={key}
          style={{
            borderLeft:   `3px solid ${SIGNAL_TOKENS[signal].border}`,
            background:   SIGNAL_TOKENS[signal].bg,
            borderRadius: '0 6px 6px 0',
            padding:      '8px 10px',
            display:      'flex',
            gap:          10,
            alignItems:   'center',
            gridColumn:   'span 2',
          }}
        >
          <CompassSvg aspect={item.aspect} />
          <div>
            <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11, fontWeight: 600, color: '#8A9BB0', marginBottom: 3 }}>
              Building Orientation
            </p>
            <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, color: '#FFFFFF', marginBottom: 4 }}>
              {item.aspect}-facing
            </p>
            <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11, color: '#8A9BB0', lineHeight: 1.4 }}>
              {stmt.body}
            </p>
          </div>
        </div>
      );
    }

    case 'ico': {
      if (item.eligible) {
        return (
          <StatusCard
            key={key}
            icon="🏦"
            label="ICO Young Buyer"
            value={`Eligible${item.maxAgency ? ` — ${item.maxAgency}` : ''}`}
            signal="green"
          />
        );
      }
      return (
        <StatusCard
          key={key}
          icon="🏦"
          label="ICO Young Buyer"
          value="Not eligible"
          signal="neutral"
        />
      );
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StatusBadgeGrid({ items }: StatusBadgeGridProps) {
  if (items.length === 0) return null;

  return (
    <section aria-label="Property status">
      <p
        style={{
          fontFamily:    'var(--font-dm-sans)',
          fontSize:      10,
          letterSpacing: '0.1em',
          marginBottom:  8,
        }}
        className="uppercase text-[#8A9BB0]"
      >
        Status
      </p>

      <div
        style={{
          display:             'grid',
          gridTemplateColumns: '1fr 1fr',
          gap:                 6,
        }}
      >
        {items.map((item, i) => renderItem(item, i))}
      </div>
    </section>
  );
}
