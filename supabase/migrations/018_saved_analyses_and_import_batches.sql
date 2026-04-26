-- Migration 018 — saved_analyses + import_batches
-- The Property Library: lets authenticated users save an analysis result,
-- refresh it, annotate it, and bulk-import via Idealista shared lists.
--
-- Design notes:
--  • analysis_json stores a full snapshot of the result at save/refresh time,
--    so the library row remains viewable even if analysis_cache is evicted
--    or its schema evolves. tvi_score is also extracted into its own column
--    for cheap ORDER BY / filter.
--  • source_url is the canonical property identity (matches analysis_cache
--    semantics — Idealista URL or "pin:lat,lng"). UNIQUE per user so the
--    same person can't double-save the same listing, but two users can.
--  • source enum tracks provenance (manual vs idealista_import) so the
--    library UI can badge imported rows and so import batches can be
--    attributed.
--  • import_batch_id is nullable — only set for rows created via an
--    Idealista bulk import so we can jump from a batch to its rows.

-- ─── saved_analyses ──────────────────────────────────────────────────────────

CREATE TABLE saved_analyses (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,

  -- Canonical property identity (Idealista URL or pin:lat,lng).
  source_url          TEXT        NOT NULL,

  -- Soft link to analysis_cache. Nullable because the cache row may be
  -- evicted in the future — the snapshot in analysis_json keeps the
  -- library usable regardless.
  analysis_cache_id   UUID        REFERENCES analysis_cache(id) ON DELETE SET NULL,

  -- Full snapshot of the analysis result at save/refresh time.
  -- Shape matches what GET /api/analyse/status returns when complete.
  analysis_json       JSONB       NOT NULL,

  -- Extracted for cheap sort/filter without touching JSONB.
  tvi_score           DECIMAL(5,2),

  -- Provenance. 'manual' = user pressed Save on an analysis page.
  -- 'idealista_import' = created by an import_batches job.
  source              TEXT        NOT NULL DEFAULT 'manual'
                         CHECK (source IN ('manual','idealista_import')),

  -- Optional free-text note on the saved property.
  notes               TEXT,

  -- When the underlying analysis was produced. Drives "age of analysis"
  -- display and the refresh flow (updated on refresh).
  analysed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Audit.
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Link back to the batch that created this row (null for manual saves).
  import_batch_id     UUID,

  UNIQUE (user_id, source_url)
);

CREATE INDEX saved_analyses_user_created_idx
  ON saved_analyses (user_id, created_at DESC);
CREATE INDEX saved_analyses_user_tvi_idx
  ON saved_analyses (user_id, tvi_score DESC NULLS LAST);
CREATE INDEX saved_analyses_batch_idx
  ON saved_analyses (import_batch_id)
  WHERE import_batch_id IS NOT NULL;

ALTER TABLE saved_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "saved_analyses_owner" ON saved_analyses
  USING      (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ─── import_batches ──────────────────────────────────────────────────────────

CREATE TABLE import_batches (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,

  -- Where the batch came from. Open-ended to allow 'fotocasa' etc later.
  source          TEXT        NOT NULL DEFAULT 'idealista',

  -- The list/favourites URL the user pasted.
  source_url      TEXT        NOT NULL,

  -- Lifecycle:
  --   pending   — row created, extraction not yet started
  --   running   — extraction/analysis in flight
  --   complete  — all properties succeeded
  --   partial   — finished with at least one failure but at least one success
  --   error     — fatal failure (e.g. couldn't parse the list at all)
  status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','running','complete','partial','error')),

  -- Progress counters for the UI.
  total_count     INTEGER     NOT NULL DEFAULT 0,
  success_count   INTEGER     NOT NULL DEFAULT 0,
  failure_count   INTEGER     NOT NULL DEFAULT 0,

  -- Per-property status for live progress rendering:
  -- [{ url, status: 'pending'|'running'|'success'|'error',
  --    saved_analysis_id?, error?, title?, price?, address? }, ...]
  items           JSONB       NOT NULL DEFAULT '[]'::jsonb,

  -- Aggregate errors (fatal-level; per-item errors live in `items`).
  errors          JSONB       NOT NULL DEFAULT '[]'::jsonb,

  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX import_batches_user_created_idx
  ON import_batches (user_id, created_at DESC);

ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "import_batches_owner" ON import_batches
  USING      (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- FK added after both tables exist (chicken-and-egg on declaration order).
ALTER TABLE saved_analyses
  ADD CONSTRAINT saved_analyses_import_batch_fk
  FOREIGN KEY (import_batch_id) REFERENCES import_batches(id) ON DELETE SET NULL;

-- ─── updated_at triggers ─────────────────────────────────────────────────────
-- Reuse the standard update_updated_at() helper from 001_initial_schema.

CREATE TRIGGER saved_analyses_updated_at
  BEFORE UPDATE ON saved_analyses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER import_batches_updated_at
  BEFORE UPDATE ON import_batches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
