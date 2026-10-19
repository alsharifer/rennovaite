// =============================================================================
// scripts/b6-client-comments.ts — the client's comments on the bathroom pack
// (19 Oct), applied to a room-intake bathroom through the app's own routes:
//
//   1. a white storage cabinet where the bidet was (the bidet leaves the plan;
//      the cabinet's spec says it REPLACES the bidet, so renders swap it in place
//      and the layout check reads the bidet's spot);
//   2. the shattaf beside the WC on its right when seated (a shattaf point on
//      the WC's wall, on the side it faces's right hand);
//   3. the value-engineered choices the client picked (rooms.spec.wet_room):
//      fixed glass panel + manual mixer · ready-made vanity + mid-range fittings
//      · bagged waste + a plain niche — and the existing fixtures the strip-out
//      names (the bidet is still on site);
//
// then regenerates the BoQ. Idempotent: a second run changes nothing.
//
//   node --env-file=.env.local --experimental-transform-types --import ./scripts/_alias-hook.mjs \
//     scripts/b6-client-comments.ts [port] [project-id]
// =============================================================================

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { devFetch } from "./lib/dev-auth.mjs";

import { footprintOf } from "../lib/overlays/footprint.ts";
import { recordPilotEvent } from "../lib/pilot/events.ts";

const SCRIPT = "b6-client-comments";
const PORT = /^\d+$/.test(process.argv[2] ?? "") ? process.argv[2] : "3096";
const P = process.argv.find((a) => /^[0-9a-f-]{36}$/.test(a)) ?? "a2661f34-9d96-4020-a755-40359440c302";
const BASE = `http://localhost:${PORT}`;
const { url, key } = resolveTarget({ script: SCRIPT, writes: true });
const sb = createClient(url, key, { auth: { persistSession: false } });
const app = devFetch("b1-owner", { script: SCRIPT });
const json = { "content-type": "application/json" };

const CHOICES = { shower_screen: "fixed_panel", shower_valve: "manual", vanity: "ready_made", fittings: "mid", waste: "bagged", niche_led: false, existing_fixtures: "1 WC, 1 bidet, 1 basin + vanity, shower set" };

type Fx = { id: string; type: string; room_id: string | null; position: [number, number]; spec: Record<string, unknown> | null };
const { data: plan } = await sb.from("plans").select("id, plot_width_m").eq("project_id", P).order("created_at", { ascending: false }).limit(1).single<{ id: string; plot_width_m: number }>();
const mPerU = plan!.plot_width_m;
const fixtures = async () => ((await sb.from("plan_fixtures").select("id, type, room_id, position, spec").eq("project_id", P)).data ?? []) as Fx[];
let fx = await fixtures();
const wc = fx.find((f) => f.type === "wc_point");
if (!wc) throw new Error("no WC on the plan");

// 1. The cabinet where the bidet stands.
const bidet = fx.find((f) => f.type === "bidet_point");
if (!fx.some((f) => f.type === "storage_cabinet")) {
  if (!bidet) throw new Error("no bidet and no cabinet — nothing to replace");
  const bfp = footprintOf("bidet_point", bidet.spec)!;
  const res = await app(`${BASE}/api/plan-fixtures`, { method: "POST", headers: json, body: JSON.stringify({ project_id: P, type: "storage_cabinet", room_id: bidet.room_id, position: bidet.position, spec: { width_mm: 400, depth_mm: 450, rotation_deg: bfp.rotation_deg, wall_gap_mm: 0, footprint: "default", replaces: "bidet_point", note: "white, floor-standing, where the bidet was (client, 19 Oct)" } }) });
  console.log(`  cabinet: ${res.status}`);
  if (!res.ok) throw new Error(await res.text());
}
fx = await fixtures();
if (bidet && fx.some((f) => f.id === bidet.id)) {
  const res = await app(`${BASE}/api/plan-fixtures?id=${bidet.id}`, { method: "DELETE" });
  console.log(`  bidet removed: ${res.status}`);
}

