// =============================================================================
// scripts/b8-render-experiment.ts — bathroom pilot B8 (render experiment B2c):
// three arms on the client's five photos, two attempts each, every one judged
// by the corrected check (two readings, measured tolerances, height + stated
// height) — see docs/BATHROOM_PILOT_B8.md.
//
//   node --env-file=.env.local --experimental-transform-types --import ./scripts/_alias-hook.mjs \
//     scripts/b8-render-experiment.ts --arms=baseline,finish,structure [--photos=1,2,3,4,5]
//   …  --publish=<arm>   put that arm's passed views of the current design into the studio / pack
//
// The design rendered is the room as it stands (rev 14: the storage cabinet in
// place of the bidet, one fixed glass panel), so a view that passes can go
// straight into the pilot pack. P2 is the room's anchor (locked): every arm
// renders it from the client's references; the other four views follow the
// anchor (its design spec as the look, the follows check beside it).
//
//   baseline  — THE pipeline as it runs today: nano-banana-pro frame-pinned; P2
//               with the three whole-room reference images, P1/P3/P4/P5 with
//               the anchor's image. Attempt 1 of P1/P3/P4/P5 is B7's render of
//               the same pipeline (re-scored, not rendered again); attempt 2 is new.
//   finish    — the same model and frame pin, the reference images replaced by
//               four FINISH close-ups (tile, vanity front, mirror, tap) cut from
//               the client's references: no room in them, no layout to copy.
//   structure — flux-canny-pro from a texture-suppressed copy of the photo
//               (structureControl): the geometry is the control, the look is
//               the prompt (the finish references in words — it takes no images).
// Writes data/Bathroom Pilot/b8-eval/<arm>/ (gitignored: client photos) and
// results.json; spend rows (purpose "eval").
// =============================================================================

import fs from "node:fs";
import path from "node:path";

import { checkCostUsd, CHECK_VERSION, type Detection } from "@/lib/render/photo-check";
import { FINISH_REFS_LINE, restyleWithCheck, type RestyleArm, type RestyleResult, type StyleBrief } from "@/lib/render/photo-restyle";
import { fittingNotes } from "@/lib/render/fitting-notes";
import { recordSpend, type SpendRow } from "@/lib/render/render-spend";
import { uploadRenderBytes } from "@/lib/render-storage";
import { designKey } from "@/lib/documents/render-consistency";
import { expectedInView } from "@/lib/render/photo-check";
import { followsLine } from "@/lib/render/room-spec";
import type { PhotoViewGate } from "@/lib/render/photo-view-run";

import { bytesOf, EVAL_DIR, loadB8Context, P, ROOM } from "./lib/b8-context";

type Arm = "baseline" | "finish" | "structure";
const ARM_OF: Record<Arm, RestyleArm> = { baseline: "edit_pro", finish: "edit_pro", structure: "structure" };
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const arms = (arg("arms")?.split(",") ?? []) as Arm[];
const photos = (arg("photos") ?? "1,2,3,4,5").split(",").map(Number);
const publish = arg("publish") as Arm | undefined;
/** Hard stop for this run's spend (renders + readings), US$. */
const BUDGET_USD = Number(arg("budget") ?? 4.5);

