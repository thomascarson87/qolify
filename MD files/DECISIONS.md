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

## D-022 — Progressive streaming as the analysis loading pattern
**Status:** Active
**Date:** March 2026
**Decision:** Property analysis results are returned to the user progressively as each indicator resolves — not as a single all-or-nothing response. The analyse page and browser extension panel both implement a two-phase render:

**Phase 1 — Instant skeleton (0ms):** On URL submission, the report layout renders immediately as skeleton screens. Skeleton shapes match actual card dimensions to prevent layout shift when data arrives. The TVI ring renders as a grey arc with a pulsing shimmer.

**Phase 2 — Progressive data arrival:** Indicators resolve and populate their cards as data becomes available. Two natural speed tiers exist based on data source:

| Speed | Indicators | Reason |
|---|---|---|
| Fast (~500ms) | Health Security, Education Opportunity, Structural Liability, Digital Viability, Expat Liveability | Pure PostGIS lookups on indexed local tables |
| Slower (~2–5s) | True Affordability | 5 sequential DB queries + energy cost calculation + Catastro enrichment |

Fast indicators populate first. True Affordability populates last. The TVI ring arc reveals at full score only once all contributing indicators have resolved. If True Affordability is still pending, the TVI ring holds at the partial score with a subtle amber pulse on the arc and label: "Calculating affordability..."

**Phase 0 fallback (MVP):** While streaming infrastructure is not yet built, the analyse page shows an honest wait state: a labelled step-by-step progress indicator ("Fetching listing... ✓ / Checking flood risk... ✓ / Calculating true monthly cost...") with an estimated wait of 1–2 seconds (validated baseline from CHI-327 testing). This is acceptable at MVP and is replaced by true streaming in Phase 1.

**Indicator failure handling (applies in all phases):** No single indicator failure blocks the overall response. Each indicator resolves independently inside `Promise.all`. If a data source is unavailable (external API timeout, PostGIS query error, missing Catastro record), that indicator's card renders as "Data unavailable" with a brief explanation — all other indicators continue to load normally. The TVI ring is calculated from whichever indicators did resolve; the score is flagged as partial if any contributing indicator failed. Silent swallowing of errors is not acceptable — every failure must surface visibly to the user and be logged server-side.

**User-selected indicators:** Users do not select which indicators to run before submitting. Indicator selection is implicitly handled by tier (Free: 5 Tier 1 indicators, Pro+: all 15). Running fewer indicators on demand is not a user-facing control — it adds friction before the user has seen any value. The tier gate achieves the same DB cost outcome without UX complexity.

**Rationale:** A multi-second all-or-nothing wait reads as broken on a modern web product. Progressive disclosure of results makes the wait feel productive — users see health, schools, and structural risk in under a second, and the product feels alive. The natural two-speed split in the indicator engine (PostGIS lookups vs. multi-query affordability calculation) maps directly onto a clean progressive reveal without artificial complexity. Skeleton screens prevent layout shift and set accurate expectations for content shape before data arrives. Isolating indicator failures prevents one unreliable data source (e.g. a flaky external API) from degrading the entire analysis — partial results are almost always more useful than a total failure.

---

## D-023 — Map UX: profile-driven amenity layers + click-to-explore, not choropleth
**Status:** Active
**Date:** April 2026
**Decision:** The map interface does not display a full-coverage choropleth overlay. Instead:

1. **Profile-driven point layers** — switching user profile (Families / Nomads / Retirees / Investors) auto-activates contextually relevant amenity pin clusters (schools, health centres, transport stops, infrastructure projects). Each layer is a distinct colour. Manual chip toggles allow per-layer override.

2. **Click-to-explore** — clicking inside a zone boundary highlights only that single zone (coloured fill + white stroke border) and opens the right-side zone detail panel. Clicking outside all zones does nothing.

3. **No always-visible choropleth** — the zone_tvi score colouring is applied only to the single selected zone, not as a permanent full-map overlay.

**Rationale:** The original choropleth was visually broken because Nominatim returns bounding-box rectangles, not real postcode polygons. All 17 Málaga zones rendered as same-sized overlapping green squares covering the same part of the city — users could not understand what the shapes represented, and the overlay obscured the basemap. Even with real polygon boundaries, a permanent full-coverage colour overlay provides low signal: Málaga zone scores cluster tightly (48–59 range) and are hard to differentiate by colour alone. The profile-driven layer model is contextually richer — a family user sees schools and health centres immediately without any configuration, which directly maps to their decision-making process. Reference: malaga.is/pulse — clean dark basemap, contextual point markers, no full-coverage overlays.

