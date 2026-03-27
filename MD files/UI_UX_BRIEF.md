# Raiz — UI/UX Design Brief

This document is the complete design brief for Raiz. It should be handed directly to a UI/UX designer or design tool. Every page, every core component, every data visualisation, and every interaction principle is specified here.

---

## 1. Design Philosophy

### The Core Tension to Resolve

Raiz contains more data than any property platform its users have ever seen. The design challenge is not how to display that data — it is how to make a person feel **calm and capable** in the presence of it.

The risk is a dashboard that overwhelms. The opportunity is an interface that thinks alongside the user — surfacing what matters to them, hiding what doesn't, and translating numbers into decisions.

### The Reference Feeling

Think of a Sunday morning. One partner makes coffee. The other opens a laptop. They have a shortlist of four properties they found last week. They open Raiz together and spend an hour going through them — not anxiously, but curiously. They argue gently about whether the school catchment matters more than the commute. They share the comparison link with a friend who bought in Málaga last year. They save the one that wins on their criteria and set a price alert.

That is the experience Raiz must deliver. Unhurried. Trustworthy. Worth coming back to.

### Primary Design References

**For navigation and emotional warmth:** Airbnb. The way Airbnb makes a complex search feel personal and explorable. Filters that feel like preferences, not parameters. The sense that the platform is on your side.

**For data clarity:** Bloomberg Terminal aesthetic — not the actual terminal, but the underlying principle: data-dense layouts where every number has a purpose, relationships between figures are immediately legible, and nothing is decorative without being functional.

**For data visualisation accessible to non-experts:** The New York Times data journalism visual style. Charts that anyone can read. Annotations that explain what the number means. Context always shown alongside the figure.

**The synthesis:** A trusted advisor who happens to have all the data. Not cold. Not flashy. Authoritative but human. Dense when the user wants depth, clean when they need simplicity.

---

## 2. Visual Identity

### Colour System

The palette has four roles. Every colour in the UI must serve one of them.

**Foundation — Navy**
The primary canvas for navigation, headers, and high-authority surfaces.
- `Navy Deep` `#0D2B4E` — primary background, nav bar, headers
- `Navy Mid` `#1A3D6B` — secondary surfaces, active states on dark
- `Navy Light` `#2A5490` — borders on dark, subtle dividers

**Signal — Emerald**
Used exclusively for positive outcomes: good scores, buy signals, value, opportunity. Never used decoratively.
- `Emerald Deep` `#1B5E3A` — badges, section accents
- `Emerald Bright` `#34C97A` — primary signal colour, chart fills for high scores, TVI rings, progress

**Risk — Terracotta**
Used exclusively for risk flags and negative signals. Never used decoratively.
- `Risk` `#C94B1A` — red alert backgrounds, flood zone overlay, failed ITE
- `Risk Light` `#F5A07A` — softer risk tints

**Caution — Amber**
Used exclusively for amber alerts, pending states, and data that requires attention without being an emergency.
- `Amber` `#D4820A` — amber alerts, ITE pending, moderate risk
- `Amber Light` `#FBBF24` — softer amber fills

**Neutral — Slate**
All text, borders, and surfaces that are not signalling.
- `Text` `#1A2535` — all body text
- `Text Mid` `#4A5D74` — secondary text, descriptions
- `Text Light` `#8A9BB0` — labels, placeholders, metadata
- `Surface` `#FFFFFF` — primary card/panel backgrounds
- `Background` `#F4F7FB` — page background (slightly blue-grey, not pure white)
- `Border` `#DDE4EF` — card borders, dividers

**Gold** `#C9A84C` — used sparingly for the Intelligence tier premium indicator, annual plan badge. Never overused.

### Typography

**Display / Headings — Playfair Display**
Used for all H1 and H2 page headings, property names in prominent positions, and the brand name. Use the **italic weight** for emphasis — it carries warmth and authority together.

- H1 page titles: Playfair Display, 48–56px, weight 700, letter-spacing -0.03em
- H2 section titles: Playfair Display, 28–36px, weight 600
- Pull quotes / key callouts: Playfair Display Italic, 22–28px

**Body / UI — DM Sans**
Used for all body text, UI labels, form inputs, navigation, and any text that needs to be scannable at small sizes.

- Body text: DM Sans, 15px, weight 400, line-height 1.6
- UI labels: DM Sans, 13px, weight 500
- Navigation: DM Sans, 12px, weight 600, uppercase, letter-spacing 0.08em
- Buttons: DM Sans, 14px, weight 600

**Data / Numbers — DM Mono**
Used for all numerical data, scores, prices, and technical values. Monospace ensures numbers align and signals precision.

- Price figures: DM Mono, 24–32px, weight 500
- Score numbers: DM Mono, 16–20px, weight 500
- Small data labels: DM Mono, 11px, weight 400

### Spatial System

8px base unit. All spacing is a multiple of 8.

