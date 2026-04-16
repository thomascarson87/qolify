# Qolify — MVP Frontend Build Brief

**For:** A new Claude Code session
**Purpose:** Build the Analyse page + Hidden DNA Report UI
**Status of backend:** Live and tested. `/api/analyse` returns real data in ~1–2s.

Read this document fully before writing any code. All decisions are already made.

---

## 1. What Is Qolify?

Qolify is a property intelligence platform for the Spanish residential market. Users paste a property URL (Idealista, Fotocasa) and receive a Hidden DNA Report — a full analysis of the property's true quality of life and value using data no mainstream portal provides: flood risk, ITE building inspection status, true monthly cost (climate-adjusted), school catchment, transport proximity, expat community density, and more.

**Tagline:** *Invest in your Life, not just a Postcode.*

**The product:** Model B (on-demand). User submits a URL → `POST /api/analyse` runs PostGIS spatial queries → returns composite score + 5 indicators + alerts → cached 48h.

**The builder:** Thomas is the product owner, not an engineer. He has designed this carefully. Do not deviate from the design specs in this brief without flagging it. Never delete or overwrite existing working code without explicit instruction.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2.1 — App Router, Turbopack, Server Components by default |
| Styling | Tailwind CSS v4 |
| Database | Supabase (PostgreSQL + PostGIS) |
| Deployment | Vercel (lhr1 region) |
| Package manager | npm |

**Key conventions (Next.js 16):**
- Default to Server Components. Only `'use client'` when you need interactivity or browser state.
- All request APIs are async: `await cookies()`, `await headers()`, `await params`, `await searchParams`.
- Use `proxy.ts` not `middleware.ts` (Next.js 16 rename).
- No 1px structural borders anywhere — hierarchy via tonal shifts only (see Design System).

**Run dev server:** `npm run dev` (user runs this themselves — Turbopack OOMs in background Bash)

---

## 3. Live API — `POST /api/analyse`

The backend is fully live. Build the UI against this real API.

### Request

```http
POST /api/analyse
Content-Type: application/json

{
  "url": "https://www.idealista.com/inmueble/12345/",
  "property": {
    "lat": 36.720,
    "lng": -4.420,
    "price_asking": 350000,
    "area_sqm": 90,
    "comunidad_autonoma": "Andalucía",
    "municipio": "Málaga",
    "build_year": 1995,
    "epc_rating": "D"
  }
}
```

The `property` object is required at this stage (Phase 0 — Parse.bot URL extraction not yet integrated). Build the UI to accept this manually entered data or use a hardcoded test object during development.

### Response shape (real CHI-327 validated output)

```json
{
  "id": "uuid",
  "source_url": "https://www.idealista.com/inmueble/12345/",
  "cached": false,
  "expires_at": "2026-03-30T12:00:00Z",
  "tvi_score": 72,
  "composite_indicators": {
    "true_affordability": {
      "score": 45,
      "label": "True Affordability",
      "tier": 1,
      "pillar": "financial",
      "confidence": "high",
      "inputs": {
        "monthly_mortgage": 1347,
        "monthly_ibi": 62,
        "monthly_energy": 81,
        "monthly_total": 1490,
        "price_per_sqm": 3889
      },
      "alerts": []
    },
    "health_security": {
      "score": 60,
      "label": "Health Security",
      "tier": 1,
      "pillar": "lifestyle",
      "confidence": "high",
      "inputs": {
        "nearest_health_centre_m": 420,
        "health_centres_1km": 2,
        "health_centres_3km": 8
      },
      "alerts": []
    },
    "education_opportunity": {
      "score": 70,
      "label": "Education Opportunity",
      "tier": 1,
      "pillar": "lifestyle",
      "confidence": "high",
      "inputs": {
        "nearest_school_m": 280,
        "schools_1km": 4,
        "schools_3km": 18
      },
      "alerts": []
    },
    "structural_liability": {
      "score": 55,
      "label": "Structural Liability",
      "tier": 1,
      "pillar": "risk",
      "confidence": "medium",
      "inputs": {
        "build_year": 1995,
        "epc_rating": "D"
      },
      "alerts": []
    },
    "expat_liveability": {
      "score": 98,
      "label": "Expat Liveability",
      "tier": 1,
      "pillar": "community",
      "confidence": "high",
      "inputs": {
        "airport_distance_km": 8.2,
        "airport_count": 1
      },
      "alerts": []
    }
  },
  "alerts": [],
  "property": {
    "lat": 36.72,
    "lng": -4.42,
    "price_asking": 350000,
    "price_per_sqm": 3889,
    "area_sqm": 90,
    "comunidad_autonoma": "Andalucía",
    "municipio": "Málaga",
    "build_year": 1995,
    "epc_rating": "D"
  }
}
```

