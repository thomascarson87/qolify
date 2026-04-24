# M6 — Data Enrichment & Indicator Depth · Progress

Tracks sprint progress against the CHI issues in the M6 working prompt. Updated after each ticket.

---

## Status legend

- ✅ done
- 🚧 in progress
- 🟥 blocked (see note)
- ⏸ not started

---

## Phase 1 — Silent pipeline bugs

### CHI-405 — Fix 4 pipeline data quality bugs · ✅

DB investigation showed 3 of the 4 reported bugs were already fixed in recent commits. Actual work this sprint:

1. **property_price_history write** · ✅ — INSERT was already correct against schema; table holds 15 rows, ≥1 per analysis_cache entry. No column mismatch. No change needed.
2. **municipios.comunidad + provincia** · ✅ — `ingest_municipios.py` had already populated 8,340 / 8,340 with comunidad + provincia mapped from the 2-digit INE prefix. Deleted 1 orphan row (INE 53053 "Comunidad de Soto de la Vega y Villazala" — a Mancomunidad, not a municipio) that would have polluted nearest-centroid reverse-geocode lookups. Final count: 8,339 rows, 0 nulls.
3. **analysis_cache null municipio/provincia** · ✅ — last 5 analyses (Apr 1–16) already had correct reverse-geocode. The 4 older rows with nulls were backfilled via PostGIS nearest-centroid join on `municipios`. Also corrected 1 row where `provincia = "Andalucía"` (a comunidad had leaked into the provincia column). Final: 0 null municipio, 0 null provincia across all 10 rows. 2 rows still null `codigo_postal` because they're in Córdoba/Vélez-Málaga, outside the loaded `postal_zones` MVP coverage (29001–29017) — this is a postal_zones coverage gap, not a pipeline bug. Tracked separately.
4. **Expat Liveability ROW_NUMBER cast** · ✅ — the production edge function (`supabase/functions/analyse-job/index.ts`) was already casting `r.rn` with `Number()` in JS; recent analyses show `expat_score: 98, nearest_airport: AGP` correctly. But the parallel `lib/indicators/expat-liveability.ts` copy still had the literal `r.rn === 1` bug (postgres returns BIGINT as a JS BigInt/string, failing strict equality). Fixed both files: added `::int` SQL cast on `ROW_NUMBER()` AND `Number(r.rn)` JS cast — defence-in-depth so future imports of `lib/indicators/` don't silently regress.

**Files touched:**
- `lib/indicators/expat-liveability.ts`
- `supabase/functions/analyse-job/index.ts`

**Known limitations left for later tickets:**
- `true_affordability.score` is null in every analysis_cache row — this is CHI-400 (municipio_income ingest) + CHI-401 (True Affordability wiring), not in scope for CHI-405.
- `postal_zones` only covers Málaga 29001–29017. National postal-zone coverage is a separate task (not in M6 prompt).

---

## Phase 2 — Income data (True Affordability)

### CHI-400 — Ingest municipio_income from INE Atlas de Renta · ✅

Wrote `scripts/ingest/ingest_municipio_income.py`. Streams the full INE ADRH CSV (table 30824 — "Renta neta media por persona"), filters to municipio-level rows, parses European number format, and upserts the latest year per municipio.

**Result:** 8,126 municipios loaded, latest year 2023, income range €6,958–€30,524 (national avg €14,494). Effectively full coverage vs the ~8,340 municipios in the `municipios` reference table.

### CHI-401 — Fix True Affordability card · ✅

Three changes shipped together:

1. **P0 DECIMAL-string bug fix.** `postgres.js` returns DECIMAL columns as strings. `row.ecb_base_rate_pct + row.typical_bank_spread_pct` was doing `"3.400" + "1.200" = "3.4001.200"`, then `/100 = NaN`, so `aff_score` was null on every analysis. Wrapped every DECIMAL read with `Number()` in both `lib/indicators/true-affordability.ts` and the edge function's inlined `calcTrueAffordability`.

2. **Real income wiring.** Added an `income` CTE joining `municipio_income` by 5-digit INE code (primary) or municipio name (fallback). Replaced the hardcoded `/2000` proxy denominator with the actual local monthly income. Exposes `local_income_annual_eur`, `local_income_year`, `income_source`, `price_to_income_ratio`, and `cost_to_income_ratio` in `details`. Confidence now reflects local-data availability (`high` = local income + climate, `medium` = local income only, `low` = fallback).

3. **UI card update.** `ResultView.tsx` Financial Intelligence card now lists comunidad fees alongside mortgage/IBI/energy and renders a second block with local median income, price-to-income multiple, and cost-to-income %, footnoted with the INE source year. Falls back gracefully to the national estimate flag when no municipio row exists.

**Pipeline wiring:** also updated `supabase/functions/analyse-job/index.ts` reverse-geocode step to populate `prop.municipio_code` from `municipios.municipio_code` so the CTE can match by INE code even when name strings differ (e.g. València vs Valencia).

**Edge function redeployed** to `btnnaoitbrgyjjzpwoze` after changes.

## Phase 3 — Rental data

- CHI-402 — Ingest rental_benchmarks · ⏸

## Phase 4 — National spatial data