- `4px` — between inline elements (icon + label)
- `8px` — within component internal padding
- `16px` — between related items in a list
- `24px` — between distinct components within a section
- `32px` — between sections within a page
- `48px` — between major page sections
- `64px` — hero/feature section vertical rhythm

### Border Radius

- `6px` — small inline elements, badges, pills
- `12px` — standard cards, input fields
- `18px` — large cards, panels
- `24px` — modal dialogs, floating panels
- `50%` — circular elements (TVI score rings)

### Shadow System

Shadows feel like natural light from top-left. Never dramatic drop shadows.
- `Shadow SM` `0 1px 4px rgba(13,43,78,0.08)` — subtle card lift
- `Shadow MD` `0 4px 16px rgba(13,43,78,0.12)` — hovered cards, dropdowns
- `Shadow LG` `0 12px 40px rgba(13,43,78,0.16)` — modals, floating panels
- `Shadow XL` `0 24px 80px rgba(13,43,78,0.20)` — full-page drawers

---

## 3. Core Components

### 3.1 The TVI Ring

The TVI score is the single most important number on the platform. It must be immediately recognisable anywhere it appears.

**Form:** A circular gauge — an arc spanning about 270 degrees (like a watch crown). The arc fills clockwise based on the score (0–100). The score number sits in the centre. Below it, the word "TVI" in tiny uppercase.

**Colour logic:**
- 75–100: Emerald Bright arc and fill background
- 50–74: Amber arc
- 0–49: Risk arc

**Three sizes:**
- `XS` 32px — map pins, property list rows
- `SM` 52px — property cards in lists
- `LG` 80px — property detail page header, comparison cards

**Behaviour:** On first render, the arc animates from 0 to the actual score over 600ms ease-out. This animation plays once per session per property. On hover in list view, tooltip shows "TVI: 78/100 — High quality of life relative to price."

### 3.2 Alert Pills

Three types, visually distinct through colour, left border, and icon:

`Green` — buy signal, positive finding
- Left border: 3px solid Emerald Bright
- Background: 5% Emerald tint
- Dot: Emerald Bright, 8px

`Amber` — caution, verify before proceeding
- Left border: 3px solid Amber
- Background: 5% Amber tint
- Dot: Amber, 8px

`Red` — risk flag, serious concern
- Left border: 3px solid Risk
- Background: 5% Risk tint
- Dot: Risk colour, 8px

**Anatomy:**
```
[Dot] [Title — DM Sans 13px 600]          [Source — tiny, greyed]
[Description — DM Sans 12px, Text Mid, max 2 lines, line-height 1.4]
[What does this mean? ›  — expandable chevron]
```

The **"What does this mean?" expansion** is critical. When tapped, it reveals a 2–3 sentence plain-English explanation: the data source, what the number means in practice, and what action to consider. An inline expand that pushes content down — not a tooltip.

### 3.3 Pillar Score Bar

**Anatomy:**
```
[Pillar Name — 130px, DM Sans 12px, Text Mid]
[Track — flex-1, 6px height, Background colour, rounded]
[Fill — same height, colour by score range]
[Score — 28px, DM Mono 12px 600, right-aligned]
```

**Fill colours:** 70+: Emerald Bright / 40–69: Amber Light / 0–39: Risk Light

**Stagger animation:** Each bar fills sequentially with a 60ms delay between them, creating a cascade effect when first entering the viewport.

### 3.4 Indicator Cards

Each of the 15 composite indicators is a card sharing a common structure.

**Card anatomy:**
```
[Icon 20px] [Indicator name — DM Sans 14px 600]    [Score badge — DM Mono, right]
[Mini score bar]
[Summary sentence — DM Sans 13px Text Mid — the MEANING, not the score]
[Supporting data — 2-3 [Label: Value] pairs in DM Mono 11px]
[● High confidence / ● Based on limited data]               [Expand ›]
```

**Summary sentence example:** *"This building's age, EPC rating, and pending ITE inspection suggest moderate risk of repair levies within 5 years."*

**Locked state (for lower tiers):** Background is `Background` colour (not white). A blur overlay covers the summary and data. Padlock icon top-right. Indicator name still visible. One line: *"Upgrade to Pro to unlock this indicator."* Subtitle: *"This indicator tells you whether this area is improving faster than the market has noticed."* Partial visibility is intentional — users must understand what they are missing.

### 3.5 Property Cards (List View)

```
[Photo 72×72px rounded]  [Address — DM Sans 14px 600]           [TVI Ring SM]
                          [Price — DM Mono 18px 500]
                          [Municipio, Provincia — DM Sans 12px Text Light]
                          [Alert dots — up to 3, green/amber/red, hoverable]
```

**Hover state:** Card lifts with Shadow MD. Subtle emerald left-border appears. TVI ring slightly enlarges.

### 3.6 Negotiation Gap Gauge

