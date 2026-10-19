// =============================================================================
// lib/render/photo-check.ts — "Layout follows your photo" (bathroom pilot B2).
//
// A photo view is a restyle of the client's own photo, and the client keeps the
// layout (18 Oct). So a restyle may change every finish but must leave every
// fixture, the door and the window where the photo has them. B0 found the
// interior restyle had no placement check of any kind; this is it — a PAIR
// check against the before photo, the garden pair gate's shape (deterministic
// pass rule, the model only observes; re-render once, then an honest failure).
//
//   1. The candidates are the room's own doors, windows and sanitary fixtures
//      from the plan (`checkItemsFor`).
//   2. A vision model locates each in the BEFORE photo — present or not, a box
//      in % of the frame, how many copies (`detectItems`); kept per photo
//      (room_photos.before_detection), so every restyle of it is held to the
//      same reading.
//   3. The same reading of the AFTER image.
//   4. `judgePhotoPlacement` (pure; B2b adds size): every item the before photo shows must be
//      in the after image, in the same place (its centre within max(12% of the
//      frame, 60% of its own extent) — the G5d tolerance), not duplicated, not
//      swapped left/right with another; and no fixture the photo does not have
//      may appear. A failure reads "the render moved the WC".
//
// The camera placed on the plan (062) says which items the photo SHOULD show
// (`expectedInView`) — reported beside the reading, never used to pass a render.
// =============================================================================

import Anthropic from "@anthropic-ai/sdk";

import type { PhotoCamera } from "./photo-views";

export const CHECK_MODEL = "claude-opus-5-5";
/** Bumped when what the check asks changes — a kept before-reading of an older version is read again. */
export const CHECK_VERSION = "c3";
/** USD per million tokens (Anthropic first-party, 6 Oct 2026). */
export const CHECK_PRICE = { input: 4, output: 20 } as const;

export type Box = [number, number, number, number];

export interface CheckItem {
  /** "D1", "W1", "F1"… — stable within one check. */
  ref: string;
  /** The plan row it stands for (opening or fixture id). */
  plan_id: string;
  kind: "door" | "window" | "wc" | "bidet" | "vanity" | "shower" | "bath" | "cabinet";
  /** What the reader of a failure calls it: "WC", "vanity", "shower glass". */
  short: string;
  /** What the vision model is asked to find. */
  description: string;
  /**
   * A fixture that REPLACES another in the same spot (spec.replaces — a cabinet
   * where the bidet was): the before photo is read for what stands there today,
   * the render for the new item; same place, any size.
   */
  replaces?: { short: string; description: string };
  /**
   * The item a replacement removes (the bidet the cabinet replaces): read in
   * both images, and the render FAILS if it is still there. Never a fixture to
   * keep, never "added".
   */
  gone?: true;
  /**
   * B8: where the item's top should reach, as a share of floor-to-ceiling height —
   * set only when the plan STATES its height (spec.height_mm) and the room's
   * ceiling is known. A replacement's size is free, its height is not (a
   * 1.2 m cabinet drawn 2 m tall passed B7's check).
   */
  top_share?: number;
  /** The stated height, mm (for the failure line). */
  height_mm?: number;
}

const FIXTURE_KIND: Record<string, Pick<CheckItem, "kind" | "short" | "description">> = {
  wc_point: { kind: "wc", short: "WC", description: "the WC / toilet (the bowl and its cistern)" },
  bidet_point: { kind: "bidet", short: "bidet", description: "the bidet — a low floor-standing bowl, usually beside the WC" },
  basin_point: { kind: "vanity", short: "vanity", description: "the vanity / basin counter with its washbasin (the counter, not the mirror above it)" },
  shower_mixer: { kind: "shower", short: "shower glass", description: "the shower enclosure — its glass screen or panels (clear or frosted, framed or frameless) and the tray / floor area inside them" },
  bath_point: { kind: "bath", short: "bath", description: "the bath tub" },
  storage_cabinet: { kind: "cabinet", short: "storage cabinet", description: "a white floor-standing storage cabinet" },
};

