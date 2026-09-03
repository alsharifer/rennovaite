// =============================================================================
// lib/accessories/load.ts — server reads for the D1 picker and the BoQ engine.
//
// Every read degrades to an empty catalogue when migration 028 has not been
// applied, so the picker shows rule defaults only and the BoQ is byte-identical
// to what it produced before this feature existed.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AccessoryOverride } from "@/lib/boq/rates";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import type { AccessoryItem, AccessorySelections } from "./types";

const SELECT_COLS =
  "id, category, item_key, spec_class, name, brand, model_code, rate_aed, unit, scope, provenance, source, rate_book_item_key, qs_validated, attributes, is_rule_default, sort_order";

function db(): SupabaseClient {
  return getSupabaseAdmin() as unknown as SupabaseClient;
}

function toItem(r: Record<string, unknown>): AccessoryItem {
  return {
    id: String(r.id),
    category: r.category as AccessoryItem["category"],
    item_key: String(r.item_key),
    spec_class: r.spec_class as AccessoryItem["spec_class"],
    name: String(r.name),
    brand: (r.brand as string) ?? null,
    model_code: (r.model_code as string) ?? null,
    rate_aed: Number(r.rate_aed),
    unit: String(r.unit ?? "no"),
    scope: r.scope as AccessoryItem["scope"],
    provenance: r.provenance as AccessoryItem["provenance"],
    source: (r.source as string) ?? null,
    rate_book_item_key: (r.rate_book_item_key as string) ?? null,
    qs_validated: r.qs_validated === true,
    attributes: (r.attributes as AccessoryItem["attributes"]) ?? {},
    is_rule_default: r.is_rule_default === true,
    sort_order: Number(r.sort_order ?? 0),
  };
}

/** The whole catalogue, ordered for display. `[]` before migration 028. */
export async function loadCatalog(): Promise<AccessoryItem[]> {
  try {
    const { data, error } = await db()
      .from("accessory_catalog")
      .select(SELECT_COLS)
      .order("category", { ascending: true })
      .order("item_key", { ascending: true })
      .order("sort_order", { ascending: true });
    if (error || !data) {
      if (error) console.warn("[accessories/load] catalogue degraded:", error.message);
      return [];
    }
    return (data as Record<string, unknown>[]).map(toItem);
  } catch (e) {
    console.warn("[accessories/load] catalogue degraded:", e instanceof Error ? e.message : e);
    return [];
  }
}

/** A project's selections as item_key → catalog_item_id. `{}` when absent. */
export async function loadSelections(projectId: string): Promise<AccessorySelections> {
  try {
    const { data, error } = await db()
      .from("accessory_selections")
      .select("item_key, catalog_item_id")
      .eq("project_id", projectId);
    if (error || !data) return {};
    const out: AccessorySelections = {};
    for (const r of data as { item_key: string; catalog_item_id: string }[]) {
      out[r.item_key] = r.catalog_item_id;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Shape a catalogue item into the engine's rate override.
 *
 * `defaultSupply` is the supply price of the item the rule already assumed —
 * the `is_rule_default` row for the same item_key. The engine needs it to move
 * a supply-and-install rate by the SPEC delta rather than replacing it with a
 * bare supply price (which would delete the installation cost). Null when the
 * catalogue has no default row, in which case the engine refuses to guess.
 */
export function toOverride(
  item: AccessoryItem,
  defaultSupply: number | null = null,
): AccessoryOverride {
  return {
    catalog_item_id: item.id,
    name: item.name,
    rate_aed: item.rate_aed,
    scope: item.scope,
    source: item.source,
    spec_class: item.spec_class,
    qs_validated: item.qs_validated,
    default_supply_aed: defaultSupply,
  };
}

/** The catalogue's rule-default supply price per item_key, where one exists. */
export function defaultSupplyByItemKey(
  catalog: AccessoryItem[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of catalog) {
    if (c.is_rule_default) out[c.item_key] = c.rate_aed;
  }
  return out;
}

/**
 * Resolve a project's selections into engine overrides, keyed by item_key.
 * A selection pointing at a catalogue row that has since gone is dropped
 * silently — the line falls back to its rule default rather than erroring.
 */
export async function loadAccessoryOverrides(
  projectId: string,
): Promise<Record<string, AccessoryOverride>> {
  const [catalog, selections] = await Promise.all([
    loadCatalog(),
    loadSelections(projectId),
  ]);
  if (catalog.length === 0) return {};
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const defaultSupply = defaultSupplyByItemKey(catalog);
  const out: Record<string, AccessoryOverride> = {};
  for (const [itemKey, catalogId] of Object.entries(selections)) {
    const item = byId.get(catalogId);
    if (item && item.item_key === itemKey) {
      out[itemKey] = toOverride(item, defaultSupply[itemKey] ?? null);
    }
  }
  return out;
}
