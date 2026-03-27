# Qolify — Development Roadmap
**Version 3.0 | March 2026 | Spain Market**

---

## Guiding Principles

1. **Intelligence layer first, scraping second.** The QoL data, composite indicators, and on-demand analysis engine are built before any bulk scraping. This validates the product's core value proposition at minimal cost and legal risk.
2. **Ship to real users early.** The browser extension and URL analysis flow can be in users' hands within 8 weeks. That is the first validation gate before any further investment.
3. **Time-series starts from day one.** Every analysis, from the very first free user onward, writes to `property_price_history` and seeds `zone_metrics_history`. This data compounds daily and is irreplaceable — the sooner it starts accumulating, the more powerful the temporal indicators become.
4. **Model A is earned, not assumed.** The Explorer/Intelligence map portal is only built after the Free/Pro tiers have demonstrated that users genuinely value the intelligence layer. This keeps infrastructure costs near zero until revenue justifies them.
5. **Spain-wide from the first QoL data load.** Government reference data (flood zones, schools, transport, fibre) is ingested nationally from Phase 0. On-demand analysis works for any Spanish property URL from day one.

---

## Phase Overview

| Phase | Name | Duration | Primary Model | Outcome |
|---|---|---|---|---|
| 0 | Foundation & QoL Data | 3 weeks | Shared | Dev environment, database, all QoL reference tables loaded nationally |
| 1 | On-Demand Analysis + Browser Extension | 4 weeks | Model B | Working Free + Pro product. First users. Tier 1 indicators live. |
| 2 | Indicator Depth + Pro Features | 4 weeks | Model B | All 12 Tier 1 + 2 indicators. ICO calculator. PDF export. Price alerts. |
| 3 | Validation Gate | 2 weeks | Model B | User feedback, indicator validation, monetisation live. Decide Model A go/no-go. |
| 4 | Discovery Portal | 6 weeks | Model A | Scraping pipeline, map interface, Explorer tier live. |
| 5 | Intelligence Tier | 4 weeks | Model A | Tier 3 temporal indicators. Zone trend data. Intelligence tier live. |

**Total to full hybrid MVP: ~23 weeks**
**Time to first paying users: ~9 weeks (end of Phase 2)**
**Time to first revenue: ~11 weeks (end of Phase 3)**

---

## Phase 0 — Foundation & QoL Data
**Duration: 3 weeks**
**Goal: Everything needed to run a property analysis exists before a single line of product UI is written.**

### Week 1: Infrastructure

- [ ] Supabase project created (production + staging)
- [ ] Full database schema migrated — all tables including `analysis_cache`, `property_price_history`, `zone_metrics_history`, `amenity_history`, `climate_data`, `solar_radiation`, `building_orientation`, `eco_constants`, and all QoL reference tables
- [ ] PostGIS extension enabled; all spatial indexes confirmed
- [ ] Row Level Security policies written and tested
- [ ] Supabase Auth configured (email/password + Google OAuth)
- [ ] GitHub repository created (`main` → production, `develop` → staging)
- [ ] Next.js 14 project scaffolded with Tailwind CSS
- [ ] Vercel project connected to GitHub (auto-deploy on `main`)
- [ ] Environment variables configured in Vercel
- [ ] Sentry error tracking integrated
- [ ] Stripe account configured; webhook endpoint live; `user_profiles.tier` updates on subscription events
- [ ] Upstash Redis configured for rate limiting

### Week 2–3: QoL Reference Data Load

All data loaded nationally. These tables do not change based on how a listing enters the system — they are the intelligence foundation that makes both models work.

