# Design System Strategy: The Informed Curator

## 1. Overview & Creative North Star
The "Informed Curator" is the driving philosophy behind this design system. We are moving away from the "SaaS-dashboard-in-a-box" aesthetic toward a high-end editorial experience. This system balances the heavy-weight authority of a financial terminal with the unhurried, human warmth of a prestige architectural magazine.

To break the "template" look, we prioritize **intentional asymmetry** and **tonal depth**. Rather than a rigid grid of identical boxes, layouts should feel composed. Use wide gutters (`spacing-12` to `spacing-20`) to create "breathing room" that signals confidence. Large, serif display type should overlap subtly with secondary containers to create a sense of physical layering and sophisticated craftsmanship.

---

## 2. Colors & Surface Philosophy
The palette is rooted in `Navy Deep` and `Emerald Bright`, but its premium feel comes from how these tones are layered, not just applied.

### The "No-Line" Rule
Explicitly prohibit 1px solid borders for sectioning. Boundaries must be defined solely through background color shifts. For example, a `surface-container-low` section sitting on a `surface` background provides all the separation a user needs. This keeps the interface feeling "unhurried" and soft rather than clinical.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers—like stacked sheets of heavy-stock paper.
- **Base:** `surface` (#f9f9ff)
- **Secondary Areas:** `surface-container-low` (#eff3ff)
- **Actionable Cards:** `surface-container-lowest` (#ffffff) to provide a "pop" of clean white against the off-white base.
- **Deep Content:** `surface-dim` (#cfdaf0) for utility sidebars or footer areas.

### The "Glass & Gradient" Rule
To avoid a flat, "cheap" digital feel:
- **Glassmorphism:** Use `surface-container-highest` at 70% opacity with a `24px` backdrop blur for floating navigation bars or property detail overlays.
- **Signature Textures:** For primary CTAs and hero headers, use a subtle linear gradient (135°) transitioning from `primary` (#006d3c) to `primary-container` (#34c97a). This adds a "visual soul" and dimension that flat color cannot replicate.

---

## 3. Typography
Our typography is a conversation between the academic (`newsreader`) and the functional (`manrope`).

- **Display & Headlines (Newsreader):** Used for property titles and high-level insights. Use *Italic* weights for sub-headers to inject a human, editorial touch.
- **Body & UI (Manrope):** Used for descriptions and interface elements. It provides a clean, modern contrast to the serif headings.
- **Data/Numbers (DM Mono):** For financial figures and coordinates. The fixed width ensures that columns of numbers align perfectly, conveying "Bloomberg-level" data integrity.

| Role | Font | Size | Intent |
| :--- | :--- | :--- | :--- |
| **Display-LG** | Newsreader | 3.5rem | High-impact property hero titles. |
| **Headline-MD** | Newsreader | 1.75rem | Section headers; authoritative but soft. |
| **Title-SM** | Manrope | 1.0rem | Bold weight; used for UI labels and card titles. |
| **Body-MD** | Manrope | 0.875rem | Standard reading text; optimized for legibility. |
| **Label-SM** | Manrope | 0.6875rem | Uppercase with 5% letter spacing for metadata. |

---

## 4. Elevation & Depth
Depth is achieved through **Tonal Layering** rather than structural lines.

- **The Layering Principle:** Place a `surface-container-lowest` card on a `surface-container-low` section. The contrast is enough to define the shape without visual noise.
- **Ambient Shadows:** For floating elements (Modals, Popovers), use highly diffused shadows.
    - **Value:** `0px 20px 40px rgba(17, 28, 44, 0.06)`
    - This uses a tinted version of the `on-surface` color to mimic natural light.
- **The "Ghost Border" Fallback:** If accessibility requires a border (e.g., in high-contrast modes), use `outline-variant` at **15% opacity**. Never use a 100% opaque border.

---

## 5. Components

### Cards & Lists
**Forbid the use of divider lines.**
- Separate list items using `spacing-3` of vertical white space.
- Use a `surface-container-low` background on hover to indicate interactivity.
- Property cards should use `xl` (1.5rem) border radii to feel approachable.

### Buttons
- **Primary:** Gradient from `primary` to `primary-container`. White text. Roundedness: `full`.
- **Secondary:** `surface-container-high` background with `on-primary-container` text.
- **Tertiary:** No background. `primary` text with an underline that only appears on hover.

### Input Fields
- Use `surface-container-lowest` as the fill. 
- Instead of a persistent border, use a `2px` bottom-only stroke in `outline-variant` that transforms into `primary` on focus.
- Labels use `label-md` in `on-surface-variant`.

### Property Risk Indicators
- **Emerald (Positive):** Use for yield and growth.
- **Terracotta (Risk):** Use for high-risk flags. Pair with `tertiary-container` (#ff9571) as a soft background glow behind the text to make the warning feel serious but not "alarming."

---

## 6. Do’s and Don’ts

### Do
- **Do** use `Newsreader Italic` for secondary labels to add an editorial "voice."
- **Do** use asymmetric padding. For example, a card might have `24px` padding on the top/left but `40px` on the bottom to create a custom, "designed" look.
- **Do** lean into the `8.5rem` (`spacing-24`) margin for major page sections. Space is a luxury; use it.

### Don't
- **Don't** use pure black or pure grey. Every "neutral" must be tinted with the `Navy Deep` or `Slate` palette to maintain tonal harmony.
- **Don't** use standard 4px or 8px border radii. This system demands the "softness" of `12px` (`md`) to `24px` (`xl`).
- **Don't** use icons as purely decorative elements. Every icon must serve a functional purpose and be styled with a `1.5px` stroke weight to match the weight of `Manrope`.