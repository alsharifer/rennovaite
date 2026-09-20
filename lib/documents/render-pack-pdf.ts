// =============================================================================
// lib/documents/render-pack-pdf.ts — load, assemble and export the render pack.
//
// Server-only. Reads the project the same way the drawing set does (the plan
// graph, the fixtures, the site plan sheet itself), picks each zone's CURRENT
// day render and the evening view made from it, hands everything to the pure
// page builder in ./render-pack, then writes an A3 PDF: page chrome rasterised
// through resvg exactly like a drawing sheet, photographs embedded as images at
// their own resolution.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { generateDrawingSet } from "@/lib/drawings/export";
import type { GardenFixture } from "@/lib/drawings/garden-sheets";
import { gardenStyleFor, getGardenStyle, isGardenStyleKey } from "@/lib/garden-styles";
import { designDecisions, layoutAssumptions } from "@/lib/documents/design-assumptions";
import { loadDocumentProject } from "@/lib/documents/project-name";
import { derivePlanGraph } from "@/lib/plan/derive";
import { graphDraftStatus } from "@/lib/plan/geometry";
import { loadGardenSceneContext } from "@/lib/scene-render/pipeline";
import { SCENE_PIPELINE_VERSION } from "@/lib/scene-render/prompts";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { loadParity } from "./parity-load";
import type { ParityResult } from "./parity";
import { PAGE_H, PAGE_W, buildRenderPack, containFit, packMix, type PackGardenView, type PackMix, type PackPhotoPair, type PackRender, type PackZone } from "./render-pack";

const MM_TO_PT = 72 / 25.4;

export interface GateRow {
  camera: string;
  label: string;
  view: "day" | "evening" | "photo_pair";
  outcome: "passed" | "substituted" | "missing";
  attempts: { attempt: number; passed: boolean; failures: string[] }[];
  /** G5c: cross-view consistency of a passed day render against the anchor view. */
  consistency?: { passed: boolean; failures: string[]; anchor: boolean } | null;
  /** G5c: why a design view shipped (gate_failed, inconsistent, no_passed_day…). */
  reason?: string | null;
}

export interface RenderPackSummary {
  gate: GateRow[];
  pages: { kind: string; title: string; images: number }[];
  zones: { ref: string; name: string; area_m2: number; derived_m2: number | null; day: boolean; evening: boolean; evening_expected: boolean }[];
  missing_images: string[];
  /** G5: before/after pairs + 3D design views (the backbone) and the styled renders that passed. */
  mix: PackMix;
  /** G5c: does the BoQ agree with the drawings and the views? */
  parity: ParityResult;
}

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
      if (res.status < 500) return null; // gone, not flaky
    } catch {
      /* network or timeout — retry */
    }
  }
  return null;
}

const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8;

/** Anything pdf-lib cannot embed directly (WebP, say) is re-encoded to PNG. */
async function toEmbeddable(bytes: Uint8Array): Promise<{ kind: "png" | "jpg"; bytes: Uint8Array } | null> {
  if (isPng(bytes)) return { kind: "png", bytes };
  if (isJpeg(bytes)) return { kind: "jpg", bytes };
  try {
    const mupdf = await import("mupdf");
    const image = new mupdf.Image(bytes);
    const png = image.toPixmap().asPNG();
    return { kind: "png", bytes: png };
  } catch {
    return null;
  }
}

