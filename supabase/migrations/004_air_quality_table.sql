-- ============================================================
-- 004_air_quality_table.sql
-- Qolify — Air quality readings table + composite_indicators columns
-- CHI-328 — MITECO air quality ingestion
-- ============================================================

-- Air quality readings from MITECO Red de Calidad del Aire
-- One row per (station_id, reading_at) — daily upsert cadence
CREATE TABLE air_quality_readings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id            TEXT NOT NULL,
  station_name          TEXT,
  municipio_code        TEXT,
  municipio_name        TEXT,
  provincia             TEXT,
  lat                   DECIMAL(10,7),
  lng                   DECIMAL(10,7),
  geom                  GEOGRAPHY(POINT, 4326),

  -- Index pollutants (µg/m³ unless noted)
  aqi_value             SMALLINT,
  aqi_category          TEXT CHECK (aqi_category IN (
                           'bueno', 'razonable', 'regular',
                           'malo', 'muy_malo', 'extremadamente_malo'
                         )),
  pm25_ugm3             DECIMAL(6,2),
  pm10_ugm3             DECIMAL(6,2),
  no2_ugm3              DECIMAL(6,2),
  o3_ugm3               DECIMAL(6,2),
  so2_ugm3              DECIMAL(6,2),
  co_mgm3               DECIMAL(6,2),   -- mg/m³ (CO reported in mg)

  -- Computed aggregates (updated per-station on each daily upsert)
  aqi_annual_avg        DECIMAL(6,2),   -- rolling 12-month mean AQI
  aqi_trend_12m         DECIMAL(5,2),   -- positive = worsening

  reading_at            TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX air_quality_station_reading_idx
  ON air_quality_readings (station_id, reading_at);

CREATE INDEX air_quality_station_municipio_idx
  ON air_quality_readings (municipio_code);

CREATE INDEX air_quality_reading_time_idx
  ON air_quality_readings (reading_at DESC);

CREATE INDEX air_quality_geom_idx
  ON air_quality_readings USING GIST (geom);

-- RLS: public read (AQI is not sensitive data)
ALTER TABLE air_quality_readings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read" ON air_quality_readings
  FOR SELECT USING (true);

-- ============================================================
-- Extend composite_indicators with AQI columns (CHI-328 Step 4)
-- ============================================================

ALTER TABLE composite_indicators
  ADD COLUMN IF NOT EXISTS aqi_annual_avg  DECIMAL(6,2),
  ADD COLUMN IF NOT EXISTS aqi_category    TEXT,
  ADD COLUMN IF NOT EXISTS aqi_score       DECIMAL(5,2);

-- ============================================================
-- Helper view: latest AQI reading per municipio
-- Used by indicator engine to get current air quality for a municipio
-- ============================================================

CREATE OR REPLACE VIEW air_quality_latest_by_municipio AS
SELECT DISTINCT ON (municipio_code)
  municipio_code,
  municipio_name,
  provincia,
  aqi_value,
  aqi_category,
  aqi_annual_avg,
  aqi_trend_12m,
  reading_at
FROM air_quality_readings
WHERE municipio_code IS NOT NULL
ORDER BY municipio_code, reading_at DESC;
