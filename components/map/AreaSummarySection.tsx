'use client';

/**
 * AreaSummarySection — Claude-generated "Area Overview" paragraph.
 *
 * Shown in both the map pin panel (PinReportPanel) and the property DNA Report
 * (ResultView). Kept presentation-only: the parent is responsible for running
 * generateAreaSummary() and passing the resulting string (or null while loading).
 *
 * Visual note: the section is rendered on two very different surfaces —
 * the dark pin panel (navy background) and the light DNA Report. The parent
 * passes `tone="dark" | "light"` to pick the colour set.
 */

// Strip common markdown so AI-generated text renders as clean prose.
// Claude occasionally emits "# Heading" or "**bold**" — these would otherwise
// render as literal characters in a non-markdown <p>.
function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')        // # Heading → Heading
    .replace(/\*\*(.+?)\*\*/g, '$1')    // **bold**   → bold
    .replace(/\*(.+?)\*/g, '$1')         // *italic*   → italic
    .replace(/_(.+?)_/g, '$1')           // _italic_   → italic
    .replace(/`(.+?)`/g, '$1')           // `code`     → code
    .replace(/^[\-\*]\s+/gm, '')         // - bullet   → stripped
    .replace(/\n{3,}/g, '\n\n')          // collapse blank lines
    .trim();
}

interface AreaSummarySectionProps {
  loading: boolean;
  summary: string | null;
  /**
   * Colour palette. 'dark' = pin panel (navy bg), 'light' = DNA Report (white bg).
   * Defaults to 'dark' for the existing pin-panel call sites.
   */
  tone?: 'dark' | 'light';
}

const TONES = {
  dark: {
    label:  '#8A9BB0',
    body:   '#C5D5E8',
    skeleton: '#1E3050',
  },
  light: {
    label:  'var(--text-light)',
    body:   'var(--text)',
    skeleton: 'var(--surface-2)',
  },
} as const;

export function AreaSummarySection({ loading, summary, tone = 'dark' }: AreaSummarySectionProps) {
  if (!loading && !summary) return null;

  const palette = TONES[tone];

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
        Area Overview
      </p>
      {loading ? (
        /* Skeleton while Claude generates the summary */
        <div className="flex flex-col gap-2 animate-pulse">
          <div style={{ height: 13, width: '100%', background: palette.skeleton, borderRadius: 4 }} />
          <div style={{ height: 13, width: '92%',  background: palette.skeleton, borderRadius: 4 }} />
          <div style={{ height: 13, width: '78%',  background: palette.skeleton, borderRadius: 4 }} />
        </div>
      ) : (
        <p style={{
          fontFamily: 'var(--font-dm-sans)',
          fontSize:   14,
          color:      palette.body,
          lineHeight: 1.6,
          margin:     0,
          whiteSpace: 'pre-line',
        }}>
          {stripMarkdown(summary!)}
        </p>
      )}
    </section>
  );
}
