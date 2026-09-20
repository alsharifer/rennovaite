// =============================================================================
// lib/scene-render/photo-pair.ts — before/after pairs from client photos (G5).
//
// A client photo of a zone is the strongest demo asset there is: the client's own
// garden, then the same garden redesigned. It is also the easiest place for an
// image model to lie — so a pair gets the same discipline as a plan-faithful
// render, with a manifest built from what the DESIGN says about that view:
//
//   - every existing item in the photo that the design KEEPS must still be there,
//     where it was;
//   - every item the design REMOVES must be gone;
//   - every item it REPLACES must be there, renewed, in the same place;
//   - the house, walls, windows and doors are untouched; the camera is the same;
//   - nothing major is invented.
//
// What the photo cannot show — a structure the design ADDS where the camera was
// never pointed — is not asked of it; the caption says the layout is on the
// drawings and the plan-faithful renders.
//
// The model observes; the pass rule is deterministic code (like gate.ts). A pair
// that fails twice is WITHHELD: there is no honest substitute for a photo
// restyle, so the pack leaves the pair out and the gate table says so.
// =============================================================================

import { createHash } from "node:crypto";

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import type { GardenStyle } from "@/lib/garden-styles";

import { GATE_MODEL, type ImageSource } from "./gate";

// g5c-1: orientation + visible-change checks, the design specification in the prompt.
// g5d-1: built features the design ADDS inside a structure replaced in place (the
//        BBQ counter under the pergola) must show, or be stated out of crop.
export const PHOTO_PAIR_VERSION = "g5d-1";

export interface PairItem {
  ref: string;
  noun: string;
  /** G5d: "add" = a new built feature of the design inside something in view. */
  disposition: "keep" | "remove" | "replace" | "add" | null;
  /** A replace that becomes something else in the same place (gazebo → louvred pergola). */
  replacement?: string | null;
  /** G5d: for an "add", the structure it stands in ("the new louvred pergola"). */
  within?: string | null;
}

export interface PairManifest {
  projectId: string;
  assetId: string;
  zoneName: string;
  zoneSurface: string;
  items: PairItem[];
  /** G5c: the project's design specification — what the renovation looks like. */
  spec?: string;
}

export function pairManifest(input: { projectId: string; assetId: string; zoneName: string; zoneSurface: string; items: { noun: string; disposition: PairItem["disposition"]; replacement?: string | null; within?: string | null }[]; spec?: string }): PairManifest {
  return {
    ...(input.spec ? { spec: input.spec } : {}),
    projectId: input.projectId,
    assetId: input.assetId,
    zoneName: input.zoneName,
    zoneSurface: input.zoneSurface,
    items: input.items.map((it, i) => ({ ref: `E${i + 1}`, noun: it.noun, disposition: it.disposition, ...(it.replacement ? { replacement: it.replacement } : {}), ...(it.within ? { within: it.within } : {}) })),
  };
}

/** Cache key: the project first, then everything the restyle is conditioned on. */
export function pairCacheKey(m: PairManifest, styleKey: string): string {
  if (!m.projectId) throw new Error("pairCacheKey: projectId is required");
  return createHash("sha256")
    .update(JSON.stringify([m.projectId, PHOTO_PAIR_VERSION, m.assetId, m.zoneSurface, m.items.map((i) => [i.noun, i.disposition, i.replacement ?? null, i.within ?? null]), styleKey, m.spec ?? null]))
    .digest("hex");
}

