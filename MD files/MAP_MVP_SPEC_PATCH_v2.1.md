# Qolify — MAP_MVP_SPEC Patch v2.1
## Visualisation Grammar Integration

**Amends:** MAP_MVP_SPEC.md v2.0  
**Date:** April 2026  
**Status:** Active — apply these changes to MAP_MVP_SPEC.md before next implementation sprint  
**Companion document:** `DATA_VIS_GRAMMAR.md` (new — read this first)  
**Decision references:** D-033, D-034, D-035, D-036

This patch documents revisions to the Map MVP spec that flow from the visualisation grammar decision. Sections 6 (Zone Panel), 9 (Property Pin), and 11 (Linear Issues) are updated. All other sections of MAP_MVP_SPEC.md v2.0 remain unchanged.

---

## Revised Section 6 — Zone Panel Detail View

**Replaces** the existing Section 6 in MAP_MVP_SPEC.md v2.0.

### What changes

The previous zone panel spec led with a Score Ring and pillar score bars. This is retained for zone-level comparison (score rings are appropriate at zone level because the user is comparing zones, not making a property decision). However, pillar accordions now expand to show **underlying facts and consequence statements**, not sub-scores.

### Updated Zone Panel Structure

**Header** (unchanged):
Zone name + postcode — Playfair Display 22px italic. Zone TVI Score Ring (80px LG). Profile-adjusted score badge if non-default profile active.

**Signal badges** (unchanged):
Horizontal scroll pill row. Max 5 badges. Emerald / Amber / Risk. Examples: `Prime Buy Zone` · `School Rich` · `High VUT Risk` · `Flood Clear` · `Full-Fibre Confirmed`.

**Pillar score grid** (changed from rings to horizontal bars):
```
┌──────────────────────────────────────────────────────┐
│  🏫 Schools          ████████████░░░░  78            │
│  🏥 Health           ██████████████░░  88            │
│  🏘 Community        █████████░░░░░░░  62  ⚠         │
│  ☀ Solar            ███████████████░  91            │
│  🚇 Connectivity     ████████░░░░░░░░  54            │
│  🏗 Future Value     ██████░░░░░░░░░░  44  ⓘ         │
└──────────────────────────────────────────────────────┘
```
Score bars, not rings. 8px height, full card width. Number right-aligned. Alert icon if signal warrants attention. Click any row → expands accordion below.

**Accordion sections — revised content spec:**

*Schools accordion:*
- Nearest school: name + distance (metres) + type badge (public/concertado/privado) + rating if available
- Schools within 1km: count breakdown by type ("2 public, 1 concertado")
- Catchment note: "School catchment boundaries overlap this postcode — drop a pin for your specific address to confirm your catchment school." (Links to two-level truth principle.)
- "Show schools on map →" — toggles schools layer ON if not already active

*Flood Risk accordion:*
- No T10 exposure: `✓ No T10 flood zone in this postcode.` Emerald left border. One sentence: "No properties in this postcode face T10 flood designation per SNCZI."
- Has T10 exposure: `⚠️ [t10_coverage_pct]% of this postcode is within the T10 flood zone.` Risk left border. Below: "Drop a property pin to check any specific address against the exact polygon boundary. Zone-level coverage does not tell you whether a specific property is inside or outside the zone boundary."
- Always show: "Flood data source: SNCZI (Sistema Nacional de Cartografía de Zonas Inundables), [refresh date]."

*Community accordion:*
- VUT density: "[vut_active] active tourist rental licences in this postcode — [vut_density_pct]% of estimated residential units." Followed by benchmark: "The Málaga average is 8.4%. Centro runs at ~28%."
- Consequence statement if density > 20%: "High tourist rental density reduces residential character. Expect frequent neighbour turnover, communal area noise, and reduced community cohesion."
- VUT trend if zone_metrics_history available: Direction indicator pill (↑ ↓ →) with 12-month change.

*Solar accordion:*
- Annual GHI: "[avg_ghi] kWh/m² annual solar irradiance" in DM Mono 20px.
- Sunshine bar chart: 12-month bars (Format 5 from DATA_VIS_GRAMMAR.md). Full card width, 72px height.
- Below chart: "This is one of the [sunniest / least sunny] areas in Andalucía. Solar panels here generate an estimated [X]% more energy than the Spanish average."
- Damp note: Only shown if climate_data.humidity_annual_pct > 65 AND rainfall_annual_mm > 700. "This postcode's climate creates elevated damp risk for north-facing or poorly insulated properties."

