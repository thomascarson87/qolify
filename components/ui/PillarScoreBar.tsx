"use client";

/**
 * PillarScoreBar — Horizontal bar showing a pillar's score.
 *
 * Fill colour: Emerald (70+) / Amber Light (40–69) / Risk Light (0–39).
 * Animates from 0 to the target width when it enters the viewport (IntersectionObserver).
 * Stagger delay prop lets the parent sequence multiple bars.
 */

import { useEffect, useRef, useState } from "react";

interface PillarScoreBarProps {
  label: string;
  score: number;
  delayMs?: number; // stagger delay before animation starts
}

function barColour(score: number): string {
  if (score >= 70) return "#34C97A"; // Emerald Bright
  if (score >= 40) return "#FBBF24"; // Amber Light
  return "#F5A07A";                  // Risk Light
}

export function PillarScoreBar({ label, score, delayMs = 0 }: PillarScoreBarProps) {
  const [animated, setAnimated] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // Honour stagger delay
          const timer = setTimeout(() => setAnimated(true), delayMs);
          observer.disconnect();
          return () => clearTimeout(timer);
        }
      },
      { threshold: 0.2 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [delayMs]);

  const colour = barColour(score);
  const targetWidth = `${score}%`;

  return (
    <div ref={ref} className="flex items-center gap-3">
      {/* Label — fixed width */}
      <span
        style={{
          fontFamily: "var(--font-dm-sans)",
          fontSize: 12,
          color: "var(--text-mid)",
          width: 130,
          flexShrink: 0,
        }}
      >
        {label}
      </span>

      {/* Track */}
      <div
        style={{
          flex: 1,
          height: 6,
          background: "var(--border)",
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        {/* Fill */}
        <div
          style={{
            height: "100%",
            width: animated ? targetWidth : "0%",
            background: colour,
            borderRadius: 3,
            transition: `width 500ms cubic-bezier(0.34, 1.56, 0.64, 1)`,
          }}
        />
      </div>

      {/* Score number — fixed width, right-aligned */}
      <span
        style={{
          fontFamily: "var(--font-dm-mono)",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--text)",
          width: 28,
          textAlign: "right",
          flexShrink: 0,
        }}
      >
        {score}
      </span>
    </div>
  );
}
