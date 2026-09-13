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
import { derivePlanGraph } from "@/lib/plan/derive";
import { loadRenders } from "@/lib/render-batch/load";
import { currentDayRender } from "@/lib/render-batch/plan";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { PAGE_H, PAGE_W, buildRenderPack, containFit, type PackRender, type PackZone } from "./render-pack";

const MM_TO_PT = 72 / 25.4;

export interface RenderPackSummary {
  pages: { kind: string; title: string; images: number }[];
  zones: { ref: string; name: string; area_m2: number; derived_m2: number | null; day: boolean; evening: boolean; evening_expected: boolean }[];
  missing_images: string[];
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

export async function generateRenderPack(projectId: string): Promise<{ pdf: Uint8Array; summary: RenderPackSummary }> {
  const supabase = getSupabaseAdmin() as unknown as SupabaseClient;

  const [graph, set, projectRes, styleRes, fixturesRes, renders] = await Promise.all([
    derivePlanGraph(projectId),
    generateDrawingSet(projectId),
    supabase.from("projects").select("name, city").eq("id", projectId).maybeSingle<{ name: string | null; city: string | null }>(),
    supabase
      .from("style_choices")
      .select("style_key")
      .eq("project_id", projectId)
      .is("room_id", null)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase.from("plan_fixtures").select("id, layer, type, room_id, position, spec").eq("project_id", projectId),
    loadRenders(supabase, projectId),
  ]);

  const variants: Record<string, string | null> = {};
  if (graph.planId) {
    const { data } = await supabase.from("plan_elements").select("id, variant").eq("plan_id", graph.planId);
    for (const r of (data ?? []) as { id: string; variant: string | null }[]) variants[r.id] = r.variant;
  }

  // The pack is about the garden, so it names the garden direction: a garden
  // key as locked, or an interior key's companion exterior style.
  const styleKey = (styleRes.data?.[0]?.style_key as string | undefined) ?? null;
  const style = styleKey ? getGardenStyle(isGardenStyleKey(styleKey) ? styleKey : gardenStyleFor(styleKey)) : null;

  const byRoom: Record<string, { day: PackRender | null; evening: PackRender | null }> = {};
  for (const room of graph.rooms) {
    const day = currentDayRender(renders, room.id);
    const evening = day
      ? renders
          .filter((r) => r.view === "evening" && r.parent_render_id === day.id && r.status === "succeeded" && r.image_url)
          .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0]
      : undefined;
    byRoom[room.id] = {
      day: day?.image_url ? { id: day.id, image_url: day.image_url } : null,
      evening: evening?.image_url ? { id: evening.id, image_url: evening.image_url } : null,
    };
  }

  // Fetch every photograph BEFORE composing, so a render whose image cannot be
  // fetched gets a page that says so instead of an empty frame.
  const bytesById = new Map<string, { kind: "png" | "jpg"; bytes: Uint8Array }>();
  const wanted = Object.values(byRoom).flatMap((r) => [r.day, r.evening]).filter((r): r is PackRender => !!r);
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
    projectName: projectRes.data?.name?.trim() || "Untitled garden",
    community: projectRes.data?.city?.trim() || "Dubai",
    dateISO: new Date().toISOString().slice(0, 10),
    sitePlanSvg: set.sheets.find((s) => s.kind === "site_plan")?.svg ?? null,
    unavailableRenderIds: unavailable,
  });

  const { Resvg } = await import("@resvg/resvg-js");
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${projectRes.data?.name?.trim() || "Garden"} — render pack`);
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

  const summary: RenderPackSummary = {
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
  };
  return { pdf: await pdf.save(), summary };
}
