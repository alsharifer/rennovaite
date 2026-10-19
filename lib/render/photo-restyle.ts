// =============================================================================
// lib/render/photo-restyle.ts — a photo view, restyled with its layout held
// (bathroom pilot B2).
//
// Three ways to restyle the client's photo, measured against each other on the
// pilot's five photos (scripts/b2-restyle-eval.ts; docs/BATHROOM_PILOT_B2.md):
//
//   edit   — the current path: google/nano-banana edits the photo itself from a
//            prompt (photo + prompt; optionally reference images after it).
//   depth  — black-forest-labs/flux-depth-pro: a NEW image whose depth map is
//            the photo's — the room's geometry is a control signal, the finishes
//            come from the prompt.
//   canny  — black-forest-labs/flux-canny-pro: the same, from the photo's edges.
//   structure — B8: flux-canny-pro from a texture-suppressed copy of the photo
//            (structureControl): the walls, door, window and fixture outlines
//            are the control; the old tile grid and frosted stripes are not —
//            canny on the raw photo kept the old finishes (style 0/5 in B2).
//
// Whichever runs, the placement check (photo-check.ts) holds it to the photo:
// re-render once with the check's findings, then an honest failure — the
// garden pair gate's loop. No arm re-crops: the photo goes in at its own
// portrait frame (946 × 2048 after the client's compression).
// =============================================================================

import { imageSize } from "@/lib/scene-render/gate";
import { fetchSceneBytes, runRenderModel } from "@/lib/scene-render/pipeline";
import { compareImages, type Similarity } from "@/lib/render/similarity";

import sharp from "sharp";

import { checkCostUsd, checkStyle, detectAgreed, judgePhotoPlacement, styleLine, type StyleVerdict, type Box, type CheckItem, type Detection, type PlacementFailure, type PlacementVerdict } from "./photo-check";
import { cropToFrame, fitMap, frameRect, geometricMap, padToAspect, toPhotoBoxes, type FrameMap } from "./frame-pin";
import { IMAGE_PRICE_USD, type SpendRow } from "./render-spend";
import { anchorPromptLine, checkFollows, followsLine } from "./room-spec";

export type RestyleArm = "edit" | "edit_pro" | "kontext" | "depth" | "canny" | "structure";

export const ARM_MODEL: Record<RestyleArm, string> = {
  edit: "google/nano-banana",
  edit_pro: "google/nano-banana-pro",
  kontext: "black-forest-labs/flux-kontext-pro",
  depth: "black-forest-labs/flux-depth-pro",
  canny: "black-forest-labs/flux-canny-pro",
  structure: "black-forest-labs/flux-canny-pro",
};

/**
 * B8: the photo with its fine texture removed — tile joints, grout, frosted
 * stripes, mould on the ceiling — so an edge-conditioned model takes the room's
 * structure from it (walls, door, window, fixture outlines) and not its finishes.
 * The texture goes at an eighth of the width, where a stripe or a joint is a
 * few pixels: a median filter erases it while a wall edge survives.
 */
export async function structureControl(photo: Uint8Array): Promise<Buffer> {
  const meta = await sharp(photo).rotate().metadata();
  const w = meta.autoOrient?.width ?? meta.width ?? 946, h = meta.autoOrient?.height ?? meta.height ?? 2048;
  const small = await sharp(photo).rotate().resize({ width: Math.round(w / 8) }).median(5).blur(0.6).toBuffer();
  return sharp(small).resize({ width: w, height: h, fit: "fill" }).jpeg({ quality: 90 }).toBuffer();
}

/**
 * THE photo-view path's default model, chosen by measured pass rate on the
 * five pilot photos (docs/BATHROOM_PILOT_B2.md, B2b): "pro" = nano-banana-pro
 * with its frame pinned (frame-pin.ts) — both checks 3/5 against nano-banana's
 * 2/5 under the size rule. "edit" (nano-banana) is the fallback:
 * PHOTO_VIEW_MODEL=edit.
 */
export type PhotoViewModel = "pro" | "edit";
export const PHOTO_VIEW_DEFAULT_MODEL = "pro" as PhotoViewModel;

