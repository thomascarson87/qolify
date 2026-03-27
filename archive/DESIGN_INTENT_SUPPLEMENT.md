# Raiz — Design Intent Supplement
**For use alongside the Stitch-generated PRD. This document takes precedence wherever it conflicts.**

---

## Purpose of This Document

The PRD produced in the first iteration correctly inventories screens, components, and feature gates. What it does not capture is *why* those screens exist and *how* they must feel. This supplement restates the non-negotiable design principles that the PRD must encode. Every decision in the PRD — layout, typography, motion, copywriting, component behaviour — should be traceable back to one of the principles below.

---

## 1. The Emotional Mandate (Read This First)

Every screen in Raiz has a job that is not listed in any component spec. Its job is to move the user from one emotional state to another.

**The reference scenario that governs all design decisions:**

> Think of a Sunday morning. One partner makes coffee. The other opens a laptop. They have a shortlist of four properties they found last week. They open Raiz together and spend an hour going through them — not anxiously, but curiously. They argue gently about whether the school catchment matters more than the commute. They share the comparison link with a friend who bought in Málaga last year. They save the one that wins on their criteria and set a price alert.

This is the experience Raiz must deliver. **Unhurried. Trustworthy. Worth coming back to.**

The design risk is a dashboard that overwhelms. The design opportunity is an interface that thinks alongside the user — surfacing what matters, hiding what doesn't, and translating numbers into decisions.

**Every screen should be assessed against this emotional test:**
- What does the user feel when they arrive at this screen?
- What do they feel when they leave it?
- Does this layout make them feel calm and capable, or pressured and confused?

The PRD must frame each screen with its emotional job before listing its components. This is not optional.

---

## 2. The Three Design References (And What They Actually Mean)

The PRD must not treat these as visual mood-board references. They are **functional principles**.

**Airbnb → Navigation feels like preference, not parameter.**
Filters, weight sliders, and persona presets should feel like the user is describing what they care about to a person, not configuring a database query. Language matters: "What matters most to you?" not "Select filter criteria."

**Bloomberg Terminal → Every number has a purpose. Nothing is decorative without being functional.**
Data density is welcome when it serves comprehension. The rule is not "show less data" — it is "every piece of data shown must have an immediately legible relationship to a decision." If a number doesn't help the user decide something, it should not be on screen.

**New York Times data journalism → Context always shown alongside the figure.**
No score, metric, or data point appears without its plain-English implication. A score of 72 is meaningless. "72 — this building has had no major structural issues reported in 8 years" is information. This is the design standard for every indicator, every chart annotation, and every alert.

---

## 3. Non-Negotiable Interface Rules

These are constraints, not preferences. The PRD must enforce them as hard rules, not stylistic suggestions.

### Rule 1: No Structural Lines
**1px solid borders must not be used for sectioning, dividing content areas, or separating components.**

