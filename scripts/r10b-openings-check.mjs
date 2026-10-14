// =============================================================================
// scripts/r10b-openings-check.mjs — R10b live: openings found on the drawing.
//
//   node scripts/r10b-openings-check.mjs [port] [--keep]
//
// On DEV, as the scratch account dev-scripts+r10b: uploads the canonical
// first-floor plan (assets/villa-plan-first-floor.pdf) through intake, reads
// it, and then, through the real routes:
//   1. detection runs once (auto) and a second auto run does nothing;
//   2. the found openings are 'detected', derived, unconfirmed;
//   3. an unconfirmed find changes NO BoQ quantity (dry runs before/after);
//   4. confirming them records "openings_confirmed" and moves the wall lines
//      on the next (dry-run) regenerate;
//   5. Re-detect replaces only what nobody confirmed;
//   6. a non-member cannot detect or confirm.
// The scratch project is deleted at the end unless --keep (for screenshots).
// One Claude call per detection run, one per parse; no image renders.
// =============================================================================

import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { devFetch } from "./lib/dev-auth.mjs";

const PORT = process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? "3098";
const KEEP = process.argv.includes("--keep");
const BASE = `http://localhost:${PORT}`;
const SCRIPT = "r10b-openings-check";

const { url, key } = resolveTarget({ script: SCRIPT, writes: true });
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const owner = devFetch("r10b", { script: SCRIPT });
const intruder = devFetch("r10b-x", { script: SCRIPT });

