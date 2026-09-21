// =============================================================================
// lib/provenance/load.ts — the plan context a BoQ's provenance is built against (I4).
//
// Server-only. Best-effort per table: a missing table or column gives an empty
// map, which makes the affected figures show "element … no longer on the plan"
// rather than inventing a name.
//
// Reads from `rate_book` ONLY the `qs_validated` boolean per item_key — never
// `source` or `internal_ref`. Reads firm NAMES only to withhold them.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProvElement, ProvenanceContext } from "./boq";

type Row = Record<string, unknown>;

async function rows(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<Row[]> {
  try {
    const { data, error } = await q;
    return error ? [] : ((data ?? []) as Row[]);
  } catch {
    return [];
  }
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

export async function loadProvenanceContext(sb: SupabaseClient, projectId: string): Promise<ProvenanceContext> {
  const plans = await rows(sb.from("plans").select("id").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1));
  const planId = plans[0]?.id as string | undefined;

  const [rooms, runs, fixtures, context, rb, firms] = await Promise.all([
    planId ? rows(sb.from("rooms").select("id, name_en, room_type, dims_derived, derived_note").eq("plan_id", planId)) : Promise.resolve([]),
    planId ? rows(sb.from("plan_elements").select("id, kind, variant, dims_derived, derived, derived_note").eq("plan_id", planId)) : Promise.resolve([]),
    rows(sb.from("plan_fixtures").select("id, layer, type, dims_derived, derived_note").eq("project_id", projectId)),
    planId ? rows(sb.from("plan_context").select("id, kind, name, dims_derived, derived, note").eq("plan_id", planId)) : Promise.resolve([]),
    rows(sb.from("rate_book").select("item_key, qs_validated").eq("city", "Dubai")),
    rows(sb.from("firms").select("name")),
  ]);

  const elements: Record<string, ProvElement> = {};
  for (const r of rooms) {
    elements[String(r.id)] = { name: str(r.name_en) ?? "Zone", kind: String(r.room_type ?? "zone").replace(/_/g, " "), derived: r.dims_derived === true, derived_note: str(r.derived_note) };
  }
  for (const r of runs) {
    const kind = String(r.kind ?? "run").replace(/_/g, " ");
    elements[String(r.id)] = { name: r.variant ? `${kind} (${r.variant})` : kind, kind: "run", derived: r.dims_derived === true || r.derived === true, derived_note: str(r.derived_note) };
  }
  for (const r of fixtures) {
    const type = String(r.type ?? "fixture").replace(/_/g, " ");
    elements[String(r.id)] = { name: type, kind: `${r.layer ?? "fixture"} point`, derived: r.dims_derived === true, derived_note: str(r.derived_note) };
  }
  for (const r of context) {
    elements[String(r.id)] = { name: str(r.name) ?? String(r.kind ?? "context"), kind: "existing context", derived: r.dims_derived === true || r.derived === true, derived_note: str(r.note) };
  }

  const qsValidated: Record<string, boolean> = {};
  for (const r of rb) {
    const k = String(r.item_key);
    qsValidated[k] = (qsValidated[k] ?? false) || r.qs_validated === true;
  }

  return { elements, qsValidated, withheldNames: firms.map((f) => String(f.name)).filter((n) => n.trim().length >= 3) };
}
