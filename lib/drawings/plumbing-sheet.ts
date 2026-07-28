// lib/drawings/plumbing-sheet.ts — plumbing / water services plan (P2).
import { PLUMBING_TYPES } from "@/lib/overlays/catalog";
import type { PlanGraph } from "@/lib/plan/geometry";

import { renderServicesSheet, type OverlayFixtureForSheet } from "./overlay-sheet";
import type { SheetMeta } from "./sheet";

export function renderPlumbingSheet(
  graph: PlanGraph,
  fixtures: OverlayFixtureForSheet[],
  meta: SheetMeta,
  sheet: { sheetNumber: string; title: string },
): string {
  return renderServicesSheet("plumbing", graph, fixtures, meta, sheet, PLUMBING_TYPES);
}