- [ ] **SNCZI Flood Zones**: WFS download → PostGIS import → `flood_zones` (all Spain)
- [ ] **MITMA GTFS**: feed download → parse stops/routes → `transport_stops`
- [ ] **CNMC Fibre Coverage**: GIS shapefile → PostGIS → `fibre_coverage`
- [ ] **Minedu School Directory**: BuscaColegio scrape → `schools` (all Spain, ~28,000 centres)
- [ ] **Sanidad RESC**: health centre scrape/API → `health_centres`
- [ ] **MIR Crime Stats**: first CSV bulk download → `crime_stats`
- [ ] **OSM Amenities**: Overpass QL national query → `amenities` + `amenity_history` (initial seed)
- [ ] **EEA Noise Maps**: shapefile → PostGIS → `noise_zones`
- [ ] **VUT Licences**: Andalucía, Madrid, Catalunya, Valencia registries → `vut_licences` (first four regions)
- [ ] **Municipal ITE Status**: Madrid + Barcelona ayuntamiento portals → `ite_status` (priority cities first)
- [ ] Scheduled refresh jobs configured for all datasets (per cadence in architecture Section 5.4)
- [ ] **AEMET Climate Normals**: Open Data API → `climate_data` per municipio (annual sunshine hours + monthly distribution, HDD, CDD, extreme heat day count + trend direction, rainfall, humidity — all Spain, ~8,000 municipios, annual refresh cadence)
- [ ] **`eco_constants` table seeded**: energy tariff constants (gas + PVPC electricity price per kWh), EPC U-value coefficients, solar gain factors by orientation — replaces hardcoded values in indicator engine (per D-021)
  - *Note: PVGIS solar irradiance is queried per-analysis via REST API. `solar_radiation` table is a coordinate-level cache (0.01° resolution) populated on demand — no bulk load required*
  - *Note: `building_orientation` is derived from Catastro footprint geometry at analysis time — no bulk load required, falls back to "unknown" gracefully*
- [ ] **Zone metrics cron**: nightly aggregation job created (starts running immediately even with no properties yet — it will aggregate from `analysis_cache` once analyses begin)
- [ ] Manual validation: run PostGIS proximity query for 3 known Málaga addresses — confirm schools, flood risk, and transport data returns correctly

### Phase 0 Success Criteria
- PostGIS proximity query for any coordinate in Spain returns at least: nearest school, nearest health centre, flood risk level, fibre coverage type, nearest transport stop
- Flood risk correctly identifies a known Valencia flood zone property
- School data returns correct results for a known Madrid address
- All scheduled refresh jobs running without errors in staging
- Zone metrics cron runs nightly without failure (zero data yet — that is expected and correct)

---

## Phase 1 — On-Demand Analysis + Browser Extension
**Duration: 4 weeks**
**Goal: A real user in Spain can paste an Idealista URL and receive a meaningful Hidden DNA report within 10 seconds. Free tier live. Browser extension in Chrome Web Store.**

### Week 4: On-Demand Analysis Engine

- [ ] **Parse.bot schemas defined** for Idealista and Fotocasa listing pages
  - Extracts: price, area_sqm, bedrooms, bathrooms, floor, address, postcode, coordinates, ref_catastral, epc_rating, seller_type
- [ ] **`/api/analyse` endpoint** built:
  - Cache lookup (analysis_cache)
  - Rate limit check (Upstash Redis — 3/day free, unlimited Pro+)
  - Parse.bot fetch and extraction
  - Catastro OVC API enrichment (valor_referencia, year_built)
  - Negotiation gap calculation
  - Alert generation (flood risk, ITE status, EPC, negotiation gap)
- [ ] **Composite Indicator Engine — Tier 1** implemented:
  - Indicator 1: True Affordability Score (mortgage + IBI + EPC energy cost + comunidad)
  - Indicator 2: Structural Liability Index (build year + ITE status + EPC + permit age estimate)
  - Indicator 3: Digital Viability Score (CNMC fibre type + coworking density)
  - Indicator 4: Health Security Score (GP distance + 24h ER distance + pharmacy density)
  - Indicator 5: Education Opportunity Score (school count by type + catchment check + rating)
- [ ] **`property_price_history` logging**: every successful analysis writes a price observation (this starts accumulating from the very first free user)
- [ ] **`analysis_cache` write + TTL**: 48-hour cache per URL; shared across users
- [ ] **Shareable report URL**: `/report/:cacheId` renders full analysis without auth

### Week 5: Analyse Page UI

