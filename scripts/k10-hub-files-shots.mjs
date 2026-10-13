#!/usr/bin/env node
// =============================================================================
// scripts/k10-hub-files-shots.mjs — K10 #9 live: "Project files" on the
// Overview's body grid, 5 shown + "Show all N".
//
//   node --env-file=.env.local scripts/k10-hub-files-shots.mjs [port] [--shots=screenshots/k10/files]
//
// One scratch owner project with eight asset ROWS (no Storage objects — the
// list reads rows; downloads are not clicked). Removed at the end.
// =============================================================================

import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { openBrowser } from "./lib/cdp.mjs";
import { devSession } from "./lib/dev-auth.mjs";

const PORT = /^\d+$/.test(process.argv[2] ?? "") ? process.argv[2] : "3098";
const BASE = `http://localhost:${PORT}`;
const SHOTS = (process.argv.find((a) => a.startsWith("--shots=")) ?? "--shots=screenshots/k10/files").slice(8);
const { url, key } = resolveTarget({ script: "k10-hub-files-shots", writes: true });
const sb = createClient(url, key, { auth: { persistSession: false } });

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const me = await devSession("k10-files", { script: "k10-hub-files-shots" });
const P = randomUUID();
try {
  await sb.from("projects").insert({ id: P, name: "Villa files (K10 scratch)", city: "Dubai", created_by: me.userId }).throwOnError();
  await sb.from("project_members").insert({ project_id: P, user_id: me.userId }).throwOnError();
  const kinds = ["floorplan", "photo", "photo", "photo", "drawing_mep", "drawing_electrical", "photo", "reference_image"];
  await sb.from("project_assets").insert(kinds.map((kind, i) => ({ project_id: P, kind, storage_path: `${P}/assets/k10-${i}.jpg`, filename: kind === "floorplan" ? "first-floor-plan.pdf" : `${kind.replace("_", "-")}-${i + 1}.${kind.startsWith("drawing") ? "pdf" : "jpg"}`, mime: "image/jpeg", bytes: 180_000 + i * 90_000, source: "intake" }))).throwOnError();
  for (const theme of ["light", "dark"]) {
    const b = await openBrowser({ who: "k10-files", script: "k10-hub-files-shots" });
    try {
      await b.viewport(1440, 1000);
      await b.send("Network.setCookie", { name: "rv_theme", value: theme, domain: "localhost", path: "/" });
      await b.goto(`${BASE}/project/${P}`, "[data-testid='hub-files']");
      const m = await b.evaluate(`(() => { const s = document.querySelector("[data-testid='hub-files']"); const grid = s.closest(".grid"); const main = document.querySelector("[aria-labelledby='estimate-h']"); return { rows: s.querySelectorAll("li").length, button: document.querySelector("[data-testid='files-show-all']")?.textContent, onGrid: !!grid, sameColumn: !!main && Math.abs(s.getBoundingClientRect().left - main.getBoundingClientRect().left) < 2 }; })()`);
      check(`${theme}: on the body grid, aligned with the main column`, m.onGrid && m.sameColumn, JSON.stringify(m));
      check(`${theme}: 5 files and "Show all 8"`, m.rows === 5 && /Show all 8/.test(m.button ?? ""), JSON.stringify(m));
      await b.evaluate(`document.querySelector("[data-testid='hub-files']").scrollIntoView({ block: "center" })`);
      await b.screenshot(`${SHOTS}/${theme === "dark" ? "dark/" : ""}1-five.png`);
      await b.evaluate(`document.querySelector("[data-testid='files-show-all']").click()`);
      await b.until(`document.querySelectorAll("[data-testid='hub-files'] li").length === 8`);
      check(`${theme}: Show all → all 8, "Show fewer"`, (await b.evaluate(`document.querySelectorAll("[data-testid='hub-files'] li").length`)) === 8 && /Show fewer/.test(await b.evaluate(`document.querySelector("[data-testid='files-show-all']").textContent`)));
      check(`${theme}: axe clean`, (await b.axe()).length === 0, JSON.stringify(await b.axe()).slice(0, 300));
      await b.screenshot(`${SHOTS}/${theme === "dark" ? "dark/" : ""}2-all.png`);
    } finally {
      await b.close();
    }
  }
} finally {
  await sb.from("pilot_events").delete().eq("project_id", P);
  await sb.from("projects").delete().eq("id", P);
  console.log(`cleaned up · shots → ${SHOTS}`);
}
console.log(failures === 0 ? "\nALL K10 PROJECT-FILES CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
