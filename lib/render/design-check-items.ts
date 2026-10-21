// =============================================================================
// lib/render/design-check-items.ts — the design check, itemised (Sprint C5 #2).
// Pure and client-safe.
//
// "DESIGN CHECK · PASSED" said more than any check did: the interior QA judges
// walls and camera, the photo-view check judges fixtures and openings one by
// one, nothing judged the products. Every surface now prints the same five
// rows, each ✓ / ✗ with its reason — and a row nothing checked says so (✗ "not
// checked — …"), never a ✓ it did not earn:
//
//   Geometry               the frame, walls and every checked item's size
//   Openings               doors and windows where the photo / plan has them
//   Fixtures               the sanitary fixtures, cabinet — each once, in place
//   Finishes follow anchor the locked view's finishes (B4 follows check)
//   Products match BoQ     the render's design fingerprint vs the room's now (B7)
//
// The studio (PhotoViewStudio, RendersStudio) and the room pack (room-pack-pdf)
// all print these rows.
// =============================================================================

import type { CheckItem } from "./photo-check";
import { approvalDrift } from "./material-labels";
import { followsLine, type FollowsState } from "./room-spec-vocab";

export type DesignCheckKey = "geometry" | "openings" | "fixtures" | "finishes" | "products";
export type DesignCheckState = "pass" | "fail" | "unchecked";

export const DESIGN_CHECK_LABEL: Record<DesignCheckKey, string> = {
  geometry: "Geometry",
  openings: "Openings",
  fixtures: "Fixtures",
  finishes: "Finishes follow anchor",
  products: "Products match BoQ",
};
const ORDER: DesignCheckKey[] = ["geometry", "openings", "fixtures", "finishes", "products"];

export interface DesignCheckRow {
  key: DesignCheckKey;
  label: string;
  state: DesignCheckState;
  reason: string;
}

const row = (key: DesignCheckKey, state: DesignCheckState, reason: string): DesignCheckRow => ({ key, label: DESIGN_CHECK_LABEL[key], state, reason: state === "unchecked" ? `not checked — ${reason}` : reason });

/** "DESIGN CHECK · 3 OF 5 PASSED" / "… · 1 FAILED". */
export function designCheckHead(rows: readonly DesignCheckRow[]): string {
  const pass = rows.filter((r) => r.state === "pass").length;
  const fail = rows.filter((r) => r.state === "fail").length;
  return `DESIGN CHECK · ${pass} OF ${rows.length} PASSED${fail ? ` · ${fail} FAILED` : ""}`;
}

/** One row as a printed line: "✓ Geometry — …" / "✗ Fixtures — not checked — …". */
export const designCheckLine = (r: DesignCheckRow): string => `${r.state === "pass" ? "✓" : "✗"} ${r.label} — ${r.reason}`;

// --- photo views (B2–B10) ------------------------------------------------------------------

interface PhotoGateLike {
  outcome: "passed" | "failed" | "error";
  items?: CheckItem[];
  checked?: string[];
  attempts: { failures: { ref: string; short: string; reason: string; message: string }[]; frame?: unknown }[];
  design_key?: string;
}

const OPENING_KINDS = new Set(["door", "window"]);
const GEOMETRY_REASONS = new Set(["resized", "swapped"]);

/**
 * A photo view's five rows.
 *   gate          the version's PhotoViewGate
 *   follows       its follows state (followsStateOf) and the anchor's label
 *   designNow     the room's design fingerprint now (designKey) — null when unknown
 */