A bespoke horizontal data visualisation — not a standard chart library component.

**Concept:** A single horizontal track with three markers:
1. Catastro Valor de Referencia (navy diamond)
2. Asking Price (thicker vertical bar — the anchor)
3. Expected Appraisal (a range band, not a point, in subtle fill)

The track spans approximately -20% to +20% of asking price.

**Below the gauge (contextual text):**
- Asking < Catastro: `[Green] Asking price is 12% below Catastro value — strong negotiation signal`
- Asking > Catastro: `[Amber] Asking price is 8% above Catastro value — tax calculated on the higher figure`
- Asking > 20% above: `[Red] Significant premium over tax value — higher financial risk`

This should feel like a bespoke analytical instrument from a financial research report. Not a progress bar.

### 3.7 Life Proximity Wheel

A radar chart across 8 dimensions: Schools, Health, Transport, Green Space, Beach/Nature, Amenities, Airport, Safety.

**Design:**
- Filled area: Emerald at 15% opacity, 1.5px Emerald Bright stroke
- Axis lines: Border colour, labels at outer edge in DM Sans 11px Text Light
- On hover over any axis point: tooltip with specific data — "Nearest school: 340m (Colegio Público, In catchment)"
- Comparison mode: each property as its own semi-transparent fill layer, distinct colours (Emerald / Amber / Navy Light / Gold for up to 4)

### 3.8 Monthly Cost Breakdown Card

```
Estimated monthly cost breakdown

[🏠]  Mortgage (30yr, ICO 95%)         €847 /mo    [DM Mono]
[🏛]  IBI property tax                  €62 /mo
[⚡]  Energy — heating + cooling        €81 /mo     [climate-adjusted, not EPC estimate]
[🏢]  Comunidad fee                      €45 /mo
      ─────────────────────────────────────────────
      Total monthly cost                 €1,035 /mo  [larger, bolder]

vs. Renting equivalent:  €1,340 /mo
Buying saves approximately €305/month here    [Emerald Bright]
```

The energy line is always labelled "heating + cooling" (not "EPC estimate") to signal that Raiz's figure is climate-adjusted. A subtle "ⓘ" icon beside the energy row opens an inline tooltip: "Estimated from local Heating and Cooling Degree Days, EPC rating, building orientation, and current energy tariffs. More accurate than EPC-based estimates alone." The "vs. Renting" comparison uses Emerald Bright when buying is cheaper, Risk colour when renting is cheaper.

### 3.9 Climate Summary Panel

A compact five-row panel placed at the top of the Climate & Solar section of the Hidden DNA Report. Gives the user a fast headline read of the five key climate facts before they dive into sub-indicators.

```
Climate & Solar  ─────────────────────────────────────

☀️  2,847 hrs/yr sunshine      ● Top 15% nationally
🌡️  250 HDD                    ● Very mild winters
🌡️  34 hot days above 35°C     ● Trending up (+16 days vs 2000s)
🌧️  480mm annual rainfall       ● Below average
🧭  South-facing facade         ● Optimal for Spain

```

**Layout rules:**
- Icon: 16px emoji, left-aligned
- Figure: DM Mono 14px 500, colour-neutral (navy text)
- Label: DM Sans 12px Text Mid
- Annotation: DM Sans 12px with coloured dot — Emerald for good, Amber for moderate, Risk for concern
- The trend annotation on extreme heat days is always shown if the trend is positive (worsening) — never hidden

### 3.10 Sun Hours Monthly Chart

A 12-month bar chart showing average daily sunshine hours per month. Compact enough to sit within the Climate & Solar indicator card.

**Specifications:**
- Width: full card width. Height: 72px.
- Bars: 12 vertical bars with 4px gap between them. No x-axis labels — month initials (J F M A M J J A S O N D) appear below each bar in DM Sans 9px Text Light.
- Bar colour: gradient from Amber Light at winter lows to Emerald Bright at summer peaks. Colour transitions smoothly — not a hard cutoff.
- Hover: tooltip shows month name + exact figure: "December — 4.2 hrs/day average"
- Two annotated callouts below the chart:
  - "Darkest month: December — 4.2 hrs/day"
  - "Brightest month: July — 10.8 hrs/day"
- These are in DM Sans 11px Text Mid, with a small coloured dot (amber-light / emerald-bright) preceding each.

**Why this matters for the user:** For a buyer relocating from northern Europe, seeing that December still gets 4+ hours of direct sun daily is concrete and persuasive in a way "2,847 annual hours" is not. The chart makes the seasonal distribution tangible.

### 3.11 Solar Orientation Compass

A circular SVG compass rose showing the building's facade orientation. Placed within the Indicator 8 card.

**Specifications:**
- Diameter: 100px (card) / 60px (compact variant in report header)
- Outer ring: thin Border colour
- Cardinal labels: N / E / S / W in DM Sans 10px Text Light at the four cardinal positions
- Orientation arc: a filled arc spanning ±45° either side of the facade direction:
  - S / SW / SE: Emerald Bright fill, 30% opacity
  - E / W: Amber fill, 30% opacity
  - N / NE / NW: Slate fill, 30% opacity
