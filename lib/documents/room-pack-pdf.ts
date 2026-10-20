// =============================================================================
// lib/documents/room-pack-pdf.ts — load, assemble and export one room's client
// pack (bathroom pilot B6). Server-only.
//
// Reads the room the way the BoQ and the studio do — the plan graph, the
// fixtures, every photo view with its versions, locks and the room's anchor,
// the latest BoQ revision (curated), the interior timeline — hands it to the
// pure page builder (./room-pack) and the room's drawings (lib/drawings/
// room-sheets), then writes an A3 PDF: chrome rasterised through resvg,
// photographs embedded at their own resolution (render-pack's method).
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { roomSheets, roomWalls, wallTileFrom } from "@/lib/drawings/room-sheets";
import { sheetRev } from "@/lib/drawings/sheet";
import { curateBoq, curateText, loadWithheldNames } from "@/lib/identity/curation";
import { footprintCorners, footprintOf } from "@/lib/overlays/footprint";
import { withoutReplaced } from "@/lib/overlays/replaces";
import { derivePlanGraph } from "@/lib/plan/derive";
import { loadStudioState, type PhotoViewVersion } from "@/lib/render/photo-view-anchor";
import { loadMiniPlans, loadPhotoViews } from "@/lib/render/photo-views-load";
import { photoViewCheckRows } from "@/lib/render/design-check-items";
import { followsStateOf, specElements, specFieldsChanged } from "@/lib/render/room-spec-vocab";
import { programmeOf } from "@/lib/timeline/programme";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { documentFontOptions } from "./doc-fonts";
import { stampPdfDay } from "./pdf-date";
import { loadDocumentProject } from "./project-name";
import { containFit } from "./render-pack";
import { boqFixtureKinds, designKey, designSignature, renderConsistency, type CurrentDesign } from "./render-consistency";
import { buildRoomPack, PACK_H, PACK_W, type RoomPackInput, type RoomPackView } from "./room-pack";

const MM_TO_PT = 72 / 25.4;

export class RoomPackError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
      if (res.status < 500) return null;
    } catch {
      /* retry */
    }
  }
  return null;
}
const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50;
const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8;

/** C5 #2: a version's design check, itemised — the five rows the studio prints (PhotoViewStudio checkRows). */
function checksOf(v: PhotoViewVersion, photoId: string, anchor: { room_photo_id: string | null; render_id: string; label: string } | null, latestAnchorId: string | null, designNow: string | null): { text: string; ok: boolean }[] {
  const g = v.gate;
  const state = followsStateOf({ viewPhotoId: photoId, anchor, renderAnchorId: latestAnchorId, followsPassed: g.anchor && g.outcome === "passed" ? !!g.attempts.at(-1)?.style?.passed : null, changedSpec: g.change ? specFieldsChanged(g.change.changed) : null });
  const off = state === "differs" ? (g.attempts.at(-1)?.style?.elements ?? []).filter((e) => e.verdict !== "yes").map((e) => e.element) : state === "changed" ? (g.change?.changed ?? []) : [];
  return photoViewCheckRows({ gate: g, follows: anchor ? state : null, anchorLabel: anchor?.label ?? null, followsOff: off, designNow, styleLine: g.outcome === "passed" ? g.style_line : null }).map((r) => ({ text: `${r.label} — ${r.reason}`, ok: r.state === "pass" }));
}

export interface RoomPackSummary {
  pages: { kind: string; title: string; images: number }[];
  views: { label: string; render: string | null; locked: boolean; anchor: boolean }[];
  sheets: string[];
  missing_images: string[];
  /** B7: views shown as "view pending" — why each render was held back. */
  pending_views: { view: string; reason: string }[];
  grand_total_aed: number;
  boq_id: string;
}

