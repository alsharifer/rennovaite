// =============================================================================
// scripts/b5-bathroom-boq.ts — the pilot bathroom's BoQ, line by line, with the
// B5 arithmetic checks (bathroom pilot B5).
//
//   node --env-file=.env.local --experimental-transform-types --import ./scripts/_alias-hook.mjs \
//     scripts/b5-bathroom-boq.ts [project-id] [--json <file>]
//
// READ-ONLY: assembles the BoQ IN-PROCESS (lib/boq/assemble.ts, dryRun — the
// route's own assembly), so nothing is written. Prints every line (rule, item,
// qty × rate = amount, rate status / tier), the options outside the total, and
// the checks: every line qty × rate = amount, sections sum to their totals,
// the chain reconciles to the fil, no zero line that is not named as to be
// priced, no option inside the total.
// =============================================================================

import { writeFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";

import { assembleDeterministicBoq } from "../lib/boq/assemble.ts";
import { lineTotal, money2, sumMoney } from "../lib/boq/money.ts";
import { isUnpricedLine } from "../lib/documents/boq-derived.ts";

const PILOT = "a2661f34-9d96-4020-a755-40359440c302";
const args = process.argv.slice(2);
const projectId = args.find((a) => /^[0-9a-f-]{36}$/.test(a)) ?? PILOT;
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : undefined;

const { url, key } = resolveTarget({ script: "b5-bathroom-boq", writes: false });
const sb = createClient(url, key, { auth: { persistSession: false } });

const result = await assembleDeterministicBoq(sb as never, projectId, { dryRun: true });
if ("refusal" in result && result.refusal) {
  console.error("refused:", result.refusal);
  process.exit(1);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const boq = (result as any).boq as any;

type Line = { rule_id?: string; item_key?: string; description: string; quantity: number; unit: string; rate_aed: number; total_aed: number; rate_status?: string; rate_tier?: string; rate_basis?: string; stated_zero?: boolean; work_section?: string };
const failures: string[] = [];
const f2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

for (const s of boq.sections as { work_section: string; section_total_aed: number; lines: Line[] }[]) {
  console.log(`\n== ${s.work_section} — ${f2(s.section_total_aed)}`);
  for (const l of s.lines) {
    const tag = [l.rate_basis ? l.rate_basis.toUpperCase() : null, l.rate_status, l.rate_tier, l.stated_zero ? "STATED ZERO" : null].filter(Boolean).join(" · ");
    console.log(`  ${(l.rule_id ?? "-").padEnd(14)} ${(l.item_key ?? "-").padEnd(26)} ${l.description.slice(0, 70).padEnd(70)} ${String(l.quantity).padStart(7)} ${l.unit.padEnd(5)} × ${f2(l.rate_aed).padStart(10)} = ${f2(l.total_aed).padStart(11)}  ${tag}`);
    if (lineTotal(l.quantity, l.rate_aed) !== l.total_aed) failures.push(`${s.work_section} · ${l.description}: ${l.quantity} × ${l.rate_aed} ≠ ${l.total_aed}`);
    if (l.total_aed === 0 && !isUnpricedLine(l as never) && !l.stated_zero) failures.push(`${s.work_section} · ${l.description}: a zero line that is not named as to be priced`);
  }
  const sum = sumMoney(s.lines.map((l) => l.total_aed));
  if (sum !== s.section_total_aed) failures.push(`${s.work_section}: lines sum ${sum} ≠ section ${s.section_total_aed}`);
}

const subtotal = sumMoney((boq.sections as { section_total_aed: number }[]).map((s) => s.section_total_aed));
if (subtotal !== boq.subtotal_aed) failures.push(`subtotal ${subtotal} ≠ stored ${boq.subtotal_aed}`);
const grand = money2(boq.subtotal_aed + (boq.ohp_aed ?? 0) + boq.contingency_aed + boq.vat_aed);
if (grand !== boq.grand_total_aed) failures.push(`grand ${grand} ≠ stored ${boq.grand_total_aed}`);

console.log(`\nsubtotal ${f2(boq.subtotal_aed)} · OH&P ${f2(boq.ohp_aed ?? 0)} · contingency ${f2(boq.contingency_aed)} · VAT ${f2(boq.vat_aed)} · total ${f2(boq.grand_total_aed)}`);

const options = (boq.options ?? []) as { key: string; label: string; adds: Line[]; replaces: { description: string; total_aed: number }[]; net_aed: number; delta_total_aed?: number }[];
for (const o of options) {
  console.log(`
OPTION ${o.key} — ${o.label}: net ${f2(o.net_aed)} · total moves by ${f2(o.delta_total_aed ?? NaN)} (outside the total)`);
  for (const l of o.adds) {
    console.log(`  + ${(l.item_key ?? "-").padEnd(24)} ${l.description.slice(0, 70).padEnd(70)} ${String(l.quantity).padStart(7)} ${l.unit.padEnd(5)} × ${f2(l.rate_aed).padStart(10)} = ${f2(l.total_aed).padStart(11)}  ${l.rate_basis ?? ""}`);
    if (lineTotal(l.quantity, l.rate_aed) !== l.total_aed) failures.push(`option ${o.key} · ${l.description}: qty × rate ≠ amount`);
  }
  for (const r of o.replaces) console.log(`  − ${r.description.slice(0, 96).padEnd(96)} ${f2(r.total_aed).padStart(11)}`);
  const net = sumMoney([...o.adds.map((a) => a.total_aed), ...o.replaces.map((r) => -r.total_aed)]);
  if (Math.abs(net - o.net_aed) > 0.001) failures.push(`option ${o.key}: net ${o.net_aed} ≠ adds − replaces ${net}`);
  const inTotal = (boq.sections as { lines: Line[] }[]).some((s) => s.lines.some((l) => o.adds.some((a) => a.rule_id && a.rule_id === l.rule_id)));
  if (inTotal) failures.push(`option ${o.key} has a line inside the base total`);
}
const basis: Record<string, { n: number; aed: number }> = {};
for (const s of boq.sections as { lines: Line[] }[]) for (const l of s.lines) { const b = l.rate_basis ?? "—"; basis[b] = { n: (basis[b]?.n ?? 0) + 1, aed: money2((basis[b]?.aed ?? 0) + l.total_aed) }; }
console.log("\nbasis:", Object.entries(basis).map(([k, v]) => `${k} ${v.n} lines · ${f2(v.aed)}`).join(" | "));

console.log(failures.length ? `\nFAIL (${failures.length}):\n  ${failures.join("\n  ")}` : "\nchecks: qty × rate = amount · sections · chain · no silent zero · options outside — all pass");
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(boq, null, 2));
process.exit(failures.length ? 1 : 0);