export async function generateRenderPack(projectId: string): Promise<{ pdf: Uint8Array; summary: RenderPackSummary; pageSvgs: string[] }> {
  const supabase = getSupabaseAdmin() as unknown as SupabaseClient;

  const [graph, set, projectRes, styleRes, fixturesRes, sceneRes, ctx] = await Promise.all([
    derivePlanGraph(projectId),
    generateDrawingSet(projectId),
    loadDocumentProject(supabase, projectId),
    supabase
      .from("style_choices")
      .select("style_key")
      .eq("project_id", projectId)
      .is("room_id", null)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase.from("plan_fixtures").select("id, layer, type, room_id, position, spec, site_reference, disposition, dims_derived").eq("project_id", projectId),
    // G4b: ONLY plan-faithful scene renders, and only this project's. A photo-
    // mode or legacy off-plan render has not been gated and never enters a pack.
    supabase
      .from("renders")
      .select("id, camera, view, image_url, gate, created_at, project_id")
      .eq("project_id", projectId)
      .eq("mode", "scene")
      .eq("status", "succeeded")
      .order("created_at", { ascending: false }),
    loadGardenSceneContext(projectId).catch(() => null),
  ]);

  const draftStatus = graphDraftStatus(graph);
  const variants: Record<string, string | null> = {};
  if (graph.planId) {
    const { data } = await supabase.from("plan_elements").select("id, variant").eq("plan_id", graph.planId);
    for (const r of (data ?? []) as { id: string; variant: string | null }[]) variants[r.id] = r.variant;
  }

  // The pack is about the garden, so it names the garden direction: a garden
  // key as locked, or an interior key's companion exterior style.
  const styleKey = (styleRes.data?.[0]?.style_key as string | undefined) ?? null;
  const style = styleKey ? getGardenStyle(isGardenStyleKey(styleKey) ? styleKey : gardenStyleFor(styleKey)) : null;

  type SceneRow = {
    id: string;
    camera: string;
    view: string;
    image_url: string;
    project_id: string;
    gate: {
      outcome: "passed" | "substituted";
      design_view_reason?: string | null;
      scene_url?: string;
      flat_url?: string;
      pipeline?: string;
      scene_hash?: string;
      spec_hash?: string;
      consistency?: { anchor_id: string; passed: boolean; failures: string[]; status: string };
      attempts: { attempt: number; passed: boolean; failures: string[]; placement_checked?: boolean }[];
      manifest?: { items: { key: string; share: number; box?: [number, number, number, number] }[] };
    } | null;
  };
  const designUrls = new Map<string, string>();
  // G5c: only renders of THIS design — current pipeline, scene and specification.
  // An older render of a camera id that still exists is not a view of the garden
  // as it now stands.
  const rows = ((sceneRes.data ?? []) as SceneRow[]).filter(
    (r) => r.project_id === projectId && r.gate && (!ctx || (r.gate.pipeline === SCENE_PIPELINE_VERSION && r.gate.scene_hash === ctx.sceneHash && r.gate.spec_hash === ctx.specHash)),
  );
  // G5c: the BEST render of this design for a camera, not merely the newest one.
  // Several rows can exist for one view (a re-run with different conditioning);
  // they are all renders of the same garden, so a view that passed its gate — and
  // the anchor's consistency check — is what may ship, newest first.
  const latest = (camera: string, view: "day" | "evening") => {
    const forView = rows.filter((r) => r.camera === camera && (r.view === "evening" ? "evening" : "day") === view);
    const passed = forView.filter((r) => r.gate!.outcome === "passed" && r.gate!.attempts.some((a) => a.passed));
    const consistent = passed.filter((r) => r.gate!.consistency?.status !== "ran" || r.gate!.consistency.passed);
    return consistent[0] ?? passed[0] ?? forView[0] ?? null;
  };
  const toPack = (r: SceneRow | null): PackRender | null => {
    if (!r) return null;
    const gatePassed = r.gate!.outcome === "passed" && r.gate!.attempts.some((a) => a.passed);
    // G5c: a render that passed its own gate but shows a different garden from the
    // anchor view does not enter the pack as a render.
    const inconsistent = gatePassed && r.view !== "evening" && r.gate!.consistency?.status === "ran" && r.gate!.consistency.passed === false;
    const passed = gatePassed && !inconsistent;
    const lastFailure = inconsistent ? `render withheld — ${r.gate!.consistency!.failures[0] ?? "inconsistent with the other views"}` : (r.gate!.attempts.at(-1)?.failures?.[0] ?? null);
    const byChoice = !passed && !inconsistent && r.gate!.design_view_reason === "no_clean_camera";
    // A passed DAY render carries the FLAT line model it was checked against, as a
    // small inset (G5c: the line model is never a main image).
    const insetUrl = r.gate!.flat_url ?? r.gate!.scene_url;
    const design = passed && r.view !== "evening" && insetUrl ? { id: `design:${r.id}` } : null;
    if (design) designUrls.set(design.id, insetUrl!);
    // A design view's main image is the TEXTURED model (the substitution's image_url;
    // for an inconsistent render, the model it was conditioned on).
    const image_url = inconsistent ? (r.gate!.scene_url ?? r.image_url) : r.image_url;
    // G5d: the attempt that passed must also have passed the built-feature placement check.
    const placementVerified = r.gate!.attempts.some((a) => a.passed && a.placement_checked === true);
    const shows = (r.gate!.manifest?.items ?? []).map((i) => ({ key: i.key, share: i.share, ...(i.box ? { box: i.box } : {}) }));
    return { id: inconsistent ? `textured:${r.id}` : r.id, image_url, kind: passed ? "render" : "design_view", gate_passed: passed, note: passed || byChoice ? null : lastFailure, by_choice: byChoice, design, shows, ...(passed ? { placement_verified: placementVerified } : {}) };
  };
  const cameras = ctx?.cameras ?? [];
  const byRoom: Record<string, { day: PackRender | null; evening: PackRender | null }> = {};
  for (const room of graph.rooms) {
    const cam = cameras.find((c) => c.zoneId === room.id);
    byRoom[room.id] = { day: cam ? toPack(latest(cam.id, "day")) : null, evening: cam ? toPack(latest(cam.id, "evening")) : null };
  }
  const gardenViews: PackGardenView[] = cameras
    .filter((c) => c.zoneId === null)
    .map((c) => ({ id: c.id, label: c.label, lit: c.lit, day: toPack(latest(c.id, "day")), evening: c.lit ? toPack(latest(c.id, "evening")) : null }));
  // G5: before/after photo pairs — only a restyle that passed its own check.
  type PairRow = { id: string; room_id: string | null; camera: string; image_url: string; source_image_url: string; gate: { outcome: "passed" | "withheld"; attempts: { attempt: number; passed: boolean; failures: string[] }[]; caption?: string; zone_name?: string } | null };
  const { data: pairData } = await supabase
    .from("renders")
    .select("id, room_id, camera, image_url, source_image_url, gate, created_at, project_id")
    .eq("project_id", projectId)
    .eq("mode", "photo_pair")
    .eq("status", "succeeded")
    .order("created_at", { ascending: false });
  const pairRows = ((pairData ?? []) as (PairRow & { project_id: string })[]).filter((r) => r.project_id === projectId && r.gate);
  const latestPair = new Map<string, PairRow>();
  for (const r of pairRows) if (!latestPair.has(r.camera)) latestPair.set(r.camera, r);
  // G5c: ONE pair per zone. Two photos of the same zone can both pass, and two
  // before/after pages of the same corner is a pack repeating itself.
  const perZone = new Map<string, PairRow>();
  for (const r of [...latestPair.values()].filter((r) => r.gate!.outcome === "passed" && r.gate!.attempts.some((a) => a.passed))) {
    const zone = r.room_id ?? r.gate!.zone_name ?? r.camera;
    if (!perZone.has(zone)) perZone.set(zone, r);
  }
  const photoPairs: PackPhotoPair[] = [...perZone.values()]
    .map((r) => ({
      id: r.id,
      zoneName: r.gate!.zone_name ?? graph.rooms.find((z) => z.id === r.room_id)?.name_en ?? "Garden",
      beforeId: `before:${r.id}`,
      after: { id: r.id, image_url: r.image_url, kind: "photo_edit", gate_passed: true, note: null },
      caption: r.gate!.caption ?? "Client photo restyled in the design direction; layout and dimensions are on the drawing set.",
    }));
  const beforeUrls = new Map([...latestPair.values()].map((r) => [`before:${r.id}`, r.source_image_url]));

  const gate: GateRow[] = [
    ...[...latestPair.values()].map((r) => ({
      camera: r.camera,
      label: r.gate!.zone_name ?? "photo pair",
      view: "photo_pair" as const,
      outcome: (r.gate!.outcome === "passed" ? "passed" : "substituted") as GateRow["outcome"],
      attempts: r.gate!.attempts.map((a) => ({ attempt: a.attempt, passed: a.passed, failures: a.failures })),
    })),
  ];
  gate.push(...cameras.flatMap((c) =>
    (c.lit ? (["day", "evening"] as const) : (["day"] as const)).map((view) => {
      const r = latest(c.id, view);
      const cons = r && view === "day" && r.gate!.outcome === "passed" && r.gate!.consistency ? r.gate!.consistency : null;
      const inconsistent = cons?.status === "ran" && cons.passed === false;
      return {
        camera: c.id,
        label: c.label,
        view,
        outcome: (r ? (inconsistent ? "substituted" : r.gate!.outcome) : "missing") as GateRow["outcome"],
        attempts: r ? r.gate!.attempts.map((a) => ({ attempt: a.attempt, passed: a.passed, failures: a.failures })) : [],
        consistency: cons ? { passed: cons.passed, failures: cons.failures, anchor: cons.anchor_id === r!.id } : null,
        reason: r && (inconsistent || r.gate!.outcome !== "passed") ? (inconsistent ? "inconsistent" : (r.gate!.design_view_reason ?? null)) : null,
      };
    }),
  ));

  // Fetch every photograph BEFORE composing, so a render whose image cannot be
  // fetched gets a page that says so instead of an empty frame.
  const bytesById = new Map<string, { kind: "png" | "jpg"; bytes: Uint8Array }>();
  const wanted: { id: string; image_url: string }[] = [
    ...[...Object.values(byRoom), ...gardenViews].flatMap((r) => [r.day, r.evening]).filter((r): r is PackRender => !!r),
    ...photoPairs.flatMap((p) => [p.after, { id: p.beforeId, image_url: beforeUrls.get(p.beforeId)! }]),
    ...[...designUrls.entries()].map(([id, image_url]) => ({ id, image_url })),
  ];
  for (let i = 0; i < wanted.length; i += 4) {
    await Promise.all(
      wanted.slice(i, i + 4).map(async (r) => {
        const raw = await fetchBytes(r.image_url);
        const ready = raw ? await toEmbeddable(raw) : null;
        if (ready) bytesById.set(r.id, ready);
      }),
    );
  }
  const unavailable = new Set(wanted.filter((r) => !bytesById.has(r.id)).map((r) => r.id));

  const { pages, zones } = buildRenderPack({
    graph,
    fixtures: (fixturesRes.data ?? []) as GardenFixture[],
    renders: byRoom,
    elementVariants: variants,
    style,
    projectName: projectRes.name,
    community: projectRes.city,
    dateISO: new Date().toISOString().slice(0, 10),
    sitePlanSvg: set.sheets.find((s) => s.kind === "site_plan")?.svg ?? null,
    unavailableRenderIds: unavailable,
    gardenViews,
    draft: draftStatus.statement,
    draftNote: draftStatus.note,
    photoPairs: photoPairs.filter((p) => !unavailable.has(p.after.id) && !unavailable.has(p.beforeId)),
    // A proposal page belongs to a draft: a completed garden has nothing to confirm.
    assumptions: draftStatus.draft
      ? {
          decisions: designDecisions(graph, (fixturesRes.data ?? []) as GardenFixture[]),
          layout: [
            // The direction itself is a proposal until the client confirms it.
            ...(style ? [`Design direction: ${style.name_en} — proposed, to confirm with the client`] : []),
            ...layoutAssumptions(graph),
          ],
        }
      : null,
  });

  const { Resvg } = await import("@resvg/resvg-js");
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${projectRes.name} — render pack`);
  pdf.setAuthor("RennovAIte");
  pdf.setCreator("RennovAIte");
  pdf.setProducer("RennovAIte");

  const embedded = new Map<string, Awaited<ReturnType<typeof pdf.embedPng>>>();
  const imageFor = async (renderId: string) => {
    if (embedded.has(renderId)) return embedded.get(renderId)!;
    const ready = bytesById.get(renderId);
    if (!ready) return null;
    const img = ready.kind === "png" ? await pdf.embedPng(ready.bytes) : await pdf.embedJpg(ready.bytes);
    embedded.set(renderId, img);
    return img;
  };

  for (const p of pages) {
    const png = new Resvg(p.svg, { fitTo: { mode: "width", value: 4134 } }).render().asPng();
    const page = pdf.addPage([PAGE_W * MM_TO_PT, PAGE_H * MM_TO_PT]);
    page.drawImage(await pdf.embedPng(png), { x: 0, y: 0, width: PAGE_W * MM_TO_PT, height: PAGE_H * MM_TO_PT });
    for (const slot of p.images) {
      const img = await imageFor(slot.renderId);
      if (!img) continue;
      const fit = containFit(img.width, img.height, slot);
      page.drawImage(img, {
        x: fit.x * MM_TO_PT,
        y: (PAGE_H - fit.y - fit.h) * MM_TO_PT,
        width: fit.w * MM_TO_PT,
        height: fit.h * MM_TO_PT,
      });
    }
  }

  // G5c: the parity gate runs on every pack export.
  const parity = await loadParity(supabase, projectId);
  const summary: RenderPackSummary = {
    parity,
    gate,
    pages: pages.map((p) => ({ kind: p.kind, title: p.title, images: p.images.length })),
    zones: zones.map((z: PackZone) => ({
      ref: z.ref,
      name: z.room.name_en,
      area_m2: z.room.area_m2,
      derived_m2: z.room.area_derived_m2,
      day: !!z.day,
      evening: !!z.evening,
      evening_expected: z.eveningExpected,
    })),
    missing_images: [...unavailable],
    mix: packMix({ renders: byRoom, gardenViews, photoPairs }),
  };
  // The page SVGs are what was printed (photographs aside): returned so a check
  // can assert on the exact text a client reads (G5 identity + draft assertions).
  return { pdf: await pdf.save(), summary, pageSvgs: pages.map((p) => p.svg) };
}
