'use client';

/**
 * PinReportPanel — triage card shown when a user drops a pin on the map.
 *
 * This is intentionally a THIN surface — it shows only the data available
 * immediately from coordinates. The Full Report CTA hands off to ResultView
 * (/analyse/[jobId]) which is the actual intelligence surface.
 *
 * Panel structure (per REPORT_PAGE_SPEC.md §4.2):
 *   1. Coordinates + reverse geocoded address  (+URL enrichment, optional)
 *   2. AI area summary                          (plain text, markdown stripped)
 *   3. Flood safety                             (FloodSafetySection — ALWAYS shown)
 *   4. Within 5-min walk                        (ProximitySummary — 4 categories)
 *   5. Community character                      (VUT count within 200m only)
 *   6. Full Report CTA                          (POST /api/analyse with lat/lng)
 *
 * Removed from this panel (belong in ResultView only):
 *   - ZoneSnapshotSection (score bars)
 *   - ReportsNavSection (deep-dive tiles)
 *   - SavePinForm          → to be added to ResultView sticky header (future session)
 *   - Solar exposure section
 *   - Old URL-gated CTA
 *
 * Data arrives as a single PinReport object from POST /api/map/pin.
 * This component is display-only — all computation happens in the API route.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { FloodSafetySection } from '@/components/map/FloodSafetySection';
import { ProximitySummary, type FacilityCounts, type UserProfile } from '@/components/map/ProximitySummary';
import { generateAreaSummary, type AreaSummaryInput } from '@/app/actions/generateAreaSummary';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal zone data shape — fetched in the background for the AI summary only.
 * Score bars and zone details live in ResultView; never shown in the triage card.
 */
interface ZoneSummary {
  zone_tvi:           number;
  school_score_norm:  number;
  flood_risk_score:   number;
  has_t10_flood:      boolean;
  price_context:      { avg_price_sqm: number; sample_count: number } | null;
  signals:            string[] | null;
  municipio:          string | null;
}

export interface PinReport {
  lat:  number;
  lng:  number;
  /** Asking price entered in the pin popup — echoed back for the analyse button. */
  price_asking: number | null;
  /** Floor area in m² entered in the pin popup — echoed back for the analyse button. */
  area_sqm: number | null;
  /** Postcode the pin falls within — used for zone context section. */
  codigo_postal: string | null;
  flood: {
    in_t10:  boolean;
    in_t100: boolean;
    in_t500: boolean;
  };
  catchment: {
    school_name: string;
    school_type: string;
  } | null;
  fibre: {
    operator:      string;
    coverage_type: string;
  } | null;
  nearest_school: { name: string; type: string; distance_m: number } | null;
  nearest_gp:     { name: string; distance_m: number }               | null;
  nearest_emergency: { name: string; distance_m: number }            | null;
  nearest_transport: { name: string; type: string; distance_m: number } | null;
  solar:    { ghi_annual_kwh_m2: number }                            | null;
  climate: {
    sunshine_hours_annual: number;
    days_above_35c_annual: number;
    temp_mean_annual_c:    number;
    temp_mean_jul_c:       number;
    temp_mean_jan_c:       number;
  } | null;
  airports: Array<{ name: string; iata_code: string; distance_km: number }>;
  vut_count_200m: number;
  facilities: FacilityCounts;
  financial: {
    mortgage_monthly:  number;
    ibi_monthly:       number;
    energy_monthly:    number;
    community_monthly: number;
    mortgage_rate_pct: number;
    mortgage_term:     number;
  } | null;
  /** Pin-level QoL scores computed in the API route. */
  qol_scores: {
    daily_life_score:          number;
    sensory_environment_score: number;
    community_stability_score: number;
    noise_lden:                number | null;
    noise_band:                string | null;
    nearest_beach_m:           number | null;
    nearest_beach_name:        string | null;
  } | null;
  generated_at: string;
}

