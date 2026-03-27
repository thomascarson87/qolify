-- ============================================================
-- 002_rls_policies.sql
-- Qolify — Row Level Security policies
-- Canonical source: MD files/SCHEMA.md (RLS section)
-- Decision ref: D-010 (tier gating at API layer, not DB layer)
-- ============================================================

-- QoL reference tables: publicly readable (no user PII, no tier sensitivity)
ALTER TABLE flood_zones          ENABLE ROW LEVEL SECURITY;
ALTER TABLE schools              ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_catchments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_centres       ENABLE ROW LEVEL SECURITY;
ALTER TABLE transport_stops      ENABLE ROW LEVEL SECURITY;
ALTER TABLE amenities            ENABLE ROW LEVEL SECURITY;
ALTER TABLE amenity_history      ENABLE ROW LEVEL SECURITY;
ALTER TABLE crime_stats          ENABLE ROW LEVEL SECURITY;
ALTER TABLE fibre_coverage       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ite_status           ENABLE ROW LEVEL SECURITY;
ALTER TABLE vut_licences         ENABLE ROW LEVEL SECURITY;
ALTER TABLE infrastructure_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE airports             ENABLE ROW LEVEL SECURITY;
ALTER TABLE itp_rates            ENABLE ROW LEVEL SECURITY;
ALTER TABLE ico_caps             ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_benchmarks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE municipio_income     ENABLE ROW LEVEL SECURITY;
ALTER TABLE climate_data         ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar_radiation      ENABLE ROW LEVEL SECURITY;
ALTER TABLE building_orientation ENABLE ROW LEVEL SECURITY;
ALTER TABLE eco_constants        ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read" ON flood_zones          FOR SELECT USING (true);
CREATE POLICY "public_read" ON schools              FOR SELECT USING (true);
CREATE POLICY "public_read" ON school_catchments    FOR SELECT USING (true);
CREATE POLICY "public_read" ON health_centres       FOR SELECT USING (true);
CREATE POLICY "public_read" ON transport_stops      FOR SELECT USING (true);
CREATE POLICY "public_read" ON amenities            FOR SELECT USING (true);
CREATE POLICY "public_read" ON amenity_history      FOR SELECT USING (true);
CREATE POLICY "public_read" ON crime_stats          FOR SELECT USING (true);
CREATE POLICY "public_read" ON fibre_coverage       FOR SELECT USING (true);
CREATE POLICY "public_read" ON ite_status           FOR SELECT USING (true);
CREATE POLICY "public_read" ON vut_licences         FOR SELECT USING (true);
CREATE POLICY "public_read" ON infrastructure_projects FOR SELECT USING (true);
CREATE POLICY "public_read" ON airports             FOR SELECT USING (true);
CREATE POLICY "public_read" ON itp_rates            FOR SELECT USING (true);
CREATE POLICY "public_read" ON ico_caps             FOR SELECT USING (true);
CREATE POLICY "public_read" ON rental_benchmarks    FOR SELECT USING (true);
CREATE POLICY "public_read" ON municipio_income     FOR SELECT USING (true);
CREATE POLICY "public_read" ON climate_data         FOR SELECT USING (true);
CREATE POLICY "public_read" ON solar_radiation      FOR SELECT USING (true);
CREATE POLICY "public_read" ON building_orientation FOR SELECT USING (true);
CREATE POLICY "public_read" ON eco_constants        FOR SELECT USING (true);

-- analysis_cache: publicly readable by id (shareable report links — D-015)
ALTER TABLE analysis_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read" ON analysis_cache FOR SELECT USING (true);

-- Model A tables: publicly readable (tier gating is at API layer — D-010)
ALTER TABLE properties             ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_scores        ENABLE ROW LEVEL SECURITY;
ALTER TABLE composite_indicators   ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE zone_metrics_history   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read" ON properties             FOR SELECT USING (true);
CREATE POLICY "public_read" ON property_scores        FOR SELECT USING (true);
CREATE POLICY "public_read" ON composite_indicators   FOR SELECT USING (true);
CREATE POLICY "public_read" ON alerts                 FOR SELECT USING (true);
CREATE POLICY "public_read" ON property_price_history FOR SELECT USING (true);
CREATE POLICY "public_read" ON zone_metrics_history   FOR SELECT USING (true);

-- User tables: users access only their own rows
ALTER TABLE user_profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_analyses      ENABLE ROW LEVEL SECURITY;
ALTER TABLE url_price_alerts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_properties   ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_filter_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_alerts      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_row"  ON user_profiles       FOR ALL USING (auth.uid() = id);
CREATE POLICY "own_rows" ON user_analyses       FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_rows" ON url_price_alerts    FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_rows" ON saved_properties    FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_rows" ON user_filter_presets FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_rows" ON search_alerts       FOR ALL USING (auth.uid() = user_id);

-- comparisons: own rows + public read for shared comparisons (D-015, D-020)
ALTER TABLE comparisons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_rows"       ON comparisons FOR ALL    USING (auth.uid() = user_id);
CREATE POLICY "public_shared"  ON comparisons FOR SELECT USING (is_shared = TRUE);

-- scrape_queue: service role only, no user-facing policy
ALTER TABLE scrape_queue ENABLE ROW LEVEL SECURITY;
