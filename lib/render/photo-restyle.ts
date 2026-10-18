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
//
// Whichever runs, the placement check (photo-check.ts) holds it to the photo:
// re-render once with the check's findings, then an honest failure — the
// garden pair gate's loop. No arm re-crops: the photo goes in at its own
// portrait frame (946 × 2048 after the client's compression).
// =============================================================================

import { imageSize } from "@/lib/scene-render/gate";
import { fetchSceneBytes, runRenderModel } from "@/lib/scene-render/pipeline";
import { compareImages, type Similarity } from "@/lib/render/similarity";

import { checkCostUsd, checkStyle, detectItems, judgePhotoPlacement, styleLine, type StyleVerdict, type Box, type CheckItem, type Detection, type PlacementFailure, type PlacementVerdict } from "./photo-check";
import { IMAGE_PRICE_USD, type SpendRow } from "./render-spend";

export type RestyleArm = "edit" | "edit_pro" | "kontext" | "depth" | "canny";

export const ARM_MODEL: Record<RestyleArm, string> = {
  edit: "google/nano-banana",
  edit_pro: "google/nano-banana-pro",
  kontext: "black-forest-labs/flux-kontext-pro",
  depth: "black-forest-labs/flux-depth-pro",
  canny: "black-forest-labs/flux-canny-pro",
};

/**
 * THE photo-view path, chosen by measured pass rate on the five pilot photos
 * (docs/BATHROOM_PILOT_B2.md). Set from the eval — see that report.
 */
export const PHOTO_VIEW_ARM: RestyleArm = "edit";

export interface StyleBrief {
  /** The look, in words — style only, never layout or quantities. */
  text: string;
  source: "references" | "preset";
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
    f.reason === "added" ? `there is no ${f.short} in this photo — do not add one` : f.reason === "duplicated" ? `there is exactly one ${f.short} — do not repeat it` : f.reason === "removed" ? `keep the ${f.short} — it is in the photo` : `keep the ${f.short} exactly where the photo has it`,
  );
  return `The last attempt failed the layout check: ${fix.join("; ")}.`;
}

export function restylePrompt(arm: RestyleArm, style: StyleBrief, inView: readonly { item: CheckItem; box: Box }[], absent: readonly CheckItem[] = [], failures: readonly PlacementFailure[] = []): string {
  const list = inView.map(({ item, box }) => `the ${item.short} (${whereInFrame(box)} of the frame)`).join(", ");
  const none = absent.length ? `This photo shows no ${[...new Set(absent.map((a) => a.short))].join(", no ")} — do not add any.` : "";
  const retry = retryLine(failures);
  const look = styleTextFor(style, new Set(inView.map((v) => v.item.kind)));
  if (arm === "edit" || arm === "edit_pro" || arm === "kontext") {
    return [
      "Renovate the bathroom in this photo. Keep the photograph exactly as taken: the same camera position, the same portrait framing, the same room, walls, ceiling height, door and window. Do not widen, zoom or re-frame the view.",
      list ? `Every fixture stays exactly where it is and the size it is — ${list} — one of each; do not move, mirror or resize any fixture.` : "",
      none,
      "Fixtures keep their type and how they are mounted (a floor-standing WC or bidet stays floor-standing).",
      `Change only the finishes and the design of the fixtures: ${look}`,
      "Tidy the room: no towels on the floor, mats, toiletries, bins or clutter — where clutter stood, leave plain wall and floor, never a new fixture. Photorealistic.",
      retry,
    ].filter(Boolean).join(" ");
  }
  return [
    "A photorealistic photograph of a renovated bathroom, taken on a phone held upright (portrait), wide angle, from the same spot and angle as the structure shows.",
    list ? `In the frame, exactly where the structure shows them: ${list}.` : "",
    none,
    "Floor-standing WC and bidet. The door and window as they are. No text or logos.",
    `Finishes and fixtures: ${look}`,
    "Where clutter stood, plain wall and floor — never a new fixture.",
    "Clean and tidy, no clutter. Interior photography, warm 2700 K light.",
    retry,
  ].filter(Boolean).join(" ");
}

