// =============================================================================
// lib/documents/render-pack.ts — the garden render pack, as pages (G4, E1-lite).
//
// Pure: a PlanGraph, the fixtures, the renders and the direction in; a list of
// A3 pages out. Each page is an SVG (the chrome — headings, facts, tables) plus
// IMAGE SLOTS in millimetres where the server places the render photographs.
// Photos are embedded as images in the PDF rather than rasterised into the SVG,
// so a render keeps its own resolution.
//
// Assembled from the graph like every other document: a zone's name, area and
// derived-area flag come from the same Room the drawing set dimensions, its
// lighting from the same fixtures the electrical overlay draws, and its order
// and Z-reference from gardenZones — so "Z05" is the pergola in the pack, on
// the site plan and in the BoQ trace alike.
//
// What the pack never carries: a price, a rate, a rate source or a contractor.
// It is a client-facing document about what the garden will look like.
// =============================================================================

import { LIGHTING_SOURCE_STATEMENT, gardenZones, toMetres, type GardenFixture } from "@/lib/drawings/garden-sheets";
import {
  BONE,
  BRASS,
  FONT_DISPLAY,
  FONT_MONO,
  FONT_UI,
  INK_100,
  INK_500,
  INK_700,
  INK_900,
  PAPER,
  TERRACOTTA,
  esc,
} from "@/lib/drawings/sheet";
import type { GardenStyle } from "@/lib/garden-styles";
import { LINEAR_ELEMENT_META } from "@/lib/plan/elements";
import { isInDesign } from "@/lib/plan/site-reference";
import type { PlanGraph, Room } from "@/lib/plan/geometry";
import { roomTypeLabel, zoneSurface } from "@/lib/plan/zones";
import { lightingByZone, wantsEvening, type ZoneLight } from "@/lib/render-batch/plan";
import type { Style } from "@/lib/styles";

import type { DecisionRow } from "./design-assumptions";

export const PAGE_W = 420; // mm, A3 landscape — same sheet as the drawing set
export const PAGE_H = 297;
const M = 18; // page margin

export interface PackRender {
  id: string;
  image_url: string;
  /**
   * G4b: "render" = a plan-faithful render that PASSED the faithfulness gate;
   * "design_view" = the raw 3D design model shipped because no render passed.
   */
  kind: "render" | "design_view" | "photo_edit";
  gate_passed: boolean;
  /** Why a design view was shipped instead of a render. */
  note?: string | null;
  /** G5: shown as the 3D design view by choice — no clean camera, no attempt made. */
  by_choice?: boolean;
  /** G5: a passed render carries its 3D design view as an inset (image-slot id). */
  design?: { id: string } | null;
  /** G5d: which scene objects the camera shows, and how much of the frame each takes. */
  shows?: { key: string; share: number; box?: [number, number, number, number] }[];
  /**
   * G5d: the built-feature placement check ran on the attempt that passed. A render
   * without it cannot prove it shows the plan's arrangement, and never enters a pack.
   */
  placement_verified?: boolean;
  /** G5d: this zone's own camera did not pass; the image is another passed view that shows it. */
  borrowed_from?: string | null;
}

/** G5: what the pack is made of — the backbone and the extras. */
export interface PackMix {
  photo_pairs: number;
  design_views_by_choice: number;
  design_views_after_gate: number;
  styled_renders: number;
  missing: number;
}

export function packMix(input: Pick<RenderPackInput, "renders" | "gardenViews" | "photoPairs">): PackMix {
  const all = [...Object.values(input.renders), ...(input.gardenViews ?? [])].flatMap((r) => [r.day, r.evening]);
  const views = [...(input.gardenViews ?? [])];
  const expectedMissing = views.filter((v) => !v.day).length + views.filter((v) => v.lit && !v.evening).length;
  return {
    photo_pairs: (input.photoPairs ?? []).length,
    design_views_by_choice: all.filter((r) => r?.kind === "design_view" && r.by_choice).length,
    design_views_after_gate: all.filter((r) => r?.kind === "design_view" && !r.by_choice).length,
    styled_renders: all.filter((r) => r?.kind === "render").length,
    missing: expectedMissing + Object.values(input.renders).filter((r) => !r.day).length,
  };
}

/**
 * No render enters a pack without passing the gate. Enforced here, where pages
 * are built, so no caller can route around it.
 */
export function assertPackable(r: PackRender): PackRender {
  if ((r.kind === "render" || r.kind === "photo_edit") && !r.gate_passed) {
    throw new Error(`render ${r.id} has not passed the faithfulness gate and cannot enter a pack`);
  }
  // G5d: two passed renders must not show two arrangements of the same structures.
  // Each is held to the one scene by the placement check — one without it is out.
  if (r.kind === "render" && r.placement_verified === false) {
    throw new Error(`render ${r.id} has not been checked for built-feature placement and cannot enter a pack`);
  }
  return r;
}

/** G5d: may this image stand as a view's picture? Only a passed, placement-checked render. */
export const isPassedRender = (r: PackRender | null | undefined): r is PackRender => !!r && r.kind === "render" && r.gate_passed && r.placement_verified !== false;

/**
 * G5d: a zone whose own camera did not pass borrows the passed view that shows it
 * best — the Z01 pergola page led with a failed low-poly model while the Z02 court
 * render showed the same pergola, passed. A structure must fill ≥ 12% of the frame
 * or frame ≥ 20% of it (an open louvred pergola is mostly sky between its members),
 * a surface ≥ 20%, or the borrowed picture would be about something else.
 */