- [ ] **Analyse page** (`/analyse`): URL input field, "Analyse" button, loading state with skeleton
- [ ] **Hidden DNA Report UI** — full property report with:
  - Property header: address, price, source portal badge, TVI badge
  - Negotiation gauge: asking vs Catastro visual indicator (Green/Amber/Red)
  - Alert banner: top Red/Amber/Green alerts displayed prominently
  - True Affordability card: monthly breakdown (mortgage / IBI / energy / comunidad)
  - Structural Liability card: risk score + plain-English explanation
  - Digital Viability card: fibre type + coworking proximity
  - Health Security card: distances to GP and 24h emergency
  - Education Opportunity card: school count, types, catchment status
  - ITE status card: Green/Amber/Red indicator
  - Flood risk card: SNCZI risk level
  - EPC card: rating + NextGen EU grant potential
  - VUT density card: % tourist licences in zone
  - Life Proximity Wheel: radar chart (schools, health, transport, beach, parks)
  - Tier 2 + 3 indicator cards: shown as locked/blurred with upgrade prompt for Free users
- [ ] **Recent analyses list**: last 5 URLs shown on analyse page for quick re-open
- [ ] Landing page: explains the product, links to /analyse and extension install
- [ ] Auth: email signup/login; Google OAuth

### Week 6: Browser Extension

- [ ] **Chrome Extension (Manifest V3)** built and submitted to Chrome Web Store
  - Content script: detects Idealista + Fotocasa listing URL patterns
  - Injects "Analyse with Qolify" floating button into listing page DOM
  - Click → POST to `/api/analyse` → render sliding panel with Hidden DNA report
  - Auth state: reads Supabase JWT from `chrome.storage.local`; redirects to signup if unauthenticated
- [ ] **Firefox WebExtension** submitted to Mozilla Add-ons (same codebase, manifest V2 compat layer)
- [ ] Extension popup: shows login status, daily analysis count, link to Qolify web app
- [ ] Parse.bot schemas added for Pisos.com and Habitaclia (extension detects these too)
- [ ] Unsupported URL handling: extension shows "Copy URL and paste into Qolify" fallback

### Week 7: Soft Launch + Free Tier + Multi-URL Paste

- [ ] Free tier fully functional: 3 analyses/day, 5 Tier 1 indicators, shareable report link
- [ ] Auth wall: `analysis_cache` results readable by `cache_id` without auth (for sharing); saving to profile requires login
- [ ] **Multi-URL paste field** added to `/analyse` page — accepts 2–10 URLs (newline-separated), validates portal patterns, submits to `/api/analyse/batch`
  - Free users see the field but get an upgrade prompt on submission
  - Pro+ users get sequential analysis with a progress indicator ("Analysing 3 of 7...")
  - Each property card renders as its result arrives — no all-or-nothing wait
- [ ] **`/api/analyse/batch` endpoint** live with tier-based limits (Pro: 10, Explorer: 25, Intelligence: 50)
- [ ] `comparisons` and `scrape_queue` tables created and migrated
- [ ] Basic comparison view: side-by-side property cards for batch results (full comparison UI built in Phase 2 Week 10)
- [ ] **Soft launch** to first 30–50 users (Málaga real estate contacts + personal network)
- [ ] Structured feedback form sent to all users after first analysis
- [ ] Analytics instrumentation: track URL submissions, cache hit rate, batch usage, report scroll depth, which indicator cards are expanded

### Phase 1 Success Criteria
- End-to-end analysis (cold cache) completes in under 8 seconds on a standard Spanish broadband connection
- All 5 Tier 1 indicators producing results for >85% of Idealista/Fotocasa listings
- Catastro enrichment succeeding for >60% of analyses (ref_catastral found or coordinate lookup working)
- `property_price_history` accumulating entries from day one
- Browser extension approved in Chrome Web Store
- Multi-URL batch processes 5 URLs without error (manual test)
- 30+ users have completed at least one analysis
- Zero critical errors in Sentry production logs

---

## Phase 2 — Indicator Depth + Pro Features
**Duration: 4 weeks**
**Goal: All 12 Tier 1 and 2 composite indicators live. Pro tier fully featured and ready to monetise. The product is meaningfully differentiated from anything that exists.**

### Week 8–9: Tier 2 Composite Indicators

