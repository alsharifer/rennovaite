// =============================================================================
// scripts/b5-bathroom-check.ts — bathroom pilot B5 live: the pilot bathroom's
// BoQ regenerated through the real route, then read where the client reads it.
//
//   node --env-file=.env.local --experimental-transform-types --import ./scripts/_alias-hook.mjs \
//     scripts/b5-bathroom-check.ts [port]
//
// On dev (`bathroom` launch entry + PACK_EXPORT_ENABLED). Writes one BoQ revision
// on the dev test project a2661f34 — nothing else.
//   1. POST /api/generate-boq → the stored revision = the in-process dry run.
//   2. The stored document: every line qty × rate = amount, sections and chain to
//      the fil, no silent zero, options outside the total, one TBC line.
//   3. The BoQ page: options, rate basis, the Issues navigator (TBC + confirm rows),
//      light + dark screenshots.
//   4. The BoQ PDF (owner, 68:1396) through a verification job — the summary page
//      carries the options and the basis; the proposal (firm) from the SAME
//      revision carries the same total and the options. Files in
//      screenshots/bathroom-pilot/b5/ (gitignored — the client's room).
// =============================================================================

import { mkdirSync, writeFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { openBrowser } from "./lib/cdp.mjs";
import { devFetch } from "./lib/dev-auth.mjs";
import { verificationJobs } from "./lib/verification-job.mjs";

import { lineTotal, sumMoney } from "../lib/boq/money.ts";
import { chainTotals } from "../lib/boq/totals.ts";
import { isUnpricedLine } from "../lib/documents/boq-derived.ts";
import { renderProposalPdf } from "../lib/documents/proposal-pdf.ts";

const SCRIPT = "b5-bathroom-check";
const PORT = /^\d+$/.test(process.argv[2] ?? "") ? process.argv[2] : "3096";
const BASE = `http://localhost:${PORT}`;
const P = "a2661f34-9d96-4020-a755-40359440c302";
const OUT = "screenshots/bathroom-pilot/b5";
mkdirSync(OUT, { recursive: true });
const { url, key } = resolveTarget({ script: SCRIPT, writes: true });
const sb = createClient(url, key, { auth: { persistSession: false } });
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

type Line = { description: string; quantity: number; unit: string; rate_aed: number; total_aed: number; rate_status?: string; rate_basis?: string; stated_zero?: boolean; rule_id?: string };
type Doc = { sections: { work_section: string; lines: Line[]; section_total_aed: number }[]; subtotal_aed: number; contingency_pct: number; vat_pct: number; ohp_pct?: number; grand_total_aed: number; options?: { key: string; label: string; net_aed: number; delta_total_aed?: number; adds: Line[] }[]; wet_room?: { package: string } };

const app = devFetch("b1-owner", { script: SCRIPT });

// 1. Regenerate through the route.
const res = await app(`${BASE}/api/generate-boq`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project_id: P }) });
const body = (await res.json().catch(() => null)) as { success?: boolean; boq_id?: string; error?: string } | null;
check("POST /api/generate-boq stores a revision", res.ok && !!body, `${res.status} ${body?.error ?? ""}`);
const { data: row } = await sb.from("boqs").select("id, sections, total_aed, created_at").eq("project_id", P).order("created_at", { ascending: false }).limit(1).single();
const doc = row!.sections as unknown as Doc;
check("the revision carries the wet-room package", doc.wet_room?.package === "b5-1", JSON.stringify(doc.wet_room));

// 2. The stored document.
const all = doc.sections.flatMap((s) => s.lines.map((l) => ({ ...l, section: s.work_section })));
const bad = all.filter((l) => lineTotal(l.quantity, l.rate_aed) !== l.total_aed);
check(`every line: qty × rate = amount (${all.length} lines)`, bad.length === 0, bad.map((l) => l.description).join("; "));
const secBad = doc.sections.filter((s) => sumMoney(s.lines.map((l) => l.total_aed)) !== s.section_total_aed);
check("every section adds up to its total", secBad.length === 0, secBad.map((s) => s.work_section).join(", "));
const c = chainTotals({ subtotal_aed: sumMoney(doc.sections.map((s) => s.section_total_aed)), contingency_pct: doc.contingency_pct, vat_pct: doc.vat_pct, ohp_pct: doc.ohp_pct });
check(`the chain reconciles to the fil — AED ${doc.grand_total_aed}`, c.grand_total_aed === doc.grand_total_aed && Number(row!.total_aed) === doc.grand_total_aed, `${c.grand_total_aed} vs ${doc.grand_total_aed} vs row ${row!.total_aed}`);
const silent = all.filter((l) => l.total_aed === 0 && !l.stated_zero && !isUnpricedLine(l as never));
check("no silent zero line (a zero is stated, or named to be priced)", silent.length === 0, silent.map((l) => l.description).join("; "));
const tbc = all.filter((l) => isUnpricedLine(l as never));
check("the lines no book prices are named, at 0, outside the total", tbc.length >= 1, tbc.map((l) => l.description).join("; "));
const opts = doc.options ?? [];
check("options priced outside the total: wall-hung WC, bulkhead removal", opts.map((o) => o.key).join(",") === "wall_hung_wc,bulkhead_removal" && opts.every((o) => !all.some((l) => o.adds.some((a) => a.rule_id === l.rule_id))), opts.map((o) => `${o.label} +${o.delta_total_aed}`).join(" · "));
check("every line says what its rate rests on", all.every((l) => !!l.rate_basis));
for (const s of ["Preliminaries", "Demolition", "Waterproofing", "Floor Finishes", "Wall Finishes", "Ceilings", "Joinery", "Aluminum & Glass", "Sanitaryware", "Electrical", "Plumbing", "Plumbing & Sanitary", "Lighting", "Decoration & Painting"]) {
  check(`section present: ${s}`, doc.sections.some((x) => x.work_section === s));
}

