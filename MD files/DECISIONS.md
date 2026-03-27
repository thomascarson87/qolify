# Qolify — Decision Log

All significant product and technical decisions are recorded here with their rationale.
When a decision is revisited, the previous decision is not deleted — it is marked superseded and a new entry is added.

---

## D-001 — Spain-only market focus (not Spain + UK)
**Status:** Active
**Date:** March 2026
**Decision:** Build for Spain only. Do not attempt a dual Spain/UK product.
**Rationale:** Thomas is based in Málaga with local real estate industry contacts. The Spanish market has higher data opacity and therefore higher intelligence value to unlock. UK data is more transparent and the market is well-served by existing tools (AreaIQ, Xploria, PropertyData). UK expansion is a separate product if ever pursued.

---

## D-002 — User personas as filter presets, not product variants
**Status:** Active
**Date:** March 2026
**Decision:** Young Family, Digital Nomad, Retiree, and Yield Investor are one-click filter configurations applied to the same platform — not separate products, separate UIs, or separate data models.
**Rationale:** A retired couple and a family may look at the same property. Locking users into a persona type before they've seen data creates friction and misrepresents reality. Presets are a convenience, not a constraint.

---

## D-003 — Hybrid product model (Model B first, Model A later)
**Status:** Active
**Date:** March 2026
**Decision:** Build Model B (on-demand URL analysis + browser extension) before Model A (bulk scraping + map portal). Model A is only built after Model B has paying users.

**Model B:** User submits a URL → Parse.bot fetches single listing on-demand → full analysis returned in <10s. No bulk scraping. No stored listing inventory. `analysis_cache` TTL 48h.

**Model A:** Cloudflare /crawl discovers listings in bulk → Parse.bot batch extracts → stored in `properties` table → scored and enriched in background → served via map interface.

**Rationale:**
- Model B can be in users' hands in 8 weeks. Model A requires 6+ additional weeks of pipeline work.
- Model B has substantially lower legal exposure — single user-initiated page fetch vs systematic bulk extraction.
- Model B validates that users find the intelligence layer genuinely valuable before investing in scraping infrastructure.
- Infrastructure costs for Model B are ~€30/month fixed. Model A costs €300-800/month before it generates revenue.
- Model B still seeds the time-series database (`property_price_history`, `zone_metrics_history`) from day one, so temporal indicators are accumulating even before Model A exists.

---

## D-004 — Four product tiers
**Status:** Active
**Date:** March 2026

| Tier | Price | Model | Gate |
|---|---|---|---|
| Free | €0 | B only | 3 analyses/day, 5 Tier 1 indicators |
| Pro | €19/mo | B only | Unlimited analyses, all 15 indicators, PDF, price alerts |
| Explorer | €39/mo | A + B | Map portal, scraped inventory, Tier 1+2 indicators, new listing alerts |
| Intelligence | €79/mo | A + B | Tier 3 temporal indicators, zone dashboards, 500 API calls/month |

**Rationale:** Free tier acquires users at near-zero cost via browser extension. Pro captures serious active buyers (high intent, 1-3 month window). Explorer and Intelligence serve users who want to discover, not just analyse. Annual option (€590/year for Intelligence) offered in Phase 5.

---

## D-005 — Browser extension as primary acquisition channel
**Status:** Active
**Date:** March 2026
**Decision:** The Chrome extension (Manifest V3) + Firefox WebExtension is the primary distribution mechanism for Free and Pro users. It injects an "Analyse with Qolify" button directly into Idealista and Fotocasa listing pages.
**Rationale:** The extension eliminates the context-switch friction of URL-pasting. It also turns Idealista into a distribution channel rather than a competitor — every Idealista user is a potential Qolify user. The extension is submitted to Chrome Web Store in Phase 1 Week 6.

---

## D-006 — Time-series accumulation starts from day one
**Status:** Active
**Date:** March 2026
**Decision:** Every analysis — Model B on-demand and Model A scraped — writes a record to `property_price_history`. The nightly `zone_metrics_history` aggregation cron starts running in Phase 0 even when there is no data to aggregate. This cron must never silently fail.
**Rationale:** The Tier 3 temporal indicators (Price Velocity, Gentrification Confirmation, Seasonal Distortion) require weeks/months of accumulated data. That accumulation must start from the very first free user. The earlier the cron starts, the sooner Intelligence-tier signals are available. Data gaps in time-series cannot be back-filled.

