# INDICATOR_CARD_SPEC.md
# Qolify — Indicator Card Component Specification
# DNA Report · Four-State Rendering Standard · v1.0

**Purpose:** Define the exact render output for every DNA Report indicator card across four data states. Authoritative build specification for Claude Code. No additional interpretation required.

**Scope:** All 15 composite indicators in the DNA Report. Pin Intel triage card states. Map pin radial amenity mini-map card.

---

## 1. Core Design Principles

### 1.1 Every card must render in exactly four states

| State | Trigger condition | Visual treatment |
|---|---|---|
| **LOADED** | All required DB fields present and non-null | Full card: verdict badge + number + implication |
| **LOADING** | Analysis job in progress (`status = processing`) | Skeleton shimmer animation, no data shown |
| **UNAVAILABLE** | Required DB field is null or source API failed | Muted card with "Data unavailable" + source note |
| **LOCKED** | User tier does not include this indicator | Blurred content + padlock icon + upgrade prompt |

### 1.2 Every LOADED card must surface three layers

| Layer | Format | Example |
|---|---|---|
| **1 — VERDICT** | Single word + colour badge | "CAUTION" amber badge |
| **2 — DATA** | Number or short fact, DM Mono font | `12.4% below market avg` |
| **3 — IMPLICATION** | One plain-English sentence max | "Expect €40k–60k negotiation room before offer." |

### 1.3 Verdict badge colour logic

| Badge | Hex | When to use |
|---|---|---|
| **GOOD ✓** | `#34C97A` | Score ≥ 70, or indicator confirms a positive signal |
| **CAUTION ⚠** | `#D4820A` | Score 40–69, or indicator signals a risk worth noting |
| **RISK ✗** | `#C94B1A` | Score < 40, or indicator confirms a blocking risk |
| **UNAVAILABLE** | `#4A5D74` | Required DB source is null — show grey, never blank |

---

## 2. Indicator Card Specifications

Each indicator specifies: DB source columns, verdict thresholds, display text for all four states, and tier gating. Column names reference `public.composite_indicators` and `public.analysis_cache` exactly as defined in `SCHEMA.md`.

---

### Indicator 1 — True Affordability

| Field | Value |
|---|---|
| **Tier gating** | Tier 1 — visible to all users |
| **DB columns** | `composite_indicators.true_affordability_score` · `true_affordability_monthly_eur` |
| **Section in report** | Financial Anatomy — primary hero card |

| State | What renders | DB source | Edge / fallback |
|---|---|---|---|
| LOADED | Verdict badge + `€X/month true cost` in mono + implication | `true_affordability_score` · `true_affordability_monthly_eur` | — |
| LOADING | Shimmer skeleton — badge placeholder + 2 line placeholders | — | — |
| UNAVAILABLE | "True cost data unavailable. Mortgage estimate requires price and area." + grey badge | `true_affordability_monthly_eur IS NULL` | Show partial if only score is null — still render the monthly figure |
| LOCKED | N/A — Tier 1 is never locked | — | — |

**Verdict logic:** GOOD if score ≥ 70 · CAUTION if 40–69 · RISK if < 40

**Implication template:** `"Monthly ownership cost of €[X] is [X]% [above / below] equivalent rent in this postcode."`

**Data dependency:** `eco_constants` (current Euribor, electricity rate) · `rental_benchmarks` · `analysis_cache.price_asking`

---

### Indicator 2 — Negotiation Gap

| State | What renders | DB source | Edge / fallback |
|---|---|---|---|
| LOADED | Diamond gauge + `−X.X% vs market` in mono + implication | `analysis_cache.negotiation_gap_pct` | — |
| LOADING | Shimmer gauge bar + 2 line placeholders | — | — |
| UNAVAILABLE | "No comparable sales data for this postcode." + grey badge. Show list price only. | `negotiation_gap_pct IS NULL` | Minimum viable: show price/m² from `analysis_cache` even if gap is null |
| LOCKED | N/A — Tier 1 | — | — |

