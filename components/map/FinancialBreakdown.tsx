'use client';

/**
 * FinancialBreakdown — CHI-356
 *
 * Pin report Financial Estimate section. Shows the true monthly cost of
 * ownership in euro amounts — never a score. Per D-034.
 *
 * The component is intentionally display-only. All euro figures are
 * pre-computed by the API route (POST /api/map/pin), which queries
 * eco_constants for the current mortgage rate. This component just
 * presents what it receives.
 *
 * Returns null if neither price_asking nor area_sqm was provided in
 * the pin request (no meaningful estimate is possible).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CatastroComparison {
  /** Catastro Valor de Referencia in euros. */
  valorReferencia: number;
  /** Asking price in euros. */
  askingPrice:     number;
}

export interface FinancialBreakdownProps {
  /** Monthly mortgage estimate in euros. */
  mortgageMonthly:  number;
  /** Annualised IBI divided by 12. */
  ibiMonthly:       number;
  /** Climate-adjusted energy cost per month. */
  energyMonthly:    number;
  /** Estimated community fee per month. */
  communityMonthly: number;
  /**
   * Monthly ICO benefit (positive = reduction). Only shown when the property
   * qualifies for the ICO young-buyer programme.
   */
  icoMonthly?:      number;
  /** Mortgage rate used (e.g. 4.6) — shown in row label. From eco_constants. */
  mortgageRatePct:  number;
  /** Loan term in years (e.g. 25). */
  mortgageTerm:     number;
  /**
   * Local area median monthly cost for a comparable property.
   * Used for the comparison row. Omit if not available.
   */
  localMedianMonthly?: number;
  /**
   * Catastro value and asking price for the reference comparison.
   * Rendered only when both values are present.
   */
  catastro?: CatastroComparison;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function eur(n: number): string {
  return `€${Math.round(n).toLocaleString('es-ES')}`;
}

function pct(a: number, b: number): string {
  const delta = Math.round(((b - a) / a) * 100);
  return delta >= 0 ? `+${delta}%` : `${delta}%`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function BreakdownRow({
  label,
  value,
  negative = false,
}: {
  label:    string;
  value:    number;
  negative?: boolean;
}) {
  return (
    <div
      style={{
        display:        'flex',
        justifyContent: 'space-between',
        alignItems:     'baseline',
        paddingLeft:    12,
        paddingTop:     3,
        paddingBottom:  3,
      }}
    >
      <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#8A9BB0' }}>
        {label}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-dm-mono)',
          fontSize:   13,
          color:      negative ? '#34C97A' : '#C5D5E8',
        }}
      >
        {negative ? '−' : ''}{eur(value)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FinancialBreakdown({
  mortgageMonthly,
  ibiMonthly,
  energyMonthly,
  communityMonthly,
  icoMonthly,
  mortgageRatePct,
  mortgageTerm,
  localMedianMonthly,
  catastro,
}: FinancialBreakdownProps) {

  const total =
    mortgageMonthly +
    ibiMonthly +
    energyMonthly +
    communityMonthly -
    (icoMonthly ?? 0);

  const vsMedian = localMedianMonthly != null ? total - localMedianMonthly : null;
  const medianSignalColor =
    vsMedian == null ? '#8A9BB0'
    : vsMedian > 0   ? '#C94B1A'
    : '#34C97A';

  // Catastro gap
  let catastroGapPct: number | null = null;
  let catastroGapEur: number | null = null;
  if (catastro) {
    catastroGapEur = catastro.askingPrice - catastro.valorReferencia;
    catastroGapPct = Math.round((catastroGapEur / catastro.valorReferencia) * 100);
  }

  return (
    <section aria-label="Financial estimate">
      {/* Section label */}
      <p
        style={{
          fontFamily:    'var(--font-dm-sans)',
          fontSize:      10,
          letterSpacing: '0.1em',
          marginBottom:  10,
        }}
        className="uppercase text-[#8A9BB0]"
      >
        Financial Estimate
      </p>

      {/* Total headline */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
        <span
          style={{
            fontFamily: 'var(--font-dm-mono)',
            fontSize:   28,
            fontWeight: 500,
            color:      '#FFFFFF',
            lineHeight: 1,
          }}
        >
          {eur(total)}
        </span>
        <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, color: '#8A9BB0' }}>
          /month
        </span>
      </div>

      {/* Breakdown rows */}
      <div style={{ marginTop: 10, marginBottom: 4 }}>
        <BreakdownRow
          label={`Mortgage (${mortgageTerm}yr, ${mortgageRatePct}%)`}
          value={mortgageMonthly}
        />
        <BreakdownRow label="IBI estimate (annual ÷12)"     value={ibiMonthly} />
        <BreakdownRow label="Energy (climate-adjusted)"      value={energyMonthly} />
        <BreakdownRow label="Community fee (estimated)"      value={communityMonthly} />
        {icoMonthly != null && icoMonthly > 0 && (
          <BreakdownRow label="ICO benefit (young buyer)"    value={icoMonthly} negative />
        )}
      </div>

      {/* Divider */}
      <div style={{ borderTop: '1px solid #1E3050', marginBottom: 8 }} />

      {/* Local median comparison */}
      {localMedianMonthly != null && (
        <div
          style={{
            display:        'flex',
            justifyContent: 'space-between',
            alignItems:     'baseline',
            marginBottom:   8,
          }}
        >
          <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#8A9BB0' }}>
            Area median (comparable)
          </span>
          <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 12, color: '#8A9BB0' }}>
            {eur(localMedianMonthly)}/mo
            {' '}
            <span style={{ color: medianSignalColor, fontWeight: 600 }}>
              {vsMedian! > 0
                ? `▲ ${eur(Math.abs(vsMedian!))} above`
                : `▼ ${eur(Math.abs(vsMedian!))} below`}
            </span>
          </span>
        </div>
      )}

