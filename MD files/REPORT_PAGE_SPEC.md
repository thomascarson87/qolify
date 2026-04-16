# REPORT_PAGE_SPEC.md
# Qolify — DNA Report Page & Component Specification
# Route: /analyse/[jobId] · v1.0

**Purpose:** Define the section order, component names, data bindings, and layout rules for the DNA Report page. Authoritative build spec for `ResultView.tsx` and all child components. Read alongside `INDICATOR_CARD_SPEC.md`.

**Key files:** `app/analyse/[jobId]/ResultView.tsx` · `app/analyse/[jobId]/page.tsx` · `components/ui/*` · `components/report/*` · `lib/indicators/*`

---

## 1. Architecture & Routing

### 1.1 Route structure

| Field | Value |
|---|---|
| **Page file** | `app/analyse/[jobId]/page.tsx` |
| **Renderer** | `app/analyse/[jobId]/ResultView.tsx` |
| **Job ID source** | URL param `[jobId]` → query `analysis_jobs` table → fetch `analysis_cache` by `cache_id` |
| **Loading state** | `page.tsx` shows skeleton shell while `job.status = processing`. Polls `/api/analyse/status` every 2s via `lib/analysePoller.ts` |
| **Error state** | If `job.status = failed`: show error card with `job.error_message`. Never show a blank page. |
| **Sharing** | URL is shareable. Unauthenticated users see Tier 1 indicators only. Locked indicators show blur overlay. |

### 1.2 Data flow

1. User submits URL on `/analyse` → `POST /api/analyse` → returns `{ jobId }`
2. Page redirects to `/analyse/[jobId]`
3. `ResultView` polls `/api/analyse/status` until `status = complete`
4. On complete: fetch `analysis_cache`, `composite_indicators`, `alerts` by `cache_id`
5. Pass all data as props down to section components
6. Each section component is responsible for its own loading / unavailable / locked state

### 1.3 TypeScript prop contract — ResultView.tsx

```typescript
interface ResultViewProps {
  cache:       AnalysisCache        // analysis_cache row
  indicators:  CompositeIndicators  // composite_indicators row
  alerts:      Alert[]              // alerts rows for this property_id
  scores:      PropertyScores       // property_scores row
  userTier:    'free' | 'pro' | 'explorer' | 'intelligence'  // from Supabase JWT
  isLoading:   boolean              // true while job.status = processing
  jobError:    string | null        // job.error_message if status = failed
}
```

---

## 2. Page Structure

The report scrolls top-to-bottom as a single page. Sections are stacked vertically in the order below. No tabs, no sidebars, no split-panes.

| # | Section name | Component | Tier |
|---|---|---|---|
| H | Sticky Property Header | Inline in `ResultView` | All tiers |
| A | Alert Banner | `components/ui/AlertPill.tsx` (mapped) | All tiers |
| 1 | Financial Anatomy | `components/map/FinancialBreakdown.tsx` | Tier 1 |
| 2 | Risk Audit | `RiskAuditGrid` (new) | Tier 1 |
| 3 | Intelligence Indicators | `components/ui/IndicatorCard.tsx` (×15) | Tier 1–3 |
| 4 | Life Proximity + Mini-Map | `components/map/ProximitySummary.tsx` + `MiniMapCard` | Tier 1 |
| 5 | Asset Performance Pillars | `components/ui/PillarScoreBar.tsx` (×9) | Pro+ |
| 6 | Future View | `FutureViewTimeline` (new) | Pro+ |
| 7 | Market Context | `MarketContext` (new) | Pro+ |

---

## 3. Section Specifications

---

### Section H — Sticky Property Header

| Field | Value |
|---|---|
| **Component** | Inline in `ResultView.tsx` — not a separate file |
| **File** | `app/analyse/[jobId]/ResultView.tsx` |
| **Data source** | `analysis_cache`: `address`, `municipio`, `price_asking`, `area_sqm`, `bedrooms`, `bathrooms`, `epc_rating` · `composite_indicators.tvi_score` |
| **Tier gating** | Always visible — all tiers |
| **Layout** | Full-width sticky bar. Compresses on scroll: full height (80px) → compact (48px). Full state: photo thumbnail (48px) + address + price + TVI Ring LG + source portal badge. Compact state: address + price + TVI Ring SM only. |

