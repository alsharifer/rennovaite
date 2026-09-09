-- =============================================================================
-- 009: feedback_events — the KG feedback-loop substrate
-- =============================================================================
-- Records every user signal (accept / reject / iterate / swap / edit) against
-- the KG bundle that produced the thing. A later KG-module job reads these to
-- reweight edges (Ontology Spec §9). This migration is CAPTURE ONLY — no
-- reweighting logic.
--
-- entity_type : render | boq_line | vendor | style | plan
-- action      : accepted | rejected | iterated | swapped | edited
-- kg_bundle_id: the bundle that produced the entity (from renders.kg_bundle_id
--               / boqs.kg_bundle_id); null when the entity had no grounding.
-- payload     : before/after detail (tweak text, {from,to,delta_aed}, etc.)
-- =============================================================================

create table if not exists public.feedback_events (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid references public.projects(id) on delete cascade,
  user_id      uuid,
  entity_type  text not null,
  entity_id    text not null,
  action       text not null,
  kg_bundle_id text,
  payload      jsonb        default '{}'::jsonb,
  created_at   timestamptz  default now()
);

create index if not exists feedback_events_kg_bundle_id_idx on public.feedback_events(kg_bundle_id);
create index if not exists feedback_events_project_id_idx   on public.feedback_events(project_id);

alter table public.feedback_events disable row level security;

-- Tell PostgREST to pick up the new table without a project restart.
notify pgrst, 'reload schema';