export function borrowPassedViews(zones: PackZone[], views: readonly PackGardenView[]): PackZone[] {
  const pool: { r: PackRender; label: string }[] = [
    ...zones.filter((z) => isPassedRender(z.day)).map((z) => ({ r: z.day!, label: `the ${z.ref} view` })),
    ...views.filter((v) => isPassedRender(v.day)).map((v) => ({ r: v.day!, label: `the ${v.label.toLowerCase()}` })),
  ];
  return zones.map((z) => {
    if (isPassedRender(z.day)) return z;
    let best: { r: PackRender; label: string; score: number } | null = null;
    for (const c of pool) {
      const s = c.r.shows ?? [];
      const st = s.find((x) => x.key === `structure:${z.room.id}`);
      const framed = st?.box ? ((st.box[2] - st.box[0]) * (st.box[3] - st.box[1])) / 10000 : 0;
      const structure = Math.max(st?.share ?? 0, framed >= 0.2 ? Math.max(0.12, st?.share ?? 0) : 0);
      const surface = s.find((x) => x.key === `zone:${z.room.id}`)?.share ?? 0;
      const score = structure >= 0.12 ? 1 + structure : surface >= 0.2 ? surface : 0;
      if (score > 0 && (!best || score > best.score)) best = { ...c, score };
    }
    return best ? { ...z, day: { ...best.r, borrowed_from: best.label } } : z;
  });
}

/** A whole-garden camera view for the pack. */
export interface PackGardenView {
  id: string;
  label: string;
  lit: boolean;
  day: PackRender | null;
  evening: PackRender | null;
}

export interface PackZone {
  ref: string;
  room: Room;
  typeLabel: string;
  surface: string;
  lights: ZoneLight[];
  /** Does this zone get an evening view (lighting on the plan, or a structure)? */
  eveningExpected: boolean;
  day: PackRender | null;
  evening: PackRender | null;
  features: string[];
}

export interface ImageSlot {
  /** Render id — the server resolves it to bytes. */
  renderId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PackPage {
  kind: "cover" | "plan_overview" | "garden_view" | "zone" | "materials" | "photo_pair" | "assumptions";
  title: string;
  svg: string;
  images: ImageSlot[];
}

export interface RenderPackInput {
  graph: PlanGraph;
  fixtures: readonly GardenFixture[];
  /** roomId → current day render / its evening view. */
  renders: Record<string, { day: PackRender | null; evening: PackRender | null }>;
  /** plan_elements id → counter variant (bar | bbq | null). */
  elementVariants?: Record<string, string | null>;
  style: Style | GardenStyle | null;
  projectName: string;
  community: string;
  dateISO: string;
  /** The site plan sheet SVG (L-100) — the pack's plan overview IS the drawing. */
  sitePlanSvg: string | null;
  /** Renders that exist but whose image could not be fetched for this build. */
  unavailableRenderIds?: ReadonlySet<string>;
  /** G4b: whole-garden camera views, shown after the plan overview. */
  gardenViews?: PackGardenView[];
  /** G5: the draft statement — printed on the cover and in every page header. */
  draft?: string | null;
  /** G5: where it came from (the derived-dimension source note). */
  draftNote?: string | null;
  /** G5: before/after pairs — a client photo and its gated photo restyle. */
  photoPairs?: PackPhotoPair[];
  /** G5: the design's defaulted decisions and layout assumptions — a page when present. */
  assumptions?: { decisions: DecisionRow[]; layout: string[] } | null;
}

/**
 * G5: a client photo of a zone and the photo restyle made from it. The "after"
 * passed its own faithfulness check (lib/scene-render/photo-pair.ts) or it is
 * not here: a pair whose restyle failed is left out of the pack, and the gate
 * table says so.
 */
export interface PackPhotoPair {
  id: string;
  zoneName: string;
  /** Image-slot id for the client photo (resolved to bytes by the server). */
  beforeId: string;
  after: PackRender;
  caption: string;
}

// --- Model ------------------------------------------------------------------------

function inside(pt: [number, number], poly: readonly [number, number][]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

const UNIT_LABEL: Record<string, string> = {
  planter_box: "Planter box",
  wall_feature: "Wall feature",
  bbq_grill: "BBQ grill (client-supplied)",
  tree: "Tree",
};

const VARIANT_LABEL: Record<string, string> = { bar: "bar counter", bbq: "BBQ counter" };

function runLabel(kind: string, variant: string | null | undefined): string {
  const meta = LINEAR_ELEMENT_META[kind as keyof typeof LINEAR_ELEMENT_META];
  if (kind === "counter_run") {
    return variant ? `Counter run — ${VARIANT_LABEL[variant] ?? variant}` : "Counter run — type not yet selected";
  }
  return meta?.label ?? kind;
}

export function buildPackZones(input: RenderPackInput): PackZone[] {
  const { graph } = input;
  const zones = gardenZones(graph);
  const lights = lightingByZone(
    graph.rooms.map((r) => ({
      id: r.id,
      name_en: r.name_en,
      room_type: r.type,
      // lightingByZone works in normalised space, like the fixtures.
      polygon: r.polygon.map(([x, y]) => [
        x / (graph.meta.unit_to_m || 1) + graph.meta.norm_origin[0],
        y / (graph.meta.unit_to_m || 1) + graph.meta.norm_origin[1],
      ]),
    })),
    input.fixtures,
  );

  return zones.map((room, i) => {
    const zoneLights = lights.get(room.id) ?? [];
    const features: string[] = [];
    for (const el of graph.elements) {
      // An existing run the design removes or replaces elsewhere is not a feature of the design.
      if (el.kind === "boundary_wall" || !isInDesign(el)) continue;
      const a = el.polyline[0]!;
      const b = el.polyline[el.polyline.length - 1]!;
      const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (inside(mid, room.polygon)) {
        features.push(`${runLabel(el.kind, input.elementVariants?.[el.id])} · ${el.length_m.toFixed(2)} m`);
      }
    }
    for (const f of input.fixtures) {
      if (f.layer !== "landscape") continue;
      if (inside(toMetres(graph, f.position) as [number, number], room.polygon)) {
        features.push(UNIT_LABEL[f.type] ?? f.type);
      }
    }
    const r = input.renders[room.id] ?? { day: null, evening: null };
    return {
      ref: `Z${String(i + 1).padStart(2, "0")}`,
      room,
      typeLabel: roomTypeLabel(room.type),
      surface: zoneSurface(room.type),
      lights: zoneLights,
      eveningExpected: wantsEvening({ id: room.id, name_en: room.name_en, room_type: room.type, polygon: [] }, zoneLights),
      day: r.day,
      evening: r.evening,
      features,
    };
  });
}

// --- SVG helpers ----------------------------------------------------------------

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();

/**
 * G5d (session comment 7 — client legibility): every body, caption and label size
 * under 4 mm is set 25% larger, never below 3.1 mm (≈ 9 pt on A3). Headings are
 * already legible and keep their size. Applied here and in paragraph(), whose
 * wrap width and leading scale with it, so layouts reflow rather than overprint.
 */
export function legible(size: number): number {
  return size >= 4 ? size : Math.round(Math.max(3.1, size * 1.25) * 100) / 100;
}

function text(
  x: number,
  y: number,
  s: string,
  o: { size?: number; fill?: string; font?: string; anchor?: "start" | "middle" | "end"; weight?: number; spacing?: string } = {},
): string {
  return `<text x="${f1(x)}" y="${f1(y)}" font-size="${legible(o.size ?? 3.2)}" fill="${o.fill ?? INK_700}"${o.anchor ? ` text-anchor="${o.anchor}"` : ""} style="font-family:${o.font ?? FONT_UI}${o.weight ? `;font-weight:${o.weight}` : ""}${o.spacing ? `;letter-spacing:${o.spacing}` : ""}">${esc(s)}</text>`;
}

/** Greedy word wrap by an average glyph width — deterministic, no font metrics. */
export function wrap(s: string, maxChars: number): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > maxChars) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function paragraph(x: number, y: number, s: string, maxChars: number, lineH: number, o: Parameters<typeof text>[3] = {}) {
  const size = o.size ?? 3.2;
  const k = legible(size) / size;
  const lines = wrap(s, Math.floor(maxChars / k));
  return { svg: lines.map((l, i) => text(x, y + i * lineH * k, l, o)).join(""), height: lines.length * lineH * k };
}

function page(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}mm" height="${PAGE_H}mm" viewBox="0 0 ${PAGE_W} ${PAGE_H}"><rect width="${PAGE_W}" height="${PAGE_H}" fill="#F7F3EC"/>${body}</svg>`;
}

