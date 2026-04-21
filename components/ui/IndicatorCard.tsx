"use client";

/**
 * IndicatorCard — Shows one composite indicator from the analysis response.
 *
 * Renders in exactly four states, determined by the props passed:
 *
 *   LOADING     — loading={true}          Analysis job still running. Shows shimmer skeleton.
 *   LOCKED      — locked={true}           User's tier does not include this indicator.
 *                                         Shows blur overlay + padlock + upgrade prompt.
 *   UNAVAILABLE — data is absent          Indicator is live but returned no data for this
 *                 (and not loading/locked) property. Shows grey UNAVAILABLE badge + message.
 *   LOADED      — data is present         Full card: verdict badge + score bar + summary
 *                 (and not loading/locked) + expandable data rows.
 *
 * Label, icon, summary sentence, and data rows are all driven by INDICATOR_MAP
 * from lib/indicators/registry.ts — add a new indicator there, it appears here
 * automatically with no changes to this file.
 *
 * NOTE: live: false indicators (not yet built) should be rendered as <SkeletonCard>
 * by the caller, not as <IndicatorCard>. This component only handles live indicators.
 */

import { useState } from "react";
import { INDICATOR_MAP } from "@/lib/indicators/registry";

// ─── Types ────────────────────────────────────────────────────────────────────

// Re-exported for callers that need to type indicator data
export type IndicatorKey = string;

export interface IndicatorData {
  score:      number | null;
  confidence: "high" | "medium" | "low" | "insufficient_data";
  details:    Record<string, unknown>;
  alerts:     Array<{ type: string; category: string; title: string; description: string }>;
}