---

## D-007 — Supabase + PostGIS as the database
**Status:** Active
**Date:** March 2026
**Decision:** All data lives in Supabase (PostgreSQL + PostGIS). No separate spatial database. No Redis for primary data storage (only rate limiting via Upstash).
**Rationale:** PostGIS handles all spatial queries (proximity, polygon intersection) natively. Supabase provides built-in auth, RLS, real-time, and a JavaScript client — eliminating multiple infrastructure dependencies. The `GEOGRAPHY(POINT, 4326)` type with spatial indexes keeps proximity queries fast at national scale.

---

## D-008 — All spatial queries in PostGIS, never in application code
**Status:** Active
**Date:** March 2026
**Decision:** Distance calculations, radius searches, and polygon intersections are always performed in SQL using PostGIS functions (`ST_DWithin`, `ST_Distance`, `ST_Intersects`). Never calculate distances in JavaScript or Python application code.
**Rationale:** Correctness (PostGIS handles coordinate system projections correctly), performance (spatial indexes are used only when queries are in SQL), and maintainability.

---

## D-009 — Analysis cache shared across users
**Status:** Active
**Date:** March 2026
**Decision:** `analysis_cache` rows are keyed by `source_url` and shared across all users. If two users analyse the same URL within the 48h TTL, the second request is served from cache at zero Parse.bot cost.
**Rationale:** Cost efficiency. A popular Idealista listing might be submitted by dozens of users. The analysis result is not user-specific (it is property-specific). Users link to cache entries via `user_analyses`. User-specific data (saved status, notes) lives in `user_analyses`, not in the cache itself.

---

## D-010 — Tier gating at the API layer, not the database
**Status:** Active
**Date:** March 2026
**Decision:** Tier access is enforced in Next.js API routes by checking the `tier` field in the Supabase JWT claim. Database tables themselves are publicly readable (QoL data) or protected by RLS (user data). There is no database-level filter that hides data from lower tiers.
**Rationale:** Simpler database queries. Tier logic lives in one place (API routes). RLS protects user PII. QoL data is not sensitive and does not need row-level hiding.

---

## D-011 — Composite indicators in JSONB for Model B, separate table for Model A
**Status:** Active
**Date:** March 2026
**Decision:** For Model B, all 15 composite indicator results are stored as JSONB inside `analysis_cache.composite_indicators`. For Model A, they are stored as individual columns in the `composite_indicators` table (which references `properties.id`).
**Rationale:** Model B analyses are transient (48h TTL) and not queried by individual indicator fields. JSONB is appropriate. Model A indicators need to be queryable by individual fields (e.g. `WHERE nti_signal = 'prime_buy'`) for map filtering — individual columns with indexes are required.

---

## D-012 — Portugal excluded from scope
**Status:** Active
**Date:** March 2026
**Decision:** Portugal is not in scope, even though it shares a peninsula with Spain and has similar data infrastructure. Spain only.
**Rationale:** Data sources are entirely separate (Portuguese Catastro equivalent, different government APIs, different legal framework). Scope management.

---

## D-013 — No photo hosting
**Status:** Active
**Date:** March 2026
**Decision:** Qolify does not re-host property photos. Property detail pages in Model A link back to the source portal for photos.
**Rationale:** Re-hosting photos is legally high-risk (copyright infringement) and storage-expensive. It is also unnecessary — the intelligence layer is the product, not the photos.

---

## D-014 — Model A go/no-go gate at Phase 3
**Status:** Active
**Date:** March 2026
**Decision:** Model A (scraping pipeline + map portal) is only built if Phase 3 validation criteria are met: €500+/month in Pro revenue OR strong qualitative evidence from user interviews that map-based discovery is wanted.
**Rationale:** Prevents overbuilding. The Phase 3 gate ensures real user demand drives the most expensive infrastructure investment.

