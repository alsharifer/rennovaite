// =============================================================================
// scripts/b2b-rejudge.ts — bathroom pilot B2b: judge renders already made with
// the CURRENT placement check (B2b added size), without rendering again. Reads
// each eval image beside its photo (the after reading) and re-judges.
//
//   node --env-file=.env.local --experimental-transform-types --import ./scripts/_alias-hook.mjs \
//     scripts/b2b-rejudge.ts <label> [label…]      e.g. "edit+refs@5"
// =============================================================================

import fs from "node:fs";
import path from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";

import { checkCostUsd, checkItemsFor, detectItems, judgePhotoPlacement, type Detection } from "@/lib/render/photo-check";
import { imageSize } from "@/lib/scene-render/gate";
import { loadMiniPlans, loadPhotoViews } from "@/lib/render/photo-views-load";
import { recordSpend, type SpendRow } from "@/lib/render/render-spend";

const P = "a2661f34-9d96-4020-a755-40359440c302";
const OUT = path.resolve("data/Bathroom Pilot/b2-eval");
const labels = process.argv.slice(2);
const { url, key } = resolveTarget({ script: "b2b-rejudge", writes: true });
const sb = createClient(url, key, { auth: { persistSession: false } }) as unknown as SupabaseClient;
const { data: plan } = await sb.from("plans").select("id, total_area_m2, source, plot_width_m").eq("project_id", P).single();
const { data: room } = await sb.from("rooms").select("id").eq("plan_id", plan!.id).single();
const items = checkItemsFor((await loadMiniPlans(sb, P, plan!, [room!.id]))[room!.id]!);
const views = (await loadPhotoViews(sb, [room!.id]))[room!.id]!;
const spend: SpendRow[] = [];
const outPath = path.join(OUT, "rejudge-size.json");
const out: Record<string, Record<string, unknown>> = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, "utf8")) : {};

for (const label of labels) {
  out[label] = {};
  for (const v of views) {
    const dir = path.join(OUT, label);
    const file = fs.readdirSync(dir).filter((f) => f.startsWith(`P${v.n}-attempt`)).sort().at(-1);
    if (!file) continue;
    const { data: row } = await sb.from("room_photos").select("before_detection").eq("id", v.id).single();
    const before = (row!.before_detection as { detection: Detection }).detection;
    const photo = new Uint8Array(await (await fetch(v.url)).arrayBuffer());
    const img = fs.readFileSync(path.join(dir, file));
    const after = await detectItems({ mediaType: "image/jpeg", data: img.toString("base64") }, items, "after", imageSize(img), { image: { mediaType: "image/jpeg", data: Buffer.from(photo).toString("base64") }, located: before.items });
    spend.push({ project_id: P, purpose: "eval", model: after.model, cost_usd: checkCostUsd(after.usage), room_photo_id: v.id, detail: { step: "rejudge_size", label } });
    const verdict = judgePhotoPlacement(items, before, after);
    out[label]![`P${v.n}`] = { file, passed: verdict.passed, failures: verdict.failures.map((f) => f.message) };
    console.log(`${label} P${v.n} (${file}): ${verdict.line}`);
  }
  const rows = Object.values(out[label]!) as { passed: boolean }[];
  console.log(`== ${label}: layout with size ${rows.filter((r) => r.passed).length}/${rows.length}`);
}
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
await recordSpend(sb, spend);
console.log(`readings: ${spend.length}, $${spend.reduce((s, r) => s + (r.cost_usd ?? 0), 0).toFixed(4)}`);