/** The arm a photo view renders with: PHOTO_VIEW_MODEL ("pro" | "edit"), else the default. */
export function photoViewArm(env: Record<string, string | undefined> = process.env): RestyleArm {
  const m = env.PHOTO_VIEW_MODEL === "pro" || env.PHOTO_VIEW_MODEL === "edit" ? env.PHOTO_VIEW_MODEL : PHOTO_VIEW_DEFAULT_MODEL;
  return m === "pro" ? "edit_pro" : "edit";
}

/** @deprecated read photoViewArm() — kept for the eval scripts. */
export const PHOTO_VIEW_ARM: RestyleArm = photoViewArm({});

export interface StyleBrief {
  /** The look, in words — style only, never layout or quantities. */
  text: string;
  /** B4: "anchor" = the room design spec read from the room's locked view. */
  source: "references" | "preset" | "anchor";
  /** "Style follows your references" / "Style: <direction>". */
  line: string;
  /** The same look per element (floor, walls, vanity, mirror, …) — lets a view name only what it shows. */
  elements?: { element: string; finish: string }[];
}

/**
 * The style for ONE view: only the elements the photo shows. A brief that
 * describes a vanity and a mirror makes an image model paint them into a view
 * of the window wall (B2 eval: the trolley in P4 became a floating vanity), so
 * an element whose fixture is not in the photo is left out of its prompt.
 */
export function styleElementsFor(style: StyleBrief, kindsInView: ReadonlySet<CheckItem["kind"]>): { element: string; finish: string }[] {
  return (style.elements ?? []).filter((e) => {
    const n = e.element.toLowerCase();
    if (/vanity|basin|mirror|sink/.test(n)) return kindsInView.has("vanity");
    if (/shower|niche|glass/.test(n)) return kindsInView.has("shower");
    if (/bath/.test(n)) return kindsInView.has("bath");
    if (/wc|toilet/.test(n)) return kindsInView.has("wc");
    if (/accent|dressing|decor/.test(n)) return false;
    return true;
  });
}

export function styleTextFor(style: StyleBrief, kindsInView: ReadonlySet<CheckItem["kind"]>): string {
  if (!style.elements?.length) return style.text;
  return styleElementsFor(style, kindsInView).map((e) => `${e.element}: ${e.finish}`).join("; ") + ".";
}

/** Where a box sits, in words the image models read reliably. */
export function whereInFrame(b: Box): string {
  const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
  const h = cx < 34 ? "left" : cx > 66 ? "right" : "centre";
  const v = cy < 34 ? "top" : cy > 66 ? "bottom" : "middle";
  return v === "middle" && h === "centre" ? "in the centre" : `${v === "middle" ? "" : `${v} `}${h === "centre" ? "centre" : h}`.trim();
}

/** What the last check found, as an instruction for the next attempt. */
export function retryLine(failures: readonly PlacementFailure[]): string {
  if (failures.length === 0) return "";
  const fix = failures.map((f) =>
    f.reason === "added" ? `there is no ${f.short} in this photo — do not add one` : f.reason === "duplicated" ? `there is exactly one ${f.short} — do not repeat it` : f.reason === "removed" ? `keep the ${f.short} — it is in the photo` : f.reason === "resized" ? `keep the ${f.short} the size it is in the photo` : f.reason === "kept" ? `remove the ${f.short} completely — it is replaced` : `keep the ${f.short} exactly where the photo has it`,
  );
  return `The last attempt failed the layout check: ${fix.join("; ")}.`;
}

