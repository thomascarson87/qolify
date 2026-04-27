-- 019_health_quality_signals.sql
-- CHI-385: Add facility-level quality signals to health_centres.
--
-- Three new columns:
--   surgery_wait_days       — most recent SAS-published surgical wait (days) for this facility
--   wait_recorded_quarter   — quarter the wait figure was published (e.g. '2025-Q4')
--   acsa_accreditation      — Agencia de Calidad Sanitaria de Andalucía accreditation level
--
-- We extend health_centres rather than add a join table because the indicator
-- only ever reads the current value per facility — a join in the hot CTE would
-- be wasted work. If/when we want history, add health_centre_wait_history later.

ALTER TABLE health_centres
  ADD COLUMN IF NOT EXISTS surgery_wait_days     INTEGER,
  ADD COLUMN IF NOT EXISTS wait_recorded_quarter TEXT,
  ADD COLUMN IF NOT EXISTS acsa_accreditation    TEXT
    CHECK (acsa_accreditation IN ('avanzada', 'optima', 'excelente'));

-- Lookup index: indicator joins by nearest-hospital then reads wait figure.
-- Partial index keeps it small — most rows have NULL.
CREATE INDEX IF NOT EXISTS health_centres_wait_idx
  ON health_centres (surgery_wait_days)
  WHERE surgery_wait_days IS NOT NULL;

CREATE INDEX IF NOT EXISTS health_centres_acsa_idx
  ON health_centres (acsa_accreditation)
  WHERE acsa_accreditation IS NOT NULL;
