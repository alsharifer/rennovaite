// =============================================================================
// lib/boq/garden-boq-feed.ts — merge landscape sections into a BoQ (G3).
//
// Reads the drawn garden — zones from `rooms`, runs from `plan_elements`,
// discrete items and points from `plan_fixtures` — runs the G2 take-off rules
// over it, prices at the landscape rate book, and appends the resulting POMI
// sections. Called from app/api/generate-boq for BOTH the deterministic-engine
// path and the legacy LLM path, exactly like the P2 overlay feed.
//
// Fully best-effort: a project with no landscape zones gets its BoQ back
// unchanged, byte for byte. That is what keeps every interior project out of
// this code path.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { LINEAR_ELEMENT_META } from "@/lib/plan/elements";
import { isOutdoorType } from "@/lib/plan/zones";

import {
  computeGardenTakeoff,
  findDoubleCounts,
  priceGardenTakeoff,
  type GardenPoint,
  type GardenRun,
  type GardenTakeoffElement,
  type GardenTakeoffInput,
  type GardenUnit,
} from "./garden-takeoff";
import { SECTION_ORDER } from "./rules";
import type { PomiSection, ScopeItem } from "./schema";

const round2 = (n: number) => Math.round(n * 100) / 100;

interface BoqSectionLike {
  work_section: string;
  lines: unknown[];
  section_total_aed: number;
}

interface BoqLike {
  sections: BoqSectionLike[];
  subtotal_aed: number;
  contingency_pct: number;
  contingency_aed: number;
  vat_pct: number;
  vat_aed: number;
  grand_total_aed: number;
}

/** The garden as the platform reads it off the plan. */
export interface GardenCapture extends GardenTakeoffInput {
  planId: string | null;
}

/**
 * Load everything the landscape take-off needs for a project. Every read is
 * best-effort: a missing table (pre-031/034) yields an empty list rather than
 * an error, so an interior project cannot be broken by a garden migration it
 * has not run.
 */
export async function captureGarden(
  projectId: string,
  supabase: SupabaseClient,
): Promise<GardenCapture> {
  const empty: GardenCapture = { planId: null, zones: [], runs: [], units: [], points: [] };

  // `plot_width_m` is metres per normalised unit — the measured scale an
  // authored plan carries (G1). Runs are stored in normalised space, so without
  // it there is no honest length and the runs are dropped rather than guessed.
  const { data: plan } = await supabase
    .from("plans")
    .select("id, plot_width_m")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; plot_width_m: number | null }>();
  if (!plan) return empty;
  const mPerUnit = Number(plan.plot_width_m ?? 0);

  const { data: rooms, error: roomsErr } = await supabase
    .from("rooms")
    .select("id, name_en, room_type, area_m2")
    .eq("plan_id", plan.id)
    .returns<{ id: string; name_en: string | null; room_type: string | null; area_m2: number | null }[]>();
  if (roomsErr) return { ...empty, planId: plan.id };

  const zones = (rooms ?? [])
    .filter((r) => isOutdoorType(r.room_type))
    .map((r) => ({
      id: r.id,
      name: r.name_en?.trim() || "Zone",
      kind: r.room_type as string,
      area_m2: Number(r.area_m2 ?? 0),
    }));

  // No drawn garden → nothing to price, and nothing else needs loading.
  if (zones.length === 0) return { ...empty, planId: plan.id };

  let runs: GardenRun[] = [];
  try {
    const { data, error } = await supabase
      .from("plan_elements")
      .select("id, kind, polyline, variant")
      .eq("plan_id", plan.id)
      .returns<{ id: string; kind: string; polyline: unknown; variant: string | null }[]>();
    if (!error) {
      runs = (data ?? [])
        .filter((e) => e.kind !== "boundary_wall")
        .map((e): GardenRun => ({
          id: e.id,
          kind: e.kind as GardenRun["kind"],
          length_m: polylineLengthM(e.polyline, mPerUnit),
          variant: e.variant === "bbq" ? "bbq" : e.variant === "bar" ? "bar" : undefined,
        }))
        .filter((r) => r.length_m > 0 && r.kind in LINEAR_ELEMENT_META);
    }
  } catch {
    /* plan_elements absent — no runs */
  }

  let units: GardenUnit[] = [];
  let points: GardenPoint[] = [];
  try {
    const { data, error } = await supabase
      .from("plan_fixtures")
      .select("id, layer, type, room_id")
      .eq("project_id", projectId)
      .returns<{ id: string; layer: string; type: string; room_id: string | null }[]>();
    if (!error) {
      for (const f of data ?? []) {
        if (f.layer === "landscape") {
          units.push({ id: f.id, kind: f.type as GardenUnit["kind"] });
        } else {
          points.push({ id: f.id, type: f.type, zone_id: f.room_id });
        }
      }
      units = units.filter((u) =>
        ["planter_box", "wall_feature", "bbq_grill"].includes(u.kind),
      );
      points = points.filter((p) => p.type === "garden_light" || p.type === "boundary_light");
    }
  } catch {
    /* plan_fixtures absent — no units or points */
  }

  return { planId: plan.id, zones, runs, units, points };
}