export interface PinReportPanelProps {
  /** Report data returned from POST /api/map/pin. Null = loading state. */
  report:       PinReport | null;
  /** Whether the panel is in a loading state. */
  loading:      boolean;
  /** Error string, if any. */
  error:        string | null;
  /** Whether the panel is visible at all. */
  isOpen:       boolean;
  /** User profile — controls which proximity rows are shown by default. */
  profile?:     UserProfile;
  onClose:      () => void;
  /** Called to activate a named MapLibre layer (e.g. flood boundary). */
  onActivateLayer?: (layerId: string) => void;
  /** Called when the user expands proximity radius to 800m — map ring should expand too. */
  onExpandRadius?: () => void;
  /** Called when the user returns to 400m — map ring should shrink back. */
  onCollapseRadius?: () => void;
  /** Resolved address from geocoding search, if the pin was placed via address search. */
  resolvedAddress?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtCoord(n: number, pos: string, neg: string): string {
  return `${Math.abs(n).toFixed(4)}° ${n >= 0 ? pos : neg}`;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 10, letterSpacing: '0.1em' }}
      className="uppercase text-[#8A9BB0] mb-2"
    >
      {children}
    </p>
  );
}

function Divider() {
  return <div style={{ height: 1, background: '#1E3050', margin: '4px 0' }} />;
}

