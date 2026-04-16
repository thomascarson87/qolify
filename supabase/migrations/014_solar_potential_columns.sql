-- Migration 014: Solar potential support columns
-- Adds three groups of columns needed for the solar potential computation step
-- in the analyse-job edge function (CHI-380).

-- ── 1. eco_constants ──────────────────────────────────────────────────────────
-- Solar financial parameters seeded quarterly alongside energy prices.
ALTER TABLE eco_constants
  ADD COLUMN IF NOT EXISTS solar_export_rate_eur       DECIMAL(6,5) DEFAULT 0.07000,
  ADD COLUMN IF NOT EXISTS solar_install_cost_per_kwp  DECIMAL(8,2) DEFAULT 1200.00;

-- ── 2. building_orientation ───────────────────────────────────────────────────
-- Catastro building-level dimensions needed for system sizing.
-- Populated by the Catastro ingest script when building footprint data is available.
ALTER TABLE building_orientation
  ADD COLUMN IF NOT EXISTS footprint_area_m2  DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS num_floors         SMALLINT;

-- ── 3. analysis_cache ─────────────────────────────────────────────────────────
-- Stores the full SolarPotentialResult JSON blob for the DNA Report solar card.
ALTER TABLE analysis_cache
  ADD COLUMN IF NOT EXISTS solar_potential_result JSONB;
