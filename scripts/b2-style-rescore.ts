// =============================================================================
// scripts/b2-style-rescore.ts — bathroom pilot B2: does each arm's render also
// LOOK like the client's references? Scores every eval image already rendered
// (no new renders) with the style check (photo-check.ts checkStyle) against the
// brief's elements that view shows.
//
//   node --env-file=.env.local --experimental-transform-types --import ./scripts/_alias-hook.mjs \
//     scripts/b2-style-rescore.ts [results.json …]
//
// Writes data/Bathroom Pilot/b2-eval/style-scores.json and prints per arm:
// layout pass · style pass · both — the measure an arm is chosen by.
// =============================================================================

import fs from "node:fs";
import path from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";

import { checkCostUsd, checkItemsFor, checkStyle } from "@/lib/render/photo-check";
import { styleElementsFor, type StyleBrief } from "@/lib/render/photo-restyle";
import { loadMiniPlans } from "@/lib/render/photo-views-load";
import { recordSpend, type SpendRow } from "@/lib/render/render-spend";

const P = "a2661f34-9d96-4020-a755-40359440c302";
const OUT = path.resolve("data/Bathroom Pilot/b2-eval");
const files = process.argv.slice(2).length ? process.argv.slice(2) : [path.join(OUT, "results.json")];
const { url, key } = resolveTarget({ script: "b2-style-rescore", writes: true });
const sb = createClient(url, key, { auth: { persistSession: false } }) as unknown as SupabaseClient;
const { data: plan } = await sb.from("plans").select("id, total_area_m2, source, plot_width_m").eq("project_id", P).single();
const { data: room } = await sb.from("rooms").select("id").eq("plan_id", plan!.id).single();
const items = checkItemsFor((await loadMiniPlans(sb, P, plan!, [room!.id]))[room!.id]!);
const kindOf = new Map(items.map((i) => [i.ref, i.kind]));

const scoresPath = path.join(OUT, "style-scores.json");
const scores: Record<string, Record<string, unknown>> = fs.existsSync(scoresPath) ? JSON.parse(fs.readFileSync(scoresPath, "utf8")) : {};
const spend: SpendRow[] = [];

for (const file of files) {
  const results = JSON.parse(fs.readFileSync(file, "utf8"));
  const style: StyleBrief = { text: results.style.text, source: "references", line: "", elements: results.style.elements };
  const base = path.dirname(file) === path.join(OUT, "round1") ? path.join(OUT, "round1") : OUT;
  for (const [label, arm] of Object.entries(results.arms as Record<string, { rows: { photo: string; outcome: string; attempts: number }[] }>)) {
    if (scores[label] && Object.keys(scores[label]!).length === arm.rows.length) continue;
    scores[label] ??= {};
    await Promise.all(
      arm.rows.map(async (row) => {
        const dir = path.join(base, label);
        const last = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith(`${row.photo}-attempt`)).sort().at(-1) : undefined;
        if (!last) return;
        const seen: string[] = results.before[row.photo].seen;
        const els = styleElementsFor(style, new Set(seen.map((r) => kindOf.get(r)!).filter(Boolean)));
        const bytes = fs.readFileSync(path.join(dir, last));
        const v = await checkStyle({ mediaType: "image/jpeg", data: bytes.toString("base64") }, els);
        spend.push({ project_id: P, purpose: "eval", model: "claude-opus-5-5", cost_usd: checkCostUsd(v.usage), detail: { step: "style_rescore", label, photo: row.photo } });
        scores[label]![row.photo] = { file: last, layout: row.outcome, style_score: v.score, style_passed: v.passed, elements: v.elements.map((e) => `${e.element}:${e.verdict}`) };
      }),
    );
    fs.writeFileSync(scoresPath, JSON.stringify(scores, null, 2));
  }
}
for (const [label, rows] of Object.entries(scores)) {
  const r = Object.values(rows) as { layout: string; style_passed: boolean; style_score: number }[];
  const both = r.filter((x) => x.layout === "passed" && x.style_passed).length;
  console.log(`${label.padEnd(14)} layout ${r.filter((x) => x.layout === "passed").length}/${r.length} · style ${r.filter((x) => x.style_passed).length}/${r.length} (mean ${(r.reduce((s, x) => s + x.style_score, 0) / (r.length || 1)).toFixed(2)}) · BOTH ${both}/${r.length}`);
}
await recordSpend(sb, spend);
console.log(`style checks: ${spend.length}, $${spend.reduce((s, x) => s + (x.cost_usd ?? 0), 0).toFixed(4)} → ${scoresPath}`);
