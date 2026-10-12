// =============================================================================
// scripts/boq-review-check.mjs [port] [--shots=dir] [ids…] — K3 live check of
// BoQ & Review (R7 §3.2 / §4) in headless Chrome, signed in as the dev
// "pipeline" account (made a member of the projects it reads).
//
//   node scripts/boq-review-check.mjs 3098 --shots=screenshots/k3
//
// Default projects: Arabella (garden, 18 lines) and the interior demo villa.
// For each:
//   1. every displayed figure = the STORED revision (qty, rate, amount per
//      line; subtotal / contingency / VAT / total), and every displayed
//      rate × displayed qty = displayed amount, to the fil (spec §1.3)
//   2. page height with every section expanded ≤ 4,500 px at 1440 (§3.2 /
//      K3 verify; the Atelier page was 21,623 px)
//   3. the §4.3 keyboard walkthrough: one tab stop into the grid, arrows,
//      popover on focus + Escape, Enter → inspector heading focused, ←→
//      between tabs, Escape → focus back on the row; section index ↑↓ +
//      Enter → section header focused; Space toggles it
//   4. axe: zero violations, light AND dark
//   5. screenshots: desktop light / dark, inspector (line, what-if,
//      corrections), tablet 834 (+ half sheet), phone 390 (+ full sheet)
// Read-only on the project (nothing is generated or saved).
// =============================================================================

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { openBrowser } from "./lib/cdp.mjs";

const args = process.argv.slice(2);
const PORT = args.find((a) => /^\d+$/.test(a)) ?? "3098";
const SHOTS = args.find((a) => a.startsWith("--shots="))?.slice(8) ?? null;
const BASE = `http://localhost:${PORT}`;
const { url, key } = resolveTarget({ script: "boq-review-check" });
const sb = createClient(url, key, { auth: { persistSession: false } });

const ARABELLA = "ec4497c7-71a7-44f5-9f4b-f5a731002d0d";
let ids = args.filter((a) => /^[0-9a-f-]{36}$/.test(a));
if (ids.length === 0) {
  const { data } = await sb.from("projects").select("id").like("name", "Demo villa%").limit(5);
  const demo = (data ?? []).map((p) => p.id).find((x) => x.startsWith("6b5fda9d")) ?? data?.[0]?.id;
  ids = [ARABELLA, demo].filter(Boolean);
}