By this point, the `zone_metrics_history` cron has been running for ~5 weeks and `amenity_history` has been accumulating. Tier 2 indicators that depend on zone history will show "low confidence" early — this is displayed transparently in the UI, not hidden.

- [ ] **Indicator 6 — Neighbourhood Transition Index (NTI)**:
  - Amenity arrival rate from `amenity_history` (weeks of data available)
  - Building permit acceleration from `zone_metrics_history`
  - VUT application trend
  - DOM compression from zone history
  - Crime trend direction from `crime_stats`
  - Signal classification: Prime Buy / Too Late / Stable / Risk
  - Confidence level displayed prominently when data is thin

- [ ] **Indicator 7 — Community Stability Score**:
  - VUT density % + noise level + commerce longevity proxy + DOM variance

- [ ] **Indicator 8 — Climate & Solar Score** *(renamed + expanded — D-021)*:
  - Annual sunshine hours + monthly distribution (AEMET `climate_normals`)
  - Heating Degree Days (HDD) + Cooling Degree Days (CDD) per municipio
  - Building solar orientation from Catastro footprint geometry → `building_orientation` (falls back to "unknown")
  - Solar irradiance score via PVGIS JRC REST API → cached in `solar_irradiance` at 0.01° resolution
  - Damp Risk Index: rainfall × humidity × orientation × build age × EPC rating
  - Extreme heat days + trend direction
  - Flood zone level (SNCZI) + fire risk + AQI trend + green space (NDVI placeholder via OSM)

- [ ] **Indicator 9 — Infrastructure Arbitrage Score**:
  - Manual seed of `infrastructure_projects` with major known AVE/metro projects (full NLP pipeline is Phase 5)
  - Price vs municipal average + DOM velocity

- [ ] **Indicator 10 — Motivated Seller Index**:
  - From `analysis_cache` history: DOM vs zone average, price reduction count, relist count, seller type, Catastro gap direction

- [ ] **Indicator 11 — Rental Trap Index**:
  - New scrape job: Idealista `/alquiler/` rental listings → `rental_benchmarks` table
  - Monthly mortgage (with ICO) vs equivalent rental per postcode
  - "Buying saves you €X/month vs renting here" callout

- [ ] **Indicator 12 — Expat Liveability Score**:
  - International amenity density (OSM) + AENA airport distance + VUT community proxy

- [ ] **Indicator 1 — True Affordability Score energy cost updated** *(D-021)*: replace EPC-only estimate with climate-adjusted calculation using HDD/CDD/orientation from `climate_normals` + `building_orientation`. A south-facing Málaga property and a north-facing Burgos property with identical EPC ratings now produce materially different monthly energy cost estimates.
- [ ] All Tier 2 indicators appear in the Hidden DNA report for Pro+ users; locked for Free

### Week 10: Pro Tier Features + Full Comparison UI

- [ ] **ICO Calculator (full)**: buyer age + income input → eligibility check against regional caps → monthly payment + required deposit displayed
- [ ] **Saved analyses**: users can save unlimited analyses (Pro+)
- [ ] **URL Price Alerts**: Pro+ users can monitor any saved URL for price drops → nightly check worker + email notification
- [ ] **PDF export**: full Hidden DNA report exported as styled PDF (one-click, Pro+)
- [ ] **Filter presets**: save named weight configurations for repeated analyses (Pro+)

- [ ] **Full Comparison UI** (Pro+):
  - **Comparison header**: property thumbnails in a row, each with address, price, and TVI badge
  - **"Why This One" cards**: one plain-English summary sentence per property highlighting its strongest case (generated from indicator data, not AI-written — derived from which indicators score highest relative to the others in the set)
  - **Radar overlay chart**: all properties plotted on the same 9-pillar radar — instantly shows which property wins on which dimension
  - **Weighted ranking**: properties ranked 1–N by the user's active filter preset weights. Ranking recalculates in real time as the user adjusts the weight sliders
  - **Decisive difference highlight**: the single indicator with the largest variance across the comparison set is surfaced prominently with a plain-English explanation of what that difference means in practice
  - **Alert summary row**: all Red and Amber alerts for all properties shown in a scannable grid — makes it immediately clear if any property has a disqualifying risk
  - **Side-by-side pillar scores**: horizontal bar chart for all 9 pillars across all properties
  - **Save comparison**: user can name and save the comparison set (Pro: 3 saved max, Explorer+: unlimited)
  - **Share comparison**: generates a public `/comparison/:shareToken` URL — no auth required to view (same logic as D-015)

