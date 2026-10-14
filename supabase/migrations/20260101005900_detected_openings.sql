-- 059_detected_openings.sql — windows, doors and openings found on the drawing (R10b, spec §7.5).
--
-- 1 of 10 production plans had any opening recorded (5, all drawn by hand); the
-- parser extracts none. A plan-faithful render needs them ("kitchen opening on
-- the left wall, floor-to-ceiling windows on the right"), so R10b finds them on
-- the drawing and asks the owner to confirm.
--
--   plan_openings.source        + 'detected' — found on the drawing by the
--                               detector (lib/plan/openings-detect.ts)
--   plan_openings.confirmed_at  when the owner confirmed (or adjusted) it;
--               confirmed_by    null = not confirmed. An UNCONFIRMED detected
--                               opening is DERIVED and labelled: it feeds the
--                               renders at once but never the BoQ —
--                               derivePlanGraph leaves it out of every pricing
--                               and document path until it is confirmed;
--                               confirmed ones take effect on the next
--                               regenerate (cause "Openings confirmed").
--   plan_openings.detection     what the detector said (label, confidence, the
--                               room it opens to, model, run time)
--   plans.openings_detected_at  set when detection is CLAIMED for the plan — it
--   plans.openings_detection    runs once automatically (after the plan is
--                               read, or lazily the first time Plan / Renders is
--                               opened); "Re-detect" runs it again on demand.
--
-- Additive: no existing row changes meaning.

alter table public.plan_openings
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmed_by uuid,
  add column if not exists detection jsonb;

alter table public.plan_openings drop constraint if exists plan_openings_source_chk;
alter table public.plan_openings add constraint plan_openings_source_chk
  check (source in ('parsed', 'user_drawn', 'detected'));

alter table public.plans
  add column if not exists openings_detected_at timestamptz,
  add column if not exists openings_detection jsonb;

notify pgrst, 'reload schema';
