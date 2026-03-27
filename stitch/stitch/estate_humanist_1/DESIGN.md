# Design System Documentation

## 1. Overview & Creative North Star: The Informed Curator

This design system is built upon the philosophy of **"The Informed Curator."** It is a visual language designed to evoke the feeling of a calm Sunday morning spent with a high-end architectural digest or a specialized financial briefing. It is authoritative but deeply human; it manages data-density not through rigid grids, but through editorial elegance.

### Creative North Star
Our North Star is **Expert Trust through Tonal Depth.** We break the traditional "software template" look by favoring intentional asymmetry and organic layering over sterile, boxed-in layouts. By replacing structural lines with background shifts, we create an interface that feels like a singular, cohesive environment rather than a collection of disparate components.

---

## 2. Colors & Surface Philosophy

The palette is rooted in a high-contrast relationship between authoritative Navy and soft, atmospheric neutrals. 

### The "No-Line" Rule
**Prohibit 1px solid borders for sectioning.** Boundaries must never be explicit lines. Instead, define space through background color shifts. 
- Use `surface-container-lowest` (#FFFFFF) for primary cards and interaction areas.
- Use `background` (#F7FAFE) or `surface-container-low` (#F1F4F8) for the global canvas.
- Separation is achieved when a light surface sits on a slightly deeper background, creating a natural edge.

### Surface Hierarchy & Nesting
Treat the UI as a physical stack of fine paper. 
- **Tier 1 (Base):** `background` (#F7FAFE)
- **Tier 2 (Sections):** `surface-container` (#EBEEF2)
- **Tier 3 (Interactive Elements):** `surface-container-lowest` (#FFFFFF)

### Glass & Gradient Accents
To provide a "signature" feel, floating navigation or modal overlays should use **Glassmorphism**. Apply a semi-transparent `surface` color with a `backdrop-filter: blur(12px)`. 
For high-level CTAs or Hero sections, use subtle linear gradients transitioning from `primary` (#001631) to `primary-container` (#0D2B4E) to add "visual soul" and depth.

### Functional Signaling
- **Signal (The Pulse):** Emerald (#34C97A / `secondary`) is used exclusively for positive trends, growth, and completion. It is a signal, not a decorative brand color.
- **Alert (The Risk):** Use `tertiary` (#C94B1A) for risk and `Amber` (#D4820A) for warnings. These should be high-contrast against the soft surfaces to demand attention without breaking the editorial flow.

---

## 3. Typography: The Editorial Voice

We utilize a tri-font strategy to balance warmth, functionality, and precision.

| Category | Font Family | Role | Character |
| :--- | :--- | :--- | :--- |
| **Display & Headline** | `Newsreader` (Serif) | H1, H2, H3 | Warmth, authority, and editorial "soul." |
| **Sub-headers** | `Newsreader Italic` | Callouts, secondary labels | Humanist, "hand-curated" feel. |
| **Functional UI** | `Manrope` (Sans) | Body, Title, Buttons | Modern, neutral, and highly readable. |
| **Data & Numbers** | `DM Mono` | Metrics, price points | Technical precision and data-density. |

**Scale Tip:** Use a high-contrast scale. A `display-lg` headline at 3.5rem should feel significantly more "important" than the `body-md` text to create a sense of hierarchy that guides the reader like a news article.

---

## 4. Elevation & Depth

We eschew traditional drop shadows in favor of **Tonal Layering**.

### The Layering Principle
Depth is achieved by "stacking" the surface tokens. A `surface-container-lowest` (#FFFFFF) card placed on a `surface-container-low` (#F1F4F8) background creates a soft, discernible lift without any CSS effects.

### Ambient Shadows
Shadows are reserved for "floating" elements only (e.g., Modals, Dropdowns). 
- **Style:** Extra-diffused, large blur (24px - 40px).
- **Color:** Shadows must be a tinted version of `on-surface` (#181C1F) at 4-8% opacity. Never use pure black or grey.

### The "Ghost Border"
If accessibility requires a container boundary (e.g., a search input), use a **Ghost Border**.
- **Token:** `outline-variant` (#C4C6CF).
- **Opacity:** 10-20% only. It should be "felt" rather than "seen."

---

## 5. Components

### Buttons
- **Primary:** `primary` background (#001631) with `on-primary` text. Use `ROUND_EIGHT` (8px). 
- **Secondary:** `surface-container-high` background with `primary` text. No border.
- **Tertiary:** Text-only in `primary`, using `Newsreader Italic` for a more curated, editorial feel.

### Cards & Lists
- **Strict Rule:** Forbid divider lines. Use `spacing-6` (1.3rem) to `spacing-8` (1.75rem) to separate list items.
- Use `surface-container-lowest` for cards. On hover, transition the background to `surface-bright` or apply a subtle `ambient shadow`.

### Input Fields
- Avoid the "box" look. Use a `surface-container-low` background with a `ghost border`.
- Focus state: Change background to `surface-lowest` and apply a 1px `primary` shadow-glow (not a border).

### Data Visualizations
- Use `DM Mono` for all axes and legends.
- Use `Emerald` for growth lines and `Navy` for historical or baseline data.

---

## 6. Do's and Don'ts

### Do
- **Do** lean into white space. If a layout feels crowded, increase spacing before adding a line.
- **Do** use `Newsreader Italic` for editorial asides or secondary captions to add warmth.
- **Do** utilize the `surface-container` tiers to create hierarchy in complex dashboards.
- **Do** ensure all data/numbers are set in `DM Mono` for perfect character alignment in tables.

### Don't
- **Don't** use 1px solid borders to separate content sections.
- **Don't** use high-contrast drop shadows.
- **Don't** use Emerald (#34C97A) as a background for large surfaces; it is a signal for data, not a branding paint.
- **Don't** align everything to a rigid center. Intentional left-alignment with asymmetric "curated" blocks feels more premium.