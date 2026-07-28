// =============================================================================
// lib/drawings/export.ts — assemble + export the drawing set (Prompt P1).
//
// generateDrawingSet(projectId) → { sheets: [{ kind, svg }] } for the three
// sheets (as-built plan, proposed/demolition plan, finish schedule). Everything
// is deterministic and rule-based — no LLM anywhere in this module.
//
// PDF export: SVG → PNG via @resvg/resvg-js, placed on a true-size A3 page via
// pdf-lib, so a printed sheet reads 1:100. (Chosen over svg2pdf, which needs a
// DOM server-side — noted in CLAUDE.md.) DXF export is deferred:
//   TODO(P-later): DXF via dxf-writer
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { derivePlanGraph } from "@/lib/plan/derive";
import type { PlanGraph, Room } from "@/lib/plan/geometry";
import { getStyleByKey } from "@/lib/styles";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { renderDemoSheet } from "./demo-sheet";
import { renderFinishSchedule, type FinishRow } from "./finish-schedule";
import { renderPlanSheet } from "./plan-sheet";
import type { SheetMeta } from "./sheet";

export type SheetKind = "as_built" | "proposed" | "finish_schedule";

export interface DrawingSheet {
  kind: SheetKind;
  title: string;
  sheetNumber: string;
  svg: string;
}

export interface DrawingSet {
  projectId: string;
  planId: string | null;
  sheets: DrawingSheet[];
  /** Derived-field provenance (feeds the P1 verification gate + the UI). */
  derivedNotes: string[];
}

// Per-style Floor / Wall / Ceiling finish specs. Sourced from the style
// direction (lib/styles.ts) — there is no per-surface material assignment table
// yet, so these are style-level defaults (noted in each schedule row).
const STYLE_FINISHES: Record<string, { floor: string; wall: string; ceiling: string }> = {
  "contemporary-majlis": { floor: "Honed travertine, large format", wall: "Book-matched walnut paneling / matt paint", ceiling: "Flush plaster, matt white" },
  "modern-hijazi": { floor: "Solid mahogany / patterned tile border", wall: "Ivory Tadelakt plaster", ceiling: "Flush plaster with carved cornice" },
  "coastal-emirati": { floor: "Bleached engineered oak", wall: "Sand-tone limewash", ceiling: "Flush plaster, matt white" },
  "scandi-arabic": { floor: "Pale white-oak engineered board", wall: "Off-white flat matt", ceiling: "Flush plaster, matt white" },
  "andalusian-heritage": { floor: "Encaustic cement tile", wall: "Lime plaster / zellige feature", ceiling: "Exposed stained timber beams" },
  "luxe-minimal": { floor: "Book-matched stone slab", wall: "Micro-cement / concealed joinery", ceiling: "Seamless plaster, integrated cove" },
};

const DEFAULT_FINISHES = { floor: "Porcelain tile (neutral)", wall: "Emulsion, matt white", ceiling: "Flush plaster, matt white" };

function perimeterM(room: Room): number {
  let p = 0;
  const poly = room.polygon;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    p += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return p;
}

function buildFinishRows(graph: PlanGraph, styleKey: string | null): FinishRow[] {
  const finishes = (styleKey && STYLE_FINISHES[styleKey]) || DEFAULT_FINISHES;
  const styleNote = styleKey ? `Style: ${styleKey}` : "No locked style — defaults";
  const rows: FinishRow[] = [];
  for (const r of graph.rooms) {
    const floorArea = r.area_m2;
    const wallArea = Math.round(perimeterM(r) * r.ceiling_h_m * 10) / 10;
    rows.push({ room: r.name_en, surface: "Floor", material: finishes.floor, area_m2: floorArea, notes: styleNote, groupStart: true });
    rows.push({ room: r.name_en, surface: "Wall", material: finishes.wall, area_m2: wallArea, notes: `Perimeter × ${r.ceiling_h_m} m (derived h)` });
    rows.push({ room: r.name_en, surface: "Ceiling", material: finishes.ceiling, area_m2: floorArea, notes: "" });
  }
  return rows;
}

/** Latest project-level locked style key (room_id null), if any. */
async function loadLockedStyleKey(projectId: string): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("style_choices")
    .select("style_key, created_at")
    .eq("project_id", projectId)
    .is("room_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.style_key ?? null;
}