- [ ] **`/comparison/:shareToken` page** built: renders full comparison view for non-authenticated visitors
- [ ] **`POST /api/comparisons`** endpoint: saves a comparison (tier-gated, checks Pro 3-save limit)
- [ ] **`GET /api/comparisons/:shareToken`** endpoint: returns comparison data for public share view

### Week 11: Extension Favourites Import + UX Polish

- [ ] **Extension favourites detection**: content script updated with two new URL patterns:
  - `idealista.com/usuario/anuncios-favoritos` → detects favourites page, scrapes all `/inmueble/\d+/` links from DOM
  - `fotocasa.es/mis-favoritos` → same pattern
  - `idealista.com/compartir/lista/[\w-]+` → share-list URL → fetch page, extract all property links
  - On detection: inject "Import X saved properties to Qolify" panel (different from single-property panel)
  - User confirms → all URLs sent to `/api/analyse/batch` → opens comparison view on completion
- [ ] **Share-list URL import** on `/analyse` page: paste field accepts `idealista.com/compartir/lista/...` URLs — Qolify fetches the page server-side and extracts all property URLs, then processes as a batch
- [ ] Indicator confidence levels displayed clearly: "High confidence" / "Based on limited data" / "Insufficient data — will improve over time"
- [ ] Plain-English explanations for every indicator
- [ ] Mobile-responsive analyse page, full report, and comparison view (iOS Safari + Android Chrome)
- [ ] Loading states improved: partial report renders as each section completes (streaming feel)
- [ ] "What does this mean?" expandable context cards for jargon (ITE, Catastro, ICO, VPO, ITP)
- [ ] Recent analyses page: full history with saved/unsaved toggle

### Phase 2 Success Criteria
- All 12 Tier 1 + 2 composite indicators calculating for >75% of analysed properties
- NTI signal validated manually against 3 known gentrifying zones (e.g. Soho Málaga, Cabanyal Valencia, Poblenou Barcelona) — signal direction correct
- Motivated Seller Index validated against 5 real listings known to have sold below asking
- Rental Trap Index validated against Bank of Spain / INE published buy-vs-rent data for key cities
- Full comparison view renders correctly for a 5-property batch on mobile
- Extension favourites import successfully detects and imports from an Idealista favourites page (manual QA test)
- Shareable comparison link accessible without auth
- Mobile report fully usable on iPhone 13 Safari
- At least 15 users have upgraded from Free to Pro (validates willingness to pay)

---

## Phase 3 — Validation Gate + Monetisation
**Duration: 2 weeks**
**Goal: Confirm product-market fit before investing in Model A infrastructure. Collect structured feedback. Launch paid tiers publicly.**

### Week 12: Public Launch + Monetisation

- [ ] Stripe subscription integration fully live: Free / Pro (€19/mo) / Report (€9 one-time)
- [ ] Upgrade flow: locked indicators show "Upgrade to Pro" CTA with clear benefit description
- [ ] Landing page updated: shows real example analyses, indicator examples, pricing
- [ ] SEO-optimised landing pages for key user intents: "¿Es seguro comprar en zona inundable España?" / "¿Cuánto cuesta realmente una hipoteca?" etc.
- [ ] Social proof: shareable report links enable organic sharing (each shared report is a distribution event)

### Week 13: Structured Validation

- [ ] **User interviews**: 10+ structured conversations with active Free and Pro users
  - Which indicators do they find most valuable?
  - Do they use Qolify before Idealista, alongside it, or after?
  - Would they pay for map-based discovery (Explorer tier)?
  - What data is missing that they wish existed?
