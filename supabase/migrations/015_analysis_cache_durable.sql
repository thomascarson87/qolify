-- 015_analysis_cache_durable.sql
-- CHI-347: Analysis reports are now durable artefacts, not a 48h cache.
--
-- Rationale: each analysis burns Parse.bot / Catastro / PVGIS credits, and the
-- report is the product. Expiring a row after 48h meant reloading /analyse/[jobId]
-- after two days silently re-ran the full pipeline (when the /api/analyse POST
-- was hit again) or fell back to a cache lookup without the TTL check. By making
-- expires_at nullable-by-default and setting existing rows to NULL, every
-- completed analysis becomes a permanent report readable indefinitely by jobId.
--
-- A future "Refresh report" action can explicitly re-run the pipeline; until
-- then, the original result stands.
--
-- What this migration does:
--   1. Drops the 48h default on expires_at (new rows default to NULL).
--   2. NULLs existing expires_at values so previously-cached reports become
--      durable retroactively.
--
-- The column itself is kept so tier-gated on-demand "Refresh report" logic can
-- re-use it later (set a short expiry to force re-run). See SCHEMA.md.

BEGIN;

ALTER TABLE analysis_cache
  ALTER COLUMN expires_at DROP DEFAULT;

-- Backfill: make all existing reports durable. Safe — nothing in the codebase
-- now treats a NULL expires_at as "expired"; both the POST /api/analyse cache
-- lookup and the GET /api/analyse/status fallback treat NULL as "still valid".
UPDATE analysis_cache
   SET expires_at = NULL
 WHERE expires_at IS NOT NULL;

COMMIT;