let failures = 0;
const check = (ok, what, detail = "") => {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${what}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const aed = (n) => (Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = (n) => (Number.isInteger(n) ? n.toLocaleString("en-US") : aed(n));
const num = (s) => Number(String(s).replace(/[^0-9.\-]/g, ""));

const b = await openBrowser({ script: "boq-review-check", projects: ids });
try {
  for (const id of ids) {
    const { data: proj } = await sb.from("projects").select("name").eq("id", id).single();
    console.log(`\n${proj?.name ?? id} (${id.slice(0, 8)})`);
    const { data: rows } = await sb.from("boqs").select("id, sections").eq("project_id", id).order("created_at", { ascending: false }).limit(1);
    const stored = rows?.[0]?.sections;
    if (!stored) {
      check(false, "a stored BoQ exists");
      continue;
    }
    const tag = id.slice(0, 8);
    await b.viewport(1440, 1000);
    await b.goto(`${BASE}/project/${id}/boq`, "[data-boq-review]", 180000);
    await b.evaluate(`document.documentElement.setAttribute("data-theme", "light")`);

    // --- 1. figures = stored; rate × qty = amount ---------------------------------
    const shown = await b.evaluate(`[...document.querySelectorAll('[data-line-key]')].map((r) => {
      const t = (role) => r.querySelector('[data-role="' + role + '"] > span[aria-hidden]')?.textContent?.trim() ?? null;
      return { key: r.getAttribute('data-line-key'), ref: r.getAttribute('data-ref'), qty: t('qty'), rate: t('rate'), amount: t('amount') };
    })`);
    let same = 0;
    let recon = 0;
    const bad = [];
    for (const s of shown) {
      const cut = s.key.lastIndexOf("-");
      const section = stored.sections.find((x) => x.work_section === s.key.slice(0, cut));
      const line = section?.lines[Number(s.key.slice(cut + 1))];
      if (!line) {
        bad.push(`${s.ref}: no stored line`);
        continue;
      }
      const unpriced = line.rate_status === "needs_qs" && line.rate_aed === 0;
      const want = { qty: qtyFmt(line.quantity), rate: unpriced ? "—" : aed(line.rate_aed), amount: unpriced ? "to be priced" : aed(line.total_aed) };
      if (s.qty === want.qty && s.rate === want.rate && s.amount === want.amount) same++;
      else bad.push(`${s.ref}: shown ${s.qty} × ${s.rate} = ${s.amount}, stored ${want.qty} × ${want.rate} = ${want.amount}`);
      if (unpriced || aed(num(s.qty) * num(s.rate)) === s.amount) recon++;
      else bad.push(`${s.ref}: ${s.qty} × ${s.rate} ≠ ${s.amount}`);
    }
    const lineCount = stored.sections.reduce((n, x) => n + x.lines.length, 0);
    check(shown.length === lineCount, "every stored line is a row", `${shown.length}/${lineCount}`);
    check(same === shown.length, "every row's qty / rate / amount = the stored revision", bad.slice(0, 3).join("; "));
    check(recon === shown.length, "every displayed rate × displayed qty = displayed amount (to the fil)", `${recon}/${shown.length}`);
    const chain = await b.evaluate(`Object.fromEntries([...document.querySelectorAll('[data-summary-row]')].map((r) => [r.getAttribute('data-summary-row'), r.lastElementChild?.textContent?.trim() ?? '']))`);
    const want = { subtotal: aed(stored.subtotal_aed), contingency: aed(stored.contingency_aed), vat: aed(stored.vat_aed) };
    check(Object.entries(want).every(([k, v]) => (chain[k] ?? "").includes(v)), "summary chain = stored (subtotal, contingency, VAT)", JSON.stringify(chain).slice(0, 160));
    check((chain.total ?? "").includes(aed(stored.grand_total_aed)) && Number(await b.evaluate(`document.querySelector('[data-display-total]')?.getAttribute('data-display-total')`)) === stored.grand_total_aed, "project total and pinned headline = stored grand total", aed(stored.grand_total_aed));
    const sumBySection = stored.sections.every((x) => Math.abs(x.lines.reduce((n, l) => n + l.total_aed, 0) - x.section_total_aed) < 0.011);
    check(sumBySection, "stored section subtotals are the sum of their lines");

    // --- 2. page height, all expanded ---------------------------------------------
    const height = await b.evaluate(`document.documentElement.scrollHeight`);
    const allOpen = await b.evaluate(`[...document.querySelectorAll('[aria-controls^="boq-sec-"]')].every((x) => x.getAttribute('aria-expanded') === 'true')`);
    check(allOpen && height <= 4500, `page height with all ${stored.sections.length} sections expanded ≤ 4,500 px`, `${height} px, ${lineCount} lines`);
    if (SHOTS) await b.screenshot(`${SHOTS}/${tag}-desktop-light.png`);
    if (SHOTS) await b.screenshot(`${SHOTS}/${tag}-desktop-light-full.png`, { fullPage: true });

    // --- 3. keyboard (§4.3) -------------------------------------------------------
    const focusInfo = `(() => { const a = document.activeElement; return { cell: a?.getAttribute('data-cell') ?? null, inGrid: !!a?.closest('[data-boq-grid]'), heading: a?.hasAttribute('data-inspector-heading') ?? false, tab: a?.getAttribute('role') === 'tab' ? a.textContent : null, expanded: a?.getAttribute('aria-expanded'), role: a?.getAttribute('role'), id: a?.id ?? '' }; })()`;
    const stops = await b.evaluate(`document.querySelectorAll('[data-boq-grid] [tabindex="0"]').length`);
    check(stops === 1, "the grid is ONE tab stop (roving tabindex)", `${stops} tabindex=0 inside the grid`);
    await b.evaluate(`document.querySelector('[data-boq-grid] [tabindex="0"]').focus()`);
    let f = await b.evaluate(focusInfo);
    check(f.inGrid && f.cell === "0:0", "focus enters on the first section header", JSON.stringify(f));
    await b.key(" ");
    const collapsed = await b.evaluate(`document.activeElement.getAttribute('aria-expanded')`);
    await b.key(" ");
    check(collapsed === "false" && (await b.evaluate(`document.activeElement.getAttribute('aria-expanded')`)) === "true", "Space toggles a section header (aria-expanded)");
    await b.key("ArrowDown");
    f = await b.evaluate(focusInfo);
    check(f.cell === "1:0", "↓ moves to the first line", f.cell);
    for (let i = 0; i < 5; i++) await b.key("ArrowRight");
    f = await b.evaluate(focusInfo);
    check(f.cell === "1:5", "→ walks the cells to Amount", f.cell);
    // Figure focus by keyboard opens the popover (the cell is :focus-visible after a key).
    const pop = await b.until(`!!document.querySelector('[role="tooltip"]') && document.activeElement.getAttribute('aria-describedby') === document.querySelector('[role="tooltip"]').id`, 3000);
    check(pop, "keyboard focus on a figure opens its popover (aria-describedby wired)");
    await b.key("Escape");
    check(!(await b.evaluate(`!!document.querySelector('[role="tooltip"]')`)), "Escape closes the popover");
    await b.key("Enter");
    await b.until(`!!document.activeElement?.hasAttribute('data-inspector-heading')`, 3000);
    f = await b.evaluate(focusInfo);
    check(f.heading, "Enter opens the inspector with focus on its heading");
    if (SHOTS) await b.screenshot(`${SHOTS}/${tag}-inspector-line.png`);
    // To the tabs: Shift+Tab from the heading reaches the close button / tabs in DOM order.
    await b.evaluate(`document.querySelector('[role="tab"][aria-selected="true"]').focus()`);
    await b.key("ArrowRight");
    f = await b.evaluate(focusInfo);
    check(f.tab === "What-if", "→ moves between inspector tabs", String(f.tab));
    if (SHOTS) await b.screenshot(`${SHOTS}/${tag}-inspector-whatif.png`);
    await b.key("ArrowRight");
    if (SHOTS) {
      await b.evaluate(`[...document.querySelectorAll('button')].find((x) => x.textContent === 'Capture correction')?.click()`);
      await b.until(`!!document.querySelector('form')`, 2000);
      await b.screenshot(`${SHOTS}/${tag}-inspector-corrections.png`);
    }
    await b.key("Escape");
    await b.until(`!document.querySelector('[data-inspector-for]')`, 2000);
    f = await b.evaluate(focusInfo);
    check(f.inGrid && f.cell?.startsWith("1:"), "Escape closes the inspector and returns focus to the row", JSON.stringify(f));
    await b.key("Tab");
    f = await b.evaluate(focusInfo);
    check(!f.inGrid, "Tab leaves the grid in one step", f.role ?? f.id);
    // Section index: one stop, ↓, Enter → the section header is focused.
    await b.evaluate(`document.querySelector('nav[aria-label="BoQ sections"].bp-boq-index button[tabindex="0"]').focus()`);
    await b.key("ArrowDown");
    const target = await b.evaluate(`document.activeElement.getAttribute('aria-label')`);
    await b.key("Enter");
    await new Promise((r) => setTimeout(r, 300));
    f = await b.evaluate(focusInfo);
    check(f.id.startsWith("boq-sec-") && f.expanded === "true", "section index: ↓ + Enter focuses that section's header", `${target?.split(",")[0]} → #${f.id}`);

    // --- 4. axe, light + dark -----------------------------------------------------
    for (const theme of ["light", "dark"]) {
      await b.evaluate(`window.scrollTo(0, 0); document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`);
      await new Promise((r) => setTimeout(r, 400));
      const v = await b.axe(`document.querySelector('[data-boq-review]')`);
      check(v.length === 0, `axe: no violations (${theme})`, v.map((x) => `${x.id} (${x.nodes.length}) ${x.nodes[0] ?? ""}`).join(" | ").slice(0, 400));
      if (SHOTS && theme === "dark") await b.screenshot(`${SHOTS}/${tag}-desktop-dark.png`);
    }
    await b.evaluate(`document.documentElement.setAttribute("data-theme", "light")`);

    // --- 5. tablet + phone --------------------------------------------------------
    for (const [name, w, h] of [["tablet", 834, 1194], ["phone", 390, 844]]) {
      await b.viewport(w, h, { mobile: name === "phone", touch: true });
      await b.goto(`${BASE}/project/${id}/boq`, "[data-boq-review]", 120000);
      await b.evaluate(`document.documentElement.setAttribute("data-theme", "light")`);
      const lay = await b.evaluate(`({ chips: getComputedStyle(document.querySelector('.bp-boq-chips')).display, index: getComputedStyle(document.querySelector('.bp-boq-index')).display, unit: getComputedStyle(document.querySelector('[data-line-key] .bp-boq-col-unit')).display, rate: getComputedStyle(document.querySelector('[data-line-key] .bp-boq-col-rate')).display, sub: getComputedStyle(document.querySelector('[data-line-key] .bp-boq-sub')).display, hscroll: document.documentElement.scrollWidth > window.innerWidth })`);
      check(lay.chips !== "none" && lay.index === "none", `${name}: section chips replace the index`);
      check(lay.unit === "none" && lay.rate === "none", `${name}: Unit and Rate columns hidden`);
      if (name === "phone") check(lay.sub !== "none", "phone: rows go two-line (REF · qty unit × rate)");
      check(!lay.hscroll, `${name}: no horizontal page scroll`);
      if (SHOTS) await b.screenshot(`${SHOTS}/${tag}-${name}.png`);
      const pt = await b.evaluate(`(() => { const r = document.querySelectorAll('[data-line-key]')[2]; r.scrollIntoView({ block: 'center' }); const x = r.getBoundingClientRect(); return { x: x.left + x.width / 2, y: x.top + x.height / 2, key: r.getAttribute('data-line-key') }; })()`);
      await b.tap(pt.x, pt.y);
      const sheet = await b.until(`document.querySelector('[data-inspector-sheet]')?.open === true`, 3000);
      const detent = await b.evaluate(`document.querySelector('[data-inspector-sheet]')?.getAttribute('data-detent')`);
      check(sheet && detent === (name === "phone" ? "full" : "half"), `${name}: a tap opens the inspector as a modal sheet at the ${name === "phone" ? "full" : "half"} detent`, String(detent));
      check(!(await b.evaluate(`!!document.querySelector('[role="tooltip"]')`)), `${name}: no hover popover on touch — the sheet is the explanation`);
      if (name === "tablet") {
        const rowVisible = await b.evaluate(`(() => { const r = document.querySelector('[data-line-key="${pt.key}"]').getBoundingClientRect(); const s = document.querySelector('[data-inspector-sheet]').getBoundingClientRect(); return r.bottom <= s.top && r.top >= 0; })()`);
        check(rowVisible, "tablet: the selected row stays visible above the half sheet");
      }
      if (SHOTS) await b.screenshot(`${SHOTS}/${tag}-${name}-sheet.png`);
      await b.key("Escape");
      check(await b.until(`document.querySelector('[data-inspector-sheet]')?.open !== true`, 2000), `${name}: Escape closes the sheet`);
    }
    await b.viewport(1440, 1000);
  }
  const errs = b.errors();
  check(errs.length === 0, "no console errors or uncaught exceptions", errs.slice(0, 3).join(" | "));
} finally {
  await b.close();
}
console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