export function restylePrompt(arm: RestyleArm, style: StyleBrief, inViewAll: readonly { item: CheckItem; box: Box }[], absent: readonly CheckItem[] = [], failures: readonly PlacementFailure[] = [], anchor: { label: string } | null = null, notes: readonly string[] = []): string {
  // A replaced item is named only in its swap line, never as a fixture to keep.
  const inView = inViewAll.filter((v) => !v.item.gone);
  const kept = inView.filter((v) => !v.item.replaces);
  const list = kept.map(({ item, box }) => `the ${item.short} (${whereInFrame(box)} of the frame)`).join(", ");
  // A replacement: what stands there today goes, the new item takes its spot.
  const swaps = inView.filter((v) => v.item.replaces).map(({ item, box }) => `Replace the ${item.replaces!.short} (${whereInFrame(box)} of the frame) with ${item.description} standing in the same spot; no ${item.replaces!.short} anywhere.`);
  const none = absent.length ? `This photo shows no ${[...new Set(absent.map((a) => a.short))].join(", no ")} — do not add any.` : "";
  const retry = retryLine(failures);
  const look = styleTextFor(style, new Set(inView.map((v) => v.item.kind)));
  if (arm === "edit" || arm === "edit_pro" || arm === "kontext") {
    return [
      "Renovate the bathroom in this photo. Keep the photograph exactly as taken: the same camera position, the same portrait framing, the same room, walls, ceiling height, door and window. Do not widen, zoom or re-frame the view.",
      arm === "edit_pro" ? "The narrow strips at the left and right edges are a mirrored copy of the photo's own edges, added only to fill the frame: renovate them to match, and keep the room itself exactly where the photo has it." : "",
      list ? `Every fixture stays exactly where it is and the size it is — ${list} — one of each; do not move, mirror or resize any fixture.` : "",
      ...swaps,
      none,
      ...notes,
      `${swaps.length ? "Every other fixture keeps" : "Fixtures keep"} their type and how they are mounted (a floor-standing WC or bidet stays floor-standing).`,
      // B4: the room's locked view comes as the second image; its spec is the look.
      anchor ? anchorPromptLine(anchor) : "",
      `Change only the finishes and the design of the fixtures: ${look}`,
      "Tidy the room: no towels on the floor, mats, toiletries, bins or clutter — where clutter stood, leave plain wall and floor, never a new fixture. Photorealistic.",
      retry,
    ].filter(Boolean).join(" ");
  }
  return [
    "A photorealistic photograph of a renovated bathroom, taken on a phone held upright (portrait), wide angle, from the same spot and angle as the structure shows.",
    arm === "structure" ? "Every surface gets a NEW finish: the structure gives only the room's shape and where things stand — none of its old tiles, grout lines, stripes or stains." : "",
    list ? `In the frame, exactly where the structure shows them: ${list}.` : "",
    ...swaps,
    none,
    ...notes,
    `${kept.some((v) => v.item.kind === "bidet") ? "Floor-standing WC and bidet." : "Floor-standing WC."} The door and window as they are. No text or logos.`,
    `Finishes and fixtures: ${look}`,
    "Where clutter stood, plain wall and floor — never a new fixture.",
    "Clean and tidy, no clutter. Interior photography, warm 2700 K light.",
    retry,
  ].filter(Boolean).join(" ");
}

/**
 * B8: what the model is told about FINISH-ONLY reference images (close-ups of a
 * tile, a vanity front, a mirror, a tap) — the hypothesis being that pro copies
 * layout from whole-room references, and a close-up has no layout to copy.
 */
export const FINISH_REFS_LINE = "The images after the photo are close-ups of finishes only — a tile, a vanity front, a mirror, a tap and mixer. Copy their materials, colours and surface finish onto this room's own fixtures and walls; never copy their size, shape, proportions or arrangement.";

export function restyleInput(arm: RestyleArm, prompt: string, photoUrl: string, extraImages: readonly string[] = [], seed?: number): Record<string, unknown> {
  if (arm === "edit") return { prompt, image_input: [photoUrl, ...extraImages], aspect_ratio: "match_input_image", output_format: "jpg" };
  if (arm === "kontext") return { prompt, input_image: photoUrl, aspect_ratio: "match_input_image", output_format: "jpg", safety_tolerance: 2 };
  // B2b: the photo arrives padded to 9 : 16 (frame-pin.ts) — the frame is pinned, not matched.
  if (arm === "edit_pro") return { prompt, image_input: [photoUrl, ...extraImages], aspect_ratio: "9:16", resolution: "2K", output_format: "jpg" };
  return { prompt, control_image: photoUrl, output_format: "jpg", safety_tolerance: 2, ...(seed != null ? { seed } : {}) };
}

export interface Attempt {
  attempt: number;
  arm: RestyleArm;
  model: string;
  prompt: string;
  image_url: string | null;
  size: string | null;
  verdict: PlacementVerdict | null;
  after: Detection | null;
  similarity: Similarity | null;
  /** The style check (only when the brief carries elements). */
  style: StyleVerdict | null;
  /** B2b: how a frame-pinned output was cut back to the photo's frame. */
  frame?: { map: FrameMap; rect: { left: number; top: number; width: number; height: number }; output: string };
  error?: string;
  cost_usd: number;
}