**What's live now (5 of 15 indicators):**
- `true_affordability` — mortgage + IBI + energy cost + price/sqm
- `health_security` — nearest health centres, count within 1km/3km
- `education_opportunity` — nearest schools, count within 1km/3km
- `structural_liability` — build year + EPC rating risk score
- `expat_liveability` — airport proximity score

The remaining 10 indicators will be added in later phases. The UI must gracefully handle an indicator being absent from `composite_indicators` — show a "Data coming soon" skeleton state for any indicator not present in the response.

---

## 4. Design System — The Informed Curator

### Core Philosophy

"The Editorial Advisor" — transform complex data into a Sunday Morning experience. Calm, high-fidelity, authoritative. Think private banking terminal meets NYT data journalism.

**The No-Line Rule:** 1px structural borders are prohibited. Hierarchy via tonal shifts only.

### Colour System

```
Foundation — Navy
  Navy Deep     #0D2B4E  — nav, headers, dark surfaces
  Navy Mid      #1A3D6B  — secondary surfaces, active on dark
  Navy Light    #2A5490  — borders on dark, dividers

Signal — Emerald (positive/opportunity ONLY — never decorative)
  Emerald Deep  #1B5E3A  — badges, section accents
  Emerald Bright #34C97A — TVI rings, score fills, primary signal

Risk — Terracotta (risk/negative ONLY — never decorative)
  Risk          #C94B1A  — red alerts, flood zone, failed ITE
  Risk Light    #F5A07A  — soft risk tints

Caution — Amber (attention without emergency ONLY)
  Amber         #D4820A  — amber alerts, moderate risk
  Amber Light   #FBBF24  — soft amber fills

Neutral — Slate (all non-signalling text, borders, surfaces)
  Text          #1A2535  — body text
  Text Mid      #4A5D74  — secondary text, descriptions
  Text Light    #8A9BB0  — labels, placeholders, metadata
  Surface       #FFFFFF  — card/panel backgrounds
  Background    #F4F7FB  — page background (blue-grey tint, not pure white)
  Border        #DDE4EF  — card borders, dividers

Gold            #C9A84C  — Intelligence tier badge only, used sparingly
```

**TVI Ring colour logic:**
- 75–100: Emerald Bright arc
- 50–74: Amber arc
- 0–49: Risk arc

### Typography

Install these Google Fonts: **Playfair Display** + **DM Sans** + **DM Mono**

| Role | Font | Size | Weight |
|---|---|---|---|
| H1 page titles | Playfair Display | 48–56px | 700, letter-spacing -0.03em |
| H2 section titles | Playfair Display | 28–36px | 600 |
| Sub-headers / pull quotes | Playfair Display *Italic* | 22–28px | — |
| Body text | DM Sans | 15px | 400, line-height 1.6 |
| UI labels | DM Sans | 13px | 500 |
| Navigation | DM Sans | 12px | 600, uppercase, tracking 0.08em |
| Buttons | DM Sans | 14px | 600 |
| Price figures | DM Mono | 24–32px | 500 |
| Score numbers | DM Mono | 16–20px | 500 |
| Small data labels | DM Mono | 11px | 400 |

Use **Playfair Display Italic** for sub-headers, secondary callouts, and editorial statements. The italic carries warmth and authority together — it is non-negotiable.

### Spatial System

8px base unit. All spacing is a multiple of 8.