export function restyleInput(arm: RestyleArm, prompt: string, photoUrl: string, extraImages: readonly string[] = [], seed?: number): Record<string, unknown> {
  if (arm === "edit") return { prompt, image_input: [photoUrl, ...extraImages], aspect_ratio: "match_input_image", output_format: "jpg" };
  if (arm === "kontext") return { prompt, input_image: photoUrl, aspect_ratio: "match_input_image", output_format: "jpg", safety_tolerance: 2 };
  if (arm === "edit_pro") return { prompt, image_input: [photoUrl, ...extraImages], aspect_ratio: "match_input_image", resolution: "2K", output_format: "jpg" };
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

/** Read the before photo once (kept per photo by the caller). */
export async function readBefore(photoBytes: Uint8Array, items: readonly CheckItem[]): Promise<Detection> {
  return detectItems({ mediaType: mime(photoBytes), data: b64(photoBytes) }, items, "before", imageSize(photoBytes));
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
}): Promise<RestyleResult> {
  const model = ARM_MODEL[input.arm];
  const inView = input.items
    .map((item) => ({ item, loc: input.before.items.find((l) => l.ref === item.ref) }))
    .filter((x) => x.loc?.present && x.loc.box)
    .map((x) => ({ item: x.item, box: x.loc!.box! }));
  const kinds = new Set(inView.map((v) => v.item.kind));
  const absent = input.items.filter((it) => !input.before.items.find((l) => l.ref === it.ref)?.present);
  const attempts: Attempt[] = [];
  const spend: SpendRow[] = [];
  let final: RestyleResult["final"] = null;
  for (let n = 1; n <= (input.maxAttempts ?? 2); n++) {
    const prompt = input.promptOverride?.(n) ?? restylePrompt(input.arm, input.style, inView, absent, attempts.at(-1)?.verdict?.failures ?? []);
    const at: Attempt = { attempt: n, arm: input.arm, model, prompt, image_url: null, size: null, verdict: null, after: null, similarity: null, style: null, cost_usd: 0 };
    try {
      const url = await runRenderModel(model, restyleInput(input.arm, prompt, input.photoUrl, input.extraImages ?? []));
      const bytes = await fetchSceneBytes(url);
      at.image_url = url;
      at.size = sizeOf(bytes);
      at.cost_usd += IMAGE_PRICE_USD[model] ?? 0;
      spend.push({ project_id: input.project_id, purpose: "photo_view", model, size: at.size, cost_usd: IMAGE_PRICE_USD[model] ?? null, detail: { attempt: n, arm: input.arm } });
      final = { bytes, url, size: at.size };
      at.similarity = await compareImages(Buffer.from(input.photoBytes), Buffer.from(bytes)).catch(() => null);
      const after = await detectItems({ mediaType: mime(bytes), data: b64(bytes) }, input.items, "after", imageSize(bytes), { image: { mediaType: mime(input.photoBytes), data: b64(input.photoBytes) }, located: input.before.items });
      const checkUsd = checkCostUsd(after.usage);
      at.cost_usd += checkUsd;
      spend.push({ project_id: input.project_id, purpose: "photo_check", model: after.model, size: null, cost_usd: checkUsd, detail: { attempt: n, usage: after.usage } });
      at.after = after;
      at.verdict = judgePhotoPlacement(input.items, input.before, after);
      const els = styleElementsFor(input.style, kinds);
      if (at.verdict.passed && els.length) {
        at.style = await checkStyle({ mediaType: mime(bytes), data: b64(bytes) }, els);
        const styleUsd = checkCostUsd(at.style.usage);
        at.cost_usd += styleUsd;
        spend.push({ project_id: input.project_id, purpose: "photo_check", model: after.model, size: null, cost_usd: styleUsd, detail: { attempt: n, step: "style", usage: at.style.usage } });
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
  return { outcome, line, style_line: styleLine(passed ? last.style : null, input.style.source), attempts, final, spend };
}
