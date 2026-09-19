// =============================================================================
// lib/scene-render/gate.ts — the faithfulness gate (G4b).
//
// A render is checked against the camera's MANIFEST — what the 3D design model
// actually shows from that camera — by a vision model that sees both images.
// The model reports observations; the PASS RULE is deterministic code below, so
// "what counts as faithful" is reviewable and testable, not a mood.
//
// Fail-CLOSED, unlike the post-render QA gate: if the check cannot run (no key,
// API error, unparseable reply) the render has not passed, and the pipeline
// ships the honest 3D design view instead. An unchecked render never enters a
// pack.
// =============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import type { CameraManifest, ManifestItem } from "@/lib/scene/cameras";

export const GATE_MODEL = "claude-opus-5";

/** Anything smaller than this share of the frame is not required to be visible. */
const STRUCTURE_MIN_SHARE = 0.004;
const SURFACE_MIN_SHARE = 0.04;
const CONTEXT_MIN_SHARE = 0.06;
/** G5: an existing tree the design keeps must be in the render once it is this visible. */
const KEPT_TREE_MIN_SHARE = 0.01;

export interface GateCheck {
  ref: string;
  key: string;
  noun: string;
  category: ManifestItem["category"];
  box: ManifestItem["box"];
  share: number;
}

/**
 * G5d: walls the placement check uses as LANDMARKS — a wall seen end-on or in a
 * short stretch (the separator wall across a view), narrow enough in the frame
 * that "the bench is left of it" means something. A wall running the length of
 * the view is no landmark: everything is beside it.
 */
const LANDMARK_MAX_WIDTH = 30;
const LANDMARK_MIN_SHARE = 0.01;

export function placementLandmarks(m: CameraManifest): GateCheck[] {
  let w = 0;
  return m.items
    .filter((it) => it.category === "context" && it.noun === "boundary wall" && it.share >= LANDMARK_MIN_SHARE && it.box[2] - it.box[0] <= LANDMARK_MAX_WIDTH)
    .map((it) => ({ ref: `W${++w}`, key: it.key, noun: (it.label || it.noun).toLowerCase(), category: it.category, box: it.box, share: it.share }));
}

/** What the gate asks about: required structures, main surfaces, big context. */
export function gateChecks(m: CameraManifest): GateCheck[] {
  const out: GateCheck[] = [];
  let s = 0, f = 0, c = 0, t = 0;
  for (const it of m.items) {
    if (it.category === "structure" && it.share >= STRUCTURE_MIN_SHARE) out.push({ ref: `S${++s}`, key: it.key, noun: it.noun, category: it.category, box: it.box, share: it.share });
    else if (it.category === "surface" && it.share >= SURFACE_MIN_SHARE) out.push({ ref: `F${++f}`, key: it.key, noun: it.noun, category: it.category, box: it.box, share: it.share });
    else if (it.category === "context" && it.share >= CONTEXT_MIN_SHARE && it.noun !== "steps") out.push({ ref: `C${++c}`, key: it.key, noun: it.noun, category: it.category, box: it.box, share: it.share });
    else if (it.category === "planting" && it.noun.endsWith("(kept)") && it.share >= KEPT_TREE_MIN_SHARE) out.push({ ref: `T${++t}`, key: it.key, noun: it.noun, category: it.category, box: it.box, share: it.share });
  }
  return out;
}

const ObservationSchema = z.object({
  ref: z.string(),
  present: z.boolean(),
  roughly_in_place: z.boolean(),
  note: z.string().optional().default(""),
});

// G5c: models name the text field freely ("what", "item") and sometimes omit
// "major"; the first string is the description and an unstated major is major.
// A reply that says what it saw is never thrown away over a field name.
const FoundSchema = z
  .array(z.record(z.string(), z.unknown()))
  .nullable()
  .optional()
  .transform((v) =>
    (v ?? []).map((x) => ({
      description: String(x.description ?? x.what ?? x.item ?? Object.values(x).find((y) => typeof y === "string") ?? "unnamed"),
      major: x.major !== false,
    })),
  );

