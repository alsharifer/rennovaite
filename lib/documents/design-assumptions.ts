// =============================================================================
// lib/documents/design-assumptions.ts — what the design decided on the client's
// behalf, as a list to be worked through (garden pilot G5).
//
// A draft pack carries proposals: keep this tree, replace that gazebo with a
// louvred pergola, remove those planter borders; and a few layout assumptions
// the reference dimensions could not settle (where the front garden sits, where
// the gate is). The review meeting goes through exactly this list, so it is built
// from the plan itself — the same dispositions the take-off priced — never typed
// up separately where it could disagree.
// =============================================================================

import type { GardenFixture } from "@/lib/drawings/garden-sheets";
import { LINEAR_ELEMENT_META } from "@/lib/plan/elements";
import type { PlanGraph } from "@/lib/plan/geometry";
import { replacedBy } from "@/lib/plan/site-reference";

export interface DecisionRow {
  item: string;
  kind: string;
  decision: "KEEP" | "REMOVE" | "REPLACE" | "UNDECIDED";
  /** What it becomes, for a replace. */
  becomes: string | null;
  note: string | null;
}

const clean = (s: string) => s.replace(/\s*\(existing\)\s*/i, " ").replace(/\s{2,}/g, " ").trim();
const decisionOf = (d: string | null | undefined): DecisionRow["decision"] => (d === "keep" ? "KEEP" : d === "remove" ? "REMOVE" : d === "replace" ? "REPLACE" : "UNDECIDED");
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function designDecisions(graph: PlanGraph, fixtures: readonly GardenFixture[]): DecisionRow[] {
  const rows: DecisionRow[] = [];
  for (const r of graph.rooms.filter((x) => x.site_reference)) {
    const was = str(r.spec?.replaces_existing);
    rows.push({
      item: was ? `Existing ${was}` : clean(r.name_en),
      kind: "structure",
      decision: decisionOf(r.disposition),
      becomes: r.disposition === "replace" ? replacedBy(r) ?? (was ? r.name_en : "renewed in place") : null,
      note: str(r.spec?.decision_note),
    });
  }
  for (const e of graph.elements.filter((x) => x.site_reference)) {
    const name = str(e.spec?.name) ?? LINEAR_ELEMENT_META[e.kind].label;
    rows.push({ item: clean(name), kind: LINEAR_ELEMENT_META[e.kind].label.toLowerCase(), decision: decisionOf(e.disposition), becomes: e.disposition === "replace" ? replacedBy(e) ?? "renewed in place" : null, note: str(e.spec?.decision_note) });
  }
  for (const f of fixtures.filter((x) => x.site_reference)) {
    rows.push({ item: clean(str(f.spec?.name) ?? f.type.replace(/_/g, " ")), kind: f.type.replace(/_/g, " "), decision: decisionOf(f.disposition), becomes: f.disposition === "replace" ? str(f.spec?.replaced_by) ?? "renewed in place" : null, note: str(f.spec?.decision_note) });
  }
  for (const c of graph.context.filter((x) => x.site_reference)) {
    rows.push({ item: c.name, kind: "boundary", decision: decisionOf(c.disposition), becomes: null, note: null });
  }
  for (const o of (graph.openings ?? []).filter((x) => x.site_reference)) {
    rows.push({ item: clean(str(o.spec?.name) ?? o.type), kind: o.type, decision: decisionOf(o.disposition), becomes: o.disposition === "replace" ? str(o.spec?.replaced_by) ?? "renewed in place" : null, note: str(o.spec?.decision_note) });
  }
  const order = { REPLACE: 0, REMOVE: 1, KEEP: 2, UNDECIDED: 3 } as const;
  return rows.sort((a, b) => order[a.decision] - order[b.decision] || a.item.localeCompare(b.item));
}

/** Layout assumptions recorded on the plan (spec.assumption on zones, runs, context). */
export function layoutAssumptions(graph: PlanGraph): string[] {
  const out: string[] = [];
  for (const r of graph.rooms) if (str(r.spec?.assumption)) out.push(`${r.name_en}: ${str(r.spec?.assumption)}`);
  for (const e of graph.elements) if (str(e.spec?.assumption)) out.push(`${str(e.spec?.name) ?? LINEAR_ELEMENT_META[e.kind].label}: ${str(e.spec?.assumption)}`);
  // From context notes, only the LAYOUT assumptions: an assumed height of the
  // neighbouring villa is a drawing caveat, not a decision for the client.
  for (const c of graph.context) {
    const layout = (c.note ?? "")
      .split(/;\s*|\.\s+/)
      .filter((seg) => /assum/i.test(seg) && !/height/i.test(seg))
      // A split inside a parenthesis leaves it open: close it.
      .map((seg) => (seg.split("(").length > seg.split(")").length ? `${seg})` : seg));
    if (layout.length) out.push(`${c.name}: ${layout.join("; ")}`);
  }
  return out;
}
