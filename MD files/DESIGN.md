# DESIGN.md: The Informed Curator Design System

## 1. Overview & Creative North Star: "The Editorial Advisor"
This design system is built to transform complex data into a "Sunday Morning" experience—quiet, high-fidelity, and profoundly capable. It rejects the frantic, line-heavy aesthetic of traditional SaaS in favor of an **Editorial Advisor** approach.

### Creative North Star
Our North Star is **The Digital Curator**. The UI should feel like a high-end physical broadsheet or a private banking terminal: spacious, intentional, and authoritative. We achieve this by prioritizing white space, leveraging high-contrast typography tension, and replacing rigid structural lines with soft tonal layering.

---

## 2. Colors & Surface Philosophy
Color is used with restraint to maintain the "Sunday morning" calm. It is never decorative; it is always functional.

### The "No-Line" Rule
**1px structural borders are prohibited.** Hierarchy must be established through tonal shifts.
- A `#FFFFFF` (Surface-Container-Lowest) card should sit on a `#F7FAFE` (Surface) background.
- For deeper nesting, use `surface-container-low` (#F1F4F8) or `surface-container` (#EBEEF2).

### Color as Signal
We use a semantic color palette that serves as an immediate advisor to the user:
- **Navy (`primary` #0D2B4E):** Authority. Used for primary actions and key structural headers.
- **Emerald (`secondary` #006D37):** Positive/Opportunity. Used for growth, health, and "Go" signals.
- **Terracotta (`tertiary_fixed_dim` #FFB4A6):** Risk/Negative. Used for warnings and critical data points.
- **Amber:** Caution. Used for "Informed Desire" or items requiring attention.

### Surface Hierarchy & Glassmorphism
To create a prestige feel, floating elements (Modals, Popovers) should utilize a **Glassmorphism** effect:
- **Surface:** Semi-transparent `primary_container` (at 80% opacity) with a `24px` backdrop-blur.
- **Texture:** Use a subtle gradient transition from `primary` to `primary_container` on hero CTA buttons to provide "soul" and depth.

---

## 3. Typography Tension
The system relies on the tension between a sophisticated serif and a functional sans-serif.

| Level | Font Family | Role |
| :--- | :--- | :--- |
| **Display** | *Playfair Display* (Serif) | High-end editorial voice. Large, confident statements. |
| **Headline** | *Playfair Display* (Serif) | Section headers. Narrative and storytelling. |
| **UI/Title** | *DM Sans* (Sans) | Interface logic. Actionable titles and navigation. |
| **Body** | *DM Sans* (Sans) | Long-form reading and descriptive text. |
| **Data** | *DM Mono* (Monospace) | Precise numbers, percentages, and Catastro values. |

*Note: Use `display-lg` (3.5rem) for hero moments to create an intentional asymmetry against smaller, tightly-tracked `label-md` UI elements. Use Playfair Display **Italic** weight for sub-headers, pull quotes, and secondary callouts — the italic carries warmth and editorial authority together.*

---

## 4. Elevation & Depth: Tonal Layering
Depth is not a shadow; it is a relationship between surfaces.

### The Layering Principle
Stacking tiers is the primary method of separation.
- **Tier 0:** `surface` (#F7FAFE) — The canvas.
- **Tier 1:** `surface-container-low` (#F1F4F8) — Secondary content zones.
- **Tier 2:** `surface-container-lowest` (#FFFFFF) — Primary interactive cards.

### Ambient Shadows
Where physical lift is required (e.g., a floating Advisor Pill), use an **Extra-Diffused Ambient Shadow**:
- `box-shadow: 0 12px 40px rgba(13, 43, 78, 0.06);`
- Shadows must never be pure black; they should be a tinted variant of the `primary` navy (`#0D2B4E`) at low opacity to mimic natural light.

---

## 5. Signature Components

### The Advisor AlertPill
A unique component that bridges the gap between a notification and a tooltip.
- **Static State:** A small, high-contrast pill with a semantic icon.
- **Expansion Behavior:** On interaction, it expands horizontally then vertically to reveal "What does this mean?"—providing the logic behind the data. This expansion is an inline push (not a tooltip, not a modal). It must answer three things in plain language: where the data comes from, what it means for this specific property, and what action to consider.

### The TVI Ring
Our proprietary data visualization.
- **Motion:** Must utilize a **600ms reveal** using a `cubic-bezier(0.34, 1.56, 0.64, 1)` easing. It should feel like it is "filling" with intent, not just appearing.
- **Colour logic:** Emerald Bright (`#34C97A`) for scores 75–100 / Amber for 50–74 / Risk (`#C94B1A`) for 0–49.
- **Sizes:** XS 32px (map pins, list rows) / SM 52px (property cards) / LG 80px (report header, comparison cards).

### Narrative Navigation
Traditional horizontal feature tables are forbidden.
- **The Rule:** Comparisons must be **vertical and narrative**.
- Users should scroll through a story where Property A's "Flood Risk" is explained in a full-width block, followed immediately by Property B's context.
- The required section sequence for the Comparison View is: (1) The Verdict, (2) The Decisive Difference, (3) Radar Overlay with weight sliders, (4) Weighted Ranking, (5) Risk Dashboard, (6) Side-by-Side Pillar Scores.

### Locked States: "Informed Desire"
Locked data is not a "paywall"; it is a moment of desire.
- **Styling:** Use a `surface-variant` blur over the sensitive data. The indicator name remains fully visible. The score badge is hidden entirely (not blurred).
- **Copywriting:** Must be value-driven. The unlock line names the specific intelligence being withheld for this indicator (e.g., *"Unlock the Catastro Gap to see if you are overpaying by €20k+"* rather than *"Upgrade to Pro"*). This line is doing active conversion work — write it accordingly per indicator.

### Input Fields & Lists
- **No Dividers:** Lists should be separated by `spacing-4` (1.4rem) or subtle background shifts.
- **Inputs:** Use `surface-container-lowest` (#FFFFFF) for the field background on a `surface` canvas. No 1px borders—use a `2px` focus ring of `primary_fixed` when active.

---

## 6. Do's and Don'ts

### Do
- **Do** use `Playfair Display` for questions and editorial statements (e.g., "Is this property a Rental Trap?").
- **Do** use `Playfair Display Italic` for sub-headers, secondary callouts, and pull quotes to inject human, editorial warmth.
- **Do** lean on `spacing-12` (4rem) and `spacing-16` (5.5rem) to let the layout breathe.
- **Do** use `secondary_container` (#93F4AC) for "Opportunity" tags to create a soft, high-end highlight.

### Don't
- **Don't** use a 1px line to separate a header from a body. Use white space.
- **Don't** use signal colors (Emerald/Terracotta) for decorative icons. If it's red, it must mean "Risk." If it's emerald, it must mean "Opportunity." These colours lose their power the moment they appear decoratively.
- **Don't** use standard "Drop Shadows." If the surface doesn't pop via tonal shift, rethink the layout.
- **Don't** align data horizontally in a table. Tell the story vertically.
- **Don't** substitute `Playfair Display` with any other serif. The specific warmth of this face is a non-negotiable brand decision.
- **Don't** use pure black or pure grey for any neutral. Every neutral must be tinted with the Navy (`#0D2B4E`) palette to maintain tonal harmony.
