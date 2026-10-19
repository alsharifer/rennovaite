// =============================================================================
// scripts/b9-pricing.ts — bathroom pilot B9: pricing credibility before the
// contractor's itemised quote exists.
//
//   node --env-file=.env.local --experimental-transform-types --import ./scripts/_alias-hook.mjs scripts/b9-pricing.ts <step> [project-id]
//
//   --freeze            store the latest revision as the PRE-COMPARISON snapshot
//                       (boq_snapshots, migration 066) — refuses unless it is the
//                       revision the brief names (--expect=<grand total>), and
//                       refuses to freeze a second one
//   --share[=<boq-id>]  the allowance share of a revision BY VALUE, and the top 5
//                       allowance lines with what each needs to become a rate
//                       (default: the frozen snapshot and the latest revision)
//   --band              log benchmark #2: the other bathroom's 35–40K band
//   --contractor=<aed> --vat=yes|no --contingency=yes|no --noc=yes|no --supply=full|labour
//                       log benchmark #1: the client's contractor's single total,
//                       normalised to the engine's scope (omit a flag = not stated)
//
// A benchmark is never ground truth: boq_outcomes.kind = 'benchmark', no rate
// is calibrated from it, and the line-by-line comparison waits for an itemised
// quote. Default project: the dev test bathroom a2661f34.
// =============================================================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";

import { allowanceShare } from "@/lib/boq/allowance-share";
import { compareBenchmark, type BenchmarkScope, type EngineChain } from "@/lib/boq/benchmark";
import { boqPricingFingerprint } from "@/lib/documents/reference-basis";

const SCRIPT = "b9-pricing";
const P = process.argv.find((a) => /^[0-9a-f-]{36}$/.test(a)) ?? "a2661f34-9d96-4020-a755-40359440c302";
const arg = (k: string) => process.argv.find((a) => a === `--${k}` || a.startsWith(`--${k}=`))?.split("=")[1];
const has = (k: string) => process.argv.some((a) => a === `--${k}` || a.startsWith(`--${k}=`));
const { url, key } = resolveTarget({ script: SCRIPT, writes: true });
const db = createClient(url, key, { auth: { persistSession: false } }) as unknown as SupabaseClient;

type Doc = { sections: { work_section: string; section_total_aed: number; lines: Record<string, unknown>[] }[]; subtotal_aed: number; contingency_pct: number; contingency_aed: number; vat_pct: number; vat_aed: number; grand_total_aed: number };
const { data: revs } = await db.from("boqs").select("id, created_at, total_aed, sections").eq("project_id", P).order("created_at", { ascending: true });
const all = (revs ?? []) as { id: string; created_at: string; total_aed: number; sections: Doc }[];
const latest = all.at(-1)!;
const revOf = (id: string) => all.findIndex((r) => r.id === id) + 1;
const { data: snap } = await db.from("boq_snapshots").select("id, boq_id, label, fingerprint, grand_total_aed, created_at").eq("project_id", P).eq("purpose", "pre_comparison").order("created_at", { ascending: false }).limit(1).maybeSingle<{ id: string; boq_id: string; label: string; fingerprint: string; grand_total_aed: number; created_at: string }>();

if (has("freeze")) {
  const expect = Number(arg("expect"));
  if (snap) throw new Error(`already frozen: rev ${revOf(snap.boq_id)} (${snap.boq_id}), AED ${snap.grand_total_aed} — one pre-comparison snapshot per project`);
  if (!Number.isFinite(expect) || Number(latest.sections.grand_total_aed) !== expect) throw new Error(`the latest revision is rev ${all.length}, AED ${latest.sections.grand_total_aed} — not the AED ${arg("expect")} the brief names; nothing frozen`);
  const row = { project_id: P, boq_id: latest.id, purpose: "pre_comparison", label: `Pre-comparison snapshot — rev ${all.length}, before the contractor's figures (B9)`, fingerprint: boqPricingFingerprint(latest.sections as never), grand_total_aed: latest.sections.grand_total_aed, document: latest.sections };
  const { data, error } = await db.from("boq_snapshots").insert(row).select("id").single<{ id: string }>();
  if (error) throw error;
  console.log(`frozen: rev ${all.length} (${latest.id}) AED ${row.grand_total_aed} → snapshot ${data!.id}`);
}