const ctx = await loadB8Context("b8-render-experiment");
const { db, views, current } = ctx;
const readings = JSON.parse(fs.readFileSync(path.join(EVAL_DIR, "readings.json"), "utf8")) as Record<string, { detection: Detection; render_id?: string; image?: string }>;
const RESULTS = path.join(EVAL_DIR, "results.json");
type Result = { arm: Arm; photo: number; outcome: RestyleResult["outcome"]; line: string; style_line: string; layout: boolean; style: number | null; both: boolean; attempts: { attempt: number; rendered: boolean; passed: boolean; failures: string[]; style: number | null; cost_usd: number; error?: string }[]; cost_usd: number; file: string | null; prompt: string };
// One file per arm × photo, so arms and photos can run as parallel processes.
const RESULT_DIR = path.join(EVAL_DIR, "results");
fs.mkdirSync(RESULT_DIR, { recursive: true });
const results: Record<string, Result> = { ...(fs.existsSync(RESULTS) ? JSON.parse(fs.readFileSync(RESULTS, "utf8")) : {}), ...Object.fromEntries(fs.readdirSync(RESULT_DIR).map((f) => [f.replace(/.json$/, "").replace("_", ":"), JSON.parse(fs.readFileSync(path.join(RESULT_DIR, f), "utf8"))])) };
const save = (key: string) => fs.writeFileSync(path.join(RESULT_DIR, `${key.replace(":", "_")}.json`), JSON.stringify(results[key], null, 1));
const finishRefs = ["tile", "vanity-front", "mirror", "brassware"].map((n) => `data:image/jpeg;base64,${fs.readFileSync(path.join(EVAL_DIR, "finish-refs", `${n}.jpg`)).toString("base64")}`);
const B7: Record<number, string> = { 1: "b7_pro:P1", 3: "b7_pro:P3", 4: "b7_pro:P4", 5: "b7_pro:P5" };

let spent = 0;
for (const arm of arms) {
  fs.mkdirSync(path.join(EVAL_DIR, arm), { recursive: true });
  for (const n of photos) {
    const key = `${arm}:P${n}`;
    if (results[key]) { console.log(`${key}: done before — ${results[key]!.line}`); continue; }
    if (spent > BUDGET_USD) { console.log(`budget US$${BUDGET_USD} reached — stopping before ${key}`); break; }
    const v = views.find((x) => x.n === n)!;
    const photoBytes = await bytesOf(v.url);
    const before = readings[`photo:P${n}:current`]!.detection;
    const anchored = !!ctx.anchor && ctx.anchor.room_photo_id !== v.id;
    const style: StyleBrief = anchored ? ctx.anchor!.style : ctx.references;
    const wcInView = current.items.some((it) => it.kind === "wc" && before.items.find((l) => l.ref === it.ref)?.present);
    const notes = [...fittingNotes(v.camera, current.plan, wcInView), ...current.notes];
    const extra = arm === "baseline" ? (anchored ? [ctx.anchor!.image_url] : ctx.referenceUrls) : arm === "finish" ? finishRefs : [];
    let firstImage: { bytes: Uint8Array; url: string; prompt: string } | undefined;
    if (arm === "baseline" && anchored && B7[n]) {
      const r = readings[B7[n]!]!;
      const { data: row } = await db.from("renders").select("image_url, prompt").eq("id", r.render_id!).single<{ image_url: string; prompt: string }>();
      firstImage = { bytes: await bytesOf(row!.image_url), url: row!.image_url, prompt: row!.prompt };
    }
    const res = await restyleWithCheck({
      project_id: P,
      arm: ARM_OF[arm],
      photoUrl: v.url,
      photoBytes,
      items: current.items,
      before,
      style,
      extraImages: extra,
      maxAttempts: 2,
      anchor: anchored ? { label: ctx.anchor!.label, bytes: ctx.anchor!.bytes } : null,
      notes,
      resizable: current.resizable,
      firstImage,
      referencesLine: arm === "finish" ? FINISH_REFS_LINE : arm === "structure" && anchored ? undefined : undefined,
    });
    const file = res.final ? path.join(EVAL_DIR, arm, `P${n}-a${res.attempts.length}.jpg`) : null;
    if (file && res.final) fs.writeFileSync(file, res.final.bytes);
    const spend: SpendRow[] = res.spend.map((s) => ({ ...s, purpose: "eval", detail: { ...(s.detail ?? {}), step: "b8", arm, photo: n } }));
    await recordSpend(db, spend);
    const cost = spend.reduce((s, r) => s + (r.cost_usd ?? 0), 0);
    spent += cost;
    const last = res.attempts.at(-1)!;
    const layout = res.outcome === "passed";
    results[key] = {
      arm, photo: n, outcome: res.outcome, line: res.line, style_line: res.style_line, layout,
      style: layout ? (last.style?.score ?? null) : null,
      both: layout && !!last.style?.passed,
      attempts: res.attempts.map((a, i) => ({ attempt: a.attempt, rendered: !(i === 0 && firstImage), passed: !!a.verdict?.passed, failures: a.verdict?.failures.map((f) => f.message) ?? [], style: a.style?.score ?? null, cost_usd: Math.round(a.cost_usd * 10000) / 10000, ...(a.error ? { error: a.error } : {}) })),
      cost_usd: Math.round(cost * 10000) / 10000,
      file,
      prompt: last.prompt,
    };
    save(key);
    console.log(`${key}: ${layout ? "layout ✓" : "layout ✗"} · ${res.style_line} · attempts ${res.attempts.length} · US$${cost.toFixed(3)} — ${res.line}`);
  }
}
if (arms.length) console.log(`this run: US$${spent.toFixed(2)}`);

