// =============================================================================
// scripts/b10-masked-change-check.mjs — live: "Ask for a change" through the
// real route, after masked edits became its path for one-item requests (20 Oct).
//
//   node --env-file=.env.local scripts/b10-masked-change-check.mjs [port] [render-id] [--cap=2]
//
// HARD CAP (default US$2): before each request the script adds the project's
// render_spend since it started to the request's worst case (a masked try + the
// fallback edit, with their readings) and refuses to send it past the cap.
//
// Default render: Photo 3's B2-era version on the dev test bathroom — made
// before the room had an anchor, so no version made from it can enter the
// client pack (its anchor does not match).
// =============================================================================

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { devFetch } from "./lib/dev-auth.mjs";

const SCRIPT = "b10-masked-change-check";
const PORT = /^\d+$/.test(process.argv[2] ?? "") ? process.argv[2] : "3096";
const P = "a2661f34-9d96-4020-a755-40359440c302";
const RENDER = process.argv.find((a) => /^[0-9a-f-]{36}$/.test(a)) ?? null;
const CAP = Number(process.argv.find((a) => a.startsWith("--cap="))?.split("=")[1] ?? 2);
/** A masked try (fill 0.05 + reading 0.30 + describe 0.08) and the fallback edit (pro 0.15 + reading 0.30 + describe 0.08). */
const WORST_PER_REQUEST = 0.05 + 0.3 + 0.08 + 0.15 + 0.3 + 0.08;
const REQUESTS = ["Change the vanity counter to a white ceramic top with an integrated basin"];

const { url, key } = resolveTarget({ script: SCRIPT, writes: true });
const db = createClient(url, key, { auth: { persistSession: false } });
const app = devFetch("b1-owner", { script: SCRIPT });
const started = new Date().toISOString();
const spent = async () => ((await db.from("render_spend").select("cost_usd").eq("project_id", P).gte("created_at", started)).data ?? []).reduce((t, r) => t + Number(r.cost_usd ?? 0), 0);

let renderId = RENDER;
if (!renderId) {
  const { data } = await db.from("renders").select("id").eq("project_id", P).eq("mode", "photo_view");
  renderId = (data ?? []).find((r) => r.id.startsWith("c1e7b0ef"))?.id;
}
if (!renderId) throw new Error("no render to change");
let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

for (const request of REQUESTS) {
  const s = await spent();
  if (s + WORST_PER_REQUEST > CAP) {
    console.log(`STOPPED AT THE CAP: US$${s.toFixed(2)} spent + US$${WORST_PER_REQUEST.toFixed(2)} worst case > US$${CAP.toFixed(2)} — "${request}" not sent`);
    break;
  }
  const res = await app(`http://localhost:${PORT}/api/render/photo-view/change`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ render_id: renderId, request }) });
  const body = await res.json().catch(() => ({}));
  const { data: row } = await db.from("renders").select("id, status, model, gate").eq("id", body.render_id ?? "00000000-0000-0000-0000-000000000000").maybeSingle();
  const change = row?.gate?.change ?? null;
  const masked = change?.masked ?? row?.gate?.masked ?? null;
  console.log(`"${request}" → ${res.status} ${body.kind ?? body.code ?? ""} · model ${row?.model ?? "—"} · path ${change?.path ?? "—"} · masked ${masked ? `${masked.item} [${masked.box.map((v) => Math.round(v)).join(",")}] kept=${masked.kept}${masked.why ? ` (${masked.why})` : ""}` : "—"}`);
  check("the request named one item, so a masked edit was tried first", !!masked && masked.item === "vanity", masked ? masked.item : "no masked try recorded");
  if (body.kind === "version") {
    check("a kept version says which path made it", change?.path === "masked" || change?.path === "edit", change?.path);
    check("a masked version was made by the inpainting model", change?.path !== "masked" || row.model === "black-forest-labs/flux-fill-pro", row?.model);
    check("a fallback version records why the masked try was not kept", change?.path !== "edit" || (masked && !masked.kept && !!masked.why), masked?.why ?? "");
  }
}
console.log(`spent this run: US$${(await spent()).toFixed(2)} of the US$${CAP.toFixed(2)} cap`);
console.log(failures ? `\nMASKED CHANGE: ${failures} CHECK(S) FAILED` : "\nMASKED CHANGE: ALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