- Needle: a solid line from centre to the aspect position, navy colour, 2px
- Centre dot: 6px filled navy circle

**Below the compass — plain-English implication (one sentence):**
- South: "South-facing — direct winter sun 10am–4pm. Estimated passive heating benefit: 10–15%."
- North: "North-facing — limited direct sun. Combined with local rainfall, elevated damp risk."
- East/West: "East-facing — morning sun only. Good natural light; limited winter solar gain."

### 3.12 Damp Risk Card

A distinct card within the Risk Audit section (alongside ITE Status, Flood Risk, EPC, and VUT Density). This is not a sub-component of the Climate card — it sits in the risk audit grid because it has direct, actionable consequences.

**Layout:**
- Header: 💧 Damp Risk
- Large risk-level word: "Low" / "Moderate" / "High" in the appropriate signal colour
- Score bar (0–100, terracotta fill)
- Contributing factors shown as a mini grid:
  ```
  Orientation:  North-facing    ↑ risk
  Rainfall:     1,050mm/yr      ↑ risk
  Humidity:     78% avg         ↑ risk
  Build year:   1968            ↑ risk
  EPC rating:   D               ~ neutral
  Floor:        Ground          ↑ risk
  ```
- Where score > 55, an amber alert appears below: "Request a professional damp survey before proceeding."
- Where score > 75, a red alert: "High damp risk. North-facing orientation, high annual humidity, and pre-1980 construction are a known combination for structural moisture problems in this region."

### 3.13 Thermal Cost Comparison Card

A card unique to the Climate & Solar section that contextualises the energy cost geographically. Helps buyers understand not just "what will this cost" but "how does this compare to other Spanish cities I might have considered."

```
Annual energy cost estimate for this property

Heating (HDD-based, climate-adjusted)    €680/yr    ████░░░░░░
Cooling (CDD-based, climate-adjusted)    €290/yr    ███░░░░░░░
────────────────────────────────────────────────────────────
Total estimated                          €970/yr

Compare the same property in:
  Madrid          €1,190/yr    ↑ 23% more
  Bilbao          €1,580/yr    ↑ 63% more
  Sevilla         €1,420/yr    ↑ 46% more
  Spain average   €1,340/yr    ↑ 38% more
```

**Layout rules:**
- The two cost bars use the same horizontal bar component as pillar scores: Emerald fill for heating (warming = good), Amber fill for cooling (excessive heat = caution).
- The comparison rows use DM Mono for the EUR figure and DM Sans for the city name and delta.
- Upward arrows (↑) are in Risk colour — always contextualise higher cost as a negative even if expected.
- A footnote: "Estimates use AEMET climate normals, current energy tariffs, and this property's EPC rating and orientation. Actual costs will vary."

---

## 4. Page-by-Page Design Brief

### 4.1 Landing Page

**Purpose:** Convert someone who found Raiz (via shared link or browser extension) into a user who understands the value and completes their first analysis.

**Tone:** Confident, warm, slightly surprising. The headline should feel like something a very smart friend would say — not a marketing slogan.

**Hero section:**
- Full-width, dark navy background with a subtle dot-grid pattern (4% opacity dots at 40px spacing) — spatial depth without heaviness
- **Left column (60%):** Headline in Playfair Display — *"The data that Idealista won't show you."* Two-line subheadline in DM Sans explaining what Raiz does in plain language. Two CTAs: primary Emerald button ("Analyse a property — free") and ghost button ("See an example report")
- **Right column (40%):** An animated preview of the Hidden DNA report scrolling on loop — slow enough to read each section, fast enough to show depth. Not a screenshot — a live HTML/CSS animation of the actual UI. This demonstrates complexity without requiring explanation.

**How it works — three steps:**
Large step numbers in Playfair Display Italic (decorative, large, Navy Light colour). Step 1: Find a property on Idealista or Fotocasa. Step 2: Paste the URL or click the browser extension. Step 3: Get the full Hidden DNA report in seconds. 2–3 sentences per step.

**"What portals don't tell you" section:**
Dark navy background. Grid of 6 insight cards — each a single data signal Raiz reveals: ITE status, flood risk, Catastro gap, NTI signal, True Affordability, Rental Trap. Each: signal name, icon, one-line explanation, Green/Amber/Red badge.

**Pricing section:**
Four tier cards. Pro card has subtle navy border + "Most popular" label in Emerald. Intelligence card has gold accent. Pricing in DM Mono. Monthly/annual toggle.

---

### 4.2 Analyse Page (Model B)

**Layout:** Two-column on desktop (380px left sidebar / flexible right). Single column on mobile.

**Left sidebar — Input panel:**

