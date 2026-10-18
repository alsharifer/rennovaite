-- 063_photo_view_check_spend.sql — the photo view's placement check, the style
-- the client's references describe, and render spend per project (bathroom
-- pilot B2).
--
--   room_photos.before_detection   where each fixture, door and window sits in
--                                  the client's photo (boxes in % of the frame)
--                                  — read once per photo and kept: every restyle
--                                  of that photo is checked against it
--   project_briefs.reference_style { text, elements[], item_ids[], model, at } —
--                                  the look the client's reference photos share,
--                                  written by a vision model from the References
--                                  (02 Design). Style words only: never layout,
--                                  never quantities.
--   render_spend                   one row per paid model call a render makes
--                                  (image model, and the vision check), with the
--                                  model, the output size and the cost — the
--                                  cost guard's ledger (render_spend_aed per
--                                  project = Σ cost_aed).
--
-- Additive. Nothing before B2 reads or writes these.

alter table public.room_photos add column if not exists before_detection jsonb null;

alter table public.project_briefs add column if not exists reference_style jsonb null;

create table if not exists public.render_spend (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  render_id      uuid null references public.renders(id) on delete set null,
  room_photo_id  uuid null references public.room_photos(id) on delete set null,
  -- photo_view | photo_check | reference_style | eval
  purpose        text not null,
  model          text not null,
  -- "946x2048" for an image; null for a text reply
  size           text null,
  units          integer not null default 1,
  cost_usd       numeric(12, 5) null,
  cost_aed       numeric(12, 4) null,
  detail         jsonb null,
  created_at     timestamptz not null default now()
);

create index if not exists render_spend_project_idx on public.render_spend (project_id, created_at);

alter table public.render_spend disable row level security;

notify pgrst, 'reload schema';
