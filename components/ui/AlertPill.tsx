"use client";

/**
 * AlertPill — Coloured alert row with expandable "What does this mean?" section.
 *
 * Three variants: green (positive), amber (caution), red (risk).
 * Expanding inline pushes content down — not a tooltip or modal.
 */

import { useState } from "react";

export type AlertVariant = "green" | "amber" | "red";

export interface AlertPillProps {
  variant: AlertVariant;
  title: string;
  description: string;
  source?: string;
  explanation?: string; // revealed on expand
}

const VARIANT_STYLES: Record<AlertVariant, { border: string; bg: string; dot: string }> = {
  green: {
    border: "3px solid #34C97A",
    bg:     "rgba(52, 201, 122, 0.05)",
    dot:    "#34C97A",
  },
  amber: {
    border: "3px solid #D4820A",
    bg:     "rgba(212, 130, 10, 0.05)",
    dot:    "#D4820A",
  },
  red: {
    border: "3px solid #C94B1A",
    bg:     "rgba(201, 75, 26, 0.05)",
    dot:    "#C94B1A",
  },
};

export function AlertPill({ variant, title, description, source, explanation }: AlertPillProps) {
  const [expanded, setExpanded] = useState(false);
  const styles = VARIANT_STYLES[variant];

  return (
    <div
      style={{
        borderLeft: styles.border,
        background: styles.bg,
        borderRadius: "0 6px 6px 0",
        padding: "10px 14px",
      }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {/* Coloured dot */}
          <span
            className="flex-shrink-0 rounded-full"
            style={{ width: 8, height: 8, background: styles.dot, marginTop: 2 }}
            aria-hidden="true"
          />
          {/* Title */}
          <span
            style={{
              fontFamily: "var(--font-dm-sans)",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text)",
            }}
          >
            {title}
          </span>
        </div>
        {/* Source label */}
        {source && (
          <span
            style={{
              fontFamily: "var(--font-dm-mono)",
              fontSize: 11,
              color: "var(--text-light)",
              flexShrink: 0,
            }}
          >
            {source}
          </span>
        )}
      </div>

      {/* Description */}
      <p
        style={{
          fontFamily: "var(--font-dm-sans)",
          fontSize: 12,
          color: "var(--text-mid)",
          lineHeight: 1.4,
          margin: "4px 0 0 16px",
          display: "-webkit-box",
          WebkitLineClamp: expanded ? "unset" : 2,
          WebkitBoxOrient: "vertical",
          overflow: expanded ? "visible" : "hidden",
        }}
      >
        {description}
      </p>

      {/* Expanded explanation */}
      {expanded && explanation && (
        <p
          style={{
            fontFamily: "var(--font-dm-sans)",
            fontSize: 12,
            color: "var(--text-mid)",
            lineHeight: 1.5,
            margin: "8px 0 0 16px",
            paddingTop: 8,
            borderTop: "1px solid rgba(221,228,239,0.6)",
          }}
        >
          {explanation}
        </p>
      )}

      {/* Expand / collapse toggle */}
      {explanation && (
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            fontFamily: "var(--font-dm-sans)",
            fontSize: 12,
            color: "var(--text-mid)",
            background: "none",
            border: "none",
            padding: "4px 0 0 16px",
            cursor: "pointer",
            display: "block",
          }}
        >
          {expanded ? "Show less ↑" : "What does this mean? ›"}
        </button>
      )}
    </div>
  );
}