Section label: "Analyse a property"

URL input: Large, welcoming input field. Placeholder: `idealista.com/inmueble/...`

Tab switch below: `[Single URL]` / `[Multiple URLs]`

Multiple mode: Textarea expanding to accept multiple URLs (one per line). Instructions: "Paste up to 10 Idealista, Fotocasa, or Pisos.com links."

Submit button: Full-width, navy background, Emerald text — "Analyse →". On click: transforms to loading state with subtle pulse animation.

**Recent analyses:** Compact list of last 5. Each row: address (truncated), price, TVI ring XS, time ago.

**Saved comparisons (Pro+):** Compact list. Each row: comparison name, property count, last updated.

**Extension prompt (if extension not detected):** Thin banner, small extension icon, "Get the Raiz extension for Chrome" in DM Sans 12px Text Light. Not aggressive — disappears once installed.

**Right area — Report:**

Before analysis: Useful empty state. Example report teaser (real design, fake data, labelled "Example report"). Below: 3 cards showing the three most common findings.

After analysis: Full Hidden DNA Report (see Section 4.3).

**Batch mode progress state:**
- Animated progress bar at top of panel
- Queued property list: each row starts with a spinner, flips to a completed property card as analysis finishes
- Properties render as they complete — not all at once
- When all complete: "View Comparison →" button appears at top, prominent, Emerald

---

### 4.3 Hidden DNA Report

**This page must work for two modes:**
1. A 60-second scan — user wants the headline verdict
2. A 20-minute deep-dive — user wants every data point

**Structure:**

**Sticky property header (compresses as user scrolls):**
- Full: Photo (48px square) + Address + Municipio/Provincia + Price + TVI Ring LG + source portal badge
- Compressed (on scroll, 48px height): Address + Price + TVI ring only

**Alert banner (below header, full width):**
Red alerts first, then Amber, then Green. Compact pills. On mobile: top 2 alerts + "Show all X alerts" expand.

**Section 1: Financial Intelligence** — *"The real cost of this property"*

Three cards in a row (desktop), stacked (mobile):
- Negotiation Gap Gauge
- Monthly Cost Breakdown
- ICO Eligibility (large "95% Financing Available" in Emerald / "Standard 80% Financing" — with criteria checklist + inline mortgage calculator link)

**Section 2: Risk Audit** — *"What you need to know before you buy"*

2×2 grid of risk cards:
- ITE Building Health: icon + status in large text + date + plain-English implication
- Flood & Climate Risk: map thumbnail (if possible) or risk-level indicator + insurance implication
- Energy Certificate: A–G coloured bar + potential rating + annual cost + grant potential in EUR
- Community & VUT: Density percentage visualised as building cross-section proportion fill + implication for families vs. investors

**Section 3: Raiz Intelligence** — *"The 15 signals"*

The two most important indicators for this property (highest variance from average) shown in hero size above the 3-column grid. Then the full grid.
- Tier 1: Fully visible, all users
- Tier 2: Pro+ full / Free: locked with partial visibility
- Tier 3: Intelligence only / Others: locked with gold badge

**Section 4: Life Proximity** — *"What's around this property"*

Left: Radar chart (360px square on desktop)
Right: Structured proximity list by category (schools, health, transport, nature, amenities)
Below chart: Horizontally scrollable proximity chips — `[🏫 340m to school]` `[🏥 1.2km to GP]`

**Section 5: Pillar Scores** — *"How this property scores"*

9 pillar score bars, stacked. To the right: a small donut chart showing TVI composition by pillar weight.
Below: "Change how these scores are weighted →" — opens mini weight-slider panel. Gateway to the filter preset system.

**Section 6: Future View** — *"What's changing nearby"*

Timeline-style. Each approved infrastructure project within 2km:
```
[Icon] [Project name]  [Status badge]  [Expected: Year]
       Distance + plain-English implication
```

**Section 7: Market Context** — *"How this listing compares"*

- DOM comparison bar vs. municipio average
- Price per sqm vs. postcode median (small inline distribution chart)
- 3 similar property cards with TVI scores

**Mobile sticky bottom bar:**
Price / TVI score / primary alert / Save button / Share button

---

### 4.4 Comparison View

**Entry points:** After batch analysis / clicking Compare on 2+ saved properties / shared comparison link.

**Layout philosophy:** Vertical sections comparing all properties simultaneously. The user reads top to bottom — each section builds the case. Never a horizontal scrolling table.

**Sticky comparison header:**
Horizontal strip of property cards — thumbnail, address, price, TVI ring SM. Remove (×) and "View full report →" per card. "+ Add property" ghost button on the right. This strip stays visible as the user scrolls.

**Section 1: The Verdict** — *"Why each property stands out"*

One card per property, side by side. Each card:
- Strongest indicator in Playfair Display: *"Property A: Best monthly cost"*
- One sentence in DM Sans: *"€180 cheaper per month than Property B once ICO financing, IBI, and energy costs are factored in."*
- Secondary signal: *"Also: only property in school catchment"*

