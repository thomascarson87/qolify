# Raiz — Technical Architecture
**Version 3.0 | March 2026 | Spain Market**

---

## 1. Product Model Overview

Raiz operates as a **hybrid product** across two distinct modes that share a common intelligence layer but differ fundamentally in how listings enter the system.

### Model B — On-Demand Analysis (Free + Pro tiers)
A user finds a property on Idealista, Fotocasa, or any other portal. They paste the URL into Raiz, or click the Raiz browser extension button while viewing the listing. Raiz fetches that specific page on-demand via Parse.bot, extracts the listing data, runs it through the full composite indicator engine against the pre-loaded QoL reference tables, and returns a complete Hidden DNA report within seconds. No bulk scraping. No stored listing inventory. The intelligence layer is the product.

### Model A — Discovery Portal (Explorer + Intelligence tiers)
Raiz scrapes all major Spanish property portals continuously, stores the full listing database in Supabase, enriches every listing with QoL data and composite indicators in the background, and serves them through Raiz's own map-based discovery interface. Users find properties on Raiz without needing to visit Idealista at all.

### The Shared Foundation
Both models draw from exactly the same QoL reference tables and composite indicator engine. The difference is only in how a property enters the system — on-demand via user URL submission (Model B) or via the background scraping pipeline (Model A). This means the entire QoL data infrastructure is built once and serves both tiers.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MODEL B — ON-DEMAND (Free / Pro)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[ User submits URL ]  ←— web app paste OR browser extension
        │
        ▼
[ On-Demand Extract ]    ← Parse.bot: single listing fetch
        │
        ▼
[ Analysis Cache ]       ← Supabase: 48h result cache per URL
        │
        ▼                          ↘ also logs to
[ Composite Indicator Engine ] ──→ [ property_price_history ]
        │                          [ zone_metrics_history ]
        ▼
[ Hidden DNA Report ]    ← served to user in <10 seconds

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MODEL A — DISCOVERY PORTAL (Explorer / Intelligence)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[ Cloudflare /crawl ]    ← every 6h per portal, national
        │
        ▼
[ Scrape Queue ]         ← Supabase table, worker-consumed
        │
        ▼
[ Parse.bot Batch ]      ← bulk extraction pipeline
        │
        ▼
[ properties table ]     ← full listing database
        │
        ▼
[ Catastro Enrichment ]  ← async, triggered on INSERT
        │
        ▼
[ Scoring Engine ]       ← TVI pillar scores (9 pillars)
        │
        ▼
[ Composite Indicator Engine ] ──→ [ property_price_history ]
        │                          [ zone_metrics_history ]
        ▼
[ Map Interface ]        ← served to Explorer/Intelligence users

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SHARED FOUNDATION (all tiers)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
QoL Reference Tables:
  flood_zones / schools / health_centres / transport_stops
  amenities / crime_stats / fibre_coverage / ite_status
  vut_licences / infrastructure_projects / ...

Composite Indicator Engine:
  15 indicators — same logic regardless of how listing entered system

Time-Series Foundation:
  property_price_history — every analysis logged, both models
  zone_metrics_history   — daily aggregation, both models feed it