// G5d: where each built feature (and landmark wall) actually is in IMAGE 2, and how
// many copies of it the image shows. The model reports; code judges.
const PlacementSchema = z.object({
  ref: z.string(),
  box: z
    .array(z.number())
    .length(4)
    .nullable()
    .optional()
    // Raw as the model wrote it: normalisePlacements() turns pixels or fractions
    // into percent (with the image's size) before anything is judged.
    .transform((b) => (b ? (b as [number, number, number, number]) : null)),
  instances: z.number().int().min(0).nullable().optional().transform((v) => v ?? 1),
});

export const GateReplySchema = z.object({
  observations: z.array(ObservationSchema),
  placements: z.array(PlacementSchema).nullable().optional().transform((v) => v ?? []),
  extra_structures: FoundSchema,
  /** Evening only: light where the night design model shows none. */
  extra_lights: FoundSchema,
  same_viewpoint: z.boolean().nullable().transform((v) => v === true),
  summary: z.string().nullable().optional().transform((v) => v ?? ""),
});
export type GateReply = z.infer<typeof GateReplySchema>;

/** G5d: one built feature's placement, scene against render. */
export interface PlacementResult {
  ref: string;
  noun: string;
  scene_box: [number, number, number, number];
  render_box: [number, number, number, number] | null;
  instances: number;
  ok: boolean;
  reason: string | null;
}

export interface GateVerdict {
  /** G5d: the built-feature placement check ran (every g5d render has it). */
  placement_checked?: boolean;
  placements?: PlacementResult[];
  passed: boolean;
  /** Why it failed, one line per failed check. Empty when passed. */
  failures: string[];
  checks: GateCheck[];
  reply: GateReply | null;
  model: string;
  /** "ran" | "unavailable" — an unavailable gate is a failure, not a pass. */
  status: "ran" | "unavailable";
}

const region = (b: GateCheck["box"]) => `x ${b[0]}–${b[2]}%, y ${b[1]}–${b[3]}%`;

export function gatePrompt(checks: GateCheck[], counts: Record<string, number>, opts: { nightModel?: boolean; landmarks?: GateCheck[] } = {}): string {
  const built = checks.filter((c) => c.category === "structure");
  const landmarks = opts.landmarks ?? [];
  const placementAsk = built.length
    ? [
        "",
        `placements: for each BUILT item (${built.map((c) => c.ref).join(", ")})${landmarks.length ? ` and each landmark wall (${landmarks.map((l) => `${l.ref}: ${l.noun} — in the model at ${region(l.box)}`).join("; ")})` : ""}, give where it actually is in IMAGE 2 as a box [x0, y0, x1, y1] in PERCENT of IMAGE 2's width and height — numbers from 0 to 100, not pixels (0,0 = top-left, 100,100 = bottom-right), or null if IMAGE 2 does not show it; and instances = how many separate copies of that item IMAGE 2 shows (a second BBQ counter elsewhere in the picture counts). Report what IMAGE 2 shows, not what IMAGE 1 shows.`,
      ]
    : [];
  const lines = checks.map((c) => `${c.ref}: ${c.noun} — in the design model at ${region(c.box)} of the frame (${(c.share * 100).toFixed(1)}% of it)`);
  const countLine = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([noun, n]) => `${n} × ${noun}`)
    .join(", ");
  return [
    "IMAGE 1 is the 3D DESIGN MODEL of a garden, rendered from a fixed camera. It is the geometry authority: its layout, structures, heights and surfaces are what was designed.",
    "IMAGE 2 is a photoreal VISUALISATION that is supposed to depict exactly that design, from the same camera, with materials and planting painted in.",
    "",
    "Check IMAGE 2 against these items from the design model:",
    ...lines,
    countLine ? `Built structures in view (count them): ${countLine}.` : "No built structures are in view.",
    "",
    "For each item: present = it is clearly depicted in IMAGE 2 as the same kind of thing (a pergola is still a pergola with posts and a roof; a counter is still a counter; a lawn is still lawn, not paving). roughly_in_place = it sits in about the same part of the frame at about the same size and height. Materials, colours, planting, lighting and small decor may differ — that is the style. Geometry may not.",
    ...(checks.some((c) => c.noun.includes("grill and sink"))
      ? ["A BBQ counter with built-in grill and sink must visibly show both a grill and a sink on its top; a plain counter without them is NOT present."]
      : []),
    ...(checks.some((c) => c.noun.includes("louvred"))
      ? ["A louvred pergola has a flat roof of parallel louvre blades on square posts and beams; shade sails, fabric canopies, open timber rafters or a pitched roof are a DIFFERENT structure — present = false."]
      : []),
    "extra_structures: list any BUILT structure in IMAGE 2 that is not in IMAGE 1 — a pergola, gazebo, canopy, wall, counter, bench, planter, pool, fountain, steps or building. Plants, pots, cushions, loose furniture and lighting fixtures do not count. major = true if it would change what gets built.",
    "same_viewpoint = IMAGE 2 is taken from the same camera position and direction as IMAGE 1.",
    ...placementAsk,
    ...(opts.nightModel
      ? [
          "IMAGE 3 is the same design model at night. Its warm glows mark every DESIGNED light point; the design has no other lighting.",
          "extra_lights: list any light fitting, or lit patch of wall, ground or planting, in IMAGE 2 at a place where IMAGE 3 shows no glow. major = true for a visible fitting or a clearly lit surface with no designed light near it (for example wall lights on a wall that has none); soft spill beside a designed point is not major.",
        ]
      : []),
    "",
    `Reply with ONLY one JSON object, no prose, no fences: {"observations":[{"ref":"S1","present":true,"roughly_in_place":true,"note":""}],${built.length ? '"placements":[{"ref":"S1","box":[10,40,35,70],"instances":1}],' : ""}"extra_structures":[{"description":"","major":false}],${opts.nightModel ? '"extra_lights":[{"description":"","major":false}],' : ""}"same_viewpoint":true,"summary":"one sentence"}`,
  ].join("\n");
}