---

## D-015 — Shareable report URLs require no auth
**Status:** Active
**Date:** March 2026
**Decision:** `/report/:cacheId` pages are publicly accessible without authentication. Any user (including non-Qolify users) can view a shared report link.
**Rationale:** Shareable reports are a distribution mechanism. A user shares a link with their partner, family member, or solicitor. That person viewing the report is a potential Qolify user. Requiring auth on shared links kills the sharing behaviour.
**Limitation:** Cache entries expire at 48h. Shared links become dead after expiry. This is acceptable at MVP — persistent shareable links are a Pro+ feature consideration for Phase 3+.

---

## D-016 — Validation gate for Tier 3 temporal indicators
**Status:** Active
**Date:** March 2026
**Decision:** Tier 3 indicators (Price Velocity, Gentrification Confirmation, Seasonal Distortion) are shown as "Not yet available — requires more data" when insufficient history exists. They are never hidden or removed from the UI.
**Rationale:** Transparency. Users should know these signals exist and understand why they are not yet calculated. "Not yet available" is more informative than absence. Confidence improves automatically as data accumulates — this is communicated to users.

---

## D-017 — No Okupa risk data at launch
**Status:** Active (backlog item)
**Date:** March 2026
**Decision:** Okupa (squatter) risk is identified as a valuable signal but is not included in the MVP. It is a backlog item.
**Rationale:** No structured data source exists. It requires NLP on local news and community forums (Facebook groups, ForoCoches). This is a significant engineering effort for a qualitative signal. Deferred to post-Phase 6.

---

## D-018 — ITE coverage launched with Madrid + Barcelona only
**Status:** Active
**Date:** March 2026
**Decision:** ITE (building inspection) data is scraped from Madrid and Barcelona ayuntamiento portals first. Other municipalities are added progressively. Properties with no ITE data show "Not available in this municipality" rather than a blank.
**Rationale:** Madrid and Barcelona portals are the most structured and highest volume. National ITE data coverage is patchy and inconsistent. Partial data with transparent gaps is better than false completeness.

---

## D-019 — Favourite list ingestion: method priority order
**Status:** Active
**Date:** March 2026
**Decision:** Qolify supports importing a user's existing saved property lists from Idealista/Fotocasa via three methods, prioritised in this order:

1. **Extension auto-detect of favourites pages (primary):** When the user visits their Idealista or Fotocasa saved listings page (`idealista.com/usuario/anuncios-favoritos`, `fotocasa.es/mis-favoritos`), the extension detects the URL pattern, scrapes all property URLs from the page DOM within the user's own browser session, and offers a one-click "Import X saved properties to Qolify" panel. No server-side scraping. No portal API. The user is reading their own data in their own browser.

2. **Share-list URL import (secondary):** Idealista's "Compartir lista" feature generates a shareable URL. Qolify accepts these URLs in the batch input field, fetches the page, extracts all property URLs, and imports them as a batch. Enables collaborative use — a couple or buyer+solicitor can share a shortlist and get a comparison report in one action.

3. **Multi-URL paste (always available):** A text field that accepts multiple property URLs (newline or comma separated). No extension required. Works with any portal. Lowest friction for users who want to quickly compare 2-5 specific properties.

**Method 4 (future — D-F06):** Portal OAuth API integration, requiring a formal commercial partnership with Idealista/Fotocasa. Not viable at current scale. Revisit post-Explorer launch.

**Rationale:** Method 1 has the best UX but requires the extension. Method 3 is always available and requires no infrastructure beyond the existing `/api/analyse` endpoint. Shipping Method 3 in Phase 1 and Method 1+2 in Phase 2 gives users value immediately while the full experience is built.

---

## D-020 — Batch analysis limits by tier and comparison persistence
**Status:** Active
**Date:** March 2026
**Decision:** Batch analysis (multiple URLs processed together) is a Pro+ feature. Limits by tier:

| Tier | Batch limit | Saved comparisons |
|---|---|---|
| Free | Not available | — |
| Pro | 10 URLs per batch | 3 saved |
| Explorer | 25 URLs per batch | Unlimited |
| Intelligence | 50 URLs per batch | Unlimited |