| State | Behaviour |
|---|---|
| LOADING | Skeleton shimmer for all fields. TVI ring shows empty grey circle. |
| LOADED | All fields rendered. TVI ring animates in over 600ms (`cubic-bezier(0.34, 1.56, 0.64, 1)`). |
| NO PRICE | Hide price field. Show "Price not available" in muted text. |

> **Note:** TVI Ring component: `components/ui/TVIRing.tsx`. Colour: Emerald ≥75 · Amber 50–74 · Risk <50.

---

### Section A — Alert Banner

| Field | Value |
|---|---|
| **Component** | `components/ui/AlertPill.tsx` |
| **File** | `components/ui/AlertPill.tsx` |
| **Data source** | `alerts` table: all rows for this `property_id`, ordered by `type` (red first, then amber, then green) |
| **Tier gating** | Always visible — all tiers. Alerts are never locked. |
| **Layout** | Horizontal flex wrap of `AlertPill` components. Red first, amber second, green last. Mobile: top 2 visible + "Show X more" expand. |

| State | Behaviour |
|---|---|
| LOADING | Single shimmer pill placeholder. |
| NO ALERTS | Render nothing — do not show an empty section or "no alerts" message. |
| LOADED | Map over alerts array. Each pill: colour-coded icon + short uppercase label. Expandable to full description on click. |

> **Note:** Verify `AlertPill` handles the `red` / `amber` / `green` type prop from the `alerts` table correctly.

---

### Section 1 — Financial Anatomy

| Field | Value |
|---|---|
| **Component** | `components/map/FinancialBreakdown.tsx` |
| **File** | `components/map/FinancialBreakdown.tsx` |
| **Data source** | `analysis_cache`: `price_asking`, `negotiation_gap_pct`, `epc_rating` · `composite_indicators`: `true_affordability_monthly_eur`, `true_affordability_score`, `rental_trap_monthly_delta_eur` · `eco_constants`: current Euribor · `ico_caps`: lookup by `comunidad_autonoma` |
| **Tier gating** | Tier 1 — all users |
| **Layout** | Three cards in a row on desktop (`lg:grid-cols-3`), stacked on mobile. Cards: (1) Negotiation Gap Gauge, (2) Monthly Cost Breakdown, (3) ICO Eligibility. |

| State | Behaviour |
|---|---|
| LOADING | Three skeleton cards matching the shape of the loaded cards. |
| LOADED | All three cards rendered with live data. See `INDICATOR_CARD_SPEC.md` S2 and S1 for individual card states. |
| PARTIAL | If ICO data unavailable: ICO card in UNAVAILABLE state. Other two cards still render independently. Never hide the entire section. |

---

### Section 2 — Risk Audit

| Field | Value |
|---|---|
| **Component** | `RiskAuditGrid` — **create new** at `components/report/RiskAuditGrid.tsx` |
| **File** | `components/report/RiskAuditGrid.tsx` (create new) |
| **Data source** | `analysis_cache`: `epc_rating`, `epc_potential`, `ref_catastral` · `ite_status`: JOIN on `ref_catastral` · `flood_zones`: PostGIS point-in-polygon · `vut_licences`: count within 200m |
| **Tier gating** | Tier 1 — all users |
| **Layout** | 2×2 grid on desktop (`md:grid-cols-2 lg:grid-cols-4`), stacked on mobile. Each card approximately square (`aspect-square`). Cards: (1) ITE Building Health, (2) Flood Risk, (3) Energy Certificate, (4) VUT Density. |

| State | Behaviour |
|---|---|
| LOADING | Four skeleton squares. |
| LOADED | All four cards rendered. Each follows four-state rules from `INDICATOR_CARD_SPEC.md`. |
| PARTIAL | Each card renders independently. A failed lookup for one card does not affect others. |

> **⚠ Note:** Flood Risk card (S4 in `INDICATOR_CARD_SPEC.md`) must NEVER be locked or hidden. ITE card (S3) falls back to proximity lookup if `ref_catastral` is null.

---

### Section 3 — Intelligence Indicators

