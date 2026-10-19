// =============================================================================
// lib/render/room-spec-vocab.ts — the room design spec and the "follows" lines
// (bathroom pilot B4). Pure and client-safe: the studio reads the same words the
// server writes. The vision calls are in room-spec.ts.
// =============================================================================

/** Same bar as the style check (photo-check STYLE_PASS). */
export const FOLLOWS_PASS = 0.75;

/** A per-element verdict, as the style check stores it. */
export interface ElementVerdict {
  element: string;
  verdict: "yes" | "partly" | "no";
  note: string;
}

/** The room design spec, in words. A field the anchor does not show is null. */
export interface RoomDesignSpec {
  floor_tile: string | null;
  wall_tile: string | null;
  /** "full height", "1.2 m dado", … as the anchor shows it. */
  tiled_height: string | null;
  vanity: string | null;
  mirror: string | null;
  wc: string | null;
  shower_screen: string | null;
  fittings_finish: string | null;
  palette: string | null;
}

export const SPEC_FIELDS = ["floor_tile", "wall_tile", "tiled_height", "vanity", "mirror", "wc", "shower_screen", "fittings_finish", "palette"] as const;
export type SpecField = (typeof SPEC_FIELDS)[number];

/** How each field reads as a style element — the names styleElementsFor filters by kind in view. */
export const SPEC_ELEMENT: Record<SpecField, string> = {
  floor_tile: "floor",
  wall_tile: "walls",
  tiled_height: "tiled height",
  vanity: "vanity",
  mirror: "mirror",
  wc: "WC",
  shower_screen: "shower screen",
  fittings_finish: "fittings",
  palette: "palette",
};

/** The anchor as a view sees it: which view, which version, and its spec. */
export interface RoomAnchor {
  room_id: string;
  room_photo_id: string | null;
  render_id: string;
  /** "Photo 2" — the anchor's view, as the check line names it. */
  label: string;
  spec: RoomDesignSpec;
  locked_at: string | null;
}

/**
 * How a WC or bidet is MOUNTED is the plan's (a plumbing decision — the pilot keeps
 * the floor-standing WC; wall-hung is a priced option), never the anchor's: the
 * spec carries the design and finish only.
 */
const MOUNTING = /\b(wall[- ]hung|wall[- ]mounted|floor[- ]standing|floor[- ]mounted|back[- ]to[- ]wall|close[- ]coupled|with (a )?concealed cistern|concealed[- ]cistern)\b/gi;
export const withoutMounting = (s: string) => s.replace(MOUNTING, "").replace(/\s{2,}/g, " ").replace(/\s+([,.;])/g, "$1").replace(/^[\s,]+|[\s,]+$/g, "");

/** The spec as style elements (field order, nulls dropped; tiled height joins the walls; no mounting). */
export function specElements(spec: RoomDesignSpec): { element: string; finish: string }[] {
  const out: { element: string; finish: string }[] = [];
  for (const f of SPEC_FIELDS) {
    if (f === "tiled_height") continue;
    const raw = spec[f]?.trim();
    const v = raw && f === "wc" ? withoutMounting(raw) : raw;
    if (!v) continue;
    out.push({ element: SPEC_ELEMENT[f], finish: f === "wall_tile" && spec.tiled_height?.trim() ? `${v}, tiled ${spec.tiled_height.trim()}` : v });
  }
  return out;
}

/** The anchor's spec as one prompt sentence for a restyle. */
export function anchorPromptLine(anchor: Pick<RoomAnchor, "label">): string {
  return `The SECOND image is another view of this same room, already renovated and approved by the client (${anchor.label}, locked): use exactly its finishes, colours and fixture designs. Take nothing of its camera, framing or layout — the first image alone decides where everything is.`;
}

// --- the follows check: the render beside the anchor -----------------------------

export type FollowsVerdict = "same" | "partly" | "different" | "not_visible";

export interface FollowsResult {
  score: number;
  passed: boolean;
  elements: ElementVerdict[];
  usage?: { input_tokens: number; output_tokens: number };
  /** Elements the render does not show (not judged). */
  not_visible: string[];
}

/** Pure: same = 1, partly = ½, different = 0, over the elements the render shows; passes at FOLLOWS_PASS. */
export function judgeFollows(elements: readonly { element: string; verdict: FollowsVerdict; note: string }[]): Omit<FollowsResult, "usage"> {
  const seen = elements.filter((e) => e.verdict !== "not_visible");
  const mapped = seen.map((e) => ({ element: e.element, verdict: (e.verdict === "same" ? "yes" : e.verdict === "partly" ? "partly" : "no") as ElementVerdict["verdict"], note: e.note }));
  const score = seen.length === 0 ? 0 : Math.round((mapped.reduce((s, e) => s + (e.verdict === "yes" ? 1 : e.verdict === "partly" ? 0.5 : 0), 0) / seen.length) * 100) / 100;
  return { score, passed: seen.length > 0 && score >= FOLLOWS_PASS, elements: mapped, not_visible: elements.filter((e) => e.verdict === "not_visible").map((e) => e.element) };
}

