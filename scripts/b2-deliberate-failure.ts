// =============================================================================
// scripts/b2-deliberate-failure.ts — bathroom pilot B2: one photo view made to
// fail on purpose, to show the failure is honest.
//
//   node --env-file=.env.local --experimental-transform-types --import ./scripts/_alias-hook.mjs \
//     scripts/b2-deliberate-failure.ts [photo-number=2]
//
// The real photo-view pipeline (lib/render/photo-view-run.ts) on the dev test
// project a2661f34, with ONE thing changed: both attempts are told to move the
// vanity onto the shower wall. The placement check must catch it on the first
// attempt AND the retry, and the stored view must read "The render moved the
// vanity — see what differs." — never a pass. Spend is recorded like any render.
// =============================================================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";

import { runPhotoView } from "@/lib/render/photo-view-run";
import { photoViewsOf, type RoomPhotoRow } from "@/lib/render/photo-views";

const P = "a2661f34-9d96-4020-a755-40359440c302";
const N = Number(process.argv[2] ?? 2);
const { url, key } = resolveTarget({ script: "b2-deliberate-failure", writes: true });
const db = createClient(url, key, { auth: { persistSession: false } }) as unknown as SupabaseClient;
const { data: plan } = await db.from("plans").select("id").eq("project_id", P).single();
const { data: room } = await db.from("rooms").select("id").eq("plan_id", plan!.id).single();
const { data: rows } = await db.from("room_photos").select("id, room_id, public_url, storage_path, created_at, camera_position, camera_heading_deg").eq("room_id", room!.id);
const view = photoViewsOf((rows ?? []) as RoomPhotoRow[], room!.id)[N - 1]!;

const MOVE = "Renovate the bathroom in this photo, and MOVE the vanity with its basin off its wall: put it against the far left wall, right beside the shower glass, and fill the place where it stood with plain tiled wall. Warm beige large-format tile, floating oak vanity, brushed brass taps. Photorealistic.";
const out = await runPhotoView(db, { projectId: P, roomPhotoId: view.id, actor: null, promptOverride: () => MOVE });
console.log(JSON.stringify({ photo: view.label, render_id: out.render_id, outcome: out.gate.outcome, line: out.gate.line, attempts: out.gate.attempts.map((a) => ({ attempt: a.attempt, passed: a.passed, failures: a.failures.map((f) => f.message), ssim: a.ssim })), cost_usd: out.gate.cost_usd }, null, 2));
if (out.gate.outcome === "passed") {
  console.error("FAIL — the deliberate move passed the check");
  process.exit(1);
}
console.log(/moved the vanity|removed the vanity/.test(out.gate.line) ? "ok — the check names the vanity" : "note — the check failed it, on something other than the vanity first");