/** A run's polyline is in normalised plan space; metres come from the plot
 *  width, exactly as the elements editor reports lengths. */
function polylineLengthM(value: unknown, mPerUnit: number): number {
  if (!Array.isArray(value) || mPerUnit <= 0) return 0;
  let total = 0;
  for (let i = 0; i < value.length - 1; i++) {
    const a = value[i] as unknown[];
    const b = value[i + 1] as unknown[];
    if (!Array.isArray(a) || !Array.isArray(b)) return 0;
    const [ax, ay] = a as number[];
    const [bx, by] = b as number[];
    if (![ax, ay, bx, by].every((n) => typeof n === "number" && Number.isFinite(n))) return 0;
    total += Math.hypot(bx! - ax!, by! - ay!);
  }
  return round2(total * mPerUnit);
}

export interface GardenBoqResult {
  sections: {
    work_section: PomiSection;
    lines: Record<string, unknown>[];
    section_total_aed: number;
  }[];
  items: ScopeItem[];
  elements: GardenTakeoffElement[];
  total_aed: number;
  violations: ReturnType<typeof findDoubleCounts>;
}

/** Build the landscape sections for a captured garden. Pure. */
export function buildGardenSections(capture: GardenTakeoffInput): GardenBoqResult {
  const takeoff = computeGardenTakeoff(capture);
  const priced = priceGardenTakeoff(takeoff.items);
  const violations = findDoubleCounts(takeoff.items);

  const refsByKey = new Map<string, string[]>();
  for (const e of takeoff.elements) {
    const arr = refsByKey.get(e.item_key) ?? [];
    arr.push(e.element_id);
    refsByKey.set(e.item_key, arr);
  }

  const bySection = new Map<PomiSection, Record<string, unknown>[]>();
  for (const l of priced) {
    const refs = refsByKey.get(l.item_key);
    const line: Record<string, unknown> = {
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      rate_aed: l.rate_aed,
      total_aed: l.total_aed,
      vendor_or_source: l.vendor_or_source,
      notes: l.measurement,
      rule_id: l.rule_id,
      kind: "supply_and_install",
      rate_band: "sku",
      wastage_pct: 0,
      // An unflagged landscape line is a rate somebody actually paid. Saying so
      // is the whole point of ingesting the actuals.
      rate_status: l.rate_status ?? "actual_transaction",
      ...(l.qty_derived ? { qty_derived: true } : {}),
      // The zones, runs or units this line was measured from — what makes it
      // traceable back to the drawing rather than just a number in a table.
      ...(refs && refs.length > 0 ? { element_refs: refs.slice().sort() } : {}),
    };
    const arr = bySection.get(l.work_section) ?? [];
    arr.push(line);
    bySection.set(l.work_section, arr);
  }

  const sections = SECTION_ORDER.filter((s) => bySection.has(s)).map((work_section) => {
    const lines = bySection.get(work_section)!;
    return {
      work_section,
      lines,
      section_total_aed: round2(lines.reduce((s, l) => s + (l.total_aed as number), 0)),
    };
  });

  return {
    sections,
    items: takeoff.items,
    elements: takeoff.elements,
    total_aed: round2(sections.reduce((s, x) => s + x.section_total_aed, 0)),
    violations,
  };
}

