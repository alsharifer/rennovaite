// =============================================================================
// lib/plan/plan-gate.ts — does the plan page open the editor? (K10 #4) Pure.
//
// THE rule: the editor opens whenever the plan HAS ROOMS — counted from the
// same list the page header counts ("13 ROOMS DETECTED"), so the header and
// the gate can never disagree — or is an authored plan (G1: ready the moment
// it exists, rooms or not). "No drawing attached" / "not analysed" is only for
// a plan with truly no rooms.
//
// Before K10 a parsed plan also needed `parsed_json`: the dev Demo villa (13
// rooms, seeded without a parse record or a drawing) showed "No drawing
// attached" under a header that counted its 13 rooms.
// =============================================================================

export type PlanGate = "editor" | "not_analysed";

export function planGate(p: { authored: boolean; roomCount: number }): PlanGate {
  return p.authored || p.roomCount > 0 ? "editor" : "not_analysed";
}
