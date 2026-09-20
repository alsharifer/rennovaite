// =============================================================================
// lib/scene-render/consistency.ts — one garden, not three (garden pilot G5c).
//
// Each view's faithfulness gate checks a render against ITS OWN design model:
// geometry, structures, surfaces. None of them compares views with each other,
// so a pack could carry a bronze louvred pergola on one page, a timber one on
// the next and a shade-sail version on a third, every one of them "faithful".
//
// This gate compares a passed render against the pack's ANCHOR render (the
// view every other restyle was conditioned to match) on what must be the same
// everywhere: the pergola design, the paving material, the planting palette and
// the wall finish. The model observes; the pass rule is deterministic: any
// attribute seen in both images and judged different fails the view. An
// attribute not visible in one of the two is not a failure.
// =============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { GATE_MODEL, type ImageSource } from "./gate";

const ATTRS = ["pergola_design", "paving_material", "planting_palette", "wall_finish"] as const;
export type ConsistencyAttr = (typeof ATTRS)[number];

const Obs = z.object({
  // true = same, false = different, null = not visible in one of the two images.
  same: z.boolean().nullable(),
  note: z.string().nullable().optional().transform((v) => v ?? ""),
});

export const ConsistencyReplySchema = z.object({
  pergola_design: Obs,
  paving_material: Obs,
  planting_palette: Obs,
  wall_finish: Obs,
  summary: z.string().nullable().optional().transform((v) => v ?? ""),
});
export type ConsistencyReply = z.infer<typeof ConsistencyReplySchema>;

export interface ConsistencyVerdict {
  passed: boolean;
  failures: string[];
  reply: ConsistencyReply | null;
  status: "ran" | "unavailable";
}

const LABEL: Record<ConsistencyAttr, string> = {
  pergola_design: "pergola design",
  paving_material: "paving material",
  planting_palette: "planting palette",
  wall_finish: "wall finish",
};

export function consistencyPrompt(spec: string): string {
  return [
    "IMAGE 1 and IMAGE 2 are photographs of the SAME garden from different cameras. They must show one design. The design is:",
    spec,
    "For each attribute, compare the two images: same = true when both show it and it is the same design/material/colour; same = false when both show it and it differs (a louvred pergola vs a timber or fabric one; light porcelain vs dark stone or gravel; a different planting style; a different wall finish or colour); same = null when it is not visible in one of the images.",
    "Camera, framing, light and which part of the garden is shown WILL differ — that is not a difference.",
    'Reply with ONLY one JSON object: {"pergola_design":{"same":true,"note":""},"paving_material":{"same":true,"note":""},"planting_palette":{"same":true,"note":""},"wall_finish":{"same":true,"note":""},"summary":"one sentence"}',
  ].join("\n");
}

export function parseConsistencyReply(text: string): ConsistencyReply | null {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s === -1 || e <= s) return null;
  try {
    const p = ConsistencyReplySchema.safeParse(JSON.parse(text.slice(s, e + 1)));
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

/** The pass rule. Deterministic. */
export function judgeConsistency(reply: ConsistencyReply): { passed: boolean; failures: string[] } {
  const failures = ATTRS.filter((a) => reply[a].same === false).map((a) => `inconsistent ${LABEL[a]} with the anchor view${reply[a].note ? ` (${reply[a].note})` : ""}`);
  return { passed: failures.length === 0, failures };
}

function block(src: ImageSource): Anthropic.Messages.ImageBlockParam {
  return src.kind === "url" ? { type: "image", source: { type: "url", url: src.url } } : { type: "image", source: { type: "base64", media_type: src.mediaType, data: src.data } };
}

/** Never throws; an unavailable gate is reported as such (and is not a pass). */
export async function runConsistencyGate(anchor: ImageSource, candidate: ImageSource, spec: string): Promise<ConsistencyVerdict> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { passed: false, failures: ["consistency gate unavailable: ANTHROPIC_API_KEY not set"], reply: null, status: "unavailable" };
  try {
    const anthropic = new Anthropic({ apiKey });
    const content: Anthropic.Messages.ContentBlockParam[] = [
      { type: "text", text: "IMAGE 1 — anchor view:" },
      block(anchor),
      { type: "text", text: "IMAGE 2 — another view:" },
      block(candidate),
      { type: "text", text: consistencyPrompt(spec) },
    ];
    let reply: ConsistencyReply | null = null;
    let last = "";
    for (let attempt = 0; attempt < 2 && !reply; attempt++) {
      const res = await anthropic.messages.create({
        model: GATE_MODEL,
        max_tokens: 1500,
        messages: attempt === 0 ? [{ role: "user", content }] : [{ role: "user", content }, { role: "assistant", content: last || "(no reply)" }, { role: "user", content: "Reply again with ONLY the JSON object." }],
      });
      last = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      reply = parseConsistencyReply(last);
    }
    if (!reply) return { passed: false, failures: [`consistency gate unavailable: unparseable reply (${last.replace(/\s+/g, " ").slice(0, 120)})`], reply: null, status: "unavailable" };
    return { ...judgeConsistency(reply), reply, status: "ran" };
  } catch (e) {
    return { passed: false, failures: [`consistency gate unavailable: ${e instanceof Error ? e.message.slice(0, 160) : "error"}`], reply: null, status: "unavailable" };
  }
}