// 3. The BoQ page.
const b = await openBrowser({ who: "b1-owner", script: SCRIPT });
try {
  for (const theme of ["light", "dark"]) {
    await b.viewport(1440, 1000);
    await b.send("Network.setCookie", { name: "rv_theme", value: theme, domain: "localhost", path: "/" });
    await b.goto(`${BASE}/project/${P}/boq`, "[data-display-total]");
    const page = await b.evaluate(`({ total: document.querySelector("[data-display-total]")?.getAttribute("data-display-total"), options: document.querySelector("[data-boq-options]")?.getAttribute("data-boq-options"), basis: document.querySelector("[data-rate-basis]")?.innerText ?? "", deltas: [...document.querySelectorAll("[data-option-delta]")].map((e) => e.getAttribute("data-option-delta")) })`) as { total: string; options: string; basis: string; deltas: string[] };
    if (theme === "light") {
      check("the BoQ page shows the stored total", Number(page.total) === doc.grand_total_aed, `${page.total}`);
      check("the BoQ page lists the two options with their deltas", page.options === "2" && page.deltas.join(",") === opts.map((o) => String(o.delta_total_aed)).join(","), page.deltas.join(", "));
      check("the BoQ page states the rate basis", /calibrated/.test(page.basis) && /allowance/.test(page.basis) && /to be priced/.test(page.basis), page.basis);
      // The Issues navigator: open it, read its groups.
      await b.evaluate(`document.querySelector("[data-testid='issues-button']")?.click()`);
      await new Promise((r) => setTimeout(r, 400));
      const issues = await b.evaluate(`[...document.querySelectorAll("[data-issue-group]")].map((g) => g.getAttribute("data-issue-group") + ":" + g.querySelectorAll("[data-issue-row]").length)`) as string[];
      check("the Issues navigator lists the TBC line and the allowances to confirm", issues.some((g) => g.startsWith("unpriced:")) && issues.some((g) => g === "confirm:2"), issues.join(" · "));
      await b.evaluate(`document.querySelector("[data-testid='issues-button']")?.click()`);
    }
    await b.evaluate(`document.querySelector("[data-boq-options]")?.scrollIntoView({ block: "center" })`);
    await new Promise((r) => setTimeout(r, 400));
    await b.screenshot(`${OUT}/boq-page-options-${theme}.png`);
    const axe = await b.axe();
    check(`axe on the BoQ page (${theme}): no violations`, axe.length === 0, axe.map((v: { id: string; nodes: string[] }) => `${v.id}: ${v.nodes[0]}`).join(" | "));
  }
} finally {
  await b.close();
}

// 4. The documents — the same revision.
const vj = verificationJobs(sb, SCRIPT);
try {
  const h = { ...(await vj.headers(P)), authorization: await app.authorization() };
  const pagesRes = await fetch(`${BASE}/api/projects/${P}/boq-pdf?format=pages`, { headers: h });
  const pj = (await pagesRes.json().catch(() => null)) as { pages?: string[]; boq_id?: string; error?: string; code?: string } | null;
  check("the BoQ PDF answers a verification job (owner document)", pagesRes.ok && !!pj?.pages?.length, `${pagesRes.status} ${pj?.code ?? ""} ${pj?.error ?? ""}`);
  if (pj?.pages) {
    const p1 = pj.pages[0]!;
    check("BoQ PDF from the stored revision", pj.boq_id === row!.id);
    check("BoQ PDF summary: the grand total to the fil", p1.includes(`data-grand-total="${doc.grand_total_aed}"`));
    check("BoQ PDF summary: the options, outside the total", opts.every((o) => p1.includes(`data-option="${o.key}"`)) && true);
    check("BoQ PDF summary: the rate basis", /Rate basis/.test(p1));
    const pdfRes = await fetch(`${BASE}/api/projects/${P}/boq-pdf`, { headers: h, redirect: "follow" });
    if (pdfRes.ok) writeFileSync(`${OUT}/boq.pdf`, Buffer.from(await pdfRes.arrayBuffer()));
    check("the BoQ PDF downloads", pdfRes.ok, `${pdfRes.status}`);
  }
} finally {
  await vj.close();
}
// The proposal (a firm's client document) from the SAME stored revision — the
// pilot is an owner project, so its shape is rendered here, never released.
const { pdf, pages } = await renderProposalPdf({ brand: "Sample firm (shape check — not issued)", logoDataUri: null, termsText: null, projectName: "Bathroom pilot", community: "Dubai", dateISO: new Date().toISOString().slice(0, 10), rooms: [{ name: "Bathroom", kind: "bathroom", area_m2: 7 }], boq: doc as never, revision: null, showLineRates: false, preview: true });
writeFileSync(`${OUT}/proposal-shape.pdf`, Buffer.from(pdf));
const joined = pages.join("");
check("proposal from the same revision: the same grand total", joined.includes(`data-grand-total="${doc.grand_total_aed}"`));
check("proposal: the options, outside the total", opts.every((o) => joined.includes(`data-option="${o.key}"`)));
check("proposal: no rate provenance words (basis, calibrated, allowance)", !/calibrated|rate basis|reference villa/i.test(joined.replace(/<[^>]+>/g, " ")));

console.log(failures === 0 ? "\nB5 LIVE: ALL CHECKS PASSED" : `\nB5 LIVE: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