- CHI-394 — SNCZI flood zones · ⏸
- CHI-395 — CNMC fibre coverage · ⏸
- CHI-318 — CNMC fibre coverage seed · ✅
- CHI-393 — mobile_coverage table + CNMC 4G/5G seed · ✅
- CHI-372 / CHI-390 — EEA noise zones · 🚧 (started pre-M6)

### CHI-318 — CNMC fibre coverage seed · ✅

`fibre_coverage` held 1 polygon (stale Málaga bbox) → Digital Viability was "unavailable" everywhere else.

Shipped a DB-driven seed (`scripts/ingest/seed_fibre_municipios.py`) built on `municipios.geom` centroids + PostGIS buffers — no hand-tuned bboxes. 69 polygons now cover:
- **30 Tier-1** (FTTP 1000 Mbps) — all provincial capitals + top-5 cities
- **22 Tier-2** (FTTP 600 Mbps) — Madrid/Barcelona satellites + major coastal
- **17 Tier-3** (FTTP 300 Mbps) — Costa del Sol / Blanca / Brava / Balearics / Canarias expat hubs

Buffer radii tuned by city size (2–8 km) — urban core only, not rural farmland. Idempotent: `source='seed_municipios_v1'` delete-then-insert so re-running reshapes rather than duplicates.

Verified: Málaga centre (36.72, -4.42) → FTTP 1000 Mbps; Madrid Salamanca → FTTP 1000 Mbps; Ronda (not seeded) → no coverage. Digital Viability card now populates for all 69 cities.

Follow-ups (out of scope):
- Per-property SETELECO lookup (CHI-395 — supersedes this seed, gives exact coverage at analysis time).
- Mobile 4G/5G coverage (CHI-393 — now shipped, see below).

### CHI-393 — mobile_coverage (4G/5G) · ✅

New `mobile_coverage` table (migration `017_mobile_coverage.sql`) — same GEOGRAPHY(POLYGON, 4326) shape as `fibre_coverage` plus a `technology` check (3G/4G/5G).

**Seeded via `scripts/ingest/seed_mobile_coverage.py`:**
- 8,339 × 4G polygons (5 km buffer around every municipio centroid — CNMC 2024 reports >99% population 4G, so we treat it as national baseline).
- 52 × 5G polygons (Tier-1 + Tier-2 urban cores from the CHI-318 fibre list, 2.5–8 km tier-aware buffers).
- 2 × manual gap-fill rows for Palma de Mallorca + Córdoba (both missing from the `municipios` table — known ingest defect, also gap-filled in `fibre_coverage`).

**Indicator wiring — Digital Viability (both `lib/indicators/digital-viability.ts` and the edge function):**
- Added `mobile` CTE (`BOOL_OR(technology='5G')`, `BOOL_OR(technology='4G')`).
- New scoring: `max(fibreScore, mobileScore)` then + cowork bonus. Mobile fallback: `5G → 75`, `4G → 40`.
- Score is no longer null when fibre data is missing but 5G/4G is present — confidence becomes `medium`.
- Alerts refined: "No fibre — 5G available" (amber), "No fibre — 4G only" (amber), "No broadband coverage" (red) replace the single fibre-only red flag.

**Card / DNA Report:** `lib/indicators/registry.ts` adds a `Mobile` row (5G / 4G / —) and the summarise string surfaces mobile as either a fallback or a backup. No custom `ResultView` code for Digital Viability, so the card picks up the new row automatically.

**Verified at sample coords:** Madrid Salamanca → FTTP + 5G; Málaga centre → FTTP + 5G; Palma → FTTP + 5G (via manual row); Extremadura farmland → no fibre but 4G; Ronda → unavailable (expected — no seed).

**Edge function redeployed** (`analyse-job`) after the index.ts change.

**Known gaps (not blocking):**
- 4G buffer radius (5 km centroid) doesn't cover the full footprint of the largest municipios (Madrid, Barcelona, Sevilla), so some deep-suburbia points show 5G-only rather than 5G+4G. Harmless — 5G present implies 4G in reality, and the indicator falls back correctly.
- True per-operator coverage (Movistar/Vodafone/Orange/MásMóvil/Yoigo) requires the CNMC shapefile download workflow — not yet automated; the seed writes aggregate `multi_operator` rows.
- `municipios` table is missing Palma + Córdoba (and leaks Portuguese municipios into provincia='Córdoba'). Filed as follow-up.

## Phase 5 — Health data

- CHI-375 — Health waiting times · 🚧 (started pre-M6)
- CHI-385 — Health centres national load · ⏸
- CHI-391 — Health Security card redesign · ⏸

## Phase 6 — Education data

- CHI-373 — School quality enrichment · 🚧 (started pre-M6)
- CHI-392 — Education card redesign · ⏸

## Phase 7 — Safety / Crime / Environment cards

- CHI-320 — MIR crime stats ingest · ⏸
- CHI-398 — Safety card redesign · ⏸
- CHI-399 — Environmental card redesign · ⏸

## Phase 8 — Remaining enrichment

- CHI-407 — Full AEMET climate coverage · ⏸
- CHI-403 — Seed infrastructure_projects · ⏸
- CHI-397 — VUT licences · ⏸
- CHI-396 — ITE status · ⏸
- CHI-406 — Walk Score + Transport card · ⏸
- CHI-404 — Expat Liveability + cost of living wiring · ⏸ (blocked by CHI-376)

## Phase 9 — Validation gate

- CHI-408 — 10-property validation gate · ⏸
