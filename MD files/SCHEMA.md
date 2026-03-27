# Qolify — Database Schema
**Canonical source of truth. All Supabase migrations must match this exactly.**
**When this file changes, create a new migration in `/supabase/migrations/`.**

---

## Extensions Required

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

---

## Core Listing Tables

### `properties`
Model A only. Populated by the bulk scraping pipeline.

```sql
CREATE TABLE properties (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source                      TEXT NOT NULL,
  source_id                   TEXT NOT NULL,
  source_url                  TEXT NOT NULL UNIQUE,
  ref_catastral               TEXT,

  lat                         DECIMAL(10,7) NOT NULL,
  lng                         DECIMAL(10,7) NOT NULL,
  geom                        GEOGRAPHY(POINT, 4326),
  address                     TEXT,
  municipio                   TEXT,
  provincia                   TEXT,
  comunidad_autonoma          TEXT,
  codigo_postal               TEXT,

  price_asking                INTEGER,
  price_per_sqm               DECIMAL(8,2),
  area_sqm                    INTEGER,
  bedrooms                    SMALLINT,
  bathrooms                   SMALLINT,
  property_type               TEXT,
  floor                       SMALLINT,
  build_year                  SMALLINT,
  condition                   TEXT,

  catastro_valor_referencia   INTEGER,
  catastro_area_sqm           DECIMAL(8,2),
  catastro_year_built         SMALLINT,
  negotiation_gap_pct         DECIMAL(5,2),

  epc_rating                  CHAR(1),
  epc_potential               CHAR(1),

  seller_type                 TEXT,

  first_seen_at               TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at                TIMESTAMPTZ DEFAULT NOW(),
  price_changed_at            TIMESTAMPTZ,
  price_previous              INTEGER,
  days_on_market              INTEGER,
  is_active                   BOOLEAN DEFAULT TRUE,

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
CREATE INDEX properties_tvi_idx ON properties (tvi_score) WHERE is_active = TRUE;
```

### `analysis_cache`
Model B. On-demand analysis results. 48h TTL.

```sql
CREATE TABLE analysis_cache (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url            TEXT NOT NULL UNIQUE,
  source                TEXT,
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

  catastro_valor_referencia   INTEGER,
  catastro_year_built         SMALLINT,
  negotiation_gap_pct         DECIMAL(5,2),

  pillar_scores         JSONB,
  composite_indicators  JSONB,
  alerts                JSONB,
  tvi_score             DECIMAL(5,2),

  extracted_at          TIMESTAMPTZ DEFAULT NOW(),
  expires_at            TIMESTAMPTZ DEFAULT NOW() + INTERVAL '48 hours',
  extraction_version    TEXT DEFAULT '1.0',
  price_logged          BOOLEAN DEFAULT FALSE
);

CREATE INDEX analysis_cache_url_idx ON analysis_cache (source_url);
CREATE INDEX analysis_cache_postal_idx ON analysis_cache (codigo_postal);
CREATE INDEX analysis_cache_expires_idx ON analysis_cache (expires_at);
CREATE INDEX analysis_cache_geom_idx ON analysis_cache USING GIST (geom);
```

---

## Scoring Tables (Model A)

### `property_scores`

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

