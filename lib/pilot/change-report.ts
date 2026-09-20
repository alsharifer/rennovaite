// =============================================================================
// lib/pilot/change-report.ts — the change-propagation receipt (garden pilot G5).
//
// Step 5 amends the client garden from derived to measured dimensions and
// regenerates everything. The receipt is the diff: every quantity that moved,
// old → new, and what that did to the BoQ total. It is the evidence that one
// change to the plan propagated through every quantity — nothing re-typed,
// nothing missed.
//
// Pure: a snapshot is taken from a stored BoQ + take-off rows + draft status, and
// the report compares two snapshots.
// =============================================================================

export interface QtyLine {
  key: string;
  section: string;
  description: string;
  quantity: number;
  unit: string;
  rate_aed: number;
  total_aed: number;
  qty_derived: boolean;
}

export interface QtySnapshot {
  captured_at: string;
  boq_id: string | null;
  draft: boolean;
  derived: string[];
  grand_total_aed: number;
  lines: QtyLine[];
  takeoff: { work_item_key: string; element_id: string; qty: number; unit: string }[];
}

interface BoqLike {
  grand_total_aed: number;
  sections: { work_section: string; lines: { description: string; quantity: number; unit: string; rate_aed: number; total_aed: number; rule_id?: string; qty_derived?: boolean }[] }[];
}

export function snapshotOf(input: {
  capturedAt: string;
  boqId: string | null;
  boq: BoqLike;
  takeoff: readonly { work_item_key: string; element_id: string | null; qty: number; unit: string }[];
  draft: { draft: boolean; derived: string[] };
}): QtySnapshot {
  const seen = new Map<string, number>();
  const lines: QtyLine[] = [];
  for (const s of input.boq.sections) {
    for (const l of s.lines) {
      const base = `${s.work_section}|${l.rule_id ?? l.description}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      lines.push({
        key: n === 1 ? base : `${base}#${n}`,
        section: s.work_section,
        description: l.description,
        quantity: Number(l.quantity),
        unit: l.unit,
        rate_aed: Number(l.rate_aed),
        total_aed: Number(l.total_aed),
        qty_derived: l.qty_derived === true,
      });
    }
  }
  return {
    captured_at: input.capturedAt,
    boq_id: input.boqId,
    draft: input.draft.draft,
    derived: input.draft.derived,
    grand_total_aed: Number(input.boq.grand_total_aed),
    lines,
    takeoff: input.takeoff
      .filter((t) => t.element_id)
      .map((t) => ({ work_item_key: t.work_item_key, element_id: t.element_id!, qty: Number(t.qty), unit: t.unit }))
      .sort((a, b) => a.work_item_key.localeCompare(b.work_item_key) || a.element_id.localeCompare(b.element_id)),
  };
}

export interface MovedLine {
  key: string;
  section: string;
  description: string;
  unit: string;
  old_qty: number | null;
  new_qty: number | null;
  delta_qty: number;
  delta_pct: number | null;
  old_total_aed: number;
  new_total_aed: number;
  delta_aed: number;
  status: "moved" | "added" | "removed";
}

export interface ChangeReport {
  from: string;
  to: string;
  moved: MovedLine[];
  unchanged: number;
  element_rows_moved: { work_item_key: string; element_id: string; old_qty: number | null; new_qty: number | null }[];
  boq: { old_total_aed: number; new_total_aed: number; delta_aed: number; delta_pct: number | null };
  draft: { before: boolean; after: boolean; still_derived: string[]; watermark_drops: boolean };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function changeReport(before: QtySnapshot, after: QtySnapshot): ChangeReport {
  const a = new Map(before.lines.map((l) => [l.key, l]));
  const b = new Map(after.lines.map((l) => [l.key, l]));
  const moved: MovedLine[] = [];
  let unchanged = 0;
  for (const key of [...new Set([...a.keys(), ...b.keys()])]) {
    const o = a.get(key);
    const n = b.get(key);
    if (o && n && o.quantity === n.quantity && o.total_aed === n.total_aed) {
      unchanged++;
      continue;
    }
    const ref = (n ?? o)!;
    const oq = o?.quantity ?? null;
    const nq = n?.quantity ?? null;
    moved.push({
      key,
      section: ref.section,
      description: ref.description,
      unit: ref.unit,
      old_qty: oq,
      new_qty: nq,
      delta_qty: r2((nq ?? 0) - (oq ?? 0)),
      delta_pct: oq ? r2((((nq ?? 0) - oq) / oq) * 100) : null,
      old_total_aed: o?.total_aed ?? 0,
      new_total_aed: n?.total_aed ?? 0,
      delta_aed: r2((n?.total_aed ?? 0) - (o?.total_aed ?? 0)),
      status: o && n ? "moved" : n ? "added" : "removed",
    });
  }
  const ea = new Map(before.takeoff.map((t) => [`${t.work_item_key}|${t.element_id}`, t.qty]));
  const eb = new Map(after.takeoff.map((t) => [`${t.work_item_key}|${t.element_id}`, t.qty]));
  const element_rows_moved = [...new Set([...ea.keys(), ...eb.keys()])]
    .filter((k) => ea.get(k) !== eb.get(k))
    .map((k) => {
      const [work_item_key, element_id] = k.split("|") as [string, string];
      return { work_item_key, element_id, old_qty: ea.get(k) ?? null, new_qty: eb.get(k) ?? null };
    });
  const delta = r2(after.grand_total_aed - before.grand_total_aed);
  return {
    from: before.captured_at,
    to: after.captured_at,
    moved,
    unchanged,
    element_rows_moved,
    boq: { old_total_aed: before.grand_total_aed, new_total_aed: after.grand_total_aed, delta_aed: delta, delta_pct: before.grand_total_aed ? r2((delta / before.grand_total_aed) * 100) : null },
    draft: { before: before.draft, after: after.draft, still_derived: after.derived, watermark_drops: before.draft && !after.draft },
  };
}
