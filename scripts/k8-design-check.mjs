// =============================================================================
// scripts/k8-design-check.mjs — 02 Design, driven like an owner (K8 #3–4).
// DEV ONLY; a scratch project, removed at the end.
//
//   node --env-file=.env.local scripts/k8-design-check.mjs [port]
//
// Direction: answer the six questions one at a time → a suggested direction
// with its match sentence and the derived-marked cost delta; "Choose" another
// → YOUR PICK, and the pick survives a reload (override never touched by
// answers). References: pin three from the library (check icon, not colour),
// the board persists, Alt + → reorders and persists, the rail's 02 Design
// leaves Attention at 3 pinned; unpin from the library.
// =============================================================================

import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { openBrowser } from "./lib/cdp.mjs";

const port = process.argv.find((a) => /^\d+$/.test(a)) ?? "3098";
const base = `http://localhost:${port}`;
const NAME = "K8 design (scratch)";
const { url, key } = resolveTarget({ script: "k8-design-check", writes: true });
const sb = createClient(url, key);

let failures = 0;
const check = (l, ok, d = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok " : "  FAIL"}  ${l}${d ? `  — ${d}` : ""}`);
};

async function teardown() {
  const { data } = await sb.from("projects").select("id").eq("name", NAME);
  for (const p of data ?? []) {
    for (const t of ["moodboard_items", "project_briefs", "style_choices", "project_members", "pilot_events"]) await sb.from(t).delete().eq("project_id", p.id);
    await sb.from("projects").delete().eq("id", p.id);
  }
}

await teardown();
const projectId = randomUUID();
const ins = await sb.from("projects").insert({ id: projectId, name: NAME, city: "Dubai", currency: "AED", status: "draft" });
if (ins.error) throw new Error(ins.error.message);