const shareOf = (label: string, doc: Doc) => {
  const s = allowanceShare(doc.sections);
  console.log(`\n== ${label}: allowances AED ${s.allowance_aed.toFixed(2)} of AED ${s.base_aed.toFixed(2)} (${s.pct.toFixed(1)}%) — ${s.allowance_lines} of ${s.lines} lines`);
  for (const t of s.top) console.log(`   ${String(t.rule_id ?? "").padEnd(12)} ${t.total_aed.toFixed(2).padStart(9)}  ${t.description.slice(0, 60)}\n                needs: ${t.needs}`);
  return s;
};
if (has("share")) {
  const id = arg("share");
  if (id) shareOf(`rev ${revOf(id)}`, all.find((r) => r.id === id)!.sections);
  else {
    if (snap) shareOf(`frozen rev ${revOf(snap.boq_id)} (before)`, all.find((r) => r.id === snap.boq_id)!.sections);
    if (!snap || snap.boq_id !== latest.id) shareOf(`latest rev ${all.length} (after)`, latest.sections);
  }
}

// --- benchmarks ------------------------------------------------------------------
if (has("band") || has("contractor")) {
  if (!snap) throw new Error("freeze first — a benchmark is compared against the frozen revision");
  const frozen = all.find((r) => r.id === snap.boq_id)!.sections;
  const chain: EngineChain = { subtotal_aed: frozen.subtotal_aed, contingency_pct: frozen.contingency_pct, vat_pct: frozen.vat_pct, grand_total_aed: frozen.grand_total_aed };
  const bySection = Object.fromEntries(frozen.sections.map((s) => [s.work_section, s.section_total_aed]));
  const yesNo = (k: string): boolean | null => (arg(k) === "yes" ? true : arg(k) === "no" ? false : null);
  const write = async (label: string, actual: number | null, scope: Record<string, unknown>, delta: number | null, notes: string) => {
    const { data: prior } = await db.from("boq_outcomes").select("id").eq("project_id", P).eq("kind", "benchmark").eq("label", label);
    if (prior?.length) await db.from("boq_outcomes").delete().in("id", prior.map((x) => x.id)); // re-recording the same benchmark replaces it
    const { error } = await db.from("boq_outcomes").insert({ project_id: P, kind: "benchmark", label, platform_snapshot_id: snap.id, platform_boq_total: frozen.grand_total_aed, platform_by_section: bySection, actual_total: actual, actual_by_section: {}, delta_pct: delta, scope, capture_gap_notes: notes });
    if (error) throw error;
    console.log(`logged: ${label}`);
  };
  if (has("band")) {
    const cmp = compareBenchmark(null, { vat: null, contingency: null, noc: null, supply: null }, chain);
    await write("Benchmark #2 — a contractor's quote for a DIFFERENT bathroom, AED 35,000–40,000", null, { band_aed: [35000, 40000], room: "a different bathroom — not this one", stated: "a band only, no scope", engine_range_aed: [cmp.engine_low_aed, cmp.engine_high_aed] }, null,
      "BENCHMARK, not ground truth: a quote for another bathroom, a band, no lines, no stated scope. It can place the engine's total in a neighbourhood and nothing more — no rate is calibrated from it.");
    console.log(`   engine on the band's possible scopes: AED ${cmp.engine_low_aed} – ${cmp.engine_high_aed}`);
  }
  if (has("contractor")) {
    const total = Number(arg("contractor"));
    if (!Number.isFinite(total) || total <= 0) throw new Error("--contractor=<AED total>");
    const scope: BenchmarkScope = { vat: yesNo("vat"), contingency: yesNo("contingency"), noc: yesNo("noc"), supply: arg("supply") === "full" || arg("supply") === "labour" ? (arg("supply") as "full" | "labour") : null };
    const cmp = compareBenchmark(total, scope, chain);
    const mid = cmp.delta_low_pct != null && cmp.delta_high_pct != null ? Math.round(((cmp.delta_low_pct + cmp.delta_high_pct) / 2) * 10) / 10 : null;
    await write("Benchmark #1 — the client's contractor, this bathroom, a single total", total, { ...scope, engine_low_aed: cmp.engine_low_aed, engine_high_aed: cmp.engine_high_aed, delta_low_pct: cmp.delta_low_pct, delta_high_pct: cmp.delta_high_pct, comparable: cmp.comparable, notes: cmp.notes }, scope.vat != null && scope.contingency != null ? cmp.delta_low_pct : mid,
      `BENCHMARK, not ground truth: one total, no sections or lines — it cannot say which allowance is wrong, and no rate is calibrated from it. Compared like for like with the frozen rev ${revOf(snap.boq_id)}. ${cmp.notes.join(" ")} Line-by-line review waits for the itemised quote (asked for through the client).`);
    console.log(cmp.comparable ? `   contractor AED ${total} vs engine on the same scope AED ${cmp.engine_low_aed}${cmp.engine_high_aed !== cmp.engine_low_aed ? `–${cmp.engine_high_aed}` : ""}: ${cmp.delta_low_pct}%${cmp.delta_high_pct !== cmp.delta_low_pct ? ` to ${cmp.delta_high_pct}%` : ""}` : `   not comparable: ${cmp.notes[0]}`);
    for (const n of cmp.notes) console.log(`   · ${n}`);
  }
}