- [ ] **Usage analytics review**: which indicators are expanded most, which are ignored
- [ ] **Conversion funnel analysis**: where do Free users drop off before upgrading
- [ ] **Model A go/no-go decision**: proceed to Phase 4 if:
  - >50 active Pro subscribers OR strong qualitative demand for map discovery
  - NTI and Motivated Seller indicators are being cited by users as genuinely useful
  - No active legal challenges from Idealista regarding Model B usage

### Phase 3 Success Criteria
- Measurable revenue (target: €500+/month from Pro subscriptions before Phase 4 begins)
- Clear user signal that map-based discovery (Model A) is wanted
- No unresolved critical bugs or data quality issues
- Architecture team aligned on Model A technical approach before Phase 4 kickoff

---

## Phase 4 — Discovery Portal (Model A)
**Duration: 6 weeks**
**Goal: Full national listing database scraped and serving the Explorer tier map interface. Model A builds on top of the already-proven intelligence layer.**

### Week 14–15: Scraping Pipeline

- [ ] **Cloudflare Worker — Discovery**: Idealista national crawl (`/venta-viviendas/`) every 6 hours
  - `modifiedSince` parameter → only new/changed listings
  - Results pushed to `scrape_queue` table
- [ ] **Parse.bot Batch Worker**: polls `scrape_queue`, extracts 50 listings per run, UPSERT to `properties`
- [ ] **Every price observation**: logged to `property_price_history` (links property_id now available)
- [ ] Fotocasa, Pisos.com, Habitaclia discovery workers (same pattern)
- [ ] **Sareb scraper**: headless browser (higher legal comfort for bank inventory)
- [ ] **Deduplication**: same property on multiple portals merged by ref_catastral + coordinate matching
- [ ] **Catastro enrichment trigger**: Supabase Edge Function on properties INSERT
- [ ] **Scoring Engine**: Python worker calculates TVI pillar scores post-enrichment
- [ ] **Composite Indicator Engine** runs on Model A properties (same code as Model B, background mode)

**Target: 100,000+ active listings in database by end of Week 15**

### Week 16–17: Map Interface

- [ ] MapLibre GL JS integrated in Next.js
- [ ] Property pins rendered from `/api/properties?bbox=` endpoint (max 200 per viewport)
- [ ] Clustered markers at low zoom; individual pins with TVI badge at high zoom
- [ ] **NTI Heatmap layer**: zona postal level, toggleable
- [ ] **Infrastructure Arbitrage layer**: toggleable
- [ ] **Flood Zone overlay**: SNCZI, toggleable
- [ ] **Fibre Coverage overlay**: CNMC, toggleable
- [ ] Filter sidebar: price, bedrooms, type, ICO toggle, NTI signal filter, Motivated Seller threshold
- [ ] Property list panel (sidebar): scrollable list of visible properties
- [ ] Property card: thumbnail, price, TVI score, top composite signal badge, top alert
- [ ] Property detail page (Model A version): full Hidden DNA report + all indicator cards

### Week 18–19: Explorer Tier + Search Alerts

- [ ] Explorer tier gate enforced on all map endpoints (401 for Free/Pro with upgrade prompt)
- [ ] **New listing alerts**: user draws polygon on map + sets filter → nightly cron checks new listings matching criteria → email notification
- [ ] **Saved properties**: Explorer+ users can pin properties from map, view in saved list
- [ ] Explorer tier publicly available (€39/month)
- [ ] Listings link back to source portal (Idealista/Fotocasa) — no photos re-hosted
- [ ] Map viewport query performance: must return in <2 seconds for any Spain-wide view

### Phase 4 Success Criteria
- 100,000+ active properties in database with Catastro data for >60%
- Map loads in under 3 seconds on mobile in Madrid
- NTI heatmap rendering correctly at nacional and provincia zoom levels
- At least 20 Explorer subscribers within first 2 weeks of launch
- No scraper blocks or legal challenges from major portals
- `zone_metrics_history` data quality visibly improving now that scraper data supplements user submissions

---

## Phase 5 — Intelligence Tier + Temporal Indicators
**Duration: 4 weeks**
**Goal: Tier 3 temporal indicators live — the most defensible signals in the platform, requiring months of accumulated data. Intelligence tier launched.**