*Health accordion:*
- Nearest GP: name + distance in minutes walking (approx — distance_m / 80 m/min). NOT as a score.
- Nearest 24hr emergency: name + distance in minutes.
- Pharmacies within 500m: count.
- "Show health facilities on map →"

*Infrastructure accordion (Investor profile):*
- Project list within 2km: each project as a card — icon (type), name, status badge (approved/planned/under construction), expected completion year, distance.
- If no projects: "No approved infrastructure projects within 2km. [planned] projects in planning phase."
- NTI signal for this postcode with plain-English interpretation:
  - `prime_buy`: "Area is showing early gentrification signals — improving amenity mix, rising permit activity, falling days on market. Price appreciation likely precedes broader recognition."
  - `too_late`: "Area is already well-recognised. Quality is high but opportunity to buy ahead of price may have passed."
  - `stable`: "No strong transition signals in either direction."
  - `risk`: "Area is showing decline signals — rising VUT applications, crime trend up, falling permit activity."

**Price context** (unchanged from v2.0): Sparkline from zone_metrics_history if ≥3 months. Add: plain-English trend sentence. "Median price/m² in 29017 has risen 8% over the last 12 months — faster than the Málaga average of 5%."

**Drop a pin CTA** (unchanged): Full-width Navy button.

---

## Revised Section 9 — The Property Pin Report

**Replaces** the existing Section 9 in MAP_MVP_SPEC.md v2.0.

### What changes

The previous pin report spec described the data to surface but not how to present it. This revision specifies the exact presentation format for each data type, following DATA_VIS_GRAMMAR.md. Section ordering is revised — the most safety-critical information (flood) comes first. Proximity summary is elevated to section 2. Scores are suppressed in the pin report; consequence statements and raw facts are the primary format.

### Pin Interaction Flow (unchanged from v2.0)

1. Right-click (desktop) / long-press (mobile) → "Drop an intelligence pin here" popover
2. Optional: price/m² input fields
3. `POST /api/map/pin { lat, lng, price_asking?, area_sqm? }`
4. Server runs PostGIS (no Parse.bot):
   - Point-in-polygon: flood zones (binary per T10/T100/T500)
   - Point-in-polygon: school catchment (specific school)
   - Point-in-polygon: fibre coverage (binary)
   - ST_DWithin: all facility types within 800m
   - VUT count within 200m
   - Catastro OVC lookup (ref_catastral, build year, cadastral area)
   - PVGIS nearest grid → solar GHI
   - AEMET nearest station → climate data
5. Zone panel switches to Pin Report mode

### Pin Report — Content and Format by Section

**Section 1 — Location**
- Address (if Catastro resolves) or "📍 [lat, lng] — [postcode], [municipio]"
- Two badges: postcode + municipio name
- "Coordinate confirmed — analysis is based on this exact location"

---

**Section 2 — Flood Safety** ← elevated to first data section (D-035)
- Binary presentation only — point-in-polygon result, never the zone aggregate
- Not in any zone: Large emerald tick (32px). Bold "✓ No flood risk at this address." Body: "This coordinate does not fall within SNCZI T10, T100, or T500 flood zone boundaries. Source: MITECO/SNCZI, updated [date]."
- In T10: Large risk icon. Bold "⚠️ Inside the 1-in-10-year flood zone." Body: "This address falls within the T10 SNCZI designation. This is the highest flood risk category. Mortgage insurance will be significantly more expensive — verify cover availability with your mortgage broker before exchanging contracts. Source: MITECO/SNCZI, [date]." Action: "Show flood polygon on map →"
- In T100 only: Amber icon. "⚠️ Inside the 1-in-100-year flood zone." Consequence: "Lower risk than T10 but still relevant to insurance costs and long-term climate risk."

---

**Section 3 — Life Within Walking Distance** ← elevated to second data section (D-036)

Rendered as a structured proximity summary, not scores:

```
Within a 5-minute walk (400m)
──────────────────────────────
🏥  GP surgery           1 · nearest 280m (≈3 min walk)
💊  Pharmacy             2 · nearest 90m (≈1 min walk)
🏫  School (primary)     1 · CEIP La Paz — in catchment ✓
🚇  Metro stop           1 · Alameda · nearest 340m (≈4 min walk)
🚌  Bus stop             4 · nearest 60m (≈1 min walk)
🛒  Supermarket          2 · nearest 180m (≈2 min walk)
🌳  Park                 1 · Parque del Oeste · 210m (≈3 min walk)
☕  Café / bar           8 · nearest 40m (≈1 min walk)
──────────────────────────────
[ Expand to 10 minutes (800m) ]
```