export interface PlanLite {
  /** The room's ceiling height, m (B1's stored value) — with a stated fixture height it gives the item's expected top. */
  ceiling_h_m?: number | null;
  openings: { id: string; kind: string; position: [number, number]; width_mm: number }[];
  fixtures: { id: string; type: string; position: [number, number]; spec: Record<string, unknown> | null }[];
}

/** The room's doors, windows and sanitary fixtures as check items. */
export function checkItemsFor(plan: PlanLite): CheckItem[] {
  const out: CheckItem[] = [];
  let d = 0, w = 0, f = 0;
  for (const o of plan.openings) {
    if (o.kind === "door") out.push({ ref: `D${++d}`, plan_id: o.id, kind: "door", short: "door", description: "the room's entrance door — a solid door leaf in its frame, set in a wall (NOT the shower's glass door, not a cabinet door, not a plain vertical edge)" });
    else if (o.kind === "window") out.push({ ref: `W${++w}`, plan_id: o.id, kind: "window", short: "window", description: "a window to the outside — glazing with a frame in an outside wall (NOT a mirror, a niche, a light panel or shower glass)" });
  }
  for (const fx of plan.fixtures) {
    const k = FIXTURE_KIND[fx.type];
    const was = typeof fx.spec?.replaces === "string" ? FIXTURE_KIND[fx.spec.replaces] : undefined;
    // A stated height reaches the words the model reads (a cabinet ~1.2 m tall, not a low unit).
    const hmm = typeof fx.spec?.height_mm === "number" ? Number(fx.spec.height_mm) : null;
    const tall = hmm ? (fx.type === "storage_cabinet" ? `, about ${(hmm / 1000).toFixed(1)} m tall — well above the WC cistern` : `, about ${(hmm / 1000).toFixed(2)} m to its top`) : "";
    const top = hmm && plan.ceiling_h_m && plan.ceiling_h_m > 0 ? Math.round((hmm / 1000 / plan.ceiling_h_m) * 100) / 100 : null;
    if (k) out.push({ ref: `F${++f}`, plan_id: fx.id, ...k, description: k.description + tall, ...(was ? { replaces: { short: was.short, description: was.description } } : {}), ...(top ? { top_share: top, height_mm: hmm! } : {}) });
  }
  // What each replacement removes, so a render that keeps it fails.
  let x = 0;
  for (const it of [...out]) {
    if (!it.replaces) continue;
    const was = Object.values(FIXTURE_KIND).find((k) => k.short === it.replaces!.short)!;
    out.push({ ref: `X${++x}`, plan_id: `${it.plan_id}:replaced`, ...was, gone: true });
  }
  return out;
}

/**
 * Carry a reading made with one item list over to the plan's current list: an
 * item on the same plan row keeps its box under its new ref; a replacement
 * (a cabinet where the bidet was) takes the box of what it replaces. Items with
 * nothing to carry are absent. Pure.
 */
export function carryLocated(prevItems: readonly CheckItem[], prevLocated: readonly Located[], nextItems: readonly CheckItem[]): Located[] {
  const at = (it: CheckItem | undefined) => (it ? prevLocated.find((l) => l.ref === it.ref) : undefined);
  return nextItems.map((it) => {
    const same = at(prevItems.find((p) => p.plan_id === it.plan_id));
    const was = it.replaces && !same ? at(prevItems.find((p) => p.short === it.replaces!.short && !p.gone)) : it.gone && !same ? at(prevItems.find((p) => p.short === it.short && !p.gone)) : undefined;
    const l = same ?? was;
    return l ? { ...l, ref: it.ref } : { ref: it.ref, present: false, box: null, instances: 0 };
  });
}

/** The items a change request names — their size may change, never their place. */
export function itemsNamedBy(request: string, items: readonly CheckItem[]): Set<string> {
  const words: Partial<Record<CheckItem["kind"], RegExp>> = {
    shower: /\b(glass|screen|panel|enclosure)\b/i,
    vanity: /\b(vanity|counter|basin|worktop)\b/i,
    cabinet: /\bcabinet\b/i,
    wc: /\b(wc|toilet)\b/i,
    bidet: /\bbidet\b/i,
    bath: /\b(bath|tub)\b/i,
  };
  return new Set(items.filter((it) => !it.gone && words[it.kind]?.test(request)).map((it) => it.ref));
}