**Verdict logic:** GOOD if gap ≤ −5% (underpriced) · CAUTION if −5% to +5% · RISK if > +5% (overpriced)

**Implication template:** `"Listing is [X]% [above / below] comparable sales. Expected close range: €[low]–€[high]."`

---

### Indicator 3 — ITE Building Health

| State | What renders | DB source | Edge / fallback |
|---|---|---|---|
| LOADED | Status word (PASSED / FAILED / PENDING) in large mono + inspection date + implication | `ite_status.status` · `ite_status.inspection_date` · `ite_status.due_date` | — |
| LOADING | Shimmer — large text placeholder + date placeholder | — | — |
| UNAVAILABLE | "ITE record not found for this address. Verify directly with the Ayuntamiento." + grey badge | `ite_status` JOIN by `ref_catastral` returns null | Attempt lookup by address if `ref_catastral` is null |
| LOCKED | N/A — Tier 1 | — | — |

**Verdict logic:** GOOD = passed · CAUTION = pending or due within 12 months · RISK = failed

**Implication template (FAILED):** `"Building inspection failed. Structural remediation required before [due_date]. Factor repair liability into offer."`

**Implication template (PENDING):** `"Inspection due [due_date]. If failed, seller must resolve before completion or price must reflect risk."`

**DB lookup:**
```sql
SELECT * FROM ite_status
WHERE ref_catastral = $1
OR (lat BETWEEN $lat-0.001 AND $lat+0.001 AND lng BETWEEN $lng-0.001 AND $lng+0.001)
```

---

### Indicator 4 — Flood Risk

> **⚠ CRITICAL: This card must NEVER be locked or hidden regardless of tier. If flood data is unavailable, show UNAVAILABLE state explicitly.**

| State | What renders | DB source | Edge / fallback |
|---|---|---|---|
| LOADED | `"NOT IN FLOOD ZONE ✓"` or `"T10 FLOOD ZONE ✗"` in large text + risk period + insurance implication | `flood_zones` (PostGIS point-in-polygon on `analysis_cache.geom`) | — |
| LOADING | Shimmer — binary status placeholder | — | — |
| UNAVAILABLE | "Flood zone data could not be retrieved. Check SNCZI directly before proceeding." + grey badge | PostGIS query fails or returns no coverage polygon | NEVER show blank — always UNAVAILABLE state |
| LOCKED | **N/A — flood risk is safety-critical and never gated** | — | — |

**Verdict logic:** GOOD = no T10/T100/T500 intersection · RISK = T10 intersection · CAUTION = T100 or T500 only

**Implication template (T10):** `"This address falls within a 10-year return flood zone. Expect significantly higher insurance premiums and potential financing restrictions."`

**PostGIS query:**
```sql
SELECT risk_level FROM flood_zones
WHERE ST_Contains(geom, ST_SetSRID(ST_Point($lng, $lat), 4326))
ORDER BY risk_level LIMIT 1
```

---

### Indicator 5 — Energy Certificate (EPC)

| State | What renders | DB source | Edge / fallback |
|---|---|---|---|
| LOADED | A–G bar chart with current rating highlighted + potential rating + annual CO₂ + grant eligibility note | `analysis_cache.epc_rating` · `analysis_cache.epc_potential` | — |
| LOADING | Shimmer bar chart | — | — |
| UNAVAILABLE | "Energy certificate not registered. Seller is legally required to provide this before sale." + grey badge | `epc_rating IS NULL` | — |
| LOCKED | N/A — Tier 1 | — | — |

**Verdict logic:** GOOD = A or B · CAUTION = C or D · RISK = E, F, or G

**Implication template:** `"Rated [X]. Upgrading to [potential] could save approximately €[annual_saving] annually and unlock €[grant] in renovation grants."`

---

