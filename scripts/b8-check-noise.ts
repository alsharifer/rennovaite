// =============================================================================
// scripts/b8-check-noise.ts — bathroom pilot B8, step 1: how noisy is the
// placement check's reading, and what do the renders already made score under
// the corrected check?
//
//   node --env-file=.env.local --experimental-transform-types --import ./scripts/_alias-hook.mjs \
//     scripts/b8-check-noise.ts --read      # read every image twice (paid: vision only, no renders)
//   …  scripts/b8-check-noise.ts --judge     # the noise table + every verdict (free; --apply writes B7 re-scores)
//
// Images, each read twice (a third time when the two disagree on presence or count):
//   - the five client photos, against both designs (b8-context.ts);
//   - B2b's five frame-pinned pro views (the final attempt of each — the earlier
//     attempts' model URLs have expired), against the B2b design;
//   - B2's nano-banana + reference images (R5, one attempt each), against the B2b design;
//   - B7's four held-back views (P1, P3, P4, P5), against the current design.
// --judge measures the spread between the two readings of the same image and
// prints the tolerances it supports; the constants in photo-check-vocab.ts are
// set from that output. Then every image is judged with the agreed readings.
// =============================================================================

import fs from "node:fs";
import path from "node:path";

import { checkCostUsd, checkStyle, detectAgreed, judgePhotoPlacement, readingSpread, CHECK_VERSION, HEIGHT_TOLERANCE, SIZE_TOLERANCE, TOP_TOLERANCE, type Detection, type Located, type Spread } from "@/lib/render/photo-check";
import { styleElementsFor } from "@/lib/render/photo-restyle";
import { checkFollows, followsLine } from "@/lib/render/room-spec";
import { imageSize } from "@/lib/scene-render/gate";
import { recordSpend, type SpendRow } from "@/lib/render/render-spend";

import { bytesOf, EVAL_DIR, img, loadB8Context, P, type Design } from "./lib/b8-context";

const ctx = await loadB8Context("b8-check-noise");
const { db, views } = ctx;
fs.mkdirSync(EVAL_DIR, { recursive: true });
const READINGS = path.join(EVAL_DIR, "readings.json");
type Entry = { id: string; set: "photo" | "b2b_pro" | "r5_nano" | "b7_pro"; design: Design["key"]; photo: number; image: string; render_id?: string; detection: Detection };
const store: Record<string, Entry> = fs.existsSync(READINGS) ? JSON.parse(fs.readFileSync(READINGS, "utf8")) : {};
const save = () => fs.writeFileSync(READINGS, JSON.stringify(store, null, 1));
const designOf = (k: Design["key"]) => (k === "current" ? ctx.current : ctx.b2b);


// The renders to re-score.
const B2B_PRO: Record<number, string> = { 1: "08d8facb", 2: "371f55cc", 3: "b9acfeb1", 4: "88043e08", 5: "392fa99c" };
const B7: Record<number, string> = { 1: "47676f9a", 3: "283da098", 4: "7b862dcd", 5: "bb3a59dd" };
const { data: rows } = await db.from("renders").select("id, room_photo_id, image_url, gate").eq("project_id", P).eq("mode", "photo_view");
const renderOf = (prefix: string) => (rows ?? []).find((r) => r.id.startsWith(prefix)) as { id: string; room_photo_id: string; image_url: string; gate: Record<string, unknown> };
const r5Dir = "data/Bathroom Pilot/b2-eval/edit+refs@5";