interface ProjectMetaRow {
  name: string | null;
  city: string | null;
}

async function loadProjectMeta(projectId: string): Promise<ProjectMetaRow> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("projects")
    .select("name, city")
    .eq("id", projectId)
    .maybeSingle();
  return { name: data?.name ?? "Untitled villa", city: data?.city ?? "Dubai" };
}

function sheetMeta(
  project: ProjectMetaRow,
  graph: PlanGraph,
  styleKey: string | null,
): SheetMeta {
  const style = styleKey ? getStyleByKey(styleKey) : null;
  return {
    projectNameEn: project.name?.trim() || "Untitled villa",
    projectNameAr: style?.name_ar ?? null,
    community: project.city?.trim() || "Dubai",
    level: graph.meta.level.replace(/_/g, " "),
    scale: graph.meta.scale,
    dateISO: new Date().toISOString().slice(0, 10),
  };
}

/**
 * Try to load a stored proposed snapshot graph. Best-effort: if the
 * plan_snapshots table doesn't exist yet (migration 013 not applied), silently
 * fall back to the as-built graph so generation still works.
 */
async function loadProposedGraph(
  projectId: string,
  asBuilt: PlanGraph,
): Promise<PlanGraph> {
  try {
    // plan_snapshots isn't in database.types.ts yet — query via an untyped client.
    const supabase = getSupabaseAdmin() as unknown as SupabaseClient;
    const { data, error } = await supabase
      .from("plan_snapshots")
      .select("graph")
      .eq("project_id", projectId)
      .eq("kind", "proposed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ graph: PlanGraph }>();
    if (error || !data?.graph) return asBuilt;
    return data.graph;
  } catch {
    return asBuilt;
  }
}

export async function generateDrawingSet(projectId: string): Promise<DrawingSet> {
  // Read-only: derive the as-built graph live. The as-built plan_snapshot is
  // written at parse-confirm (update-plan), not here, so viewing drawings never
  // mutates state.
  const asBuilt = await derivePlanGraph(projectId);
  const [proposed, styleKey, project] = await Promise.all([
    loadProposedGraph(projectId, asBuilt),
    loadLockedStyleKey(projectId),
    loadProjectMeta(projectId),
  ]);

  const meta = sheetMeta(project, asBuilt, styleKey);

  const sheets: DrawingSheet[] = [
    {
      kind: "as_built",
      title: "As-Built Plan",
      sheetNumber: "A-101",
      svg: renderPlanSheet(asBuilt, meta, { sheetNumber: "A-101", title: "As-Built Plan" }),
    },
    {
      kind: "proposed",
      title: "Proposed / Demolition Plan",
      sheetNumber: "A-102",
      svg: renderDemoSheet(asBuilt, proposed, meta, {
        sheetNumber: "A-102",
        title: "Proposed / Demolition Plan",
      }),
    },
    {
      kind: "finish_schedule",
      title: "Finish Schedule",
      sheetNumber: "A-201",
      svg: renderFinishSchedule(buildFinishRows(proposed, styleKey), meta, {
        sheetNumber: "A-201",
        title: "Finish Schedule",
      }),
    },
  ];

  return { projectId, planId: asBuilt.planId, sheets, derivedNotes: asBuilt.notes };
}

const MM_TO_PT = 72 / 25.4;

/**
 * Render one sheet SVG to a single-page A3 PDF at true physical size (prints
 * 1:100). Rasterises via resvg at ~300 dpi. Throws if the native deps are
 * unavailable — callers fall back to serving the SVG.
 */
export async function renderSheetPdf(svg: string): Promise<Uint8Array> {
  const { Resvg } = await import("@resvg/resvg-js");
  const { PDFDocument } = await import("pdf-lib");

  // A3 landscape width 420 mm ≈ 16.54 in → 4961 px at 300 dpi.
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 4961 } });
  const png = resvg.render().asPng();

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([420 * MM_TO_PT, 297 * MM_TO_PT]);
  const img = await pdf.embedPng(png);
  page.drawImage(img, { x: 0, y: 0, width: 420 * MM_TO_PT, height: 297 * MM_TO_PT });
  return pdf.save();
}
