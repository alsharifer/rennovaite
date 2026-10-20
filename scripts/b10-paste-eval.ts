// =============================================================================
// scripts/b10-paste-eval.ts — bathroom pilot B10: which model edits inside the mask?
//
//   node --env-file=.env.local --experimental-transform-types --import ./scripts/_alias-hook.mjs \
//     scripts/b10-paste-eval.ts [--samples=2]
//
// Live (20 Oct), "Ask for a change" on one item inpainted the item's box with
// flux-fill-pro: the layout held, but the fill redrew the parts of the item the
// request did not name (asked for a white ceramic top, the oak vanity came back
// black, twice). One trial gave the request to google/nano-banana — which sees the
// whole room — and kept only its pixels inside the box: white top, oak kept.
//
// Two arms on the same one-item requests, through the route's own target logic
// (maskedChangeTarget over the plan's current items and the parent's carried
// reading), the same mask, the same composite (compositeInside):
//   fill  — flux-fill-pro inside the mask (maskedChangePrompt);
//   paste — nano-banana on the whole image, pasted back inside the mask (pasteChangePrompt).
// Each output is scored for:
//   done   — describeChange's "was the request carried out" (yes / partly / no);
//   kept   — the parts of the item (and its region) the request did NOT name kept
//            their colour, material, size and design (a reading of the region's
//            crop before and after, below);
//   layout — the placement check against the parent (judgePhotoPlacement).
//
// HARD CAP US$5.00 for the whole session (images AND readings), enforced in code
// before every paid call (SpendCap, session_ref "b10-paste"); never raised.
// Writes no render rows — only render_spend rows on dev, and images + results to
// data/Bathroom Pilot/b10-eval/paste-eval/ (gitignored: client photos).
// =============================================================================

import fs from "node:fs";
import path from "node:path";

import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";

import { carryLocated, CHECK_MODEL, checkCostUsd, checkItemsFor, detectAgreed, itemsNamedBy, judgePhotoPlacement, type Box, type CheckItem, type Located } from "@/lib/render/photo-check";
import { maskedChange, maskPng, MASKED_ARM_MODEL, type MaskedArm } from "@/lib/render/masked-edit";
import { maskedChangePrompt, maskedChangeTarget, maskedVerdict, pasteChangePrompt } from "@/lib/render/masked-change";
import { describeChange } from "@/lib/render/room-spec";
import { loadMiniPlans } from "@/lib/render/photo-views-load";
import { IMAGE_PRICE_USD, type SpendRow } from "@/lib/render/render-spend";
import { SpendCap, SpendCapReached, WORST_CASE_USD } from "@/lib/render/spend-cap";
import { compareImages, isUnchangedEdit } from "@/lib/render/similarity";
import { imageSize } from "@/lib/scene-render/gate";
import type { PhotoViewGate } from "@/lib/render/photo-view-run";

import { resolveTarget } from "./_target-guard.mjs";
import { createClient } from "@supabase/supabase-js";

const P = "a2661f34-9d96-4020-a755-40359440c302";
const ROOM = "4ca01776-3251-4436-aaa0-e2e74257341c";
const CAP_USD = 5;
const OUT = "data/Bathroom Pilot/b10-eval/paste-eval";
fs.mkdirSync(OUT, { recursive: true });
const RESULTS = path.join(OUT, "results.json");
const results: { samples: Record<string, Sample>; stopped_at_cap?: string } = fs.existsSync(RESULTS) ? JSON.parse(fs.readFileSync(RESULTS, "utf8")) : { samples: {} };
const save = () => fs.writeFileSync(RESULTS, JSON.stringify(results, null, 1));
const SAMPLES = Number(process.argv.find((a) => a.startsWith("--samples="))?.split("=")[1] ?? 2);

interface Sample {
  case: string;
  arm: MaskedArm;
  n: number;
  item: string;
  box: Box;
  unchanged: boolean;
  layout: boolean;
  layout_line: string;
  done: "yes" | "partly" | "no";
  summary: string;
  changed: string[];
  kept: boolean;
  kept_parts: { part: string; kept: boolean; change: string }[];
  route_keeps: boolean;
  why?: string;
  cost_usd: number;
}

// --- the cases: Photo 3's B2-era version and Photo 2's v4 (the comments' version) ---
const PHOTO3 = "c1e7b0ef-a40f-4c8f-a871-e423e29528fa";
const V4 = "247a88f0-ea85-4ef0-bb07-6f0c0e312dc5";
const CASES: { key: string; render: string; request: string }[] = [
  { key: "p3-ceramic_top", render: PHOTO3, request: "Change the vanity counter to a white ceramic top with an integrated basin" },
  { key: "p3-vanity_white", render: PHOTO3, request: "Make the vanity drawers matte white" },
  { key: "p3-fixed_panel", render: PHOTO3, request: "Make the shower glass one fixed frameless clear glass panel — no hinged door, no second panel" },
  { key: "p2-cabinet", render: V4, request: "Replace the bidet with a white floor-standing storage cabinet, about 1.2 m tall, in the same spot" },
  { key: "p2-fixed_panel", render: V4, request: "Make the shower glass one fixed frameless clear glass panel — no hinged door, no second panel" },
  { key: "p2-ceramic_top", render: V4, request: "Change the vanity counter to a white ceramic top with an integrated basin" },
];
// Photo 2's fourth comment (the hand spray off the door wall) names no check item: the route sends it
// straight to today's edit, so it is not a masked case.