### Indicator 6 — VUT Density (Tourist Rental Saturation)

| State | What renders | DB source | Edge / fallback |
|---|---|---|---|
| LOADED | Block grid visualisation (X% filled = VUT) + percentage label + residential implication | `composite_indicators.community_stability_score` · `vut_licences` count via `ST_DWithin(200m)` | — |
| LOADING | Shimmer block grid | — | — |
| UNAVAILABLE | "Tourist licence data not available for this area." + grey badge | VUT count query returns null | — |
| LOCKED | Pro+ — Free users see blurred grid + "Unlock Community Intelligence" | — | — |

**Verdict logic:** GOOD = < 10% VUT within 200m · CAUTION = 10–25% · RISK = > 25%

**Implication template:** `"[X]% of nearby units are registered tourist rentals. [High: This building may have a transient community and above-average noise. / Low: Predominantly residential — stable community expected.]"`

**PostGIS query:**
```sql
SELECT COUNT(*) FROM vut_licences
WHERE ST_DWithin(geom, ST_SetSRID(ST_Point($lng,$lat),4326)::geography, 200)
```

---

### Indicator 7 — Neighbourhood Transition Index (NTI)

| State | What renders | DB source | Edge / fallback |
|---|---|---|---|
| LOADED | NTI signal badge (PRIME BUY / STABLE / TOO LATE / RISK) + score + plain-English signal description | `composite_indicators.neighbourhood_transition_index` · `composite_indicators.nti_signal` | — |
| LOADING | Shimmer badge + 2 line placeholders | — | — |
| UNAVAILABLE | "Insufficient historical data to calculate NTI for this postcode." + grey badge | `nti_signal IS NULL` or `zone_metrics_history` has < 8 weeks of data | — |
| LOCKED | Pro+ only — Free sees "Neighbourhood trajectory hidden" with blur overlay | — | — |

**Signal values:** `prime_buy` · `too_late` · `stable` · `risk` (from `composite_indicators.nti_signal`)

**Colour mapping:** prime_buy = Emerald GOOD · stable = Slate neutral · too_late = Amber CAUTION · risk = Terracotta RISK

**Implication template:** `"This area is classified as [signal]. [prime_buy: Gentrification indicators are active — early-mover pricing window may be closing. / stable: Consistent residential character. Low speculative risk. / too_late: Prices have already reflected the uplift. / risk: Declining amenity and occupancy signals detected.]"`

---

### Indicator 8 — ICO Aval Eligibility

| State | What renders | DB source | Edge / fallback |
|---|---|---|---|
| LOADED | `"ELIGIBLE ✓"` or `"NOT ELIGIBLE"` in large text + criteria checklist + mortgage calculator link | `ico_caps` (lookup by `comunidad_autonoma`) · `analysis_cache.price_asking` vs `ico_caps.max_price_eur` | — |
| LOADING | Shimmer eligibility status + checklist shimmer | — | — |
| UNAVAILABLE | "ICO eligibility requires property price and location. Add these to complete this check." + inline prompt | `analysis_cache.price_asking IS NULL` or `comunidad_autonoma IS NULL` | Show inline slim field — never a separate form |
| LOCKED | N/A — Tier 1 | — | — |

**Eligibility check:** `price_asking ≤ ico_caps.max_price_eur` AND `buyer_age ≤ ico_caps.max_age` AND `property_type ≠ investment`

**Implication template (eligible):** `"This property qualifies for the ICO 20% guarantee, enabling 95% financing. Estimated monthly saving vs standard mortgage: €[X]."`

**Implication template (not eligible):** `"Price exceeds the €[cap] ICO cap for [comunidad]. Standard 80% LTV financing applies."`

---

### Indicator 9 — Solar Potential