**When to revisit:** If/when real CartoCiudad postcode polygon boundaries are ingested and zone score variance widens (more data sources loaded), a toggleable choropleth layer could be re-added as an opt-in overlay. It should never be the default always-visible map state.

---

## D-024 — SNCZI flood zone data source: ArcGIS REST (replaces dead WFS)
**Status:** Active
**Date:** April 2026
**Decision:** SNCZI flood zone data is now fetched from the MITECO ArcGIS REST MapServer (`sig.miteco.gob.es/arcgis/rest/services/25830/WMS_AguaZI/MapServer`) rather than the original GeoServer WFS endpoint (`snczi.miteco.gob.es/geoserver/civ/wfs`). Layer IDs: T10=38 (alta probabilidad), T100=40 (media), T500=41 (baja). Server only accepts `f=json` (Esri format) — `f=geojson` returns HTTP 400. An Esri JSON → GeoJSON converter (`esri_rings_to_geojson`) handles the `rings[]` geometry format. Page size capped at 50 records — server returns HTTP 500 at ≥100 with geometry+bbox combined.
**Rationale:** The original GeoServer WFS endpoint stopped resolving in 2026. The ArcGIS REST service at sig.miteco.gob.es is the active official MITECO distribution for flood zone data. Discovered by enumerating the ArcGIS REST service folder listing to find `WMS_AguaZI` (ZI = Zonas Inundables).
**Affected files:** `scripts/ingest/ingest_flood_zones.py` (fully rewritten). CHI-285 progress comment has full details.

---

## D-025 — PVGIS solar zone scores: LATERAL nearest-neighbour, not ST_Within
**Status:** Active
**Date:** April 2026
**Decision:** `zone_scores` computes `avg_ghi` (annual solar irradiance per postcode) using a LATERAL nearest-neighbour join to `solar_radiation`, not a ST_Within inner join.
**Rationale:** The PVGIS grid spacing is ~3–5 km, while Málaga urban postal zones are ~1 km². ST_Within requires a solar grid point to fall *inside* the zone polygon — with most urban zones containing zero grid points, `avg_ghi` was NULL for the majority of zones. LATERAL nearest-neighbour (ORDER BY `geom::geometry <-> centroid LIMIT 1`) always returns the closest grid point and is the correct approach for a reference climate grid. This is migration 011. See CHI-362 for the planned per-building Catastro orientation upgrade.
**Affected files:** `supabase/migrations/011_zone_scores_solar_nearest_neighbour.sql`

---

## D-033 — Score rings never the sole output for any indicator
**Status:** Active
**Date:** April 2026
**Decision:** Score ring visualisations (0–100) must never be the only output for an indicator field. Every ring must be accompanied by either a consequence statement in plain English, the underlying raw figure (€ amount, count, distance), or both.
**Rationale:** A score ring without context is an abstraction without meaning. "Affordability: 61" communicates nothing actionable. "€1,847/month estimated total cost" communicates something the buyer can act on. Rings are only appropriate for cross-property comparison or composite TVI — not as a primary output for individual data fields.

---

## D-034 — Euro amounts take precedence over scores wherever financial data exists
**Status:** Active
**Date:** April 2026
**Decision:** Wherever financial data is available (mortgage estimate, IBI, running costs, Catastro reference value), the primary displayed element is a euro figure. A score derived from that financial data may appear as supplementary context but never as the primary element.
**Rationale:** A buyer makes a financial decision. The score is an abstraction. "Affordability score: 74" does not help someone decide if they can afford a property. "Estimated monthly cost: €1,847" does.

---

## D-035 — Flood zone membership at pin level is always binary, always first
**Status:** Active
**Date:** April 2026
**Decision:** At the property pin level, flood zone membership is always presented as a binary Consequence Statement (in zone / not in zone, with return period). It is never scored, never dimmed, never conditionally shown. It is always the first data section after the location header in the pin report.
**Rationale:** Flood risk is a safety-critical fact. A scored or de-emphasised flood warning fails the user. The two-level truth principle applies: zone-level flood scores are acceptable in the zone panel accordion (discovery context); property-level flood membership is always a binary statement (decision context).

---

## D-036 — Proximity shown as counts + walking distances, never a score
**Status:** Active
**Date:** April 2026
**Decision:** All proximity data (schools within 800m, nearest supermarket, nearest health centre, etc.) is displayed as counts and distances/walking times. It is never condensed into a single "proximity score."
**Rationale:** "3 schools within 800m, nearest 280m (≈3 min walk)" is a fact a buyer can evaluate. "Proximity score: 74" is an abstraction that hides the information and invites distrust.

