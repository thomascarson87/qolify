'use client';

/**
 * SectionNav — sticky horizontal anchor nav for the DNA Report.
 *
 * Slides in under the property header once the user has scrolled past it and
 * highlights whichever section the viewport is currently on. Uses
 * IntersectionObserver against each target <section id="…"/> so the active
 * state stays in sync with actual scroll position without manual listeners.
 *
 * Desktop: all anchors fit in a row.
 * Mobile : horizontal scroll; sticky nav keeps its anchors in one row.
 */

import { useEffect, useState } from 'react';

export interface SectionNavProps {
  /**
   * Ordered list of anchor targets. Each target's id must match a
   * <section id="…"/> rendered elsewhere on the page.
   */
  sections: Array<{ id: string; label: string }>;

  /**
   * Scrollable ancestor that contains the sections + the nav. The report uses
   * a scrollable inner div rather than document-level scroll, so we pass the
   * same ref IntersectionObserver needs.
   */
  scrollRoot?: HTMLElement | null;
}

export function SectionNav({ sections, scrollRoot }: SectionNavProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  // ── Observe each section to track which one is "current" ─────────────────
  useEffect(() => {
    if (sections.length === 0) return;

    // Top offset equals the sticky property header + this nav (~ 140px).
    // A section is considered active once its top crosses that line.
    const observer = new IntersectionObserver(
      entries => {
        // Pick the entry closest to the top of the viewport that's visible.
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      {
        root: scrollRoot ?? null,
        // Trigger slightly before the section top reaches the nav.
        rootMargin: '-140px 0px -60% 0px',
        threshold: 0,
      }
    );

    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [sections, scrollRoot]);

  // Smooth-scroll anchor click — accounts for sticky header offset via
  // the section's own scroll-margin-top CSS (set on each <section/>).
  function handleClick(e: React.MouseEvent<HTMLAnchorElement>, id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <nav
      aria-label="Report sections"
      style={{
        position:   'sticky',
        // Sits directly below the sticky property header. The header height
        // varies with compressed state (≈ 70–120px); 72px is its minimum so
        // the nav stays pinned without a gap in the compressed state and
        // lets the header overlap slightly in the uncompressed state
        // (acceptable — the header is opaque so no content is hidden).
        top:         72,
        zIndex:      30,
        background:  'var(--background)',
        borderBottom: '1px solid var(--border)',
        // Use padding rather than margin so the sticky background extends
        // full-width even though the inner content is max-width constrained.
        padding:     '0 24px',
      }}
    >
      <div
        style={{
          display:       'flex',
          gap:           4,
          overflowX:     'auto',
          scrollbarWidth: 'none',
          // Max-width mirrors the report's main column so anchors line up.
          maxWidth:      900,
          margin:        '0 auto',
        }}
      >
        {sections.map(s => {
          const active = s.id === activeId;
          return (
            <a
              key={s.id}
              href={`#${s.id}`}
              onClick={e => handleClick(e, s.id)}
              style={{
                fontFamily:    'var(--font-dm-sans)',
                fontSize:      13,
                fontWeight:    active ? 600 : 500,
                letterSpacing: '0.02em',
                color:         active ? 'var(--navy-deep)' : 'var(--text-light)',
                padding:       '12px 14px',
                textDecoration: 'none',
                whiteSpace:    'nowrap',
                borderBottom:  `2px solid ${active ? 'var(--navy-deep)' : 'transparent'}`,
                marginBottom:  -1,
                transition:    'color 150ms, border-bottom-color 150ms',
                flexShrink:    0,
              }}
            >
              {s.label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
