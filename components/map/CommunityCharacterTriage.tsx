'use client';

/**
 * CommunityCharacterTriage — VUT (tourist-rental) licence count within 200m.
 *
 * Used in both the map pin panel (PinReportPanel) and the property DNA Report
 * (ResultView). The count itself is computed in /api/map/pin from the
 * vut_licences table via ST_DWithin — this component is pure presentation.
 *
 * The three severity bands (0–3 / 4–10 / 11+) are deliberately wide so a
 * moderate Andalucía-style residential street reads green and a heavily
 * touristified centre reads red.
 *
 * Known data caveat (CHI-326 follow-up): geocoding the vut_licences table is
 * ongoing. When coverage is incomplete in a given area the count under-reports —
 * the UI makes no attempt to hide that, but the separate coverage banner on
 * the DNA report makes the uncertainty explicit.
 */

interface CommunityCharacterTriageProps {
  vutCount: number;
  tone?: 'dark' | 'light';
}

const TONES = {
  dark: {
    label:       '#8A9BB0',
    title:       '#FFFFFF',
    body:        '#8A9BB0',
  },
  light: {
    label:       'var(--text-light)',
    title:       'var(--text)',
    body:        'var(--text-mid)',
  },
} as const;

export function CommunityCharacterTriage({ vutCount, tone = 'dark' }: CommunityCharacterTriageProps) {
  const palette = TONES[tone];

  const color    = vutCount <= 3 ? '#34C97A' : vutCount <= 10 ? '#D4820A' : '#C94B1A';
  const icon     = vutCount <= 3 ? '✓' : '⚠';
  const bodyText = vutCount <= 3
    ? 'Low tourist saturation in this immediate area.'
    : vutCount <= 10
    ? 'Moderate tourist rentals present — worth checking your specific building.'
    : 'High tourist rental density. Residential character may be reduced.';

  return (
    <section>
      <p
        style={{
          fontFamily:    'var(--font-dm-sans)',
          fontSize:      10,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color:         palette.label,
          marginBottom:  8,
        }}
      >
        Community Character
      </p>
      <div style={{
        borderLeft:   `3px solid ${color}`,
        background:   `${color}10`,
        borderRadius: '0 8px 8px 0',
        padding:      '12px 14px',
      }}>
        <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, fontWeight: 600, color: palette.title, marginBottom: 2 }}>
          <span style={{ color }}>{icon}</span>
          {' '}{vutCount} active tourist rental licence{vutCount !== 1 ? 's' : ''} within 200m.
        </p>
        <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: palette.body, margin: 0 }}>
          {bodyText}
        </p>
      </div>
    </section>
  );
}
