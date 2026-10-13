// =============================================================================
// lib/plan/scope.ts — rooms in this renovation (K12, spec §7.4; migration 058).
// CLIENT-SAFE and pure.
//
// `rooms.in_scope` (default true). An out-of-scope room stays on the plan — the
// plan graph's metric scale is derived from EVERY room's area and the overlap
// check needs every room's floor — but contributes nothing room-level:
//
//   priced       no element take-off (floor, ceiling, wet tiling; a wall only
//                when no room on either side of it is in scope), no Q-rule
//                quantities, no joinery counts, no fixtures placed in it, no
//                landscape take-off for a zone;
//   rendered     not in the renders list ("N not in this renovation"), not in
//                "Generate all", not counted for 03 Renders' lock progress;
//   scheduled    not in the timeline's drivers.
//
// WHOLE-HOME — kept whatever the scope, because no single room carries it:
//   Preliminaries   site set-up, DM/DEWA permits (the approvals), scaffold,
//                   handover clean and the civil-alterations allowance are ONE
//                   per project (Q-05, Q-32, Q-33, Q-36, Q-37; garden GL-01–03).
//                   Q-11 (staircase renovation) is a per-project allowance too —
//                   emitted even without a stairs room; a ruling is pending.
//                   Area-driven prelims (soft strip, floor removal, skips,
//                   floor protection) follow the rooms being renovated.
//   Demolition      walls removed by the PROPOSED plan — a structural decision
//                   about the home, not about one room's finishes.
//   Aluminium       the S6 aluminium & glazing allowance is a whole-unit
//                   envelope allowance (not per room); dropped only when no
//                   interior room is in scope at all.
//   MEP / fixtures  a fixture not placed in a room (mains, a DB) stays; a
//                   fixture placed IN an out-of-scope room goes with it.
// =============================================================================

/** Absent (pre-058) or true = in this renovation. */
export const isInScope = (r: { in_scope?: boolean | null }): boolean => r.in_scope !== false;

/** "11 of 13 rooms in scope" and the names left out. */
export function scopeSummary<R extends { in_scope?: boolean | null; name_en?: string | null }>(rooms: readonly R[]): { inScope: number; total: number; out: string[]; all: boolean; label: string } {
  const inScope = rooms.filter(isInScope).length;
  const out = rooms.filter((r) => !isInScope(r)).map((r) => (r.name_en ?? "Room").trim());
  return { inScope, total: rooms.length, out, all: inScope === rooms.length, label: `${inScope} of ${rooms.length} room${rooms.length === 1 ? "" : "s"} in scope` };
}

/** The sentence the 01 Plan panel and the walkthrough print (Figma 81:716). */
export const SCOPE_NOTE = "Rooms you leave out are not rendered, priced or scheduled. Whole-home work — preliminaries, approvals, MEP mains — stays in.";
export const SCOPE_REGENERATE_NOTE = "Changing the list updates your cost when you regenerate (a new revision, so nothing is lost).";

/** "Scope: 2 rooms removed" / "Scope: 1 room added, 2 rooms removed" — the revision diff's cause. */
export function scopeChangeSummary(added: number, removed: number): string {
  const parts: string[] = [];
  if (added) parts.push(`${added} room${added === 1 ? "" : "s"} added`);
  if (removed) parts.push(`${removed} room${removed === 1 ? "" : "s"} removed`);
  return `Scope: ${parts.join(", ") || "unchanged"}`;
}

/**
 * The net change across a window of scope events (each `{ added, removed }` room
 * ids, in order): a room taken out and put back is no change.
 */
export function netScopeChange(events: readonly { added?: readonly string[]; removed?: readonly string[] }[]): { added: string[]; removed: string[] } {
  const state = new Map<string, "added" | "removed">();
  for (const e of events) {
    for (const id of e.removed ?? []) {
      if (state.get(id) === "added") state.delete(id);
      else state.set(id, "removed");
    }
    for (const id of e.added ?? []) {
      if (state.get(id) === "removed") state.delete(id);
      else state.set(id, "added");
    }
  }
  const added: string[] = [];
  const removed: string[] = [];
  for (const [id, s] of state) (s === "added" ? added : removed).push(id);
  return { added, removed };
}