```
4px   — between inline elements (icon + label)
8px   — within component internal padding
16px  — between related items in a list
24px  — between distinct components within a section
32px  — between sections within a page
48px  — between major page sections
64px  — hero/feature vertical rhythm
```

### Border Radius

```
6px   — badges, pills, small inline elements
12px  — standard cards, input fields
18px  — large cards, panels
24px  — modals, floating panels
50%   — TVI rings (circular)
```

### Shadow System

Never pure black. Always navy-tinted:
```
Shadow SM    0 1px 4px rgba(13,43,78,0.08)   — subtle card lift
Shadow MD    0 4px 16px rgba(13,43,78,0.12)  — hovered cards, dropdowns
Shadow LG    0 12px 40px rgba(13,43,78,0.16) — modals, floating panels
Shadow XL    0 24px 80px rgba(13,43,78,0.20) — full-page drawers
```

### Surface Hierarchy

```
Tier 0 — #F4F7FB  (Background / page canvas)
Tier 1 — #F1F4F8  (surface-container-low / secondary content zones)
Tier 2 — #FFFFFF  (Surface / primary interactive cards)
```

Floating elements (modals, popovers): semi-transparent navy container at 80% opacity with 24px `backdrop-filter: blur(24px)`.

---

## 5. Core Components to Build

### 5.1 TVI Ring

The single most important visualisation on the platform. Every instance must look identical.

**Form:** Circular gauge, ~270° arc filling clockwise. Score number centred. "TVI" in tiny uppercase below score.

**Three sizes:**
```
XS  32px  — list rows
SM  52px  — property cards
LG  80px  — report header (main use on MVP)
```

**Animation:** Arc fills from 0 to score over 600ms using `cubic-bezier(0.34, 1.56, 0.64, 1)`. Plays once per page load per property. The springy easing makes it feel like the score "arrives with weight", not just appears.

**Colour:** Emerald Bright (75–100) / Amber (50–74) / Risk (0–49) — based on score value.

**Loading state:** Grey arc with pulsing shimmer animation.

**Pending state (some indicators still loading):** Arc shows partial score in Amber with subtle pulse. Label: "Calculating..."

Implementation hint: SVG with `stroke-dasharray` and `stroke-dashoffset` animation. The arc path covers 270° of a circle, starting at the bottom-left (225° from top). Use `stroke-linecap: round` for quality feel.

### 5.2 Alert Pills

Three types, visually distinct by colour + left border + icon:

```
Green  — positive finding / buy signal
  left border: 3px solid #34C97A
  background: rgba(52, 201, 122, 0.05)
  dot: 8px, Emerald Bright

Amber  — verify before proceeding
  left border: 3px solid #D4820A
  background: rgba(212, 130, 10, 0.05)
  dot: 8px, Amber

Red    — risk flag, serious concern
  left border: 3px solid #C94B1A
  background: rgba(201, 75, 26, 0.05)
  dot: 8px, Risk
```

**Anatomy:**
```
[Dot] [Title — DM Sans 13px 600]         [Source — DM Mono 11px Text Light]
[Description — DM Sans 12px Text Mid, max 2 lines, 1.4 line-height]
[What does this mean? ›  — expandable]
```

The "What does this mean?" expansion is critical. On click, it reveals inline (pushing content down — not a tooltip or modal): data source, what the number means in practice, what action to consider. 2–3 plain-English sentences.

### 5.3 Indicator Card

Anatomy for each of the 5 live indicators:

```
[Icon 20px] [Indicator name — DM Sans 14px 600]    [Score badge — DM Mono, right]
[Mini score bar — 6px height, coloured fill]
[Summary sentence — DM Sans 13px Text Mid — the MEANING, not the score]
[Supporting data — 2–3 label:value pairs in DM Mono 11px]
[● High confidence / ● Based on limited data]              [Expand ›]
```

**Score badge colours:** 70+: Emerald Bright / 40–69: Amber / 0–39: Risk
**Mini bar fill:** same colour logic as score badge