| Field | Value |
|---|---|
| **Component** | `components/ui/IndicatorCard.tsx` (×15 instances) |
| **File** | `components/ui/IndicatorCard.tsx` |
| **Data source** | `composite_indicators`: all columns · `lib/indicators/registry.ts`: indicator metadata (name, icon, tier, db column mapping) |
| **Tier gating** | Tier 1 (indicators 1–5, all users) · Tier 2 / Pro+ (indicators 6–12) · Tier 3 / Intelligence (indicators 13–15). Locked indicators show blur overlay — not hidden. |
| **Layout** | Section header: "Proprietary Intelligence". Below: 5-column grid on desktop (`grid-cols-5`), 3-column on tablet, 2-column on mobile. All 15 cards rendered in grid. Locked cards in-grid with blur. |

| State | Behaviour |
|---|---|
| LOADING | All 15 cards show skeleton shimmer in correct grid positions. |
| LOADED | Each card: verdict badge + key metric + implication. See `INDICATOR_CARD_SPEC.md` Section 2 for full per-indicator spec. |
| LOCKED | Blurred card body with padlock icon centred. Upgrade prompt on hover/tap. Card label always visible above blur. |
| UNAVAILABLE | Muted card with "Data unavailable" text. Never empty. |

> **Note:** `lib/indicators/registry.ts` maps each indicator to its display name, icon, tier, and db column. `IndicatorCard.tsx` should read from this registry — indicator metadata must not be hardcoded inside the component.

---

### Section 4 — Life Proximity + Mini-Map

| Field | Value |
|---|---|
| **Component** | `components/map/ProximitySummary.tsx` + `MiniMapCard` (create new) |
| **Files** | `components/map/ProximitySummary.tsx` · `components/report/MiniMapCard.tsx` (create new) |
| **Data source** | `amenities` table: `ST_DWithin 400m` on property coordinates (via `/api/map/amenities`) · `analysis_cache.lat`, `analysis_cache.lng` |
| **Tier gating** | Tier 1 — all users |
| **Layout** | Two-column on desktop (`lg:grid-cols-2`): LEFT = `MiniMapCard` (220px fixed height), RIGHT = `ProximitySummary` (chip list by category). Mobile: stacked, map above list. |

| State | Behaviour |
|---|---|
| LOADING | LEFT: navy placeholder 220px, "Loading area map…" centred. RIGHT: shimmer chip list. |
| MAP LOADED | MapLibre static map, zoom ~15, centred on property pin. Pulsing emerald pin. 400m dashed emerald radius circle. Emoji HTML marker pins per amenity category (see `INDICATOR_CARD_SPEC.md` Section 4.2). |
| MAP FAILED | LEFT: static placeholder card. RIGHT: `ProximitySummary` renders normally as text chips — map failure must not block proximity data. |
| NO AMENITIES | "No amenities found within 400m." in muted text. `MiniMapCard` still renders with pin and radius circle. |

> **⚠ Note:** `MiniMapCard` is NOT the main map viewport. Fixed height 220px. No pan/zoom. No click events. See `INDICATOR_CARD_SPEC.md` Section 4 for full mini-map spec.

---

### Section 5 — Asset Performance Pillars

| Field | Value |
|---|---|
| **Component** | `components/ui/PillarScoreBar.tsx` (×9 instances) |
| **File** | `components/ui/PillarScoreBar.tsx` |
| **Data source** | `property_scores`: `score_market`, `score_legal`, `score_environmental`, `score_connectivity`, `score_education`, `score_health`, `score_community`, `score_safety`, `score_future_value` · `composite_indicators.tvi_score` |
| **Tier gating** | Pro+ only. Free users see section header + first 3 bars blurred + upgrade prompt. |
| **Layout** | Full-width dark-background section. Two columns: LEFT (`lg:col-span-8`) = 9 stacked score bars with label + percentage + coloured fill. RIGHT (`lg:col-span-4`) = TVI donut ring (180px) with overall score + "Top X% in municipal class" note. |

| State | Behaviour |
|---|---|
| LOADING | Nine shimmer bars left. Grey donut ring right. |
| LOADED | Bar fill animates in over 400ms on mount. Bar colour: Emerald ≥70 · Amber 40–69 · Risk <40. |
| LOCKED | First 3 bars visible, remaining 6 blurred. Upgrade CTA overlaid on blurred region. |

---

### Section 6 — Future View Timeline

