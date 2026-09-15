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

import { loadDocumentProject } from "@/lib/documents/project-name";
import { derivePlanGraph } from "@/lib/plan/derive";
import type { PlanGraph, Room } from "@/lib/plan/geometry";
import { zoneSurface } from "@/lib/plan/zones";
import { getStyleByKey } from "@/lib/styles";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { renderDemoSheet } from "./demo-sheet";
import { renderElectricalSheet } from "./electrical-sheet";
import { renderFinishSchedule, type FinishRow } from "./finish-schedule";
import {
  buildOpeningRows,
  renderOpeningSchedule,
  type ScheduleSourceOpening,
} from "./opening-schedule";
import { buildElevationSheets } from "./garden-elevations";
import { buildGardenSheets, designFixtures, designGraph, renderCoverSheet, type GardenFixture } from "./garden-sheets";
import { graphDraftStatus } from "@/lib/plan/geometry";
import type { OverlayFixtureForSheet } from "./overlay-sheet";
import { renderPlanSheet } from "./plan-sheet";
import { renderPlumbingSheet } from "./plumbing-sheet";
import type { SheetMeta } from "./sheet";
import { layerOf, type FixtureType } from "@/lib/overlays/types";

export type SheetKind =
  | "as_built"
  | "proposed"
  | "finish_schedule"
  | "opening_schedule"
  | "electrical"
  | "plumbing"
  // G4 garden set.
  | "site_plan"
  | "zone_plan"
  | "lighting_overlay"
  | "irrigation_overlay"
  // G4b eye-level drawings.
  | "structure_elevation"
  | "garden_elevation"
  // G5: the garden set's first page.
  | "cover";

