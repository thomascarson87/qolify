"use client";

/**
 * TVIRing — Circular gauge showing the Total Value Index score.
 *
 * Three sizes: XS (32px), SM (52px), LG (80px).
 * Arc covers 270° clockwise from bottom-left (225° from top).
 * Animates from 0 → score over 600ms with a spring easing on mount.
 * Colour: Emerald (75–100) / Amber (50–74) / Risk (0–49).
 */

import { useEffect, useRef, useState } from "react";

export type TVISize = "xs" | "sm" | "lg";

interface TVIRingProps {
  score: number | null;   // null = loading state
  size?: TVISize;
  pending?: boolean;      // partial score still calculating
  className?: string;
}

// Dimensions per size variant
const SIZE_MAP: Record<TVISize, { outer: number; stroke: number; fontSize: number; labelSize: number }> = {
  xs: { outer: 32, stroke: 3,  fontSize: 10, labelSize: 6  },
  sm: { outer: 52, stroke: 4,  fontSize: 15, labelSize: 8  },
  lg: { outer: 80, stroke: 6,  fontSize: 22, labelSize: 10 },
};

// Arc is 270° (¾ of a circle). Starts at 225° from top (bottom-left).
const ARC_DEGREES = 270;

function scoreColour(score: number, pending: boolean): string {
  if (pending) return "#D4820A"; // Amber while calculating
  if (score >= 75) return "#34C97A"; // Emerald Bright
  if (score >= 50) return "#D4820A"; // Amber
  return "#C94B1A";                  // Risk
}

export function TVIRing({ score, size = "lg", pending = false, className = "" }: TVIRingProps) {
  const { outer, stroke, fontSize, labelSize } = SIZE_MAP[size];
  const radius = (outer - stroke) / 2;
  const cx = outer / 2;
  const cy = outer / 2;
  const circumference = 2 * Math.PI * radius;
  const arcLength = (ARC_DEGREES / 360) * circumference;
  // Gap = remaining 90° of the circle, sits at bottom-right
  const gapLength = circumference - arcLength;

  // The SVG arc starts at the "bottom-left" = 225° from the top.
  // We rotate the entire circle so the arc start aligns correctly.
  // standard SVG 0° is 3 o'clock, so 225° from top = 225 - 90 = 135° SVG rotation.
  const rotationDeg = 135;

  // The filled portion based on score (0 when loading, animated on mount)
  const [animatedOffset, setAnimatedOffset] = useState<number>(arcLength); // starts at full offset = empty arc
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (score !== null && !hasAnimated.current) {
      hasAnimated.current = true;
      const filled = (score / 100) * arcLength;
      const targetOffset = arcLength - filled;
      // Small rAF delay so the CSS transition fires after mount
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setAnimatedOffset(targetOffset);
        });
      });
    }
  }, [score, arcLength]);

  const colour = score !== null ? scoreColour(score, pending) : "#DDE4EF";
  const displayScore = score !== null ? score : null;

  return (
    <div className={`relative inline-flex items-center justify-center ${className}`} style={{ width: outer, height: outer }}>
      <svg width={outer} height={outer} viewBox={`0 0 ${outer} ${outer}`} fill="none" aria-label={`TVI score: ${score ?? "loading"}`}>
        {/* Track — grey arc */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          stroke="#DDE4EF"
          strokeWidth={stroke}
          strokeDasharray={`${arcLength} ${gapLength}`}
          strokeDashoffset={0}
          strokeLinecap="round"
          fill="none"
          transform={`rotate(${rotationDeg}, ${cx}, ${cy})`}
        />
        {/* Score arc — animated */}
        {score !== null && (
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            stroke={colour}
            strokeWidth={stroke}
            strokeDasharray={`${arcLength} ${gapLength}`}
            strokeDashoffset={animatedOffset}
            strokeLinecap="round"
            fill="none"
            transform={`rotate(${rotationDeg}, ${cx}, ${cy})`}
            style={{ transition: "stroke-dashoffset 600ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}
          />
        )}
        {/* Loading shimmer arc */}
        {score === null && (
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            stroke="#DDE4EF"
            strokeWidth={stroke}
            strokeDasharray={`${arcLength * 0.3} ${arcLength * 0.7 + gapLength}`}
            strokeLinecap="round"
            fill="none"
            transform={`rotate(${rotationDeg}, ${cx}, ${cy})`}
            style={{ opacity: 0.6 }}
          />
        )}
      </svg>

      {/* Centre label */}
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none select-none">
        {score !== null ? (
          <>
            <span style={{ fontFamily: "var(--font-dm-mono)", fontSize, fontWeight: 500, color: colour, lineHeight: 1 }}>
              {pending ? "…" : displayScore}
            </span>
            {size !== "xs" && (
              <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: labelSize, fontWeight: 400, color: "#8A9BB0", letterSpacing: "0.06em", marginTop: 2 }}>
                {pending ? "calc" : "TVI"}
              </span>
            )}
          </>
        ) : (
          <span style={{ width: fontSize * 1.6, height: fontSize * 0.8, borderRadius: 4 }} className="skeleton-shimmer block" />
        )}
      </div>
    </div>
  );
}