By Phase 5 start, the platform will have:
- ~20 weeks of `property_price_history` from Model B user analyses
- ~6 weeks of `property_price_history` from Model A scraping
- ~23 weeks of `zone_metrics_history` (running since Phase 0)
- ~23 weeks of `amenity_history` tracking

This is sufficient to calculate all three temporal indicators with meaningful confidence for well-analysed postcodes.

### Week 20: Tier 3 Temporal Indicators

- [ ] **Indicator 13 — Price Velocity Signal**:
  - 3-month and 12-month price change per property from `property_price_history`
  - Zone-level DOM compression from `zone_metrics_history`
  - Displayed as trend arrow + % figure on property cards
  - Historical price chart component (all price observations over time)
  - Price velocity filter: "Show zones where price is stable but QoL rising"

- [ ] **Indicator 14 — Gentrification Confirmation**:
  - NTI score × price velocity direction
  - Four-state classification: Early Stage / Late Stage / None / Insufficient Data
  - Confidence level based on months of data available in that zone
  - "Early Stage Gentrification" badge — highest-signal buy indicator in the platform

- [ ] **Indicator 15 — Seasonal Distortion Filter**:
  - Seasonal price baseline per postcode per calendar month (requires 12 months — available for earliest-analysed postcodes)
  - "X% above/below seasonal norm" displayed on property detail
  - Surfaces first for coastal markets: Málaga, Alicante, Ibiza, Costa Brava

### Week 21: Zone Intelligence Dashboard

- [ ] **Zone detail pages** (`/zone/codigo-postal/:cp`): all zone-level indicators for any postcode
  - Price velocity trend chart
  - NTI signal history
  - Gentrification stage classification
  - DOM trend
  - Crime trend
  - Amenity arrival timeline
- [ ] **Weekly market digest email** (Intelligence subscribers): top 5 "Prime Buy" zones this week in their saved areas, biggest price velocity movers, new infrastructure approvals

### Week 22: Full Infrastructure Arbitrage (NLP Pipeline)

- [ ] **BOE / Boletín Autonómico NLP pipeline**:
  - PDF scraping of BOE + regional gazettes (BOJA, DOGC, BOCM etc.)
  - Claude API (or spaCy) extracts: location, project type, approved budget, expected date
  - Writes to `infrastructure_projects` (replacing manual seed from Phase 2)
  - Infrastructure Arbitrage Score (Indicator 9) recalculated with full real-time data
- [ ] **Building permit acceleration** now fully data-driven (previously estimated from limited sources)

### Week 23: Intelligence Tier Launch

- [ ] Intelligence tier (€79/month) publicly available
- [ ] All Tier 3 indicators gated to Intelligence tier (locked with explanation for Explorer)
- [ ] API access: 500 calls/month available for Intelligence subscribers (for agents/developers)
- [ ] Annual pricing option: €590/year (saves ~€358 vs monthly)

### Phase 5 Success Criteria
- Price Velocity correctly identifying known fast-rising and fast-falling zones (validate against published INE/Registradores quarterly data)
- Gentrification Confirmation signal in "Early Stage" for at least 3 zones known from local knowledge to be gentrifying (e.g. specific Málaga, Valencia, Barcelona barrios)
- Seasonal Distortion calculating correctly for Málaga coastal postcodes (validate against known Aug vs Feb price differentials)
- At least 10 Intelligence subscribers within 2 weeks of launch
- BOE NLP pipeline extracting infrastructure projects with >70% accuracy on test set

---

## Phase 6 — Bank Inventory + VPO Expiry + B2B
**Duration: Ongoing from Week 24**

### 6A — Bank Servicer Inventory
- [ ] Sareb expanded scraper (full national inventory)
- [ ] Haya, Solvia, Diglo, Altamira dedicated scrapers
- [ ] "Bank Owned" filter and badge in Explorer/Intelligence map
- [ ] Motivated Seller Index automatically scores bank inventory at 70+ (inherited distress signal)

### 6B — VPO Expiry Tracker
- [ ] Regional housing registry scraping for VPO expiry dates
- [ ] "VPO Expiring Within 24 Months" filter in map
- [ ] Value uplift estimate on expiry displayed in property detail