// --- publish: an arm's passed views of the current design become studio versions (and pack candidates) ---
if (publish) {
  const { data: roomRow } = await db.from("rooms").select("spec").eq("id", ROOM).single<{ spec: Record<string, unknown> | null }>();
  const dk = designKey(current.plan.fixtures, (roomRow?.spec as Record<string, unknown> | null)?.wet_room ?? null);
  for (const r of Object.values(results).filter((x) => x.arm === publish && x.both && x.file)) {
    const v = views.find((x) => x.n === r.photo)!;
    if (ctx.anchor?.room_photo_id === v.id) { console.log(`P${r.photo}: the anchor's view is locked — not replaced`); continue; }
    if (!r.attempts.some((x) => x.rendered)) { console.log(`P${r.photo}: passed on an existing render (already a studio version) — nothing new to add`); continue; }
    const bytes = new Uint8Array(fs.readFileSync(r.file!));
    const url = await uploadRenderBytes(`projects/${P}/photo-views/${v.id}-b8-${publish}-${Date.now()}.jpg`, bytes, "image/jpeg");
    const before = readings[`photo:P${r.photo}:current`]!.detection;
    const camera = v.camera;
    const gate: PhotoViewGate & Record<string, unknown> = {
      pipeline: `b8-${publish}`,
      outcome: "passed",
      line: r.line,
      style_line: ctx.anchor ? followsLine("follows", ctx.anchor.label) : r.style_line,
      style_source: "anchor",
      arm: ARM_OF[publish],
      checked: [],
      items: current.items,
      before: before.items,
      expected_in_view: camera ? [...expectedInView(camera, current.plan, current.items, current.plan.m_per_u)] : null,
      attempts: r.attempts.map((a) => ({ attempt: a.attempt, model: ARM_OF[publish] === "structure" ? "black-forest-labs/flux-canny-pro" : "google/nano-banana-pro", image_url: null, size: null, passed: a.passed, failures: a.failures.map((m) => ({ ref: "", short: "", reason: "", message: m })), after: null, ssim: null, changed_pct: null, style: a.style != null ? { score: a.style, passed: a.style >= 0.75, elements: [] } : null, cost_usd: a.cost_usd })),
      cost_usd: r.cost_usd,
      ...(ctx.anchor ? { anchor: { render_id: ctx.anchor.render_id, label: ctx.anchor.label } } : {}),
      design_key: dk,
      check_version: CHECK_VERSION,
    };
    const { data: row, error } = await db.from("renders").insert({ project_id: P, room_id: null, room_photo_id: v.id, prompt: r.prompt, image_url: url, source_image_url: v.url, model: gate.attempts.at(-1)!.model, mode: "photo_view", gate, status: "succeeded", ...(ctx.anchor ? { anchor_render_id: ctx.anchor.render_id } : {}) }).select("id").single<{ id: string }>();
    if (error) throw error;
    console.log(`P${r.photo}: published ${row!.id}`);
  }
}
console.log(`check ${CHECK_VERSION}; spend rows written with purpose "eval". checkCostUsd at ${checkCostUsd({ input_tokens: 1e6, output_tokens: 0 })} per M input`);