export interface DrawingSheet {
  kind: SheetKind;
  title: string;
  sheetNumber: string;
  /** G4: zone sheets share a kind, so they are addressed by sheet number. */
  zoneId?: string;
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
    // G1: an unroofed zone keeps its surface row and loses the other two. It has
    // no ceiling, and its walls exist only where somebody drew one — those are
    // boundary-wall elements with their own lengths, not a room perimeter.
    if (r.unroofed) {
      rows.push({
        room: r.name_en,
        surface: "Floor",
        material: zoneSurface(r.type),
        area_m2: floorArea,
        notes: "Open to sky — no wall or ceiling finish",
        groupStart: true,
      });
      continue;
    }
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
  // G5: a document prints the project's display name when it has one (038).
  const p = await loadDocumentProject(getSupabaseAdmin() as unknown as SupabaseClient, projectId, "Untitled villa");
  return { name: p.name, city: p.city };
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

/** Load overlay fixtures for the services sheets (best-effort, flagged). */
async function loadOverlayFixtures(projectId: string): Promise<OverlayFixtureForSheet[]> {
  if (process.env.OVERLAYS_ENABLED !== "true") return [];
  try {
    const supabase = getSupabaseAdmin() as unknown as SupabaseClient;
    const { data, error } = await supabase
      .from("plan_fixtures")
      .select("type, position")
      .eq("project_id", projectId);
    if (error || !data) return [];
    return (data as { type: FixtureType; position: [number, number] }[]).map((r) => ({
      type: r.type,
      position: r.position,
    }));
  } catch {
    return [];
  }
}

/** G4b: counter variants by element id, so an elevation can say "BBQ counter". */
async function loadElementVariants(planId: string | null): Promise<Record<string, string | null>> {
  if (!planId) return {};
  try {
    const supabase = getSupabaseAdmin() as unknown as SupabaseClient;
    const { data, error } = await supabase.from("plan_elements").select("id, variant").eq("plan_id", planId);
    if (error || !data) return {};
    return Object.fromEntries((data as { id: string; variant: string | null }[]).map((r) => [r.id, r.variant]));
  } catch {
    return {};
  }
}

/**
 * G4: every fixture on the plan, all layers, for the garden sheets. Not gated by
 * OVERLAYS_ENABLED: a planter box or a garden light on an authored garden is
 * part of the design, not an MEP overlay. `[]` when the table is absent.
 */
async function loadGardenFixtures(projectId: string): Promise<GardenFixture[]> {
  try {
    const supabase = getSupabaseAdmin() as unknown as SupabaseClient;
    for (const cols of ["id, layer, type, room_id, position, spec, site_reference, disposition, dims_derived, derived_note", "id, layer, type, room_id, position, spec"]) {
      const { data, error } = await supabase.from("plan_fixtures").select(cols).eq("project_id", projectId);
      if (!error && data) return data as unknown as GardenFixture[];
    }
    return [];
  } catch {
    return [];
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

  // G4: a plan made only of outdoor zones gets the garden set INSTEAD of the
  // interior one. An as-built/demolition pair at a fixed 1:100 would run a 26 m
  // garden off the sheet and diff two identical graphs; neither says anything a
  // landscape contractor can build from. Mixed plans get both.
  const outdoor = asBuilt.rooms.filter((r) => r.unroofed);
  const interiorRooms = asBuilt.rooms.filter((r) => !r.unroofed);
  if (outdoor.length > 0 && interiorRooms.length === 0) {
    const fixturesAll = await loadGardenFixtures(projectId);
    // G5: a plan on derived dimensions stamps EVERY sheet as a draft.
    const draft = graphDraftStatus(asBuilt);
    const gardenMeta = { ...meta, projectId, ...(draft.statement ? { draft: draft.statement } : {}) };
    const garden = buildGardenSheets(asBuilt, fixturesAll, gardenMeta);
    const finish: DrawingSheet = {
      kind: "finish_schedule",
      title: "Finish Schedule",
      sheetNumber: "L-201",
      svg: renderFinishSchedule(buildFinishRows(asBuilt, styleKey), gardenMeta, {
        sheetNumber: "L-201",
        title: "Finish Schedule",
      }),
    };
    const zoneSheets = garden.filter((s) => s.kind === "site_plan" || s.kind === "zone_plan");
    const overlays = garden.filter((s) => s.kind === "lighting_overlay" || s.kind === "irrigation_overlay");
    // G4b: sectional elevations (L-3nn) after the finish schedule, the garden
    // elevation strips (L-501) last — sheet-number order.
    const elevations = buildElevationSheets(designGraph(asBuilt), designFixtures(fixturesAll), gardenMeta, await loadElementVariants(asBuilt.planId));
    const structures = elevations.filter((s) => s.kind === "structure_elevation");
    const strips = elevations.filter((s) => s.kind === "garden_elevation");
    const ordered: DrawingSheet[] = [...zoneSheets, finish, ...structures, ...overlays, ...strips];
    const cover: DrawingSheet = {
      kind: "cover",
      title: "Cover & Sheet Index",
      sheetNumber: "L-000",
      svg: renderCoverSheet(asBuilt, fixturesAll, gardenMeta, [{ sheetNumber: "L-000", title: "Cover & Sheet Index" }, ...ordered], draft.draft ? draft : null),
    };
    return {
      projectId,
      planId: asBuilt.planId,
      sheets: [cover, ...ordered],
      derivedNotes: asBuilt.notes,
    };
  }

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

  // A5: door/window schedule — assembled from the graph like every other
  // artifact. Omitted entirely when the plan has no openings rather than
  // printing an empty table (the parse never invents doors, so an empty
  // schedule would be a statement we can't support).
  //
  // Sourced from AS-BUILT, not proposed: `proposed` is a frozen plan_snapshots
  // graph captured at design lock, so it predates any opening drawn afterwards
  // (and snapshots written before A5 have no `openings` key at all). Openings
  // have one live source of truth — the plan_openings table that derivePlanGraph
  // reads — and that is also what the take-off deducts, so the schedule and the
  // net wall quantities are guaranteed to reconcile.
  const scheduleOpenings = (asBuilt.openings ?? []) as ScheduleSourceOpening[];
  if (scheduleOpenings.length > 0) {
    const roomNames = new Map(asBuilt.rooms.map((r) => [r.id, r.name_en]));
    const openingRows = buildOpeningRows(scheduleOpenings, roomNames);
    sheets.push({
      kind: "opening_schedule",
      title: "Door & Window Schedule",
      sheetNumber: "A-202",
      svg: renderOpeningSchedule(openingRows, meta, {
        sheetNumber: "A-202",
        title: "Door & Window Schedule",
      }),
    });
  }

  // P2: append electrical + plumbing services sheets when fixtures exist.
  const fixtures = await loadOverlayFixtures(projectId);
  const electrical = fixtures.filter((f) => layerOf(f.type) === "electrical");
  const plumbing = fixtures.filter((f) => layerOf(f.type) === "plumbing");
  if (electrical.length > 0) {
    sheets.push({
      kind: "electrical",
      title: "Electrical Plan",
      sheetNumber: "A-401",
      svg: renderElectricalSheet(asBuilt, electrical, meta, {
        sheetNumber: "A-401",
        title: "Electrical Plan",
      }),
    });
  }
  if (plumbing.length > 0) {
    sheets.push({
      kind: "plumbing",
      title: "Plumbing Plan",
      sheetNumber: "A-402",
      svg: renderPlumbingSheet(asBuilt, plumbing, meta, {
        sheetNumber: "A-402",
        title: "Plumbing Plan",
      }),
    });
  }

  // G4: a mixed plan (villa rooms AND garden zones) keeps its interior sheets
  // and gains the garden set after them.
  if (outdoor.length > 0) {
    const gardenFixtures = await loadGardenFixtures(projectId);
    const gardenMeta = { ...meta, projectId };
    const garden = buildGardenSheets(asBuilt, gardenFixtures, gardenMeta);
    sheets.push(...garden);
    sheets.push(...buildElevationSheets(asBuilt, gardenFixtures, gardenMeta, await loadElementVariants(asBuilt.planId)));
  }

  return { projectId, planId: asBuilt.planId, sheets, derivedNotes: asBuilt.notes };
}

/**
 * G4: a whole drawing set (or any subset) as ONE multi-page A3 PDF, in sheet
 * order. Same rasterisation as a single sheet, so a page prints at its stated
 * scale.
 */
export async function renderSetPdf(svgs: readonly string[]): Promise<Uint8Array> {
  const { Resvg } = await import("@resvg/resvg-js");
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  for (const svg of svgs) {
    // 250 dpi keeps a 20-sheet set openable while text stays crisp.
    const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 4134 } });
    const png = resvg.render().asPng();
    const page = pdf.addPage([420 * MM_TO_PT, 297 * MM_TO_PT]);
    const img = await pdf.embedPng(png);
    page.drawImage(img, { x: 0, y: 0, width: 420 * MM_TO_PT, height: 297 * MM_TO_PT });
  }
  return pdf.save();
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