/** The phone's horizontal field of view, portrait, ultrawide-ish (the sheet: "~24 mm-equivalent ultrawide feel"). */
export const PHONE_HFOV_DEG = 80;

/**
 * Which items the placed camera should see: any corner of a fixture's footprint,
 * or an opening's centre, within the field of view. Plan-space; a hint for the
 * report, never a pass rule.
 */
export function expectedInView(camera: PhotoCamera, plan: PlanLite, items: CheckItem[], mPerU: number | null, hfov = PHONE_HFOV_DEG): Set<string> {
  const seen = new Set<string>();
  const sees = (p: [number, number]) => {
    const h = (Math.atan2(p[0] - camera.position[0], -(p[1] - camera.position[1])) * 180) / Math.PI;
    const off = Math.abs((((h - camera.heading_deg) % 360) + 540) % 360 - 180);
    return off <= hfov / 2;
  };
  for (const it of items) {
    const o = plan.openings.find((x) => x.id === it.plan_id);
    if (o && sees(o.position)) seen.add(it.ref);
    const fx = plan.fixtures.find((x) => x.id === it.plan_id);
    if (!fx) continue;
    const w = Number(fx.spec?.width_mm ?? 600) / 2000, dpt = Number(fx.spec?.depth_mm ?? 600) / 2000;
    const k = mPerU ?? 1;
    const pts: [number, number][] = [fx.position, ...[[-w, -dpt], [w, -dpt], [w, dpt], [-w, dpt]].map(([a, b]) => [fx.position[0] + a! / k, fx.position[1] + b! / k] as [number, number])];
    if (pts.some(sees)) seen.add(it.ref);
  }
  return seen;
}

// --- the reading ---------------------------------------------------------------

export interface Located {
  ref: string;
  present: boolean;
  /** % of the frame, [x0, y0, x1, y1]; null when not present. */
  box: Box | null;
  instances: number;
  /** B8: how high its top reaches, as a share of the floor-to-ceiling height of the wall behind it (0–1); null when not read. */
  top?: number | null;
  note?: string;
}

export interface Detection {
  items: Located[];
  model: string;
  at: string;
  usage?: { input_tokens: number; output_tokens: number };
  /** B8: the separate readings the agreed one was made from (two, or three when the first two disagreed). */
  reads?: Located[][];
}

const centre = (b: Box): [number, number] => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

export interface PlacementFailure {
  ref: string;
  short: string;
  reason: "removed" | "moved" | "resized" | "duplicated" | "added" | "swapped" | "kept";
  message: string;
}

export interface PlacementVerdict {
  passed: boolean;
  /** Items the before photo shows — what the render is held to. */
  checked: string[];
  failures: PlacementFailure[];
  /** "Layout follows your photo ✓" or "The render moved the WC — see what differs." */
  line: string;
}

import { FITTINGS_NOTE, FITTINGS_NOTE_FULL, HEIGHT_TOLERANCE, LAYOUT_OK_LINE, SIZE_TOLERANCE, TOP_TOLERANCE } from "./photo-check-vocab";
export { FITTINGS_NOTE, FITTINGS_NOTE_FULL, HEIGHT_TOLERANCE, LAYOUT_OK_LINE, SIZE_TOLERANCE, TOP_TOLERANCE };

/** The honest failure: the first thing that moved, said plainly. */
export function failureLine(failures: readonly PlacementFailure[]): string {
  if (failures.length === 0) return LAYOUT_OK_LINE;
  const f = failures[0]!;
  const more = failures.length > 1 ? ` (and ${failures.length - 1} more)` : "";
  return `${f.message.replace(/^./, (c) => c.toUpperCase())}${more} — see what differs.`;
}

/**
 * The pass rule. Pure; the model only reports what it sees. A render passes when
 * every item the before photo shows is in the after image, in the same place,
 * once, in the same left/right order — and nothing the photo does not have was
 * added.
 */