export interface RestyleResult {
  outcome: "passed" | "failed" | "error";
  /** The check line shown on the view. */
  line: string;
  /** "Style follows your references ✓" — or which elements do not yet. */
  style_line: string;
  attempts: Attempt[];
  /** The passed image, or the last attempt's (to show what differs). */
  final: { bytes: Uint8Array; url: string; size: string | null } | null;
  spend: SpendRow[];
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const mime = (bytes: Uint8Array): "image/jpeg" | "image/png" => (bytes[0] === 0x89 ? "image/png" : "image/jpeg");
const sizeOf = (bytes: Uint8Array) => {
  const s = imageSize(bytes);
  return s ? `${s.width}x${s.height}` : null;
};

/** Read the before photo once (kept per photo by the caller) — twice, B8: the agreed reading. */
export async function readBefore(photoBytes: Uint8Array, items: readonly CheckItem[]): Promise<Detection> {
  return detectAgreed({ mediaType: mime(photoBytes), data: b64(photoBytes) }, items, "before", imageSize(photoBytes));
}

/**
 * Restyle one photo with its layout held: render → check → (re-render once with
 * the findings → check) → passed, or an honest failure. `project_id` is only for
 * the spend rows the caller records.
 */
export async function restyleWithCheck(input: {
  project_id: string;
  arm: RestyleArm;
  photoUrl: string;
  photoBytes: Uint8Array;
  items: readonly CheckItem[];
  before: Detection;
  style: StyleBrief;
  extraImages?: readonly string[];
  /** Replace the generated prompt (the deliberate-failure demonstration only). */
  promptOverride?: (attempt: number) => string | null;
  maxAttempts?: number;
  /** B4: the room's anchor — its image goes to the model after the photo (the caller passes it in extraImages), and the follows check replaces the style check. */
  anchor?: { label: string; bytes: Uint8Array } | null;
  /** Lines from the plan the prompt must carry (where a fitting goes in this view). */
  notes?: readonly string[];
  /** Items the DESIGN changes the size of (a fixed panel for a hinged screen): their place is held, not their size. */
  resizable?: ReadonlySet<string>;
  /**
   * B8: an attempt 1 that already exists (a render made earlier with the same
   * arm, already in the photo's frame) — judged by the current check instead
   * of rendered again; attempt 2, if needed, is a new render.
   */
  firstImage?: { bytes: Uint8Array; url: string; prompt: string };
  /** B8: the extra images are finish close-ups, not the anchor — the prompt says so, the follows check still holds the render to the anchor. */
  referencesLine?: string;
}): Promise<RestyleResult> {
  const model = ARM_MODEL[input.arm];
  const inView = input.items
    .map((item) => ({ item, loc: input.before.items.find((l) => l.ref === item.ref) }))
    .filter((x) => x.loc?.present && x.loc.box)
    .map((x) => ({ item: x.item, box: x.loc!.box! }));
  const kinds = new Set(inView.filter((v) => !v.item.gone).map((v) => v.item.kind));
  const absent = input.items.filter((it) => !input.before.items.find((l) => l.ref === it.ref)?.present);
  const attempts: Attempt[] = [];
  const spend: SpendRow[] = [];
  let final: RestyleResult["final"] = null;
  const pinned = input.arm === "edit_pro" ? await padToAspect(input.photoBytes) : null;
  const control = input.arm === "structure" ? `data:image/jpeg;base64,${(await structureControl(input.photoBytes)).toString("base64")}` : null;
  const photoSize = imageSize(input.photoBytes);
  for (let n = 1; n <= (input.maxAttempts ?? 2); n++) {
    const given = n === 1 ? input.firstImage : undefined;
    const prompt = given?.prompt ?? input.promptOverride?.(n) ?? restylePrompt(input.arm, input.style, inView, absent, attempts.at(-1)?.verdict?.failures ?? [], input.anchor && !input.referencesLine ? { label: input.anchor.label } : null, input.referencesLine ? [...(input.notes ?? []), input.referencesLine] : input.notes ?? []);
    const at: Attempt = { attempt: n, arm: input.arm, model, prompt, image_url: null, size: null, verdict: null, after: null, similarity: null, style: null, cost_usd: 0 };
    try {
      // B2b: nano-banana-pro gets the photo padded to its 9 : 16 frame, and its
      // output is cut back to the photo's frame before anything is checked.
      const source = control ?? (pinned ? `data:image/jpeg;base64,${pinned.bytes.toString("base64")}` : input.photoUrl);
      let raw: Uint8Array;
      let url: string;
      if (given) {
        raw = given.bytes;
        url = given.url;
      } else {
        url = await runRenderModel(model, restyleInput(input.arm, prompt, source, input.extraImages ?? []));
        raw = await fetchSceneBytes(url);
        at.cost_usd += IMAGE_PRICE_USD[model] ?? 0;
        spend.push({ project_id: input.project_id, purpose: "photo_view", model, size: sizeOf(raw), cost_usd: IMAGE_PRICE_USD[model] ?? null, detail: { attempt: n, arm: input.arm } });
      }
      at.image_url = url;
      const reference = { image: { mediaType: mime(input.photoBytes), data: b64(input.photoBytes) }, located: input.before.items };
      const read = await detectAgreed({ mediaType: mime(raw), data: b64(raw) }, input.items, "after", imageSize(raw), reference);
      const checkUsd = checkCostUsd(read.usage);
      at.cost_usd += checkUsd;
      spend.push({ project_id: input.project_id, purpose: "photo_check", model: read.model, size: null, cost_usd: checkUsd, detail: { attempt: n, usage: read.usage } });
      let bytes: Uint8Array = raw;
      let after = read;
      if (pinned && !given) {
        const out = imageSize(raw)!;
        const map = fitMap(input.before.items, read.items, photoSize!, out, geometricMap(pinned.plan, out));
        const rect = frameRect(map, photoSize!, out);
        bytes = new Uint8Array(await cropToFrame(raw, rect));
        after = { ...read, items: toPhotoBoxes(read.items, map, photoSize!, out) };
        at.frame = { map, rect, output: `${out.width}x${out.height}` };
      }
      at.size = sizeOf(bytes);
      final = { bytes, url, size: at.size };
      at.similarity = await compareImages(Buffer.from(input.photoBytes), Buffer.from(bytes)).catch(() => null);
      at.after = after;
      at.verdict = judgePhotoPlacement(input.items, input.before, after, { resizable: input.resizable });
      const els = styleElementsFor(input.style, kinds);
      if (at.verdict.passed && els.length) {
        // B4: an anchored view is judged beside the anchor (the same finishes?), not the references.
        at.style = input.anchor
          ? await checkFollows({ mediaType: mime(bytes), data: b64(bytes) }, { mediaType: mime(input.anchor.bytes), data: b64(input.anchor.bytes) }, els)
          : await checkStyle({ mediaType: mime(bytes), data: b64(bytes) }, els, { mediaType: mime(input.photoBytes), data: b64(input.photoBytes) });
        const styleUsd = checkCostUsd(at.style.usage);
        at.cost_usd += styleUsd;
        spend.push({ project_id: input.project_id, purpose: "photo_check", model: after.model, size: null, cost_usd: styleUsd, detail: { attempt: n, step: input.anchor ? "follows" : "style", usage: at.style.usage } });
      }
    } catch (e) {
      at.error = e instanceof Error ? e.message.slice(0, 300) : String(e);
    }
    attempts.push(at);
    if (at.verdict?.passed) break;
    if (at.error && /402|insufficient credit/i.test(at.error)) break;
  }
  const last = attempts.at(-1)!;
  const passed = !!last.verdict?.passed;
  const outcome: RestyleResult["outcome"] = passed ? "passed" : attempts.every((a) => !a.verdict) ? "error" : "failed";
  const failedVerdict = [...attempts].reverse().find((a) => a.verdict)?.verdict;
  const line = passed ? last.verdict!.line : outcome === "error" ? `The render could not be checked — ${last.error ?? "unknown error"}.` : failedVerdict!.line;
  const styled = passed ? last.style : null;
  const style_line = input.anchor
    ? styled
      ? followsLine(styled.passed ? "follows" : "differs", input.anchor.label, styled.elements.filter((e) => e.verdict !== "yes").map((e) => e.element))
      : "Finishes not checked — the layout check comes first"
    : styleLine(styled, input.style.source === "anchor" ? "references" : input.style.source);
  return { outcome, line, style_line, attempts, final, spend };
}