/**
 * Append the landscape sections to a generated BoQ and recompute the
 * contingency / VAT / grand-total chain. Returns the same object it was given
 * when there is no garden.
 */
export async function appendGardenSections<T extends BoqLike>(
  boq: T,
  projectId: string,
  supabase: SupabaseClient,
): Promise<T> {
  try {
    const capture = await captureGarden(projectId, supabase);
    if (capture.zones.length === 0) return boq;

    const built = buildGardenSections(capture);
    if (built.sections.length === 0) return boq;

    if (built.violations.length > 0) {
      // Loud, but never silent and never fatal: a violation means a quantity is
      // counted twice, and the BoQ still has to reach the QS so they can see it.
      console.error(
        "[boq/garden] double-count violations:",
        built.violations.map((v) => `${v.offender} (${v.why})`).join("; "),
      );
    }

    // A garden line lands in Preliminaries and Demolition, which an interior
    // BoQ may already have. Merge into the existing section rather than
    // emitting a second one with the same name.
    for (const s of built.sections) {
      const existing = boq.sections.find((x) => x.work_section === s.work_section);
      if (existing) {
        existing.lines.push(...s.lines);
        existing.section_total_aed = round2(existing.section_total_aed + s.section_total_aed);
      } else {
        boq.sections.push(s as unknown as BoqSectionLike);
      }
    }

    // Per-element take-off rows, so a zone can be asked what it costs. Same
    // table the interior P4 path writes; best-effort like everything else here.
    await persistGardenTakeoff(projectId, built.elements, supabase);

    // Keep the canonical order after the merge.
    const rank = new Map(SECTION_ORDER.map((s, i) => [s as string, i] as const));
    boq.sections.sort(
      (a, b) => (rank.get(a.work_section) ?? 999) - (rank.get(b.work_section) ?? 999),
    );

    boq.subtotal_aed = round2(boq.sections.reduce((s, x) => s + x.section_total_aed, 0));
    boq.contingency_aed = Math.round((boq.subtotal_aed * boq.contingency_pct) / 100);
    boq.vat_aed = Math.round(
      ((boq.subtotal_aed + boq.contingency_aed) * boq.vat_pct) / 100,
    );
    boq.grand_total_aed = boq.subtotal_aed + boq.contingency_aed + boq.vat_aed;
    return boq;
  } catch (e) {
    console.warn(
      "[boq/garden] landscape sections skipped:",
      e instanceof Error ? e.message : e,
    );
    return boq;
  }
}

/**
 * Write the per-element landscape take-off to `takeoff_items`.
 *
 * Deletes only the rows whose work_item_key is a garden key, so an interior
 * project's P4 rows on the same project are never touched. Best-effort: a
 * missing table means the BoQ still generates, it just cannot be traced
 * per-zone yet.
 */
export async function persistGardenTakeoff(
  projectId: string,
  elements: readonly GardenTakeoffElement[],
  supabase: SupabaseClient,
): Promise<void> {
  try {
    await supabase
      .from("takeoff_items")
      .delete()
      .eq("project_id", projectId)
      .like("work_item_key", "garden.%");
    if (elements.length === 0) return;
    await supabase.from("takeoff_items").insert(
      elements.map((e) => ({
        project_id: projectId,
        work_item_key: e.item_key,
        element_id: e.element_id,
        room_id: e.element_id,
        qty: e.qty,
        unit: e.unit,
        wet_area: false,
      })),
    );
  } catch (e) {
    console.warn(
      "[boq/garden] takeoff_items persist skipped:",
      e instanceof Error ? e.message : e,
    );
  }
}
