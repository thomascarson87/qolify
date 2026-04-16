# CLAUDE.md — Qolify

Read this file first, then read **only** the reference files listed under your current task. Do not load any other MD files.

---

## What is Qolify?

Spanish property intelligence platform. Users paste an Idealista URL → system extracts property data via Parse.bot → runs 15 composite indicators → renders the DNA Report.

**Core principle:** The DNA Report is the product. The map is one section within it, not the frame around everything.

---

## The Builder

Thomas is the product owner, not a software engineer. He relies on Claude Code for all implementation.

- Review the plan with Thomas before writing code
- Write clear, commented code — explain what each file/function does
- Never delete or overwrite working code without explicit instruction
- When in doubt, ask

---

## Project Location & Resources

| Resource | Value |
|---|---|
| Project root | `/Users/thomascarson/Desktop/Qolify` |
| GitHub | https://github.com/thomascarson87/qolify |
| Supabase URL | https://btnnaoitbrgyjjzpwoze.supabase.co |
| Supabase ref | `btnnaoitbrgyjjzpwoze` |
| Linear | https://linear.app/chimeopen — team `CHI` |

**Env vars (in `.env.local` only — never commit):**
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
DATABASE_URL
DATABASE_URL_POOLER
SUPABASE_SERVICE_ROLE_KEY
AEMET_API_KEY
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
CRON_SECRET
ANTHROPIC_API_KEY
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router) + Tailwind CSS v4 |
| Map | MapLibre GL JS |
| Database | Supabase (PostgreSQL + PostGIS) |
| Auth | Supabase Auth |
| API | Next.js API Routes on Vercel |
| Extraction | Parse.bot |
| Rate limiting | Upstash Redis |
| Payments | Stripe |
| Deployment | Vercel |

---

## Codebase Map

```
app/
  page.tsx                          ← Homepage (URL paste entry point)
  layout.tsx                        ← Root layout
  analyse/
    page.tsx                        ← Analyse page shell
    AnalyseClient.tsx               ← Client-side analyse form
    [jobId]/
      page.tsx                      ← Job result page
      ResultView.tsx                ← DNA Report renderer
  map/
    page.tsx                        ← Map explorer page
    MapClient.tsx                   ← MapLibre canvas
    MapWrapper.tsx                  ← Map shell with panels
    AddressSearch.tsx               ← Address search input
    OverlayToolbar.tsx              ← Bottom overlay toggle bar
    report/                         ← Deep-dive report sub-pages
      zone/[postcode]/page.tsx
      education/[postcode]/page.tsx
      community/[postcode]/page.tsx
      solar/[ref_catastral]/page.tsx

  api/
    analyse/route.ts                ← POST: trigger analysis job
    analyse/status/route.ts         ← GET: poll job status
    catastro/route.ts               ← GET: Catastro OVC lookup
    cron/zone-metrics/route.ts      ← Nightly zone aggregation
    map/
      amenities/route.ts            ← GET: amenities in radius
      layer/route.ts                ← GET: map point layers
      pin/route.ts                  ← POST: pin-drop analysis
      pin/save/route.ts             ← POST: save pin
      overlay/flood/route.ts        ← GET: flood zone polygons
      overlay/solar/route.ts        ← GET: solar overlay
      zone/[codigo_postal]/route.ts ← GET: zone detail

components/
  map/
    PinReportPanel.tsx              ← Right-side pin intel panel
    ZoneDetailPanel.tsx             ← Zone click detail panel
    FinancialBreakdown.tsx          ← Financial section
    FloodSafetySection.tsx          ← Flood risk display
    ProximitySummary.tsx            ← Amenity proximity list
    CommunityCharacterSection.tsx   ← Community/VUT section
    StatusBadgeGrid.tsx             ← Alert badge grid
    SunshineBarChart.tsx            ← Solar bar chart
    TrendSparkline.tsx              ← Trend line chart
  report/
    SolarPotentialCard.tsx          ← Solar indicator card
  ui/
    AlertPill.tsx                   ← Alert badge component
    IndicatorCard.tsx               ← Indicator card (4 states)
    PillarScoreBar.tsx              ← Score bar component
    SkeletonCard.tsx                ← Loading skeleton
    TVIRing.tsx                     ← TVI score ring

lib/
  indicators/                       ← Composite indicator calculators
    index.ts                        ← Exports all indicators
    registry.ts                     ← Indicator registry
    types.ts                        ← Shared TypeScript types
    true-affordability.ts
    structural-liability.ts
    solar-potential.ts
    health-security.ts
    education-opportunity.ts
    community-stability.ts
    expat-liveability.ts
    cost-of-life-index.ts
    daily-life-score.ts
    sensory-environment.ts
  supabase/
    client.ts / server.ts / middleware.ts
  db.ts                             ← DB query helpers
  analysePoller.ts                  ← Job status polling
  consequence-statements.ts         ← Plain-English implications
  amenity-categories.ts             ← Amenity display config
  theme.ts                          ← Theme tokens

actions/
  generateAreaSummary.ts            ← AI area summary (Claude API)
  generateEducationNarrative.ts     ← AI education narrative
  generateZoneNarrative.ts          ← AI zone narrative

supabase/
  functions/analyse-job/index.ts    ← Edge Function: analysis pipeline
```