export function judgePhotoPlacement(items: readonly CheckItem[], before: Pick<Detection, "items">, after: Pick<Detection, "items">, opts: { resizable?: ReadonlySet<string> } = {}): PlacementVerdict {
  const B = new Map(before.items.map((x) => [x.ref, x]));
  const A = new Map(after.items.map((x) => [x.ref, x]));
  const failures: PlacementFailure[] = [];
  const checked: CheckItem[] = items.filter((it) => !it.gone && B.get(it.ref)?.present && B.get(it.ref)?.box);
  // A replaced item still in the render: the swap did not happen.
  for (const it of items) {
    if (!it.gone) continue;
    const a = A.get(it.ref);
    if (a?.present && a.box && (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]) >= 2) failures.push({ ref: it.ref, short: it.short, reason: "kept", message: `the render kept the ${it.short} — it is being replaced` });
  }
  for (const it of checked) {
    const b = B.get(it.ref)!, a = A.get(it.ref);
    if (!a || !a.present || !a.box) {
      failures.push({ ref: it.ref, short: it.short, reason: "removed", message: `the render removed the ${it.short}` });
      continue;
    }
    // A replacement stands where the old item stood: its FOOTPRINT (centre x,
    // bottom edge) is held, not its box centre — a cabinet is taller than a bidet.
    const [bx, by] = it.replaces ? [centre(b.box!)[0], b.box![3]] : centre(b.box!), [ax, ay] = it.replaces ? [centre(a.box)[0], a.box[3]] : centre(a.box);
    const tolX = Math.max(12, 0.6 * (b.box![2] - b.box![0]));
    const tolY = Math.max(12, 0.6 * (b.box![3] - b.box![1]));
    if (Math.abs(ax - bx) > tolX || Math.abs(ay - by) > tolY) {
      failures.push({ ref: it.ref, short: it.short, reason: "moved", message: `the render moved the ${it.short}` });
      continue;
    }
    const area = (x: Box) => Math.max(0, x[2] - x[0]) * Math.max(0, x[3] - x[1]);
    // A replacement is a different object in the same spot: its size is its own.
    // A change that asks for this item to change (a fixed panel instead of a hinged
    // screen) changes its size on purpose: its place is still held.
    if (it.replaces || opts.resizable?.has(it.ref)) {
      const tall = topFailure(it, a);
      if (tall) failures.push(tall);
      else if (a.instances > 1) failures.push({ ref: it.ref, short: it.short, reason: "duplicated", message: `the render added a second ${it.short}` });
      continue;
    }
    const ratio = area(b.box!) > 0 ? area(a.box) / area(b.box!) : 1;
    if (outside(ratio, SIZE_TOLERANCE)) {
      failures.push({ ref: it.ref, short: it.short, reason: "resized", message: `the render ${ratio < 1 ? "shrank" : "enlarged"} the ${it.short} (${Math.round((ratio - 1) * 100)}% of its area)` });
      continue;
    }
    // B8: height on its own — a fixture can keep its area and still grow tall and narrow.
    const hb = b.box![3] - b.box![1], ha = a.box[3] - a.box[1];
    const hRatio = hb > 0 ? ha / hb : 1;
    if (outside(hRatio, HEIGHT_TOLERANCE)) {
      failures.push({ ref: it.ref, short: it.short, reason: "resized", message: `the render made the ${it.short} ${hRatio < 1 ? "shorter" : "taller"} (${Math.round((hRatio - 1) * 100)}% of its height)` });
      continue;
    }
    if (a.instances > Math.max(1, b.instances)) failures.push({ ref: it.ref, short: it.short, reason: "duplicated", message: `the render added a second ${it.short}` });
  }
  // A fixture the photo does not have, added (a bath where the room has none).
  for (const it of items) {
    if (it.gone || B.get(it.ref)?.present) continue;
    const a = A.get(it.ref);
    if (a?.present && a.box && (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]) >= 4) failures.push({ ref: it.ref, short: it.short, reason: "added", message: `the render added a ${it.short}` });
  }
  // Left/right order between items clearly apart in the photo (≥ 4% gap).
  const placed = checked.filter((it) => A.get(it.ref)?.box && !failures.some((f) => f.ref === it.ref));
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const p = placed[i]!, q = placed[j]!;
      const pb = B.get(p.ref)!.box!, qb = B.get(q.ref)!.box!;
      const [left, right] = pb[2] + 4 <= qb[0] ? [p, q] : qb[2] + 4 <= pb[0] ? [q, p] : [null, null];
      if (!left || !right) continue;
      if (centre(A.get(left.ref)!.box!)[0] > centre(A.get(right.ref)!.box!)[0]) {
        failures.push({ ref: left.ref, short: left.short, reason: "swapped", message: `the render swapped the ${left.short} and the ${right.short}` });
      }
    }
  }
  return { passed: failures.length === 0, checked: checked.map((c) => c.ref), failures, line: failureLine(failures) };
}

