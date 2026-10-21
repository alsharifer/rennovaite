// =============================================================================
// lib/render/material-labels.ts — render ↔ specification ↔ price, per material
// (Sprint C5 #1). Pure and client-safe.
//
// Each material or product a room's design shows carries ONE label:
//
//   Changed since render approval   a product choice that decides it differs
//                                   from the one the APPROVED (locked) view was
//                                   rendered with — the pack gate already holds
//                                   that view back; the app now says so too
//   Priced                          a current BoQ line prices it (a rate, not
//                                   TBC)
//   Specified                       chosen (a product choice on the room, or a
//                                   line still to be priced) but not priced
//   Illustrative (render only)      it is in the render and nowhere else — the
//                                   BoQ prices a tile allowance, not this tile
//
// Read from the objects the B7 consistency gate uses (lib/documents/
// render-consistency.ts): the design fingerprint's product choices
// (designKey — "field=value" after the "|"), the locked render's fingerprint
// (its gate.design_key), and the BoQ's product lines (item keys).
// =============================================================================

import { SPEC_ELEMENT, SPEC_FIELDS, specElements, type RoomDesignSpec, type SpecField } from "./room-spec-vocab";

export type MaterialLabel = "changed" | "priced" | "specified" | "illustrative";

export const MATERIAL_LABEL_TEXT: Record<MaterialLabel, string> = {
  changed: "Changed since render approval",
  priced: "Priced",
  specified: "Specified",
  illustrative: "Illustrative (render only)",
};

/** For each element: the product choices (rooms.spec.wet_room fields) that decide it, and the BoQ lines that price it. */
export const ELEMENT_PRODUCTS: Record<SpecField, { fields: readonly string[]; items: readonly string[]; selectionOn?: readonly string[] }> = {
  floor_tile: { fields: [], items: [], selectionOn: ["P4/quantify/floor_finish"] },
  wall_tile: { fields: [], items: [], selectionOn: ["P4/quantify/wet_tiling"] },
  tiled_height: { fields: [], items: [] },
  vanity: { fields: ["vanity", "basin_mount"], items: ["joinery.vanity_ready", "GT/joinery/vanity", "san.basin_wall_hung"] },
  mirror: { fields: ["fittings"], items: ["alum.mirror_backlit", "alum.mirror_led_mid", "S6-07"] },
  wc: { fields: ["fittings", "wc_mount"], items: ["san.wc_floor", "san.wc_floor_mid", "san.wc"] },
  shower_screen: { fields: ["shower_screen"], items: ["alum.shower_panel_fixed", "S6-06"] },
  fittings_finish: { fields: ["shower_valve", "fittings"], items: ["san.shower", "san.shower_manual", "san.shower_exposed", "san.basin", "san.basin_mixer_mid"] },
  palette: { fields: [], items: [] },
};

/** The product choices a design fingerprint records ("…|fittings=mid,vanity=ready_made" → { fittings: "mid", … }). */
export function choicesOfKey(designKey: string | null | undefined): Record<string, string> {
  const part = (designKey ?? "").split("|")[1] ?? "";
  return Object.fromEntries(part.split(",").filter(Boolean).map((kv) => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)]));
}

interface LineLike {
  rule_id?: string | null;
  item_key?: string | null;
  description: string;
  quantity?: number;
  rate_aed?: number;
  rate_status?: string | null;
  rate_tier?: string | null;
}

const keyOf = (l: LineLike) => l.item_key ?? ((l.rule_id ?? "").startsWith("GT/") || (l.rule_id ?? "").startsWith("P4/") ? l.rule_id ?? "" : (l.rule_id ?? "").split("/")[0]!);
const isPriced = (l: LineLike) => (l.rate_aed ?? 0) > 0 && l.rate_status !== "needs_qs" && (l.quantity ?? 1) > 0;

export interface MaterialRow {
  field: SpecField;
  element: string;
  finish: string;
  label: MaterialLabel;
  /** One sentence: what decides the label. */
  why: string;
}

/**
 * The label for every element of a room's design spec.
 *   spec             the anchor's room design spec (what the renders show)
 *   choices          the room's product choices now (rooms.spec.wet_room)
 *   approvedKey      the design fingerprint of the APPROVED (locked) view's render, null when none is locked
 *   lines            the current BoQ's lines
 */
