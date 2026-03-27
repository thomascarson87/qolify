-- ============================================================
-- 006_helper_functions.sql
-- Qolify — PostGIS spatial lookup functions + schema patches
--
-- Functions:
--   nearest_solar_grid_point()  — used by Indicator 8c (Solar Potential)
--   nearest_transport_stop()    — used by Indicator 4 (Connectivity)
--
-- Schema patches:
--   amenity_history.osm_id unique constraint  — enables ON CONFLICT in monthly diff
-- ============================================================

-- ============================================================
-- Unique constraint for amenity_history monthly diff logic
-- ingest_amenities.py uses ON CONFLICT (osm_id) DO NOTHING
-- to avoid re-seeding on subsequent runs (NTI baseline stays clean)
-- ============================================================
ALTER TABLE amenity_history
  ADD CONSTRAINT amenity_history_osm_id_unique UNIQUE (osm_id);


-- ============================================================
-- nearest_solar_grid_point(p_lat, p_lng)
-- Used by Indicator 8c to fetch GHI from the nearest pre-cached
-- PVGIS grid point (~0.1° resolution ≈ 8 km max error).
-- Pre-populated by: scripts/ingest/ingest_pvgis_solar.py
-- ============================================================
CREATE OR REPLACE FUNCTION nearest_solar_grid_point(
    p_lat  DECIMAL,
    p_lng  DECIMAL
)
RETURNS SETOF solar_radiation
LANGUAGE sql STABLE AS $$
    SELECT *
    FROM solar_radiation
    ORDER BY geom <-> ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
    LIMIT 1;
$$;


-- ============================================================
-- nearest_transport_stop(p_lat, p_lng, p_tipo, p_radius_m)
-- Used by Indicator 4 (Connectivity) and Indicator 12 (Expat Liveability).
-- Returns the nearest transport stop within radius, optionally filtered by tipo.
-- Pre-populated by: scripts/ingest/ingest_gtfs.py
-- ============================================================
CREATE OR REPLACE FUNCTION nearest_transport_stop(
    p_lat      DECIMAL,
    p_lng      DECIMAL,
    p_tipo     TEXT    DEFAULT NULL,   -- 'bus'|'metro'|'cercanias'|'ave'|'tram'|'ferry'|NULL for any
    p_radius_m INT     DEFAULT 1000
)
RETURNS TABLE (
    distance_m  INT,
    nombre      TEXT,
    tipo        TEXT,
    freq_daily  INT,
    operator    TEXT
)
LANGUAGE sql STABLE AS $$
    SELECT
        ST_Distance(
            geom,
            ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
        )::INT                          AS distance_m,
        transport_stops.nombre,
        transport_stops.tipo,
        transport_stops.freq_daily,
        transport_stops.operator
    FROM transport_stops
    WHERE
        (p_tipo IS NULL OR transport_stops.tipo = p_tipo)
        AND ST_DWithin(
            geom,
            ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
            p_radius_m
        )
    ORDER BY geom <-> ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
    LIMIT 1;
$$;