if (process.argv.includes("--read")) {
  const spend: SpendRow[] = [];
  const read = async (id: string, e: Omit<Entry, "detection">, bytes: Uint8Array, reference?: { bytes: Uint8Array; located: Located[] }) => {
    if (store[id]) return store[id]!;
    const d = await detectAgreed(img(bytes), designOf(e.design).items, reference ? "after" : "before", imageSize(bytes), reference ? { image: img(reference.bytes), located: reference.located } : undefined);
    spend.push({ project_id: P, purpose: "eval", model: d.model, cost_usd: checkCostUsd(d.usage), detail: { step: "b8_noise", id, reads: d.reads?.length } });
    store[id] = { ...e, detection: d };
    save();
    console.log(`${id}: ${d.reads?.length} readings`);
    return store[id]!;
  };
  const photoBytes: Record<number, Uint8Array> = {};
  for (const v of views) {
    photoBytes[v.n] = await bytesOf(v.url);
    await Promise.all((["current", "b2b"] as const).map((k) => read(`photo:P${v.n}:${k}`, { id: `photo:P${v.n}:${k}`, set: "photo", design: k, photo: v.n, image: v.url }, photoBytes[v.n]!)));
  }
  const before = (n: number, k: Design["key"]) => store[`photo:P${n}:${k}`]!.detection.items;
  const jobs: Promise<unknown>[] = [];
  for (const [n, prefix] of Object.entries(B2B_PRO)) {
    const r = renderOf(prefix);
    jobs.push(bytesOf(r.image_url).then((b) => read(`b2b_pro:P${n}`, { id: `b2b_pro:P${n}`, set: "b2b_pro", design: "b2b", photo: Number(n), image: r.image_url, render_id: r.id }, b, { bytes: photoBytes[Number(n)]!, located: before(Number(n), "b2b") })));
  }
  for (const n of [1, 2, 3, 4, 5]) {
    const file = fs.readdirSync(r5Dir).filter((f) => f.startsWith(`P${n}-attempt`)).sort().at(-1)!;
    const b = new Uint8Array(fs.readFileSync(path.join(r5Dir, file)));
    jobs.push(read(`r5_nano:P${n}`, { id: `r5_nano:P${n}`, set: "r5_nano", design: "b2b", photo: n, image: path.join(r5Dir, file) }, b, { bytes: photoBytes[n]!, located: before(n, "b2b") }));
  }
  for (const [n, prefix] of Object.entries(B7)) {
    const r = renderOf(prefix);
    jobs.push(bytesOf(r.image_url).then((b) => read(`b7_pro:P${n}`, { id: `b7_pro:P${n}`, set: "b7_pro", design: "current", photo: Number(n), image: r.image_url, render_id: r.id }, b, { bytes: photoBytes[Number(n)]!, located: before(Number(n), "current") })));
  }
  await Promise.all(jobs);
  await recordSpend(db, spend);
  console.log(`readings $${spend.reduce((s, r) => s + (r.cost_usd ?? 0), 0).toFixed(3)} over ${spend.length} images`);
}

