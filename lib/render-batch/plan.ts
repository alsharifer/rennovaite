// =============================================================================
// lib/render-batch/plan.ts — what "generate all" has to do (garden pilot G4).
//
// Pure: rooms, renders and fixtures in, a job list out. No DB, no fetch. The
// batch route and the render page both read it, so the button's count and the
// queue it starts cannot disagree.
//
// A job is one VIEW of one zone:
//   day     — every renderable room or zone. Done once a render with an image
//             exists; the latest one is the zone's current day view, which is
//             what the user has been tweaking.
//   evening — exterior zones WITH LIGHTING only: a lighting point on the zone,
//             or an outdoor structure (its downlights are part of the
//             structure). An evening view of an unlit lawn would be a picture
//             of lighting nobody designed. It is an edit of the CURRENT day
//             render, so it is blocked until a day exists and goes stale the
//             moment the day is tweaked.
//
// Generation reuses the pipeline — /api/render for a day, /api/render/evening
// for an evening — so the cache, the in-flight cap and the QA gate all apply.
// =============================================================================

import { FITTING_LABEL, fittingCode } from "@/lib/drawings/garden-sheets";
import { isExteriorRoomType, roomTypeFromDb } from "@/lib/render-prompts";

export type RenderView = "day" | "evening";

export interface BatchRoom {
  id: string;
  name_en: string | null;
  room_type: string | null;
  polygon: unknown;
}

export interface BatchRender {
  id: string;
  room_id: string | null;
  status: string | null;
  image_url: string | null;
  parent_render_id: string | null;
  view?: string | null;
  created_at: string | null;
}

export interface BatchFixture {
  type: string;
  room_id: string | null;
  position: unknown;
  spec?: Record<string, unknown> | null;
}

export type JobStatus = "done" | "in_flight" | "queued" | "blocked";

export interface BatchJob {
  room_id: string;
  room_name: string;
  view: RenderView;
  status: JobStatus;
  /** Why a job is blocked or re-queued; null when there is nothing to say. */
  reason: string | null;
  /** Evening jobs: the day render the evening view edits. */
  parent_render_id: string | null;
  render_id: string | null;
  /** G4b: set for plan-faithful scene jobs, which run through /api/render/scene. */
  camera_id?: string;
  /** G4b: a done scene job's gate outcome — "substituted" ships the 3D design view. */
  outcome?: SceneOutcome | null;
  /** G5: a 3D design view shipped by choice — no clean camera, no render attempted. */
  by_choice?: boolean;
}

export type SceneOutcome = "passed" | "substituted";

export interface ZoneLight {
  code: string;
  label: string;
  count: number;
}

export const LIGHT_TYPES = new Set(["garden_light", "boundary_light"]);

/** How long a pending row counts as in flight — mirrors IN_FLIGHT_WINDOW_MS. */
export const PENDING_WINDOW_MS = 10 * 60_000;

/** A boundary light sits on the wall face, i.e. on a zone's edge, not in it. */
const EDGE_TOLERANCE = 0.05; // normalised units (~0.6 m on a 12 m plot)

const viewOf = (r: BatchRender): RenderView => (r.view === "evening" ? "evening" : "day");

function asPolygon(p: unknown): [number, number][] {
  if (!Array.isArray(p)) return [];
  return p.filter(
    (v): v is [number, number] =>
      Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "number",
  );
}

function asPoint(p: unknown): [number, number] | null {
  return Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number"
    ? [p[0], p[1]]
    : null;
}

function inside(pt: [number, number], poly: [number, number][]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function edgeDistance(pt: [number, number], poly: [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / len2));
    best = Math.min(best, Math.hypot(pt[0] - (a[0] + t * dx), pt[1] - (a[1] + t * dy)));
  }
  return best;
}

/**
 * The lighting that belongs to each zone. A point's room_id wins; an unassigned
 * point goes to the zone it sits in, else to the nearest zone whose edge it is
 * on (a boundary light on the wall face). A point near no zone lights nothing.
 */