function chrome(input: RenderPackInput, title: string, n: number, total: number): string {
  return (
    text(M, 14, "RennovAIte", { size: 5, fill: BRASS, font: FONT_DISPLAY }) +
    text(PAGE_W - M, 14, `${input.projectName} · Garden render pack${input.draft ? " · DRAFT FOR REVIEW" : ""}`, { size: 3, fill: input.draft ? TERRACOTTA : INK_500, anchor: "end" }) +
    `<line x1="${M}" y1="18" x2="${PAGE_W - M}" y2="18" stroke="${BONE}" stroke-width="0.4"/>` +
    `<line x1="${M}" y1="${PAGE_H - 14}" x2="${PAGE_W - M}" y2="${PAGE_H - 14}" stroke="${BONE}" stroke-width="0.4"/>` +
    text(M, PAGE_H - 8, `${title} — concept visualisation, not a construction document. Dimensions are on the drawing set.`, {
      size: 2.6,
      fill: INK_500,
    }) +
    text(PAGE_W - M, PAGE_H - 8, `${n} / ${total}`, { size: 2.8, fill: INK_500, font: FONT_MONO, anchor: "end" })
  );
}

/** A framed photo slot (matte-image: bone mat around the picture). The inner
 *  ground is bone too, so a render whose aspect differs from the slot reads as
 *  a wider mat rather than a white letterbox. */
function frame(x: number, y: number, w: number, h: number): string {
  return `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" rx="2" fill="${BONE}"/>`;
}

/** Renders come back landscape at about 3:2; slots are cut to match. */
const PHOTO_ASPECT = 1.5;

function placeholder(x: number, y: number, w: number, h: number, line1: string, line2: string): string {
  return (
    frame(x, y, w, h) +
    `<rect x="${f1(x + 3)}" y="${f1(y + 3)}" width="${f1(w - 6)}" height="${f1(h - 6)}" fill="${PAPER}"/>` +
    text(x + w / 2, y + h / 2 - 2, line1, { size: 5, fill: INK_500, font: FONT_DISPLAY, anchor: "middle" }) +
    text(x + w / 2, y + h / 2 + 5, line2, { size: 2.8, fill: INK_500, anchor: "middle" })
  );
}

const areaText = (r: Room) => `${r.area_m2.toFixed(2)} m²${r.area_derived_m2 ? " *" : ""}`;

/**
 * G5d: the ONE neutral line a client reads under a view that is not a styled
 * render yet. The gate's findings ("No render passed the checks, so …") are QA
 * detail for the run report, never for the client.
 */
export const PENDING_DAY = "Visualisation pending — layout as drawn, see L-100";
export const PENDING_EVENING = "Visualisation pending — lighting as designed, see L-401";

