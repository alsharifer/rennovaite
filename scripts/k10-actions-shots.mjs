#!/usr/bin/env node
// =============================================================================
// scripts/k10-actions-shots.mjs — K10 #1 screenshots + axe (spec §6.12; frames
// 76:2719 menu · 76:2981 confirm · 77:2905 Recently deleted, dark 77:8601 ·
// 77:8908 · 77:9218), light AND dark, desktop.
//
//   node --env-file=.env.local scripts/k10-actions-shots.mjs [port] [--shots=screenshots/k10/actions]
//
// Scratch state only, removed at the end: a scratch firm with an admin
// ("k10-admin") and a plain member ("k10-member"); three fictional projects —
// one with a BoQ revision and an issued proposal (the dialog's warning), one
// plain, one already in Recently deleted.
// =============================================================================

import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { openBrowser } from "./lib/cdp.mjs";
import { devSession } from "./lib/dev-auth.mjs";

const PORT = /^\d+$/.test(process.argv[2] ?? "") ? process.argv[2] : "3098";
const BASE = `http://localhost:${PORT}`;
const SHOTS = (process.argv.find((a) => a.startsWith("--shots=")) ?? "--shots=screenshots/k10/actions").slice(8);
const { url, key } = resolveTarget({ script: "k10-actions-shots", writes: true });
const sb = createClient(url, key, { auth: { persistSession: false } });

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const admin = await devSession("k10-admin", { script: "k10-actions-shots" });
const member = await devSession("k10-member", { script: "k10-actions-shots" });
const ids = { A: randomUUID(), B: randomUUID(), C: randomUUID() };
const names = { A: "Villa 12, The Springs (scratch)", B: "Penthouse 41, Marina (scratch)", C: "Townhouse 7, Al Barari (scratch)" };
let firmId = null;

async function seed() {
  const { data: firm } = await sb.from("firms").insert({ name: `Meridian Fit-Out (K10 scratch ${Date.now()})`, created_by: "k10-actions-shots" }).select("id").single().throwOnError();
  firmId = firm.id;
  await sb.from("firm_members").insert([{ firm_id: firmId, user_id: admin.userId, role: "admin" }, { firm_id: firmId, user_id: member.userId, role: "member" }]).throwOnError();
  await sb
    .from("projects")
    .insert(Object.entries(ids).map(([k, id]) => ({ id, name: names[k], city: "Dubai", firm_id: firmId, created_by: member.userId })))
    .throwOnError();
  await sb
    .from("project_members")
    .insert(Object.values(ids).flatMap((id) => [{ project_id: id, user_id: admin.userId }, { project_id: id, user_id: member.userId }]))
    .throwOnError();
  const chain = { sections: [], subtotal_aed: 0, contingency_pct: 0, contingency_aed: 0, vat_pct: 0, vat_aed: 0, grand_total_aed: 0 };
  await sb.from("boqs").insert([{ project_id: ids.A, total_aed: 0, sections: chain }, { project_id: ids.A, total_aed: 0, sections: chain }, { project_id: ids.A, total_aed: 0, sections: chain }]).throwOnError();
  await sb.from("pack_exports").insert({ project_id: ids.A, source: "cli", status: "passed", options: { proposal: true, stage: "verification", purpose: "k10-actions-shots" }, started_at: new Date().toISOString() }).throwOnError();
  await sb.from("projects").update({ deleted_at: new Date(Date.now() - 2 * 3600_000).toISOString(), deleted_by: admin.userId }).eq("id", ids.C).throwOnError();
}

