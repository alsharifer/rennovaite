// =============================================================================
// lib/scene-render/design-spec.ts — ONE design description shared by every view
// of a garden (garden pilot G5c, cross-view consistency).
//
// Renders of the same garden from different cameras came back as three
// different gardens: a shade-sail pergola here, a timber one there, sandstone
// paving in one view and grey slabs in the next. Each restyle was conditioned
// only on its own scene image and a style sentence, so every attempt re-invented
// the materials. And the style sentence itself argued with the design (Desert
// Modern's "linear corten planters" appeared in view after view, where the
// design has none).
//
// This module states what the DESIGN is, from the plan and the BoQ vocabulary —
// the same text for every camera of the project — so the materials, the pergola
// design and the planting palette are fixed before any model paints anything.
// Deterministic, and part of the render cache key.
// =============================================================================

import { createHash } from "node:crypto";

import type { GardenFixture } from "@/lib/drawings/garden-sheets";
import type { GardenStyle } from "@/lib/garden-styles";
import type { PlanGraph } from "@/lib/plan/geometry";
import { isInDesign } from "@/lib/plan/site-reference";

/** Planting and finish vocabulary per garden direction. Colours are the style palette's. */
const DIRECTION: Record<string, { planting: string; walls: string; metal: string; paving: string; counter: string; bench: string }> = {
  "desert-modern": {
    planting: "agave, ornamental grasses (pennisetum, muhlenbergia), low silver-leaved shrubs and dwarf olive, on dark mulch",
    walls: "smooth rendered off-white masonry",
    metal: "dark bronze powder-coated aluminium",
    paving: "large-format 1200 × 600 mm porcelain in warm light sand, narrow matching grout joints",
    counter: "clad in the paving porcelain with a honed stone top",
    bench: "rendered masonry base with a slatted hardwood seat",
  },
  "courtyard-majlis": {
    planting: "date palms, bougainvillea, jasmine and clipped myrtle, on light gravel",
    walls: "lime-rendered warm sand masonry",
    metal: "dark brown powder-coated aluminium",
    paving: "large-format 1200 × 600 mm porcelain in pale limestone tone, narrow matching grout joints",
    counter: "clad in honed limestone with a patterned tile upstand",
    bench: "rendered masonry base with cushioned timber seat",
  },
};

export function designSpec(graph: PlanGraph, fixtures: readonly GardenFixture[], variants: Record<string, string | null>, style: GardenStyle): string {
  const d = DIRECTION[style.key] ?? DIRECTION["desert-modern"]!;
  const rooms = graph.rooms.filter(isInDesign);
  const els = graph.elements.filter(isInDesign);
  const has = (t: string) => rooms.some((r) => r.type === t);
  const parts: string[] = [];
  const pergola = rooms.find((r) => r.type === "structure" && r.spec?.form !== "gazebo");
  if (pergola) {
    const louvred = pergola.spec?.variant === "louvered" || [pergola.spec?.form, pergola.spec?.system].some((v) => typeof v === "string" && /louv/i.test(v));
    parts.push(
      louvred
        ? `pergola — ONE design everywhere: a motorised louvred aluminium pergola, ${d.metal}, square 150 mm posts and deep beams, a flat roof of parallel louvre blades, no fabric, no sails, no timber rafters`
        : `pergola — ONE design everywhere: ${d.metal} posts and beams with a flat slatted roof`,
    );
  }
  if (has("paving") || has("path")) parts.push(`paving and paths — ${d.paving}`);
  if (has("artificial_grass")) parts.push("lawn — even, clean-edged artificial grass");
  // A garden that HAS raised planters must not be told it has none: the design
  // specification is what the consistency gate holds every view to, and on the
  // reference garden (which has planter runs and planter boxes) the "not raised
  // planters" clause failed three accurate views (G5c).
  const planters = els.some((e) => e.kind === "planter_run") || fixtures.some((f) => f.type === "planter_box" && isInDesign({ site_reference: f.site_reference ?? false, disposition: f.disposition ?? null }));
  if (has("planting_bed") || planters) {
    parts.push(
      planters
        ? `planting — ${d.planting}; in the raised planters and planter boxes where the plan draws them, and in beds level with the paving elsewhere`
        : `planting beds — ${d.planting}; beds are level with the paving, not raised planters`,
    );
  }
  const counters = els.filter((e) => e.kind === "counter_run");
  if (counters.some((e) => variants[e.id] === "bbq")) parts.push(`BBQ counter — ${d.counter}, with a built-in stainless-steel gas grill and an inset stainless sink with a tap`);
  if (els.some((e) => e.kind === "bench_run")) parts.push(`built-in bench — ${d.bench}`);
  parts.push(`boundary and separator walls — ${d.walls}, as they stand today`);
  // Existing structures on the plot (a timber slat pergola over the villa doorway on
  // the reference garden) are part of what every view shows, and are not the design's
  // own structure: naming them stops the consistency gate reading one as a second pergola.
  const existing = graph.context.filter((c) => c.kind === "existing_structure" && isInDesign(c));
  if (existing.length) parts.push(`existing structures that stay as they are — ${[...new Set(existing.map((c) => c.name.toLowerCase()))].join(", ")} (not part of the new work, and not a second pergola design)`);
  const trees = fixtures.filter((f) => f.type === "tree" && f.site_reference && f.disposition === "keep");
  if (trees.length) {
    const species = [...new Set(trees.map((t) => String((t.spec as Record<string, unknown> | null)?.species ?? "tree")))];
    parts.push(`existing trees kept exactly as they are (${species.join(", ")})`);
  }
  return `Design specification — identical in every view of this garden: ${parts.join("; ")}. Add no planters, screens, water features, steps or structures that are not in the model.`;
}

/** Short stable hash of a spec, for the render cache key. */
export function specHash(spec: string): string {
  return createHash("sha256").update(spec).digest("hex").slice(0, 16);
}
