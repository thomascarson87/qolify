-- ============================================================
-- 005_municipios_table.sql
-- Qolify — Spanish municipios reference table
-- Prerequisite for CHI-322 (AEMET climate ingestion)
--
-- Populated by: scripts/ingest/ingest_municipios.py
-- Source: OSM Overpass (admin_level=8 boundaries + ref:INE tags)
-- ~8,100 municipios covering all of Spain
-- ============================================================

CREATE TABLE IF NOT EXISTS municipios (
  municipio_code  TEXT PRIMARY KEY,       -- 5-digit INE code (e.g. '29067' = Málaga)
  municipio_name  TEXT NOT NULL,
  provincia       TEXT,
  comunidad       TEXT,
  lat             DECIMAL(10,7),
  lng             DECIMAL(10,7),
  geom            GEOGRAPHY(POINT, 4326) NOT NULL,  -- centroid of boundary
  population      INTEGER,                           -- INE census (optional, backfill later)
  osm_id          TEXT,
  source          TEXT DEFAULT 'osm',
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS municipios_geom_idx  ON municipios USING GIST (geom);
CREATE INDEX IF NOT EXISTS municipios_name_idx  ON municipios (municipio_name);
CREATE INDEX IF NOT EXISTS municipios_prov_idx  ON municipios (provincia);

-- RLS: public read (reference data, not sensitive)
ALTER TABLE municipios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read" ON municipios FOR SELECT USING (true);

-- ============================================================
-- Spatial lookup function
-- Used by ingest_aemet_climate.py to map AEMET stations
-- to their nearest municipio
-- ============================================================

CREATE OR REPLACE FUNCTION nearest_municipio(
    p_lat   DECIMAL,
    p_lng   DECIMAL,
    max_km  INT DEFAULT 25
)
RETURNS TABLE (
    municipio_code  TEXT,
    municipio_name  TEXT,
    provincia       TEXT
)
LANGUAGE sql STABLE AS $$
    SELECT municipio_code, municipio_name, provincia
    FROM municipios
    WHERE ST_DWithin(
        geom,
        ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
        max_km * 1000
    )
    ORDER BY geom <-> ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
    LIMIT 1;
$$;