/** What an image IS, printed under it: a gated render, or the design view shipped instead. Returns its height. */
function caption(x: number, y: number, view: string, r: PackRender): { svg: string; height: number } {
  const line = legible(2.6) + 1.6;
  if (r.kind === "render") {
    const head = r.borrowed_from
      ? `${view.toUpperCase()} — RENDER FROM ${r.borrowed_from.toUpperCase()} · FAITHFULNESS CHECK PASSED`
      : `${view.toUpperCase()} — RENDER · FAITHFULNESS CHECK PASSED${r.design ? " · INSET: 3D DESIGN VIEW" : ""}`;
    return { svg: text(x, y, head, { size: 2.6, fill: INK_500, spacing: "0.04em" }), height: line };
  }
  return {
    svg:
      text(x, y, `${view.toUpperCase()} — 3D DESIGN VIEW`, { size: 2.6, fill: INK_500, spacing: "0.04em" }) +
      text(x, y + line, view.toLowerCase() === "evening" ? PENDING_EVENING : PENDING_DAY, { size: 2.6, fill: INK_700 }),
    height: line * 2,
  };
}

/** Word-wrapped caption lines, capped, the last one ending in an ellipsis when text was dropped. */
export function captionLines(s: string, maxChars: number, maxLines: number): string[] {
  const lines = wrap(s, maxChars);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1]!;
  const words = last.split(" ");
  while (words.length > 1 && words.join(" ").length + 2 > maxChars) words.pop();
  kept[maxLines - 1] = `${words.join(" ").replace(/[,;:—-]+$/, "")} …`;
  return kept;
}

// --- Pages -------------------------------------------------------------------------

function coverPage(input: RenderPackInput, zones: PackZone[], total: number): PackPage {
  const rendered = zones.filter((z) => z.day).length;
  const heroView = (input.gardenViews ?? []).find((v) => v.day?.kind === "render") ?? null;
  const passedZone = [...zones].filter((z) => z.day?.kind === "render").sort((a, b) => b.room.area_m2 - a.room.area_m2)[0] ?? null;
  const anyZone = [...zones].filter((z) => z.day).sort((a, b) => b.room.area_m2 - a.room.area_m2)[0] ?? null;
  // G5: the client's own photo, redesigned and passed by the pair gate, leads the
  // cover — it is the garden they know; a styled scene render can pass its gate and
  // still read as somebody else's garden. Then a passed render, then a design view.
  const pair = (input.photoPairs ?? [])[0] ?? null;
  const hero = pair
    ? { ref: "", room: { name_en: pair.zoneName } as Room, day: pair.after }
    : heroView
      ? { ref: "", room: { name_en: heroView.label } as Room, day: heroView.day }
      : passedZone ?? anyZone;
  const images: ImageSlot[] = [];
  const hx = 176;
  const hw = PAGE_W - M - hx;
  const hh = Math.round((hw - 6) / PHOTO_ASPECT + 6);
  const hy = Math.max(34, (PAGE_H - hh) / 2 - 6);
  let body = chrome(input, "Cover", 1, total);

  body += text(M, 58, "Garden render pack", { size: 5, fill: INK_500, spacing: "0.06em" });
  const titleLines = wrap(input.projectName, 22);
  titleLines.forEach((l, i) => {
    body += text(M, 80 + i * 15, l, { size: 14, fill: INK_900, font: FONT_DISPLAY });
  });
  let y = 80 + titleLines.length * 15;
  body += text(M, y, input.community, { size: 4, fill: INK_700 });
  y += 18;
  if (input.draft) {
    // G5: the draft statement, verbatim, on the cover.
    const [head, ...rest] = input.draft.split(" — ");
    const r = paragraph(M + 4, y + 8.5, rest.join(" — "), 58, 4, { size: 3, fill: TERRACOTTA });
    const noteY = y + 8.5 + r.height + 2;
    const note = input.draftNote ? paragraph(M + 4, noteY, `Source: ${input.draftNote}`, 62, 3.6, { size: 2.6, fill: INK_700 }) : null;
    const bottom = (note ? noteY + note.height : y + 8.5 + r.height) + 2;
    const h = bottom - (y - 6);
    body += `<rect x="${M}" y="${f1(y - 6)}" width="${hx - M - 8}" height="${f1(h)}" fill="#FDF3EE" stroke="${TERRACOTTA}" stroke-width="0.6" data-draft-cover="true" data-draft-statement="${esc(input.draft)}"/>`;
    body += text(M + 4, y + 2, head ?? input.draft, { size: 5.2, fill: TERRACOTTA, weight: 700, spacing: "0.04em" });
    body += r.svg;
    if (note) body += note.svg;
    y = bottom + 8;
  }

  if (input.style) {
    body += text(M, y, "DIRECTION", { size: 2.8, fill: INK_500, spacing: "0.08em" });
    body += text(M, y + 10, input.style.name_en, { size: 9, fill: INK_900, font: FONT_DISPLAY });
    const p = paragraph(M, y + 18, input.style.one_line, 52, 5, { size: 3.4, fill: INK_700 });
    body += p.svg;
    const sy = y + 20 + p.height;
    input.style.palette.forEach((hex, i) => {
      body += `<rect x="${M + i * 16}" y="${f1(sy)}" width="13" height="13" rx="1.5" fill="${esc(hex)}" stroke="${INK_100}" stroke-width="0.3"/>`;
      body += text(M + i * 16, sy + 17, hex.toUpperCase(), { size: 2.2, fill: INK_500, font: FONT_MONO });
    });
    y = sy + 30;
  }

  body += text(M, y, "CONTENTS", { size: 2.8, fill: INK_500, spacing: "0.08em" });
  const mix = packMix(input);
  body += text(M, y + 8, `Plan overview · ${mix.photo_pairs} before/after · ${zones.length} zones · materials & finishes`, { size: 3.4, fill: INK_700 });
  body += text(M, y + 22, `${mix.design_views_by_choice + mix.design_views_after_gate} 3D design views · ${mix.styled_renders} styled renders (faithfulness check passed)`, { size: 3, fill: INK_700, font: FONT_MONO });
  body += text(M, y + 15, `${rendered} of ${zones.length} zones rendered · dated ${input.dateISO}`, {
    size: 3.4,
    fill: rendered < zones.length ? TERRACOTTA : INK_700,
    font: FONT_MONO,
  });

  if (hero?.day && input.unavailableRenderIds?.has(hero.day.id)) {
    body += placeholder(hx, hy, hw, hh, "Image unavailable", "The render could not be fetched when this pack was built; rebuild the pack.");
  } else if (hero?.day) {
    body += frame(hx, hy, hw, hh);
    images.push({ renderId: assertPackable(hero.day).id, x: hx + 3, y: hy + 3, w: hw - 6, h: hh - 6 });
    body += text(hx, hy + hh + 7, `${hero.ref ? `${hero.ref} · ` : ""}${hero.room.name_en}`, { size: 3, fill: INK_500 });
    body +=
      hero.day!.kind === "photo_edit"
        ? text(hx, hy + hh + 13, "AFTER — PHOTO RESTYLE · FAITHFULNESS CHECK PASSED", { size: 2.6, fill: INK_500, spacing: "0.06em" })
        : caption(hx, hy + hh + 13, "Day", hero.day!).svg;
  } else {
    body += placeholder(hx, hy, hw, hh, "No renders yet", "Generate the zone views from the render step, then rebuild the pack.");
  }
  return { kind: "cover", title: "Cover", svg: page(body), images };
}