let failures = 0;
const check = (ok, what, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const json = async (r) => r.json().catch(() => null);
const post = (f, path, body) => f(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** A dry-run BoQ: its total and every line's quantity by description. */
async function dryRun(projectId) {
  const r = await post(owner, "/api/generate-boq", { project_id: projectId, dry_run: true });
  const b = await json(r);
  if (!r.ok || !b?.boq) throw new Error(`dry run failed: ${r.status} ${JSON.stringify(b).slice(0, 200)}`);
  const lines = b.boq.sections.flatMap((s) => s.line_items ?? s.lines ?? []);
  const qty = new Map();
  for (const l of lines) qty.set(l.description, Math.round(((qty.get(l.description) ?? 0) + Number(l.quantity ?? 0)) * 100) / 100);
  return { qty, total: b.grand_total_aed };
}
const moved = (a, b) => [...new Set([...a.qty.keys(), ...b.qty.keys()])].filter((k) => a.qty.get(k) !== b.qty.get(k)).map((k) => `${k}: ${a.qty.get(k) ?? "—"} → ${b.qty.get(k) ?? "—"}`);

let projectId = null;
try {
  // --- intake: the canonical plan, read --------------------------------------------
  const pdf = readFileSync("assets/villa-plan-first-floor.pdf");
  const s = await json(await post(owner, "/api/uploads/sign", { kind: "plan", size: pdf.byteLength, type: "application/pdf", filename: "villa-plan-first-floor.pdf" }));
  const put = await fetch(s.signedUrl, { method: "PUT", headers: { "content-type": s.contentType, "x-upsert": "false" }, body: pdf });
  check(put.ok, "upload the canonical first-floor plan", String(put.status));
  const c = await json(await post(owner, "/api/uploads/complete", { path: s.path, filename: "villa-plan-first-floor.pdf", name: "R10b openings check (scratch)" }));
  projectId = c?.project_id ?? null;
  const planId = c?.plan_id;
  check(!!projectId && !!planId, "a scratch project + plan", `${projectId}`);
  const parse = await json(await post(owner, "/api/parse-plan", { plan_id: planId }));
  check(parse?.success === true && parse.rooms > 0, "the plan is read", `${parse?.rooms} rooms`);

  // --- 6 (first, before anything exists): a non-member is refused --------------------
  const deny = await post(intruder, "/api/plan-openings/detect", { plan_id: planId, mode: "auto" });
  check(deny.status === 403, "a non-member cannot start detection", String(deny.status));

  const before = await dryRun(projectId);

  // --- 1. once, automatically ----------------------------------------------------------
  const t0 = Date.now();
  const first = await json(await post(owner, "/api/plan-openings/detect", { plan_id: planId, mode: "auto" }));
  check(first?.status === "done" && first.found > 0, "auto detection runs and finds openings", `${JSON.stringify(first)} in ${Math.round((Date.now() - t0) / 1000)} s`);
  const again = await json(await post(owner, "/api/plan-openings/detect", { plan_id: planId, mode: "auto" }));
  check(again?.status === "already", "a second auto run does nothing", again?.status);
  const st = await json(await owner(`${BASE}/api/plan-openings/detect?plan_id=${planId}`));
  check(st?.run?.status === "done" && !!st.detected_at, "the plan records the run", JSON.stringify(st?.run));

  // --- 2. derived, unconfirmed -----------------------------------------------------------
  const list1 = (await json(await owner(`${BASE}/api/plan-openings?plan_id=${planId}`)))?.openings ?? [];
  check(list1.length === first.found && list1.every((o) => o.source === "detected" && o.derived === true && !o.confirmed_at && o.detection?.model), "every find is detected · derived · unconfirmed, with what the detector said", `${list1.length} rows`);
  const kinds = list1.reduce((m, o) => ({ ...m, [o.kind]: (m[o.kind] ?? 0) + 1 }), {});
  console.log("      found:", JSON.stringify(kinds));

  // --- 3. no BoQ effect until confirmed ---------------------------------------------------
  const unconfirmed = await dryRun(projectId);
  check(moved(before, unconfirmed).length === 0 && unconfirmed.total === before.total, "unconfirmed finds move no BoQ quantity", `total ${before.total} → ${unconfirmed.total}`);

  // --- 4. confirm: one now, then the rest ---------------------------------------------------
  const one = await json(await post(owner, "/api/plan-openings/confirm", { plan_id: planId, ids: [list1[0].id] }));
  check(one?.confirmed?.length === 1, "confirm one", JSON.stringify(one));
  const denyConfirm = await post(intruder, "/api/plan-openings/confirm", { plan_id: planId, all: true });
  check(denyConfirm.status === 403, "a non-member cannot confirm", String(denyConfirm.status));
  const all = await json(await post(owner, "/api/plan-openings/confirm", { plan_id: planId, all: true }));
  check(all?.confirmed?.length === list1.length - 1, "Confirm all confirms the rest", `${all?.confirmed?.length}`);
  const list2 = (await json(await owner(`${BASE}/api/plan-openings?plan_id=${planId}`)))?.openings ?? [];
  check(list2.every((o) => o.confirmed_at && o.derived === false), "confirmed = measured (derived cleared)");
  const { data: ev } = await admin.from("pilot_events").select("detail").eq("project_id", projectId).eq("kind", "design_edit");
  const confirmedEvents = (ev ?? []).filter((e) => e.detail?.layer === "openings_confirmed");
  check(confirmedEvents.reduce((s, e) => s + (e.detail.count ?? 0), 0) === list1.length, "each confirmation is recorded (cause: Openings confirmed)", `${confirmedEvents.length} events`);
  const confirmed = await dryRun(projectId);
  const lineMoves = moved(before, confirmed);
  check(lineMoves.length > 0 && confirmed.total < before.total, "confirmed openings take effect on the next regenerate — the wall lines are net of them", `total ${before.total} → ${confirmed.total}`);
  for (const m of lineMoves) console.log("      " + m);

  // --- 5. Re-detect keeps what was confirmed -----------------------------------------------
  // Un-confirm three rows by hand (as if never confirmed) so a re-detect has something to replace.
  const stale = list2.slice(-3).map((o) => o.id);
  await admin.from("plan_openings").update({ confirmed_at: null, confirmed_by: null, derived: true }).in("id", stale);
  const re = await json(await post(owner, "/api/plan-openings/detect", { plan_id: planId, mode: "redetect" }));
  const list3 = (await json(await owner(`${BASE}/api/plan-openings?plan_id=${planId}`)))?.openings ?? [];
  const keptConfirmed = list2.filter((o) => !stale.includes(o.id)).every((o) => list3.some((n) => n.id === o.id && n.confirmed_at));
  check(re?.status === "done" && keptConfirmed && stale.every((id) => !list3.some((n) => n.id === id)), "Re-detect replaces only the unconfirmed finds", `${JSON.stringify(re)}; ${list3.length} rows now`);

  console.log(`\nscratch project: ${projectId}  plan: ${planId}`);
} catch (e) {
  failures++;
  console.error("ERROR", e);
} finally {
  if (projectId && !KEEP) {
    await admin.from("projects").delete().eq("id", projectId);
    console.log("scratch project deleted");
  }
}
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
