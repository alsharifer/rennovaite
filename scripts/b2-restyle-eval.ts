// =============================================================================
// scripts/b2-restyle-eval.ts — bathroom pilot B2: which restyle keeps the
// layout? Measured on the pilot's five photos, scored by the placement check.
//
//   node --env-file=.env.local --experimental-transform-types --import ./scripts/_alias-hook.mjs \
//     scripts/b2-restyle-eval.ts [port] [--arms=edit,depth,canny] [--seed-test] [--skip-refs]
//
// On the dev test project a2661f34 (B1's bathroom, B2's five placed photos):
//   1. References: the seven client screenshots are cropped to their photos
//      (a vision model finds the photo inside the app chrome), uploaded to the
//      project's References (02 Design — the real upload + moodboard routes) and
//      described in words: the style brief every arm is prompted with (§6).
//   2. Each photo is read once ("before"): where the door, window, WC, bidet,
//      vanity and shower glass are; kept on room_photos.before_detection.
//   3. Each arm restyles each photo with the placement check and its retry:
//      edit (google/nano-banana — the current photo + prompt path), depth
//      (flux-depth-pro, the photo's depth map as control), canny (flux-canny-pro,
//      its edges). Pass rate first time and after the one retry, cost per
//      render, perceptual difference per render.
//   4. --seed-test: the edit arm again with the first three references as image
//      inputs (TASTE_SEED's path) — adopted only if the pass rate holds.
// Writes: data/Bathroom Pilot/b2-eval/ (gitignored — client photos), every
// image, results.json; spend rows (purpose "eval") on the project.
// =============================================================================

import fs from "node:fs";
import path from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";
import { devFetch } from "./lib/dev-auth.mjs";

import { CHECK_VERSION, checkItemsFor, checkCostUsd, expectedInView, type CheckItem, type Detection } from "@/lib/render/photo-check";
import { ARM_MODEL, readBefore, restyleWithCheck, type RestyleArm, type RestyleResult, type StyleBrief } from "@/lib/render/photo-restyle";
import { loadMiniPlans, loadPhotoViews } from "@/lib/render/photo-views-load";
import { cropReference, describeReferences, referenceCropBox, REFERENCES_LINE } from "@/lib/render/reference-style";
import { recordSpend, type SpendRow } from "@/lib/render/render-spend";

const SCRIPT = "b2-restyle-eval";
const args = process.argv.slice(2);
const PORT = /^\d+$/.test(args[0] ?? "") ? args[0] : "3096";
const BASE = `http://localhost:${PORT}`;
const ROUND = (args.find((a) => a.startsWith("--round=")) ?? "").slice(8);
const ARMS = ((args.find((a) => a.startsWith("--arms=")) ?? "--arms=edit,depth,canny").slice(7).split(",") as RestyleArm[]).filter((a) => a in ARM_MODEL);
const SEED_TEST = args.includes("--seed-test");
const SKIP_REFS = args.includes("--skip-refs");
const P = "a2661f34-9d96-4020-a755-40359440c302";
const DIR = path.resolve("data/Bathroom Pilot");
const OUT = path.join(DIR, "b2-eval");
const REF_DIR = path.join(DIR, "References");
const CROPPED = path.join(OUT, "references-cropped");
fs.mkdirSync(CROPPED, { recursive: true });