const { url, key } = resolveTarget({ script: "b10-paste-eval", writes: true });
const db = createClient(url, key, { auth: { persistSession: false } });
const cap = new SpendCap(db as never, P, "b10-paste", CAP_USD);
const mime = (b: Uint8Array): "image/jpeg" | "image/png" => (b[0] === 0x89 ? "image/png" : "image/jpeg");
const img = (b: Uint8Array) => ({ mediaType: mime(b), data: Buffer.from(b).toString("base64") });
const row = (model: string, usd: number, step: string): SpendRow => ({ project_id: P, purpose: "eval", model, cost_usd: usd, detail: { step } });

// --- "were the parts the request did not name kept?" — the region's crop, before and after ---
const KEPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["parts"],
  properties: {
    parts: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["part", "kept", "change"], properties: { part: { type: "string" }, kept: { type: "boolean" }, change: { type: "string" } } },
    },
  },
} as const;
async function crop(bytes: Uint8Array, b: Box, pad = 4): Promise<Buffer> {
  const m = await sharp(bytes).metadata();
  const W = m.width!, H = m.height!;
  const x0 = Math.max(0, Math.floor(((b[0] - pad) / 100) * W)), y0 = Math.max(0, Math.floor(((b[1] - pad) / 100) * H));
  const x1 = Math.min(W, Math.ceil(((b[2] + pad) / 100) * W)), y1 = Math.min(H, Math.ceil(((b[3] + pad) / 100) * H));
  return sharp(bytes).extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }).resize({ width: 1000, height: 1000, fit: "inside" }).jpeg({ quality: 90 }).toBuffer();
}
async function keptReading(before: Uint8Array, after: Uint8Array, box: Box, item: CheckItem, request: string) {
  const [a, b] = await Promise.all([crop(before, box), crop(after, box)]);
  const res = await new Anthropic().messages.create({
    model: CHECK_MODEL,
    max_tokens: 3000,
    output_config: { effort: "low", format: { type: "json_schema", schema: KEPT_SCHEMA as unknown as Record<string, unknown> } },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: `IMAGE 1 — the region of a bathroom render around the ${item.short}, before an edit:` },
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: a.toString("base64") } },
          { type: "text", text: "IMAGE 2 — the same region after the edit:" },
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b.toString("base64") } },
          { type: "text", text: `The client asked for: "${request}". List every visible part of the ${item.short} and of the region around it that this request does NOT name or require to change (for a vanity, e.g. the cabinet body and its colour, drawers, handles, the mirror, the wall tiles; for shower glass, e.g. the tiles, rain head, valve, tray). For each: was it kept in IMAGE 2 with the same colour, material, size and design (kept: true), or did it change (kept: false, and say how in at most 10 words)? A part the request makes disappear or necessarily covers is not listed. Judge only what is visible.` },
        ],
      },
    ],
  });
  const text = res.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  const j = JSON.parse(text) as { parts: { part: string; kept: boolean; change: string }[] };
  return { parts: j.parts, usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens } };
}

// --- the parents, prepared exactly as the route prepares them ---
const { data: plan } = await db.from("plans").select("id, total_area_m2, source, plot_width_m").eq("project_id", P).order("created_at", { ascending: false }).limit(1).single();
const mini = (await loadMiniPlans(db as never, P, plan!, [ROOM]))[ROOM]!;
const items = checkItemsFor(mini);
const parents: Record<string, { bytes: Uint8Array; carried: Located[]; gate: PhotoViewGate }> = {};
for (const id of new Set(CASES.map((c) => c.render))) {
  const { data: r } = await db.from("renders").select("image_url, gate").eq("id", id).single<{ image_url: string; gate: PhotoViewGate }>();
  const bytes = new Uint8Array(await (await fetch(r!.image_url)).arrayBuffer());
  const parentRead = r!.gate.attempts.at(-1)!.after!;
  parents[id] = { bytes, gate: r!.gate, carried: carryLocated(r!.gate.items, parentRead, items) };
  fs.writeFileSync(path.join(OUT, `parent-${id.slice(0, 8)}.jpg`), bytes);
}
const cab = items.find((i) => i.kind === "cabinet" && !i.gone);