/**
 * The check line for a view of an anchored room.
 *   follows      — rendered against the CURRENT anchor and passed: "Finishes follow Photo 2 (locked) ✓"
 *   differs      — rendered against it, failed: "Finishes differ from Photo 2 (locked) — vanity, floor"
 *   stale        — rendered against an EARLIER anchor version, or before the room was anchored
 *   anchor       — this view IS the anchor
 *   changed      — the view was changed after it followed, on an element the spec covers
 */
export type FollowsState = "follows" | "differs" | "stale" | "anchor" | "changed" | "unchecked";

export function followsLine(state: FollowsState, anchorLabel: string, detail: readonly string[] = []): string {
  switch (state) {
    case "anchor":
      return `${anchorLabel} anchors this room — every other view follows its finishes`;
    case "follows":
      return `Finishes follow ${anchorLabel} (locked) ✓`;
    case "differs":
      return `Finishes differ from ${anchorLabel} (locked)${detail.length ? ` — ${detail.join(", ")}` : ""}`;
    case "changed":
      return `Changed after it followed ${anchorLabel}${detail.length ? ` — ${detail.join(", ")} may differ` : ""}`;
    case "stale":
      return `${anchorLabel} changed after this view was rendered — render it again to follow`;
    default:
      return `Not yet rendered against ${anchorLabel} (locked) — render it again to follow`;
  }
}

/**
 * Pure: where a view stands against the room's anchor. `renderAnchorId` is the
 * anchor version the view's current render was made against (null = none).
 */
export function followsStateOf(input: { viewPhotoId: string; anchor: Pick<RoomAnchor, "room_photo_id" | "render_id"> | null; renderAnchorId: string | null; followsPassed: boolean | null; changedSpec?: readonly string[] | null }): FollowsState | null {
  const { anchor } = input;
  if (!anchor) return null;
  if (anchor.room_photo_id === input.viewPhotoId) return "anchor";
  if (!input.renderAnchorId) return "unchecked";
  if (input.renderAnchorId !== anchor.render_id) return "stale";
  if (input.changedSpec && input.changedSpec.length > 0) return "changed";
  // A render that did not keep the layout was never compared with the anchor.
  if (input.followsPassed == null) return "unchecked";
  return input.followsPassed ? "follows" : "differs";
}

// --- "Ask for a change": what it changed ---------------------------------------------

/** "Last change: “lighter oak floor” → version 2 · changed: floor finish". */
export function changeLine(request: string, version: number, changed: readonly string[]): string {
  return `Last change: “${request.trim()}” → version ${version} · changed: ${changed.length ? changed.join(", ") : "small details"}`;
}

/** Elements a change can touch, as the change line names them. */
export const CHANGE_ELEMENTS = ["floor finish", "wall tile", "vanity", "mirror", "WC", "bidet", "shower screen", "fittings", "lighting", "ceiling", "colour palette", "accessories", "other"] as const;

/** The spec fields an element name covers — a change to one of them breaks "follows". */
export function specFieldsChanged(changed: readonly string[]): SpecField[] {
  const out = new Set<SpecField>();
  for (const c of changed.map((x) => x.toLowerCase())) {
    if (c.includes("floor")) out.add("floor_tile");
    if (c.includes("wall")) out.add("wall_tile");
    if (c.includes("vanity")) out.add("vanity");
    if (c.includes("mirror")) out.add("mirror");
    if (c === "wc") out.add("wc");
    if (c.includes("shower")) out.add("shower_screen");
    if (c.includes("fitting")) out.add("fittings_finish");
    if (c.includes("palette") || c.includes("colour")) out.add("palette");
  }
  return [...out];
}

// --- "Render remaining": the cost guard's default scope ------------------------------------

export interface QueueView {
  id: string;
  /** Placed on the plan (a camera) — an unplaced photo is never rendered in bulk. */
  positioned: boolean;
  locked: boolean;
  /** The anchor version the view's latest render followed; null = none; undefined = never rendered. */
  latestAnchorId: string | null | undefined;
}

/**
 * Which views "Render remaining" renders: every POSITIONED photo view that is
 * not locked and either was never rendered or was not rendered against the
 * room's current anchor. Extra views (concepts) only on request, never here.
 */
export function viewsToRender(views: readonly QueueView[], anchor: { room_photo_id: string | null; render_id: string } | null): string[] {
  return views
    .filter((v) => v.positioned && !v.locked)
    .filter((v) => v.latestAnchorId === undefined || (!!anchor && anchor.room_photo_id !== v.id && v.latestAnchorId !== anchor.render_id))
    .map((v) => v.id);
}