const { url, key } = resolveTarget({ script: SCRIPT, writes: true });
const sb = createClient(url, key, { auth: { persistSession: false } }) as unknown as SupabaseClient;
const f = devFetch("b1-owner", { script: SCRIPT });
const post = async (p: string, body: unknown) => {
  const r = await f(`${BASE}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status as number, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
};
const resultsPath = path.join(OUT, "results.json");
const results: Record<string, unknown> = fs.existsSync(resultsPath) ? JSON.parse(fs.readFileSync(resultsPath, "utf8")) : {};
const save = () => fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
const spend: SpendRow[] = [];

// --- the project ----------------------------------------------------------------
const { data: plan } = await sb.from("plans").select("id, total_area_m2, source, plot_width_m").eq("project_id", P).single();
const { data: room } = await sb.from("rooms").select("id, name_en").eq("plan_id", plan!.id).single();
const views = (await loadPhotoViews(sb, [room!.id]))[room!.id]!;
const mini = (await loadMiniPlans(sb, P, plan!, [room!.id]))[room!.id]!;
const items: CheckItem[] = checkItemsFor(mini);
console.log(`project ${P} · ${views.length} photo views · items ${items.map((i) => `${i.ref} ${i.short}`).join(", ")}`);

// --- 1. References → style brief --------------------------------------------------
let style: StyleBrief;
const prev = (results.style ?? null) as { text: string; elements: unknown[]; refs: string[] } | null;
if (SKIP_REFS && prev) {
  style = { text: prev.text, source: "references", line: REFERENCES_LINE, elements: prev.elements as { element: string; finish: string }[] };
} else {
  const refFiles = fs.readdirSync(REF_DIR).filter((x) => /\.jpe?g$/i.test(x)).sort();
  const crops: { file: string; box: number[]; out: string }[] = [];
  for (const file of refFiles) {
    const bytes = fs.readFileSync(path.join(REF_DIR, file));
    const out = path.join(CROPPED, file);
    if (!fs.existsSync(out)) {
      const { box, usd } = await referenceCropBox({ mediaType: "image/jpeg", data: bytes.toString("base64") });
      spend.push({ project_id: P, purpose: "eval", model: "claude-opus-5-5", cost_usd: usd, detail: { step: "reference_crop", file } });
      fs.writeFileSync(out, await cropReference(bytes, box));
      crops.push({ file, box, out });
      console.log(`  crop ${file} → ${box.map((v) => v.toFixed(0)).join(",")}`);
    } else crops.push({ file, box: [], out });
  }
  // Into the project's References (02 Design) through the real routes — once.
  const { data: board } = await sb.from("moodboard_items").select("id, asset_id").eq("project_id", P).eq("kind", "asset");
  const refAssetIds: string[] = (board ?? []).map((b: { asset_id: string }) => b.asset_id);
  if (refAssetIds.length === 0) {
    for (const c of crops) {
      const bytes = fs.readFileSync(c.out);
      const s = await post("/api/uploads/sign", { kind: "project_asset", project_id: P, size: bytes.byteLength, type: "image/jpeg", filename: `reference-${c.file}`, asset_kind: "reference_image" });
      const put = await fetch(String(s.body.signedUrl), { method: "PUT", headers: { "content-type": "image/jpeg", "x-upsert": "false" }, body: bytes });
      const done = await post("/api/uploads/complete", { path: s.body.path, asset_kind: "reference_image", source: "moodboard", filename: `reference-${c.file}` });
      const add = await post("/api/moodboard", { kind: "asset", project_id: P, asset_id: done.body.asset_id });
      console.log(`  reference ${c.file}: sign ${s.status} put ${put.status} complete ${done.status} board ${add.status}`);
      refAssetIds.push(String(done.body.asset_id));
    }
  }
  const imgs = crops.map((c) => ({ mediaType: "image/jpeg" as const, data: fs.readFileSync(c.out).toString("base64") }));
  const desc = await describeReferences(imgs);
  spend.push({ project_id: P, purpose: "eval", model: desc.model, cost_usd: desc.usd, detail: { step: "reference_style" } });
  style = { text: desc.text, source: "references", line: REFERENCES_LINE, elements: desc.elements };
  results.style = { text: desc.text, elements: desc.elements, refs: refFiles, crops: crops.map((c) => ({ file: c.file, box: c.box })) };
  // The project's reference style (what the app's restyle reads).
  await sb.from("project_briefs").upsert({ project_id: P, reference_style: { text: desc.text, elements: desc.elements, item_ids: refAssetIds, model: desc.model, at: new Date().toISOString() } }, { onConflict: "project_id" });
  save();
  console.log(`style brief (${desc.text.split(/\s+/).length} words): ${desc.text}`);
}

// --- 2. Before readings ------------------------------------------------------------
const itemsKey = `${CHECK_VERSION}|` + items.map((i) => `${i.ref}:${i.plan_id}`).join("|");
const before: Record<string, Detection> = {};
const photoBytes: Record<string, Uint8Array> = {};
for (const v of views) {
  photoBytes[v.id] = new Uint8Array(await (await fetch(v.url)).arrayBuffer());
  const { data: row } = await sb.from("room_photos").select("before_detection").eq("id", v.id).single();
  const cached = row?.before_detection as { items_key: string; detection: Detection } | null;
  if (cached?.items_key === itemsKey) before[v.id] = cached.detection;
  else {
    before[v.id] = await readBefore(photoBytes[v.id]!, items);
    spend.push({ project_id: P, purpose: "eval", model: before[v.id]!.model, cost_usd: checkCostUsd(before[v.id]!.usage), room_photo_id: v.id, detail: { step: "before" } });
    await sb.from("room_photos").update({ before_detection: { items_key: itemsKey, detection: before[v.id] } }).eq("id", v.id);
  }
  const exp = v.camera ? expectedInView(v.camera, mini, items, mini.m_per_u) : new Set<string>();
  const seen = before[v.id]!.items.filter((i) => i.present).map((i) => i.ref);
  console.log(`  P${v.n} before: sees ${seen.map((r) => `${r} ${items.find((i) => i.ref === r)!.short}`).join(", ") || "nothing"} · the camera expects ${[...exp].join(", ") || "—"}`);
  (results.before ??= {}) as Record<string, unknown>;
  (results.before as Record<string, unknown>)[`P${v.n}`] = { seen, expected: [...exp], items: before[v.id]!.items };
}
save();

// --- 3/4. Arms ----------------------------------------------------------------------
type Row = { photo: string; arm: string; outcome: RestyleResult["outcome"]; first_pass: boolean; attempts: number; line: string; cost_usd: number; sizes: (string | null)[]; ssim: (number | null)[]; changed_pct: (number | null)[]; failures: string[][] };
async function runArm(label: string, arm: RestyleArm, extra: string[]) {
  const rows: Row[] = [];
  await Promise.all(
    views.map(async (v) => {
      const res = await restyleWithCheck({ project_id: P, arm, photoUrl: v.url, photoBytes: photoBytes[v.id]!, items, before: before[v.id]!, style, extraImages: extra });
      spend.push(...res.spend.map((s) => ({ ...s, purpose: "eval" as const, room_photo_id: v.id, detail: { ...(s.detail ?? {}), arm: label } })));
      for (const a of res.attempts) {
        if (!a.image_url) continue;
        const dir = path.join(OUT, label);
        fs.mkdirSync(dir, { recursive: true });
        const bytes = new Uint8Array(await (await fetch(a.image_url)).arrayBuffer());
        fs.writeFileSync(path.join(dir, `P${v.n}-attempt${a.attempt}${a.verdict?.passed ? "-pass" : "-fail"}.jpg`), bytes);
      }
      rows.push({
        photo: `P${v.n}`,
        arm: label,
        outcome: res.outcome,
        first_pass: !!res.attempts[0]?.verdict?.passed,
        attempts: res.attempts.length,
        line: res.line,
        cost_usd: Math.round(res.attempts.reduce((s, a) => s + a.cost_usd, 0) * 10000) / 10000,
        sizes: res.attempts.map((a) => a.size),
        ssim: res.attempts.map((a) => (a.similarity ? Math.round(a.similarity.ssim * 1000) / 1000 : null)),
        changed_pct: res.attempts.map((a) => (a.similarity ? Math.round(a.similarity.changedPct * 10) / 10 : null)),
        failures: res.attempts.map((a) => (a.error ? [`error: ${a.error}`] : (a.verdict?.failures ?? []).map((x) => x.message))),
      });
      console.log(`  ${label} P${v.n}: ${res.outcome} in ${res.attempts.length} · ${res.line} · ssim ${rows.at(-1)!.ssim.join("/")} · $${rows.at(-1)!.cost_usd}`);
    }),
  );
  rows.sort((a, b) => a.photo.localeCompare(b.photo));
  const n = rows.length;
  const summary = {
    arm: label,
    model: ARM_MODEL[arm],
    first_pass: `${rows.filter((r) => r.first_pass).length}/${n}`,
    pass_after_retry: `${rows.filter((r) => r.outcome === "passed").length}/${n}`,
    renders: rows.reduce((s, r) => s + r.attempts, 0),
    cost_usd: Math.round(rows.reduce((s, r) => s + r.cost_usd, 0) * 10000) / 10000,
    cost_per_passed_view_usd: rows.some((r) => r.outcome === "passed") ? Math.round((rows.reduce((s, r) => s + r.cost_usd, 0) / rows.filter((r) => r.outcome === "passed").length) * 10000) / 10000 : null,
  };
  (results.arms ??= {}) as Record<string, unknown>;
  (results.arms as Record<string, unknown>)[label] = { summary, rows };
  save();
  // Recorded per arm, so a run cut short still leaves its spend on the ledger.
  await recordSpend(sb, spend.splice(0));
  console.log(`== ${label}: first ${summary.first_pass} · after retry ${summary.pass_after_retry} · ${summary.renders} renders · $${summary.cost_usd}`);
}

for (const arm of ARMS) await runArm(ROUND ? `${arm}@${ROUND}` : arm, arm, []);
if (SEED_TEST) {
  const { data: board } = await sb.from("moodboard_items").select("asset_id, position, created_at").eq("project_id", P).eq("kind", "asset").order("position").order("created_at").limit(3);
  const ids = (board ?? []).map((b: { asset_id: string }) => b.asset_id);
  const { data: assets } = await sb.from("project_assets").select("id, storage_path").in("id", ids);
  const rows = (assets ?? []) as { id: string; storage_path: string }[];
  const urls = ids.map((id: string) => rows.find((a) => a.id === id)).filter((a): a is { id: string; storage_path: string } => !!a).map((a) => sb.storage.from("plan-uploads").getPublicUrl(a.storage_path).data.publicUrl);
  console.log(`seed test: ${urls.length} reference images after the photo`);
  const seedArm = (ARMS[0] ?? "edit") as RestyleArm;
  await runArm(`${seedArm}+refs${ROUND ? `@${ROUND}` : ""}`, seedArm, urls);
}
const left = spend.length;
await recordSpend(sb, spend);
console.log(`spend recorded (rest): ${left} calls, $${spend.reduce((s, r) => s + (r.cost_usd ?? 0), 0).toFixed(4)}`);
console.log(`results → ${resultsPath}`);