/** A ratio outside ×(1 + t) either way (symmetric in log terms: ×1.5 and ÷1.5 are the same size of change). */
function outside(ratio: number, t: number): boolean {
  return ratio > 1 + t || ratio < 1 / (1 + t);
}

/** B8: an item whose plan states its height, drawn too tall or too short against the wall behind it. */
function topFailure(it: CheckItem, a: Located): PlacementFailure | null {
  if (it.top_share == null || a.top == null) return null;
  if (Math.abs(a.top - it.top_share) <= TOP_TOLERANCE) return null;
  const planned = it.height_mm ? ` (about ${((a.top / it.top_share) * it.height_mm / 1000).toFixed(1)} m; ${(it.height_mm / 1000).toFixed(1)} m planned)` : "";
  return { ref: it.ref, short: it.short, reason: "resized", message: `the render made the ${it.short} too ${a.top > it.top_share ? "tall" : "short"}${planned}` };
}

/** Boxes into % of the frame, ordered and clamped (pixels and fractions recognised — the G5d lesson). */
export function normaliseLocated(items: Located[], image: { width: number; height: number } | null): Located[] {
  const boxes = items.map((i) => i.box).filter((b): b is Box => !!b);
  const pixels = boxes.some((b) => b.some((v) => v > 100));
  const fractions = boxes.length > 0 && boxes.every((b) => b.every((v) => v <= 1)) && boxes.some((b) => b.some((v) => v > 0));
  const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v * 10) / 10));
  return items.map((i) => {
    if (!i.present || !i.box) return { ...i, box: null };
    const b = i.box;
    const [x0, y0, x1, y1] = pixels && image ? [(b[0] / image.width) * 100, (b[1] / image.height) * 100, (b[2] / image.width) * 100, (b[3] / image.height) * 100] : fractions ? b.map((v) => v * 100) : b;
    const box: Box = [clamp(Math.min(x0!, x1!)), clamp(Math.min(y0!, y1!)), clamp(Math.max(x0!, x1!)), clamp(Math.max(y0!, y1!))];
    return { ...i, box: box[2] - box[0] < 0.5 || box[3] - box[1] < 0.5 ? null : box, present: box[2] - box[0] >= 0.5 && box[3] - box[1] >= 0.5 };
  });
}

// --- the vision call ------------------------------------------------------------

export type ImageInput = { mediaType: "image/jpeg" | "image/png"; data: string } | { url: string };

const DETECTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ref", "present", "x0", "y0", "x1", "y1", "instances", "top", "note"],
        properties: {
          ref: { type: "string" },
          present: { type: "boolean" },
          x0: { type: "number" },
          y0: { type: "number" },
          x1: { type: "number" },
          y1: { type: "number" },
          instances: { type: "integer" },
          top: { type: "number" },
          note: { type: "string" },
        },
      },
    },
  },
} as const;