**Summary sentences per indicator (use these):**
- `health_security`: based on the nearest health centre distance and count, describe proximity quality
- `education_opportunity`: based on nearest school distance and count
- `structural_liability`: based on build year and EPC rating, assess repair levy risk
- `expat_liveability`: based on airport distance
- `true_affordability`: based on monthly total vs property price

**Confidence dot:** Green dot for `"confidence": "high"`, Amber for `"medium"`, grey for `"low"`.

**"Data coming soon" state (for the 10 missing indicators):** Greyed card with indicator name, lock icon if tier-gated, shimmer skeleton for the bar and data rows. Do not show a fake score.

**Locked state (Free tier — future, build the visual now):** Background is #F4F7FB (not white). Blur overlay over summary and data rows. Padlock icon top-right. Indicator name still visible. Value-driven copy per indicator (e.g., *"Unlock to see if you are overpaying by €20k+"*). The score badge is hidden entirely — not blurred. Partial visibility is intentional — users must understand what they're missing.

### 5.4 Pillar Score Bar

Used in the report's Pillar Scores section.

```
[Pillar Name — 130px, DM Sans 12px Text Mid]
[Track — flex-1, 6px height, Background colour, rounded]
[Fill — same height, coloured by score range]
[Score — 28px, DM Mono 12px 600, right-aligned]
```

Fill colours: 70+: Emerald Bright / 40–69: Amber Light / 0–39: Risk Light

**Stagger animation:** Each bar fills sequentially with 60ms delay between them when entering the viewport (use IntersectionObserver).

### 5.5 Skeleton Loading States

Every card must have a skeleton state that matches the actual card dimensions exactly — no layout shift when data arrives. Use a soft shimmer animation:

```css
/* Navy-tinted shimmer, not pure grey */
background: linear-gradient(
  90deg,
  rgba(221, 228, 239, 0.5) 25%,
  rgba(221, 228, 239, 0.9) 50%,
  rgba(221, 228, 239, 0.5) 75%
);
background-size: 200% 100%;
animation: shimmer 1.5s infinite;
```

---

## 6. Loading Pattern (D-022 — Phase 0 Fallback)

The `/api/analyse` endpoint returns everything in one response (~1–2s). We are not yet building true streaming infrastructure.

**For MVP (Phase 0 fallback — build this):**

On URL submission, the submit button transforms into a labelled step progress indicator:

```
[✓] Fetching listing...
[✓] Running spatial analysis...
[●] Calculating true monthly cost...  ← spinning indicator on last step
```

The three steps display sequentially with ~400ms artificial delay between them (fake progress — the real call is already in flight). Once the API responds, the full report renders.

This pattern was validated during CHI-327 testing and is acceptable at MVP. It sets expectations correctly and feels faster than a spinner.

**Full streaming (Phase 1 — defer):** True streaming where indicators populate progressively. TVI ring holds at partial score with amber pulse while True Affordability is pending. Do not build this now.

---

## 7. What to Build — Exact Scope

### 7.1 Analyse Page (`/analyse`)

**URL:** `/analyse`

**Layout:** Two-column on desktop (380px left sidebar / flexible right). Single column on mobile.

**Left sidebar — Input panel:**