function planOverviewPage(input: RenderPackInput, total: number): PackPage {
  let body = chrome(input, "Plan overview", 2, total);
  body += text(M, 30, "Plan overview", { size: 9, fill: INK_900, font: FONT_DISPLAY });
  if (input.sitePlanSvg) {
    // The drawing set's own site plan, nested at 85% — the same sheet, the same
    // dimensions, so the pack cannot show a garden the drawings do not.
    const s = 0.85;
    const w = PAGE_W * s;
    const h = PAGE_H * s;
    const x = (PAGE_W - w) / 2;
    const y = 36;
    const inner = input.sitePlanSvg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
    body += `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" fill="${PAPER}" stroke="${INK_100}" stroke-width="0.3"/>`;
    body += `<g transform="translate(${f1(x)} ${f1(y)}) scale(${s})">${inner}</g>`;
  } else {
    body += text(M, 50, "No outdoor zones on the plan.", { size: 4, fill: INK_500 });
  }
  return { kind: "plan_overview", title: "Plan overview", svg: page(body), images: [] };
}

function gardenViewPage(input: RenderPackInput, v: PackGardenView, n: number, total: number): PackPage {
  const images: ImageSlot[] = [];
  let body = chrome(input, v.label, n, total);
  body += text(M, 31, v.label, { size: 10, fill: INK_900, font: FONT_DISPLAY });
  const top = 40;
  const gap = 8;
  const colW = (PAGE_W - 2 * M - gap) / 2;
  // G5d: an evening that did not pass is DROPPED from the client pack — the day
  // view stands alone with the lighting referred to the plan, never a near-black
  // design model. The failure stays in the run report.
  const twoUp = v.lit && isPassedRender(v.evening);
  const photoH = twoUp ? Math.round((colW - 6) / PHOTO_ASPECT + 6) : 200;
  const boxes = twoUp
    ? [{ x: M, w: colW, view: "Day", r: v.day }, { x: M + colW + gap, w: colW, view: "Evening", r: v.evening }]
    : [{ x: (PAGE_W - (photoH - 6) * PHOTO_ASPECT - 6) / 2, w: (photoH - 6) * PHOTO_ASPECT + 6, view: "Day", r: v.day }];
  for (const b of boxes) {
    if (b.r && input.unavailableRenderIds?.has(b.r.id)) {
      body += placeholder(b.x, top, b.w, photoH, "Image unavailable", "The render could not be fetched when this pack was built; rebuild the pack.");
    } else if (b.r) {
      body += frame(b.x, top, b.w, photoH);
      images.push({ renderId: assertPackable(b.r).id, x: b.x + 3, y: top + 3, w: b.w - 6, h: photoH - 6 });
      images.push(...designInset(b.r, b.x, top, b.w, photoH));
      const c = caption(b.x, top + photoH + 6, b.view, b.r);
      body += c.svg;
      if (v.lit && !twoUp) body += text(b.x, top + photoH + 6 + c.height + 1, "Evening — lighting as designed, see L-401", { size: 2.6, fill: INK_700 });
    } else {
      body += placeholder(b.x, top, b.w, photoH, "Not yet rendered", "Generate the whole-garden views from the render step.");
    }
  }
  return { kind: "garden_view", title: v.label, svg: page(body), images };
}

/** G5: the 3D design view a passed render was checked against, as a corner inset. */
function designInset(r: PackRender, x: number, y: number, w: number, h: number): ImageSlot[] {
  // A borrowed view's inset is another camera's model — it would explain nothing here.
  if (r.kind !== "render" || !r.design || r.borrowed_from) return [];
  const iw = (w - 6) * 0.3;
  const ih = iw / PHOTO_ASPECT;
  return [{ renderId: r.design.id, x: x + w - 3 - iw - 2, y: y + h - 3 - ih - 2, w: iw, h: ih }];
}