The user must be able to make a shortlist decision from this section alone.

**Section 2: The Decisive Difference**

Navy background, white text. The indicator with the largest variance across the comparison set:

*"These properties differ most on: Community Stability"*

Side-by-side comparison of just that indicator for all properties + plain-English implication. Designed to surface what the user hasn't yet considered.

**Section 3: Radar Overlay**

Life Proximity Wheel with all properties overlaid, each semi-transparent in distinct colours.
Below the radar: weight sliders. Adjusting them causes the radar and ranking to recalculate in real time.
Label: "Adjust these to match your priorities →"

**Section 4: Weighted Ranking**

Ranked list (1st, 2nd, 3rd...) that updates as weights change:
- Property name + address
- TVI score at current weights
- Delta from property above/below

Below: "Change your priorities above to see a different winner"

**Section 5: Risk Dashboard**

Grid: rows = alert types, columns = properties. Green/Amber/Red cell fills. Plain-English row labels. At a glance: any disqualifying risk visible immediately.

**Section 6: Side-by-Side Pillar Scores**

Grouped horizontal bar chart. Each pillar has its own row. Within each row, thin bars for each property adjacently, colour-coded by property.

**Section 7: Indicator Detail Table (expandable)**

Closed by default: "See all 15 indicator scores →"
When expanded: clean table, rows = indicators, columns = properties. DM Mono numbers. Locked indicators shown as `—` with padlock.

**Bottom bar:**
Save comparison (opens name input modal) / Share comparison / Export PDF (Pro+)

---

### 4.5 Map View (Explorer / Intelligence)

**Layout:** Full-viewport map with overlay panels. The map fills the entire viewport — no chrome border.

**Map style:** Custom basemap — navy base, streets in navy-mid, water in blue-grey. The map looks like it belongs to Raiz, not default Mapbox.

**Property pins:** 36px circles. Border colour = TVI-coded (Emerald/Amber/Risk). Interior: price in DM Mono 11px. On hover: mini property card. On click: full property detail.

At high zoom-out: cluster markers with count. Cluster colour = average TVI of cluster.

**Heatmap overlays (toggleable, bottom-right toolbar):**
- TVI density (default on)
- NTI — Neighbourhood Transition Index (off by default)
- Infrastructure Arbitrage (off by default)
- Flood Risk — SNCZI polygons, blue transparent fill
- VUT Density — tourist saturation by postcode

Overlay toggle buttons: pill-shaped toolbar, icon buttons, active = filled state, hover = label tooltip.

**Left sidebar — Filters (320px overlay, backdrop-filter blur):**

Top: Mode presets — `Family` / `Nomad` / `Retiree` / `Investor` horizontal tabs. Active tab: Emerald underline. Small label: "Your priorities, applied."

Price range: Custom dual-handle range slider. Navy handles, white border, Emerald track between handles. DM Mono price values above handles.

Property basics: Bedrooms (1/2/3/4+), type (multi-select pills), seller type toggle.

**Intelligence filters (unique to Raiz):**
- NTI Signal: segmented control — All / Prime Buy / Stable / Risk zones only
- Motivated Seller: threshold slider — "Seller score above: [0–100]"
- ICO eligible only: toggle
- Rental cheaper than buying: toggle

**Right sidebar — Property list (320px overlay):**

"X properties in view" + sort selector (Highest TVI / Lowest price / Most motivated seller / Newest).
Each row: Property Card component. Virtualized for performance.

**Mobile:** Filters → bottom sheet (drag up). Property list → draggable card stack at bottom. Mode presets → horizontal scrollable strip.

---

### 4.6 Browser Extension Panel

**Form factor:** Sliding panel from right edge, 380px wide, full viewport height. Slides in 200ms ease-out. Page dims to 60% opacity behind it.

**Panel header:**
Raiz logotype (Playfair, small) + tier badge + close button (×)

**Loading state:**
Horizontal progress bar in Emerald at top of panel. Three skeleton cards below, pulsing shimmer animation. Label: "Analysing this property..."

**Analysis complete — panel body (condensed Hidden DNA Report):**

Top: Quick verdict strip — TVI ring SM + address + price + top 3 alert pills

Below: 6-card 2×3 grid of the most important data points:
1. Negotiation Gap (gauge, miniaturised)
2. True Affordability (monthly cost headline)
3. ITE Status (icon + status word + implication)
4. Flood Risk (risk level + one-line implication)
5. NTI Signal (prime buy / stable / risk)
6. ICO Eligible (yes/no + deposit required)

Below the grid: Locked indicators section (greyed with padlock icons for Free). For Pro+: all Tier 1 + 2 indicators.

Bottom of panel:
- "Open full report →" button
- Save / Add to comparison / Share icon buttons

**Favourites detection mode:**