const centre = (b: readonly number[]): [number, number] => [(b[0]! + b[2]!) / 2, (b[1]! + b[3]!) / 2];

/**
 * G5d: put every placement box into percent of the frame. Asked for percent, the
 * model answers in PIXELS of the image about one reply in eight — clamped to 100,
 * a counter at y 600 px became "100% down" and a correct render failed as "moved"
 * (17 of 121 boxes on the first g5d run). Pixels are recognised by any value over
 * 100 and converted with the image's real size; fractions (all ≤ 1) are scaled;
 * the result is clamped to the frame. Pure.
 */
export function normalisePlacements(reply: GateReply, image: { width: number; height: number } | null): GateReply {
  const boxes = reply.placements.map((p) => p.box).filter((b): b is [number, number, number, number] => !!b);
  const pixels = boxes.some((b) => b.some((v) => v > 100));
  const fractions = boxes.length > 0 && boxes.every((b) => b.every((v) => v <= 1)) && boxes.some((b) => b.some((v) => v > 0));
  const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v * 10) / 10));
  const fix = (b: [number, number, number, number]): [number, number, number, number] => {
    const [x0, y0, x1, y1] = pixels && image ? [(b[0] / image.width) * 100, (b[1] / image.height) * 100, (b[2] / image.width) * 100, (b[3] / image.height) * 100] : fractions ? b.map((v) => v * 100) : b;
    return [clamp(Math.min(x0!, x1!)), clamp(Math.min(y0!, y1!)), clamp(Math.max(x0!, x1!)), clamp(Math.max(y0!, y1!))];
  };
  return { ...reply, placements: reply.placements.map((p) => ({ ...p, box: p.box ? fix(p.box) : null })) };
}

/** Width and height of a PNG or JPEG, from its header (no decoder). */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return { width: (bytes[16]! << 24) | (bytes[17]! << 16) | (bytes[18]! << 8) | bytes[19]!, height: (bytes[20]! << 24) | (bytes[21]! << 16) | (bytes[22]! << 8) | bytes[23]! };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let i = 2; i + 9 < bytes.length; ) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1]!;
      const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: (bytes[i + 5]! << 8) | bytes[i + 6]!, width: (bytes[i + 7]! << 8) | bytes[i + 8]! };
      i += 2 + len;
    }
  }
  return null;
}