---

## Key Routes

| URL | What it does |
|---|---|
| `/` | Homepage — URL paste input |
| `/analyse` | Analysis page with input form |
| `/analyse/[jobId]` | DNA Report for a completed job |
| `/map` | Map explorer |
| `/map/report/zone/[postcode]` | Zone deep-dive |
| `/map/report/education/[postcode]` | Education deep-dive |
| `/map/report/solar/[ref_catastral]` | Solar deep-dive |
| `/map/report/community/[postcode]` | Community deep-dive |

---

## Design Tokens (never deviate from these)

| Token | Value |
|---|---|
| Primary font (headings) | Playfair Display |
| UI font (body/labels) | DM Sans |
| Data font (numbers) | DM Mono |
| Navy | `#0D2B4E` |
| Emerald | `#34C97A` |
| Amber | `#D4820A` |
| Risk/Terracotta | `#C94B1A` |
| Surface | `#F7FAFE` |

---

## Absolute Rules

1. **Never hardcode secrets.** Keys in `.env.local` or Vercel env vars only.
2. **Never modify the DB schema without updating `MD files/SCHEMA.md`.** Migrations must match exactly.
3. **Always check tier gating.** Every route serving Pro/Explorer/Intelligence data must verify the Supabase JWT `tier` claim.
4. **PostGIS for all spatial queries.** Never calculate distances in application code.
5. **Every indicator card must handle 4 states:** `loaded | loading | unavailable | locked`. See `MD files/INDICATOR_CARD_SPEC.md`.
6. **Never ship broken UI.** If data is unavailable, show the UNAVAILABLE state. Never show null values, empty cards, or zero where zero is meaningless.

---

## Task-Scoped Reference Files

Read **only** the files relevant to your current task:

| Task | Read these files |
|---|---|
| Indicator card work | `MD files/INDICATOR_CARD_SPEC.md` |
| Any DB query or schema change | `MD files/SCHEMA.md` |
| Report page layout | `MD files/REPORT_PAGE_SPEC.md` |
| Map work | `MD files/MAP_MVP_SPEC_PATCH_v2_1.md` |
| Tier/feature gating | `MD files/TIERS.md` |
| Composite indicator logic | `MD files/INDICATORS.md` |
| Data sources / ingest scripts | `MD files/DATA_SOURCES.md` |
| Climate/solar calculations | `MD files/ANNEX_WEATHER_SOLAR.md` |
| Past decisions and rationale | `MD files/DECISIONS.md` |
| Phase scope and acceptance criteria | `MD files/ROADMAP.md` |

---

## Development Commands

```bash
npm run dev      # dev server (Turbopack — run in your own terminal)
npm run build    # production build
npm run lint     # ESLint
```

---

## Issue Tracking

File a Linear issue for any serious or repeating failure — before or immediately after fixing it.

- Team: `CHI`, project: `Chimeopen`
- Priority: High (2) for data correctness bugs, Normal (3) for performance
- Description: symptom · root cause · fix required · acceptance criteria