When the extension detects the Idealista favourites page:
- Header: "We found X saved properties"
- Compact list of first 5 (address, price, thumbnail)
- "[...and X more]" row
- Two buttons: `Import all to Raiz` (primary Emerald) / `Select properties` (ghost)
- Below: "After import, we'll run a full analysis and open a comparison view"
- Tier gate for Free users: "Batch import requires Pro"

---

## 5. Data Visualisation Standards

### 5.1 Principles

**Every number needs a neighbour.** Never show a raw number without context. "78/100" means nothing. "78/100 — 15% above the average for this municipio" means something.

**Colour carries semantic meaning.** Emerald = good. Amber = caution. Red = risk. Consistent everywhere. Never use these colours decoratively.

**Progressive disclosure.** First: the finding. Second: the score. Third: contributing factors. Fourth: raw data sources. Depth available for those who want it; clean for those who don't.

**Animate on first render, never on refresh.** Charts animate once when entering the viewport. Weight-slider updates change values immediately without re-animating.

### 5.2 Chart Types

**Use:**
- Horizontal bar charts (pillar scores, indicator comparisons)
- Radar charts (Life Proximity Wheel, comparison overlay)
- Custom bespoke gauges (Negotiation Gap, Monthly Cost)
- Small sparklines (price history, DOM trend)
- Filled area charts (price history, Intelligence tier)
- Choropleth heat maps (map overlays)
- Proportion fills (VUT density as building cross-section)

**Do not use:**
- Pie charts
- 3D charts
- Auto-cycling data carousels

### 5.3 Key Visualisation Specifications

**Price History Sparkline (Intelligence):**
120×36px inline area chart. Emerald fill for upward trends, Risk fill for downward. Horizontal baseline. Most recent price marked with a dot. Hover tooltip: date + price.

**DOM Comparison Bar:**
"This property: X days / Area average: Y days" — two horizontal bars, same track width. Delta text below with implication.

**Seasonal Distortion Indicator:**
Horizontal scale from "Below seasonal norm" to "Above seasonal norm." Dot on the scale with % annotated. Calendar icon. Contextual annotation about seasonal patterns for that area.

**NTI Choropleth (map layer):**
Colour scale:
- Deep Emerald: Strong positive NTI (Prime Buy)
- Light Emerald: Mild positive
- Slate: Neutral
- Amber: Mild negative
- Risk Deep: Strong negative
50% opacity — basemap and street names legible beneath.

**Sun Hours Monthly Bar Chart:**
12 vertical bars, full card width, 72px height. Bar colour gradients from Amber Light (winter lows) to Emerald Bright (summer peak). Month initials below in DM Sans 9px. Hover tooltip: month + exact figure. Two annotated callouts beneath: darkest month / brightest month with coloured dots.

**Solar Orientation Compass:**
100px SVG circle. Filled arc ±45° from facade direction — Emerald for south-facing, Amber for east/west, Slate for north-facing. Solid navy needle from centre to aspect position. One sentence plain-English implication below.

**Damp Risk Contribution Grid:**
Within the Damp Risk card, a 2-column mini table showing each contributing factor (orientation, rainfall, humidity, build year, EPC, floor) with an arrow indicator (↑ risk / ↓ risk / ~ neutral). Arrows in risk/emerald/slate colours respectively.

**Thermal Cost Comparison:**
Two horizontal cost bars (Emerald = heating, Amber = cooling) with EUR totals in DM Mono. Comparison rows for 4 other Spanish cities below the divider. Delta shown as percentage with upward arrow in Risk colour. Footnote in DM Sans 10px Text Light.

**Sunshine Hours Map Overlay (Explorer/Intelligence — future):**
A choropleth layer showing annual sunshine hours by municipio across Spain. Colour scale from cool blue-slate (northwest, 1,700 hrs) through amber (inland centre) to deep emerald (southeast, 3,100 hrs). Helps users visually understand the climatic geography of Spain when searching by map. Toggled via the overlay panel.

---

## 6. Tone of Voice in the UI

**Plain language, expert content.** Write for someone intelligent but not a property expert. Never use jargon without explanation. Always say what the number means in practice.

**One finding per sentence.** Never pack two insights into one sentence.

**Active, not passive.** Not "The asking price has been found to be below the Catastro value." Instead: "This property is priced 8% below its Catastro tax value — a strong negotiation signal."

**Acknowledge uncertainty.** When data is estimated or limited, say so. This builds trust more than false precision.

**Sunday morning, not Monday morning.** Curious and exploratory, not urgent or pressured. Never scarcity language. Never dark patterns. The user is making a major life decision — treat it with gravity and care.

**Microcopy examples:**

Alert title: *"This property is priced below its Catastro tax value"*
Alert description: *"The asking price of €179,000 is 8% below the Catastro Valor de Referencia of €194,000. This often indicates a motivated seller — and gives you negotiating leverage if the Catastro value supports the asking price."*

