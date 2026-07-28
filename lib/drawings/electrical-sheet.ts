// lib/drawings/electrical-sheet.ts — electrical services plan (P2).
import { ELECTRICAL_TYPES } from "@/lib/overlays/catalog";
import type { PlanGraph } from "@/lib/plan/geometry";

import { renderServicesSheet, type OverlayFixtureForSheet } from "./overlay-sheet";
import type { SheetMeta } from "./sheet";

export function renderElectricalSheet(
  graph: PlanGraph,
  fixtures: OverlayFixtureForSheet[],
  meta: SheetMeta,
  sheet: { sheetNumber: string; title: string },
): string {
  return renderServicesSheet("electrical", graph, fixtures, meta, sheet, ELECTRICAL_TYPES);
}