| Field | Value |
|---|---|
| **Component** | `FutureViewTimeline` — **create new** at `components/report/FutureViewTimeline.tsx` |
| **File** | `components/report/FutureViewTimeline.tsx` (create new) |
| **Data source** | `infrastructure_projects`: `ST_DWithin 2km`, `status IN (approved, under_construction, planned)`, ordered by `expected_date ASC` |
| **Tier gating** | Pro+ only |
| **Layout** | Vertical timeline. Left edge: continuous vertical line. Each project: dot on line + date label (DM Mono) + project name (bold) + type badge + plain-English implication sentence. |

| State | Behaviour |
|---|---|
| LOADING | Three shimmer timeline rows. |
| LOADED | Projects listed chronologically. Dot colour: Emerald = positive impact · Amber = neutral/commercial · Risk = disruption risk. |
| NO PROJECTS | "No approved infrastructure projects within 2km." — render section with this message, do not hide section. |
| LOCKED | Section header visible. Content blurred. Upgrade CTA. |

---

### Section 7 — Market Context

| Field | Value |
|---|---|
| **Component** | `MarketContext` — **create new** at `components/report/MarketContext.tsx` |
| **File** | `components/report/MarketContext.tsx` (create new) |
| **Data source** | `zone_metrics_history`: latest row for this `codigo_postal` · `property_price_history`: comparable properties · `composite_indicators.price_velocity_pct_3m`, `price_velocity_pct_12m`, `dom_velocity` |
| **Tier gating** | Pro+ |
| **Layout** | Three sub-sections: (1) Days-on-market bar vs municipio average · (2) Price/m² vs postcode median with inline distribution chart · (3) Up to 3 similar property cards with TVI scores. |

| State | Behaviour |
|---|---|
| LOADING | Shimmer bars and card placeholders. |
| LOADED | All three sub-sections rendered with live data. |
| INSUFFICIENT DATA | "Not enough comparable sales data for this postcode." — show message for null sub-sections. Other sub-sections still render. |
| LOCKED | Section header visible. Content blurred. Upgrade CTA. |

---

## 4. Map Pin Triage Card

This section specifies what `PinReportPanel.tsx` becomes after the unification. It is **not** a full report — it is a triage card that hands off to the full report. The map is a discovery surface; the report is the intelligence surface.

### 4.1 What PinReportPanel becomes

`PinReportPanel.tsx` is simplified to show only the data that is available immediately from coordinates — no financial intelligence, no indicator cards. Its sole CTA is "Full Report →" which opens the DNA Report with coordinates pre-filled.

| Field | Value |
|---|---|
| **File** | `components/map/PinReportPanel.tsx` (modified, not replaced) |
| **Trigger** | User drops pin on map or right-clicks → long-presses |
| **Width** | 360px right-side drawer, slides in over 200ms |
| **Data source** | `POST /api/map/pin` with `{ lat, lng }` — same endpoint as today |

### 4.2 Triage card section order

| # | Section | Component | Notes |
|---|---|---|---|
| 1 | Coordinates + address | Inline | Reverse geocoded address. "+ Add details →" link for optional enrichment |
| 2 | AI area summary | `generateAreaSummary.ts` | 2–3 sentences. Rendered as plain text — strip markdown before display |
| 3 | Flood safety | `FloodSafetySection.tsx` | Binary result. Never hidden. Always first risk signal shown |
| 4 | Within 5-min walk | `ProximitySummary.tsx` (subset) | 4 categories only: school, health, supermarket, park. "Show all →" expands |
| 5 | Community character | Inline | VUT count within 200m only |
| 6 | Full Report CTA | Inline button | See 4.3 below |

### 4.3 Full Report CTA — the critical bridge

This is the link between the two surfaces. It must pass coordinates into a new analysis job.

```
[ View Full Intelligence Report → ]
```

- Appearance: full-width navy button, Playfair Display italic label, Emerald arrow
- On click: `POST /api/analyse` with `{ url: null, lat, lng, name: reversedAddress }`
- Redirects to `/analyse/[jobId]` — the DNA Report
- The report renders all coordinate-derived sections immediately (flood, proximity, indicators)
- Financial section shows UNAVAILABLE with inline prompt: *"Add an Idealista URL to unlock financial intelligence →"*

### 4.4 Optional URL enrichment from triage card

Below the address line, a slim collapsed field:

```
+ Add Idealista URL for financial analysis
```

