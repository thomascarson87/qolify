# Qolify — Data Visualisation Grammar
## How Each Data Type Is Presented to Ordinary Users

**Version:** 1.0  
**Date:** April 2026  
**Status:** Active — canonical reference for all frontend presentation decisions  
**Companion documents:** `MAP_MVP_SPEC.md`, `UI_UX_BRIEF.md`, `INDICATORS.md`, `SCHEMA.md`  
**Decision references:** D-033, D-034, D-035, D-036

---

## Purpose

This document answers one question: given a specific piece of data from the database, what is the most honest and useful way to present it to a person making a home purchase decision?

The platform's current default — a 0–100 score with a coloured ring — is correct for exactly one kind of information: cross-property comparison and composite quality-of-life aggregation. For almost everything else, it either destroys information (replacing a €22,000 structural risk estimate with a number on a scale) or creates false precision (scoring a binary fact like flood zone membership).

This grammar defines a presentation format for every distinct data type in the platform. It is binding. When a developer or designer faces a presentation decision, they consult this document before defaulting to a score ring.

---

## The Six Presentation Formats

### Format 1 — Score Ring (0–100 composite)
**Use when:** Multiple signals must be compared across properties or zones, or a composite quality metric is the output.

**Never use for:** Binary facts, currency amounts, spatial/geographic data, time-series trends, or categorical status values.

**Components:** Arc gauge (270°), DM Mono number in centre, label below. Three sizes: XS 32px (map pins), SM 52px (cards), LG 80px (detail panels). Colour: Emerald ≥75, Amber 50–74, Risk <50.

**In zone panel:** Zone TVI ring with profile-adjusted score badge alongside it.  
**In pin report:** Single composite ring is suppressed. Individual data types shown in their correct formats.  
**In DNA Report:** Each of the 15 indicators has its own ring — but each ring is accompanied by a consequence statement and the raw underlying numbers.

**Decision D-033:** Score rings are never the only output for any indicator. Every ring must be accompanied by either a consequence statement in plain English or the raw underlying data that produces it. A ring with no context is not permitted in production.

---

### Format 2 — Consequence Statement (plain-English fact)
**Use when:** The data is a fact that has a direct real-world implication.

**Structure:** One sentence stating what is true. One sentence stating what it means in practice. Optionally, one action to take.

**Examples from schema:**

`ite_status.status = 'failed'`:
> "⚠️ This building failed its last structural inspection."  
> "Buildings with failed ITE status typically face compulsory community levy works within 2–3 years. Ask for the full inspection report before signing anything."

`flood_zones` (pin-level, `in_t10 = true`):
> "⚠️ This address is inside the T10 flood zone — meaning it has a 1-in-10-year flood probability."  
> "Properties inside T10 flood zones face significantly higher mortgage insurance costs. Verify cover availability with your broker before proceeding."

`catastro_valor_referencia` vs `price_asking` (gap > 10%):
> "✓ This property is priced 12% below its Catastro tax reference value."  
> "You pay ITP transfer tax on whichever is higher — but Hacienda uses the Catastro value as a floor. This gap gives you negotiating room and confirms the asking price is conservative."

`vut_density_pct > 40%` (within 200m of pin):
> "⚠️ 14 active tourist rental licences are registered within 200m of this address."  
> "High short-term rental density typically means noisy communal areas, frequent turnover of neighbours, and reduced community character. In many Málaga postcodes this figure is now over 30%."

`fibre_coverage.coverage_type = 'FTTP'`:
> "✓ Full-fibre (FTTP) is confirmed available at this address."  
> "FTTP delivers symmetrical speeds up to 1Gbps — adequate for remote work, video calls, and multiple simultaneous users."

**Design spec:** Consequence statement cards have a 3px left border in the signal colour (Emerald / Amber / Risk), a 5% tint background, and a bold title in DM Sans 14px weight 600, body in DM Sans 14px weight 400 line-height 1.6. Never more than 3 sentences total.

---

### Format 3 — Euro Amount (financial delta)
**Use when:** The insight is fundamentally monetary — what does this cost you, or save you, per month or per year.

**Never convert to a score when the euro figure is available.** A score of 61 on the True Affordability indicator communicates nothing. "This property costs €1,847/month in total — €312 more than the asking price implies" is actionable.

**Fields in schema with direct euro presentation:**
- `true_affordability_monthly_eur` → "Total monthly cost: €X,XXX"
- `structural_liability_est_eur` → "Estimated structural risk: €X,XXX–€XX,XXX over 7 years"
- `rental_trap_monthly_delta_eur` → "Buying costs €XXX/month less than renting equivalent here"
- `heating_cost_annual_eur` + `cooling_cost_annual_eur` → "Annual energy cost: ~€X,XXX (heating €XXX + cooling €XXX)"
- `catastro_valor_referencia` vs `price_asking` → "Priced €XX,XXX below / above Catastro reference value"

