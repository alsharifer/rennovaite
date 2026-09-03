// =============================================================================
// lib/accessories/picker-data.ts — everything the D1 picker needs, in one read.
//
// Shared by the page (server component, direct call) and /api/accessories (for
// the client after a selection changes), so "what the engine assumed" has ONE
// implementation: the same RateResolver the BoQ prices with, run with no
// selections applied.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { RateResolver } from "@/lib/boq/rates";
import {
  DEFAULT_FLOORING,
  DEFAULT_TIER,
  STYLE_FLOORING,
  STYLE_TIER,
} from "@/lib/boq/rules";
import type { EngineRoom, LabourRate, PricingSku } from "@/lib/boq/schema";
import { computeTakeoff } from "@/lib/boq/takeoff";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { loadCatalog, loadSelections } from "./load";
import { CATEGORY_ITEM_KEYS, type AccessoryItem, type AccessorySelections } from "./types";

export type RuleDefault = {
  rate_aed: number;
  source: string;
  notes: string | null;
  kind: string;
} | null;

export interface PickerData {
  catalog: AccessoryItem[];
  selections: AccessorySelections;
  defaults: Record<string, RuleDefault>;
  quantities: Record<string, number>;
  measurements: Record<string, string>;
  tier: string;
  style_key: string | null;
  degraded: boolean;
}

export const ALL_ACCESSORY_ITEM_KEYS = Object.values(CATEGORY_ITEM_KEYS).flat();

export const EMPTY_PICKER_DATA: PickerData = {
  catalog: [],
  selections: {},
  defaults: {},
  quantities: {},
  measurements: {},
  tier: DEFAULT_TIER,
  style_key: null,
  degraded: true,
};

export async function loadPickerData(projectId: string): Promise<PickerData> {
  const supabase = getSupabaseAdmin();
  const sb = supabase as unknown as SupabaseClient;

  const [plansRes, labourRes, skuRes, styleRes] = await Promise.all([
    supabase.from("plans").select("id").eq("project_id", projectId),
    sb
      .from("labour_rates")
      .select("work_section, description, unit, rate_low_aed, rate_mid_aed, rate_high_aed"),
    sb
      .from("pricing_skus")
      .select("sku, brand, category, subcategory, description_en, unit, price_aed, vendor"),
    sb
      .from("style_choices")
      .select("style_key")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const planIds = (plansRes.data ?? []).map((p) => p.id);
  const roomsRes = planIds.length
    ? await supabase
        .from("rooms")
        .select("id, name_en, room_type, area_m2, polygon")
        .in("plan_id", planIds)
    : { data: [] as never[] };

  const styleKey =
    (styleRes.data as { style_key: string | null }[] | null)?.[0]?.style_key ?? null;
  const tier = (styleKey && STYLE_TIER[styleKey]) || DEFAULT_TIER;
  const flooring = (styleKey && STYLE_FLOORING[styleKey]) || DEFAULT_FLOORING;

  const engineRooms: EngineRoom[] = (roomsRes.data ?? []).map((r) => ({
    id: r.id,
    name: r.name_en ?? "(unnamed)",
    room_type: r.room_type ?? "other",
    area_m2: r.area_m2 ?? 0,
    polygon: Array.isArray(r.polygon) ? (r.polygon as unknown as number[][]) : null,
  }));

  // Quantities come from the same take-off the BoQ prices — read-only here.
  const quantities: Record<string, number> = {};
  const measurements: Record<string, string> = {};
  if (engineRooms.length > 0) {
    for (const item of computeTakeoff(engineRooms, flooring).items) {
      if (!ALL_ACCESSORY_ITEM_KEYS.includes(item.item_key)) continue;
      quantities[item.item_key] = item.quantity;
      measurements[item.item_key] = item.measurement;
    }
  }

  // "What the engine assumed": resolved with NO selections applied.
  const resolver = new RateResolver(
    (labourRes.data ?? []) as LabourRate[],
    (skuRes.data ?? []) as PricingSku[],
    tier,
    {},
  );
  const defaults: Record<string, RuleDefault> = {};
  for (const key of ALL_ACCESSORY_ITEM_KEYS) {
    try {
      const r = resolver.resolveDefault(key, "no");
      defaults[key] = {
        rate_aed: r.rate_aed,
        source: r.vendor_or_source,
        notes: r.notes,
        kind: r.kind,
      };
    } catch {
      // No resolvable rule in this deployment — the picker says so rather than
      // inventing a default.
      defaults[key] = null;
    }
  }

  const [catalog, selections] = await Promise.all([
    loadCatalog(),
    loadSelections(projectId),
  ]);

  return {
    catalog,
    selections,
    defaults,
    quantities,
    measurements,
    tier,
    style_key: styleKey,
    degraded: catalog.length === 0,
  };
}
