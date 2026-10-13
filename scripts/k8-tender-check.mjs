// =============================================================================
// scripts/k8-tender-check.mjs — 06 Tender · Contractors & suppliers, driven
// like an owner (K8 #8). DEV ONLY; a scratch project, removed at the end.
//
//   node --env-file=.env.local scripts/k8-tender-check.mjs [port]
//
// The scratch project carries a COPY of the demo villa's latest BoQ (read
// only — the demo villa is never written), with its to-be-priced lines taken
// out so Tender is open. Show all; "N more" opens the item's other suppliers
// (aria-expanded); Choose moves the live total by the line's difference
// through the shared chain and says so in ink with a sign; the choice is
// saved (vendor_selections) and survives a reload; the summary's undo puts it
// back; Send scope reveals the hand-over note and takes focus. The blocked
// state (Send disabled with its reason) is checked read-only on the demo villa.
// =============================================================================

import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { openBrowser } from "./lib/cdp.mjs";

const port = process.argv.find((a) => /^\d+$/.test(a)) ?? "3098";
const base = `http://localhost:${port}`;
const NAME = "K8 tender (scratch)";
const DEMO = "6b5fda9d-e40f-4e16-940c-7a17d27ec5dc";
const { url, key } = resolveTarget({ script: "k8-tender-check", writes: true });
const sb = createClient(url, key);

let failures = 0;
const check = (l, ok, d = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok " : "  FAIL"}  ${l}${d ? `  — ${d}` : ""}`);
};

async function teardown() {
  const { data } = await sb.from("projects").select("id").eq("name", NAME);
  for (const p of data ?? []) {
    for (const t of ["vendor_selections", "boqs", "project_members", "pilot_events"]) await sb.from(t).delete().eq("project_id", p.id);
    await sb.from("projects").delete().eq("id", p.id);
  }
}

await teardown();
const demo = await sb.from("boqs").select("*").eq("project_id", DEMO).order("created_at", { ascending: false }).limit(1).single();
if (demo.error) throw new Error(demo.error.message);
const doc = structuredClone(demo.data.sections);
for (const s of doc.sections) s.lines = s.lines.filter((l) => !(Number(l.rate_aed) === 0 && Number(l.total_aed) === 0));
doc.sections = doc.sections.filter((s) => s.lines.length);

const projectId = randomUUID();
const ins = await sb.from("projects").insert({ id: projectId, name: NAME, city: "Dubai", currency: "AED", status: "draft" });
if (ins.error) throw new Error(ins.error.message);
const rest = { ...demo.data };
for (const k of ["id", "project_id", "created_at"]) delete rest[k];
const bi = await sb.from("boqs").insert({ ...rest, project_id: projectId, sections: doc });
if (bi.error) throw new Error(bi.error.message);