export function lightingByZone(
  rooms: readonly BatchRoom[],
  fixtures: readonly BatchFixture[],
): Map<string, ZoneLight[]> {
  const counts = new Map<string, Map<string, number>>();
  const bump = (roomId: string, code: string) => {
    const m = counts.get(roomId) ?? new Map<string, number>();
    m.set(code, (m.get(code) ?? 0) + 1);
    counts.set(roomId, m);
  };
  const polys = rooms.map((r) => ({ id: r.id, poly: asPolygon(r.polygon) }));

  for (const f of fixtures) {
    if (!LIGHT_TYPES.has(f.type)) continue;
    const code = fittingCode(f.spec ?? null, f.type);
    if (f.room_id && polys.some((p) => p.id === f.room_id)) {
      bump(f.room_id, code);
      continue;
    }
    const pt = asPoint(f.position);
    if (!pt) continue;
    const container = polys.find((p) => p.poly.length >= 3 && inside(pt, p.poly));
    if (container) {
      bump(container.id, code);
      continue;
    }
    let nearest: { id: string; d: number } | null = null;
    for (const p of polys) {
      if (p.poly.length < 2) continue;
      const d = edgeDistance(pt, p.poly);
      if (d <= EDGE_TOLERANCE && (!nearest || d < nearest.d)) nearest = { id: p.id, d };
    }
    if (nearest) bump(nearest.id, code);
  }

  const out = new Map<string, ZoneLight[]>();
  for (const [roomId, m] of counts) {
    out.set(
      roomId,
      [...m.entries()]
        .map(([code, count]) => ({ code, label: FITTING_LABEL[code] ?? code, count }))
        .sort((a, b) => a.code.localeCompare(b.code)),
    );
  }
  return out;
}

/** The zone's current day render: the latest one with an image. */
export function currentDayRender(
  renders: readonly BatchRender[],
  roomId: string,
): BatchRender | null {
  return (
    [...renders]
      .filter((r) => r.room_id === roomId && viewOf(r) === "day" && r.status === "succeeded" && !!r.image_url)
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0] ?? null
  );
}

function inFlight(renders: readonly BatchRender[], roomId: string, view: RenderView, now: number) {
  return renders.find(
    (r) =>
      r.room_id === roomId &&
      viewOf(r) === view &&
      r.status === "pending" &&
      now - Date.parse(r.created_at ?? "") < PENDING_WINDOW_MS,
  );
}

/** Does this zone get an evening view? */
export function wantsEvening(room: BatchRoom, lights: readonly ZoneLight[] | undefined): boolean {
  const t = roomTypeFromDb(room.room_type);
  if (!isExteriorRoomType(t)) return false;
  return t === "outdoor-structure" || (lights?.reduce((s, l) => s + l.count, 0) ?? 0) > 0;
}

export function planBatch(input: {
  rooms: readonly BatchRoom[];
  renders: readonly BatchRender[];
  fixtures: readonly BatchFixture[];
  now?: number;
}): BatchJob[] {
  const now = input.now ?? Date.now();
  const lighting = lightingByZone(input.rooms, input.fixtures);
  const jobs: BatchJob[] = [];

  for (const room of input.rooms) {
    if (!roomTypeFromDb(room.room_type)) continue; // nothing to photograph
    const name = room.name_en ?? "Untitled";
    const day = currentDayRender(input.renders, room.id);
    const dayPending = inFlight(input.renders, room.id, "day", now);

    jobs.push({
      room_id: room.id,
      room_name: name,
      view: "day",
      status: day ? "done" : dayPending ? "in_flight" : "queued",
      reason: null,
      parent_render_id: null,
      render_id: day?.id ?? dayPending?.id ?? null,
    });

    if (!wantsEvening(room, lighting.get(room.id))) continue;

    if (!day) {
      jobs.push({
        room_id: room.id,
        room_name: name,
        view: "evening",
        status: "blocked",
        reason: "waits for the day view",
        parent_render_id: null,
        render_id: null,
      });
      continue;
    }

    const evenings = input.renders
      .filter((r) => r.room_id === room.id && viewOf(r) === "evening")
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
    const current = evenings.find(
      (r) => r.parent_render_id === day.id && r.status === "succeeded" && !!r.image_url,
    );
    const pending = evenings.find(
      (r) =>
        r.parent_render_id === day.id &&
        r.status === "pending" &&
        now - Date.parse(r.created_at ?? "") < PENDING_WINDOW_MS,
    );
    const stale = !current && evenings.some((r) => r.status === "succeeded" && r.parent_render_id !== day.id);

    jobs.push({
      room_id: room.id,
      room_name: name,
      view: "evening",
      status: current ? "done" : pending ? "in_flight" : "queued",
      reason: stale ? "day view changed since the last evening view" : null,
      parent_render_id: day.id,
      render_id: current?.id ?? pending?.id ?? null,
    });
  }
  return jobs;
}