// 2. The shattaf beside the WC, on its right when seated: the WC faces
// `rotation_deg` (compass, 0 = plan up, clockwise); seated, the right hand is
// that heading + 90°. On the WC's own wall, just past its side.
if (!fx.some((f) => f.type === "shattaf_point")) {
  const wfp = footprintOf("wc_point", wc.spec)!;
  const h = ((wfp.rotation_deg + 90) * Math.PI) / 180;
  const dir: [number, number] = [Math.sin(h), -Math.cos(h)];
  const facing = (wfp.rotation_deg * Math.PI) / 180;
  const back: [number, number] = [-Math.sin(facing), Math.cos(facing)];
  const along = (wfp.width_mm / 2000 + 0.2) / mPerU; // 200 mm past the WC's side
  const toWall = (wfp.depth_mm / 2000 + wfp.wall_gap_mm / 1000 - 0.02) / mPerU; // on the wall face
  const pos: [number, number] = [wc.position[0] + dir[0] * along + back[0] * toWall, wc.position[1] + dir[1] * along + back[1] * toWall];
  const res = await app(`${BASE}/api/plan-fixtures`, { method: "POST", headers: json, body: JSON.stringify({ project_id: P, type: "shattaf_point", room_id: wc.room_id, position: pos, spec: { note: "beside the WC, on its right when seated (client, 19 Oct)" } }) });
  console.log(`  shattaf: ${res.status} at ${(pos[0] * mPerU).toFixed(2)}, ${(pos[1] * mPerU).toFixed(2)} m`);
  if (!res.ok) throw new Error(await res.text());
}

// 3. The room's choices (no route edits a room's spec yet — the operator act,
// recorded as a design edit so the revision diff names it).
const { data: room } = await sb.from("rooms").select("id, spec").eq("id", wc.room_id!).single<{ id: string; spec: Record<string, unknown> | null }>();
const was = (room!.spec?.wet_room ?? null) as Record<string, unknown> | null;
if (JSON.stringify(was) !== JSON.stringify(CHOICES)) {
  await sb.from("rooms").update({ spec: { ...(room!.spec ?? {}), wet_room: CHOICES } }).eq("id", room!.id);
  await recordPilotEvent(sb as never, P, "design_edit", { layer: "wet_room_spec", room_id: room!.id, from: was, to: CHOICES, source: "client comments, 19 Oct" }, { stage: "design_session" });
  console.log("  room choices set");
}

// Regenerate.
const res = await app(`${BASE}/api/generate-boq`, { method: "POST", headers: json, body: JSON.stringify({ project_id: P }) });
const body = (await res.json().catch(() => null)) as { boq_id?: string; total_aed?: number; previous_total_aed?: number; error?: string } | null;
console.log(`  BoQ: ${res.status} ${body?.previous_total_aed ?? "?"} → ${body?.total_aed ?? body?.error}`);
const { data: boq } = await sb.from("boqs").select("sections").eq("project_id", P).order("created_at", { ascending: false }).limit(1).single<{ sections: { subtotal_aed: number; contingency_aed: number; vat_aed: number; grand_total_aed: number; sections: { work_section: string; section_total_aed: number; lines: { rule_id?: string; description: string; quantity: number; rate_aed: number; total_aed: number }[] }[] } }>();
const s = boq!.sections;
for (const sec of s.sections) for (const l of sec.lines) if (/^(W-2[5-9]|W-30|W-13|W-15|W-18|W-06|P2\/overlay\/shattaf)/.test(l.rule_id ?? "")) console.log(`    ${(l.rule_id ?? "").padEnd(26)} ${String(l.quantity).padStart(4)} × ${String(l.rate_aed).padStart(7)} = ${String(l.total_aed).padStart(8)}  ${l.description.slice(0, 80)}`);
console.log(`  subtotal ${s.subtotal_aed} · contingency ${s.contingency_aed} · VAT ${s.vat_aed} · total ${s.grand_total_aed}`);