---

## D-037 — Choropleth is not the default map state; replaced with opt-in overlay toolbar
**Status:** Active
**Date:** April 2026
**Supersedes:** Original MAP_MVP_SPEC.md §5 bottom toolbar concept (7-dimension choropleth switcher)
**Decision:** The map default state is a clean dark basemap with point layer clusters only — no choropleth fill. The postcode zone choropleth (previously default-on) becomes an opt-in overlay activated by the user. The bottom toolbar is redesigned as a contextual overlay switcher with radio behaviour (one overlay at a time, or none).

Phase 1 overlays (data available now):
- **Flood Zones** — SNCZI T10/T100/T500 polygon fills (terracotta → amber by return period)
- **Tourist Density** — VUT licence point density as a MapLibre heatmap layer
- **Quality of Life** — the existing `zone_scores` weighted TVI choropleth, now opt-in

Pin drop (CHI-346) additionally renders radiating proximity rings at 400m / 800m / 1,200m centred on the pin coordinate, generated client-side via `turf.circle()` and rendered as dashed emerald `line` layers.

Phase 2 overlays (future — require additional data ingestion): school catchment polygons, blue zone parking, NTI investment signal.

**Linear issue:** CHI-362 (replaces CHI-345).

**Rationale:** The postcode choropleth is a bureaucratic boundary. It does not correspond to how buyers think about place, it provides no property-level precision, and it visually dominates the map without adding decision-relevant information. Once pin drop is built, the postcode zone outline is entirely redundant. Overlays should be tools a user reaches for to answer specific questions — not ambient decoration that requires the user to mentally ignore it.

---

## D-038 — QoL choropleth removed from overlay toolbar
**Status:** Active
**Date:** April 2026
**Decision:** The "Quality of Life" button has been removed from the map overlay toolbar. The zone TVI choropleth is not re-enabled until CartoCiudad real postcode polygon boundaries are ingested to replace the current Nominatim bounding-box zones.
**Rationale:** The existing zone boundaries are Nominatim axis-aligned bounding rectangles that overlap each other, cover identical geographic areas, and do not correspond to meaningful neighbourhoods. Rendering them as a full-coverage choropleth is visually broken and actively misleading. The zone click-to-explore interaction (single selected zone + detail panel) is sufficient until real polygon data is available. The "Tourist Density" overlay is disabled (not removed) pending VUT licence geocoding — 650k records exist but all have null geometry.

---

## D-039 — Pin drop elevated as primary map interaction; address search as primary entry point
**Status:** Active
**Date:** April 2026
**Decision:** The coordinate pin drop is the primary interaction on the map, not zone exploration. Address/street search is added as the primary discovery entry point. The map view and the Analyse view are treated as convergent entry points to the same property intelligence output — one starts from a coordinate, one starts from a listing URL, but both lead to the same data model. The CTA in the pin report links directly to the Analyse page with pre-filled coordinates.
**Rationale:** The platform's most defensible value is precision at the property coordinate level — flood membership, school proximity, solar irradiance, connectivity, financial estimate. This data is returned by a single PostGIS query against a real lat/lng coordinate. Zone-level aggregation is a secondary, exploratory concern. A user searching "Calle Almona 2" needs an address search, not a right-click affordance. By elevating pin drop and adding address search, the map view becomes a useful entry point for all buyer types — including those who found a listing on Idealista and want to quickly understand the location before pasting the URL.

---

## D-040 — Four-state rendering standard for all indicator cards
**Status:** Active
**Date:** April 2026
**Decision:** Every indicator card in the DNA Report must render in exactly four states: LOADED, LOADING, UNAVAILABLE, and LOCKED. No card may show a blank, a zero where zero is meaningless, or silently omit data. The four states are implemented inside `IndicatorCard.tsx` via optional props (`data?`, `loading?`, `locked?`). The dispatch logic in `ResultView.tsx` is the single place that decides which state each card receives, based on job phase, user tier, and data presence. A `score === null` within an otherwise-present data object is treated as equivalent to absent data and routes to UNAVAILABLE, not LOADED.
**Rationale:** During CHI-383 audit, the original component had no LOADING, UNAVAILABLE, or LOCKED states. A null score silently zeroed the score bar and showed nothing — users could not distinguish a computation failure from a genuine zero. Tier-2 indicators with data were shown in full to all users regardless of tier. The four-state standard closes these gaps and is now an absolute rule (`claude.md` Rule 5 and 6). `live: false` indicators (pipeline not yet built) are explicitly excluded from this standard — they render as `SkeletonCard` "coming soon" because UNAVAILABLE would incorrectly imply a retrieval failure rather than a deliberate phase gate.
**Affects:** `components/ui/IndicatorCard.tsx` · `app/analyse/[jobId]/ResultView.tsx` · `components/map/FloodSafetySection.tsx`