interface IndicatorCardProps {
  indicatorKey: string;
  /** Present when indicator computed successfully. Absent → UNAVAILABLE state. */
  data?:        IndicatorData;
  /** True while the analysis job is still running → LOADING state. */
  loading?:     boolean;
  /** True when the user's tier does not cover this indicator → LOCKED state. */
  locked?:      boolean;
  /** When set, renders a "Full report →" link in the LOADED card footer. */
  detailUrl?:   string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Maps a 0-100 score to its verdict word per INDICATOR_CARD_SPEC §1.3 */
function verdictLabel(score: number): string {
  if (score >= 70) return "GOOD";
  if (score >= 40) return "CAUTION";
  return "RISK";
}

/** Accent colour for the verdict badge */
function scoreColour(score: number): string {
  if (score >= 70) return "#34C97A";
  if (score >= 40) return "#D4820A";
  return "#C94B1A";
}

/** Background tint for the verdict badge */
function scoreBg(score: number): string {
  if (score >= 70) return "rgba(52,201,122,0.12)";
  if (score >= 40) return "rgba(212,130,10,0.12)";
  return "rgba(201,75,26,0.12)";
}

function confidenceColour(c: string): string {
  if (c === "high")   return "#34C97A";
  if (c === "medium") return "#D4820A";
  return "#8A9BB0";
}

function confidenceLabel(c: string): string {
  if (c === "high")              return "High confidence";
  if (c === "medium")            return "Based on limited data";
  if (c === "insufficient_data") return "Insufficient data";
  return "Estimated";
}

// ─── Shared card shell ────────────────────────────────────────────────────────
// All four states use the same outer container so the grid stays uniform.

function CardShell({
  children,
  style,
}: {
  children: React.ReactNode;
  style?:   React.CSSProperties;
}) {
  return (
    <div
      style={{
        background:    "var(--surface-2)",
        borderRadius:  12,
        padding:       "16px",
        boxShadow:     "var(--shadow-sm)",
        display:       "flex",
        flexDirection: "column",
        gap:           10,
        position:      "relative",   // needed for LOCKED overlay
        minHeight:     140,          // keeps grid cells uniform across states
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ─── Shimmer helper ───────────────────────────────────────────────────────────
// A single reusable shimmer block. className="skeleton-shimmer" drives the
// animation defined in globals.css.

function Shimmer({ width, height, radius = 4 }: { width: string | number; height: number; radius?: number }) {
  return (
    <span
      className="skeleton-shimmer"
      style={{ display: "block", width, height, borderRadius: radius }}
    />
  );
}

// ─── LOADING state ────────────────────────────────────────────────────────────

function LoadingCard({ label, icon }: { label: string; icon: string }) {
  return (
    <CardShell>
      {/* Header row — label visible, badge shimmer */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }} aria-hidden="true">{icon}</span>
          <span
            style={{
              fontFamily:   "var(--font-dm-sans)",
              fontSize:     14,
              fontWeight:   600,
              color:        "var(--text-light)",
              overflow:     "hidden",
              textOverflow: "ellipsis",
              whiteSpace:   "nowrap",
            }}
          >
            {label}
          </span>
        </div>
        <Shimmer width={52} height={22} radius={6} />
      </div>

      {/* Score bar shimmer */}
      <div style={{ height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
        <Shimmer width="60%" height={6} radius={3} />
      </div>

      {/* Summary line shimmers */}
      <Shimmer width="85%" height={12} />
      <Shimmer width="65%" height={12} />

      {/* Footer shimmer */}
      <div className="flex items-center justify-between" style={{ marginTop: "auto" }}>
        <Shimmer width={90} height={10} />
        <Shimmer width={40} height={10} />
      </div>
    </CardShell>
  );
}

// ─── UNAVAILABLE state ────────────────────────────────────────────────────────

function UnavailableCard({ label, icon }: { label: string; icon: string }) {
  return (
    <CardShell style={{ background: "var(--surface-1)" }}>
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0, opacity: 0.4 }} aria-hidden="true">{icon}</span>
          <span
            style={{
              fontFamily:   "var(--font-dm-sans)",
              fontSize:     14,
              fontWeight:   600,
              color:        "var(--text-light)",
              overflow:     "hidden",
              textOverflow: "ellipsis",
              whiteSpace:   "nowrap",
            }}
          >
            {label}
          </span>
        </div>
        {/* UNAVAILABLE badge */}
        <span
          style={{
            fontFamily:   "var(--font-dm-sans)",
            fontSize:     11,
            fontWeight:   600,
            color:        "#4A5D74",
            background:   "rgba(74,93,116,0.10)",
            borderRadius: 6,
            padding:      "2px 8px",
            flexShrink:   0,
            letterSpacing: "0.04em",
          }}
        >
          UNAVAILABLE
        </span>
      </div>

      {/* Empty bar — muted */}
      <div style={{ height: 6, background: "var(--border)", borderRadius: 3 }} />

      {/* Explanation message */}
      <p
        style={{
          fontFamily: "var(--font-dm-sans)",
          fontSize:   12,
          color:      "var(--text-light)",
          lineHeight: 1.5,
          margin:     0,
        }}
      >
        Data unavailable for this property.
      </p>

      {/* Footer — static */}
      <div style={{ marginTop: "auto" }}>
        <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-light)" }}>
          No data source
        </span>
      </div>
    </CardShell>
  );
}

// ─── LOCKED state ─────────────────────────────────────────────────────────────

function LockedCard({ label, icon }: { label: string; icon: string }) {
  return (
    <CardShell>
      {/* Label is always visible above the blur */}
      <div className="flex items-center gap-2 min-w-0">
        <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }} aria-hidden="true">{icon}</span>
        <span
          style={{
            fontFamily:   "var(--font-dm-sans)",
            fontSize:     14,
            fontWeight:   600,
            color:        "var(--text-light)",
            overflow:     "hidden",
            textOverflow: "ellipsis",
            whiteSpace:   "nowrap",
          }}
        >
          {label}
        </span>
      </div>

      {/* Blurred content beneath the overlay */}
      <div style={{ height: 6, background: "var(--border)", borderRadius: 3, filter: "blur(2px)" }} />
      <div style={{ filter: "blur(3px)" }}>
        <Shimmer width="80%" height={12} />
        <div style={{ marginTop: 6 }}>
          <Shimmer width="55%" height={12} />
        </div>
      </div>

      {/* Blur overlay with padlock */}
      <div
        style={{
          position:       "absolute",
          inset:          0,
          borderRadius:   12,
          backdropFilter: "blur(4px)",
          background:     "rgba(244,247,251,0.55)",
          display:        "flex",
          flexDirection:  "column",
          alignItems:     "center",
          justifyContent: "center",
          padding:        16,
          gap:            6,
        }}
      >
        <span style={{ fontSize: 18 }} aria-hidden="true">🔒</span>
        <p
          style={{
            fontFamily: "var(--font-dm-sans)",
            fontSize:   11,
            color:      "var(--text-mid)",
            textAlign:  "center",
            fontStyle:  "italic",
            lineHeight: 1.4,
            margin:     0,
          }}
        >
          Upgrade to unlock this indicator
        </p>
      </div>
    </CardShell>
  );
}

// ─── LOADED state (main component) ───────────────────────────────────────────

export function IndicatorCard({ indicatorKey, data, loading = false, locked = false, detailUrl }: IndicatorCardProps) {
  const [expanded, setExpanded] = useState(false);

  // Look up metadata from the registry; fall back gracefully for unknown keys
  const meta  = INDICATOR_MAP[indicatorKey];
  const label = meta?.label ?? indicatorKey.replace(/_/g, ' ');
  const icon  = meta?.icon  ?? '📊';

  // ── Delegate to state-specific sub-renders ──────────────────────────────────

  if (loading) return <LoadingCard label={label} icon={icon} />;
  if (locked)  return <LockedCard  label={label} icon={icon} />;
  if (!data)   return <UnavailableCard label={label} icon={icon} />;

  // ── LOADED ──────────────────────────────────────────────────────────────────

  const { score, confidence, details } = data;

  const summary  = meta?.summarise(details) ?? '';
  const dataRows = meta?.dataRows(details)  ?? [];

  // Verdict badge: word label + colour, or grey UNAVAILABLE if score is null
  const hasScore  = score != null;
  const verdict   = hasScore ? verdictLabel(score) : "UNAVAILABLE";
  const colour    = hasScore ? scoreColour(score)  : "#4A5D74";
  const bgColour  = hasScore ? scoreBg(score)      : "rgba(74,93,116,0.10)";

  return (
    <CardShell>
      {/* ── Header row ── */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }} aria-hidden="true">{icon}</span>
          <span
            style={{
              fontFamily:   "var(--font-dm-sans)",
              fontSize:     14,
              fontWeight:   600,
              color:        "var(--text)",
              overflow:     "hidden",
              textOverflow: "ellipsis",
              whiteSpace:   "nowrap",
            }}
          >
            {label}
          </span>
        </div>

        {/* Verdict badge — always shown, word not number */}
        <span
          style={{
            fontFamily:    "var(--font-dm-sans)",
            fontSize:      11,
            fontWeight:    700,
            color:         colour,
            background:    bgColour,
            borderRadius:  6,
            padding:       "2px 8px",
            flexShrink:    0,
            letterSpacing: "0.04em",
          }}
        >
          {verdict}
        </span>
      </div>

      {/* ── Mini score bar ── */}
      <div style={{ height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
        <div
          style={{
            height:       "100%",
            width:        hasScore ? `${score}%` : "0%",
            background:   colour,
            borderRadius: 3,
            transition:   "width 400ms ease-out",
          }}
        />
      </div>

      {/* ── Summary sentence ── */}
      {summary && (
        <p
          style={{
            fontFamily: "var(--font-dm-sans)",
            fontSize:   13,
            color:      "var(--text-mid)",
            lineHeight: 1.5,
            margin:     0,
          }}
        >
          {summary}
        </p>
      )}

      {/* ── Expanded data rows ── */}
      {expanded && dataRows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {dataRows.map((row) => (
            <div key={row.label} className="flex items-center justify-between">
              <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: 11, color: "var(--text-light)" }}>
                {row.label}
              </span>
              <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: 11, fontWeight: 500, color: "var(--text)" }}>
                {row.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Footer: confidence + expand + detail link ── */}
      <div className="flex items-center justify-between" style={{ marginTop: "auto" }}>
        <div className="flex items-center gap-1.5">
          <span
            className="rounded-full"
            style={{ width: 7, height: 7, background: confidenceColour(confidence), display: "inline-block" }}
            aria-hidden="true"
          />
          <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: 11, color: "var(--text-light)" }}>
            {confidenceLabel(confidence)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {dataRows.length > 0 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              style={{
                fontFamily: "var(--font-dm-sans)",
                fontSize:   11,
                color:      "var(--text-mid)",
                background: "none",
                border:     "none",
                cursor:     "pointer",
                padding:    0,
              }}
            >
              {expanded ? "Less ↑" : "Detail ›"}
            </button>
          )}
          {detailUrl && (
            <a
              href={detailUrl}
              style={{
                fontFamily:     "var(--font-dm-sans)",
                fontSize:       11,
                fontWeight:     600,
                color:          "#34C97A",
                textDecoration: "none",
              }}
            >
              Full report →
            </a>
          )}
        </div>
      </div>
    </CardShell>
  );
}