export function photoViewCheckRows(input: { gate: PhotoGateLike; follows: FollowsState | null; anchorLabel: string | null; followsOff?: readonly string[]; designNow: string | null; styleLine?: string | null }): DesignCheckRow[] {
  const g = input.gate;
  if (g.outcome === "error") return ORDER.map((k) => row(k, "unchecked", "the check could not run on this version"));
  const items = g.items ?? [];
  const checked = new Set(g.checked?.length ? g.checked : items.map((i) => i.ref));
  const fails = g.attempts.at(-1)?.failures ?? [];
  const kindOf = new Map(items.map((i) => [i.ref, i.kind]));
  const isOpening = (ref: string) => OPENING_KINDS.has(kindOf.get(ref) ?? "");
  const says = (fs: typeof fails) => fs.map((f) => f.message).join("; ");

  // Geometry: the frame held (a refused fit fails with no item named) and no item changed size or order.
  const geo = fails.filter((f) => GEOMETRY_REASONS.has(f.reason));
  const frameFailed = g.outcome === "failed" && fails.length === 0;
  const geometry = frameFailed
    ? row("geometry", "fail", "the render changed the photo's frame")
    : geo.length
      ? row("geometry", "fail", says(geo))
      : row("geometry", "pass", "the photo's frame kept; every checked item at its size, in its order");

  const ofKind = (opening: boolean) => [...checked].filter((ref) => isOpening(ref) === opening);
  const failsOf = (opening: boolean) => fails.filter((f) => !GEOMETRY_REASONS.has(f.reason) && isOpening(f.ref) === opening);
  const names = (refs: string[]) => [...new Set(refs.map((r) => items.find((i) => i.ref === r)?.short ?? r))].join(", ");
  const openingRefs = ofKind(true), fixtureRefs = ofKind(false);
  const openings = !openingRefs.length
    ? row("openings", "unchecked", "this photo shows no door or window")
    : failsOf(true).length
      ? row("openings", "fail", says(failsOf(true)))
      : row("openings", "pass", `${names(openingRefs)} where the photo has ${openingRefs.length === 1 ? "it" : "them"}`);
  const fixtures = !fixtureRefs.length
    ? row("fixtures", "unchecked", "this photo shows no fixture the plan places")
    : failsOf(false).length
      ? row("fixtures", "fail", says(failsOf(false)))
      : row("fixtures", "pass", `${names(fixtureRefs)} — each once, in place`);

  const f = input.follows;
  const finishes = !input.anchorLabel || !f
    ? row("finishes", "unchecked", `no view of this room is locked yet${input.styleLine ? ` (${input.styleLine.replace(/ ✓$/, "").replace(/^./, (c) => c.toLowerCase())})` : ""}`)
    : f === "anchor"
      ? row("finishes", "pass", "this view is the anchor — the others follow it")
      : f === "follows"
        ? row("finishes", "pass", followsLine(f, input.anchorLabel, []).replace(/ ✓$/, ""))
        : f === "unchecked"
          ? row("finishes", "unchecked", `rendered before ${input.anchorLabel} was locked`)
          : row("finishes", "fail", followsLine(f, input.anchorLabel, input.followsOff ?? []));

  const drift = approvalDrift(g.design_key, input.designNow);
  const products = !g.design_key || !input.designNow
    ? row("products", "unchecked", "rendered before product choices were recorded on renders")
    : drift
      ? row("products", "fail", `rendered before ${drift}`)
      : row("products", "pass", "rendered with the products the BoQ prices");

  return [geometry, openings, fixtures, finishes, products];
}

// --- room renders (interior QA) and garden scene renders --------------------------------------

/** The interior QA verdict (lib/render-qa.ts), as stored on renders.qa. */
export interface QaLike {
  passed?: boolean;
  structure_preserved?: boolean;
  artifacts?: boolean;
  photorealistic?: boolean;
  reason?: string;
}
/** The garden scene gate (lib/scene-render/pipeline.ts SceneGateRecord), the fields read here. */
export interface SceneGateLike {
  outcome?: string;
  attempts?: { passed?: boolean; placement_checked?: boolean; summary?: string }[];
  consistency?: { passed: boolean; failures: string[]; status: string } | null;
}

/**
 * A room render's five rows: the interior QA (one judgement of walls, openings
 * and camera — not item by item), or the garden scene gate (faithfulness to the
 * 3D design model, built-feature placement, consistency with the anchor view).
 * Null when nothing was checked (a render from before the checks).
 */
export function roomRenderCheckRows(input: { qa: QaLike | null; scene: SceneGateLike | null }): DesignCheckRow[] | null {
  const s = input.scene;
  if (s?.outcome === "passed") {
    const last = s.attempts?.at(-1);
    const c = s.consistency;
    return [
      row("geometry", "pass", "matches the 3D design model of the plan (faithfulness check)"),
      row("openings", "unchecked", "gates and openings are not checked on their own"),
      last?.placement_checked ? row("fixtures", "pass", "every built feature where the plan puts it, once") : row("fixtures", "unchecked", "rendered before the placement check"),
      !c || c.status !== "ran" ? row("finishes", "unchecked", "no anchor view to compare with") : c.passed ? row("finishes", "pass", "the same design as the anchor view") : row("finishes", "fail", c.failures.join("; ") || "differs from the anchor view"),
      row("products", "unchecked", "garden lines are priced from the plan, not from product choices"),
    ];
  }
  const q = input.qa;
  if (!q || typeof q.passed !== "boolean") return null;
  const structure = q.structure_preserved ?? q.passed;
  const clean = q.artifacts === undefined ? q.passed : !q.artifacts && q.photorealistic !== false;
  const reason = q.reason?.trim() || null;
  return [
    structure && clean
      ? row("geometry", "pass", "walls and camera kept from the source; no artifacts")
      : row("geometry", "fail", reason ?? (structure ? "generation artifacts or an unreal image" : "the room's walls or camera changed")),
    structure ? row("openings", "pass", "window and door positions kept — judged with the walls, not one by one") : row("openings", "fail", reason ?? "window or door positions changed"),
    row("fixtures", "unchecked", "fixtures are checked one by one only on photo views"),
    row("finishes", "unchecked", "no locked anchor view for this room's renders"),
    row("products", "unchecked", "this render records no product choices"),
  ];
}
