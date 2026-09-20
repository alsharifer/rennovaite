// =============================================================================
// lib/plan/garden-site-data.ts — what the plan page's garden panel reads
// (garden pilot G5). Server-only; every read degrades to empty before 037.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { LINEAR_ELEMENT_META, isLinearElementKind } from "./elements";
import { derivePlanGraph } from "./derive";
import { graphDraftStatus } from "./geometry";
import { isDisposition, isNewWork } from "./site-reference";
import { roomTypeLabel } from "./zones";

export interface GardenSiteItem {
  id: string;
  table: "zone" | "element" | "fixture" | "context" | "opening";
  name: string;
  kindLabel: string;
  disposition: "keep" | "remove" | "replace" | null;
  dims_derived: boolean;
  note: string | null;
  fixture?: { type: string; position: [number, number]; room_id: string | null };
}

export interface GardenSiteData {
  draft: { draft: boolean; derived: string[]; note: string | null };
  items: GardenSiteItem[];
  zones: { id: string; name: string; type: string | null; level_mm: number | null; height_mm: number | null; site_reference: boolean }[];
  untypedCounters: string[];
  context: { id: string; name: string; kind: string; polygon: number[][] }[];
  /** room id → its site-reference state, for the canvas labels. */
  siteRefs: Record<string, { site_reference: boolean; disposition: string | null; dims_derived: boolean }>;
}

const CONTEXT_LABEL: Record<string, string> = {
  existing_building: "existing building",
  existing_structure: "existing structure",
  steps: "steps",
  boundary_wall: "boundary wall",
};

export async function loadGardenSiteData(sb: SupabaseClient, projectId: string, planId: string): Promise<GardenSiteData> {
  const graph = await derivePlanGraph(projectId);
  const draft = graphDraftStatus(graph);

  const items: GardenSiteItem[] = [];
  const disp = (v: string | null | undefined) => (isDisposition(v) ? v : null);

  for (const r of graph.rooms.filter((x) => x.site_reference)) {
    items.push({ id: r.id, table: "zone", name: r.name_en, kindLabel: roomTypeLabel(r.type).toLowerCase(), disposition: r.disposition, dims_derived: r.dims_derived, note: r.derived_note });
  }
  for (const e of graph.elements.filter((x) => x.site_reference)) {
    const name = typeof e.spec?.name === "string" ? e.spec.name : LINEAR_ELEMENT_META[e.kind].label;
    items.push({ id: e.id, table: "element", name, kindLabel: LINEAR_ELEMENT_META[e.kind].label.toLowerCase(), disposition: e.disposition, dims_derived: e.dims_derived, note: e.derived_note });
  }
  try {
    const { data } = await sb
      .from("plan_fixtures")
      .select("id, type, position, room_id, spec, site_reference, disposition, dims_derived, derived_note")
      .eq("project_id", projectId)
      .eq("site_reference", true)
      .returns<{ id: string; type: string; position: [number, number]; room_id: string | null; spec: Record<string, unknown> | null; disposition: string | null; dims_derived: boolean; derived_note: string | null }[]>();
    for (const f of data ?? []) {
      items.push({
        id: f.id,
        table: "fixture",
        name: typeof f.spec?.name === "string" ? f.spec.name : f.type.replace(/_/g, " "),
        kindLabel: f.type.replace(/_/g, " "),
        disposition: disp(f.disposition),
        dims_derived: f.dims_derived === true,
        note: f.derived_note,
        fixture: { type: f.type, position: f.position, room_id: f.room_id },
      });
    }
  } catch {
    /* pre-037 */
  }
  for (const c of graph.context.filter((x) => x.site_reference)) {
    items.push({ id: c.id, table: "context", name: c.name, kindLabel: CONTEXT_LABEL[c.kind] ?? c.kind, disposition: c.disposition, dims_derived: c.dims_derived, note: c.note });
  }
  // G5c (039): an existing gate is decided like every other existing item.
  for (const o of graph.openings.filter((x) => x.site_reference)) {
    const name = typeof o.spec?.name === "string" ? o.spec.name : `${o.type} (existing)`;
    items.push({ id: o.id, table: "opening", name, kindLabel: o.type, disposition: disp(o.disposition), dims_derived: o.dims_derived === true, note: o.derived_note ?? null });
  }

  // Context outlines, back in normalised plot space for the editors.
  const u = graph.meta.unit_to_m;
  const [ox, oy] = graph.meta.norm_origin;
  const context = graph.context.map((c) => ({ id: c.id, name: c.name, kind: c.kind, polygon: c.polygon.map(([x, y]) => [x / u + ox, y / u + oy]) }));

  // A counter still needing a type is NEW work with no variant.
  let untypedCounters: string[] = [];
  try {
    const { data } = await sb
      .from("plan_elements")
      .select("id, kind, variant, spec, site_reference, disposition")
      .eq("plan_id", planId)
      .eq("kind", "counter_run")
      .returns<{ id: string; kind: string; variant: string | null; spec: Record<string, unknown> | null; site_reference: boolean; disposition: string | null }[]>();
    untypedCounters = (data ?? [])
      .filter((e) => e.variant == null && isNewWork(e))
      .map((e) => (typeof e.spec?.name === "string" ? e.spec.name : isLinearElementKind(e.kind) ? LINEAR_ELEMENT_META[e.kind].label : "counter run"));
  } catch {
    /* pre-033 */
  }

  return {
    draft: { draft: draft.draft, derived: draft.derived, note: draft.note },
    items,
    zones: graph.rooms.map((r) => ({ id: r.id, name: r.name_en, type: r.type, level_mm: r.level_mm, height_mm: r.height_mm, site_reference: r.site_reference })),
    untypedCounters,
    context,
    siteRefs: Object.fromEntries(graph.rooms.map((r) => [r.id, { site_reference: r.site_reference, disposition: r.disposition, dims_derived: r.dims_derived }])),
  };
}