function zonePage(input: RenderPackInput, z: PackZone, n: number, total: number): PackPage {
  const images: ImageSlot[] = [];
  let body = chrome(input, `${z.ref} ${z.room.name_en}`, n, total);
  body += text(M, 31, z.ref, { size: 5, fill: BRASS, font: FONT_MONO });
  body += text(M + 18, 31, z.room.name_en, { size: 10, fill: INK_900, font: FONT_DISPLAY });
  body += text(PAGE_W - M, 31, `${z.typeLabel} · ${areaText(z.room)}`, { size: 4, fill: INK_700, font: FONT_MONO, anchor: "end" });

  const top = 40;
  const gap = 8;
  const colW = (PAGE_W - 2 * M - gap) / 2;
  // Two-up: each slot is a 3:2 photo plus its mat. One-up: a larger 3:2 slot.
  // G5d: only a PASSED evening earns the second slot; a failed one is dropped and
  // the day view says where the lighting is (L-401).
  const twoUp = z.eveningExpected && isPassedRender(z.evening);
  const photoH = twoUp ? Math.round((colW - 6) / PHOTO_ASPECT + 6) : 164;
  const boxes = twoUp
    ? [
        { x: M, w: colW, view: "Day", r: z.day },
        { x: M + colW + gap, w: colW, view: "Evening", r: z.evening },
      ]
    : [{ x: M, w: PAGE_W - 2 * M, view: "Day", r: z.day }];

  let captionH = 0;
  for (const b of boxes) {
    // A single day view keeps a photographic aspect instead of a letterbox.
    const w = twoUp ? b.w : Math.min(b.w, (photoH - 6) * PHOTO_ASPECT + 6);
    const x = twoUp ? b.x : (PAGE_W - w) / 2;
    if (b.r && input.unavailableRenderIds?.has(b.r.id)) {
      body += placeholder(x, top, w, photoH, "Image unavailable", "The render could not be fetched when this pack was built; rebuild the pack.");
    } else if (b.r) {
      body += frame(x, top, w, photoH);
      images.push({ renderId: assertPackable(b.r).id, x: x + 3, y: top + 3, w: w - 6, h: photoH - 6 });
      images.push(...designInset(b.r, x, top, w, photoH));
    } else {
      body += placeholder(x, top, w, photoH, "Not yet rendered", "Generate this zone's view from the render step.");
    }
    const c = b.r ? caption(x, top + photoH + 6, b.view, b.r) : { svg: text(x, top + photoH + 6, b.view.toUpperCase(), { size: 2.8, fill: INK_500, spacing: "0.08em" }), height: 4 };
    body += c.svg;
    let h = c.height;
    if (z.eveningExpected && !twoUp) {
      body += text(x, top + photoH + 6 + h + 1, "Evening — lighting as designed, see L-401", { size: 2.6, fill: INK_700 });
      h += legible(2.6) + 2;
    }
    captionH = Math.max(captionH, h);
  }

  // Facts band — below the tallest caption, so a caption never runs into a column head.
  const fy = top + photoH + 6 + captionH + 8;
  const col = (i: number) => M + i * ((PAGE_W - 2 * M) / 3);
  body += text(col(0), fy, "SURFACE", { size: 2.6, fill: INK_500, spacing: "0.08em" });
  body += text(col(0), fy + 7, z.surface, { size: 3.4, fill: INK_900 });
  body += text(col(0), fy + 14, `Area ${areaText(z.room)}`, { size: 3.2, fill: INK_700, font: FONT_MONO });
  if (z.room.area_derived_m2 && z.room.derived_note) {
    body += paragraph(col(0), fy + 21, `* Derived area: ${z.room.derived_note}`, 62, 3.6, {
      size: 2.5,
      fill: TERRACOTTA,
    }).svg;
  }

  body += text(col(1), fy, "BUILT FEATURES", { size: 2.6, fill: INK_500, spacing: "0.08em" });
  (z.features.length ? z.features : ["None drawn in this zone"]).slice(0, 5).forEach((f, i) => {
    body += text(col(1), fy + 7 + i * 6, f, { size: 3.2, fill: z.features.length ? INK_900 : INK_500 });
  });

  body += text(col(2), fy, "LIGHTING — AS DESIGNED", { size: 2.6, fill: INK_500, spacing: "0.08em" });
  if (z.lights.length === 0) {
    body += text(col(2), fy + 7, z.room.type === "structure" ? "Integral downlights (part of the structure)" : "No lighting on the plan", {
      size: 3.2,
      fill: INK_500,
    });
  } else {
    z.lights.forEach((l, i) => {
      body += text(col(2), fy + 7 + i * 6, `${l.count} × ${l.label}`, { size: 3.2, fill: INK_900 });
    });
  }
  return { kind: "zone", title: `${z.ref} ${z.room.name_en}`, svg: page(body), images };
}