try {
  for (let n = 1; n <= SAMPLES; n++) {
    for (const c of CASES) {
      const parent = parents[c.render]!;
      const target = maskedChangeTarget(c.request, items, parent.carried);
      if (!target) { console.log(`${c.key}: no masked target — the route would send it to today's edit; skipped`); continue; }
      for (const arm of ["fill", "paste"] as MaskedArm[]) {
        const id = `${c.key}:${arm}:${n}`;
        if (results.samples[id]) continue;
        let cost = 0;
        const size = imageSize(parent.bytes)!;
        const prompt = arm === "fill" ? maskedChangePrompt(target.item, c.request) : pasteChangePrompt(target.item, c.request);
        const model = MASKED_ARM_MODEL[arm];
        const out = await cap.run(`${arm} edit ${id}`, WORST_CASE_USD[model as keyof typeof WORST_CASE_USD] as number, async () => {
          const r = await maskedChange(arm, parent.bytes, await maskPng(size, [target.box]), prompt);
          return { value: new Uint8Array(r.bytes), spend: [row(r.model, IMAGE_PRICE_USD[r.model] ?? 0.05, `b10p_${arm}:${id}`)] };
        });
        cost += IMAGE_PRICE_USD[model] ?? 0.05;
        fs.writeFileSync(path.join(OUT, `${c.key}-${arm}-${n}.jpg`), out);
        const sim = await compareImages(Buffer.from(parent.bytes), Buffer.from(out)).catch(() => null);
        const read = await cap.run(`reading ${id}`, WORST_CASE_USD.reading, async () => {
          const d = await detectAgreed(img(out), items, "after", size, { image: img(parent.bytes), located: parent.carried });
          const usd = checkCostUsd(d.usage);
          cost += usd;
          return { value: d, spend: [row(d.model, usd, `b10p_reading:${id}`)] };
        });
        // Photo 2's other comments are judged without the cabinet that replaces the bidet (v4 still has the
        // bidet), as B10's replay did — a comment is not failed for another one.
        const judged = c.render === V4 && target.item.kind !== "cabinet" ? items.filter((it) => it.ref !== cab?.ref && !it.gone) : items;
        const verdict = judgePhotoPlacement(judged, { items: parent.carried }, read, { resizable: itemsNamedBy(c.request, items) });
        const what = await cap.run(`describe ${id}`, WORST_CASE_USD.check, async () => {
          const d = await describeChange(img(parent.bytes), img(out), c.request);
          const usd = checkCostUsd(d.usage);
          cost += usd;
          return { value: d, spend: [row(CHECK_MODEL, usd, `b10p_describe:${id}`)] };
        });
        const kept = await cap.run(`kept-parts ${id}`, WORST_CASE_USD.check, async () => {
          const k = await keptReading(parent.bytes, out, target.box, target.item, c.request);
          const usd = checkCostUsd(k.usage);
          cost += usd;
          return { value: k.parts, spend: [row(CHECK_MODEL, usd, `b10p_kept:${id}`)] };
        });
        const v = maskedVerdict({ unchanged: !!sim && isUnchangedEdit(sim), layout: verdict, requestDone: what.request_done, summary: what.summary });
        const s: Sample = { case: c.key, arm, n, item: target.item.short, box: target.box, unchanged: !!sim && isUnchangedEdit(sim), layout: verdict.passed, layout_line: verdict.line, done: what.request_done, summary: what.summary, changed: what.changed, kept: kept.every((p) => p.kept), kept_parts: kept, route_keeps: v.keep, ...(v.keep ? {} : { why: v.why }), cost_usd: Math.round(cost * 10000) / 10000 };
        results.samples[id] = s;
        save();
        console.log(`${id}: done ${s.done} · kept ${s.kept ? "✓" : `✗ (${kept.filter((p) => !p.kept).map((p) => `${p.part}: ${p.change}`).join("; ")})`} · layout ${s.layout ? "✓" : s.layout_line} · ${what.summary}`);
      }
    }
  }
} catch (e) {
  if (e instanceof SpendCapReached) {
    results.stopped_at_cap = e.message;
    save();
    console.log(`STOPPED AT THE CAP: ${e.message}`);
  } else throw e;
}

// --- the tally ---
for (const arm of ["fill", "paste"] as MaskedArm[]) {
  const ss = Object.values(results.samples).filter((s) => s.arm === arm);
  const c = (f: (s: Sample) => boolean) => ss.filter(f).length;
  console.log(`${arm.padEnd(5)}  n=${ss.length} · done yes ${c((s) => s.done === "yes")} / partly ${c((s) => s.done === "partly")} / no ${c((s) => s.done === "no")} · unnamed kept ${c((s) => s.kept)} · layout ${c((s) => s.layout)} · all three (done ≠ no) ${c((s) => s.done !== "no" && s.kept && s.layout)} · unchanged ${c((s) => s.unchanged)}`);
}
console.log(`session spend: US$${(await cap.spent()).toFixed(2)} of US$${CAP_USD.toFixed(2)}`);
