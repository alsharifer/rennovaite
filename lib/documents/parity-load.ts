// =============================================================================
// lib/documents/parity-load.ts — collect what the parity gate compares (G5c).
//
// Server-only: the latest BoQ, the drawing set's sheets, the scene's camera
// manifests and the passed photo pairs' before-items. The decision is pure
// (lib/documents/parity.ts).
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { generateDrawingSet } from "@/lib/drawings/export";
import { LINEAR_ELEMENT_META } from "@/lib/plan/elements";
import { derivePlanGraph } from "@/lib/plan/derive";
import { isInDesign, isNewWork, isUndecided } from "@/lib/plan/site-reference";
import { buildManifest } from "@/lib/scene/cameras";
import { renderScene } from "@/lib/scene/raster";
import { loadGardenSceneContext } from "@/lib/scene-render/pipeline";

import { buildParity, manifestIds, sheetIds, type ParityBoqLine, type ParityElement, type ParityResult } from "./parity";

/** Cost-impact fixture types (a kept one costs nothing; a tree with no rate is still a line). */
const COSTED_FIXTURES = new Set(["garden_light", "boundary_light", "water_tap", "drainage_point", "planter_box", "wall_feature", "bbq_grill", "tree", "shed"]);

export async function loadParity(sb: SupabaseClient, projectId: string): Promise<ParityResult> {
  const [boqRes, graph, ctx, set] = await Promise.all([
    sb.from("boqs").select("sections").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle<{ sections: { sections: { lines: ParityBoqLine[] }[] } }>(),
    derivePlanGraph(projectId),
    loadGardenSceneContext(projectId).catch(() => null),
    generateDrawingSet(projectId),
  ]);
  const lines = (boqRes.data?.sections.sections ?? []).flatMap((s) => s.lines).filter((l) => /^GL-/.test(l.rule_id));

  const { data: fx } = await sb.from("plan_fixtures").select("id, type, spec, site_reference, disposition").eq("project_id", projectId);
  const status = (t: { site_reference?: boolean | null; disposition?: string | null; spec?: Record<string, unknown> | null }): ParityElement["status"] => {
    const tag = { site_reference: t.site_reference ?? false, disposition: t.disposition ?? null, spec: t.spec ?? null };
    if (!tag.site_reference) return "new";
    if (isUndecided(tag)) return "undecided";
    if (isNewWork(tag)) return "new";
    return isInDesign(tag) ? "kept" : "removed";
  };

  const elements: ParityElement[] = [
    ...graph.rooms.map((r) => ({ id: r.id, name: r.name_en, table: "zone", kind: r.type ?? "zone", status: status(r) })),
    ...graph.elements
      .filter((e) => e.kind !== "boundary_wall")
      .map((e) => ({ id: e.id, name: (typeof e.spec?.name === "string" ? e.spec.name : LINEAR_ELEMENT_META[e.kind].label), table: "run", kind: e.kind, status: status(e) })),
    ...((fx ?? []) as { id: string; type: string; spec: Record<string, unknown> | null; site_reference: boolean | null; disposition: string | null }[])
      .filter((f) => COSTED_FIXTURES.has(f.type))
      .map((f) => ({ id: f.id, name: (typeof f.spec?.name === "string" ? f.spec.name : f.type.replace(/_/g, " ")), table: "fixture", kind: f.type, status: status(f) })),
  ];

  const sheets = set.sheets.map((s) => ({ sheetNumber: s.sheetNumber, ids: sheetIds(s.svg) }));

  // What each pack view shows. The manifest is read off the flat model at render
  // resolution — the same image the pipeline builds the manifest from.
  const views: { camera: string; label: string; ids: string[] }[] = [];
  if (ctx) {
    for (const cam of ctx.cameras) {
      const res = renderScene(ctx.scene, cam, 1200, 800, { lighting: "day", supersample: 1, outlines: false });
      const m = buildManifest(projectId, cam.id, ctx.scene, res);
      views.push({ camera: cam.id, label: cam.label, ids: manifestIds(m.items.map((i) => i.key)) });
    }
  }

  // Existing items a passed pair shows before renovation (for the demolition line).
  const { data: pairs } = await sb
    .from("renders")
    .select("gate, project_id")
    .eq("project_id", projectId)
    .eq("mode", "photo_pair")
    .eq("status", "succeeded")
    .order("created_at", { ascending: false })
    .limit(30);
  const pairNouns = new Set<string>();
  for (const p of (pairs ?? []) as { gate: { outcome?: string; manifest?: { items?: { noun: string; disposition: string | null }[] } } | null }[]) {
    if (p.gate?.outcome !== "passed") continue;
    for (const it of p.gate.manifest?.items ?? []) if (it.disposition === "remove" || it.disposition === "replace") pairNouns.add(it.noun.toLowerCase());
  }
  // A pair names items by noun; match them back to the elements they are.
  const pairBeforeIds = elements.filter((e) => e.status === "removed" && [...pairNouns].some((n) => n.includes(e.name.toLowerCase().split(" (")[0]!) || e.name.toLowerCase().includes(n.replace(/^the /, "")))).map((e) => e.id);

  return buildParity({ lines, elements, sheets, views, pairBeforeIds });
}