function materialsPage(input: RenderPackInput, zones: PackZone[], n: number, total: number): PackPage {
  let body = chrome(input, "Materials & finishes", n, total);
  body += text(M, 31, "Materials & finishes", { size: 10, fill: INK_900, font: FONT_DISPLAY });

  // Zone schedule (left).
  const tx = M;
  let y = 46;
  const cols = [tx, tx + 14, tx + 70, tx + 110, tx + 190];
  const head = ["REF", "ZONE", "TYPE", "FINISH", "AREA m²"];
  head.forEach((h, i) =>
    (body += text(i === 4 ? cols[4]! + 18 : cols[i]!, y, h, { size: 2.6, fill: INK_500, spacing: "0.08em", anchor: i === 4 ? "end" : "start" })),
  );
  body += `<line x1="${tx}" y1="${y + 2}" x2="${cols[4]! + 18}" y2="${y + 2}" stroke="${INK_100}" stroke-width="0.3"/>`;
  y += 8;
  for (const z of zones) {
    body += text(cols[0]!, y, z.ref, { size: 3, fill: BRASS, font: FONT_MONO });
    body += text(cols[1]!, y, z.room.name_en, { size: 3, fill: INK_900 });
    body += text(cols[2]!, y, z.typeLabel, { size: 3, fill: INK_700 });
    body += text(cols[3]!, y, z.surface, { size: 3, fill: INK_700 });
    body += text(cols[4]! + 18, y, `${z.room.dims_derived ? "≈ " : ""}${z.room.area_m2.toFixed(2)}${z.room.area_derived_m2 ? "*" : ""}`, {
      size: 3,
      fill: INK_900,
      font: FONT_MONO,
      anchor: "end",
    });
    y += 6;
  }
  const totalArea = zones.reduce((s, z) => s + z.room.area_m2, 0);
  body += `<line x1="${tx}" y1="${y - 3}" x2="${cols[4]! + 18}" y2="${y - 3}" stroke="${INK_100}" stroke-width="0.3"/>`;
  body += text(cols[1]!, y + 2, "Total drawn zones", { size: 3, fill: INK_900, weight: 600 });
  body += text(cols[4]! + 18, y + 2, totalArea.toFixed(2), { size: 3, fill: INK_900, font: FONT_MONO, anchor: "end" });
  y += 10;
  const derived = zones.filter((z) => z.room.area_derived_m2 && z.room.derived_note);
  for (const z of derived) {
    const p = paragraph(tx, y, `* ${z.ref} derived area: ${z.room.derived_note}`, 105, 4, {
      size: 2.6,
      fill: TERRACOTTA,
    });
    body += p.svg;
    y += p.height + 2;
  }

  // Built features.
  y += 6;
  body += text(tx, y, "BUILT FEATURES", { size: 2.6, fill: INK_500, spacing: "0.08em" });
  y += 7;
  for (const el of input.graph.elements.filter((e) => e.kind !== "boundary_wall" && isInDesign(e))) {
    body += text(tx, y, runLabel(el.kind, input.elementVariants?.[el.id]), {
      size: 3,
      fill: el.kind === "counter_run" && !input.elementVariants?.[el.id] ? TERRACOTTA : INK_900,
    });
    body += text(cols[4]! + 18, y, `${el.length_m.toFixed(2)} m`, { size: 3, fill: INK_900, font: FONT_MONO, anchor: "end" });
    y += 5.5;
  }
  const units = input.fixtures.filter((f) => f.layer === "landscape");
  const unitCounts = new Map<string, number>();
  for (const u of units) unitCounts.set(u.type, (unitCounts.get(u.type) ?? 0) + 1);
  for (const [type, count] of unitCounts) {
    body += text(tx, y, UNIT_LABEL[type] ?? type, { size: 3, fill: INK_900 });
    body += text(cols[4]! + 18, y, `${count} no.`, { size: 3, fill: INK_900, font: FONT_MONO, anchor: "end" });
    y += 5.5;
  }
  for (const z of zones.filter((x) => x.room.type === "structure")) {
    body += text(tx, y, `${z.room.name_en} (plan area)`, { size: 3, fill: INK_900 });
    body += text(cols[4]! + 18, y, `${z.room.area_m2.toFixed(2)} m²`, { size: 3, fill: INK_900, font: FONT_MONO, anchor: "end" });
    y += 5.5;
  }

  // Right column: direction + lighting.
  const rx = 262;
  let ry = 46;
  if (input.style) {
    body += text(rx, ry, "DIRECTION", { size: 2.6, fill: INK_500, spacing: "0.08em" });
    body += text(rx, ry + 9, input.style.name_en, { size: 7, fill: INK_900, font: FONT_DISPLAY });
    ry += 16;
    input.style.palette.forEach((hex, i) => {
      body += `<rect x="${rx + i * 14}" y="${ry}" width="11" height="11" rx="1.5" fill="${esc(hex)}" stroke="${INK_100}" stroke-width="0.3"/>`;
    });
    ry += 19;
    for (const line of input.style.what_changes) {
      const p = paragraph(rx + 4, ry, line, 58, 4.4, { size: 3, fill: INK_700 });
      body += `<circle cx="${rx + 1}" cy="${f1(ry - 1)}" r="0.7" fill="${BRASS}"/>` + p.svg;
      ry += p.height + 2;
    }
    ry += 6;
  }

  body += text(rx, ry, "LIGHTING — AS DESIGNED", { size: 2.6, fill: INK_500, spacing: "0.08em" });
  ry += 7;
  const totals = new Map<string, { label: string; count: number }>();
  for (const z of zones) {
    for (const l of z.lights) {
      const t = totals.get(l.code) ?? { label: l.label, count: 0 };
      t.count += l.count;
      totals.set(l.code, t);
    }
  }
  if (totals.size === 0) {
    body += text(rx, ry, "No lighting points on the plan.", { size: 3, fill: INK_500 });
    ry += 6;
  } else {
    for (const t of [...totals.values()].sort((a, b) => a.label.localeCompare(b.label))) {
      body += text(rx, ry, t.label, { size: 3, fill: INK_900 });
      body += text(PAGE_W - M, ry, String(t.count), { size: 3, fill: INK_900, font: FONT_MONO, anchor: "end" });
      ry += 5.5;
    }
  }
  const src = paragraph(rx, ry + 3, LIGHTING_SOURCE_STATEMENT, 66, 4, { size: 2.6, fill: TERRACOTTA });
  body += src.svg;

  return { kind: "materials", title: "Materials & finishes", svg: page(body), images: [] };
}