---

## D-041 — Extraction layer: Parse.bot replaced with Apify
**Status:** Active
**Date:** April 2026
**Decision:** Replace Parse.bot with the Apify actor `dz_omar/idealista-scraper-api` for all Idealista listing extraction. The actor is called via Apify's REST run-sync endpoint directly from the Edge Function using `APIFY_API_TOKEN`.
**Rationale:** Parse.bot's v1/fetch endpoint no longer exists. The new Parse.bot dispatch API enforces domain allowlisting that blocks Supabase Edge Function origins. No workaround was viable. `dz_omar/idealista-scraper-api` is pay-per-event (~$0.006/property), requires no rental subscription, and Apify's $5/month free credit covers ~800 lookups — sufficient for MVP. The actor accepts full Idealista URLs directly (no property code extraction needed at the API level, though the URL is passed as-is). Field mapping was verified against a live response for property 109560592.
**Field mapping confirmed:**
- `ubication.latitude / longitude` → `lat / lng` (7 d.p.)
- `moreCharacteristics.constructedArea` → `area_sqm`
- `moreCharacteristics.roomNumber / bathNumber` → `bedrooms / bathrooms`
- `moreCharacteristics.energyCertificationType` (uppercased) → `epc_rating`
- `moreCharacteristics.floor` (parsed from string code) → `floor`
- `moreCharacteristics.status` → `condition`
- `contactInfo.userType` → `seller_type`
- `ubication.title` → `address`
- `ubication.administrativeAreaLevel2` → `municipio`
- `detailedType.typology` → `property_type`
**Not returned by Apify (handled by downstream steps):**
- `ref_catastral` — not published on Idealista listings; Catastro OVC step degrades gracefully
- `build_year` — same; indicators fall back to neutral assumptions
- `codigo_postal` — derived via PostGIS spatial join against `postal_zones` in the reverse geocode step
- `comunidad_autonoma` — derived via `municipios` reverse geocode (Apify's `administrativeAreaLevel1` is province name, not comunidad)
**Also in this change:** `condition` column added to `analysis_cache`; `address`, `bathrooms`, `property_type`, `condition` now written to `analysis_cache` on every analysis run. `extraction_version` bumped to `2.0`.
**Affects:** `supabase/functions/analyse-job/index.ts` · `app/api/analyse/route.ts` · `analysis_cache` schema

---

## D-042 — PinReportPanel simplified to triage card; MiniMapCard added to ResultView
**Status:** Active
**Date:** April 2026
**Decision:** `PinReportPanel` reduced to a thin triage card. `ResultView` gains a new Life Proximity section (Section 4) with a static mini-map.

**PinReportPanel triage card — what it now shows:**
1. Coordinates + reverse geocoded address (+ optional Idealista URL enrichment, URL input only)
2. AI area summary — markdown stripped at source (`generateAreaSummary.ts`) and at render (`stripMarkdown()` in the panel)
3. `FloodSafetySection` — always first risk signal, never removed
4. `ProximitySummary` — 4 categories only (school, health, supermarket, park), compact mode
5. Community character — VUT count within 200m only
6. Full Report CTA — navy pill button, Playfair italic, calls `POST /api/analyse` with `{ url: null, lat, lng, name }`

**Removed from PinReportPanel (belong in ResultView only):**
- `ZoneSnapshotSection` (score bars: Schools/Flood/Daily Life/Noise/Community/Price)
- `ReportsNavSection` (deep-dive tile links)
- `SavePinForm` — noted for future addition to ResultView sticky header
- Solar exposure inline section
- URL-gated "Run full DNA analysis" CTA (replaced by coordinates-based Full Report CTA)
- `AddressEnrichment` (street/floor/door/Catastro fields) — reduced to URL input only

**MiniMapCard (`components/report/MiniMapCard.tsx`) — new component:**
- Fixed 220px height, non-interactive (`interactive: false` on MapLibre constructor — single flag covers all pan/zoom/click)
- `visibility: hidden` not `display: none` during load — preserves container dimensions for MapLibre init
- Pulsing emerald pin reusing `pinPulse` animation from `globals.css`
- 400m radius circle: emerald 8% fill, 2px dashed stroke
- Emoji HTML markers (not MapLibre symbol layers) — avoids font loading issues
- Cancelled flag guards amenity marker useEffect against stale state on rapid coordinate changes
- Chip row below map renders regardless of map state — amenity data is not dependent on map success
- `amenities !== null` guard before "no amenities" message — avoids false empty state during load
- DM Mono for distance values in chip row

**ResultView Section 4 — Life Proximity + Mini-Map:**
- Inserted after Section 3 (Intelligence Indicators) and before Section 5 (Asset Performance Pillars)
- Two-column grid (`repeat(auto-fit, minmax(280px, 1fr))`): LEFT = `MiniMapCard`, RIGHT = `ProximitySummaryFromCoords`
- `ProximitySummaryFromCoords` fetches `/api/map/amenities` and derives `FacilityCounts` from raw feature arrays
- If `result.property.lat/lng` is null: fallback card with "Add an Idealista URL to unlock location intelligence →"

**ProximitySummary in two contexts:**
- In `PinReportPanel`: `compact={true}`, 4 categories, `onExpandRadius` syncs the map ring outward
- In `ResultView`: `compact={false}`, full categories, `onExpandRadius` is a no-op — there is no map canvas in the report context. The "Show all →" expand toggle works normally in both contexts because it is internal component state, not prop-driven.

**Full Report CTA — pending route patch:**
The CTA calls `POST /api/analyse` with `{ url: null, lat, lng, name }`. The route currently rejects `url: null` (line 89 requires a non-null string). The parallel session must patch `app/api/analyse/route.ts` to accept coordinates-only jobs before the CTA creates a job successfully.

**Affects:** `components/map/PinReportPanel.tsx` · `components/report/MiniMapCard.tsx` (new) · `app/analyse/[jobId]/ResultView.tsx` · `app/actions/generateAreaSummary.ts` · `app/globals.css`

---

## D-043 — Shared TopNav added to layout.tsx
**Status:** Active
**Date:** April 2026
**Decision:** `components/ui/TopNav.tsx` added to `app/layout.tsx` — renders on all routes. Active link detection via `usePathname()`. `/analyse` active for any path starting with `/analyse`; `/map` active for any path starting with `/map`. ThemeToggle moved into TopNav (desktop + mobile sheet) and removed from per-page standalone positions. Mobile: hamburger → bottom sheet.

**Homepage routing confirmed:** Homepage content lives at `/`. `/analyse` (without a jobId) redirects to `/` via Next.js server-side `redirect()`. The URL paste form on the homepage now POSTs directly to `/api/analyse` instead of redirecting to `/analyse?url=`.

**ICP profile selector added to homepage:** Four pill buttons (Family · Nomad · Retiree · Investor), stored in `localStorage` key `qolify_icp_profile`, passed as `profile` field in the POST body to `/api/analyse`. Default null on first visit.

**"Analyse another property" button:** Links to `/` (was `/analyse`). DNA Report `TopBar` sticky offset updated to `top: 64` to clear TopNav. Map canvas height updated to `calc(100vh - 64px)`. Old map inner nav strip removed — TopNav replaces it.

**Affects:** `app/layout.tsx` · `app/page.tsx` · `app/analyse/page.tsx` · `app/analyse/[jobId]/ResultView.tsx` · `app/map/MapClient.tsx` · `app/map/MapWrapper.tsx` · `components/ui/TopNav.tsx` · `components/map/ZoneDetailPanel.tsx` · `components/report/ThemeToggle.tsx`

---

## Future Decisions (pending)

These decisions need to be made before the relevant phase begins:

- **D-F01** — Which mortgage broker(s) to partner with for ICO lead generation (Phase 3)
- **D-F02** — Stripe pricing: monthly only vs monthly + annual discount (Phase 3)
- **D-F03** — Which regional VUT registries to scrape beyond Andalucía, Madrid, Catalunya, Valencia (Phase 1)
- **D-F04** — Whether to pursue commercial data licensing with Idealista before Explorer tier reaches 500 subscribers (Phase 4)
- **D-F05** — NLP approach for BOE gazette extraction: Claude API vs spaCy vs fine-tuned model (Phase 5)
- **D-F06** — Portal OAuth API integration for direct favourites sync (requires commercial partnership — revisit post-Explorer launch)