const b = await openBrowser({ script: "k8-design-check", projects: [projectId] });
const P = `${base}/project/${projectId}/design`;
try {
  console.log("1. Direction");
  await b.goto(P, "[data-design]");
  const current = `document.querySelector("[data-question]")?.getAttribute("data-question") ?? null`;
  for (let i = 0; i < 12; i++) {
    const q = await b.evaluate(current);
    if (!q) break;
    // Wait for the previous save to finish (options are disabled while saving).
    await b.until(`!document.querySelector("[data-question] button[aria-pressed]:disabled")`, 15000);
    await b.evaluate(`document.querySelector("[data-question] button[aria-pressed]").click()`);
    const moved = await b.until(`(${current}) !== ${JSON.stringify(q)}`, 6000);
    // A multi-choice question waits for Continue.
    if (!moved) {
      await b.until(`!document.querySelector("[data-question] button[aria-pressed]:disabled")`, 15000);
      await b.evaluate(`[...document.querySelectorAll("[data-question] button")].find((x) => /^(Continue|Done)$/.test(x.textContent.trim()))?.click()`);
      await b.until(`(${current}) !== ${JSON.stringify(q)}`, 6000);
    }
  }
  await b.until(`!document.querySelector("[data-question]") && [...document.querySelectorAll("button")].filter((x) => x.textContent.trim() === "Change").length === 6`, 15000);
  await new Promise((r) => setTimeout(r, 2500)); // the last save + style lock
  const suggested = await b.until(`!!document.querySelector("[data-selected-direction]")`, 15000);
  const sel = await b.evaluate(`document.querySelector("[data-selected-direction]")?.getAttribute("data-selected-direction")`);
  check("six answers → a suggested direction", suggested, String(sel));
  check("the answers list shows six with Change", (await b.evaluate(`[...document.querySelectorAll("button")].filter((x) => x.textContent.trim() === "Change").length`)) === 6);
  check("match sentence + derived-marked cost delta", await b.evaluate(`/Matches \\d of your 6 answers/.test(document.querySelector("[data-selected-direction]").textContent) && !!document.querySelector('[data-selected-direction] [data-tier="derived"], [data-selected-direction] svg')`));
  const brief = (await sb.from("project_briefs").select("recommended_style_key, override_style_key, completed_at").eq("project_id", projectId).maybeSingle()).data;
  check("the brief is stored and complete, no pick of my own yet", !!brief?.completed_at && brief.recommended_style_key === sel && brief.override_style_key == null, JSON.stringify(brief));
  const style1 = (await sb.from("style_choices").select("style_key").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle()).data;
  check("the suggestion is the project's direction (style_choices)", style1?.style_key === sel, String(style1?.style_key));

  const other = await b.evaluate(`document.querySelector("[data-direction]")?.getAttribute("data-direction")`);
  await b.evaluate(`document.querySelector("[data-direction] button").click()`);
  await b.until(`document.querySelector("[data-selected-direction]")?.getAttribute("data-selected-direction") === ${JSON.stringify(other)}`, 10000);
  await new Promise((r) => setTimeout(r, 2500)); // the pick's save + style lock
  await b.goto(P, "[data-design]");
  if (process.env.DEBUG) console.log("label", await b.evaluate(`document.querySelector("#direction-h")?.textContent`));
  check("Choose → YOUR PICK, and it survives a reload", (await b.evaluate(`document.querySelector("[data-selected-direction]")?.getAttribute("data-selected-direction")`)) === other && (await b.evaluate(`document.body.textContent.includes("YOUR PICK · SELECTED")`)), String(other));

  console.log("\n2. References");
  await b.goto(`${P}?view=references`, "[data-design]");
  check("02 Design is Attention while nothing is pinned", (await b.evaluate(`document.querySelector('[data-step="design"]')?.getAttribute("data-state")`)) === "attention");
  for (let i = 0; i < 3; i++) {
    await b.evaluate(`[...document.querySelectorAll('button[aria-pressed="false"][aria-label*="pin to your board"]')][0].click()`);
    await b.until(`document.querySelectorAll("[data-board-item]").length === ${i + 1}`, 10000);
  }
  check("three pinned show a check, not a colour", (await b.evaluate(`document.querySelectorAll('button[aria-pressed="true"][aria-label*="pinned"]').length`)) === 3);
  const order1 = await b.evaluate(`[...document.querySelectorAll("[data-board-item]")].map((x) => x.getAttribute("data-board-item"))`);
  await b.evaluate(`document.querySelector("[data-board-item]").focus()`);
  const focused = await b.evaluate(`document.activeElement?.getAttribute("data-board-item")`);
  await b.key("ArrowRight", 1); // 1 = Alt
  const live = await b.evaluate(`[...document.querySelectorAll("[data-board-item]")].map((x) => x.getAttribute("data-board-item")).join(",")`);
  if (process.env.DEBUG) console.log("focused", focused, "live after key", live);
  await new Promise((r) => setTimeout(r, 2500));
  await b.goto(`${P}?view=references`, "[data-design]");
  const order2 = await b.evaluate(`[...document.querySelectorAll("[data-board-item]")].map((x) => x.getAttribute("data-board-item"))`);
  check("Alt + → moves the first reference to second, and it persists", order2.length === 3 && order2[0] === order1[1] && order2[1] === order1[0], `${order1.join(",")} → ${order2.join(",")}`);
  check("02 Design leaves Attention at 3 pinned", (await b.evaluate(`document.querySelector('[data-step="design"]')?.getAttribute("data-state")`)) === "done");
  check("the References tab counts them", await b.evaluate(`document.querySelector('[data-tab="references"]')?.textContent.includes("3 pinned")`));
  await b.evaluate(`document.querySelector('button[aria-pressed="true"][aria-label*="pinned"]').click()`);
  check("unpin from the library", await b.until(`document.querySelectorAll("[data-board-item]").length === 2`, 10000));
  check("no console errors", b.errors().length === 0, b.errors().join(" | ").slice(0, 200));
} finally {
  await b.close();
  await teardown();
}
const left = ((await sb.from("projects").select("id").eq("name", NAME)).data ?? []).length;
check("scratch project removed", left === 0);
console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nK8 DESIGN PASSED");
process.exit(failures ? 1 : 0);