const b = await openBrowser({ script: "k8-tender-check", projects: [projectId] });
const P = `${base}/project/${projectId}/vendors`;
const total = `Number(document.querySelector("[data-live-total]")?.getAttribute("data-live-total"))`;
const rows = `document.querySelectorAll("[data-supplier-line]").length`;
try {
  console.log("1. Rows");
  await b.goto(P, "[data-suppliers]");
  const first = await b.evaluate(rows);
  check("the first six items show", first === 6 || first < 6, `${first}`);
  const all = await b.evaluate(`[...document.querySelectorAll("button")].find((x) => /^Show all/.test(x.textContent))?.textContent ?? null`);
  if (all) {
    await b.evaluate(`[...document.querySelectorAll("button")].find((x) => /^Show all/.test(x.textContent)).click()`);
    await b.until(`${rows} > 6`, 4000);
    check("Show all shows every item", (await b.evaluate(rows)) === Number(all.match(/\d+/)[0]), all);
  }

  console.log("2. Swap");
  const t0 = await b.evaluate(total);
  const line = await b.evaluate(`[...document.querySelectorAll("[data-supplier-line]")].find((li) => li.querySelector("button[aria-expanded]"))?.getAttribute("data-supplier-line") ?? null`);
  check("an item has other suppliers", !!line, line ?? "none");
  const sel = `[data-supplier-line=${JSON.stringify(line)}]`;
  await b.evaluate(`document.querySelector(${JSON.stringify(sel)}).querySelector("button[aria-expanded]").click()`);
  await b.until(`document.querySelector(${JSON.stringify(sel)}).querySelector("button[aria-expanded]").getAttribute("aria-expanded") === "true"`, 3000);
  const panelOpen = await b.evaluate(`(() => { const btn = document.querySelector(${JSON.stringify(sel)}).querySelector("button[aria-expanded]"); const p = document.getElementById(btn.getAttribute("aria-controls")); return !!p && !p.hidden; })()`);
  check("N more opens the other suppliers in place", panelOpen);
  const chose = await b.evaluate(`(() => { const btn = [...document.querySelector(${JSON.stringify(sel)}).querySelectorAll("button")].find((x) => x.textContent.trim() === "Choose"); const name = btn.getAttribute("aria-label").replace(/^Choose /, "").replace(/ for .*$/, ""); btn.click(); return name; })()`);
  await b.until(`${total} !== ${t0}`, 4000).catch(() => {});
  const t1 = await b.evaluate(total);
  const said = await b.evaluate(`document.querySelector("[data-live-total] [aria-live]").textContent`);
  check("the live total moves", t1 !== t0, `${t0} → ${t1}`);
  check("the change is in ink with a sign", /^[+−]AED [\d,]+\.\d\d vs your previous choices$/.test(said), said);
  const deltaOk = Math.abs(Math.abs(t1 - t0) - Number(said.replace(/[^\d.]/g, ""))) < 0.005;
  check("the stated change = the total's move", deltaOk);
  const chosenNow = await b.evaluate(`document.querySelector(${JSON.stringify(sel)}).querySelector("p.flex").textContent`);
  check("the chosen supplier is the one picked", chosenNow.includes(chose), `${chose} / ${chosenNow}`);
  await new Promise((r) => setTimeout(r, 1500));
  const saved = await sb.from("vendor_selections").select("boq_line_id").eq("project_id", projectId);
  check("the choice is saved", (saved.data ?? []).some((r) => r.boq_line_id === line), JSON.stringify(saved.data));

  console.log("3. Undo");
  const undone = await b.evaluate(`(() => { const x = [...document.querySelectorAll("[data-live-total] button")].find((y) => (y.getAttribute("aria-label") ?? "").startsWith("Undo choosing")); if (!x) return false; x.click(); return true; })()`);
  check("the summary offers undo for the moved supplier", undone);
  await b.until(`${total} === ${t0}`, 4000).catch(() => {});
  check("undo returns the total", (await b.evaluate(total)) === t0);

  console.log("4. Reload keeps the choice");
  await b.evaluate(`[...document.querySelector(${JSON.stringify(sel)}).querySelectorAll("button")].find((x) => x.textContent.trim().endsWith("more") || x.getAttribute("aria-expanded"))?.click()`);
  await b.evaluate(`[...document.querySelector(${JSON.stringify(sel)}).querySelectorAll("button")].find((x) => x.textContent.trim() === "Choose")?.click()`);
  await new Promise((r) => setTimeout(r, 1500));
  const t2 = await b.evaluate(total);
  await b.goto(P, "[data-suppliers]");
  check("a reload opens on the saved choices", (await b.evaluate(total)) === t2, `${t2} / ${await b.evaluate(total)}`);
  check("…and says nothing changed yet", (await b.evaluate(`document.querySelector("[data-live-total] [aria-live]").textContent`)).startsWith("No change"));

  console.log("5. Send");
  const enabled = await b.evaluate(`(() => { const x = [...document.querySelectorAll("button")].find((y) => y.textContent.trim() === "Send scope to contractors"); return x && !x.hasAttribute("aria-disabled"); })()`);
  check("Send is enabled when every item is priced", enabled);
  await b.evaluate(`[...document.querySelectorAll("button")].find((y) => y.textContent.trim() === "Send scope to contractors").click()`);
  await b.until(`!!document.querySelector("[data-send-scope]")`, 3000).catch(() => {});
  check("Send reveals the hand-over and takes focus", await b.evaluate(`document.activeElement === document.querySelector("[data-send-scope]")`));

  console.log("6. Blocked (demo villa, read only)");
  await b.goto(`${base}/project/${DEMO}/vendors`, "[data-suppliers]");
  const blocked = await b.evaluate(`(() => { const x = [...document.querySelectorAll("button")].find((y) => y.textContent.trim() === "Send scope to contractors"); if (!x) return null; const id = x.getAttribute("aria-describedby"); return { disabled: x.getAttribute("aria-disabled"), reason: id ? document.getElementById(id)?.textContent : null }; })()`);
  check("Send is disabled with its reason while Tender is blocked", blocked?.disabled === "true" && /^Locked until every item has a price/.test(blocked?.reason ?? ""), JSON.stringify(blocked));
} finally {
  await b.close();
  await teardown();
}
console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
