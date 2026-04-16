-- Migration 007: analysis_jobs table
-- Async job queue for the on-demand analysis pipeline (CHI-334).
-- Jobs are created by POST /api/analyse and processed by the Supabase
-- Edge Function `analyse-job`. The client polls GET /api/analyse/status
-- for progress and results.
--
-- NOTE: This migration was run manually in the Supabase SQL editor.
-- This file exists for version control documentation only.

CREATE TABLE IF NOT EXISTS analysis_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url      TEXT NOT NULL,
  property_input  JSONB,                    -- lat, lng, price_asking, area_sqm, municipio, etc. (manual form data)
  status          TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'processing' | 'complete' | 'error'
  tier            TEXT NOT NULL DEFAULT 'free',
  cache_id        UUID REFERENCES analysis_cache(id),
  error_message   TEXT,
  step            SMALLINT DEFAULT 0,       -- 0=queued 1=fetching 2=catastro 3=indicators 4=writing 5=complete
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  retry_count     SMALLINT DEFAULT 0
);

CREATE INDEX IF NOT EXISTS analysis_jobs_status_idx ON analysis_jobs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS analysis_jobs_url_idx    ON analysis_jobs (source_url);

-- RLS: jobs are readable only by the service role (analysis is server-side only)
ALTER TABLE analysis_jobs ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS automatically (no policy needed for service role access).
-- No public/anon access to job rows — polling is done via the status API route
-- which reads jobs server-side using the service role key.