async function shots(b, theme, who) {
  const t = (n) => `${SHOTS}/${theme === "dark" ? "dark/" : ""}${n}.png`;
  await b.viewport(1440, 1000);
  await b.send("Network.setCookie", { name: "rv_theme", value: theme, domain: "localhost", path: "/" });
  await b.goto(`${BASE}/projects`, "[data-home]");
  // The menu (76:2719) — open the scratch Villa's "⋯" with the keyboard (menu button pattern).
  await b.evaluate(`document.querySelector('[data-project="${ids.A}"] [data-testid="project-actions"]').focus()`);
  await b.key("Enter");
  await b.until(`document.activeElement?.getAttribute("role") === "menuitem"`);
  check(`${theme}/${who}: Enter opens the menu with focus on Open`, /Open$/.test(await b.evaluate(`document.activeElement?.textContent?.trim() ?? ""`)));
  await b.key("ArrowDown");
  await b.key("ArrowDown");
  check(`${theme}/${who}: arrows move (Archive)`, /Archive/.test(await b.evaluate(`document.activeElement?.textContent ?? ""`)));
  const reason = await b.evaluate(`document.querySelector('[data-testid="project-delete"]')?.getAttribute("aria-disabled") === "true" ? document.getElementById(document.querySelector('[data-testid="project-delete"]').getAttribute("aria-describedby"))?.textContent : null`);
  if (who === "member") check(`member: "Delete project…" is disabled with its reason`, reason === "Only a firm admin can delete this project", String(reason));
  else check(`admin: "Delete project…" is enabled`, reason === null);
  check(`${theme}/${who}: menu — axe clean`, (await b.axe()).length === 0, JSON.stringify(await b.axe()).slice(0, 300));
  await b.screenshot(t(`${who}-1-menu`));
  await b.key("Escape");
  check(`${theme}/${who}: Esc closes and returns focus to the "⋯"`, (await b.evaluate(`document.activeElement?.dataset?.testid`)) === "project-actions");
  if (who === "member") return;

  // The confirm (76:2981).
  await b.key("Enter");
  await b.until(`document.activeElement?.getAttribute("role") === "menuitem"`);
  await b.evaluate(`document.querySelector('[data-testid="project-delete"]').click()`);
  await b.until(`!!document.querySelector('[data-delete-counts]')`, 15000);
  const counts = await b.evaluate(`[...document.querySelectorAll('[data-delete-counts] li')].map((li) => li.textContent.replace(/\\s+/g, " ").trim())`);
  check(`${theme}: the dialog counts what goes`, /^3\D/.test(counts[0] ?? "") && /^1\D/.test(counts[3] ?? ""), counts.join(" | "));
  check(`${theme}: the issued-proposal warning + Download pack`, !!(await b.evaluate(`document.querySelector('[data-proposal-issued]')?.textContent?.includes("Download pack")`)));
  const disabled = await b.evaluate(`document.querySelector('[data-testid="delete-confirm"]').getAttribute("aria-disabled")`);
  check(`${theme}: Delete project is disabled until the name matches`, disabled === "true");
  await b.screenshot(t("2-confirm-empty"));
  await b.evaluate(`(() => { const i = document.querySelector('[data-testid="delete-confirm-name"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(i, ${JSON.stringify(names.A.toLowerCase())}); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await b.until(`document.querySelector('[data-testid="delete-confirm"]').getAttribute("aria-disabled") !== "true"`);
  check(`${theme}: the name (any case) enables Delete project`, (await b.evaluate(`document.querySelector('[data-testid="delete-confirm"]').getAttribute("aria-disabled")`)) !== "true");
  check(`${theme}: dialog — axe clean`, (await b.axe()).length === 0, JSON.stringify(await b.axe()).slice(0, 300));
  await b.screenshot(t("3-confirm-typed"));
  await b.key("Escape");

  // Recently deleted (77:2905) with the undo toast.
  await b.goto(`${BASE}/projects?view=deleted&undo=${ids.C}`, "[data-recently-deleted]");
  check(`${theme}: Recently deleted lists the deleted project with Restore + Delete now`, (await b.evaluate(`!!(document.querySelector('[data-deleted-project="${ids.C}"] [data-testid="restore-project"]') && document.querySelector('[data-deleted-project="${ids.C}"] [data-testid="delete-now"]'))`)));
  check(`${theme}: the undo toast is a status`, (await b.evaluate(`document.querySelector('[data-testid="undo-toast"]')?.getAttribute("role")`)) === "status");
  check(`${theme}: Recently deleted — axe clean`, (await b.axe()).length === 0, JSON.stringify(await b.axe()).slice(0, 300));
  await b.screenshot(t("4-recently-deleted"));

  // The hub top bar's "⋯".
  await b.goto(`${BASE}/project/${ids.B}`, "[data-testid='project-actions']");
  await b.evaluate(`document.querySelector('.bp-topbar [data-testid="project-actions"], [data-testid="project-actions"]').click()`);
  await b.until(`!!document.querySelector('[data-testid="project-actions-menu"]')`);
  await b.screenshot(t("5-hub-menu"));
}

try {
  await seed();
  for (const [who, account] of [["admin", "k10-admin"], ["member", "k10-member"]]) {
    for (const theme of ["light", "dark"]) {
      const b = await openBrowser({ who: account, script: "k10-actions-shots" });
      try {
        await shots(b, theme, who);
        const errs = b.errors().filter((e) => !/favicon|Download the React DevTools/.test(e));
        check(`${theme}/${who}: no console errors`, errs.length === 0, errs.slice(0, 3).join(" | "));
      } finally {
        await b.close();
      }
    }
  }
} finally {
  await sb.from("pack_exports").delete().in("project_id", Object.values(ids));
  await sb.from("boqs").delete().in("project_id", Object.values(ids));
  await sb.from("projects").delete().in("id", Object.values(ids));
  if (firmId) await sb.from("firms").delete().eq("id", firmId);
  console.log(`cleaned up · shots → ${SHOTS}`);
}
console.log(failures === 0 ? "\nALL K10 ACTION CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
