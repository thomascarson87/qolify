-- CHI-393: Create mobile_coverage table for CNMC 4G/5G polygons.
--
-- Digital Viability currently only considers fixed fibre. Mobile coverage
-- (4G near-universal, 5G in urban cores) is often the primary connectivity
-- signal for rural buyers and remote workers.
--
-- Schema mirrors fibre_coverage (GEOGRAPHY so spatial predicates use metres
-- out of the box, matching the Digital Viability CTE).

CREATE TABLE IF NOT EXISTS mobile_coverage (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  geom              GEOGRAPHY(POLYGON, 4326) NOT NULL,
  technology        TEXT CHECK (technology IN ('3G', '4G', '5G')),
  operator          TEXT,
  download_mbps_typ INTEGER,
  source            TEXT DEFAULT 'cnmc',
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mobile_coverage_geom_idx       ON mobile_coverage USING GIST (geom);
CREATE INDEX IF NOT EXISTS mobile_coverage_technology_idx ON mobile_coverage (technology);