export async function generateRoomPack(projectId: string, opts: { brand?: string } = {}): Promise<{ pdf: Uint8Array; summary: RoomPackSummary; pageSvgs: string[]; pageImages: { src: string; x: number; y: number; w: number; h: number }[][] }> {
  const db = getSupabaseAdmin() as unknown as SupabaseClient;
  const [graph, project, boqRes, revRes] = await Promise.all([
    derivePlanGraph(projectId),
    loadDocumentProject(db, projectId),
    db.from("boqs").select("id, sections").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle<{ id: string; sections: RoomPackInput["boq"] }>(),
    db.from("boqs").select("id", { count: "exact", head: true }).eq("project_id", projectId),
  ]);
  const inScope = graph.rooms.filter((r) => r.in_scope !== false);
  if (inScope.length !== 1) throw new RoomPackError(409, "not_a_room_project", "The room pack is for a project that is one room.");
  const room = inScope[0]!;
  if (!boqRes.data) throw new RoomPackError(409, "no_boq", "Generate the BoQ first — the pack prints its bill and price.");

  const { data: fxRows } = await db.from("plan_fixtures").select("id, type, position, spec, room_id").eq("project_id", projectId).eq("room_id", room.id);
  const fixtures = withoutReplaced(((fxRows ?? []) as { id: string; type: string; position: [number, number]; spec: Record<string, unknown> | null }[]).filter((f) => Array.isArray(f.position)));

  const views = (await loadPhotoViews(db, [room.id]))[room.id] ?? [];
  const state = await loadStudioState(db, [room.id], views.map((v) => v.id));
  const anchor = state.anchors[room.id] ?? null;
  const k = graph.meta.unit_to_m, o = graph.meta.norm_origin;
  const consistency: { view: string; reason: string }[] = [];
  const toM = (p: [number, number]): [number, number] => [(p[0] - o[0]) * k, (p[1] - o[1]) * k];

  // B7 1a: a render goes in only when it matches the CURRENT design — the fixtures
  // the BoQ prices, the current anchor, the same finishes and product choices.
  const { data: planRow } = await db.from("plans").select("id, total_area_m2, source, plot_width_m").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle<{ id: string; total_area_m2: number | null; source: string | null; plot_width_m: number | null }>();
  const mini = planRow ? (await loadMiniPlans(db, projectId, planRow, [room.id]))[room.id] : undefined;
  const { data: revRows } = await db.from("boqs").select("created_at, sections").eq("project_id", projectId).order("created_at", { ascending: true });
  const current: CurrentDesign = {
    fixtures: boqFixtureKinds(boqRes.data.sections.sections.flatMap((s) => s.lines)),
    anchor: anchor?.room_photo_id ? { render_id: anchor.render_id, room_photo_id: anchor.room_photo_id } : null,
    design_key: designKey(mini?.fixtures ?? [], (room.spec as Record<string, unknown> | undefined)?.wet_room ?? null),
    revisions: ((revRows ?? []) as { created_at: string; sections: { sections?: { work_section: string; lines: { rule_id?: string; item_key?: string; quantity?: number }[] }[] } | null }[]).map((r) => ({ created_at: r.created_at, signature: designSignature(r.sections?.sections ?? []) })),
  };
  const consistencyOf = (photoId: string, x: PhotoViewVersion) =>
    renderConsistency(
      {
        render_id: x.render_id,
        created_at: x.created_at,
        items: x.gate.items ?? [],
        anchor_render_id: x.anchor_render_id,
        follows: x.gate.anchor ? (x.gate.attempts.at(-1)?.style?.elements ?? null) : null,
        design_key: x.gate.design_key ?? null,
      },
      photoId,
      current,
    );
  const packViews: RoomPackView[] = views.map((v) => {
    const vs = state.versions[v.id] ?? [];
    const lockedId = state.locked[v.id];
    const locked = lockedId ? (vs.find((x) => x.render_id === lockedId) ?? null) : null;
    // The locked version is the client's pick: shown only if it matches. Else the latest passed one that does.
    // B8: "passed" means BOTH checks — a view whose finishes were judged and do not follow is not shipped.
    const candidates = locked ? [locked] : [...vs].reverse().filter((x) => x.gate.outcome === "passed" && x.image_url && x.gate.attempts.at(-1)?.style?.passed !== false);
    const verdicts = candidates.map((x) => ({ x, c: consistencyOf(v.id, x) }));
    const shown = verdicts.find((d) => d.c.ok)?.x ?? null;
    const refused = verdicts[0] && !verdicts[0].c.ok ? verdicts[0].c : null;
    const latest = (lockedId ? vs.find((x) => x.render_id === lockedId) : vs.at(-1)) ?? null;
    if (!shown) consistency.push({ view: v.label.split(" · ")[0]!, reason: refused && !refused.ok ? refused.reason : "no passed render" });
    return {
      n: v.n,
      label: v.label,
      origin: "from your photo",
      render: shown?.image_url ? { src: shown.image_url, version: vs.indexOf(shown) + 1 } : null,
      pending: shown ? null : refused && !refused.ok ? refused.placeholder : null,
      photo: { src: v.url },
      checks: shown ? checksOf(shown, v.id, anchor, latest?.anchor_render_id ?? null, current.design_key) : [],
      locked: !!lockedId,
      anchor: anchor?.room_photo_id === v.id,
      camera: v.camera ? { position: toM(v.camera.position), heading_deg: v.camera.heading_deg } : null,
    };
  });

  const withheld = await loadWithheldNames(db, projectId);
  const boq = curateBoq(boqRes.data.sections, withheld);
  const rev = sheetRev(revRes.count ?? 1);
  const dateISO = new Date().toISOString().slice(0, 10);
  const sheets = roomSheets({ graph, roomId: room.id, fixtures, tile: wallTileFrom(anchor?.spec.wall_tile ?? null), mirror: anchor?.spec.mirror ?? null, meta: { projectNameEn: project.name, community: project.city ?? "", level: graph.meta.level, scale: "1:20", dateISO, rev, projectId } });

  // B7 1c / C4: THE programme (programmeOf) — the room's own quantities; none = no page.
  const programme = programmeOf(boq as never);
  const tiled = typeof room.tiled_height_m === "number" && room.tiled_height_m < room.ceiling_h_m ? `to ${Math.round(room.tiled_height_m * 1000)} mm` : "to full height";

  const input: RoomPackInput = {
    brand: opts.brand ?? "RenovAIte",
    projectName: project.name,
    community: project.city ?? "",
    dateISO,
    rev,
    room: { name: room.name_en, area_m2: room.area_m2, ceiling_mm: Math.round(room.ceiling_h_m * 1000), tiled, polygon: room.polygon as [number, number][], mPerU: k },
    fixtures: fixtures.map((f) => {
      const fp = footprintOf(f.type, f.spec);
      return { type: f.type, corners: fp ? footprintCorners(f.position, fp, k).map((p) => toM(p as [number, number])) : [] };
    }),
    openings: graph.openings
      .filter((op) => op.position && (op.room_id === room.id || graph.walls.find((w) => w.id === op.wall_id)?.room_ids.includes(room.id)))
      .map((op) => {
        const walls = roomWalls(room);
        const p = op.position as [number, number];
        const w = walls.slice().sort((a, b) => Math.abs((p[0] - a.left[0]) * a.inward[0] + (p[1] - a.left[1]) * a.inward[1]) - Math.abs((p[0] - b.left[0]) * b.inward[0] + (p[1] - b.left[1]) * b.inward[1]))[0]!;
        const d = [w.right[0] - w.left[0], w.right[1] - w.left[1]], L = Math.hypot(d[0]!, d[1]!) || 1;
        const u = [d[0]! / L, d[1]! / L] as const, h = op.width_mm / 2000;
        return { kind: op.type, a: [p[0] - u[0] * h, p[1] - u[1] * h] as [number, number], b: [p[0] + u[0] * h, p[1] + u[1] * h] as [number, number] };
      }),
    views: packViews,
    anchorLabel: anchor?.label ?? null,
    sheets,
    spec: anchor ? specElements(anchor.spec) : null,
    boq,
    programme,
  };

  const pages = buildRoomPack(input).map((p) => ({ ...p, svg: curateText(p.svg, withheld) }));

  const { Resvg } = await import("@resvg/resvg-js");
  const { PDFDocument } = await import("pdf-lib");
  const pdf = stampPdfDay(await PDFDocument.create());
  pdf.setTitle(curateText(`${project.name} — ${room.name_en} — client pack`, withheld));
  pdf.setAuthor("RenovAIte");
  pdf.setCreator("RenovAIte");
  pdf.setProducer("RenovAIte");
  const missing: string[] = [];
  const embedded = new Map<string, Awaited<ReturnType<typeof pdf.embedJpg>> | null>();
  const imageFor = async (src: string) => {
    if (embedded.has(src)) return embedded.get(src)!;
    const bytes = await fetchBytes(src);
    const img = bytes && isPng(bytes) ? await pdf.embedPng(bytes) : bytes && isJpeg(bytes) ? await pdf.embedJpg(bytes) : null;
    if (!img) missing.push(src);
    embedded.set(src, img);
    return img;
  };
  for (const p of pages) {
    const png = new Resvg(p.svg, { fitTo: { mode: "width", value: 4134 }, font: documentFontOptions() }).render().asPng();
    const page = pdf.addPage([PACK_W * MM_TO_PT, PACK_H * MM_TO_PT]);
    page.drawImage(await pdf.embedPng(png), { x: 0, y: 0, width: PACK_W * MM_TO_PT, height: PACK_H * MM_TO_PT });
    for (const slot of p.images) {
      const img = await imageFor(slot.src);
      if (!img) continue;
      const fit = containFit(img.width, img.height, slot);
      page.drawImage(img, { x: fit.x * MM_TO_PT, y: (PACK_H - fit.y - fit.h) * MM_TO_PT, width: fit.w * MM_TO_PT, height: fit.h * MM_TO_PT });
    }
  }
  return {
    pdf: await pdf.save(),
    pageSvgs: pages.map((p) => p.svg),
    pageImages: pages.map((p) => p.images),
    summary: {
      pages: pages.map((p) => ({ kind: p.kind, title: p.title, images: p.images.length })),
      views: packViews.map((v) => ({ label: v.label, render: v.render?.src ?? null, locked: v.locked, anchor: v.anchor })),
      sheets: sheets.map((s) => `${s.number} ${s.title}`),
      missing_images: missing,
      pending_views: consistency,
      grand_total_aed: boq.grand_total_aed,
      boq_id: boqRes.data.id,
    },
  };
}