Walking time calculated as distance_m / 80 (80m/min is standard pedestrian planning rate). Rounded to nearest minute. If < 60 seconds, show "< 1 min".

School row: if `in_catchment = true`, show school name and green "in catchment ✓" badge. If `in_catchment = false`, show school name and "not in catchment" in slate text.

If a facility type has zero instances within 400m: show the row with "None within 5 min · nearest [Xm]" to make the absence visible rather than hiding the row.

---

**Section 4 — Community Character**

VUT density within 200m radius:
- Count: "[N] active tourist rental licences within 200m of this address"
- Density statement: contextualised relative to local average
- Consequence statement (D-033) based on count:
  - 0–3: "✓ Predominantly residential. Very low short-term rental presence."
  - 4–10: "⚠️ Some tourist rentals present — worth checking the building's specific situation."
  - 11+: "⚠️ High tourist rental density. Expect reduced residential community character."
- Show on map: "Show individual VUT addresses →" (activates `vut-individual` layer at zoom 15+)

---

**Section 5 — Digital Connectivity**

Binary status card (Format 6):
- `FTTP`: "✓ Full-fibre confirmed at this address. Symmetrical speeds up to 1Gbps."
- `FTTC`: "⚠️ Fibre-to-cabinet only. Upload speeds limited — check if acceptable for your needs."
- `HFC`: "⚠️ Cable broadband. Shared network — speeds vary at peak times."
- `none`: "⚠️ No fibre coverage confirmed. Mobile broadband or satellite may be only options."
- Confidence note: "Coverage data: CNMC, [year]. Verify with provider before committing."

---

**Section 6 — Solar & Climate**

- Building orientation (if ref_catastral resolved): Compass SVG (100px) with filled arc ±45° from aspect. Emerald for south-facing, Amber for east/west, Slate/Risk for north-facing. One plain-English sentence.
- Annual GHI: DM Mono 24px. "[X,XXX] kWh/m² annual solar exposure." Context: "Above / below the Andalucía average of 1,680 kWh/m²."
- Monthly sunshine bar chart (Format 5): 12 bars, full card width. "Best month: [month] — [X] daily hours. Darkest month: [month] — [X] daily hours."
- Energy cost estimate: Two horizontal bars (Emerald = heating, Amber = cooling) with EUR figures. "[~€XXX heating + ~€XXX cooling = ~€X,XXX/year]." Caveat: "Estimated based on [EPC rating / unknown EPC] and this location's climate. Actual costs vary."
- Damp risk flag (if triggered — north/NE/NW facing AND humidity > 65% AND rainfall > 700mm): Amber Consequence Statement. "Moderate damp risk flagged for this location and orientation. This is a probabilistic indicator — it does not confirm damp is present. Commission a professional survey."

---

**Section 7 — Future Value Signals** (collapsed by default; expands on tap)

Only shown if data exists:
- NTI signal for this postcode with plain-English interpretation (same text as zone accordion above)
- Infrastructure projects within 2km: list format — type, name, status, distance, expected date
- Price trend for postcode: sparkline + direction indicator pill

---

**Section 8 — Financial Estimate** (only if price_asking or area_sqm provided)

Format 3 (Euro Amount) — Full breakdown as specified in DATA_VIS_GRAMMAR.md:
- Mortgage estimate (at current ECB base + spread from eco_constants)
- IBI estimate
- Energy cost (from climate data)
- Community fee estimate (regional average by property type)
- ICO eligibility check (from ico_caps table)
- Total monthly cost highlighted in DM Mono 28px

Catastro comparison (if ref_catastral resolved):
- "Catastro Valor de Referencia: €X,XXX" vs "Asking price: €X,XXX" — delta as % with signal colour

---

**Section 9 — CTA**

Full-width Navy button: "Paste an Idealista URL to analyse this property →"
Below: "Adding a listing URL unlocks the full DNA Report — structural history, ITE status, negotiation signals, and all 15 composite indicators."

---

## Revised Section 11 — Linear Issue Structure

**Replaces** the existing Section 11 in MAP_MVP_SPEC.md v2.0.

New issues added below existing CHI-335 through CHI-344. Existing issue scope is updated where affected by the visualisation grammar decisions.

