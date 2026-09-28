#!/usr/bin/env node
// =============================================================================
// scripts/pilot-events-check.mjs — live check of the L5 writers through the routes.
//
//   node scripts/pilot-events-check.mjs [port]     (dev server, `garden` launch config)
//
// On the isolation stand-in with a scratch firm:
//   - a support touch POSTed by a signed-in member carries actor + firm;
//   - a signed-in load of the BoQ page records ONE boq_viewed (a reload within
//     10 min does not);
//   - generate-boq records boq_generated with actor + duration (interior or
//     garden, no authored-plan guard);
//   - a firm entry + a promotion record rate_book_change events on the FIRM
//     (no project); a correction event carries firm + actor;
//   - GET /api/pilot-events?firm_id= is the firm rollup (401 anonymous) and
//     counts the above.
// Scratch state only, removed afterwards; refuses production.
// =============================================================================

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { devSession } from "./lib/dev-auth.mjs";

const PORT = process.argv[2] ?? "3098";
const BASE = `http://localhost:${PORT}`;
const STAND_IN = "12904f6d-87c1-4398-b245-b926f950bd97";
const { url, key } = resolveTarget({ script: "pilot-events-check", writes: true });
const sb = createClient(url, key);

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};
async function api(method, path, body, auth) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(auth?.headers ?? {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const userA = await devSession("a", { script: "pilot-events-check" });
// Pages read the COOKIE session (getCaller() with no request), not a Bearer header.
const cookieHeader = { cookie: userA.cookies.map((c) => `${c.name}=${c.value}`).join("; ") };
const t0 = new Date().toISOString();
const { data: prior } = await sb.from("projects").select("firm_id").eq("id", STAND_IN).single();
const created = { firm: null, corrections: [] };
const eventsSince = async (extra = {}) => {
  let q = sb.from("pilot_events").select("id, project_id, firm_id, kind, actor, duration_ms, stage, detail").gte("recorded_at", t0);
  for (const [k, v] of Object.entries(extra)) q = q.eq(k, v);
  return (await q).data ?? [];
};

try {
  console.log("\n1. scratch firm on the stand-in");
  const fa = await api("POST", "/api/firms", { name: "L5 check — firm (scratch)" }, userA);
  created.firm = fa.body.firm.id;
  const F = created.firm;
  check("firm created + assigned", fa.status === 201 && (await api("PATCH", `/api/projects/${STAND_IN}`, { firm_id: F }, userA)).status === 200);

  console.log("\n2. writers");
  const st = await api("POST", "/api/pilot-events", { kind: "support_touch", project_id: STAND_IN, channel: "chat", note: "L5 check — where is the paving rate from?" }, userA);
  const stRows = await eventsSince({ kind: "support_touch" });
  check("support_touch → row with actor + firm", st.status === 200 && stRows.length === 1 && stRows[0].actor === userA.userId && stRows[0].firm_id === F, JSON.stringify(stRows.map((r) => [r.actor?.slice(0, 8), r.firm_id?.slice(0, 8)])));
  const page1 = await fetch(`${BASE}/project/${STAND_IN}/boq`, { headers: cookieHeader });
  await page1.text();
  await (await fetch(`${BASE}/project/${STAND_IN}/boq`, { headers: cookieHeader })).text();
  const views = await eventsSince({ kind: "boq_viewed" });
  check("two signed-in BoQ page loads → ONE boq_viewed (10-min dedupe), with actor + firm", views.length === 1 && views[0].actor === userA.userId && views[0].firm_id === F, `${views.length}`);
  const gen = await api("POST", "/api/generate-boq", { project_id: STAND_IN }, userA);
  const gens = await eventsSince({ kind: "boq_generated" });
  check("generate-boq → boq_generated with actor, duration and scope", gen.status === 200 && gens.length === 1 && gens[0].actor === userA.userId && gens[0].duration_ms > 0 && typeof gens[0].detail?.scope === "string", `${gens[0]?.duration_ms} ms · ${gens[0]?.detail?.scope}`);
  const corr = await api("POST", "/api/boq-corrections", { project_id: STAND_IN, boq_id: gen.body.boq_id, item_key: "garden.pcc_base", line_description: "PCC base under paving", correction_type: "rate", field: "rate_aed", old_value: 105.6, new_value: 99, note: "L5 check", firm_id: F, session_ref: "L5 check session" }, userA);
  created.corrections.push(corr.body.correction?.id);
  const corrEv = await eventsSince({ kind: "correction" });
  check("correction → event with firm, actor, session_ref and item_key", corrEv.length === 1 && corrEv[0].firm_id === F && corrEv[0].actor === userA.userId && corrEv[0].detail?.item_key === "garden.pcc_base", JSON.stringify(corrEv.map((r) => r.detail?.item_key)));
  const ent = await api("POST", `/api/firms/${F}/rates`, { item_key: "garden.grass_supply", unit: "m2", rate_aed: 20, kind: "supply" }, userA);
  const pro = await api("POST", `/api/firms/${F}/promote`, { correction_id: corr.body.correction.id }, userA);
  const rb = await eventsSince({ kind: "rate_book_change" });
  check("entry + promotion → two rate_book_change events on the FIRM (no project), with actor", ent.status === 201 && pro.status === 201 && rb.length === 2 && rb.every((r) => r.project_id === null && r.firm_id === F && r.actor === userA.userId) && rb.map((r) => r.detail?.action).sort().join(",") === "entry,promote", `${rb.length}: ${rb.map((r) => r.detail?.action).join(",")}`);

  console.log("\n3. the firm rollup");
  const anon = await api("GET", `/api/pilot-events?firm_id=${F}`);
  check("GET ?firm_id anonymous → 401", anon.status === 401);
  const roll = await api("GET", `/api/pilot-events?firm_id=${F}`, undefined, userA);
  const p = roll.body.firm?.projects?.find((x) => x.project_id === STAND_IN);
  check("rollup names the stand-in under the firm with the counts above", roll.status === 200 && !!p && p.support.touches >= 1 && p.reviews.views >= 1 && p.corrections.total >= 1 && p.corrections.landed.book >= 1, p ? `support ${p.support.touches} · views ${p.reviews.views} · corrections ${p.corrections.total} (book ${p.corrections.landed.book})` : `${roll.status} ${roll.body.error ?? ""}`);
  check("rollup counts the firm's rate-book changes", roll.body.firm?.rate_book?.entries >= 1 && roll.body.firm?.rate_book?.promotions >= 1, JSON.stringify(roll.body.firm?.rate_book));
  check("corrections land by section (garden.pcc_base → Hardscape & Structures)", (p?.corrections?.by_section?.["Hardscape & Structures"] ?? 0) >= 1, JSON.stringify(p?.corrections?.by_section));
} finally {
  console.log("\ncleanup");
  await sb.from("projects").update({ firm_id: prior.firm_id ?? null }).eq("id", STAND_IN);
  await sb.from("pilot_events").delete().gte("recorded_at", t0).or(`project_id.eq.${STAND_IN},firm_id.eq.${created.firm ?? "00000000-0000-0000-0000-000000000000"}`);
  for (const id of created.corrections.filter(Boolean)) await sb.from("boq_corrections").delete().eq("id", id);
  if (created.firm) await sb.from("firms").delete().eq("id", created.firm);
  await sb.from("firms").delete().like("name", "L5 check%");
  const left = await eventsSince();
  check("scratch events, correction and firm removed; stand-in firm restored", left.filter((e) => e.project_id === STAND_IN || e.firm_id === created.firm).length === 0 && (await sb.from("projects").select("firm_id").eq("id", STAND_IN).single()).data.firm_id === (prior.firm_id ?? null));
}
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