export function materialLabels(input: { spec: RoomDesignSpec; choices: Record<string, unknown> | null; approvedKey: string | null; lines: readonly LineLike[] }): MaterialRow[] {
  const now = Object.fromEntries(Object.entries(input.choices ?? {}).filter(([k]) => k !== "existing_fixtures" && k !== "reviewed" && k !== "reviewed_log").map(([k, v]) => [k, String(v)]));
  const approved = input.approvedKey ? choicesOfKey(input.approvedKey) : null;
  const shown = new Map(specElements(input.spec).map((e) => [e.element, e.finish]));
  const rows: MaterialRow[] = [];
  for (const field of SPEC_FIELDS) {
    if (field === "tiled_height") continue;
    const element = SPEC_ELEMENT[field];
    const finish = shown.get(element);
    if (!finish) continue;
    const def = ELEMENT_PRODUCTS[field];
    // 1. A deciding product choice moved after the view was approved.
    if (approved) {
      const moved = def.fields.filter((f) => (approved[f] ?? "") !== (now[f] ?? ""));
      if (moved.length) {
        rows.push({ field, element, finish, label: "changed", why: moved.map((f) => `${f.replace(/_/g, " ")} ${approved[f] ? `was ${approved[f]}` : "was not chosen"}, now ${now[f] ?? "the base product"}`).join("; ") });
        continue;
      }
    }
    // 2. A BoQ line prices it.
    const lines = input.lines.filter((l) => def.items.includes(keyOf(l)) || (def.selectionOn?.includes(keyOf(l)) && l.rate_tier === "selection"));
    const priced = lines.find(isPriced);
    if (priced) {
      rows.push({ field, element, finish, label: "priced", why: `on the BoQ: ${priced.description}` });
      continue;
    }
    // 3. Chosen, not (yet) priced.
    if (lines.length || def.fields.some((f) => f in now)) {
      rows.push({ field, element, finish, label: "specified", why: lines.length ? `on the BoQ, to be priced: ${lines[0]!.description}` : "chosen on the room, not on the BoQ yet" });
      continue;
    }
    // 4. Only in the render.
    rows.push({ field, element, finish, label: "illustrative", why: def.selectionOn ? "the BoQ prices a tile allowance, not this tile — choose it on the Specification to price it" : "in the render only — nothing specifies or prices it" });
  }
  return rows;
}

/**
 * Why a LOCKED view no longer shows today's design (null = it still does): its
 * render's fingerprint (gate.design_key) beside the room's fingerprint now —
 * the comparison the B7 pack gate makes, said in the app (C5 #1).
 */
export function approvalDrift(approvedKey: string | null | undefined, nowKey: string | null | undefined): string | null {
  if (!approvedKey || !nowKey || approvedKey === nowKey) return null;
  const fx = (k: string) => (k.split("|")[0] ?? "").split(",").filter(Boolean);
  const [a, n] = [choicesOfKey(approvedKey), choicesOfKey(nowKey)];
  const said: string[] = [];
  for (const f of [...new Set([...Object.keys(a), ...Object.keys(n)])].sort()) {
    if (f === "reviewed" || f === "reviewed_log" || a[f] === n[f]) continue;
    said.push(`${f.replace(/_/g, " ")} ${a[f] ? `was ${a[f]}` : "was not chosen"}, now ${n[f] ?? "the base product"}`);
  }
  const [fa, fn] = [fx(approvedKey), fx(nowKey)];
  const added = fn.filter((t) => !fa.includes(t)), gone = fa.filter((t) => !fn.includes(t));
  if (added.length || gone.length) said.push(`fixtures changed on the plan${added.length ? ` (added ${added.join(", ")})` : ""}${gone.length ? ` (removed ${gone.join(", ")})` : ""}`);
  return said.length ? said.join("; ") : null;
}

/** The design element a Specification item decides, when it decides one (san.wc → wc). */
export function fieldOfItem(itemKey: string): SpecField | null {
  for (const f of SPEC_FIELDS) if (ELEMENT_PRODUCTS[f].items.includes(itemKey)) return f;
  return null;
}

/**
 * The Specification's label for each item (C5 #1) — the same four, from the
 * same objects: "changed" when the element it decides changed since a locked
 * view was approved (`changed`: field → why, from materialLabels per room),
 * "priced" when a current BoQ line prices the item, "specified" when it is
 * chosen or on the BoQ to be priced, else "illustrative" (not on the BoQ).
 */
export function specItemLabels(input: { itemKeys: readonly string[]; lines: readonly LineLike[]; selected: readonly string[]; changed: Partial<Record<SpecField, string>> }): Record<string, { label: MaterialLabel; why: string }> {
  const out: Record<string, { label: MaterialLabel; why: string }> = {};
  for (const k of input.itemKeys) {
    const field = fieldOfItem(k);
    const moved = field ? input.changed[field] : undefined;
    const lines = input.lines.filter((l) => keyOf(l) === k);
    const priced = lines.find(isPriced);
    out[k] = moved
      ? { label: "changed", why: `a locked render shows the ${SPEC_ELEMENT[field!]} before this: ${moved}` }
      : priced
        ? { label: "priced", why: `on the BoQ: ${priced.description}` }
        : lines.length || input.selected.includes(k)
          ? { label: "specified", why: lines.length ? `on the BoQ, to be priced: ${lines[0]!.description}` : "chosen here, on the BoQ when it is regenerated" }
          : { label: "illustrative", why: "not on the current BoQ — regenerate it to price this item" };
  }
  return out;
}
