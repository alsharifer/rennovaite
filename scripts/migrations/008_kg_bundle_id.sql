-- =============================================================================
-- 008: KG bundle id — links a render / BoQ to the Knowledge Graph retrieval
-- =============================================================================
-- When KG grounding is active (KG_ENABLED=true and Neo4j reachable), the render
-- and BoQ routes append a retrieved ContextBundle to the model prompt. We record
-- that bundle's id on the resulting row so the feedback loop (accept / reject /
-- swap) can later reweight the KG edges that were traversed.
--
-- Nullable on purpose: when KG grounding is off or unavailable the column stays
-- NULL and behaviour is identical to before this migration.
-- =============================================================================

alter table public.renders add column if not exists kg_bundle_id text;
alter table public.boqs    add column if not exists kg_bundle_id text;

-- Tell PostgREST to pick up the new columns without a project restart.
notify pgrst, 'reload schema';