On expand: single text input. On submit: re-runs analysis with URL, updates the existing job. No page reload — report updates in place if already open.

### 4.5 What PinReportPanel no longer shows

Remove these from `PinReportPanel.tsx` — they belong in the full report only:

- Financial breakdown
- Indicator cards
- Pillar scores
- Any section that duplicates `ResultView.tsx` content

### 4.6 States

| State | Behaviour |
|---|---|
| LOADING | Coordinates shown immediately. All sections show skeleton shimmer while `/api/map/pin` resolves. |
| LOADED | All five triage sections rendered. Full Report CTA always visible. |
| NO FLOOD DATA | FloodSafetySection shows UNAVAILABLE state — never hidden. |
| ERROR | "Could not load area data. Try dropping the pin again." Full Report CTA still shown with coordinates. |

---

## 5. Homepage & Analyse Page

### 5.1 Homepage — app/page.tsx

The homepage is a clean URL paste entry point. No map. No left panel.

| Field | Value |
|---|---|
| **Layout** | Centred single-column. Vertically centred in viewport on desktop. |
| **Headline** | Playfair Display italic — *"The intelligence your estate agent doesn't have."* |
| **Input** | Single large input field. Accepts Idealista URL or property address. Placeholder cycles between the two. On submit → `POST /api/analyse` → redirect to `/analyse/[jobId]`. |
| **ICP selector** | Four pill buttons below input: Family · Nomad · Retiree · Investor. Selected profile stored in `localStorage` and passed to the analysis job. Pre-selects to last used. |
| **Recent analyses** | Compact list of user's last 5 analyses (from `user_analyses` table). Address + TVI ring XS + time ago. Authenticated users only. |
| **No map** | The map is not on the homepage. Link to `/map` in top nav only. |

### 5.2 Analyse Page — app/analyse/page.tsx + AnalyseClient.tsx

The `/analyse` page is the submission shell. It handles the transition from URL submitted to report loading.

| Field | Value |
|---|---|
| **On load with no jobId** | Redirect to homepage. `/analyse` without a pending jobId is not a valid state. |
| **AnalyseClient.tsx** | Handles the URL input form and submission logic. Calls `POST /api/analyse`. On success, redirects to `/analyse/[jobId]`. |
| **Loading state** | While job is processing: animated progress indicator + "Analysing [address]…" message. Uses `lib/analysePoller.ts` to poll `/api/analyse/status`. |
| **On complete** | `ResultView.tsx` takes over and renders the DNA Report. |

---

## 6. Navigation

### 6.1 Top navigation bar — app/layout.tsx

| Field | Value |
|---|---|
| **Height** | 64px fixed. Navy background `#0D2B4E`. |
| **Left** | Qolify wordmark in Playfair Display italic, white. |
| **Centre (desktop)** | Nav links: Analyse · Map · Saved · Compare. Active link: Emerald underline. |
| **Right** | Authenticated: user avatar + tier badge. Unauthenticated: "Sign In" text button + "Get Started" pill (Emerald). |
| **Mobile** | Hamburger → bottom sheet with all nav links. |

### 6.2 Mobile bottom bar — DNA Report only

On mobile, while viewing a DNA Report: sticky bottom bar shows price · TVI score badge · Save button · Share button. Specific to the report page — not a global nav component.

---

## 7. Architecture Decision — D-039

> Must be logged in `DECISIONS.md` before implementation begins.

| Field | Value |
|---|---|
| **Decision** | D-039: DNA Report lives at `/analyse/[jobId]`. The `/analyse` page is a submission shell only. The homepage (`/`) is the primary entry point with URL paste input. |
| **Rationale** | Most users arrive with a specific property URL. The map is secondary. This routing model puts the report — not the map — as the product centrepiece. |
| **What changes** | `/analyse/page.tsx` → thin shell, redirects to homepage if no jobId pending. `/analyse/[jobId]/ResultView.tsx` → primary report renderer, receives all data as props. |
| **What stays** | `/map/page.tsx` unchanged. All map API routes unchanged. `IndicatorCard`, `TVIRing`, `AlertPill`, `PillarScoreBar` components unchanged or extended only. |
| **Not in scope** | Saved properties page (`/saved`), Compare page (`/compare`) — Phase 3 features. Do not build them now. |