export function buildRenderPack(input: RenderPackInput): { pages: PackPage[]; zones: PackZone[] } {
  // G5d: a zone whose own view did not pass shows the passed view that shows it best.
  const zones = borrowPassedViews(buildPackZones(input), input.gardenViews ?? []);
  const views = input.gardenViews ?? [];
  const pairs = input.photoPairs ?? [];
  const hasAssumptions = !!input.assumptions && (input.assumptions.decisions.length > 0 || input.assumptions.layout.length > 0);
  const a = hasAssumptions ? 1 : 0;
  const total = 3 + a + views.length + pairs.length + zones.length;
  const pages: PackPage[] = [
    coverPage(input, zones, total),
    planOverviewPage(input, total),
    // G5: what the review meeting works through, right after the plan.
    ...(hasAssumptions ? [assumptionsPage(input, 3, total)] : []),
    // The backbone — the client's own garden before and after — then the
    // whole-garden design views, then the zones.
    ...pairs.map((p, i) => photoPairPage(input, p, 3 + a + i, total)),
    ...views.map((v, i) => gardenViewPage(input, v, 3 + a + pairs.length + i, total)),
    ...zones.map((z, i) => zonePage(input, z, 3 + a + views.length + pairs.length + i, total)),
    materialsPage(input, zones, total, total),
  ];
  return { pages, zones };
}

/** G5: before (client photo) and after (gated photo restyle), side by side. */
function photoPairPage(input: RenderPackInput, pair: PackPhotoPair, n: number, total: number): PackPage {
  const after = assertPackable(pair.after);
  let body = chrome(input, `Before & after — ${pair.zoneName}`, n, total);
  body += text(M, 31, `${pair.zoneName} — before & after`, { size: 10, fill: INK_900, font: FONT_DISPLAY });
  const gap = 8;
  const w = (PAGE_W - 2 * M - gap) / 2;
  const h = Math.min(PAGE_H - 90, Math.round((w - 6) / 0.75 + 6));
  const y = 42;
  const images: ImageSlot[] = [];
  body += frame(M, y, w, h);
  images.push({ renderId: pair.beforeId, x: M + 3, y: y + 3, w: w - 6, h: h - 6 });
  body += frame(M + w + gap, y, w, h);
  images.push({ renderId: after.id, x: M + w + gap + 3, y: y + 3, w: w - 6, h: h - 6 });
  body += text(M, y + h + 7, "BEFORE — CLIENT SITE PHOTO", { size: 2.8, fill: INK_500, spacing: "0.06em" });
  body += text(M + w + gap, y + h + 7, "AFTER — PHOTO RESTYLE · FAITHFULNESS CHECK PASSED", { size: 2.8, fill: BRASS, spacing: "0.06em" });
  body += paragraph(M, y + h + 13, pair.caption, 150, 4, { size: 2.8, fill: INK_700 }).svg;
  return { kind: "photo_pair", title: `Before & after — ${pair.zoneName}`, svg: page(body), images };
}

/** Contain-fit an image of (iw, ih) into a slot, centred. */
export function containFit(iw: number, ih: number, slot: { x: number; y: number; w: number; h: number }) {
  const s = Math.min(slot.w / iw, slot.h / ih);
  const w = iw * s;
  const h = ih * s;
  return { x: slot.x + (slot.w - w) / 2, y: slot.y + (slot.h - h) / 2, w, h };
}


/**
 * G5: "Design assumptions" — every existing item and the design's defaulted call
 * on it (keep / remove / replace, and what it becomes), then the layout
 * assumptions the reference dimensions could not settle. This is the agenda of
 * the review meeting: each line is a decision the client can overturn.
 */
function assumptionsPage(input: RenderPackInput, n: number, total: number): PackPage {
  const a = input.assumptions!;
  let body = chrome(input, "Design assumptions", n, total);
  body += text(M, 31, "Design assumptions", { size: 10, fill: INK_900, font: FONT_DISPLAY });
  body += text(M, 40, "Proposed for review — each line is a decision to confirm or change before the design is final.", { size: 3.2, fill: INK_700 });
  const cols = [M, M + 120, M + 175, M + 208];
  let y = 52;
  ["EXISTING ON SITE", "TYPE", "PROPOSAL", "BECOMES / NOTE"].forEach((h, i) => (body += text(cols[i]!, y, h, { size: 2.6, fill: INK_500, spacing: "0.08em" })));
  body += `<line x1="${M}" y1="${y + 2}" x2="${PAGE_W - M}" y2="${y + 2}" stroke="${INK_100}" stroke-width="0.3"/>`;
  y += 8;
  const tone = { KEEP: INK_700, REMOVE: TERRACOTTA, REPLACE: BRASS, UNDECIDED: TERRACOTTA } as const;
  for (const d of a.decisions.slice(0, 30)) {
    body += text(cols[0]!, y, d.item.slice(0, 70), { size: 3, fill: INK_900 });
    body += text(cols[1]!, y, d.kind.slice(0, 26), { size: 2.8, fill: INK_500 });
    body += text(cols[2]!, y, d.decision, { size: 3, fill: tone[d.decision], font: FONT_MONO, weight: 700 });
    const becomes = [d.becomes, d.note].filter(Boolean).join(" — ");
    const p = paragraph(cols[3]!, y, becomes || "—", 80, 3.8, { size: 2.8, fill: INK_700 });
    body += p.svg;
    y += Math.max(5.5, p.height + 1.7);
  }
  if (a.layout.length > 0) {
    y += 6;
    body += text(M, y, "LAYOUT ASSUMPTIONS", { size: 2.6, fill: INK_500, spacing: "0.08em" });
    y += 6;
    for (const line of a.layout.slice(0, 10)) {
      const p = paragraph(M, y, `• ${line}`, 190, 4, { size: 2.9, fill: INK_700 });
      body += p.svg;
      y += p.height + 1.5;
    }
  }
  return { kind: "assumptions", title: "Design assumptions", svg: page(body), images: [] };
}
