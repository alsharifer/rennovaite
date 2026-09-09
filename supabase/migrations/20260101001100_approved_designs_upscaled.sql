-- =============================================================================
-- 011: Upscaled export URL for approved designs (Phase 3)
-- =============================================================================
-- On design approval we run the locked render through a 2× upscaler
-- (philz1337x/clarity-upscaler) and store the sharper export here, so the
-- download/handover surface serves a print-quality image instead of the
-- model's native ~1MP output. Nullable + back-compat: approvals still work if
-- the upscale fails or the column isn't populated yet.
-- =============================================================================

alter table public.approved_designs
  add column if not exists upscaled_url text;

-- Tell PostgREST to pick up the new column without a project restart.
notify pgrst, 'reload schema';