```

---

## 2. Tier Architecture

The four product tiers map directly to technical capabilities:

| Tier | Price | Model | Key Technical Features |
|---|---|---|---|
| **Free** | €0 | B only | On-demand URL analysis. Browser extension. 5 Tier 1 indicators. 3 analyses/day. |
| **Pro** | €19/mo | B only | Unlimited analyses. All 15 indicators. PDF export. Price drop alerts on saved URLs. ICO calculator. |
| **Explorer** | €39/mo | A + B | Full Raiz map portal. Scraped national inventory. TVI scores. Tier 1 + 2 indicators. Composite filters. New listing alerts. |
| **Intelligence** | €79/mo | A + B | Everything in Explorer. Tier 3 temporal indicators. Historical price charts. Zone trend data. 500 API calls/month. |

### Tier-Gating Implementation
Tier access is enforced at the API layer via Supabase JWT claims. The `user_profiles` table stores a `tier` field (`free` | `pro` | `explorer` | `intelligence`). API routes check this claim before returning restricted data — e.g. `/api/analyse` returns only 5 indicators for free users, all 15 for Pro+. Map endpoints return 401 for Free/Pro users with an upgrade prompt payload.

---

## 3. Tech Stack

| Layer | Technology | Applies To | Rationale |
|---|---|---|---|
| Frontend Framework | Next.js 14 (App Router) | All tiers | SSR/SSG; API routes included; Vercel-native |
| Styling | Tailwind CSS | All tiers | Rapid UI; consistent design system |
| Browser Extension | Chrome Manifest V3 + Firefox WebExtension | Free / Pro | Injects Raiz panel into Idealista/Fotocasa pages; calls `/api/analyse` |
| Map | MapLibre GL JS | Explorer / Intelligence | Open source; no usage-based cost at scale |
| Database | Supabase (PostgreSQL + PostGIS) | All tiers | Geospatial queries native; real-time; REST + JS client |
| Auth | Supabase Auth | All tiers | Email/password + Google OAuth; JWT tier claims |
| Backend / API | Next.js API Routes (Vercel) | All tiers | Serverless; co-located with frontend |
| On-Demand Extraction | Parse.bot | Free / Pro | Single listing fetch per user request; sub-150ms |
| Scraping Discovery | Cloudflare Browser Rendering `/crawl` | Explorer / Intelligence | Bulk listing discovery; JS-heavy portal support |
| Scraping Extraction | Parse.bot (batch mode) | Explorer / Intelligence | Same tool, called from background pipeline |
| Pipeline Orchestration | Cloudflare Workers (cron triggers) | Explorer / Intelligence | Scrape scheduling; Cloudflare KV for state |
| Scoring Engine | Python worker (Supabase Edge Function) | Explorer / Intelligence | TVI pillar scores; runs post-ingestion |
| Composite Indicator Engine | Python worker (standalone) | All tiers | 15 indicators; on-demand (Model B) or background (Model A) |
| Time-Series Store | Supabase tables | All tiers | `property_price_history` + `zone_metrics_history`; both models write to these |
| Analysis Cache | Supabase `analysis_cache` table | Free / Pro | 48h cache per URL; shared across users |
| Rate Limiting | Upstash Redis | Free tier | 3 analyses/day cap enforced at edge |
| Payments | Stripe | Pro / Explorer / Intelligence | Subscription management; webhook-triggered tier updates |
| Monitoring | Vercel Analytics + Sentry | All tiers | Performance; error tracking; cron health checks |

---

## 4. Database Schema

### 4.1 Core Tables

#### `properties`
Model A only. Populated by the background scraping pipeline.

```sql
CREATE TABLE properties (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source                      TEXT NOT NULL,     -- 'idealista' | 'fotocasa' | 'sareb' etc
  source_id                   TEXT NOT NULL,
  source_url                  TEXT NOT NULL UNIQUE,
  ref_catastral               TEXT,

  -- Location
  lat                         DECIMAL(10,7) NOT NULL,
  lng                         DECIMAL(10,7) NOT NULL,
  geom                        GEOGRAPHY(POINT, 4326),
  address                     TEXT,
  municipio                   TEXT,
  provincia                   TEXT,
  comunidad_autonoma          TEXT,
  codigo_postal               TEXT,

  -- Property basics
  price_asking                INTEGER,
  price_per_sqm               DECIMAL(8,2),
  area_sqm                    INTEGER,
  bedrooms                    SMALLINT,
  bathrooms                   SMALLINT,
  property_type               TEXT,              -- 'piso' | 'casa' | 'chalet' etc
  floor                       SMALLINT,
  build_year                  SMALLINT,
  condition                   TEXT,

  -- Catastro (populated async post-insert)
  catastro_valor_referencia   INTEGER,
  catastro_area_sqm           DECIMAL(8,2),
  catastro_year_built         SMALLINT,
  negotiation_gap_pct         DECIMAL(5,2),

  -- Energy
  epc_rating                  CHAR(1),
  epc_potential               CHAR(1),

  -- Seller
  seller_type                 TEXT,              -- 'particular' | 'agency' | 'bank'

  -- Listing lifecycle
  first_seen_at               TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at                TIMESTAMPTZ DEFAULT NOW(),
  price_changed_at            TIMESTAMPTZ,
  price_previous              INTEGER,
  days_on_market              INTEGER,
  is_active                   BOOLEAN DEFAULT TRUE,

  -- Scores (written by scoring + indicator engines)
  tvi_score                   DECIMAL(5,2),
  is_undervalued              BOOLEAN DEFAULT FALSE,
  undervalued_pct             DECIMAL(5,2),

  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX properties_geom_idx ON properties USING GIST (geom);
CREATE INDEX properties_source_id_idx ON properties (source, source_id);
CREATE INDEX properties_postal_idx ON properties (codigo_postal);
CREATE INDEX properties_ref_catastral_idx ON properties (ref_catastral);
CREATE INDEX properties_active_idx ON properties (is_active);
```

#### `analysis_cache`
The central table for Model B. Stores full extracted listing data and all computed indicator results for any URL submitted by a user. Shared across all users — two users analysing the same URL within 48h share the same cached result.

```sql
CREATE TABLE analysis_cache (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url            TEXT NOT NULL UNIQUE,
  source                TEXT,                    -- 'idealista' | 'fotocasa' etc

  -- Extracted listing data (mirrors properties schema)
  ref_catastral         TEXT,
  lat                   DECIMAL(10,7),
  lng                   DECIMAL(10,7),
  geom                  GEOGRAPHY(POINT, 4326),
  address               TEXT,
  municipio             TEXT,
  provincia             TEXT,
  codigo_postal         TEXT,
  price_asking          INTEGER,
  price_per_sqm         DECIMAL(8,2),
  area_sqm              INTEGER,
  bedrooms              SMALLINT,
  bathrooms             SMALLINT,
  property_type         TEXT,
  floor                 SMALLINT,
  build_year            SMALLINT,
  epc_rating            CHAR(1),
  epc_potential         CHAR(1),
  seller_type           TEXT,

  -- Catastro
  catastro_valor_referencia   INTEGER,
  catastro_year_built         SMALLINT,
  negotiation_gap_pct         DECIMAL(5,2),

  -- Full analysis results (JSONB — flexible for versioning)
  pillar_scores         JSONB,                   -- all 9 pillar scores
  composite_indicators  JSONB,                   -- all 15 composite indicators with confidence levels
  alerts                JSONB,                   -- array of alert objects
  tvi_score             DECIMAL(5,2),

  -- Cache management
  extracted_at          TIMESTAMPTZ DEFAULT NOW(),
  expires_at            TIMESTAMPTZ DEFAULT NOW() + INTERVAL '48 hours',
  extraction_version    TEXT DEFAULT '1.0',       -- bump to force re-extraction on engine update

  -- Time-series seeding flag
  price_logged          BOOLEAN DEFAULT FALSE
);

CREATE INDEX analysis_cache_url_idx ON analysis_cache (source_url);
CREATE INDEX analysis_cache_postal_idx ON analysis_cache (codigo_postal);
CREATE INDEX analysis_cache_expires_idx ON analysis_cache (expires_at);
CREATE INDEX analysis_cache_geom_idx ON analysis_cache USING GIST (geom);
```

#### `user_analyses`
Links users to their analysis history. Provides saved reports, price alerts, and per-user usage tracking without duplicating analysis data.

```sql
CREATE TABLE user_analyses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES user_profiles(id),
  cache_id        UUID REFERENCES analysis_cache(id),
  source_url      TEXT NOT NULL,
  is_saved        BOOLEAN DEFAULT FALSE,
  notes           TEXT,
  analysed_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX user_analyses_user_idx ON user_analyses (user_id, analysed_at DESC);
```

#### `url_price_alerts`
Model B price monitoring — nightly re-fetch of saved URLs, notifies Pro+ users on price change.

```sql
CREATE TABLE url_price_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES user_profiles(id),
  source_url      TEXT NOT NULL,
  last_price      INTEGER,
  is_active       BOOLEAN DEFAULT TRUE,
  last_checked    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

#### `property_scores`
Model A only. Normalised per-pillar scores per scraped property.

```sql
CREATE TABLE property_scores (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id           UUID REFERENCES properties(id) ON DELETE CASCADE,
  score_market          DECIMAL(5,2),
  score_legal           DECIMAL(5,2),
  score_environmental   DECIMAL(5,2),
  score_connectivity    DECIMAL(5,2),
  score_education       DECIMAL(5,2),
  score_health          DECIMAL(5,2),
  score_community       DECIMAL(5,2),
  score_safety          DECIMAL(5,2),
  score_future_value    DECIMAL(5,2),
  tvi_default           DECIMAL(5,2),
  calculated_at         TIMESTAMPTZ DEFAULT NOW()
);
```

#### `composite_indicators`
Model A only. All 15 indicator outputs per scraped property. For Model B, stored as JSONB inside `analysis_cache.composite_indicators`.

```sql
CREATE TABLE composite_indicators (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id                     UUID REFERENCES properties(id) ON DELETE CASCADE,

  -- Tier 1: Within-pillar composites
  true_affordability_score        DECIMAL(5,2),
  true_affordability_monthly_eur  INTEGER,
  structural_liability_index      DECIMAL(5,2),
  structural_liability_est_eur    INTEGER,
  digital_viability_score         DECIMAL(5,2),
  health_security_score           DECIMAL(5,2),
  education_opportunity_score     DECIMAL(5,2),

  -- Tier 2: Cross-pillar composites
  neighbourhood_transition_index  DECIMAL(5,2),
  nti_signal                      TEXT,          -- 'prime_buy'|'too_late'|'stable'|'risk'
  community_stability_score       DECIMAL(5,2),
  climate_resilience_score        DECIMAL(5,2),
  infrastructure_arbitrage_score  DECIMAL(5,2),
  motivated_seller_index          DECIMAL(5,2),
  rental_trap_index               DECIMAL(5,2),
  rental_trap_monthly_delta_eur   INTEGER,
  expat_liveability_score         DECIMAL(5,2),

  -- Tier 3: Temporal (Intelligence tier only)
  price_velocity_score            DECIMAL(5,2),
  price_velocity_pct_3m           DECIMAL(5,2),
  price_velocity_pct_12m          DECIMAL(5,2),
  dom_velocity                    DECIMAL(5,2),
  gentrification_confirmation     TEXT,          -- 'early_stage'|'late_stage'|'none'|'insufficient_data'
  seasonal_distortion_pct         DECIMAL(5,2),

  indicators_version              TEXT DEFAULT '1.0',
  calculated_at                   TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX composite_indicators_property_idx ON composite_indicators (property_id);
```

#### `alerts`
Model A: references `property_id`. Model B: stored as JSONB in `analysis_cache.alerts`.

```sql
CREATE TABLE alerts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   UUID REFERENCES properties(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,   -- 'green' | 'amber' | 'red'
  category      TEXT NOT NULL,   -- 'negotiation_gap' | 'flood_risk' | 'ite_pending' etc
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  data_source   TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
```

### 4.2 Time-Series Tables

These are populated by **both models**. Every on-demand analysis (Model B) and every scrape cycle (Model A) writes to these tables. This is the most strategically important design decision in the architecture: free and Pro users unknowingly seed the time-series database that powers the Intelligence tier's temporal indicators. The more user-submitted analyses accumulate, the richer the data — even before Model A scraping begins.

#### `property_price_history`
```sql
CREATE TABLE property_price_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   UUID REFERENCES properties(id) ON DELETE SET NULL,    -- Model A
  cache_id      UUID REFERENCES analysis_cache(id) ON DELETE SET NULL, -- Model B
  source_url    TEXT NOT NULL,
  codigo_postal TEXT,
  price         INTEGER NOT NULL,
  price_per_sqm DECIMAL(8,2),
  observed_at   TIMESTAMPTZ DEFAULT NOW(),
  source        TEXT       -- 'scraper' | 'user_submission' | 'price_alert_check'
);

CREATE INDEX pph_url_idx ON property_price_history (source_url, observed_at DESC);
CREATE INDEX pph_postal_idx ON property_price_history (codigo_postal, observed_at DESC);
```

#### `zone_metrics_history`
Daily zone-level aggregations. Nightly cron aggregates across all active `properties` rows (Model A) and recent `analysis_cache` rows (Model B) per postcode zone.

```sql
CREATE TABLE zone_metrics_history (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_type                 TEXT NOT NULL,   -- 'codigo_postal' | 'municipio'
  zone_id                   TEXT NOT NULL,
  recorded_date             DATE NOT NULL,
  active_listings           INTEGER,
  median_price_sqm          DECIMAL(8,2),
  median_dom                DECIMAL(6,1),
  new_listings_7d           INTEGER,
  removed_listings_7d       INTEGER,
  price_reductions_7d       INTEGER,
  specialty_amenity_count   INTEGER,
  vut_applications_30d      INTEGER,
  building_permits_30d      INTEGER,
  crime_rate_per_1000       DECIMAL(6,3),
  data_source               TEXT,           -- 'scraper' | 'mixed' | 'submissions_only'
  UNIQUE (zone_type, zone_id, recorded_date)
);

CREATE INDEX zmh_zone_date_idx ON zone_metrics_history (zone_type, zone_id, recorded_date DESC);
```

#### `amenity_history`
```sql
CREATE TABLE amenity_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  osm_id        TEXT,
  category      TEXT,
  lat           DECIMAL(10,7),
  lng           DECIMAL(10,7),
  geom          GEOGRAPHY(POINT, 4326),
  municipio     TEXT,
  codigo_postal TEXT,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  is_active     BOOLEAN DEFAULT TRUE
);

CREATE INDEX amenity_history_geom_idx ON amenity_history USING GIST (geom);
CREATE INDEX amenity_history_postal_idx ON amenity_history (codigo_postal, first_seen_at DESC);
```

### 4.3 QoL Reference Tables

Shared across all tiers. Populated by scheduled government data jobs regardless of which models are active.

```sql
-- flood_zones (SNCZI)
CREATE TABLE flood_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  geom GEOGRAPHY(MULTIPOLYGON, 4326) NOT NULL,
  risk_level TEXT,    -- 'T10' | 'T100' | 'T500'
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX flood_zones_geom_idx ON flood_zones USING GIST (geom);

-- schools (Minedu BuscaColegio)
CREATE TABLE schools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT, tipo TEXT, etapas TEXT[],
  lat DECIMAL(10,7), lng DECIMAL(10,7),
  geom GEOGRAPHY(POINT, 4326),
  municipio TEXT, provincia TEXT, codigo_postal TEXT,
  rating_score DECIMAL(3,1), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX schools_geom_idx ON schools USING GIST (geom);

-- health_centres (Sanidad RESC)
CREATE TABLE health_centres (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT, tipo TEXT, is_24h BOOLEAN DEFAULT FALSE,
  lat DECIMAL(10,7), lng DECIMAL(10,7),
  geom GEOGRAPHY(POINT, 4326),
  municipio TEXT, updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX health_centres_geom_idx ON health_centres USING GIST (geom);

-- transport_stops (MITMA GTFS)
CREATE TABLE transport_stops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT, tipo TEXT,
  lat DECIMAL(10,7), lng DECIMAL(10,7),
  geom GEOGRAPHY(POINT, 4326),
  freq_daily INTEGER, operator TEXT, updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX transport_stops_geom_idx ON transport_stops USING GIST (geom);

-- amenities (OSM Overpass)
CREATE TABLE amenities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT, category TEXT,
  lat DECIMAL(10,7), lng DECIMAL(10,7),
  geom GEOGRAPHY(POINT, 4326),
  municipio TEXT, updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX amenities_geom_idx ON amenities USING GIST (geom);

-- crime_stats (MIR)
CREATE TABLE crime_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio TEXT NOT NULL, provincia TEXT,
  year_month DATE NOT NULL,
  violent_crime INTEGER, property_crime INTEGER,
  antisocial INTEGER, total INTEGER,
  per_1000_pop DECIMAL(6,3), trend_12m DECIMAL(5,2),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- fibre_coverage (CNMC)
CREATE TABLE fibre_coverage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  geom GEOGRAPHY(POLYGON, 4326) NOT NULL,
  coverage_type TEXT, max_speed_mbps INTEGER, operator TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX fibre_coverage_geom_idx ON fibre_coverage USING GIST (geom);

-- ite_status (Municipal portals)
CREATE TABLE ite_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_catastral TEXT, address TEXT,
  lat DECIMAL(10,7), lng DECIMAL(10,7),
  geom GEOGRAPHY(POINT, 4326),
  status TEXT,   -- 'passed' | 'failed' | 'pending' | 'not_required'
  inspection_date DATE, due_date DATE, municipio TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- vut_licences (Regional tourism registries)
CREATE TABLE vut_licences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  licence_ref TEXT, address TEXT,
  lat DECIMAL(10,7), lng DECIMAL(10,7),
  geom GEOGRAPHY(POINT, 4326),
  region TEXT, status TEXT, updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX vut_licences_geom_idx ON vut_licences USING GIST (geom);

-- infrastructure_projects (Urbanism portals + BOE NLP)
CREATE TABLE infrastructure_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT, type TEXT, status TEXT,
  expected_date DATE,
  geom GEOGRAPHY(GEOMETRY, 4326),
  municipio TEXT, source_url TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX infrastructure_projects_geom_idx ON infrastructure_projects USING GIST (geom);
```

### 4.4 User Tables

```sql
CREATE TABLE user_profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id),
  email           TEXT,
  tier            TEXT NOT NULL DEFAULT 'free',  -- 'free'|'pro'|'explorer'|'intelligence'
  tier_expires_at TIMESTAMPTZ,
  stripe_customer_id TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Saved filter weight configurations (Pro+)
CREATE TABLE user_filter_presets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES user_profiles(id),
  preset_name     TEXT,
  w_market        DECIMAL(3,2) DEFAULT 0.15,
  w_legal         DECIMAL(3,2) DEFAULT 0.15,
  w_environmental DECIMAL(3,2) DEFAULT 0.10,
  w_connectivity  DECIMAL(3,2) DEFAULT 0.10,
  w_education     DECIMAL(3,2) DEFAULT 0.15,
  w_health        DECIMAL(3,2) DEFAULT 0.10,
  w_community     DECIMAL(3,2) DEFAULT 0.10,
  w_safety        DECIMAL(3,2) DEFAULT 0.10,
  w_future_value  DECIMAL(3,2) DEFAULT 0.05,
  price_max       INTEGER,
  bedrooms_min    SMALLINT,
  property_types  TEXT[],
  ico_only        BOOLEAN DEFAULT FALSE,
  buyer_age       SMALLINT,
  is_default      BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Model A: pinned properties from map (Explorer+)
CREATE TABLE saved_properties (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES user_profiles(id),
  property_id UUID REFERENCES properties(id),
  notes       TEXT,
  saved_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Model A: new listing alerts on map (Explorer+)
CREATE TABLE search_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES user_profiles(id),
  preset_id       UUID REFERENCES user_filter_presets(id),
  alert_name      TEXT,
  geography_geom  GEOGRAPHY(POLYGON, 4326),
  is_active       BOOLEAN DEFAULT TRUE,
  last_triggered  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 5. Data Ingestion & Processing Pipelines

### 5.1 Model B — On-Demand Analysis Pipeline

Triggered by user URL submission via the web app or browser extension.

```
User submits URL (web or extension)
        │
        ▼
POST /api/analyse  { url: string }
        │
        ├── 1. Check analysis_cache WHERE source_url = url AND expires_at > NOW()
        │         Cache HIT  ──→ skip to step 6
        │         Cache MISS ──→ continue
        │
        ├── 2. Rate limit check (Upstash Redis)
        │         Free user: 3/day by user_id → return 429 if exceeded
        │         Unauthenticated: 1/day by IP
        │
        ├── 3. Parse.bot: fetch and extract listing page
        │         Returns: price, area, bedrooms, address, postcode,
        │                  coordinates, ref_catastral, epc_rating, seller_type
        │
        ├── 4. Catastro OVC API: lookup by ref_catastral OR coordinates
        │         Returns: valor_referencia, year_built, cadastral_area
        │
        ├── 5. Run Composite Indicator Engine (all 15 indicators)
        │         (see Section 5.3)
        │
        ├── 6. Generate alerts array
        │
        ├── 7. Write / update analysis_cache row
        │
        ├── 8. Log to property_price_history
        │         (always — even on cache hit if price has changed since last log)
        │
        └── 9. Return analysis JSON (indicators gated by user tier)

Response time target:
  Cache HIT:  < 500ms
  Cache MISS: < 8 seconds
```

### 5.2 Model A — Bulk Scraping Pipeline (Explorer / Intelligence)

#### Discovery — Cloudflare Worker (cron: every 6 hours)
```
Cloudflare Worker (cron: 0 */6 * * *)
  │
  ├── POST /browser-rendering/crawl
  │     { startUrl: "https://idealista.com/venta-viviendas/...",
  │       limit: 5000, render: true,
  │       modifiedSince: <kv:last_run_timestamp> }
  │
  ├── Filter: exclude URLs already in properties table and unchanged
  │
  ├── INSERT new/changed URLs into scrape_queue
  │
  └── Update Cloudflare KV: last_run_timestamp = NOW()

Runs per source: idealista.com / fotocasa.es / pisos.com / habitaclia.com / sareb.es
```

#### Extraction — Parse.bot Batch Worker (cron: every 30 min)
```
Worker polls scrape_queue (batch: 50 URLs per run)
  │
  ├── Parse.bot: extract listing data per URL
  │
  ├── UPSERT into properties table
  │
  ├── Log to property_price_history (INSERT if price changed)
  │
  └── Mark scrape_queue entries complete / failed
```

#### Catastro Enrichment — Supabase Edge Function
```
Trigger: AFTER INSERT OR UPDATE ON properties WHERE ref_catastral IS NOT NULL
  │
  ├── Catastro OVC REST API lookup
  ├── UPDATE properties SET catastro_valor_referencia, catastro_year_built,
  │                         catastro_area_sqm, negotiation_gap_pct
  └── Trigger scoring engine (HTTP call to /api/internal/score)
```

#### Scoring Engine — Python Worker
```python
def score_property(property_id: str):
    prop = db.get_property(property_id)
    scores = {
        'market':        score_market(prop),
        'legal':         score_legal(prop),
        'environmental': score_environmental(prop),
        'connectivity':  score_connectivity(prop),
        'education':     score_education(prop),
        'health':        score_health(prop),
        'community':     score_community(prop),
        'safety':        score_safety(prop),
        'future_value':  score_future_value(prop),
    }
    normalised = normalise_scores(scores)      # 0-100 nationally via min-max
    tvi = weighted_average(normalised, DEFAULT_WEIGHTS)
    regional_avg = db.get_regional_avg_tvi(prop.municipio)
    db.upsert_property_scores(property_id, normalised, tvi)
    db.update_property(property_id,
                       tvi_score=tvi,
                       is_undervalued=(tvi > regional_avg * 1.15))
    run_composite_indicators(prop_data=prop.to_dict(), mode='background')
```

### 5.3 Composite Indicator Engine (Both Models)

The same Python function runs in two contexts:
- **Model B**: called synchronously inside the `/api/analyse` request
- **Model A**: called after the scoring engine completes, as a background job

```python
def run_composite_indicators(prop_data: dict, mode: str) -> dict:
    """
    Accepts normalised property dict (same schema from both models).
    Returns dict of all 15 indicator results with confidence levels.
    Writes results to composite_indicators (Model A) or
    returns JSONB for analysis_cache (Model B).
    """
    indicators = {}
    zone_hist = db.get_zone_history(prop_data['codigo_postal'], months=24)

    # ── TIER 1: Within-pillar (no historical data needed) ──────────────────

    indicators['true_affordability'] = calc_true_affordability(prop_data)
    # mortgage + IBI estimate + EPC energy cost + comunidad fee − ICO subsidy
    # output: { score: 0-100, monthly_eur: int, confidence: 'high' }

    indicators['structural_liability'] = calc_structural_liability(prop_data)
    # building age + ITE status + EPC rating + permit age
    # output: { score: 0-100, estimated_eur: int, confidence: 'high'|'medium' }

    indicators['digital_viability'] = calc_digital_viability(prop_data)
    # CNMC fibre type × nPerf speed factor + coworking density
    # output: { score: 0-100, fibre_type: str, confidence: 'high' }

    indicators['health_security'] = calc_health_security(prop_data)
    # GP distance + 24h emergency distance + pharmacy density
    # output: { score: 0-100, nearest_gp_m: int, nearest_er_m: int }

    indicators['education_opportunity'] = calc_education_opportunity(prop_data)
    # school count by type + catchment status + rating trend
    # output: { score: 0-100, in_catchment: bool, school_count: int }

    # ── TIER 2: Cross-pillar (zone history improves confidence) ────────────

    indicators['nti'] = calc_nti(prop_data, zone_hist)
    # amenity arrival rate + permit accel + VUT trend + DOM compression + crime trend
    # output: { score: -100 to 100, signal: 'prime_buy'|'too_late'|'stable'|'risk',
    #           confidence: str }

    indicators['community_stability'] = calc_community_stability(prop_data, zone_hist)
    indicators['climate_resilience']  = calc_climate_resilience(prop_data)
    indicators['infrastructure_arb']  = calc_infrastructure_arbitrage(prop_data, zone_hist)
    indicators['motivated_seller']    = calc_motivated_seller(prop_data, zone_hist)
    indicators['rental_trap']         = calc_rental_trap(prop_data)
    indicators['expat_liveability']   = calc_expat_liveability(prop_data)

    # ── TIER 3: Temporal (require price history — Intelligence tier) ────────

    price_hist = db.get_price_history(prop_data['source_url'], months=18)

    if len(price_hist) >= 4:
        indicators['price_velocity']             = calc_price_velocity(prop_data, price_hist, zone_hist)
        indicators['gentrification_confirmation'] = calc_gentrification(indicators, price_hist)
    else:
        indicators['price_velocity']             = { 'confidence': 'insufficient_data' }
        indicators['gentrification_confirmation'] = { 'signal': 'insufficient_data' }

    if zone_hist and zone_hist_months(zone_hist) >= 12:
        indicators['seasonal_distortion'] = calc_seasonal_distortion(prop_data, zone_hist)
    else:
        indicators['seasonal_distortion'] = { 'confidence': 'insufficient_data' }

    return indicators
```

### 5.4 Government Data Ingestion — Scheduled Jobs

All jobs populate the shared QoL reference tables. Run identically regardless of which product tiers are active.

| Dataset | Frequency | Method | Target Table |
|---|---|---|---|
| SNCZI Flood Zones | Monthly | GIS WFS → PostGIS import | `flood_zones` |
| MITECO Air Quality | Daily | REST API | `air_quality_readings` |
| EEA Noise Maps | Annual | Shapefile → PostGIS | `noise_zones` |
| MITMA GTFS | Monthly | GTFS feed download | `transport_stops` |
| CNMC Fibre Coverage | Quarterly | GIS shapefile → PostGIS | `fibre_coverage` |
| Minedu School Directory | Quarterly | BuscaColegio scrape | `schools` |
| Sanidad RESC | Quarterly | API/scrape | `health_centres` |
| MIR Crime Stats | Monthly | Bulk CSV download | `crime_stats` |
| OSM Amenities | Weekly | Overpass QL | `amenities` + `amenity_history` |
| VUT Registries | Monthly | Regional scraping | `vut_licences` |
| Municipal ITE Status | Weekly | Ayuntamiento portal scraping | `ite_status` |
| INE Property Transfers | Quarterly | CSV bulk download | `inheritance_stats` |
| Zone Metrics Aggregation | Daily (nightly cron) | SQL aggregate across properties + analysis_cache | `zone_metrics_history` |

### 5.5 Price Alert Worker — Model B (Pro+)

Nightly cron. For each active `url_price_alerts` row: re-fetches listing via Parse.bot (lightweight — price field only if possible), compares to `last_price`. On change: email notification sent, `property_price_history` updated, `last_price` updated.

### 5.6 Analysis Cache Pruning — Daily Cron

```sql
-- Runs nightly. Removes expired cache entries.
-- Preserves price history rows (those are permanent).
DELETE FROM analysis_cache WHERE expires_at < NOW();
```

---

## 6. Browser Extension Architecture

The extension is the primary acquisition channel for Free and Pro users. It removes the context-switch friction of the URL-paste flow by injecting a Raiz analysis panel directly into Idealista and Fotocasa listing pages.

### 6.1 Flow

```
User views idealista.com/inmueble/12345678/
        │
        ▼
Content script detects listing URL pattern
        │
        ▼
Injects floating "Analyse with Raiz" button into page DOM
        │
        ▼
User clicks button
        │
        ├── Is user authenticated? (check Supabase JWT in extension storage)
        │         No  → open raiz.es/auth/signup in new tab
        │         Yes → continue
        │
        ├── POST to raiz.es/api/analyse { url: window.location.href }
        │
        ├── Show sliding panel with skeleton loading state
        │
        └── Render Hidden DNA report inside panel iframe
            (same React components as web app, scoped CSS)
```

### 6.2 Extension File Structure

```
extension/
├── manifest.json                  — permissions: activeTab, storage, identity
├── content_scripts/
│   ├── detector.ts                — URL pattern matching per portal
│   └── injector.ts                — DOM injection: button + iframe panel
├── background/
│   └── service_worker.ts          — auth token refresh; message routing
├── popup/
│   └── popup.html/tsx             — toolbar popup: login state, daily usage count
└── shared/
    ├── auth.ts                    — Supabase JWT in chrome.storage.local
    └── portals.ts                 — URL pattern registry + Parse.bot schema IDs
```

### 6.3 Supported Portal URL Patterns

| Portal | Property URL Pattern | Parse.bot Schema | Favourites / List Pattern |
|---|---|---|---|
| Idealista | `/inmueble/\d+/` | `idealista_v1` | `/usuario/anuncios-favoritos` + `/compartir/lista/[\w-]+` |
| Fotocasa | `/detalle/\d+` | `fotocasa_v1` | `/mis-favoritos` |
| Pisos.com | `/piso-[\w-]+-\d+` | `pisoscom_v1` | — |
| Habitaclia | `/piso-[\w-]+-\d+` | `habitaclia_v1` | — |
| Sareb | `/inmueble/\d+` | `sareb_v1` | — |

Any unsupported URL: extension shows "Copy URL and paste into Raiz" fallback.

**Two injection modes:**
- **Property page** → injects "Analyse with Raiz" button → Hidden DNA report panel
- **Favourites / share-list page** → injects "Import X saved properties" panel → batch analysis → comparison view

---

## 7. API Layer

All routes are Next.js API routes on Vercel. Tier gating enforced via Supabase JWT `tier` claim.

```
POST /api/analyse
     body: { url: string }
     auth: optional (unauthenticated allowed, IP rate-limited)
     → Full on-demand analysis pipeline (Model B)
     → Free: returns 5 Tier 1 indicators
     → Pro+: returns all 15 indicators
     → Response includes: analysis object + cache_id for polling

GET  /api/analyse/:cacheId
     → Returns cached analysis by ID (fast poll after async POST)

POST /api/analyse/batch                              [Pro+]
     body: { urls: string[], preset_id?: string }
     → Processes 2–N URLs through the on-demand pipeline sequentially
     → Tier limits: Pro=10, Explorer=25, Intelligence=50
     → Cache-aware: cached URLs return instantly; uncached processed with 1s delay
     → Streaming response: each result returned as it completes (NDJSON stream)
     → On completion: returns comparison_id for saving/sharing

GET  /api/analyse/batch/:batchId
     → Returns progress + completed results for an in-flight batch

POST /api/import/favourites                         [Pro+]
     body: { page_url: string }
     → Accepts: Idealista/Fotocasa favourites page URL or share-list URL
     → Server fetches page, extracts all property URLs, returns URL list
     → Client then submits extracted URLs to /api/analyse/batch
     → Supported patterns:
        idealista.com/usuario/anuncios-favoritos
        idealista.com/compartir/lista/[token]
        fotocasa.es/mis-favoritos

GET  /api/comparisons                               [Pro+]
     → Returns user's saved comparisons

POST /api/comparisons                               [Pro+]
     body: { name: string, source_urls: string[], cache_ids: uuid[],
             preset_id?: string, is_shared?: boolean }
     → Saves a comparison set; enforces tier save limits (Pro: 3 max)
     → Returns: { id, share_token }

GET  /api/comparisons/:shareToken                   [Public — no auth]
     → Returns full comparison data for shared view
     → Used for /comparison/:shareToken page route

PUT  /api/comparisons/:id                           [Pro+, own comparisons only]
     body: { name?: string, is_shared?: boolean, preset_id?: string }

DELETE /api/comparisons/:id                         [Pro+, own comparisons only]

GET  /api/user/analyses                              [All authenticated]
     → User's analysis history

POST /api/user/analyses/:id/save                     [All authenticated]
     → Toggle saved status

POST /api/user/price-alerts                          [Pro+]
     body: { url: string }
     → Create URL price monitoring alert

DELETE /api/user/price-alerts/:id                    [Pro+]

GET  /api/properties                                 [Explorer / Intelligence]
     ?bbox=lat1,lng1,lat2,lng2
     ?preset_id=uuid
     ?price_max=300000
     ?bedrooms_min=2
     ?nti_signal=prime_buy
     ?motivated_seller_min=60
     ?ico_only=true
     &limit=100
     → Scraped property list with TVI + indicator summaries

GET  /api/properties/:id                             [Explorer / Intelligence]
     → Full scraped property with all scores, alerts, Tier 1+2 indicators

GET  /api/properties/:id/temporal                    [Intelligence only]
     → Tier 3 indicator data + historical price chart data

GET  /api/map/overlays/nti                           [Explorer / Intelligence]
     ?bbox=lat1,lng1,lat2,lng2
     → NTI by zona postal for heatmap rendering

GET  /api/map/overlays/arbitrage                     [Explorer / Intelligence]
     ?bbox=lat1,lng1,lat2,lng2
     → Infrastructure Arbitrage zones

GET  /api/zones/:type/:id/indicators                 [Intelligence only]
     → Zone-level trend data (price velocity, DOM, gentrification stage)

GET  /api/user/presets                               [Pro+]
POST /api/user/presets
PUT  /api/user/presets/:id
DELETE /api/user/presets/:id

POST /api/user/search-alerts                         [Explorer+]
     → New listing alerts for map area + filter combination

GET  /api/reference/ico-caps
     → ICO price caps by region (edge-cached, quarterly update)

GET  /api/reference/itp-rates
     → ITP transfer tax rates by Comunidad Autónoma

POST /api/webhooks/stripe
     → Stripe subscription events → tier updates in user_profiles
```

---

## 8. Frontend Architecture

### 8.1 Page Structure (Next.js App Router)

```
app/
├── page.tsx                        — Landing page
├── analyse/
│   └── page.tsx                    — URL paste + analysis interface (Free / Pro)
├── report/
│   └── [cacheId]/
│       └── page.tsx                — Shareable Hidden DNA report
├── compare/
│   └── page.tsx                    — Comparison view (Pro+ — batch results land here)
├── comparison/
│   └── [shareToken]/
│       └── page.tsx                — Shareable comparison view (public, no auth)
├── map/
│   └── page.tsx                    — Discovery map (Explorer / Intelligence only)
│                                     → Free/Pro: redirect to /analyse with upgrade prompt
├── property/
│   └── [id]/
│       └── page.tsx                — Scraped property detail (Explorer / Intelligence)
├── saved/
│   └── page.tsx                    — Analysis history + saved map properties + saved comparisons
├── alerts/
│   └── page.tsx                    — URL price alerts + map search alerts
├── account/
│   └── page.tsx                    — Subscription, billing, tier management
├── auth/
│   ├── login/page.tsx
│   └── signup/page.tsx
└── api/
```

### 8.2 Analyse Page (Model B — Free / Pro)

```
AnalysePage
├── URLInputBar                     — paste field + "Analyse" button
│   └── RecentAnalysesList          — last 5 analyses (quick re-open)
│
├── BatchInputPanel                 — [Pro+] multi-URL input
│   ├── URLTextArea                 — newline-separated URL list
│   ├── ShareListImport             — paste Idealista compartir/lista URL
│   ├── BatchProgressBar            — "Analysing 4 of 9 properties..."
│   └── UpgradePrompt               — shown to Free users in place of batch controls
│
└── AnalysisReport                  — shown after single URL submission
    ├── PropertyHeader              — address, price, source portal badge, TVI badge
    ├── AlertBanner                 — Red/Amber/Green alerts in priority order
    ├── FinancialAlphaCard
    │   ├── NegotiationGauge        — asking vs Catastro visual
    │   ├── TrueAffordabilityCard   — monthly real cost breakdown
    │   ├── RentalTrapCard          — buy vs rent monthly delta
    │   └── ICOCalculator           — deposit + monthly payment estimate
    ├── HiddenDNAGrid
    │   ├── ITEStatusCard
    │   ├── FloodRiskCard
    │   ├── EPCCard                 — rating + grant potential
    │   └── VUTDensityCard
    ├── RaizIntelligenceSection
    │   ├── Tier1Indicators         — [all users]
    │   ├── Tier2Indicators         — [Pro+ | Free: blurred with upgrade prompt]
    │   └── Tier3Indicators         — [Intelligence only]
    ├── LifeProximityWheel          — radar chart
    ├── PillarScoreBreakdown        — 9-pillar bar chart
    ├── SaveButton                  — saves to user_analyses
    ├── ShareButton                 — copies /report/:cacheId link
    ├── CompareButton               — adds this property to an in-progress comparison [Pro+]
    └── PDFExportButton             — [Pro+]

### 8.3 Comparison View (Pro+ — /compare and /comparison/:shareToken)

The comparison view is the highest-value output in the product. It answers "which one should I buy?" rather than "is this one good?"

```
ComparisonView
├── ComparisonHeader
│   ├── PropertyThumbnailRow        — one card per property: photo, address, price, TVI badge
│   ├── ComparisonName              — editable name field ("Málaga shortlist March 2026")
│   ├── SaveComparisonButton        — [Pro+] saves to comparisons table
│   ├── ShareComparisonButton       — generates /comparison/:shareToken link
│   └── AddPropertyButton           — paste another URL to add to comparison
│
├── WhyThisOneSection               — one plain-English card per property
│   └── WhyThisOneCard              — "[Property A]: Best monthly cost — €180 cheaper than B
│                                      once energy bills and ICO financing are factored in."
│                                    Derived from which indicators score highest relative to set
│
├── DecisiveDifferenceHighlight     — the single factor with largest variance across the set
│   └── "These properties diverge most on: Community Stability.
│         A scores 84, B scores 31. B has 68% VUT density in its building —
│         meaning most residents are short-term tourists, not neighbours."
│
├── RadarOverlayChart               — all properties on same 9-pillar radar (different colours)
│   └── WeightSlidersPanel          — adjust weights → radar + ranking update in real time
│
├── WeightedRankingBar              — properties ranked 1–N with score delta shown
│   └── "Change your priorities to see a different winner →"
│
├── AlertSummaryGrid                — all Red + Amber alerts for all properties in one scannable view
│   └── AlertRow per property       — property name | alert type | alert title
│
├── SideBySidePillarScores          — horizontal bar chart, all 9 pillars, all properties
│
├── IndicatorComparisonTable        — all 15 indicators in rows, properties in columns
│   ├── Tier1IndicatorRows          — True Affordability, Structural Liability etc
│   ├── Tier2IndicatorRows          — [Pro+]
│   └── Tier3IndicatorRows          — [Intelligence only]
│
└── IndividualReportLinks           — "View full report →" link per property
```

**Shared comparison view** (`/comparison/:shareToken`): renders the same ComparisonView component but with a "View on Raiz" banner and signup prompt for non-authenticated visitors. All indicator data visible (same as the owner's view at the time of sharing).

### 8.4 Extension Favourites Import Panel

When the extension detects an Idealista/Fotocasa favourites page or share-list URL:

```
ExtensionFavouritesPanel
├── DetectionBanner                 — "We found 17 saved properties on this page"
├── PropertyPreviewList             — first 5 properties shown as mini cards (address, price)
│   └── "...and 12 more"
├── FilterOptions
│   ├── ImportAllButton             — "Import all 17 to Raiz"
│   └── SelectToImportList          — checkboxes per property for selective import [future]
├── TierGateNotice                  — "Batch analysis requires Pro — upgrade to import"
│                                     [shown to Free users only]
└── ImportProgressPanel             — shown after confirm:
    ├── ProgressBar                 — "Analysing 6 of 17 properties..."
    ├── CompletedCards              — renders as each analysis completes
    └── "View Comparison →" button  — appears when all complete
```
```

### 8.3 Map View (Model A — Explorer / Intelligence)

```
MapView
├── MapContainer (MapLibre GL JS)
│   ├── PropertyPinsLayer           — clustered, TVI score badges
│   ├── NTIHeatmapLayer             — Neighbourhood Transition Index heatmap
│   ├── ArbitrageHeatmapLayer       — Infrastructure Arbitrage zones
│   ├── FloodZoneLayer              — toggleable SNCZI overlay
│   ├── FibreLayer                  — toggleable CNMC coverage
│   ├── NoiseLayer                  — toggleable EEA noise contours
│   ├── InfrastructureLayer         — approved future projects
│   └── VUTDensityLayer             — tourist licence density
│
├── FilterSidebar
│   ├── PresetSelector              — Family / Nomad / Retiree / Investor
│   ├── WeightSliders               — 9 pillar weights (sum to 100%)
│   ├── PropertyFilters             — price, bedrooms, type, area
│   ├── ICOFilter                   — zero-deposit eligible toggle
│   ├── CompositeFilters
│   │   ├── NTISignalFilter         — 'Prime Buy' / 'Too Late' / 'Stable' / 'Risk'
│   │   ├── MotivatedSellerFilter   — minimum score slider
│   │   ├── ArbitrageFilter         — minimum score slider
│   │   └── RentalTrapFilter        — "Buying cheaper than renting here"
│   └── LayerToggles
│
└── PropertyListPanel
    └── PropertyCard                — price, TVI, top signal badge, top alerts
```

### 8.4 Property Detail Page (Model A)

```
PropertyDetailPage
├── PropertyHeader                  — price, address, TVI badge, NTI signal, ICO badge
├── AlertBanner
├── FinancialAlphaCard
│   ├── NegotiationGauge
│   ├── TrueAffordabilityCard
│   ├── RentalTrapCard
│   └── ICOCalculator
├── HiddenDNAGrid
│   ├── ITEStatusCard + Structural Liability Index
│   ├── FloodRiskCard + Climate Resilience Score
│   ├── EPCCard + Grant Potential
│   └── VUTDensityCard
├── RaizIntelligenceSection
│   ├── Tier1+2 Indicators          — [Explorer+]
│   └── Tier3 Indicators            — [Intelligence only: price history chart, gentrification, seasonal]
├── LifeProximityWheel
├── PillarScoreBreakdown
├── FutureViewSection               — approved infrastructure within 1km
├── AnalyseWithExtensionButton      — deep-link to browser extension panel
└── SimilarProperties
```

---

## 9. Security & Data Considerations

### Row Level Security (Supabase RLS)
- QoL reference tables: publicly readable (no PII)
- `analysis_cache`: publicly readable by `cache_id` (enables shareable report URLs); no user PII stored in cache rows
- `user_profiles`, `user_analyses`, `saved_properties`, `url_price_alerts`, `search_alerts`, `user_filter_presets`: RLS enforced — users access only their own rows
- `properties`, `property_scores`, `composite_indicators`: publicly readable (Explorer/Intelligence gate enforced at API layer, not DB layer)

### Legal Posture by Model
- **Model B** (on-demand): single page fetch per explicit user action — functionally equivalent to a user clicking a browser bookmark. Substantially lower legal exposure. `analysis_cache` expires at 48h; no permanent listing storage.
- **Model A** (bulk scraping): higher exposure; operated as a paid-tier feature only at launch, limiting scale. Photos not re-hosted — property detail pages link back to source portal. Plan for commercial data licensing conversations with Idealista as the Explorer/Intelligence user base grows.

### Scraping Ethics (Model A)
- `robots.txt` respected on all portals
- Randomised request delays 3–10 seconds
- Residential IP proxy rotation via Cloudflare
- No PII scraped or stored
- Only publicly visible listing data (price, area, description, photos not stored)

### Data Freshness
- `analysis_cache`: 48-hour TTL, pruned nightly
- Scraped listings (Model A): 6-hour refresh; inactive after 7 days unseen
- QoL reference tables: per schedule in Section 5.4
- `zone_metrics_history`: daily aggregation — most critical pipeline job; Sentry cron monitoring with alerting

---

## 10. Cost Model by Tier

| Cost Driver | Free | Pro | Explorer | Intelligence |
|---|---|---|---|---|
| Parse.bot calls | ~3/day/user (hard cap) | Unlimited on-demand | Background pipeline only | Background pipeline only |
| Cloudflare Workers | Rate limit edge checks | Minimal | Full scrape orchestration | Scrape + BOE NLP pipeline |
| Supabase | Shared QoL tables + analysis_cache | + user_analyses rows | + full properties table | + full history tables |
| Vercel functions | /api/analyse only | /api/analyse (heavier) | All map + property endpoints | All + temporal endpoints |
| Upstash Redis | Rate limiting | Minimal | Not needed | Not needed |
| Stripe | — | Subscription processing | Subscription processing | Subscription processing |
| **Estimated infra/month** | **~€30 fixed** | **~€0.08/active user** | **~€300–800** | **~€600–1,500** |

**Key observation:** The entire Free and Pro tiers can be built and operated for under €50/month fixed cost. The Model A infrastructure (Explorer/Intelligence) is only introduced when paying subscribers justify it.

---

## 11. Environment Configuration

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Cloudflare (Model A only initially)
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_BROWSER_RENDERING_KEY=

# Parse.bot
PARSEBOT_API_KEY=

# MapLibre tile hosting
NEXT_PUBLIC_MAPBOX_TOKEN=

# Rate limiting (Free tier)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Payments
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=

# Government data APIs
CATASTRO_OVC_ENDPOINT=https://ovc.catastro.hacienda.gob.es
CNMC_API_KEY=

# Browser extension
NEXT_PUBLIC_CHROME_EXTENSION_ID=     # for postMessage communication

# App
NEXT_PUBLIC_APP_URL=
```

---

*Document version: 3.0 | Raiz | March 2026*
