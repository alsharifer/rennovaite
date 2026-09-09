-- =============================================================================
-- 012: Async render predictions + QA verdict (Phase 3)
-- =============================================================================
-- Renders now run as async Replicate predictions: the render route inserts a
-- PENDING row + prediction id and returns immediately; the client polls
-- /api/render/status, which finalises the row when the prediction completes.
--
--   prediction_id — the Replicate prediction the row is waiting on
--   status        — 'pending' | 'succeeded' | 'failed'. Defaults to
--                   'succeeded' so every pre-existing (synchronous) render row
--                   and the cache lookup keep working unchanged.
--   qa            — the Claude vision QA verdict for the finished render
--                   ({structure_preserved, artifacts, photorealistic, reason,
--                   passed}); null for tweaks and un-QA'd rows.
-- =============================================================================

alter table public.renders
  add column if not exists prediction_id text;

alter table public.renders
  add column if not exists status text not null default 'succeeded';

alter table public.renders
  add column if not exists qa jsonb;

-- In-flight cap + status polling both filter on these.
create index if not exists renders_status_idx on public.renders(project_id, status);
create index if not exists renders_prediction_id_idx on public.renders(prediction_id);

-- Tell PostgREST to pick up the new columns without a project restart.
notify pgrst, 'reload schema';