CREATE UNIQUE INDEX property_scores_property_idx ON property_scores (property_id);
```

### `composite_indicators`

```sql
CREATE TABLE composite_indicators (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id                     UUID REFERENCES properties(id) ON DELETE CASCADE,

  -- Tier 1: Within-pillar
  true_affordability_score        DECIMAL(5,2),
  true_affordability_monthly_eur  INTEGER,
  structural_liability_index      DECIMAL(5,2),
  structural_liability_est_eur    INTEGER,
  digital_viability_score         DECIMAL(5,2),
  health_security_score           DECIMAL(5,2),
  education_opportunity_score     DECIMAL(5,2),

  -- Tier 2: Cross-pillar
  neighbourhood_transition_index  DECIMAL(5,2),
  nti_signal                      TEXT,
  community_stability_score       DECIMAL(5,2),

  -- Indicator 8: Climate & Solar Score (expanded)
  climate_solar_score             DECIMAL(5,2),   -- composite 0-100
  sunshine_hours_annual           INTEGER,         -- e.g. 2847
  sunshine_hours_monthly          DECIMAL(4,1)[],  -- array[12] daily avg per month
  hdd_annual                      INTEGER,         -- heating degree days
  cdd_annual                      INTEGER,         -- cooling degree days
  building_aspect                 TEXT,            -- 'N'|'NE'|'E'|'SE'|'S'|'SW'|'W'|'NW'|null
  damp_risk_index                 DECIMAL(5,2),    -- 0-100
  days_above_35c_annual           INTEGER,
  days_above_35c_trend            DECIMAL(5,2),    -- change vs 2000-2010 baseline
  heating_cost_annual_eur         INTEGER,         -- derived, also used in Indicator 1
  cooling_cost_annual_eur         INTEGER,         -- derived, also used in Indicator 1
  rainfall_annual_mm              INTEGER,
  humidity_annual_pct             DECIMAL(4,1),

  infrastructure_arbitrage_score  DECIMAL(5,2),
  motivated_seller_index          DECIMAL(5,2),
  rental_trap_index               DECIMAL(5,2),
  rental_trap_monthly_delta_eur   INTEGER,
  expat_liveability_score         DECIMAL(5,2),

  -- Tier 3: Temporal
  price_velocity_score            DECIMAL(5,2),
  price_velocity_pct_3m           DECIMAL(5,2),
  price_velocity_pct_12m          DECIMAL(5,2),
  dom_velocity                    DECIMAL(5,2),
  gentrification_confirmation     TEXT,
  seasonal_distortion_pct         DECIMAL(5,2),

  indicators_version              TEXT DEFAULT '1.0',
  calculated_at                   TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX composite_indicators_property_idx ON composite_indicators (property_id);
CREATE INDEX ci_nti_signal_idx ON composite_indicators (nti_signal) WHERE nti_signal IS NOT NULL;
CREATE INDEX ci_motivated_seller_idx ON composite_indicators (motivated_seller_index);
CREATE INDEX ci_damp_risk_idx ON composite_indicators (damp_risk_index);
CREATE INDEX ci_sunshine_idx ON composite_indicators (sunshine_hours_annual);
```

### `alerts` (Model A only)

```sql
CREATE TABLE alerts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   UUID REFERENCES properties(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('green', 'amber', 'red')),
  category      TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  data_source   TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX alerts_property_idx ON alerts (property_id);
CREATE INDEX alerts_type_idx ON alerts (type);
```

---

## Time-Series Tables

### `property_price_history`
Written by both Model A (scraper) and Model B (on-demand analysis). Every analysis writes here.

```sql
CREATE TABLE property_price_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   UUID REFERENCES properties(id) ON DELETE SET NULL,
  cache_id      UUID REFERENCES analysis_cache(id) ON DELETE SET NULL,
  source_url    TEXT NOT NULL,
  codigo_postal TEXT,
  price         INTEGER NOT NULL,
  price_per_sqm DECIMAL(8,2),
  observed_at   TIMESTAMPTZ DEFAULT NOW(),
  source        TEXT CHECK (source IN ('scraper', 'user_submission', 'price_alert_check'))
);

CREATE INDEX pph_url_idx ON property_price_history (source_url, observed_at DESC);
CREATE INDEX pph_postal_idx ON property_price_history (codigo_postal, observed_at DESC);
```

### `zone_metrics_history`

```sql
CREATE TABLE zone_metrics_history (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_type                 TEXT NOT NULL CHECK (zone_type IN ('codigo_postal', 'municipio')),
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
  data_source               TEXT CHECK (data_source IN ('scraper', 'mixed', 'submissions_only')),
  UNIQUE (zone_type, zone_id, recorded_date)
);

