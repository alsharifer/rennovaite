// =============================================================================
// lib/boq/engine.ts — the deterministic financial model.
//
// takeoff (F-xx quantities) × rates (R-xx resolution) → priced BoQ.
// Same input → byte-identical output. No LLM anywhere in this path.
// =============================================================================

import { RateResolver } from "./rates";
import {
  CONTINGENCY_PCT,
  DEFAULT_FLOORING,
  DEFAULT_TIER,
  ENGINE_VERSION,
  SECTION_ORDER,
  STYLE_FLOORING,
  STYLE_TIER,
  VAT_PCT,
} from "./rules";
import type { Boq, BoqLine, BoqSection, EngineInput, PomiSection } from "./schema";
import { computeTakeoff, type Takeoff } from "./takeoff";

const round2 = (n: number) => Math.round(n * 100) / 100;

export function generateDeterministicBoq(
  input: EngineInput,
): { boq: Boq; takeoff: Takeoff } {
  const tier = (input.styleKey && STYLE_TIER[input.styleKey]) || DEFAULT_TIER;
  const flooring =
    (input.styleKey && STYLE_FLOORING[input.styleKey]) || DEFAULT_FLOORING;

  const takeoff = computeTakeoff(input.rooms, flooring);
  const resolver = new RateResolver(
    input.labourRates,
    input.skus,
    tier,
    input.accessorySelections ?? {},
  );

  const bySection = new Map<PomiSection, BoqLine[]>();

  for (const item of takeoff.items) {
    const rate = resolver.resolve(item.item_key, item.unit);
    const chosen = input.accessorySelections?.[item.item_key];
    const pricedQty = round2(item.quantity * (1 + rate.wastage));
    const line: BoqLine = {
      // A selected accessory renames the line to the thing actually specified —
      // the quantity and its measurement are untouched.
      description: chosen ? `${item.description} — ${chosen.name}` : item.description,
      quantity: pricedQty,
      unit: item.unit,
      rate_aed: rate.rate_aed,
      total_aed: Math.round(pricedQty * rate.rate_aed),
      vendor_or_source: rate.vendor_or_source,
      notes:
        rate.wastage > 0
          ? `${rate.notes ?? ""}; qty incl. ${Math.round(rate.wastage * 100)}% wastage on ${item.quantity} ${item.unit} net (${item.measurement})`.trim()
          : `${rate.notes ?? ""}; ${item.measurement}`.trim(),
      rule_id: `${item.rule_id}/${rate.notes?.split(":")[0] ?? ""}`,
      kind: rate.kind,
      rate_band: rate.rate_band,
      wastage_pct: Math.round(rate.wastage * 100),
      // D1: the chosen catalogue item is the line's element ref, and an
      // unvalidated rate keeps the terracotta-dot convention.
      ...(chosen
        ? {
            element_refs: [chosen.catalog_item_id],
            rate_status: chosen.qs_validated ? ("priced" as const) : ("needs_qs" as const),
          }
        : {}),
    };
    const lines = bySection.get(item.work_section) ?? [];
    lines.push(line);
    bySection.set(item.work_section, lines);
  }

  const sections: BoqSection[] = SECTION_ORDER.filter((s) =>
    bySection.has(s),
  ).map((work_section) => {
    const lines = bySection.get(work_section)!;
    return {
      work_section,
      lines,
      section_total_aed: lines.reduce((s, l) => s + l.total_aed, 0),
    };
  });

  const subtotal_aed = sections.reduce((s, x) => s + x.section_total_aed, 0);
  const contingency_aed = Math.round((subtotal_aed * CONTINGENCY_PCT) / 100);
  const vat_aed = Math.round(((subtotal_aed + contingency_aed) * VAT_PCT) / 100);

  const boq: Boq = {
    sections,
    subtotal_aed,
    contingency_pct: CONTINGENCY_PCT,
    contingency_aed,
    vat_pct: VAT_PCT,
    vat_aed,
    grand_total_aed: subtotal_aed + contingency_aed + vat_aed,
    engine: {
      version: ENGINE_VERSION,
      tier,
      flooring,
      style_key: input.styleKey,
      generated_at: new Date().toISOString(),
    },
  };

  return { boq, takeoff };
}
