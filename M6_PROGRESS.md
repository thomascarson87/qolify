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

- CHI-400 — Ingest municipio_income from INE Atlas de Renta · ⏸
- CHI-401 — Fix True Affordability card · ⏸ (blocked by CHI-400)

## Phase 3 — Rental data

- CHI-402 — Ingest rental_benchmarks · ⏸

## Phase 4 — National spatial data

- CHI-394 — SNCZI flood zones · ⏸
- CHI-395 — CNMC fibre coverage · ⏸
- CHI-372 / CHI-390 — EEA noise zones · 🚧 (started pre-M6)

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