- Section label: "Analyse a property" (DM Sans 12px uppercase tracking 0.08em, Text Light)
- Large URL input field. Placeholder: `idealista.com/inmueble/...`. `surface` (#FFFFFF) background, no 1px border — use a 2px focus ring of Navy Light (`#2A5490`) when active.
- **Phase 0 property form** (collapsible, open by default): Fields for lat, lng, price, area_sqm, municipio, build_year, epc_rating. These map directly to the `property` object in the API request. Label: "Property details (required until browser extension is live)"
- Submit button: Full-width, Navy Deep background, Emerald Bright text — "Analyse →" in DM Sans 14px 600. On click: transforms to step progress state (see D-022 section above).
- Recent analyses (below form): Compact list of last 3 items. Each row: truncated address, price in DM Mono, TVI ring XS, time ago. Source from `localStorage` — no auth needed at MVP.

**Right area — Report:**

- **Before any analysis:** Empty state. Headline in Playfair Display Italic: *"Paste a property link to see what Idealista won't tell you."* Below: 3 example insight cards (hardcoded) showing what the report reveals. Labels: "ITE Building Status", "True Monthly Cost", "Flood Risk Zone".
- **During analysis:** Step progress state (described above) centred in the right panel.
- **After analysis:** Full Hidden DNA Report (see 7.2).

### 7.2 Hidden DNA Report (inline on Analyse page, not a separate route at MVP)

**Structure:**

**A. Sticky property header (compresses on scroll)**

Full state:
```
[Address (or "Property Analysis" if no address yet) — Playfair Display 28px]
[Municipio, Provincia — DM Sans 13px Text Light]
[Price — DM Mono 24px]              [TVI Ring LG]
[Source URL — DM Sans 12px Text Light, truncated]
```

Compressed state (triggered at 80px scroll, 56px height):
```
[Address — DM Sans 14px 600]    [Price — DM Mono 14px]    [TVI Ring SM]
```

The compression is a smooth transition (200ms ease). Sticky top of viewport with `z-50`, Background colour, Shadow SM.

**B. Alert banner (below header, full width)**

All alerts from the `alerts` array. If empty, render nothing — no "no alerts found" messaging. Red alerts first, then Amber, then Green. On mobile: show top 2 + "Show all X alerts" expandable.

**C. Section 1: Financial Intelligence — "The real cost of this property"**

Three cards in a row (desktop), stacked (mobile):

1. **True Monthly Cost card** — data from `true_affordability.inputs`:
   ```
   Mortgage (30yr, standard 80%)    €X,XXX /mo   [DM Mono]
   IBI property tax                  €XX /mo
   Energy (climate-adjusted)         €XX /mo
   ─────────────────────────────────────────────
   Total estimated monthly           €X,XXX /mo   [larger, bolder]
   ```
   Show this data if `true_affordability` is present. Otherwise skeleton.

2. **Price Intelligence card** — `price_per_sqm` from property response:
   ```
   €X,XXX /sqm asking price    [DM Mono 24px]
   [Neutral label — "vs. Málaga median €X,XXX/sqm" — hardcode Málaga median for MVP]
   ```

3. **Property summary card** — from `property` in response:
   ```
   [build_year]  [area_sqm]m²  [epc_rating] EPC
   [municipio], [comunidad_autonoma]
   ```

**D. Section 2: Raiz Intelligence — "The 15 signals"**

Section header: Playfair Display 28px — *"The 15 signals"*. Sub-header in Playfair Display Italic 18px — *"What the listing doesn't tell you."*

Grid layout: 3 columns desktop / 2 tablet / 1 mobile.

Render one Indicator Card per indicator. For the 5 live indicators (`true_affordability`, `health_security`, `education_opportunity`, `structural_liability`, `expat_liveability`): full data. For the other 10: "Data coming soon" skeleton state (see component spec above).

Indicator display order (tier order, then pillar):
1. True Affordability (Tier 1, financial)
2. Health Security (Tier 1, lifestyle)
3. Education Opportunity (Tier 1, lifestyle)
4. Structural Liability (Tier 1, risk)
5. Expat Liveability (Tier 1, community)
6–15: Remaining indicators as "coming soon" placeholders — use these names:
   - Digital Viability, Community Stability, True Affordability (Price Trend), Climate & Solar, Transport Connectivity, Future Growth Signal, Rental Trap Index, Neighbourhood Trajectory, Infrastructure Debt, Market Timing

**E. Section 3: Pillar Scores**

Section header: "How this property scores"

Show 5 pillar bars (only pillars with at least one live indicator):
- Financial: score from `true_affordability`
- Lifestyle: average of `health_security` + `education_opportunity`
- Risk: score from `structural_liability`
- Community: score from `expat_liveability`
- Overall TVI: `tvi_score` from top-level

Use Pillar Score Bar component with stagger animation.

Below: small italic note — *"Overall TVI based on 5 of 15 signals. Full analysis available with more data."*

**F. Cache notice**

If `cached: true` in response: thin banner "Analysis from [formatted expires_at date] — refreshes automatically after 48 hours." In Text Light, no visual weight. Do not show this if `cached: false`.

---

## 8. Page / File Structure

Create these files (check existing structure first, only create what doesn't exist):

```
app/analyse/page.tsx           — Analyse page (Server Component wrapper)
app/analyse/AnalyseClient.tsx  — Client Component (form state, API call, report rendering)
components/ui/TVIRing.tsx       — TVI Ring component (XS/SM/LG variants)
components/ui/AlertPill.tsx     — Alert Pill component (green/amber/red)
components/ui/IndicatorCard.tsx — Indicator Card component
components/ui/PillarScoreBar.tsx — Pillar Score Bar component
components/ui/SkeletonCard.tsx  — Reusable skeleton loading card
```

Check the existing `components/` and `app/` structure before creating anything — there may already be UI components present. Build on what exists.

---

## 9. What to Defer

Do not build these at MVP:

- **Authentication** — no login/signup, no tier checks. All users see all 5 indicators. Locked states are built visually but not functionally enforced.
- **Parse.bot integration** — the form accepts manual property data. This is intentional and documented.
- **True streaming** (D-022 Phase 1) — use Phase 0 fallback step progress.
- **Comparison view** — not in scope for this session.
- **Browser extension** — not in scope.
- **Saved analyses persistence** — use `localStorage` only, no DB writes.
- **PDF export** — not in scope.
- **Map view** — not in scope.
- **Landing page** — not in scope. Focus entirely on `/analyse`.

---

## 10. Key Design Rules — Quick Reference

1. **No 1px structural borders.** Hierarchy = tonal shifts.
2. **Emerald means opportunity. Terracotta/Risk means danger. Never decorative.**
3. **Playfair Display for editorial statements and headers. DM Sans for UI. DM Mono for numbers.**
4. **Use Playfair Display Italic** for sub-headers and secondary callouts — this is a brand decision, not optional.
5. **TVI Ring animation:** 600ms, `cubic-bezier(0.34, 1.56, 0.64, 1)`. No exceptions.
6. **Shadows are navy-tinted, not black.** Always `rgba(13,43,78,X)`.
7. **Background is `#F4F7FB`, not `#F5F5F5` or pure white.**
8. **Every state must be handled:** loading, empty, error, cached.
9. **Locked indicator cards:** indicator name visible, score badge hidden entirely, blur over data rows, value-driven copy (not "Upgrade to Pro").
10. **Spacing is multiples of 8.** No arbitrary values.

---

## 11. Test API Call

Use this curl command to verify the API is working before building:

```bash
curl -s -X POST https://qolify.vercel.app/api/analyse \
  -H "Content-Type: application/json" \
  -d @/tmp/test-property.json
```

Create `/tmp/test-property.json`:
```json
{
  "url": "https://www.idealista.com/inmueble/99999/",
  "property": {
    "lat": 36.720,
    "lng": -4.420,
    "price_asking": 350000,
    "area_sqm": 90,
    "comunidad_autonoma": "Andalucía",
    "municipio": "Málaga",
    "build_year": 1995,
    "epc_rating": "D"
  }
}
```

Expected: 200 response with `tvi_score: 72`, five indicators, `health_security.score: 60`, `education_opportunity.score: 70`, `expat_liveability.score: 98`.

**Note on JSON in curl:** Always write the body to a file and use `-d @file`. Never inline JSON in a curl command.

---

## 12. Context: Current Project State

- Phase 0 validation passed (CHI-327). All 5 indicators return expected scores.
- `lib/db.ts` uses session pooler (port 5432) — this is correct. Transaction pooler (port 6543) is TCP-blocked from Vercel lhr1.
- The `analysis_cache` table has a 48h TTL. The `property_price_history` table logs every analysis.
- `app/api/analyse/route.ts` is clean and production-ready — do not modify it.
- Linear workspace: https://linear.app/chimeopen (team: CHI). File any non-trivial bugs there.
- GitHub: https://github.com/thomascarson87/qolify
- Supabase: https://btnnaoitbrgyjjzpwoze.supabase.co
