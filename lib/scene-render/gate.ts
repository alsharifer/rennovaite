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

export const GateReplySchema = z.object({
  observations: z.array(ObservationSchema),
  extra_structures: FoundSchema,
  /** Evening only: light where the night design model shows none. */
  extra_lights: FoundSchema,
  same_viewpoint: z.boolean().nullable().transform((v) => v === true),
  summary: z.string().nullable().optional().transform((v) => v ?? ""),
});
export type GateReply = z.infer<typeof GateReplySchema>;

export interface GateVerdict {
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

export function gatePrompt(checks: GateCheck[], counts: Record<string, number>, opts: { nightModel?: boolean } = {}): string {
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
    ...(opts.nightModel
      ? [
          "IMAGE 3 is the same design model at night. Its warm glows mark every DESIGNED light point; the design has no other lighting.",
          "extra_lights: list any light fitting, or lit patch of wall, ground or planting, in IMAGE 2 at a place where IMAGE 3 shows no glow. major = true for a visible fitting or a clearly lit surface with no designed light near it (for example wall lights on a wall that has none); soft spill beside a designed point is not major.",
        ]
      : []),
    "",
    `Reply with ONLY one JSON object, no prose, no fences: {"observations":[{"ref":"S1","present":true,"roughly_in_place":true,"note":""}],"extra_structures":[{"description":"","major":false}],${opts.nightModel ? '"extra_lights":[{"description":"","major":false}],' : ""}"same_viewpoint":true,"summary":"one sentence"}`,
  ].join("\n");
}

/** The pass rule. Deterministic; the model only observes. */
export function judge(checks: GateCheck[], reply: GateReply): { passed: boolean; failures: string[] } {
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
  return { passed: failures.length === 0, failures };
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
      { type: "text", text: gatePrompt(checks, manifest.counts, { nightModel: !!nightModel }) },
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
    const { passed, failures } = judge(checks, reply);
    return { passed, failures, checks, reply, model: GATE_MODEL, status: "ran" };
  } catch (e) {
    return unavailable(e instanceof Error ? e.message.slice(0, 200) : "error");
  }
}