Locked indicator: *"Upgrade to Pro to see the Neighbourhood Transition Index"*
Subtext: *"This indicator tells you whether this area is improving faster than the market has noticed."*

Insufficient data: *"Not enough data yet"*
Subtext: *"This indicator requires at least 4 price observations. It will appear automatically as more data accumulates."*

Empty comparison: *"Add a second property to start comparing"*
Subtext: *"Paste another URL below, or pick from your saved analyses."*

**Climate-specific microcopy examples:**

Sun hours callout: *"2,847 sunshine hours per year — that's 7.8 hours of sun on an average day. December, the darkest month, still averages 4.2 hours daily."*

Heating cost context: *"This property's climate means heating costs are estimated at €680/year — 49% less than the same property would cost to heat in Bilbao."*

North-facing alert title: *"North-facing facade in a high-rainfall location"*
Alert description: *"North-facing properties in areas with over 900mm of annual rainfall and high humidity have an elevated risk of damp and condensation, particularly in older buildings. We recommend commissioning a professional damp survey before exchange."*

Damp risk — moderate: *"Moderate damp risk flagged. This is based on the building's orientation, local annual rainfall, and age. It does not confirm damp is present — it signals you should look carefully and ask the seller directly."*

Extreme heat trend: *"This location averages 34 days above 35°C per year — up from 18 days in the 2000s. Good insulation and cooling capacity matter here."*

Orientation unknown: *"Building orientation not available for this property. We've applied a neutral estimate in energy calculations. If you can confirm the facade direction, this figure will update."*

---

## 7. Motion & Interaction Principles

**Purposeful motion only.** Every animation communicates something. No decorative motion.

**Duration guidelines:**
- Micro-interactions (hover, button presses): 100–150ms
- Component transitions (card expand, panel slide): 200–300ms
- Page transitions: 300–400ms
- Data animations (chart fills, TVI ring): 500–800ms, ease-out

**Easing:** Ease-out for arrivals. Ease-in for departures. Never linear.

**Loading:** Skeleton screens over spinners for content-heavy sections. Skeleton shapes approximate actual content dimensions — no layout shift when data arrives.

**Key moments to design carefully:**

1. **Analysis trigger:** Button transforms to "Fetching..." with progress indicator. Report sections appear sequentially as data arrives — progressive reveal that communicates real work being done.

2. **TVI ring reveal:** Arc fills from zero in 600ms. The single most satisfying moment in the product — design it carefully.

3. **Comparison radar update:** Moving a weight slider causes the radar to transition all shape coordinates over 300ms and the ranking to reorder with a subtle animation. Interaction makes subjectivity tangible and empowering.

4. **Extension panel slide-in:** Panel slides from right over 200ms ease-out. Background dims simultaneously. Header renders first (instant), then skeleton, then progressive data reveal.

---

## 8. Mobile Design Principles

**Navigation:** Bottom tab bar — Analyse / Saved / Compare / Map. Map tab shows upgrade prompt for Free/Pro.

**Report on mobile:** Single-column, full-width cards. Sticky header compresses to address + TVI ring. Sections collapsible.

**Comparison on mobile:** Property strip horizontally scrollable. Sections full-width and sequential — scroll through rather than side by side.

**Touch targets:** Minimum 44×44px. No hover-only interactions on mobile.

**Typography:** All font sizes reduce by 1–2 steps on mobile. H1 56px desktop → 36px mobile.

---

## 9. Accessibility

- Minimum 4.5:1 contrast ratio for all body text
- All alert states: colour AND icon AND text (never colour alone)
- All interactive elements keyboard navigable in logical order
- All charts have text alternatives (data tables behind them)
- All icons have aria-label attributes
- Locked features clearly described for screen readers — not just hidden

---

## 10. Design System Naming Conventions

**Components:** PascalCase — `TviRing`, `AlertPill`, `PillarScoreBar`, `NegotiationGauge`, `IndicatorCard`, `PropertyCard`, `ComparisonView`, `RadarChart`, `MonthlyBreakdownCard`, `LifeProximityWheel`

**Variants:** `TviRing.SM`, `TviRing.LG`, `AlertPill.Green`, `IndicatorCard.Locked`, `PropertyCard.Hovered`

**Colour tokens:** `--emerald-bright`, `--navy`, `--risk`, `--amber`, `--gold`, `--text`, `--text-mid`, `--surface`, `--background`, `--border`

**Spacing tokens:** `--space-1` through `--space-8` → 4 / 8 / 16 / 24 / 32 / 48 / 64 / 96px

---

*This brief covers all six primary screens, all core components, data visualisation standards, tone of voice, motion principles, mobile behaviour, and accessibility. It is designed to be handed directly to a UI designer or design tool without additional context. All product decisions are documented in `DECISIONS.md`. Technical implementation of every component and page is specified in `ARCHITECTURE.md`.*
