// =============================================================================
// lib/drawings/sheet-errors.ts — a sheet that cannot be drawn names itself (C2).
//
// Mudon's drawing set failed for a month with "Cannot read properties of
// undefined (reading 'map')" on the Documents page: nobody could tell which
// sheet or which field. Every sheet is now built through `drawSheet`, which
//   1. checks the plan graph it draws from has every array field a sheet maps
//      over (PLAN_GRAPH_ARRAYS) — a missing one fails as "the plan graph has no
//      `elements`";
//   2. turns any other failure into "Sheet A-102 "Proposed / Demolition Plan"
//      could not be drawn: <reason>".
// No bare TypeError reaches the UI.
// =============================================================================

import { PLAN_GRAPH_ARRAYS, type PlanGraph } from "@/lib/plan/geometry";

export class SheetBuildError extends Error {
  readonly sheetNumber: string;
  readonly sheetTitle: string;
  /** The graph field that was missing, when that is the cause. */
  readonly field: string | null;
  constructor(sheetNumber: string, sheetTitle: string, reason: string, field: string | null = null) {
    super(`Sheet ${sheetNumber} "${sheetTitle}" could not be drawn: ${reason}`);
    this.name = "SheetBuildError";
    this.sheetNumber = sheetNumber;
    this.sheetTitle = sheetTitle;
    this.field = field;
  }
}

/** The first array field a sheet would map over that the graph lacks, or null. */
export function missingGraphField(graph: PlanGraph | null | undefined): string | null {
  if (!graph) return "graph";
  for (const f of PLAN_GRAPH_ARRAYS) if (!Array.isArray((graph as unknown as Record<string, unknown>)[f])) return f;
  return null;
}

/** Build one sheet; any failure names the sheet (and the field, when that is the cause). */
export function drawSheet<T>(sheetNumber: string, sheetTitle: string, graphs: readonly (PlanGraph | null | undefined)[], build: () => T): T {
  for (const g of graphs) {
    const field = missingGraphField(g);
    if (field) throw new SheetBuildError(sheetNumber, sheetTitle, field === "graph" ? "there is no plan graph" : `the plan graph has no \`${field}\``, field);
  }
  try {
    return build();
  } catch (e) {
    if (e instanceof SheetBuildError) throw e;
    const reason = e instanceof Error ? e.message : String(e);
    // A property read on a missing value names the property the sheet asked for.
    const prop = reason.match(/reading '([^']+)'/)?.[1] ?? null;
    throw new SheetBuildError(sheetNumber, sheetTitle, prop ? `a value it reads \`${prop}\` from is missing (${reason})` : reason, prop);
  }
}