/**
 * G5d: the built-feature placement rule. The scene says where each built feature
 * is in the frame; the render must show it there, once, and on the same side of
 * every other built feature and landmark wall. Pure — the model only reports boxes.
 *   not located — the render does not show it;
 *   moved       — its centre is off the scene's by more than max(12% of the frame,
 *                 60% of its own extent) on either axis;
 *   duplicated  — the render shows more copies than the scene has;
 *   swapped     — two items clearly apart left/right in the scene (≥ 4% gap)
 *                 appear the other way round in the render (a bench on the wrong
 *                 side of a wall, a counter on the wrong side of the pergola).
 * pp4/8/10 of the G5 pack each passed "roughly in place" while disagreeing with
 * each other; each is now held to the one scene, so two passed renders cannot
 * show two arrangements.
 */
export function judgePlacement(checks: GateCheck[], reply: GateReply, landmarks: GateCheck[] = []): PlacementResult[] {
  const built = checks.filter((c) => c.category === "structure");
  const byRef = new Map(reply.placements.map((p) => [p.ref, p]));
  const expected = new Map<string, number>();
  for (const c of built) expected.set(c.noun, (expected.get(c.noun) ?? 0) + 1);
  const out: PlacementResult[] = built.map((c) => {
    const p = byRef.get(c.ref);
    const res: PlacementResult = { ref: c.ref, noun: c.noun, scene_box: c.box, render_box: p?.box ?? null, instances: p?.instances ?? 0, ok: true, reason: null };
    if (!p || !p.box) return { ...res, ok: false, reason: "not located in the render" };
    const [sx, sy] = centre(c.box);
    const [rx, ry] = centre(p.box);
    const tolX = Math.max(12, 0.6 * (c.box[2] - c.box[0]));
    const tolY = Math.max(12, 0.6 * (c.box[3] - c.box[1]));
    if (Math.abs(rx - sx) > tolX || Math.abs(ry - sy) > tolY) {
      return { ...res, ok: false, reason: `moved — at ${Math.round(rx)}% across, ${Math.round(ry)}% down in the render; ${Math.round(sx)}%, ${Math.round(sy)}% in the design` };
    }
    const designed = expected.get(c.noun) ?? 1;
    if (p.instances > designed) return { ...res, ok: false, reason: `duplicated — ${p.instances} shown, ${designed} designed` };
    return res;
  });
  // Left/right order against every other built item and landmark wall.
  const located = [...built, ...landmarks].map((c) => ({ c, p: byRef.get(c.ref) })).filter((x) => x.p?.box);
  for (let i = 0; i < located.length; i++) {
    for (let j = i + 1; j < located.length; j++) {
      const a = located[i]!;
      const b = located[j]!;
      const [left, right] = a.c.box[2] + 4 <= b.c.box[0] ? [a, b] : b.c.box[2] + 4 <= a.c.box[0] ? [b, a] : [null, null];
      if (!left || !right) continue;
      if (centre(left.p!.box!)[0] <= centre(right.p!.box!)[0]) continue;
      for (const x of [left, right]) {
        const r = out.find((o) => o.ref === x.c.ref);
        if (r?.ok) Object.assign(r, { ok: false, reason: `swapped — the design has the ${left.c.noun} left of the ${right.c.noun}; the render has them the other way round` });
      }
    }
  }
  return out;
}

/**
 * The pass rule. Deterministic; the model only observes. G5d: `placement` adds the
 * built-feature placement rule (every render from the g5d pipeline on).
 */