| State | What renders | DB source | Edge / fallback |
|---|---|---|---|
| LOADED | Annual yield in kWh + annual saving in € + payback years + confidence badge | `solar_potential.annual_kwh_yield` · `solar_potential.annual_saving_eur` · `solar_potential.payback_years` · `solar_potential.confidence` | — |
| LOADING | Shimmer — 3 number placeholders + confidence badge placeholder | — | — |
| UNAVAILABLE | "Solar data not yet calculated for this property." + grey badge + raw GHI if available | `solar_potential` JOIN on `ref_catastral` returns null | Fall back to `solar_radiation` table using `ST_DWithin` on coordinates |
| LOCKED | Pro+ only | — | — |

**Verdict logic:** GOOD if `annual_saving_eur ≥ 800` · CAUTION if 400–799 · LOW if < 400 or `confidence = low`

**Implication template:** `"Estimated [X] kWh annual yield. System pays back in [Y] years. Annual energy saving: €[Z]."`

**Confidence display:** Always show confidence badge. `confidence = low` triggers: `"Estimate based on zone-level data — building-specific figure requires Catastro footprint."`

---

### Indicator 10 — Air Quality

| State | What renders | DB source | Edge / fallback |
|---|---|---|---|
| LOADED | AQI category badge + annual average value + 12m trend arrow + health implication | `composite_indicators.aqi_annual_avg` · `composite_indicators.aqi_category` · `composite_indicators.aqi_score` | — |
| LOADING | Shimmer badge + value placeholder | — | — |
| UNAVAILABLE | "No air quality monitoring station within usable range of this address." + grey badge | `aqi_annual_avg IS NULL` | — |
| LOCKED | Pro+ only | — | — |

**Verdict logic:** `bueno` / `razonable` = GOOD · `regular` = CAUTION · `malo` / `muy_malo` = RISK

**Implication template:** `"Annual average AQI is [value] ([category]). [GOOD: Air quality meets EU standards. / CAUTION: Occasional exceedances recorded. / RISK: Regularly exceeds safe limits — consider health implications, especially for children.]"`

---

### Indicator 11 — Digital Connectivity (Fibre)

| State | What renders | DB source | Edge / fallback |
|---|---|---|---|
| LOADED | `"FULL FIBRE ✓"` or `"NO FIBRE ✗"` + speed + operator + `coverage_type` badge | `composite_indicators.digital_viability_score` · `fibre_coverage` (PostGIS point-in-polygon) | — |
| LOADING | Shimmer connectivity status | — | — |
| UNAVAILABLE | "Fibre coverage data not available for this address. Check CNMC broadband map." + grey badge | PostGIS query on `fibre_coverage` returns null | — |
| LOCKED | N/A — Tier 1 | — | — |

**Verdict logic:** GOOD = FTTP · CAUTION = FTTC or HFC · RISK = none

**Implication template:** `"[FTTP: Full-fibre available — up to [X] Mbps. / FTTC: Partial fibre — actual speeds may be significantly lower. / none: No fibre available — a constraint for remote workers.]"`

---

### Indicator 12 — School Catchment & Education

| State | What renders | DB source | Edge / fallback |
|---|---|---|---|
| LOADED | Catchment school name + type badge + distance + rating score + bilingual flag | `school_catchments` (PostGIS point-in-polygon) · `schools.nombre, tipo, rating_score, bilingual_languages` | — |
| LOADING | Shimmer — school name + distance placeholder | — | — |
| UNAVAILABLE | "School catchment boundary data not available. Check with the local Ayuntamiento de Educación." + grey badge | `ST_Contains` on `school_catchments` returns null | Fall back to nearest school by `ST_DWithin` |
| LOCKED | Pro+ only — Free sees school name only, no rating or bilingual data | — | — |

**Verdict logic:** GOOD if `rating_score ≥ 7` and catchment confirmed · CAUTION if rating unknown · RISK if no school within 1.5km

**Implication template:** `"This address falls in the [school name] catchment ([type], [distance]m). [If bilingual: Bilingual [languages] provision available.]"`

---

### Indicator 13 — Climate & Heat Stress