export function pairPrompt(m: PairManifest, style: GardenStyle, failures: string[] = []): string {
  const keep = m.items.filter((i) => i.disposition === "keep" || i.disposition === null);
  const remove = m.items.filter((i) => i.disposition === "remove");
  const replace = m.items.filter((i) => i.disposition === "replace" && !i.replacement);
  const becomes = m.items.filter((i) => i.disposition === "replace" && i.replacement);
  const adds = m.items.filter((i) => i.disposition === "add");
  return [
    "IMAGE 1 is a real photograph of a client's garden. Produce a photorealistic photograph of the SAME garden after renovation, from exactly the same camera position, lens and framing.",
    "The house, its walls, windows, doors, the boundary walls and the sky line stay exactly as they are.",
    keep.length ? `Keep exactly as they are, same position and size: ${keep.map((i) => i.noun).join("; ")}.` : "",
    remove.length ? `Remove completely and fill their place with the surrounding garden surface: ${remove.map((i) => i.noun).join("; ")}.` : "",
    replace.length ? `Replace with new, clean versions of the same thing in exactly the same position and size: ${replace.map((i) => i.noun).join("; ")}.` : "",
    ...becomes.map((i) => `Replace ${i.noun} with ${i.replacement}, where it stands now (the new work may be larger than what it replaces).`),
    // G5d: what the plan builds INSIDE that replacement is part of it — the p4 "after"
    // showed the new pergola over loose seating with no counter.
    ...adds.map((i) => `Inside ${i.within ?? "it"}, as the plan draws it: ${i.noun}. It is part of the design and must be clearly visible wherever that part of the garden is in the frame.`),
    `The main ground surface of this area is ${m.zoneSurface}.`,
    // G5c: an "after" that changes almost nothing is not a before/after. The design
    // specification says what the renovation looks like; make it plainly visible.
    m.spec ? `The renovation follows this design: ${m.spec} The change must be plainly visible: the new ground finish, planting and fittings of this area as designed — not a light retouch of the old garden.` : "",
    "Keep the orientation of IMAGE 1 exactly: the house stays on the same side of the frame, nothing is mirrored or swapped left for right.",
    `Do not add any pergola, gazebo, canopy, wall, bench, counter, planter, pool, fountain, steps or building that is not already in the photo${adds.length ? " or listed above" : ""}. Change nothing that is not listed.`,
    `Style — ${style.name_en}: ${style.one_line} Apply the style to materials, planting and finishes only.`,
    failures.length ? `A previous attempt was rejected for: ${failures.join("; ")}. Correct exactly these, and if in doubt change less.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

const PairReplySchema = z.object({
  observations: z.array(
    z.object({
      ref: z.string(),
      /** In the AFTER image, is the item there? */
      present: z.boolean(),
      // A removed item has no place to be in: models answer null there, and a
      // null must not make the whole reply unparseable (it cost a render once).
      roughly_in_place: z.boolean().nullable().optional().transform((v) => v ?? false),
      note: z.string().nullable().optional().transform((v) => v ?? ""),
      /** G5d: an added feature whose place is outside IMAGE 2's frame. */
      out_of_crop: z.boolean().nullable().optional().transform((v) => v === true),
    }),
  ),
  // An unsure null is a "no": it fails the pair with a reason instead of making
  // the reply unparseable and the gate "unavailable".
  house_unchanged: z.boolean().nullable().transform((v) => v === true),
  same_viewpoint: z.boolean().nullable().transform((v) => v === true),
  // G5c: the house on the other side of the frame is a mirrored garden, not a render of this one.
  house_side_matches: z.boolean().nullable().optional().transform((v) => v === true),
  // G5c: 0 = almost nothing changed … 3 = clearly transformed. An unanswered count is 0.
  visible_change: z.number().nullable().optional().transform((v) => (typeof v === "number" ? Math.max(0, Math.min(3, Math.round(v))) : 0)),
  // Models name the text field freely ("what", "structure", "item"): take the first
  // string. An entry that does not say whether it is major is treated as major.
  extra_structures: z
    .array(z.record(z.string(), z.unknown()))
    .nullable()
    .optional()
    .transform((v) =>
      (v ?? []).map((x) => ({
        description: String(x.description ?? x.what ?? x.structure ?? x.item ?? Object.values(x).find((y) => typeof y === "string") ?? "unnamed structure"),
        major: x.major !== false,
      })),
    ),
  summary: z.string().nullable().optional().transform((v) => v ?? ""),
});
export type PairReply = z.infer<typeof PairReplySchema>;

export function pairGatePrompt(m: PairManifest): string {
  const lines = m.items.map((i) => {
    if (i.disposition === "add") {
      return `${i.ref}: ${i.noun} — a NEW built feature of the design, which should now stand inside ${i.within ?? "the new structure"} (present = it is visible there). If the spot where it stands is outside IMAGE 2's frame, set out_of_crop = true.`;
    }
    const want =
      i.disposition === "remove"
        ? "should now be GONE"
        : i.disposition === "replace" && i.replacement
          ? `should now be ${i.replacement}, where it was (present = that replacement is visible there; roughly_in_place = it occupies that place — its size follows the design, not the old item)`
          : i.disposition === "replace"
            ? "should be there, renewed, in the same place"
            : "should still be there, unchanged, in the same place";
    return `${i.ref}: ${i.noun} — ${want}`;
  });
  return [
    "IMAGE 1 is a real photograph of a garden BEFORE renovation. IMAGE 2 is supposed to show the same garden AFTER renovation, from the same camera.",
    "Items from the design, with what IMAGE 2 should show:",
    ...lines,
    "For each item: present = it is visible in IMAGE 2; roughly_in_place = where visible, it is about where it is in IMAGE 1, about the same size.",
    "house_unchanged = the house walls, windows, doors and boundary walls are the same as in IMAGE 1.",
    "same_viewpoint = IMAGE 2 is taken from the same position and direction as IMAGE 1.",
    "house_side_matches = the house/villa is on the SAME side of the frame in IMAGE 2 as in IMAGE 1 (left stays left, right stays right) and the scene is not mirrored.",
    "visible_change = how clearly IMAGE 2 shows a renovated garden compared with IMAGE 1: 0 almost nothing changed, 1 minor retouch, 2 clearly renovated (new ground finish, planting or fittings plainly visible), 3 transformed.",
    "extra_structures: any BUILT structure in IMAGE 2 that is in neither IMAGE 1 nor the list (a pergola, gazebo, canopy, wall, counter, bench, planter, pool, fountain, steps, building). Plants, pots, cushions, loose furniture and light fittings do not count. major = true if it would change what gets built.",
    `Reply with ONLY one JSON object: {"observations":[{"ref":"E1","present":true,"roughly_in_place":true,"out_of_crop":false,"note":""}],"house_unchanged":true,"same_viewpoint":true,"house_side_matches":true,"visible_change":2,"extra_structures":[],"summary":"one sentence"}`,
  ].join("\n");
}