**Design spec:** Large DM Mono figure (24–28px, weight 500) as the primary display element. Secondary text in DM Sans 13px explaining what it covers. Comparison row beneath (thin divider, 12px text) showing local benchmark if available. Footnote in 10px Text Light with data source and confidence caveat.

**Comparison row example:**
```
Total monthly cost          €1,847 /month
  → Mortgage (25yr, 4.6%)   €1,203
  → IBI estimate (annual)     €74
  → Energy (climate-adjusted)  €98
  → Community fee (estimated)  €87
  → Less: ICO benefit           -€115
────────────────────────────────────────
Area average for 3-bed       €1,590 /month    ▲ €257 above local average
```

---

### Format 4 — Trend Line / Sparkline (time-series change)
**Use when:** The direction of change over time is as important as the current value.

**Use for:**
- `property_price_history` (price over time for a specific URL)
- `zone_metrics_history.median_price_sqm` (zone price trend)
- `zone_metrics_history.crime_rate_per_1000` (crime trend)
- `zone_metrics_history.vut_applications_30d` (VUT application rate trend)
- `composite_indicators.days_above_35c_trend` (climate trajectory)
- `composite_indicators.price_velocity_pct_3m` and `_12m` (price momentum)

**Never use a snapshot number when trend data is available.** A crime rate of 4.2 per 1,000 communicates nothing. A crime rate of 4.2 per 1,000 trending down 18% over 12 months communicates a great deal.

**Inline sparkline spec (list/card contexts):** 120×36px area chart. Emerald fill for upward trends that are positive (prices rising = good for investor, bad for buyer — context-sensitive colouring). Risk fill for upward trends that are negative. Horizontal baseline at start value. Most recent datapoint marked with a 4px dot. Hover tooltip: date + value.

**Full trend chart spec (detail panel):** Full card width. 180px height. X-axis: month labels (DM Mono 10px). Y-axis: value with unit suffix. Shaded area below the line. Two annotated callouts: start of period value and current value with delta percentage. If the trend shows a direction reversal, annotate the inflection point.

**Direction indicator:** Alongside any trend, a small pill badge: `↑ 12% over 12m` in Emerald, or `↓ 8% over 6m` in Risk, or `→ Stable` in Slate. This pill appears even when the full chart is not shown — it communicates direction at a glance in list views.

---

### Format 5 — Bar Chart / Monthly Breakdown (periodic distribution)
**Use when:** A continuous value varies in a meaningful seasonal or periodic pattern.

**Primary use cases:**
- `climate_data.sunshine_hours_jan` through `_dec` → monthly sunshine bar chart
- `solar_radiation.ghi_jan` through `ghi_dec` → monthly solar irradiance
- `climate_data.rainfall_jan_mm`, `_jul_mm` → rainfall seasonality
- Price seasonality (Seasonal Distortion Filter — Indicator 15)

**Monthly sunshine bar chart spec:**
12 vertical bars, full card width (max 340px), 80px height. Bar fill colour: gradient from `#D4820A` Amber (winter lows, shortest bars) to `#34C97A` Emerald (summer peak, tallest bars) — interpolated by bar value. Month initials (J F M A M J J A S O N D) below each bar in DM Sans 9px Text Light. Hover tooltip: full month name + exact hours. Two annotated callouts: darkest month + brightest month with coloured dots and hour figures.

Below the chart: one plain-English sentence. "2,847 sunshine hours per year. December averages 4.2 hours daily — January is the darkest month at 3.8."

**Rainfall seasonality spec:**
Same 12-bar structure. Blue fill (`#2A5490` Navy Light) graduating by intensity. Primary annotation: "Annual rainfall: XXXmm — [region context, e.g. 'similar to London' or 'drier than Almería']". Damp risk flag surfaces here if winter rainfall is high and building orientation is north-facing.

---

### Format 6 — Binary/Categorical Status Card (fact, not gradient)
**Use when:** The answer is yes/no, pass/fail, present/absent, or a finite set of named categories. There is no meaningful gradient.

**Never convert to a score. Never show a progress bar. The fact is the communication.**

**Use for:**
- `ite_status.status` — passed / failed / pending / not_required / not_available
- `flood_zones` membership (pin level) — in T10 / in T100 / no flood risk
- `fibre_coverage.coverage_type` — FTTP / FTTC / HFC / none
- `building_orientation.aspect` — N / NE / E / SE / S / SW / W / NW
- `properties.epc_rating` — A / B / C / D / E / F / G
- `ico_caps` eligibility — eligible / not eligible (age/price threshold)
- School catchment membership — in catchment / outside catchment / not available

