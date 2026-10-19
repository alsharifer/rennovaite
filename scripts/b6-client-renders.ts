// =============================================================================
// scripts/b6-client-renders.ts — the renders for the client's comments: ONE
// "Ask for a change" on the anchor view (it moves the anchor and its spec),
// then ONE render of every other positioned, unlocked view against the new
// anchor (run with PHOTO_VIEW_MAX_ATTEMPTS=1 — one paid render per view).
//
//   node --env-file=.env.local --experimental-transform-types --import ./scripts/_alias-hook.mjs \
//     scripts/b6-client-renders.ts [port] [project-id] [--skip-change | --change-only --request "…"]
// =============================================================================

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { devFetch } from "./lib/dev-auth.mjs";

const SCRIPT = "b6-client-renders";
const PORT = /^\d+$/.test(process.argv[2] ?? "") ? process.argv[2] : "3096";
const P = process.argv.find((a) => /^[0-9a-f-]{36}$/.test(a)) ?? "a2661f34-9d96-4020-a755-40359440c302";
const BASE = `http://localhost:${PORT}`;
const { url, key } = resolveTarget({ script: SCRIPT, writes: true });
const sb = createClient(url, key, { auth: { persistSession: false } });
const app = devFetch("b1-owner", { script: SCRIPT });
const json = { "content-type": "application/json" };

const flag = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
// One change per call: a single edit that asked for five lost the shower glass and kept the bidet (19 Oct).
const REQUEST = flag("--request") ??
  "Replace the bidet with a white floor-standing storage cabinet in the same spot. Move the shattaf hand spray from beside the door to the wall right next to the WC, between the WC and the new cabinet. Make the shower glass one fixed walk-in panel, the other side open. Make the vanity a ready-made wall-hung unit with two drawers and an integrated white ceramic basin top. No LED strip in the niche.";

const spendUsd = async () => (((await sb.from("render_spend").select("cost_usd").eq("project_id", P)).data ?? []) as { cost_usd: number | null }[]).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
const spent0 = await spendUsd();

const { data: plan } = await sb.from("plans").select("id").eq("project_id", P).order("created_at", { ascending: false }).limit(1).single<{ id: string }>();
const roomIds = (((await sb.from("rooms").select("id").eq("plan_id", plan!.id)).data ?? []) as { id: string }[]).map((r) => r.id);
const { data: anchors } = await sb.from("room_anchors").select("room_id, room_photo_id, render_id").in("room_id", roomIds);
const a = ((anchors ?? []) as { room_id: string; room_photo_id: string; render_id: string }[])[0];
const { data: own } = await sb.from("room_photos").select("id, room_id, locked_render_id, camera_position").in("room_id", roomIds).order("created_at");
const photos = ((own ?? []) as { id: string; room_id: string; locked_render_id: string | null; camera_position: unknown }[]).filter((p) => p.room_id === a?.room_id);
if (!a || photos.length === 0) throw new Error("no anchored room on this project");
const label = (id: string) => `P${photos.findIndex((p) => p.id === id) + 1}`;

if (!process.argv.includes("--skip-change")) {
  const res = await app(`${BASE}/api/render/photo-view/change`, { method: "POST", headers: json, body: JSON.stringify({ render_id: a.render_id, request: REQUEST }) });
  const body = (await res.json().catch(() => null)) as { kind?: string; message?: string; change?: { line: string; changed: string[] }; error?: string } | null;
  console.log(`  ${label(a.room_photo_id)} (anchor) change: ${res.status} ${body?.kind ?? ""} — ${body?.change?.line ?? body?.message ?? body?.error ?? ""}`);
  if (body?.kind !== "version") {
    console.log("  the anchor did not take the change — not rendering the other views against it.");
    process.exit(1);
  }
  if (process.argv.includes("--change-only")) process.exit(0);
}

const others = photos.filter((p) => p.id !== a.room_photo_id && !p.locked_render_id && p.camera_position);
const run = async (p: (typeof others)[number]) => {
  const res = await app(`${BASE}/api/render/photo-view`, { method: "POST", headers: json, body: JSON.stringify({ room_photo_id: p.id }) });
  const body = (await res.json().catch(() => null)) as { gate?: { outcome: string; line: string; style_line: string }; error?: string } | null;
  console.log(`  ${label(p.id)}: ${res.status} ${body?.gate ? `${body.gate.outcome} — ${body.gate.line} · ${body.gate.style_line}` : body?.error ?? ""}`);
};
for (let i = 0; i < others.length; i += 2) await Promise.all(others.slice(i, i + 2).map(run));
console.log(`  render spend this run: US$${(await spendUsd() - spent0).toFixed(2)}`);
