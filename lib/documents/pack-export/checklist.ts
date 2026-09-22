// =============================================================================
// lib/documents/pack-export/checklist.ts — the export gate, readable (T5).
//
// Before T5 a refused export was a raw 409 JSON body behind a link. The gate
// now comes back as a checklist a designer can work through: what is
// undecided, untyped or unpriced, BY NAME, and the page to fix it on. Pure.
//
// The gate is SCOPE-AWARE: interior rooms are priced by the interior take-off,
// so they block only when drawn with no interior work priced at all
// (lib/documents/parity.ts interiorRows). It blocks only on genuinely
// undecided, untyped or unpriced scope — plus a working name on a client cover.
// =============================================================================

import type { PackReadiness } from "@/lib/documents/pack-readiness";
import type { ParityResult } from "@/lib/documents/parity";

import type { ChecklistItem } from "./types";

/** A name that is a working label, not something to print on a client's cover. */
export function isWorkingName(name: string | null | undefined): boolean {
  if (!name || !name.trim()) return true;
  return /\b(ground truth|untitled|scratch|stand-?in|fixture|isolation|test|verification)\b|\(dev\)/i.test(name);
}

export function buildChecklist(input: {
  projectId: string;
  readiness: PackReadiness;
  parity: ParityResult | null;
  documentName: string | null;
}): ChecklistItem[] {
  const { projectId, readiness: r, parity } = input;
  const plan = { label: "Open the plan", href: `/project/${projectId}/plan` };
  const boq = { label: "Open the BoQ", href: `/project/${projectId}/boq` };
  const items: ChecklistItem[] = [
    {
      key: "counters",
      ok: r.untyped_counters.length === 0,
      title: "Every new counter has a type",
      detail: r.untyped_counters.length ? "A counter with no type prices at the cheaper default — choose bar or BBQ." : "All counters are typed.",
      items: r.untyped_counters,
      fix: r.untyped_counters.length ? plan : null,
    },
    {
      key: "undecided",
      ok: r.undecided.length === 0,
      title: "Every existing item is decided (keep / remove / replace)",
      detail: r.undecided.length ? "An undecided existing item is in no quantity at all — decide it on the plan." : "Every existing item has a decision.",
      items: r.undecided,
      fix: r.undecided.length ? plan : null,
    },
    {
      key: "boq",
      ok: r.has_boq && r.stale_boq_needs_selection.length === 0,
      title: "The BoQ is generated and current",
      detail: !r.has_boq ? "No BoQ has been generated yet." : r.stale_boq_needs_selection.length ? "The BoQ still carries an untyped counter — regenerate it." : "The latest BoQ matches the plan.",
      items: r.stale_boq_needs_selection,
      fix: !r.has_boq || r.stale_boq_needs_selection.length ? boq : null,
    },
  ];
  if (parity) {
    const unpricedEls = parity.elements.filter((e) => e.status === "fail");
    items.push({
      key: "priced",
      ok: unpricedEls.length === 0,
      title: "Everything drawn with a cost is priced",
      detail: unpricedEls.length ? "These are drawn with a cost impact but no BoQ line prices them." : "Every drawn cost is on a BoQ line.",
      items: unpricedEls.map((e) => `${e.name} — ${e.reason}`),
      fix: unpricedEls.length ? boq : null,
    });
    const hiddenLines = parity.lines.filter((l) => l.status === "fail");
    items.push({
      key: "shown",
      ok: hiddenLines.length === 0,
      title: "Every BoQ line is drawn and shown",
      detail: hiddenLines.length ? "A priced line the client cannot find on a drawing or in a view." : "Every line is on a drawing and in a view.",
      items: hiddenLines.map((l) => `${l.rule_id} ${l.description} — ${l.reason}`),
      fix: hiddenLines.length ? plan : null,
    });
    const overlays = (parity.overlays ?? []).filter((o) => o.status === "fail");
    items.push({
      key: "overlays",
      ok: overlays.length === 0,
      title: "Services symbols match their BoQ quantities",
      detail: overlays.length ? "A symbol drawn and not counted, or counted and not drawn." : "Every symbol is counted once.",
      items: overlays.map((o) => `${o.type}: ${o.reason}`),
      fix: overlays.length ? plan : null,
    });
  }
  items.push({
    key: "name",
    ok: !isWorkingName(input.documentName),
    title: "The documents carry a client-facing name",
    detail: isWorkingName(input.documentName)
      ? `"${input.documentName ?? ""}" is a working name. Set the name the client should see before exporting.`
      : `Covers print "${input.documentName}".`,
    items: [],
    fix: null,
  });
  return items;
}

export const checklistReady = (items: readonly ChecklistItem[]) => items.every((i) => i.ok);