CREATE INDEX zmh_zone_date_idx ON zone_metrics_history (zone_type, zone_id, recorded_date DESC);
```

### `amenity_history`

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

---

## QoL Reference Tables

### `flood_zones`
```sql
CREATE TABLE flood_zones (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  geom       GEOGRAPHY(MULTIPOLYGON, 4326) NOT NULL,
  risk_level TEXT CHECK (risk_level IN ('T10', 'T100', 'T500')),
  source     TEXT DEFAULT 'snczi',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX flood_zones_geom_idx ON flood_zones USING GIST (geom);
```

### `schools`
```sql
CREATE TABLE schools (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        TEXT,
  tipo          TEXT CHECK (tipo IN ('publico', 'concertado', 'privado')),
  etapas        TEXT[],
  lat           DECIMAL(10,7),
  lng           DECIMAL(10,7),
  geom          GEOGRAPHY(POINT, 4326),
  municipio     TEXT,
  provincia     TEXT,
  codigo_postal TEXT,
  rating_score  DECIMAL(3,1),
  source        TEXT DEFAULT 'minedu',
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX schools_geom_idx ON schools USING GIST (geom);
```

### `school_catchments`
```sql
CREATE TABLE school_catchments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   UUID REFERENCES schools(id) ON DELETE CASCADE,
  geom        GEOGRAPHY(POLYGON, 4326) NOT NULL,
  region      TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX school_catchments_geom_idx ON school_catchments USING GIST (geom);
```

### `health_centres`
```sql
CREATE TABLE health_centres (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     TEXT,
  tipo       TEXT CHECK (tipo IN ('centro_salud', 'hospital', 'urgencias_24h', 'farmacia', 'clinica')),
  is_24h     BOOLEAN DEFAULT FALSE,
  lat        DECIMAL(10,7),
  lng        DECIMAL(10,7),
  geom       GEOGRAPHY(POINT, 4326),
  municipio  TEXT,
  provincia  TEXT,
  source     TEXT DEFAULT 'resc',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX health_centres_geom_idx ON health_centres USING GIST (geom);
CREATE INDEX health_centres_24h_idx ON health_centres (is_24h) WHERE is_24h = TRUE;
```

### `transport_stops`
```sql
CREATE TABLE transport_stops (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     TEXT,
  tipo       TEXT CHECK (tipo IN ('bus', 'metro', 'cercanias', 'ave', 'tram', 'ferry')),
  lat        DECIMAL(10,7),
  lng        DECIMAL(10,7),
  geom       GEOGRAPHY(POINT, 4326),
  freq_daily INTEGER,
  operator   TEXT,
  source     TEXT DEFAULT 'mitma_gtfs',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX transport_stops_geom_idx ON transport_stops USING GIST (geom);
```

### `amenities`
```sql
CREATE TABLE amenities (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     TEXT,
  category   TEXT,
  lat        DECIMAL(10,7),
  lng        DECIMAL(10,7),
  geom       GEOGRAPHY(POINT, 4326),
  municipio  TEXT,
  source     TEXT DEFAULT 'osm',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX amenities_geom_idx ON amenities USING GIST (geom);
CREATE INDEX amenities_category_idx ON amenities (category);
```

### `crime_stats`
```sql
CREATE TABLE crime_stats (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio         TEXT NOT NULL,
  provincia         TEXT,
  year_month        DATE NOT NULL,
  violent_crime     INTEGER,
  property_crime    INTEGER,
  antisocial        INTEGER,
  total             INTEGER,
  per_1000_pop      DECIMAL(6,3),
  trend_12m         DECIMAL(5,2),
  source            TEXT DEFAULT 'mir',
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (municipio, year_month)
);
CREATE INDEX crime_stats_municipio_idx ON crime_stats (municipio, year_month DESC);
```

### `fibre_coverage`
```sql
CREATE TABLE fibre_coverage (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  geom           GEOGRAPHY(POLYGON, 4326) NOT NULL,
  coverage_type  TEXT CHECK (coverage_type IN ('FTTP', 'FTTC', 'HFC', 'none')),
  max_speed_mbps INTEGER,
  operator       TEXT,
  source         TEXT DEFAULT 'cnmc',
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX fibre_coverage_geom_idx ON fibre_coverage USING GIST (geom);
```

### `ite_status`
```sql
CREATE TABLE ite_status (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_catastral   TEXT,
  address         TEXT,
  lat             DECIMAL(10,7),
  lng             DECIMAL(10,7),
  geom            GEOGRAPHY(POINT, 4326),
  status          TEXT CHECK (status IN ('passed', 'failed', 'pending', 'not_required')),
  inspection_date DATE,
  due_date        DATE,
  municipio       TEXT,
  source          TEXT,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ite_status_ref_catastral_idx ON ite_status (ref_catastral);
CREATE INDEX ite_status_geom_idx ON ite_status USING GIST (geom);
```

### `vut_licences`
```sql
CREATE TABLE vut_licences (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  licence_ref TEXT,
  address     TEXT,
  lat         DECIMAL(10,7),
  lng         DECIMAL(10,7),
  geom        GEOGRAPHY(POINT, 4326),
  region      TEXT,
  status      TEXT CHECK (status IN ('active', 'cancelled')),
  source      TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX vut_licences_geom_idx ON vut_licences USING GIST (geom);
CREATE INDEX vut_licences_postal_idx ON vut_licences (region);
```

### `infrastructure_projects`
```sql
CREATE TABLE infrastructure_projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        TEXT,
  type          TEXT CHECK (type IN (
    'metro_extension', 'ave_station', 'cercanias_station',
    'park', 'school', 'hospital', 'industrial', 'commercial',
    'road', 'cycle_path', 'cultural', 'other'
  )),
  status        TEXT CHECK (status IN ('approved', 'under_construction', 'planned')),
  expected_date DATE,
  geom          GEOGRAPHY(GEOMETRY, 4326),
  municipio     TEXT,
  source        TEXT,
  source_url    TEXT,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX infrastructure_projects_geom_idx ON infrastructure_projects USING GIST (geom);
CREATE INDEX infrastructure_projects_type_idx ON infrastructure_projects (type);
```

### `airports`
```sql
CREATE TABLE airports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      TEXT,
  iata_code   TEXT UNIQUE,
  lat         DECIMAL(10,7),
  lng         DECIMAL(10,7),
  geom        GEOGRAPHY(POINT, 4326),
  weekly_flights INTEGER,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX airports_geom_idx ON airports USING GIST (geom);
```

### `climate_data`
Per-municipio climate normals. Populated from AEMET 30-year climate normals (1991–2020) and ERA5 reanalysis gap-fill. One row per municipio. Updated annually when AEMET refreshes normals.

```sql
CREATE TABLE climate_data (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_code              TEXT NOT NULL UNIQUE,  -- INE municipio code
  municipio_name              TEXT,
  provincia                   TEXT,

  -- Sunshine
  sunshine_hours_annual       INTEGER,               -- total annual sunshine hours
  sunshine_hours_jan          DECIMAL(4,1),          -- avg daily hours per month
  sunshine_hours_feb          DECIMAL(4,1),
  sunshine_hours_mar          DECIMAL(4,1),
  sunshine_hours_apr          DECIMAL(4,1),
  sunshine_hours_may          DECIMAL(4,1),
  sunshine_hours_jun          DECIMAL(4,1),
  sunshine_hours_jul          DECIMAL(4,1),
  sunshine_hours_aug          DECIMAL(4,1),
  sunshine_hours_sep          DECIMAL(4,1),
  sunshine_hours_oct          DECIMAL(4,1),
  sunshine_hours_nov          DECIMAL(4,1),
  sunshine_hours_dec          DECIMAL(4,1),

  -- Temperature
  hdd_annual                  INTEGER,               -- heating degree days (base 15.5°C)
  cdd_annual                  INTEGER,               -- cooling degree days (base 22°C)
  temp_mean_annual_c          DECIMAL(4,1),
  temp_mean_jan_c             DECIMAL(4,1),
  temp_mean_jul_c             DECIMAL(4,1),
  temp_min_record_c           DECIMAL(4,1),
  temp_max_record_c           DECIMAL(4,1),

  -- Extreme heat
  days_above_35c_annual       INTEGER,               -- current 30-yr normal
  days_above_35c_trend        DECIMAL(5,2),          -- change vs 2000-2010 baseline
  days_above_40c_annual       INTEGER,

  -- Precipitation and humidity
  rainfall_annual_mm          INTEGER,
  rainfall_jan_mm             INTEGER,
  rainfall_jul_mm             INTEGER,               -- useful for coastal/inland split
  humidity_annual_pct         DECIMAL(4,1),          -- annual mean relative humidity
  humidity_winter_pct         DECIMAL(4,1),          -- Oct-Mar mean (damp risk relevant)

  -- Data source
  aemet_station_id            TEXT,                  -- nearest AEMET station used
  era5_gap_fill               BOOLEAN DEFAULT FALSE, -- true if ERA5 used instead of AEMET
  data_year_from              SMALLINT DEFAULT 1991,
  data_year_to                SMALLINT DEFAULT 2020,
  updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX climate_data_municipio_idx ON climate_data (municipio_code);
```

### `solar_radiation`
Coordinate-level solar irradiance from PVGIS JRC. Queried on-demand per property analysis and cached here. Monthly Global Horizontal Irradiance (GHI) in kWh/m².

```sql
CREATE TABLE solar_radiation (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lat                         DECIMAL(10,7) NOT NULL,
  lng                         DECIMAL(10,7) NOT NULL,
  geom                        GEOGRAPHY(POINT, 4326),

  -- Annual
  ghi_annual_kwh_m2           DECIMAL(7,2),          -- total annual solar radiation

  -- Monthly (kWh/m²/month)
  ghi_jan                     DECIMAL(6,2),
  ghi_feb                     DECIMAL(6,2),
  ghi_mar                     DECIMAL(6,2),
  ghi_apr                     DECIMAL(6,2),
  ghi_may                     DECIMAL(6,2),
  ghi_jun                     DECIMAL(6,2),
  ghi_jul                     DECIMAL(6,2),
  ghi_aug                     DECIMAL(6,2),
  ghi_sep                     DECIMAL(6,2),
  ghi_oct                     DECIMAL(6,2),
  ghi_nov                     DECIMAL(6,2),
  ghi_dec                     DECIMAL(6,2),

  pvgis_version               TEXT DEFAULT 'PVGIS-5',
  queried_at                  TIMESTAMPTZ DEFAULT NOW()
);

-- Spatial index for proximity lookup; unique constraint prevents duplicate queries
CREATE INDEX solar_radiation_geom_idx ON solar_radiation USING GIST (geom);
-- Round coordinates to 0.01° (~1km) for cache efficiency
CREATE UNIQUE INDEX solar_radiation_coord_idx ON solar_radiation
  (ROUND(lat::NUMERIC, 2), ROUND(lng::NUMERIC, 2));
```

### `building_orientation`
Facade aspect (cardinal direction) per property. Sourced from Catastro where available; derived from building footprint geometry where not.

```sql
CREATE TABLE building_orientation (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_catastral   TEXT NOT NULL UNIQUE,
  aspect          TEXT CHECK (aspect IN ('N','NE','E','SE','S','SW','W','NW')),
  aspect_degrees  SMALLINT,           -- 0=N, 90=E, 180=S, 270=W
  source          TEXT CHECK (source IN ('catastro_explicit', 'footprint_derived', 'manual')),
  confidence      TEXT CHECK (confidence IN ('high', 'medium', 'low')),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX building_orientation_ref_idx ON building_orientation (ref_catastral);
```

---

## Reference Lookup Tables

### `itp_rates`
```sql
CREATE TABLE itp_rates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comunidad_autonoma  TEXT NOT NULL UNIQUE,
  standard_rate_pct   DECIMAL(4,2),
  reduced_rate_pct    DECIMAL(4,2),
  reduced_conditions  TEXT,
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
```

### `ico_caps`
```sql
CREATE TABLE ico_caps (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comunidad_autonoma    TEXT NOT NULL,
  max_price_eur         INTEGER,
  max_age               SMALLINT,
  max_income_eur        INTEGER,
  guarantee_pct         DECIMAL(4,2),
  valid_from            DATE,
  valid_until           DATE,
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);
```

### `rental_benchmarks`
```sql
CREATE TABLE rental_benchmarks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_postal    TEXT,
  municipio        TEXT,
  median_rent_sqm  DECIMAL(8,2),
  sample_size      INTEGER,
  recorded_month   DATE NOT NULL,
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (codigo_postal, recorded_month)
);
```

### `municipio_income`
```sql
CREATE TABLE municipio_income (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_code        TEXT NOT NULL,
  municipio_name        TEXT,
  median_income_annual  INTEGER,
  year                  SMALLINT,
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (municipio_code, year)
);
```

### `eco_constants`
Single-row lookup table for financial and energy constants that change over time. Updated manually on a monthly or quarterly basis. All Indicator 1 and Indicator 8 energy calculations reference this table.

```sql
CREATE TABLE eco_constants (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Mortgage
  ecb_base_rate_pct         DECIMAL(4,3),    -- e.g. 3.400
  typical_bank_spread_pct   DECIMAL(4,3),    -- e.g. 1.200
  euribor_12m_pct           DECIMAL(4,3),

  -- Energy tariffs (Spain regulated rates)
  gas_price_kwh_eur         DECIMAL(6,5),    -- e.g. 0.07200 €/kWh
  electricity_pvpc_kwh_eur  DECIMAL(6,5),    -- e.g. 0.18500 €/kWh (PVPC avg)

  -- EPC U-value coefficients (W/m²K) — updated if building regs change
  u_value_epc_a             DECIMAL(4,3) DEFAULT 0.300,
  u_value_epc_b             DECIMAL(4,3) DEFAULT 0.500,
  u_value_epc_c             DECIMAL(4,3) DEFAULT 0.700,
  u_value_epc_d             DECIMAL(4,3) DEFAULT 1.000,
  u_value_epc_e             DECIMAL(4,3) DEFAULT 1.400,
  u_value_epc_f             DECIMAL(4,3) DEFAULT 1.800,
  u_value_epc_g             DECIMAL(4,3) DEFAULT 2.300,

  -- Solar gain capture factors by orientation (fraction of GHI captured passively)
  solar_gain_s              DECIMAL(4,3) DEFAULT 0.150,
  solar_gain_se_sw          DECIMAL(4,3) DEFAULT 0.100,
  solar_gain_e_w            DECIMAL(4,3) DEFAULT 0.050,
  solar_gain_ne_nw          DECIMAL(4,3) DEFAULT 0.020,
  solar_gain_n              DECIMAL(4,3) DEFAULT 0.000,

  valid_from                DATE NOT NULL,
  valid_until               DATE,
  notes                     TEXT,
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);
```

### `user_profiles`
```sql
CREATE TABLE user_profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id),
  email           TEXT,
  tier            TEXT NOT NULL DEFAULT 'free'
                  CHECK (tier IN ('free', 'pro', 'explorer', 'intelligence')),
  tier_expires_at TIMESTAMPTZ,
  stripe_customer_id TEXT UNIQUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### `user_analyses`
```sql
CREATE TABLE user_analyses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  cache_id     UUID REFERENCES analysis_cache(id) ON DELETE SET NULL,
  source_url   TEXT NOT NULL,
  is_saved     BOOLEAN DEFAULT FALSE,
  notes        TEXT,
  analysed_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX user_analyses_user_idx ON user_analyses (user_id, analysed_at DESC);
CREATE INDEX user_analyses_saved_idx ON user_analyses (user_id) WHERE is_saved = TRUE;
```

### `url_price_alerts`
```sql
CREATE TABLE url_price_alerts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  source_url   TEXT NOT NULL,
  last_price   INTEGER,
  is_active    BOOLEAN DEFAULT TRUE,
  last_checked TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX url_price_alerts_user_idx ON url_price_alerts (user_id) WHERE is_active = TRUE;
```

### `saved_properties` (Model A — Explorer+)
```sql
CREATE TABLE saved_properties (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
  notes       TEXT,
  saved_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, property_id)
);
```

### `user_filter_presets`
```sql
CREATE TABLE user_filter_presets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  preset_name     TEXT NOT NULL,
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
  area_sqm_min    INTEGER,
  property_types  TEXT[],
  ico_only        BOOLEAN DEFAULT FALSE,
  buyer_age       SMALLINT,
  is_default      BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### `search_alerts` (Model A — Explorer+)
```sql
CREATE TABLE search_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  preset_id       UUID REFERENCES user_filter_presets(id) ON DELETE SET NULL,
  alert_name      TEXT,
  geography_geom  GEOGRAPHY(POLYGON, 4326),
  is_active       BOOLEAN DEFAULT TRUE,
  last_triggered  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### `comparisons`
Stores saved multi-property comparison sets. Works across Model A and Model B — any mix of scraped properties and on-demand analyses can be compared. Share token enables public shareable comparison links (no auth required to view, same as D-015).

```sql
CREATE TABLE comparisons (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  name            TEXT,                     -- user-named: "Málaga shortlist March 2026"
  source_urls     TEXT[] NOT NULL,          -- ordered array of property URLs
  cache_ids       UUID[],                   -- ordered array of analysis_cache ids (populated async)
  preset_id       UUID REFERENCES user_filter_presets(id) ON DELETE SET NULL,
  is_shared       BOOLEAN DEFAULT FALSE,
  share_token     TEXT UNIQUE DEFAULT encode(gen_random_bytes(12), 'hex'),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX comparisons_user_idx ON comparisons (user_id, created_at DESC);
CREATE INDEX comparisons_share_token_idx ON comparisons (share_token) WHERE is_shared = TRUE;
```

### `scrape_queue`
Model A pipeline only. Discovered listing URLs waiting for Parse.bot extraction.

```sql
CREATE TABLE scrape_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url      TEXT NOT NULL UNIQUE,
  source          TEXT NOT NULL,            -- 'idealista' | 'fotocasa' etc
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'complete', 'failed')),
  attempts        SMALLINT DEFAULT 0,
  last_attempted  TIMESTAMPTZ,
  error_message   TEXT,
  queued_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX scrape_queue_status_idx ON scrape_queue (status, queued_at ASC)
  WHERE status IN ('pending', 'failed');
```

---

## Row Level Security (RLS) Policies

```sql
-- QoL reference tables: publicly readable
ALTER TABLE flood_zones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read" ON flood_zones FOR SELECT USING (true);
-- (repeat for: schools, school_catchments, health_centres, transport_stops,
--  amenities, amenity_history, crime_stats, fibre_coverage, ite_status,
--  vut_licences, infrastructure_projects, airports, itp_rates, ico_caps,
--  rental_benchmarks, municipio_income)

-- analysis_cache: publicly readable by id (shareable reports)
ALTER TABLE analysis_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read" ON analysis_cache FOR SELECT USING (true);

-- properties, property_scores, composite_indicators: publicly readable
-- (tier gating is at API layer, not DB layer — see TIERS.md D-010)
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read" ON properties FOR SELECT USING (true);

-- User tables: users access only their own rows
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_row" ON user_profiles
  FOR ALL USING (auth.uid() = id);

ALTER TABLE user_analyses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_rows" ON user_analyses
  FOR ALL USING (auth.uid() = user_id);

ALTER TABLE url_price_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_rows" ON url_price_alerts
  FOR ALL USING (auth.uid() = user_id);

ALTER TABLE saved_properties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_rows" ON saved_properties
  FOR ALL USING (auth.uid() = user_id);

ALTER TABLE user_filter_presets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_rows" ON user_filter_presets
  FOR ALL USING (auth.uid() = user_id);

ALTER TABLE search_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_rows" ON search_alerts
  FOR ALL USING (auth.uid() = user_id);

-- comparisons: users access own rows; shared comparisons readable by anyone via share_token
ALTER TABLE comparisons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_rows" ON comparisons
  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "public_shared" ON comparisons
  FOR SELECT USING (is_shared = TRUE);

-- scrape_queue: service role only (no user access)
ALTER TABLE scrape_queue ENABLE ROW LEVEL SECURITY;
-- No user-facing policy — accessed only via SUPABASE_SERVICE_ROLE_KEY
```

---

## Migration Naming Convention

```
supabase/migrations/
├── 001_initial_schema.sql           — all tables above
├── 002_rls_policies.sql             — all RLS policies above
├── 003_seed_reference_data.sql      — static ITP rates, ICO caps etc
├── 004_<description>.sql            — future changes
```

Always increment the number. Never modify existing migration files — add new ones.
