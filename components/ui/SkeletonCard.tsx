/**
 * SkeletonCard — Reusable shimmer placeholder that matches Indicator Card dimensions.
 * Used for the 10 "coming soon" indicators and any loading state.
 *
 * Server Component — no interactivity needed.
 */

interface SkeletonCardProps {
  label?: string;     // indicator name — still shown greyed
  locked?: boolean;   // tier-gated (shows padlock)
  className?: string;
}

export function SkeletonCard({ label, locked = false, className = "" }: SkeletonCardProps) {
  return (
    <div
      className={className}
      style={{
        background: "var(--surface-1)",
        borderRadius: 12,
        padding: "16px",
        position: "relative",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      {/* Top row: name + lock icon */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {/* Icon placeholder */}
          <span
            className="skeleton-shimmer"
            style={{ width: 20, height: 20, borderRadius: 4, display: "block" }}
          />
          {label ? (
            <span
              style={{
                fontFamily: "var(--font-dm-sans)",
                fontSize: 14,
                fontWeight: 600,
                color: "var(--text-light)",
              }}
            >
              {label}
            </span>
          ) : (
            <span
              className="skeleton-shimmer"
              style={{ width: 120, height: 14, borderRadius: 4, display: "block" }}
            />
          )}
        </div>
        {locked && (
          <span aria-label="Locked" style={{ color: "var(--text-light)", fontSize: 14 }}>🔒</span>
        )}
      </div>

      {/* Mini score bar skeleton */}
      <div
        style={{
          height: 6,
          borderRadius: 3,
          overflow: "hidden",
          marginBottom: 10,
          background: "var(--border)",
        }}
      >
        <span
          className="skeleton-shimmer"
          style={{ display: "block", height: "100%", width: "60%" }}
        />
      </div>

      {/* Summary sentence skeleton */}
      <span
        className="skeleton-shimmer"
        style={{ display: "block", height: 12, borderRadius: 4, width: "85%", marginBottom: 6 }}
      />
      <span
        className="skeleton-shimmer"
        style={{ display: "block", height: 12, borderRadius: 4, width: "65%", marginBottom: 12 }}
      />

      {/* Data rows skeleton */}
      {[80, 55, 70].map((w, i) => (
        <div key={i} className="flex items-center justify-between mb-2">
          <span
            className="skeleton-shimmer"
            style={{ display: "block", height: 10, borderRadius: 3, width: `${w * 0.6}%` }}
          />
          <span
            className="skeleton-shimmer"
            style={{ display: "block", height: 10, borderRadius: 3, width: "22%" }}
          />
        </div>
      ))}

      {/* "Data coming soon" label */}
      {!locked && (
        <p
          style={{
            fontFamily: "var(--font-dm-sans)",
            fontSize: 11,
            color: "var(--text-light)",
            marginTop: 8,
            textAlign: "center",
          }}
        >
          Data coming soon
        </p>
      )}

      {/* Locked state: blur overlay + copy */}
      {locked && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 12,
            backdropFilter: "blur(4px)",
            background: "rgba(244,247,251,0.6)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            gap: 8,
          }}
        >
          <span style={{ fontSize: 20 }}>🔒</span>
          <p
            style={{
              fontFamily: "var(--font-dm-sans)",
              fontSize: 12,
              color: "var(--text-mid)",
              textAlign: "center",
              fontStyle: "italic",
              lineHeight: 1.4,
            }}
          >
            Unlock to see if you are overpaying by €20k+
          </p>
        </div>
      )}
    </div>
  );
}