/** A camera as the batch sees it (G4b). */
export interface BatchCamera {
  id: string;
  label: string;
  zone_id: string | null;
  lit: boolean;
}

export interface SceneRenderRow {
  id: string;
  camera: string | null;
  view?: string | null;
  status: string | null;
  gate?: { outcome?: string; design_view_reason?: string | null } | null;
}

const outcomeOf = (r: SceneRenderRow | undefined): SceneOutcome | null =>
  r?.gate?.outcome === "passed" || r?.gate?.outcome === "substituted" ? r.gate.outcome : null;

/**
 * G4b: the batch for a garden — one day view per camera (every zone plus the
 * whole-garden views) and an evening view per lit camera. An evening waits for
 * its day: it relights a render that passed, or ships the 3D night view.
 */
export function planSceneBatch(cameras: readonly BatchCamera[], renders: readonly SceneRenderRow[]): BatchJob[] {
  const done = (id: string, view: RenderView) =>
    renders.find((r) => r.camera === id && (r.view === "evening" ? "evening" : "day") === view && r.status === "succeeded");
  const jobs: BatchJob[] = [];
  for (const c of cameras) {
    const day = done(c.id, "day");
    jobs.push({ room_id: c.zone_id ?? c.id, room_name: c.label, view: "day", status: day ? "done" : "queued", reason: null, parent_render_id: null, render_id: day?.id ?? null, camera_id: c.id, outcome: outcomeOf(day), by_choice: day?.gate?.design_view_reason === "no_clean_camera" });
    if (!c.lit) continue;
    const eve = done(c.id, "evening");
    jobs.push({
      room_id: c.zone_id ?? c.id,
      room_name: c.label,
      view: "evening",
      status: eve ? "done" : day ? "queued" : "blocked",
      reason: eve || day ? null : "waits for the day view",
      parent_render_id: day?.id ?? null,
      render_id: eve?.id ?? null,
      camera_id: c.id,
      outcome: outcomeOf(eve),
      by_choice: eve?.gate?.design_view_reason === "no_clean_camera",
    });
  }
  return jobs;
}

/**
 * The evening edit instruction. Deterministic — it is the cache key, and the
 * same zone with the same lighting must produce the same prompt. It names the
 * lighting designed for the zone and nothing else: an edit model asked for
 * "evening" on its own invents fittings.
 */
export function buildEveningPrompt(input: {
  roomType: string | null;
  lights: readonly ZoneLight[];
}): string {
  const t = roomTypeFromDb(input.roomType);
  const listed = input.lights.map((l) => `${l.count} × ${l.label.toLowerCase()}`).join(", ");
  const lighting =
    t === "outdoor-structure"
      ? `the structure's integral warm-white downlights${listed ? ` and ${listed}` : ""}`
      : listed;
  // The first version asked for "early evening" and the edit model kept a
  // daylight sky with sun shadows and simply added light pools. Relighting has
  // to be stated as removing the daylight, not as adding lamps.
  return [
    "Relight this exact photo as a night scene at late blue hour, well after sunset.",
    "Remove all daylight: the sky becomes deep indigo fading to navy with no sun, no clouds lit by sun and no blue daytime sky; remove every sunlit highlight and every cast sun shadow; the whole image is about three stops darker.",
    `The only light in the garden is its designed lighting — ${lighting} — as warm 2700 K pools and wall washes with soft falloff and no visible glare.`,
    "Keep the layout, boundary walls, paving pattern, planting, structures, materials and camera angle identical. Add no light fittings that are not listed.",
  ].join(" ");
}