### Updated scope notes on existing issues

**CHI-341 (Zone panel):** Scope updated. Pillar accordions must surface consequence statements and underlying facts per DATA_VIS_GRAMMAR.md Section (Zone Panel). Pillar bars replace score rings in the grid. See revised Section 6 above.

**CHI-343 (Property pin):** Scope updated. Pin report must follow Section ordering: Flood → Proximity → Community → Connectivity → Solar → Future Value → Financial. Every data point follows its designated format from DATA_VIS_GRAMMAR.md. Proximity summary is counts + distances, not scores. See revised Section 9 above.

**CHI-344 (`POST /api/map/pin` endpoint):** Scope updated. API response must include:
- Walking time estimate (distance_m / 80, rounded) for every proximity result
- In-catchment boolean for school results
- Nearest facility of each type even if outside 400m (for "none within 5 min · nearest Xm" display)
- VUT count within 200m (existing) plus density context string

### New issues

| Issue | Title | Priority | Milestone | Depends on |
|---|---|---|---|---|
| **CHI-345** | Consequence statement engine — plain-English text generator for all binary/categorical fields | High | M2 | CHI-344 |
| **CHI-346** | Walking proximity summary component — counts, distances, walking times, in-catchment flag | High | M2 | CHI-344 |
| **CHI-347** | Monthly sunshine bar chart component — 12-bar, DM Mono, hover tooltips, plain-English callout | Medium | M2 | CHI-339 |
| **CHI-348** | Euro amount breakdown component — monthly cost table, comparison row, DM Mono figures | High | M2 | CHI-344 |
| **CHI-349** | Binary status badge grid — ITE / flood / fibre / EPC / orientation as status cards | Medium | M2 | CHI-344 |
| **CHI-350** | Flood safety section — pin report flood binary display, first-section priority layout | Urgent | M2 | CHI-344, CHI-349 |
| **CHI-351** | VUT community character section — 200m count, density statement, consequence text | Medium | M2 | CHI-344 |
| **CHI-352** | Zone panel — pillar bars replacing score rings; accordion fact/consequence content | High | M2 | CHI-341 |
| **CHI-353** | Amenity sub-category taxonomy — OSM category → display category mapping | Medium | M1 | Schema |
| **CHI-354** | Trend sparkline component — 120×36px inline + full 180px panel version + direction pill | Medium | M2 | CHI-339 |
| **CHI-355** | `zone_scores` view: add walkability fact columns (nearest_supermarket_m, nearest_pharmacy_m, nearest_cafe_m) | Medium | M1 | CHI-335 |

---

## Definition of Done — Additions (append to Section 12)

The following items are added to the existing DoD checklist:

**Visualisation grammar compliance:**
- [ ] No pin report section uses a 0–100 score as its primary display element
- [ ] Flood section is the first data section in the pin report (after location header)
- [ ] Proximity summary shows counts + walking distances, not a score
- [ ] VUT density shows count within 200m + plain-English consequence statement
- [ ] Monthly sunshine chart renders correctly for Málaga (bars visibly taller in summer months)
- [ ] Financial section shows euro breakdown table, not a score ring
- [ ] All binary facts (flood, fibre, ITE, EPC, orientation) use status badge format
- [ ] Every consequence statement is ≤3 sentences and includes a recommended action where applicable
- [ ] Confidence/source footnotes present on flood data, crime data, and climate data sections

**Tone of voice QA:**
- [ ] All auto-generated consequence statements reviewed against tone of voice guide (DATA_VIS_GRAMMAR.md + UI_UX_BRIEF.md §6)
- [ ] No jargon without explanation (e.g. SNCZI is always followed by the plain-English name "Spain's national flood mapping authority")
- [ ] Flood consequence text reviewed for legal accuracy — must not overstate or understate risk

---

## Decisions Added (append to Section 13)

| ID | Decision | Rationale |
|---|---|---|
| D-033 | Score rings never sole output for any indicator | Every ring must be accompanied by consequence text or raw underlying figures |
| D-034 | Euro amounts take precedence over scores where financial data exists | €1,847/month is actionable; "Affordability: 61" is not |
| D-035 | Flood zone (pin level) always binary, always first section, always a Consequence Statement | Safety-critical fact — cannot be buried in a score or de-prioritised in layout |
| D-036 | Walking proximity shown as counts + distances, never as a score | "3 schools within 800m" is actionable; "Education score: 74" is not |