### 6C — B2B / Partnership Revenue
- [ ] **Mortgage broker lead generation**: users who complete ICO calculator → opt-in referral to partner broker (revenue share)
- [ ] **Agency API tier** (€149/mo, 500 API calls): bulk property analysis for agencies and developers
- [ ] **Insurance partner integration**: Climate Resilience Score is directly relevant to home insurance underwriting — explore white-label data feed

---

## Backlog (Post-Phase 6)

Validated by user demand before scheduling:

- Full school catchment boundary coverage (all 17 Comunidades Autónomas — currently Madrid + Andalucía)
- Sentinel-2 NDVI integration (satellite greenery vs OSM green space proxy)
- Okupa risk sentiment NLP (local forums, regional news)
- Inheritance transfer rate heatmap (INE at postcode level — currently municipio only)
- Rental yield calculator (full buy-to-let ROI display)
- Price prediction model (ML — minimum 24 months data required)
- Mortgage pre-approval partner integration (in-app flow)
- Property comparison tool (side-by-side all 15 indicators)
- Neighbourhood Report PDF (branded, shareable, all indicators for any postcode)
- nPerf real-world broadband speed integration
- UK market (separate product architecture — Phase 7 at earliest)

---

## Key Dependencies & Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Idealista ToS challenge to Model B (on-demand) | Low | Medium | Single-page user-initiated fetch is well-established legal pattern; no permanent storage of listing data (48h cache only); legal review before any public launch |
| Idealista ToS challenge to Model A (bulk scraping) | Medium | High | Model A only built after paying users validate demand; small scale at launch; plan commercial licensing conversation before Explorer reaches 500+ subscribers |
| Parse.bot schema breaks on Idealista UI update | Medium | Medium | Schema versioning in `extraction_version` field; monitoring for extraction failure rate spikes; fallback to manual schema repair |
| Catastro OVC API rate limits | Low | Medium | Cache all lookups; batch requests; ref_catastral from listing reduces API calls significantly |
| zone_metrics_history cron failure | Low | **Critical** | Most important background job — dead-man's-switch Sentry cron monitoring with immediate alerting; data gaps cannot be back-filled |
| Tier 2 indicators lack confidence in first 3 months | High | Low | "Confidence: Based on limited data" shown transparently; signal improves automatically; not hidden |
| Tier 3 indicators unavailable at Model A launch | High | Low | Clearly communicated: "Intelligence tier indicators require 20+ weeks of data — available [date]"; temporal data is accumulating from Phase 0 |
| Model A go/no-go decision (Phase 3) | Medium | Medium | Defined success criteria: 50 Pro subscribers OR strong qualitative demand. If criteria not met, stay Model B only and extend Phase 2/3 |
| Rental scrape blocked | Medium | Low | Rental Trap Index falls back to INE/Registradores published rental statistics (less granular but sufficient for approximate output) |
| Chrome Web Store extension review delay | Medium | Low | Submit extension in Week 6; plan for 1–2 week review delay; web app URL paste is full fallback |

---

## Team Requirements

The roadmap assumes:
- **1 full-stack developer** (Next.js, Supabase, PostGIS, Python) — core product, API, and scoring engine
- **Claude Code** for code generation, schema implementation, and technical review throughout
- **1 part-time data engineer** from Phase 4 onward — scraping pipeline and GIS data management

With a solo developer supported by Claude Code, Phases 0–3 (Model B) are achievable in 10–12 weeks rather than 13. Model A (Phase 4+) genuinely requires two people to run simultaneously across scraping, scoring, and frontend work.

---

## Definition of Done

A feature is considered complete when:
1. It works correctly in production (not just local or staging)
2. It handles error states gracefully — no blank screens, no unhandled exceptions
3. It is mobile-responsive (iOS Safari 16+, Android Chrome)
4. The data source is documented (source, freshness cadence, known coverage gaps)
5. It has been validated against at least one real Spanish property where the correct answer is independently known
6. Tier gating is correctly enforced (Free cannot access Pro features by any route)

---

*Document version: 3.0 | Qolify | March 2026*