if (process.argv.includes("--judge")) {
  // 1. Noise: the first two readings of every image.
  const spreads: (Spread & { id: string })[] = [];
  let disagreed = 0;
  for (const e of Object.values(store)) {
    const [a, b] = e.detection.reads ?? [];
    if (!a || !b) continue;
    if ((e.detection.reads?.length ?? 0) > 2) disagreed++;
    for (const s of readingSpread(a, b)) spreads.push({ ...s, id: `${e.id}:${s.ref}` });
  }
  const q = (xs: number[], p: number) => { const s = [...xs].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] ?? 0; };
  const stat = (name: string, xs: number[], fmt: (v: number) => string) => console.log(`${name.padEnd(22)} n=${xs.length}  p50 ${fmt(q(xs, 0.5))}  p90 ${fmt(q(xs, 0.9))}  p95 ${fmt(q(xs, 0.95))}  max ${fmt(Math.max(...xs))}`);
  const pct = (v: number) => `×${Math.exp(v).toFixed(2)}`;
  console.log(`\n== reading noise: ${Object.keys(store).length} images, ${spreads.length} item pairs; ${disagreed} images needed a third reading`);
  stat("area (single reads)", spreads.map((s) => s.ln_area), pct);
  stat("height (single reads)", spreads.map((s) => s.ln_height), pct);
  stat("top share", spreads.map((s) => s.top).filter((t): t is number => t != null), (v) => v.toFixed(3));
  stat("centre, % frame", spreads.map((s) => s.centre), (v) => v.toFixed(1));
  // Two agreed readings (each the mean of two) of an unchanged item differ by a
  // single reading's noise σ; two single readings by √2σ. So the 95 % band
  // between agreed readings is the single-pair p95 over √2.
  const tol = (xs: number[]) => Math.exp(q(xs, 0.95) / Math.SQRT2) - 1;
  const topBand = q(spreads.map((s) => s.top).filter((t): t is number => t != null), 0.95) / 2;
  console.log(`supported tolerances: size ±${(tol(spreads.map((s) => s.ln_area)) * 100).toFixed(0)}% · height ±${(tol(spreads.map((s) => s.ln_height)) * 100).toFixed(0)}% · top share ±${topBand.toFixed(3)} (agreed vs stated)`);
  console.log(`in force: size ${SIZE_TOLERANCE} · height ${HEIGHT_TOLERANCE} · top ${TOP_TOLERANCE} · check ${CHECK_VERSION}`);
  const worst = [...spreads].sort((a, b) => b.ln_area - a.ln_area).slice(0, 6).map((s) => `${s.id} ${pct(s.ln_area)}`);
  console.log(`widest area disagreements: ${worst.join(" · ")}`);

  // 2. Verdicts with the agreed readings (and the first reading alone, for comparison).
  const spend: SpendRow[] = [];
  const out: Record<string, unknown> = {};
  for (const e of Object.values(store).filter((x) => x.set !== "photo").sort((a, b) => a.id.localeCompare(b.id))) {
    const d = designOf(e.design);
    const before = store[`photo:P${e.photo}:${e.design}`]!.detection;
    const v = judgePhotoPlacement(d.items, before, e.detection, { resizable: d.resizable });
    const single = judgePhotoPlacement(d.items, { items: before.reads![0]! }, { items: e.detection.reads![0]! }, { resizable: d.resizable });
    let style: { score: number; passed: boolean; elements: { element: string; verdict: string; note: string }[] } | null = null;
    if (v.passed) {
      const cached = (store[e.id] as Entry & { style?: typeof style }).style;
      if (cached) style = cached;
      else {
        const bytes = e.image.startsWith("http") ? await bytesOf(e.image) : new Uint8Array(fs.readFileSync(e.image));
        const photo = await bytesOf(views.find((x) => x.n === e.photo)!.url);
        const kinds = new Set(d.items.filter((it) => !it.gone && before.items.find((l) => l.ref === it.ref)?.present).map((it) => it.kind));
        if (e.design === "current" && ctx.anchor) {
          const r = await checkFollows(img(bytes), img(ctx.anchor.bytes), styleElementsFor(ctx.anchor.style, kinds));
          style = { score: r.score, passed: r.passed, elements: r.elements };
          spend.push({ project_id: P, purpose: "eval", model: "claude-opus-5-5", cost_usd: checkCostUsd(r.usage), detail: { step: "b8_follows", id: e.id } });
        } else {
          const r = await checkStyle(img(bytes), styleElementsFor(ctx.references, kinds), img(photo));
          style = { score: r.score, passed: r.passed, elements: r.elements };
          spend.push({ project_id: P, purpose: "eval", model: "claude-opus-5-5", cost_usd: checkCostUsd(r.usage), detail: { step: "b8_style", id: e.id } });
        }
        (store[e.id] as Entry & { style?: typeof style }).style = style;
        save();
      }
    }
    out[e.id] = { layout: v.passed, failures: v.failures.map((f) => f.message), single_read_layout: single.passed, single_failures: single.failures.map((f) => f.message), style: style?.score ?? null, both: v.passed && !!style?.passed };
    console.log(`${e.id.padEnd(12)} layout ${v.passed ? "✓" : "✗"} (one reading: ${single.passed ? "✓" : "✗"})  style ${style ? style.score.toFixed(2) + (style.passed ? " ✓" : " ✗") : "—"}  ${v.passed ? "" : v.line}`);

    // --apply: a B7 view that now passes goes back to the pilot pack — its gate is re-scored in place (the image is unchanged).
    if (process.argv.includes("--apply") && e.set === "b7_pro" && e.render_id) {
      const r = (rows ?? []).find((x) => x.id === e.render_id)!;
      const g = r.gate as { attempts: Record<string, unknown>[] } & Record<string, unknown>;
      const last = g.attempts.at(-1)!;
      const gate = {
        ...g,
        outcome: v.passed ? "passed" : "failed",
        line: v.line,
        style_line: v.passed && style && ctx.anchor ? followsLine(style.passed ? "follows" : "differs", ctx.anchor.label, style.elements.filter((x) => x.verdict !== "yes").map((x) => x.element)) : "Finishes not checked — the layout check comes first",
        checked: v.checked,
        before: before.items,
        attempts: [...g.attempts.slice(0, -1), { ...last, passed: v.passed, failures: v.failures, after: e.detection.items, style }],
        rescored: { check_version: CHECK_VERSION, at: new Date().toISOString(), was: { outcome: g.outcome, line: g.line } },
      };
      await db.from("renders").update({ gate }).eq("id", r.id);
      console.log(`   ↳ ${r.id.slice(0, 8)} gate re-scored: ${gate.outcome}`);
    }
  }
  fs.writeFileSync(path.join(EVAL_DIR, "rescore.json"), JSON.stringify({ check_version: CHECK_VERSION, tolerances: { size: SIZE_TOLERANCE, height: HEIGHT_TOLERANCE, top: TOP_TOLERANCE }, verdicts: out }, null, 2));
  await recordSpend(db, spend);
  if (spend.length) console.log(`style/follows $${spend.reduce((s, r) => s + (r.cost_usd ?? 0), 0).toFixed(3)}`);
}