/** Grade letter from a 0–100 score — used when building the AI summary input. */
function gradeLetter(score: number): string {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

// Strip common markdown so AI-generated text renders as clean prose.
// Handles: headings (#), bold, italic, inline code, bullet points.
function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')        // # Heading → Heading
    .replace(/\*\*(.+?)\*\*/g, '$1')    // **bold** → bold
    .replace(/\*(.+?)\*/g, '$1')         // *italic* → italic
    .replace(/_(.+?)_/g, '$1')           // _italic_ → italic
    .replace(/`(.+?)`/g, '$1')           // `code` → code
    .replace(/^[\-\*]\s+/gm, '')         // - bullet → stripped
    .replace(/\n{3,}/g, '\n\n')          // collapse excess blank lines
    .trim();
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function PanelSkeleton() {
  return (
    <div className="flex flex-col gap-5 animate-pulse px-5 py-4">
      <div className="h-5 w-40 rounded bg-[#1E3050]" />
      <div className="h-20 rounded bg-[#1E3050]" />
      <div className="h-32 rounded bg-[#1E3050]" />
      <div className="h-24 rounded bg-[#1E3050]" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 2 — AI area summary
// ---------------------------------------------------------------------------

function AreaSummarySection({
  loading,
  summary,
}: {
  loading: boolean;
  summary: string | null;
}) {
  if (!loading && !summary) return null;

  return (
    <section>
      <SectionLabel>Area Overview</SectionLabel>
      {loading ? (
        /* Skeleton while Claude generates the summary */
        <div className="flex flex-col gap-2 animate-pulse">
          <div style={{ height: 13, width: '100%', background: '#1E3050', borderRadius: 4 }} />
          <div style={{ height: 13, width: '92%',  background: '#1E3050', borderRadius: 4 }} />
          <div style={{ height: 13, width: '78%',  background: '#1E3050', borderRadius: 4 }} />
        </div>
      ) : (
        <p style={{
          fontFamily: 'var(--font-dm-sans)',
          fontSize:   14,
          color:      '#C5D5E8',
          lineHeight: 1.6,
          margin:     0,
        }}>
          {/* stripMarkdown prevents headings like "# Málaga Property Summary" rendering as raw text */}
          {stripMarkdown(summary!)}
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section 5 — Community character (VUT count only, per triage card spec)
// ---------------------------------------------------------------------------

function CommunityCharacterTriage({ vutCount }: { vutCount: number }) {
  const color    = vutCount <= 3 ? '#34C97A' : vutCount <= 10 ? '#D4820A' : '#C94B1A';
  const icon     = vutCount <= 3 ? '✓' : '⚠';
  const bodyText = vutCount <= 3
    ? 'Low tourist saturation in this immediate area.'
    : vutCount <= 10
    ? 'Moderate tourist rentals present — worth checking your specific building.'
    : 'High tourist rental density. Residential character may be reduced.';

  return (
    <section>
      <SectionLabel>Community Character</SectionLabel>
      <div style={{
        borderLeft:   `3px solid ${color}`,
        background:   `${color}10`,
        borderRadius: '0 8px 8px 0',
        padding:      '12px 14px',
      }}>
        <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, fontWeight: 600, color: '#FFFFFF', marginBottom: 2 }}>
          <span style={{ color }}>{icon}</span>
          {' '}{vutCount} active tourist rental licence{vutCount !== 1 ? 's' : ''} within 200m.
        </p>
        <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 12, color: '#8A9BB0', margin: 0 }}>
          {bodyText}
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// URL Enrichment — slim optional form (URL only, per §4.4)
// Stores the Idealista URL in localStorage keyed to the pin coordinates.
// idealistaUrl is lifted to PinReportPanel so handleFullReport can read it.
// ---------------------------------------------------------------------------

function storageKey(lat: number, lng: number) {
  return `qolify_enrich_${lat.toFixed(5)}_${lng.toFixed(5)}`;
}

function UrlEnrichment({
  lat,
  lng,
  idealistaUrl,
  onUrlSave,
}: {
  lat:           number;
  lng:           number;
  idealistaUrl:  string;
  onUrlSave:     (url: string) => void;
}) {
  const [expanded,   setExpanded]   = useState(false);
  const [saved,      setSaved]      = useState(false);
  const [inputValue, setInputValue] = useState(idealistaUrl);

  function handleSave() {
    try {
      localStorage.setItem(storageKey(lat, lng), JSON.stringify({ idealistaUrl: inputValue }));
    } catch { /* ok */ }
    onUrlSave(inputValue);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    setExpanded(false);
  }

  return (
    <div>
      {/* Saved URL display — only when a URL is stored */}
      {idealistaUrl && !expanded && (
        <a
          href={idealistaUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display:        'inline-flex',
            alignItems:     'center',
            gap:            4,
            fontFamily:     'var(--font-dm-sans)',
            fontSize:       11,
            color:          '#34C97A',
            textDecoration: 'none',
            marginBottom:   6,
          }}
        >
          <span aria-hidden>🔗</span> View on Idealista →
        </a>
      )}

      {/* Toggle — hidden when a URL is already saved; expand only when there's nothing yet */}
      {!idealistaUrl && (
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            width:      '100%',
            fontFamily: 'var(--font-dm-sans)',
            fontSize:   11,
            fontWeight: 500,
            color:      expanded ? '#8A9BB0' : '#34C97A',
            background: 'transparent',
            border:     'none',
            cursor:     'pointer',
            textAlign:  'left',
            padding:    '4px 0',
            transition: 'color 0.15s',
          }}
        >
          {expanded ? '− Close' : '+ Add Idealista URL for deeper analysis'}
        </button>
      )}

      {/* Expandable URL input */}
      <div style={{
        overflow:   'hidden',
        maxHeight:  expanded ? 120 : 0,
        opacity:    expanded ? 1 : 0,
        transition: 'max-height 0.25s ease, opacity 0.2s ease',
      }}>
        <div style={{
          background:    '#0A1825',
          border:        '1px solid #1E3050',
          borderRadius:  8,
          padding:       12,
          marginTop:     8,
          display:       'flex',
          flexDirection: 'column',
          gap:           8,
        }}>
          <input
            type="url"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            placeholder="https://www.idealista.com/inmueble/…"
            style={{
              background:  '#0D1B2A',
              border:      '1px solid #1E3050',
              borderRadius: 6,
              padding:     '7px 10px',
              fontFamily:  'var(--font-dm-sans)',
              fontSize:    12,
              color:       '#FFFFFF',
              outline:     'none',
              width:       '100%',
              boxSizing:   'border-box',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={handleSave}
              style={{
                fontFamily:   'var(--font-dm-sans)',
                fontSize:     11,
                fontWeight:   600,
                color:        '#0D1B2A',
                background:   saved ? '#2CC675' : '#34C97A',
                border:       'none',
                borderRadius: 6,
                padding:      '6px 14px',
                cursor:       'pointer',
                transition:   'background 0.2s',
              }}
            >
              {saved ? '✓ Saved' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PinReportPanel({
  report,
  loading,
  error,
  isOpen,
  profile = 'family',
  resolvedAddress,
  onClose,
  onActivateLayer,
  onExpandRadius,
  onCollapseRadius,
}: PinReportPanelProps) {
  const router = useRouter();
  const [proximityRadius, setProximityRadius] = useState<400 | 800>(400);
  const [isFullscreen,    setIsFullscreen]    = useState(false);

  // Zone data fetched in background — used ONLY for the AI summary input.
  // Score bars and zone details belong in ResultView, not here.
  const [zoneData,       setZoneData]       = useState<ZoneSummary | null>(null);
  const [areaSummary,    setAreaSummary]     = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading]  = useState(false);
  // Guard: fire once per pin location per panel open
  const summaryFiredRef = useRef<string | null>(null);

  // Full Report CTA loading state
  const [fullReportLoading, setFullReportLoading] = useState(false);

  // Idealista URL — lifted from UrlEnrichment so handleFullReport can use it.
  // Synced from localStorage whenever the pin coordinates change.
  const [idealistaUrl, setIdealistaUrl] = useState('');

  useEffect(() => {
    if (!report) { setIdealistaUrl(''); return; }
    try {
      const raw = localStorage.getItem(storageKey(report.lat, report.lng));
      if (raw) {
        const data = JSON.parse(raw) as { idealistaUrl?: string };
        setIdealistaUrl(data.idealistaUrl ?? '');
        return;
      }
    } catch { /* localStorage may not be available */ }
    setIdealistaUrl('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.lat, report?.lng]);

  // ---- Zone fetch + AI summary -----------------------------------------------
  // Runs when a new report lands. Fetches zone data first (for AI context),
  // then generates the summary. Both steps fail silently.
  useEffect(() => {
    if (!report) {
      setZoneData(null);
      setAreaSummary(null);
      summaryFiredRef.current = null;
      return;
    }

    const postcode = report.codigo_postal;
    const key = `${report.lat.toFixed(4)}_${report.lng.toFixed(4)}`;
    if (summaryFiredRef.current === key) return;
    summaryFiredRef.current = key;

    setSummaryLoading(true);
    setAreaSummary(null);
    setZoneData(null);

    const zonePromise: Promise<ZoneSummary | null> = postcode
      ? fetch(`/api/map/zone/${postcode}`)
          .then(r => r.ok ? r.json() as Promise<ZoneSummary> : null)
          .catch(() => null)
      : Promise.resolve(null);

    zonePromise
      .then(zd => {
        if (zd) setZoneData(zd);

        const floodStatus: AreaSummaryInput['floodStatus'] =
          report.flood.in_t10  ? 't10'  :
          report.flood.in_t100 ? 't100' :
          report.flood.in_t500 ? 't500' : 'safe';

        const input: AreaSummaryInput = {
          floodStatus,
          schoolCount:      report.facilities.school_primary_count,
          nearestSchoolM:   report.facilities.school_nearest_m,
          gpCount:          report.facilities.gp_count,
          supermarketCount: report.facilities.supermarket_count,
          parkCount:        report.facilities.park_count,
          vutCount:         report.vut_count_200m,
          zoneScore:        zd?.zone_tvi     != null ? Math.round(zd.zone_tvi)  : null,
          zoneGrade:        zd?.zone_tvi     != null ? gradeLetter(zd.zone_tvi) : null,
          priceSqm:         zd?.price_context?.avg_price_sqm ?? null,
          fibreStatus:      report.fibre?.coverage_type ?? null,
          postcode:         postcode ?? '',
          city:             zd?.municipio ?? 'Málaga',
        };

        return generateAreaSummary(input);
      })
      .then(text => setAreaSummary(text))
      .catch(() => { /* fail silently — triage card always renders */ })
      .finally(() => setSummaryLoading(false));
  }, [report]);

  // ---- Full Report CTA handler ------------------------------------------------
  // POST /api/analyse. When the user has saved an Idealista URL for this pin,
  // include it so the Edge Function can scrape the full listing. Otherwise send
  // url: null and fall back to coordinates-only (pin: URI) analysis.
  const handleFullReport = useCallback(async () => {
    if (!report) return;
    setFullReportLoading(true);
    try {
      const res = await fetch('/api/analyse', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url:  idealistaUrl || null,
          lat:  report.lat,
          lng:  report.lng,
          name: resolvedAddress ?? `${report.lat.toFixed(4)}, ${report.lng.toFixed(4)}`,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { jobId?: string; id?: string };
      const jobId = data.jobId ?? data.id;
      if (!jobId) throw new Error('No job ID in response');
      router.push(`/analyse/${jobId}?back=map&lat=${report.lat}&lng=${report.lng}`);
    } catch (err) {
      console.error('[full report CTA]', err);
      setFullReportLoading(false); // reset so user can retry
    }
  }, [report, idealistaUrl, resolvedAddress, router]);

  // ---- Panel geometry --------------------------------------------------------
  const panelStyle: React.CSSProperties = isFullscreen
    ? {
        position:       'fixed',
        inset:          0,
        width:          '100%',
        maxWidth:       '100%',
        zIndex:         50,
        background:     'rgba(13, 27, 42, 0.98)',
        backdropFilter: 'blur(24px)',
        transform:      isOpen ? 'translateX(0)' : 'translateX(100%)',
        transition:     'transform 250ms cubic-bezier(0.4, 0, 0.2, 1)',
        willChange:     'transform',
      }
    : {
        width:          380,
        background:     'rgba(13, 27, 42, 0.95)',
        backdropFilter: 'blur(24px)',
        borderLeft:     '1px solid #1E3050',
        transform:      isOpen ? 'translateX(0)' : 'translateX(100%)',
        transition:     'transform 250ms cubic-bezier(0.4, 0, 0.2, 1)',
        willChange:     'transform',
      };

  return (
    <div
      aria-label="Pin analysis panel"
      className={`${isFullscreen ? '' : 'absolute top-0 right-0 h-full'} z-20 flex flex-col overflow-hidden`}
      style={panelStyle}
    >
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-5 pt-5 pb-4 shrink-0 border-b border-[#1E3050]"
        style={isFullscreen ? { maxWidth: 900, width: '100%', alignSelf: 'center', paddingLeft: 40, paddingRight: 40 } : {}}
      >
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            style={{
              display:      'inline-block',
              width:        10,
              height:       10,
              borderRadius: '50%',
              background:   '#34C97A',
              boxShadow:    '0 0 0 3px rgba(52,201,122,0.25)',
              flexShrink:   0,
            }}
          />
          <p
            style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 10, letterSpacing: '0.1em' }}
            className="uppercase text-[#8A9BB0]"
          >
            Intelligence Pin
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsFullscreen(f => !f)}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Expand to fullscreen'}
            className="text-[#8A9BB0] hover:text-white transition-colors"
            title={isFullscreen ? 'Exit fullscreen' : 'Expand to fullscreen'}
          >
            {isFullscreen ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
          <button
            onClick={onClose}
            aria-label="Close pin panel"
            className="text-[#8A9BB0] hover:text-white transition-colors leading-none text-lg"
          >
            ✕
          </button>
        </div>
      </div>

      {/* ── Scrollable body ──────────────────────────────────────────────── */}
      <div
        className="flex-1 overflow-y-auto py-4 flex flex-col gap-5"
        style={isFullscreen ? { alignItems: 'center' } : {}}
      >
        {loading && <PanelSkeleton />}

        {error && !loading && (
          <p
            style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13 }}
            className="text-[#F5A07A] text-center mt-8 px-5"
          >
            {error}
          </p>
        )}

        {/* Full Report CTA is shown even in error state so the user can retry */}
        {error && !loading && report && (
          <div className="px-5">
            <FullReportButton loading={fullReportLoading} onClick={handleFullReport} />
          </div>
        )}

        {report && !loading && (
          <div
            style={isFullscreen
              ? { width: '100%', maxWidth: 960, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }
              : { width: '100%', display: 'flex', flexDirection: 'column', gap: 20 }
            }
          >

            {/* ── 1. Coordinates + address + URL enrichment ─────────────── */}
            <div className="px-5">
              <p style={{ fontFamily: 'var(--font-dm-mono)', fontSize: 12, color: '#4A6080', marginBottom: resolvedAddress ? 2 : 8 }}>
                {fmtCoord(report.lat, 'N', 'S')} · {fmtCoord(report.lng, 'E', 'W')}
              </p>
              {resolvedAddress && (
                <p style={{ fontFamily: 'var(--font-dm-sans)', fontSize: 13, color: '#C5D5E8', marginBottom: 8 }}>
                  {resolvedAddress}
                </p>
              )}
              {/* key forces remount on pin change so inputValue re-initialises */}
              <UrlEnrichment
                key={`${report.lat.toFixed(5)}_${report.lng.toFixed(5)}`}
                lat={report.lat}
                lng={report.lng}
                idealistaUrl={idealistaUrl}
                onUrlSave={setIdealistaUrl}
              />
            </div>

            <div className="px-5">
              <Divider />
            </div>

            {/* ── 2. AI area summary (markdown stripped) ────────────────── */}
            <div className="px-5">
              <AreaSummarySection loading={summaryLoading} summary={areaSummary} />
            </div>

            {/* ── 3. Flood safety — ALWAYS shown ────────────────────────── */}
            <div className="px-5">
              <FloodSafetySection
                floodResult={report.flood}
                onShowOnMap={onActivateLayer ? () => onActivateLayer('flood-zones') : undefined}
                zoneT10Warning={
                  zoneData?.has_t10_flood && !report.flood.in_t10 && !report.flood.in_t100
                    ? `Other parts of postcode ${report.codigo_postal ?? 'this area'} include T10 flood zones — this specific coordinate is outside them.`
                    : undefined
                }
              />
            </div>

            {/* ── 4. Within 5-min walk (4 categories: school/health/supermarket/park) */}
            <div className="px-5">
              <ProximitySummary
                facilities={report.facilities}
                radiusM={proximityRadius}
                onExpandRadius={() => { setProximityRadius(800); onExpandRadius?.(); }}
                onCollapseRadius={() => { setProximityRadius(400); onCollapseRadius?.(); }}
                profile={profile}
                compact={true}
              />
            </div>

            {/* ── 5. Community character (VUT count only) ───────────────── */}
            <div className="px-5">
              <CommunityCharacterTriage vutCount={report.vut_count_200m} />
            </div>

            {/* ── 6. Full Report CTA ────────────────────────────────────── */}
            <div className="px-5 pb-2">
              <FullReportButton loading={fullReportLoading} onClick={handleFullReport} />
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full Report CTA button — extracted so it can also render in the error state
// ---------------------------------------------------------------------------

function FullReportButton({
  loading,
  onClick,
}: {
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width:          '100%',
        height:         48,
        background:     '#0D2B4E',         // Navy
        border:         '1px solid #1E3050',
        borderRadius:   9999,              // rounded-full
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        gap:            8,
        cursor:         'pointer',
        transition:     'background 0.15s',
      }}
    >
      {loading ? (
        <>
          <svg
            width="16" height="16" viewBox="0 0 16 16"
            style={{ animation: 'spin 0.8s linear infinite', flexShrink: 0 }}
          >
            <circle
              cx="8" cy="8" r="6"
              stroke="#34C97A" strokeWidth="2"
              fill="none" strokeDasharray="28" strokeDashoffset="10"
            />
          </svg>
          <span style={{
            fontFamily: 'var(--font-playfair)',
            fontStyle:  'italic',
            fontSize:   15,
            color:      '#8A9BB0',
          }}>
            Preparing report…
          </span>
        </>
      ) : (
        <>
          <span style={{
            fontFamily: 'var(--font-playfair)',
            fontStyle:  'italic',
            fontSize:   15,
            color:      '#FFFFFF',
          }}>
            View Full Intelligence Report
          </span>
          <span style={{ color: '#34C97A', fontSize: 16 }}>→</span>
        </>
      )}
    </button>
  );
}