/** G5c: an after image must show the renovation clearly (2 = clearly renovated). */
export const MIN_VISIBLE_CHANGE = 2;

/** The pass rule. Deterministic. */
export function judgePair(m: PairManifest, reply: PairReply): { passed: boolean; failures: string[]; out_of_crop: string[] } {
  const failures: string[] = [];
  const outOfCrop: string[] = [];
  const byRef = new Map(reply.observations.map((o) => [o.ref, o]));
  for (const it of m.items) {
    const o = byRef.get(it.ref);
    if (!o) {
      failures.push(`${it.noun}: not assessed`);
      continue;
    }
    if (it.disposition === "add") {
      // A new feature has no place in the BEFORE photo to be "in": it must be there,
      // or honestly out of crop — and then the caption says so.
      if (!o.present && o.out_of_crop) outOfCrop.push(it.noun);
      else if (!o.present) failures.push(`${it.noun}: missing — the design puts it inside ${it.within ?? "the new structure"}${o.note ? ` (${o.note})` : ""}`);
    } else if (it.disposition === "remove") {
      if (o.present) failures.push(`${it.noun}: should have been removed`);
    } else if (!o.present) {
      failures.push(`${it.noun}: missing${o.note ? ` (${o.note})` : ""}`);
    } else if (!o.roughly_in_place) {
      failures.push(`${it.noun}: moved or resized${o.note ? ` (${o.note})` : ""}`);
    }
  }
  if (!reply.house_unchanged) failures.push("house or boundary changed");
  if (!reply.same_viewpoint) failures.push("viewpoint changed");
  if (!reply.house_side_matches) failures.push("orientation changed — the house is not on the same side as in the photo");
  if (reply.visible_change < MIN_VISIBLE_CHANGE) failures.push(`too little visible change (${reply.visible_change}/3) — not a before/after`);
  for (const x of reply.extra_structures) if (x.major) failures.push(`invented structure: ${x.description}`);
  return { passed: failures.length === 0, failures, out_of_crop: outOfCrop };
}

/**
 * A withheld pair that never got a verdict: every attempt either produced no
 * image or could not be judged (the gate was unavailable). That says nothing
 * about the photo or the design, so it is neither cached nor trusted from cache.
 */
export function isVerdictless(attempts: readonly { image_url?: string; passed: boolean; failures: readonly string[] }[]): boolean {
  return (
    attempts.length > 0 &&
    attempts.every((a) => !a.passed && (!a.image_url || (a.failures.length > 0 && a.failures.every((f) => f.startsWith("gate unavailable") || f.startsWith("render error")))))
  );
}

export function parsePairReply(text: string): PairReply | null {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s === -1 || e <= s) return null;
  try {
    const p = PairReplySchema.safeParse(JSON.parse(text.slice(s, e + 1)));
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

function block(src: ImageSource): Anthropic.Messages.ImageBlockParam {
  return src.kind === "url" ? { type: "image", source: { type: "url", url: src.url } } : { type: "image", source: { type: "base64", media_type: src.mediaType, data: src.data } };
}

/** Run the pair gate. Never throws; an unavailable gate fails. */
export async function runPairGate(m: PairManifest, before: ImageSource, after: ImageSource): Promise<{ passed: boolean; failures: string[]; out_of_crop?: string[]; reply: PairReply | null; status: "ran" | "unavailable" }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { passed: false, failures: ["gate unavailable: ANTHROPIC_API_KEY not set"], reply: null, status: "unavailable" };
  try {
    const anthropic = new Anthropic({ apiKey });
    const content: Anthropic.Messages.ContentBlockParam[] = [
      { type: "text", text: "IMAGE 1 — before:" },
      block(before),
      { type: "text", text: "IMAGE 2 — after:" },
      block(after),
      { type: "text", text: pairGatePrompt(m) },
    ];
    let reply: PairReply | null = null;
    let last = "";
    for (let attempt = 0; attempt < 2 && !reply; attempt++) {
      const res = await anthropic.messages.create({
        model: GATE_MODEL,
        max_tokens: 3000,
        messages: attempt === 0 ? [{ role: "user", content }] : [{ role: "user", content }, { role: "assistant", content: last || "(no reply)" }, { role: "user", content: "Reply again with ONLY the JSON object." }],
      });
      last = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      reply = parsePairReply(last);
    }
    if (!reply) return { passed: false, failures: [`gate unavailable: unparseable reply (${last.replace(/\s+/g, " ").slice(0, 160)})`], reply: null, status: "unavailable" };
    return { ...judgePair(m, reply), reply, status: "ran" };
  } catch (e) {
    return { passed: false, failures: [`gate unavailable: ${e instanceof Error ? e.message.slice(0, 160) : "error"}`], reply: null, status: "unavailable" };
  }
}