export function detectionPrompt(items: readonly CheckItem[], role: "before" | "after"): string {
  return [
    role === "before"
      ? "This is a client's phone photo of their bathroom, as it is today."
      : "This is a restyled version of a client's phone photo of their bathroom — new finishes, possibly new fixture designs.",
    "Locate each item below in the image. For each, answer:",
    "- present: is any part of it visible in the frame (count it even if partly cut off at an edge or partly behind glass)?",
    "- x0, y0, x1, y1: the box around the VISIBLE part, in PERCENT of the image width and height (0–100; x from the left, y from the top). All 0 when not present.",
    "- instances: how many separate such items are visible (0 when not present).",
    "- top: how high the item's top reaches, as a share of the floor-to-ceiling height of the wall right behind it (0–1: a WC cistern about 0.3, a vanity counter about 0.3, a door about 0.75). 0 when not present.",
    "- note: a few words on where it is, or why not present.",
    "Judge what the item is by its role in the room, not its design: a restyled vanity is still the vanity even if it is now floating oak; a new frameless screen is still the shower glass.",
    "Mirrors, towels, rugs, bins and toiletries are not items.",
    "",
    "ITEMS:",
    ...items.map((it) => `${it.ref}: ${role === "before" && it.replaces ? it.replaces.description : it.description}`),
  ].join("\n");
}

function imageBlock(img: ImageInput): Anthropic.Messages.ImageBlockParam {
  return "url" in img ? { type: "image", source: { type: "url", url: img.url } } : { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } };
}

/** Read where each item is in one image. Throws when the model cannot answer (the caller decides). */
export async function detectItems(image: ImageInput, items: readonly CheckItem[], role: "before" | "after", size: { width: number; height: number } | null, reference?: { image: ImageInput; located: readonly Located[] }): Promise<Detection> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("check unavailable: ANTHROPIC_API_KEY not set");
  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model: CHECK_MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium", format: { type: "json_schema", schema: DETECTION_SCHEMA as unknown as Record<string, unknown> } },
    messages: [
      {
        role: "user",
        content: reference
          ? [
              { type: "text", text: "IMAGE 1 — the client's photo (before):" },
              imageBlock(reference.image),
              { type: "text", text: "IMAGE 2 — the restyled version (after):" },
              imageBlock(image),
              { type: "text", text: `${detectionPrompt(items, "after")}

In IMAGE 1 the items were found here (percent of the frame): ${reference.located.map((l) => (l.present && l.box ? `${l.ref} at [${l.box.join(", ")}]` : `${l.ref} not in the photo`)).join("; ")}.
Answer for IMAGE 2 only. Find the SAME physical items there: an item is the same one if it plays the same role in the room, even redesigned. Report one that is genuinely new in IMAGE 2 as present too.` },
            ]
          : [imageBlock(image), { type: "text", text: detectionPrompt(items, role) }],
      },
    ],
  });
  if (res.stop_reason === "refusal") throw new Error("check unavailable: the model declined to read the image");
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const parsed = JSON.parse(text) as { items: { ref: string; present: boolean; x0: number; y0: number; x1: number; y1: number; instances: number; top?: number; note: string }[] };
  const refs = new Set(items.map((i) => i.ref));
  const located: Located[] = parsed.items
    .filter((i) => refs.has(i.ref))
    .map((i) => ({ ref: i.ref, present: !!i.present, box: i.present ? ([i.x0, i.y0, i.x1, i.y1] as Box) : null, instances: Math.max(0, Math.round(i.instances || 0)), top: i.present && typeof i.top === "number" && i.top > 0 && i.top <= 1.2 ? Math.min(1, i.top) : null, note: i.note }));
  for (const it of items) if (!located.some((l) => l.ref === it.ref)) located.push({ ref: it.ref, present: false, box: null, instances: 0, note: "not assessed" });
  return { items: normaliseLocated(located, size), model: CHECK_MODEL, at: new Date().toISOString(), usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens } };
}

/** USD for one check call. */
export const checkCostUsd = (u: { input_tokens: number; output_tokens: number } | undefined) => (u ? (u.input_tokens * CHECK_PRICE.input + u.output_tokens * CHECK_PRICE.output) / 1e6 : 0);