**Design spec — Status Badge Grid:**
A 2-column grid of compact status cards. Each card: icon (20px, category-appropriate), label in DM Sans 12px weight 600, value in DM Sans 13px weight 400. Background: tinted by signal colour at 5% opacity. Left border: 3px signal colour. Height: 48px per card.

```
┌──────────────────────┐  ┌──────────────────────┐
│ 🏗 ITE Inspection    │  │ 📶 Fibre Connection   │
│ Failed — 2022        │  │ Full-fibre (FTTP)     │
│ ← Risk border        │  │ ← Emerald border      │
└──────────────────────┘  └──────────────────────┘
┌──────────────────────┐  ┌──────────────────────┐
│ 🧭 Building Aspect   │  │ ⚡ Energy Certificate  │
│ North-facing         │  │ Rating D              │
│ ← Amber border       │  │ ← Amber border        │
└──────────────────────┘  └──────────────────────┘
```

**EPC Rating:** Special treatment. Render as the official EU energy label colour strip (A=dark green through G=red), with the property's band highlighted. One plain-English implication: "D-rated properties cost an estimated €940/year to heat and cool. Upgrading to C would reduce this by approximately €340/year."

**Flood zone membership (pin level):** This is the most safety-critical binary in the system. Presentation rule:
- NO flood risk: Large emerald tick, bold "✓ Not in any flood zone." Below: "This address does not fall within SNCZI T10, T100, or T500 flood zone boundaries."
- IN T10 zone: Large risk icon, bold "⚠️ Inside the 1-in-10-year flood zone." Below: "This is the highest-risk flood designation. Mortgage insurance will be significantly more expensive — verify with your broker before exchanging contracts."

---

## Visualisation by Data Layer — Map Context

The map requires a distinct visual grammar from the panel/report views. The same data is presented differently depending on whether the user is in discovery mode (map) or decision mode (pin report / DNA Report).

### Map Layer Visualisations

| Data | Map representation | On-click / pin report representation |
|---|---|---|
| Zone composite score | Choropleth fill (Score Ring format suppressed) | Zone panel: Score Ring (LG) |
| Flood zones | Polygon overlay — T10/T100/T500 coloured fills | Binary Consequence Statement |
| VUT density | Choropleth heatmap by postcode | Euro density (X licences per 100 dwellings) + Consequence Statement |
| Solar radiation | Continuous heatmap (PVGIS grid) | Monthly bar chart (Format 5) + annual kWh/m² figure |
| School catchments | Polygon boundary lines (dashed emerald) | Catchment name + school detail card |
| Health facilities | Point pins (colour by type) | Distance in minutes walking + service type |
| Transport | Point pins clustered | Distance in minutes walking + frequency per day |
| Crime index | Choropleth by zona | Trend sparkline (Format 4) + municipio context benchmark |
| Infrastructure projects | Point pins with glow | Categorical card — project type, status, expected date |
| Fibre coverage | Polygon fill by type | Binary status card (Format 6) |
| Price/m² | Choropleth by postcode | Zone trend sparkline (Format 4) |

### Walking Radius Display (Pin Interaction)

When a pin is dropped, a 400m (5-min) walking radius ring is drawn automatically. The facilities within it are displayed in a **life proximity summary** — not scores, but counts and nearest distances:

```
Within a 5-minute walk (400m)
──────────────────────────────
🏥  GP surgery           1 · nearest 280m
💊  Pharmacy             2 · nearest 90m
🏫  School (primary)     1 · in CEIP La Paz catchment
🚇  Metro stop           1 · nearest 340m
🚌  Bus stop             4 · nearest 60m
🛒  Supermarket          2 · nearest 180m
🌳  Park                 1 · Parque del Oeste 210m
☕  Café/bar             8 · nearest 40m

Expand to 10 minutes (800m) →
```

Each facility type is a row. Icon + category label + count within radius + nearest distance. Expandable to 800m. No scores. Counts and distances are the data.

---

## The Pin Report — Full Specification

When a user drops a coordinate pin, the right panel switches to Pin Report mode. This is the centrepiece of the map experience. Every data type follows the grammar above.

**Section order (fixed — by decision relevance for most buyers):**

1. **Location header** — Address (if resolved from Catastro) or coordinates. Municipio. Postcode.

2. **Flood Safety** (Format 6 — Binary) — Most important safety-critical fact first. Binary: in / not in each flood zone. Consequence statement if in T10.

3. **Life Within Walking Distance** (proximity summary as above) — 400m default, expandable to 800m.

4. **Community Character** (Consequence Statement) — VUT count within 200m. Tourist rental density %. Plain-English characterisation ("primarily residential" / "mixed residential and tourist" / "heavily tourist").

