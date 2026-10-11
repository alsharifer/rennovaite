// =============================================================================
// lib/plan/curate-notes.ts — identity curation for plan text on its way to a
// user (I4).
//
// The plan tables carry free text that records WHERE a figure came from: a
// zone's or fixture's `derived_note`, a context item's `note`, the strings in
// `spec` (`measured`, `assumption`, `unmapped_measure.source`, …). A
// measurement taken by a firm says so — "(<firm> site measurement, design
// session Sep 2026)" — and that firm's name may appear only on its OWN
// projects. So, like `curateBoq` on BoQ reads, every plan payload a user
// receives passes `curateText` with the project's withheld names.
//
// READ-side only: the stored rows are never rewritten. Because some editors
// re-send what they read (the fixture inspector re-sends the whole `spec`),
// the write routes call `keepStoredText` first: a string the caller sent back
// that is exactly the curated form of the stored one is put back to the stored
// text, so curation can never turn into a stored change.
//
// SERVER-ONLY: it imports `lib/identity/curation`, which holds the names it
// withholds.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { curateText } from "@/lib/identity/curation";

import type { GardenSiteData } from "./garden-site-data";

/**
 * The free-text columns of the plan tables (rooms, plan_elements,
 * plan_fixtures, plan_context, plan_openings), plus `spec`, which is walked.
 * `name_en` / `name_ar` are deliberately absent: the room editor saves every
 * room's name back on each save, so curating them on read would rewrite them.
 */
export const PLAN_TEXT_FIELDS = ["derived_note", "note", "name", "spec"] as const;

function curateDeep(v: unknown, names: readonly string[]): unknown {
  if (typeof v === "string") return curateText(v, names);
  if (Array.isArray(v)) return v.map((x) => curateDeep(x, names));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = curateDeep(x, names);
    return out;
  }
  return v;
}

/** One plan row with its free-text fields curated. Ids, kinds, geometry and every other column pass through untouched. */
export function curatePlanRow<T>(row: T, names: readonly string[]): T {
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;
  const out = { ...(row as Record<string, unknown>) };
  for (const k of PLAN_TEXT_FIELDS) {
    if (out[k] != null) out[k] = curateDeep(out[k], names);
  }
  return out as T;
}

export function curatePlanRows<T>(rows: readonly T[] | null | undefined, names: readonly string[]): T[] {
  return (rows ?? []).map((r) => curatePlanRow(r, names));
}

/** The plan page's garden panel payload, curated: every note, label and name it prints. */
export function curateGardenSiteData(data: GardenSiteData, names: readonly string[]): GardenSiteData {
  const cur = (s: string) => curateText(s, names);
  const curN = (s: string | null) => (s == null ? s : cur(s));
  return {
    ...data,
    draft: { ...data.draft, derived: data.draft.derived.map(cur), note: curN(data.draft.note) },
    items: data.items.map((i) => ({ ...i, name: cur(i.name), kindLabel: cur(i.kindLabel), note: curN(i.note) })),
    zones: data.zones.map((z) => ({ ...z, name: cur(z.name) })),
    untypedCounters: data.untypedCounters.map(cur),
    context: data.context.map((c) => ({ ...c, name: cur(c.name) })),
  };
}

/**
 * PURE, write side: `incoming` with every string that is exactly the curated
 * form of the stored string at the same path put back to the stored string.
 * Anything the caller actually changed is kept as sent.
 */
export function restoreCurated<T>(incoming: T, stored: unknown, names: readonly string[]): T {
  if (typeof incoming === "string") {
    return (typeof stored === "string" && stored !== incoming && curateText(stored, names) === incoming ? stored : incoming) as T;
  }
  if (Array.isArray(incoming)) {
    const s = Array.isArray(stored) ? stored : [];
    return incoming.map((x, i) => restoreCurated(x, s[i], names)) as T;
  }
  if (incoming && typeof incoming === "object") {
    const s = stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(incoming)) out[k] = restoreCurated(x, s[k], names);
    return out as T;
  }
  return incoming;
}

/**
 * Before an update: put back any free text the caller re-sent in its curated
 * form (see `restoreCurated`). Mutates `patch`; reads only the text fields the
 * patch carries, and nothing when it carries none.
 */
export async function keepStoredText(
  db: SupabaseClient,
  table: "rooms" | "plan_elements" | "plan_fixtures" | "plan_context" | "plan_openings",
  id: string,
  patch: Record<string, unknown>,
  names: readonly string[],
): Promise<void> {
  const keys = PLAN_TEXT_FIELDS.filter((k) => patch[k] != null);
  if (keys.length === 0) return;
  const { data, error } = await db.from(table).select(keys.join(", ")).eq("id", id).maybeSingle<Record<string, unknown>>();
  if (error || !data) return;
  for (const k of keys) patch[k] = restoreCurated(patch[k], data[k], names);
}