Comparisons are stored in the `comparisons` table and are shareable via a `share_token` (public URL, no auth required to view — same logic as shareable report links per D-015).

The comparison view is not a raw data table. It surfaces:
- A "Why This One" plain-English summary card per property
- A radar chart overlay of all properties against the user's active filter weights
- A weighted ranking that recalculates in real time when the user adjusts weights
- A "decisive difference" highlight — the single factor with the largest variance across the comparison set

**Rationale:** Comparisons are the highest-value output Qolify can produce — they directly answer "which one should I buy?" rather than "is this one good?" Limiting to Pro+ is appropriate because the feature requires multiple analyses (cost) and delivers disproportionate value (willingness to pay). Shareable comparison links enable organic distribution — buyers sharing shortlists with partners and solicitors are a natural growth channel.

---

---

## D-021 — Weather, solar, and orientation data integrated into Indicator 8
**Status:** Active
**Date:** March 2026
**Decision:** Indicator 8 is renamed from "Climate Resilience Score" to "Climate & Solar Score" and substantially expanded to incorporate six sub-components: annual sunshine hours and monthly distribution (AEMET), Heating Degree Days (HDD), Cooling Degree Days (CDD), building solar orientation (Catastro footprint geometry), the Damp Risk Index (a new sub-indicator combining rainfall × humidity × orientation × build age × EPC), and extreme heat days with trend direction.

The existing Indicator 1 (True Affordability Score) energy cost calculation is updated to use climate-adjusted HDD/CDD/orientation data rather than the crude EPC-only estimate. A south-facing property in Málaga and a north-facing property in Burgos with identical EPC ratings have materially different annual energy bills — the new formula captures this difference accurately.

Three new data sources are added: AEMET Open Data API (climate normals), PVGIS JRC REST API (solar irradiance by coordinate), and Catastro building footprint geometry (facade orientation derivation). ERA5 Copernicus reanalysis is used as a gap-fill where AEMET station coverage is sparse.

Three new database tables are added:  (per-municipio AEMET normals),  (PVGIS coordinate-level GHI cached at 0.01° resolution),  (facade aspect per ref_catastral).

The  reference table is expanded to include energy tariff constants (gas and PVPC electricity price per kWh) and EPC U-value coefficients, replacing hardcoded values in the indicator engine.

**Rationale:** Spain has one of the most climatically variable territories in Europe — from sub-2,000 sunshine hours in Galicia to over 3,100 in Almería; from 250 HDD in Málaga to 2,400 in Burgos. This variation directly affects energy bills, quality of life, structural risk (damp, mould), and the financial case for purchase. A buyer relocating from the UK to Seville vs. Bilbao is making an order-of-magnitude different climate decision, and the current platform provides no way to understand or compare this. The Damp Risk Index specifically addresses a common and costly hidden problem in Spanish properties (particularly north-facing, older stock in high-humidity regions) that no other platform flags pre-purchase.

**Build phase:** Phase 2. Climate data is static (annual refresh) and can be loaded nationally in Phase 0 alongside other QoL reference tables. Solar radiation is queried per-analysis via PVGIS API. Building orientation from Catastro requires per-property lookup at analysis time; falls back to "unknown" gracefully.

---

## Future Decisions (pending)

These decisions need to be made before the relevant phase begins:

- **D-F01** — Which mortgage broker(s) to partner with for ICO lead generation (Phase 3)
- **D-F02** — Stripe pricing: monthly only vs monthly + annual discount (Phase 3)
- **D-F03** — Which regional VUT registries to scrape beyond Andalucía, Madrid, Catalunya, Valencia (Phase 1)
- **D-F04** — Whether to pursue commercial data licensing with Idealista before Explorer tier reaches 500 subscribers (Phase 4)
- **D-F05** — NLP approach for BOE gazette extraction: Claude API vs spaCy vs fine-tuned model (Phase 5)
- **D-F06** — Portal OAuth API integration for direct favourites sync (requires commercial partnership — revisit post-Explorer launch)