5. **Digital Connectivity** (Format 6 — Binary) — Fibre type confirmed at this address. One-line implication.

6. **Schools** (Format 6 — Categorical, only if children relevant) — Catchment school name. Distance. Type (public/concertado/privado). Visible in Family profile; collapsed by default in others.

7. **Solar & Climate** (Format 5 — Monthly Bar Chart) — Sunshine hours chart. Annual GHI figure. HDD/CDD. Building orientation if known (compass format). Damp risk flag if triggered.

8. **Future Value Signals** (Format 2 — Consequence Statement, only if data exists) — Infrastructure projects within 2km. NTI signal for this postcode with plain-English interpretation.

9. **Financial Estimate** (Format 3 — Euro Amount, only if price/m² supplied) — Monthly cost estimate with breakdown. Catastro reference comparison if ref_catastral resolved.

10. **CTA** — "Paste an Idealista URL to analyse the specific listing" → triggers full DNA Report with this coordinate pre-filled.

**Confidence transparency rule:** Every data point in the pin report carries a source and freshness note where relevant. "Flood data: SNCZI, updated March 2026." "Solar: PVGIS 5-year average." "Crime: MIR municipio data, 12-month lag." This is not buried in a footnote — it appears as small metadata beneath each section.

---

## The Zone Panel — Full Specification

When a user clicks a postcode zone on the map, the zone panel opens. Zone-level data is aggregate — the grammar here reflects that.

**What changes from the pin report:**
- Score rings are appropriate here (zone comparison is the purpose)
- Flood data shows % coverage (aggregate), not binary (no pin = no point-in-polygon)
- All distances are from the postcode centroid, not a specific address
- Consequence statements are framed for the zone, not a specific property: "This postcode has no T10 flood exposure" vs "This address is inside a T10 flood zone"

**Section order:**

1. **Zone header** — Postcode + neighbourhood name. Zone TVI Score Ring (LG 80px). Profile-adjusted score badge.

2. **Signal badges** — Horizontal pill row, colour-coded. Max 5 badges. Examples: `Prime Buy Zone`, `School Rich`, `High VUT Risk`, `Flood Clear`, `Full-Fibre Confirmed`.

3. **Pillar score grid** (2×3 or 2×4 layout) — Each pillar: icon + name + score bar (not a ring — horizontal bars suit grid layout) + number. Click any pillar to expand the accordion.

4. **Accordion sections** — Each pillar expands to show:
   - The key underlying facts (not sub-scores — facts)
   - Any applicable consequence statements
   - "Show on map" link to highlight relevant layer

5. **Price context** — `zone_metrics_history` sparkline if ≥3 months data. Plain-English trend statement.

6. **Drop a pin CTA** — Full-width Navy button. Below: "Or paste an Idealista URL →"

---

## Amenity Sub-Category Grammar

The `amenities` table's `category` field needs sub-categorisation for walking radius display. This is a presentation-layer concern — the map groups icons by category hierarchy.

**Daily necessities** (highlighted first in proximity summary):
- Supermarket, hypermarket, convenience store
- Pharmacy
- Bakery / panadería
- Bank / ATM

**Health & wellness:**
- GP surgery (from `health_centres`)
- Hospital / urgencias (from `health_centres`)
- Pharmacy (from `health_centres`)
- Gym / sports centre

**Education** (from `schools`):
- Primary school (infantil / primaria)
- Secondary school (ESO / bachillerato)
- International school

**Transport** (from `transport_stops`):
- Metro
- Cercanías / train
- Bus
- Tram

**Lifestyle:**
- Café / bar
- Restaurant
- Park / green space (from `amenities` polygon)
- Coworking space

**Icon set:** Use a consistent 20px icon per category (Lucide or custom SVG). Same icon used on map pins and in proximity summary rows. Never use emoji in map pins — emoji rendering is inconsistent across platforms.

---

## Decisions Logged

| ID | Decision | Rationale |
|---|---|---|
| D-033 | Score rings are never the sole output for any indicator | A number on a 0–100 scale without context is not actionable for a home buyer. Every ring must be accompanied by consequence text or raw underlying figures. |
| D-034 | Euro amounts take precedence over scores wherever financial data exists | €1,847/month is more actionable than "Affordability: 61". The raw monetary figure is always the primary display element. |
| D-035 | Flood zone membership at pin level is always binary, always a Consequence Statement, and always shown first in pin reports | Flood risk is a safety-critical fact with legal and financial consequences. It cannot be buried in a score, shown as a gradient, or deprioritised in layout order. |
| D-036 | Walking proximity is shown as counts + distances (metres or minutes), never as a score | "3 schools within 800m, nearest 280m" is actionable. "Education score: 74" is not. The proximity summary is the primary life-quality output for a pin drop. |