// --- B8: read twice, use the agreement ------------------------------------------------
//
// The same image read twice put P1's door 31 % apart (B2b): the size rule sat
// inside the reading's own noise. Every image is now read twice; where the two
// readings disagree on whether an item is there, or how many, a third decides.
// The agreed reading averages the boxes of the readings that saw the item, so
// its noise is a single reading's over √2. The tolerances in
// photo-check-vocab.ts come from the measured spread (scripts/b8-check-noise.ts).

/** Do two readings disagree on presence or count for any item? */
export function readingsDisagree(a: readonly Located[], b: readonly Located[]): boolean {
  const B = new Map(b.map((x) => [x.ref, x]));
  return a.some((x) => {
    const y = B.get(x.ref);
    return !y || x.present !== y.present || (x.present && x.instances !== y.instances);
  });
}

/** The agreed reading: majority on presence and count (a tie counts as present), boxes and tops averaged over the readings that saw the item. Pure. */
export function agreeReadings(reads: readonly (readonly Located[])[]): Located[] {
  const refs = [...new Set(reads.flatMap((r) => r.map((x) => x.ref)))];
  return refs.map((ref) => {
    const all = reads.map((r) => r.find((x) => x.ref === ref) ?? { ref, present: false, box: null, instances: 0 });
    const seen = all.filter((x) => x.present && x.box);
    if (seen.length * 2 < all.length || seen.length === 0) return { ref, present: false, box: null, instances: 0, top: null, note: all.find((x) => !x.present)?.note };
    const mean = (k: 0 | 1 | 2 | 3) => Math.round((seen.reduce((s, x) => s + x.box![k], 0) / seen.length) * 10) / 10;
    const counts = seen.map((x) => x.instances).sort((p, q) => p - q);
    const mode = counts.find((c) => counts.filter((d) => d === c).length * 2 > counts.length) ?? counts[0]!;
    const tops = seen.map((x) => x.top).filter((t): t is number => typeof t === "number");
    return { ref, present: true, box: [mean(0), mean(1), mean(2), mean(3)] as Box, instances: mode, top: tops.length ? Math.round((tops.reduce((s, t) => s + t, 0) / tops.length) * 100) / 100 : null, note: seen[0]!.note };
  });
}

export interface Spread {
  ref: string;
  /** |ln(area ratio)| between the two readings. */
  ln_area: number;
  /** |ln(height ratio)|. */
  ln_height: number;
  /** |difference in the top share|, when both read it. */
  top: number | null;
  /** Centre distance, % of the frame. */
  centre: number;
}

/** One image read twice: how far apart the readings are for each item both saw. Pure — the noise measurement. */
export function readingSpread(a: readonly Located[], b: readonly Located[]): Spread[] {
  const out: Spread[] = [];
  const ar = (q: Box) => Math.max(0.01, (q[2] - q[0]) * (q[3] - q[1]));
  for (const x of a) {
    const y = b.find((z) => z.ref === x.ref);
    if (!x.present || !x.box || !y?.present || !y.box) continue;
    const [cx, cy] = centre(x.box), [dx, dy] = centre(y.box);
    out.push({
      ref: x.ref,
      ln_area: Math.abs(Math.log(ar(x.box) / ar(y.box))),
      ln_height: Math.abs(Math.log(Math.max(0.1, x.box[3] - x.box[1]) / Math.max(0.1, y.box[3] - y.box[1]))),
      top: typeof x.top === "number" && typeof y.top === "number" ? Math.abs(x.top - y.top) : null,
      centre: Math.hypot(cx - dx, cy - dy),
    });
  }
  return out;
}

/** Read an image twice (a third time when the two disagree on presence or count) and return the agreed reading, the readings and the summed usage. */
export async function detectAgreed(image: ImageInput, items: readonly CheckItem[], role: "before" | "after", size: { width: number; height: number } | null, reference?: { image: ImageInput; located: readonly Located[] }): Promise<Detection> {
  const two = await Promise.all([detectItems(image, items, role, size, reference), detectItems(image, items, role, size, reference)]);
  const reads: Detection[] = [...two];
  if (readingsDisagree(two[0].items, two[1].items)) reads.push(await detectItems(image, items, role, size, reference));
  const usage = reads.reduce((u, r) => ({ input_tokens: u.input_tokens + (r.usage?.input_tokens ?? 0), output_tokens: u.output_tokens + (r.usage?.output_tokens ?? 0) }), { input_tokens: 0, output_tokens: 0 });
  return { items: agreeReadings(reads.map((r) => r.items)), model: CHECK_MODEL, at: new Date().toISOString(), usage, reads: reads.map((r) => r.items) };
}

