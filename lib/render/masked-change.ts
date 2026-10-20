// =============================================================================
// lib/render/masked-change.ts — which "Ask for a change" requests take the
// masked path (ruled 20 Oct, after B10). Pure.
//
// A request that names exactly ONE of the room's items (the vanity, the shower
// glass, the cabinet — itemsNamedBy) is edited inside that item's outline as the
// placement check last read it: everything outside it cannot change, by
// construction (masked-edit.ts). Anything else — no item named, several, or the
// item not in this view — goes straight to today's edit. And a masked edit that
// does not do what was asked falls back to today's edit too (photo-view-change.ts).
// B10 measured it on Photo 2's comments: 5 masked edits, 3 kept and every layout
// held, against 16 edits, 10 kept, for the same four comments in B6.
// =============================================================================

import { itemsNamedBy, type Box, type CheckItem, type Located } from "./photo-check";
import { padBox, raiseToTop } from "./masked-edit";

/** % of the frame added round the item's box: room for its edge and its shadow. */
export const MASK_PAD = 1.5;

export interface MaskTarget {
  item: CheckItem;
  /** The region the edit may change, % of the frame. */
  box: Box;
}

/** The one item a request names and the region a masked edit may change — or null (today's edit). */
export function maskedChangeTarget(request: string, items: readonly CheckItem[], located: readonly Located[]): MaskTarget | null {
  const named = itemsNamedBy(request, items);
  const live = items.filter((it) => !it.gone && named.has(it.ref));
  if (live.length !== 1) return null;
  const item = live[0]!;
  const at = located.find((l) => l.ref === item.ref);
  if (!at?.present || !at.box) return null;
  // An item whose plan states its height (the 1.2 m cabinet) may reach it, never past it.
  const box = item.top_share ? raiseToTop(at.box, at.top, item.top_share) : at.box;
  return { item, box: padBox(box, MASK_PAD) };
}

/** What the inpainting model is told: what belongs in the region, not an instruction to a whole-image editor. */
export function maskedChangePrompt(item: CheckItem, request: string): string {
  return [
    `This region of a photo of a renovated bathroom shows the ${item.short}, changed as the client asked: "${request.trim().replace(/"/g, "'")}".`,
    // Live, 20 Oct: asked for a ceramic top, the fill also turned the oak vanity black — the mask is the whole item.
    `Only what the request names changes: every other part of the ${item.short} keeps exactly its colour, material, size and design.`,
    "Around it the walls, floor and light continue exactly as in the rest of the image; no window, door or opening.",
    "Photorealistic interior photograph, warm 2700 K light, the same camera and perspective as the rest of the image.",
  ].join(" ");
}

/**
 * What the whole-image edit model is told on the paste arm: today's edit
 * request, held to the one item — only the part of its output inside the item's
 * box is kept, so the rest of the room is there for it to see, not to change.
 */
export function pasteChangePrompt(item: CheckItem, request: string): string {
  return [
    `Edit this photo of a renovated bathroom: ${request.trim()}.`,
    `Change ONLY that, on the ${item.short}: every other part of the ${item.short} keeps exactly its colour, material, size and design.`,
    "Keep everything else exactly as it is: the same camera, framing and crop, the same room, door, window and every fixture in the same place and size. Do not add any window, door or opening. Photorealistic.",
  ].join(" ");
}

/**
 * Is a masked edit kept, or does today's edit run instead? The same honesty as
 * any change: an image that came back the same is no change; a layout the check
 * refuses is not kept; a request the reading says was not done is not kept
 * ("partly" is kept, as for today's edit). Pure.
 */
export function maskedVerdict(r: { unchanged: boolean; layout: { passed: boolean; line: string }; requestDone?: "yes" | "partly" | "no"; summary?: string }): { keep: true } | { keep: false; why: string } {
  if (r.unchanged) return { keep: false, why: "the image came back the same" };
  if (!r.layout.passed) return { keep: false, why: r.layout.line };
  if (r.requestDone === "no") return { keep: false, why: `not done — ${r.summary ?? "the reading saw no change"}` };
  return { keep: true };
}