      {/* Catastro reference comparison */}
      {catastro && catastroGapEur !== null && catastroGapPct !== null && (
        <div
          style={{
            background:   'rgba(255,255,255,0.03)',
            border:       '1px solid #1E3050',
            borderRadius: 8,
            padding:      '10px 12px',
            marginBottom: 10,
          }}
        >
          <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 10, letterSpacing: '0.08em', color: '#4A6080', marginBottom: 6 }}
             className="uppercase">
            Catastro Reference
          </p>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#8A9BB0' }}>
              Valor de Referencia
            </span>
            <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 13, color: '#C5D5E8' }}>
              {eur(catastro.valorReferencia)}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#8A9BB0' }}>
              Asking price
            </span>
            <span style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 13, color: '#C5D5E8' }}>
              {eur(catastro.askingPrice)}
            </span>
          </div>
          <div style={{ borderTop: '1px solid #1E3050', paddingTop: 6 }}>
            <span
              style={{
                fontFamily: 'var(--font-dm-sans)',
                fontSize:   12,
                fontWeight: 600,
                color:      catastroGapEur < 0 ? '#34C97A' : '#D4820A',
              }}
            >
              {catastroGapEur < 0
                ? `${Math.abs(catastroGapPct)}% below Catastro value ✓`
                : `${catastroGapPct}% above Catastro value`}
            </span>
            {catastroGapEur < 0 && (
              <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 11, color: '#8A9BB0', marginTop: 3, lineHeight: 1.4 }}>
                ITP transfer tax is assessed on whichever is higher — this gap is potential negotiating room.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Disclaimer footnote — always visible */}
      <p
        style={{
          fontFamily: 'var(--font-dm-sans)',
          fontSize:   10,
          color:      '#4A6080',
          lineHeight: 1.5,
          marginTop:  4,
        }}
      >
        Estimates only — mortgage, IBI, energy, and community costs are approximations.
        Verify all figures with your mortgage broker and solicitor before committing.
      </p>
    </section>
  );
}