| State | What renders | DB source | Edge / fallback |
|---|---|---|---|
| LOADED | Days above 35°C/year + cooling cost estimate + trend arrow + heatwave risk badge | `composite_indicators.days_above_35c_annual` · `composite_indicators.days_above_35c_trend` · `composite_indicators.cooling_cost_annual_eur` · `climate_data` | — |
| LOADING | Shimmer — 2 value placeholders | — | — |
| UNAVAILABLE | "Climate data not available for this municipio." + grey badge | `climate_data` JOIN returns null | — |
| LOCKED | Pro+ only | — | — |

**Verdict logic:** GOOD ≤ 15 days above 35°C · CAUTION 16–30 · RISK > 30

**Implication template:** `"[X] days above 35°C per year (+[trend]% over 10 years). Estimated annual cooling cost: €[Y]. [RISK: Heat stress risk is material — air conditioning is not optional.]"`

---

### Indicator 14 — Rental Trap Index

| State | What renders | DB source | Edge / fallback |
|---|---|---|---|
| LOADED | Buy vs rent delta in €/month + verdict + implication | `composite_indicators.rental_trap_index` · `composite_indicators.rental_trap_monthly_delta_eur` | — |
| LOADING | Shimmer — delta value placeholder | — | — |
| UNAVAILABLE | "Rental benchmark data not available for this postcode." + grey badge | `rental_benchmarks` has no row for this `codigo_postal` | — |
| LOCKED | Pro+ only | — | — |

**Verdict logic:** GOOD if buying cheaper (delta < 0) · CAUTION if within €200/month · RISK if renting significantly cheaper

**Implication template:** `"Buying costs €[X] [more / less] per month than renting an equivalent. [RISK: At current prices, renting is meaningfully cheaper — ensure your holding period justifies the premium.]"`

---

### Indicator 15 — Infrastructure Arbitrage

| State | What renders | DB source | Edge / fallback |
|---|---|---|---|
| LOADED | Count of approved/under-construction projects within 2km + most impactful project + score | `composite_indicators.infrastructure_arbitrage_score` · `infrastructure_projects` (`ST_DWithin 2km`) | — |
| LOADING | Shimmer — project count placeholder | — | — |
| UNAVAILABLE | "No approved infrastructure projects recorded within 2km." + grey **NEUTRAL** badge | `ST_DWithin` returns 0 rows | Absence of projects is NEUTRAL — never show RISK badge |
| LOCKED | Intelligence tier only | — | — |

**Verdict logic:** GOOD if ≥ 1 positive-impact project (metro/park/school/hospital) · CAUTION if only commercial/industrial · RISK if industrial disruption likely · NEUTRAL if no projects

**Implication template:** `"[X] approved infrastructure projects within 2km. Nearest: [project name] ([type], expected [year]). [GOOD: Positive impact on future value and liveability expected.]"`

---

## 3. Global Empty & Error State Rules

### 3.1 Never show a blank or zero-value card

A card showing `0`, an empty gauge, or a null percentage is worse than a graceful UNAVAILABLE state.

- If a value is **genuinely zero** (e.g. 0 VUT licences nearby): display it as zero with its correct implication
- If a value is **null** because data is unavailable: display UNAVAILABLE state, not zero

### 3.2 Missing Catastro reference fallback chain

1. Attempt lookup by `ref_catastral` from `analysis_cache`
2. If null: attempt Catastro OVC API call using coordinates (`lat`/`lng`)
3. If API fails: attempt proximity lookup (`ST_DWithin 20m` on `ite_status` and `solar_potential`)
4. If all fail: show UNAVAILABLE state with inline prompt `"Add your Catastro reference to unlock this data →"`

### 3.3 Inline data collection — never a blocking form

When a required field is missing (`price_asking`, `area_sqm`, `floor`, `ref_catastral`), the report should:

- Display the analysis it can complete
- Surface a single slim inline prompt within the relevant card
- Never redirect to a separate form or block the report from loading

On submit: trigger partial re-analysis for affected indicators only. Use optimistic UI — show loading state for affected cards immediately.

### 3.4 The report must always render something

Even if Parse.bot extraction returns only coordinates and price, the report renders with what is available. Flood risk, fibre, schools, climate, solar radiation, and ICO eligibility can all be calculated from coordinates alone.

The report never shows a full-page loading or error state. Partial data = partial report rendered immediately, with UNAVAILABLE states for missing sections.

---

## 4. Map Radial Mini-Map Card

This is the map component inside the DNA Report — a fixed-height infographic card showing a 400m radial view. **It is not the main map viewport.**

### 4.1 Component states

| State | What renders | DB source | Edge / fallback |
|---|---|---|---|
| LOADED | MapLibre static map, 220px height, 400m radius circle, emoji markers, pulsing pin at centre | `amenities` (`ST_DWithin 400m`) · `analysis_cache.lat` / `lng` | — |
| LOADING | Navy placeholder rectangle 220px, "Loading area map…" centred | — | — |
| UNAVAILABLE | Static placeholder + list of nearest amenities as text chips | MapLibre fails to initialise | Fallback to chip list is mandatory — map is optional, amenity data is not |

### 4.2 Amenity display rules

| display_category | Emoji | Radius | Max markers |
|---|---|---|---|
| school | 🏫 | 400m | 3 nearest |
| health | 🏥 | 400m | 2 nearest |
| transport | 🚌 | 400m | 3 nearest |
| supermarket | 🛒 | 400m | 2 nearest |
| park | 🌳 | 400m | 2 nearest |
| pharmacy | 💊 | 400m | 1 nearest |
| restaurant | 🍽️ | 400m | None — too noisy |

### 4.3 Critical constraints

1. The mini-map is **NOT interactive**. No pan, no zoom. Fixed snapshot only.
2. Height is fixed at **220px**. Does not expand or collapse.
3. The 400m radius circle is always rendered in Emerald at 8% fill, 2px dashed stroke.
4. Markers are **HTML elements** (emoji glyphs), not MapLibre symbols. Avoids font loading issues.
5. Below the mini-map: horizontally scrollable chip row showing all amenities — renders even if map fails.

---

## 5. Implementation Checklist (CHI-383)

Verify each item before marking CHI-383 as Done.

- [ ] Every indicator card component has explicit TypeScript types for all four states (`loaded | loading | unavailable | locked`)
- [ ] No indicator card renders null, undefined, or `0` as the primary display — all such cases use UNAVAILABLE state
- [ ] Flood risk card is never locked and always renders — if data unavailable, UNAVAILABLE state is shown
- [ ] Inline data collection prompt renders within relevant cards when `price_asking` / `area_sqm` / `ref_catastral` is null — no redirect to a form
- [ ] Catastro fallback chain is implemented (`ref_catastral` → OVC API → proximity lookup → UNAVAILABLE)
- [ ] Mini-map card renders at fixed 220px height, non-interactive, with emoji HTML markers
- [ ] Mini-map falls back to chip row if MapLibre fails to initialise
- [ ] Verdict badge colour follows GOOD/CAUTION/RISK/UNAVAILABLE logic from Section 1.3 exactly
- [ ] Each implication sentence uses the template from Section 2, populated with real data values
- [ ] Loading skeleton matches the shape of the LOADED card (same dimensions, placeholder elements in correct positions)
- [ ] Solar card always shows confidence badge — `confidence = low` triggers supplementary note
- [ ] Infrastructure card shows NEUTRAL badge (not RISK) when no projects found within 2km
- [ ] All 15 indicator cards tested with: (a) full data, (b) all fields null, (c) partial data
- [ ] Numerical values in all indicator cards use DM Mono font
- [ ] `DECISIONS.md` updated with D-039 covering four-state component standard