Boundaries between content areas are defined exclusively through background colour shifts. A `Surface` (#FFFFFF) card placed on a `Background` (#F4F7FB) section creates all the separation needed. This keeps the interface feeling composed and confident rather than clinical.

**The only permitted uses of lines:**
- The 3px left border on AlertPill components (this is a signal element, not a structural divider)
- The 2px bottom-only stroke on focused input fields
- Chart gridlines in data visualisations (at maximum 8% opacity)

If a border seems necessary anywhere else, the solution is to adjust the background colour — not add a line.

### Rule 2: Serif Headlines Are Non-Negotiable
**Playfair Display is the display typeface. It is not interchangeable with DM Sans.**

The three-font system is a deliberate personality decision:
- **Playfair Display** (editorial authority, human warmth) — all H1 and H2 headings, property names in prominent positions, pull-quote callouts
- **DM Sans** (clean, functional, scannable) — body text, UI labels, navigation, buttons, form fields
- **DM Mono** (precision, data integrity) — all numerical values, scores, prices, coordinates

The contrast between Playfair Display and DM Sans is how the platform sounds like a trusted advisor rather than a data terminal. Playfair Display Italic is specifically required for secondary labels, sub-headers, and key callouts — the italic weight carries warmth. Removing it or substituting a sans-serif at any heading level breaks the voice of the product.

### Rule 3: Colour Is a Signal System, Not a Decoration System
Each colour family has one and only one semantic role:

| Colour | Role | Never Used For |
|--------|------|----------------|
| Emerald | Positive outcomes, buy signals, good scores, opportunity | Decoration, brand accents, general UI colour |
| Terracotta / Risk | Risk flags, negative signals, serious concerns | Urgency, emphasis, general warnings |
| Amber | Caution states, pending states, data requiring attention | General interest, highlights |
| Navy | Authority surfaces, navigation, headers, dark backgrounds | Risk or signal communication |
| Gold | Intelligence tier premium indicators, annual plan only | General use |

**Emerald must never appear as a brand colour used decoratively.** When the user sees Emerald, they should think "this is good news about this property." If it appears in navigation, illustrations, or decorative elements, this signal is diluted and the whole scoring system loses meaning.

### Rule 4: Tonal Depth Over Shadow Drama
Elevation and depth are achieved through **layered background tones**, not drop shadows.

Surface hierarchy (from base to raised):
1. `Background` #F4F7FB — page canvas
2. `Surface` #FFFFFF — cards, panels (provides "pop" against the background)
3. Navy surfaces — navigation, hero areas, high-authority zones

Shadows are reserved for **floating elements only** (modals, dropdowns, popovers) and must use the tinted shadow values specified in the design system — never solid or dramatic shadows.

---

## 4. The AlertPill: Data Into Advice

The AlertPill component is where Raiz stops being a data platform and becomes a trusted advisor. It is the most important component in the product and must be specified with more care than any other.

**The "What does this mean?" expansion is mandatory, not optional.**

Every AlertPill has three states:
1. **Collapsed** — dot + title + source tag visible
2. **Expanded** — reveals a 2–3 sentence plain-English explanation: what data source, what it means in practice, what action to consider
3. **Actioned** — dismissed or saved

The expansion is an inline expand that pushes content down. It is not a tooltip, not a modal, not a drawer. It must feel like the platform is leaning across the table to explain something.

**Microcopy standard for expansions:**
Every expansion must answer three questions in plain language:
1. Where does this data come from?
2. What does this mean for this specific property right now?
3. What should I do about it?

**Reference microcopy (these set the quality bar):**

*Alert title:* "This property is priced below its Catastro tax value"
*Expansion:* "The asking price of €179,000 is 8% below the Catastro Valor de Referencia of €194,000. This often indicates a motivated seller — and gives you negotiating leverage if the Catastro value supports the asking price."

*Alert title:* "North-facing facade in a high-rainfall location"
*Expansion:* "North-facing properties in areas with over 900mm of annual rainfall and high humidity have an elevated risk of damp and condensation, particularly in older buildings. We recommend commissioning a professional damp survey before exchange."

*Alert title:* "Moderate damp risk flagged"
*Expansion:* "This is based on the building's orientation, local annual rainfall, and age. It does not confirm damp is present — it signals you should look carefully and ask the seller directly."

**The AlertPill is not a status indicator. It is the platform speaking to the user.** Specify it accordingly.

---

## 5. The TVI Ring: The Single Most Important Moment

The TVI ring reveal — arc filling from zero to score over 600ms ease-out — is described in the brief as "the single most satisfying moment in the product." It must be designed and specified with that intention.

**Why 600ms specifically:** Long enough to feel earned and satisfying. Short enough not to feel slow. This duration is calibrated, not arbitrary. Do not change it.

**The ring is a brand signature.** It appears in three sizes across the product (XS 32px, SM 52px, LG 80px) and must be immediately recognisable in all three. The colour encodes the score range (Emerald 75–100, Amber 50–74, Risk 0–49) and is the user's fastest read on a property's quality. It should feel as natural and immediate as reading a traffic light.

**Hover behaviour in list view is required:** Tooltip reads "TVI: 78/100 — High quality of life relative to price." The TVI score must never appear as a bare number without this context available to the user within one interaction.

---

## 6. The Comparison View: Vertical Narrative, Not Horizontal Table

**This is the most critical structural correction to the first PRD iteration.**

The comparison view must be built as **vertical sections read top to bottom**, not as a horizontal feature-comparison matrix.

**Why this matters:** A horizontal table asks the user to hold multiple columns in their head simultaneously and draw their own conclusions. Raiz's comparison view builds a case, section by section, until the user arrives at a decision having absorbed the argument. The user reads down — each section adds a layer of understanding.

**The required section sequence:**
1. **The Verdict** — one card per property, each stating its strongest signal in one Playfair Display headline and one DM Sans sentence. The user should be able to shortlist from this section alone.
2. **The Decisive Difference** — the single indicator with the largest variance across the comparison set, surfaced automatically. Dark navy background. Forces the user to confront what they haven't considered yet.
3. **Radar Overlay** — Life Proximity Wheel with all properties overlaid. Weight sliders below. Real-time recalculation.
4. **Weighted Ranking** — ranked list that updates as weights change. Includes delta between ranked positions.
5. **Risk Dashboard** — grid: rows = alert types, columns = properties. Green/Amber/Red cells. Any disqualifying risk visible at a glance.
6. **Side-by-Side Pillar Scores** — grouped horizontal bar chart.

**A horizontal scrolling table must not appear anywhere in the comparison view.** If more properties are added than fit the viewport, the sticky header strip (property thumbnails + TVI ring SM) handles navigation. The section content always spans full width.

---

## 7. Locked States: Conversion Moments, Not Paywalls

Locked indicator states are the primary freemium conversion mechanism. They must be designed as **informed desire** — the user should feel the specific value of what they're missing, not just see a generic upgrade prompt.

**Required anatomy for locked IndicatorCard:**
- Indicator name: fully visible
- Score badge: hidden (not present, not blurred)
- Summary sentence: blurred overlay (partial visibility is intentional — the user can almost read it)
- Supporting data: blurred
- Padlock icon: top-right corner
- Unlock line: "Upgrade to Pro to unlock this indicator."
- Value line (critical): One sentence stating the specific intelligence this indicator provides. *"This indicator tells you whether this area is improving faster than the market has noticed."*

**The value line is not a generic "unlock to see more data" message.** It must be specific to each indicator and written to make the user want that specific insight for this specific property. It is doing active sales work. Write it accordingly.

---

## 8. Motion: Four Moments That Must Be Designed

The PRD must not treat animation as a technical implementation detail with generic duration values. These four moments have specific design intent and must be specified explicitly:

**1. Analysis Trigger**
When the user submits a URL, the button transforms to "Fetching..." with a progress indicator. Report sections do not appear all at once — they arrive sequentially as data returns. This progressive reveal communicates that real work is being done. The user should feel the platform working for them, not waiting for a spinner.

**2. TVI Ring Reveal** *(600ms ease-out — do not adjust)*
Arc fills clockwise from zero to the actual score. Plays once per session per property. This is the product's signature moment. It must feel like a reveal, not a load state.

**3. Comparison Radar Update** *(300ms for all coordinate transitions)*
Moving a weight slider causes the radar polygon to smoothly reflow to its new shape, and the property ranking below to reorder. The user should feel that their subjective priorities are directly controlling an objective outcome. This interaction is how the platform makes personal preference feel empowering rather than arbitrary.

**4. Extension Panel Slide-In** *(200ms ease-out)*
Panel slides from right. Background dims simultaneously — not after. Header (address + TVI ring) renders first and instantly. Skeleton screens for each section appear before data. No layout shift when data arrives.

**General rule:** Ease-out for arrivals, ease-in for departures. Never linear. Skeleton screens, not spinners, for content-heavy sections.

---

## 9. Tone of Voice: The Platform Speaks

The platform has a voice. It must be consistent across every alert, label, empty state, locked state, and loading message.

**The register:** A brilliant friend who happens to be a property expert. Not a data terminal. Not a marketing tool. Someone who tells you the truth about a property because they want the decision to go well for you.

**Non-negotiable writing rules:**
- Plain language, expert content. Write for someone intelligent but not a property expert.
- One finding per sentence. Never pack two insights into one sentence.
- Active voice. "This property is priced 8% below its Catastro value" — not "The asking price has been found to be below the Catastro Valor de Referencia."
- Acknowledge uncertainty. When data is estimated, say so. This builds trust more than false precision.
- No scarcity language. No dark patterns. No urgency manufacturing. The user is making a major life decision. The platform's tone should match the gravity of that.
- **Sunday morning, not Monday morning.** Curious and exploratory in tone. Never pressured.

**Every data point shown must have an implication.** Showing "EPC Rating: E" is raw data. Showing "EPC Rating: E — energy costs for this property are estimated 40% above the area average" is intelligence. The platform always delivers the second version.

---

## 10. What the PRD Must Change

Specific corrections required in the next iteration:

| Area | Previous PRD | Required |
|------|-------------|----------|
| Comparison view layout | Horizontal feature matrix | Vertical narrative sections in specified sequence |
| AlertPill | Status indicator component | Advisor component with mandatory expansion behaviour and microcopy standard |
| Locked states | Generic paywall UI | Conversion moment with specific value line per indicator |
| Typography | Font names listed | Playfair Display specified as non-negotiable serif voice with italic use cases called out |
| Borders/dividers | Used casually for structure | Prohibited for structural use; background tonal shifts only |
| TVI ring reveal | Generic animation spec | 600ms ease-out, described as the signature product moment |
| Comparison radar | Not specified | 300ms coordinate transition, real-time weight recalculation |
| Colour system | Style reference | Semantic signal system — emerald/risk/amber never used decoratively |
| Screen-level framing | Component list | Emotional job statement required before any component specification |
| Microcopy | Generic labels | Written to the voice standard; specific examples provided per component |

---

*This supplement is derived from `UI_UX_BRIEF.md` and the design system document "The Informed Curator." It is not a replacement for either — it is a correction layer for the first PRD iteration. The authoritative source for all component specifications, page layouts, and data visualisation standards remains `UI_UX_BRIEF.md`.*