export function judge(checks: GateCheck[], reply: GateReply, opts: { placement?: boolean; landmarks?: GateCheck[] } = {}): { passed: boolean; failures: string[]; placements?: PlacementResult[] } {
  const failures: string[] = [];
  const byRef = new Map(reply.observations.map((o) => [o.ref, o]));
  for (const c of checks) {
    const o = byRef.get(c.ref);
    if (!o) {
      failures.push(`${c.ref} ${c.noun}: not assessed`);
      continue;
    }
    if (!o.present) failures.push(`${c.ref} ${c.noun}: missing${o.note ? ` (${o.note})` : ""}`);
    else if (!o.roughly_in_place && c.category !== "context") failures.push(`${c.ref} ${c.noun}: moved or resized${o.note ? ` (${o.note})` : ""}`);
  }
  for (const x of reply.extra_structures) if (x.major) failures.push(`invented structure: ${x.description}`);
  // Lighting is AS DESIGNED: an evening view may not show light nobody designed.
  for (const x of reply.extra_lights) if (x.major) failures.push(`undesigned light: ${x.description}`);
  if (!reply.same_viewpoint) failures.push("viewpoint changed");
  if (!opts.placement) return { passed: failures.length === 0, failures };
  const placements = judgePlacement(checks, reply, opts.landmarks ?? []);
  for (const p of placements) if (!p.ok) failures.push(`${p.ref} ${p.noun}: placement ${p.reason}`);
  return { passed: failures.length === 0, failures, placements };
}

export function parseGateReply(text: string): GateReply | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = GateReplySchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type ImageSource = { kind: "base64"; mediaType: "image/png" | "image/jpeg"; data: string } | { kind: "url"; url: string };

function imageBlock(src: ImageSource): Anthropic.Messages.ImageBlockParam {
  return src.kind === "url"
    ? { type: "image", source: { type: "url", url: src.url } }
    : { type: "image", source: { type: "base64", media_type: src.mediaType, data: src.data } };
}

/**
 * Run the gate. Never throws; an unavailable gate returns a failed verdict.
 * Pass `nightModel` for an evening view: it adds the light-position check.
 */
export async function runFaithfulnessGate(manifest: CameraManifest, designModel: ImageSource, candidate: ImageSource, nightModel?: ImageSource): Promise<GateVerdict> {
  const checks = gateChecks(manifest);
  const landmarks = placementLandmarks(manifest);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const unavailable = (why: string): GateVerdict => ({ passed: false, failures: [`gate unavailable: ${why}`], checks, reply: null, model: GATE_MODEL, status: "unavailable" });
  if (!apiKey) return unavailable("ANTHROPIC_API_KEY not set");
  try {
    const anthropic = new Anthropic({ apiKey });
    const content: Anthropic.Messages.ContentBlockParam[] = [
      { type: "text", text: "IMAGE 1 — design model:" },
      imageBlock(designModel),
      { type: "text", text: "IMAGE 2 — visualisation:" },
      imageBlock(candidate),
      ...(nightModel
        ? ([{ type: "text", text: "IMAGE 3 — design model at night (designed lights glow):" }, imageBlock(nightModel)] as Anthropic.Messages.ContentBlockParam[])
        : []),
      { type: "text", text: gatePrompt(checks, manifest.counts, { nightModel: !!nightModel, landmarks }) },
    ];
    // One retry on an unparseable reply, asking for the JSON alone. A second
    // failure is an unavailable gate — which fails, it never passes.
    let reply: GateReply | null = null;
    let last = "";
    for (let attempt = 0; attempt < 2 && !reply; attempt++) {
      const response = await anthropic.messages.create({
        model: GATE_MODEL,
        max_tokens: 4000,
        messages:
          attempt === 0
            ? [{ role: "user", content }]
            : [
                { role: "user", content },
                { role: "assistant", content: last || "(no reply)" },
                { role: "user", content: "That reply could not be parsed. Reply again with ONLY the JSON object, nothing else." },
              ],
      });
      last = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      reply = parseGateReply(last);
    }
    if (!reply) return unavailable("unparseable reply");
    reply = normalisePlacements(reply, candidate.kind === "base64" ? imageSize(new Uint8Array(Buffer.from(candidate.data, "base64"))) : null);
    const { passed, failures, placements } = judge(checks, reply, { placement: true, landmarks });
    return { passed, failures, checks, reply, model: GATE_MODEL, status: "ran", placement_checked: true, placements };
  } catch (e) {
    return unavailable(e instanceof Error ? e.message.slice(0, 200) : "error");
  }
}