// --- the style check ----------------------------------------------------------------
//
// A restyle can keep every fixture in place by keeping the photo — the B2 eval's
// edge-conditioned arm kept the old frosted glass and tile grid line for line.
// So "Style follows your references" is measured too: the vision model rates the
// render against each element of the brief the view shows (yes / partly / no);
// the line reads ✓ only at STYLE_PASS or better.

export const STYLE_PASS = 0.75;

const STYLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["elements"],
  properties: {
    elements: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["element", "verdict", "note"], properties: { element: { type: "string" }, verdict: { type: "string", enum: ["yes", "partly", "no"] }, note: { type: "string" } } },
    },
  },
} as const;

export interface StyleVerdict {
  score: number;
  passed: boolean;
  elements: { element: string; verdict: "yes" | "partly" | "no"; note: string }[];
  usage?: { input_tokens: number; output_tokens: number };
}

/** Pure: the score and the pass from per-element verdicts. */
export function judgeStyle(elements: StyleVerdict["elements"]): Pick<StyleVerdict, "score" | "passed"> {
  if (elements.length === 0) return { score: 0, passed: false };
  const score = Math.round((elements.reduce((s, e) => s + (e.verdict === "yes" ? 1 : e.verdict === "partly" ? 0.5 : 0), 0) / elements.length) * 100) / 100;
  return { score, passed: score >= STYLE_PASS };
}

/** The style line: ✓ when it follows, else which elements do not yet. */
export function styleLine(v: Pick<StyleVerdict, "passed" | "elements"> | null, source: "references" | "preset"): string {
  if (source !== "references") return "Style: your chosen direction (no references read yet)";
  if (!v) return "Style not checked — the layout check comes first";
  if (v.passed) return "Style follows your references ✓";
  const off = v.elements.filter((e) => e.verdict !== "yes").map((e) => e.element);
  return `Style only partly follows your references — ${off.join(", ")}`;
}

/**
 * Style check v2 (B2 live run): the render is judged BESIDE the photo it came
 * from. Judged alone, P1's render — the same tiles and the same damaged ceiling,
 * 14% of pixels changed — read as "warm beige tile ✓"; an element that still
 * shows the photo's old finish now reads "no".
 */
export const STYLE_CHECK_VERSION = "s2";

export async function checkStyle(image: ImageInput, elements: readonly { element: string; finish: string }[], before?: ImageInput): Promise<StyleVerdict> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("check unavailable: ANTHROPIC_API_KEY not set");
  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model: CHECK_MODEL,
    max_tokens: 8000,
    output_config: { effort: "low", format: { type: "json_schema", schema: STYLE_SCHEMA as unknown as Record<string, unknown> } },
    messages: [
      {
        role: "user",
        content: [
          ...(before ? [{ type: "text" as const, text: "IMAGE 1 — the client's bathroom as it is today:" }, imageBlock(before), { type: "text" as const, text: "IMAGE 2 — the render of the renovation:" }] : []),
          imageBlock(image),
          {
            type: "text",
            text: `${before ? "IMAGE 2 is" : "This is"} a render of a client's renovated bathroom. Does it follow the style brief below? For EACH element: "yes" (clearly renovated as briefed), "partly" (some of it), or "no" (a different finish${before ? " — or still the OLD finish from IMAGE 1: unchanged tiles, fittings or lights count as no" : ""}), with a few words why.\n\n${elements.map((e) => `${e.element}: ${e.finish}`).join("\n")}`,
          },
        ],
      },
    ],
  });
  const j = JSON.parse(res.content.map((b) => (b.type === "text" ? b.text : "")).join("")) as { elements: StyleVerdict["elements"] };
  return { ...judgeStyle(j.elements), elements: j.elements, usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens } };
}
