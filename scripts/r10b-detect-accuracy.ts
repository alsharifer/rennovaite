// =============================================================================
// scripts/r10b-detect-accuracy.ts — how well does the opening detector read
// real plans? (R10b report, before R10c). READ-ONLY: it reads a dump of plans +
// rooms (JSON, produced by a read-only SQL query) and each plan's public
// drawing, runs the detector IN-PROCESS and writes nothing to any database.
//
//   node --env-file=.env.local --experimental-transform-types \
//     --import ./scripts/_alias-hook.mjs scripts/r10b-detect-accuracy.ts <dump.json> <outDir>
//
// Per plan it writes <outDir>/<plan>-overlay.png (what the model saw) and
// <plan>-found.png (the drawing with every found opening drawn on its wall and
// numbered), and <outDir>/summary.json — the counts the report quotes and the
// list a person checks against the drawing by eye.
// =============================================================================

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Resvg } from "@resvg/resvg-js";

import { documentFontOptions } from "@/lib/documents/doc-fonts";
import { detectOpenings, drawingFrame, loadDrawing, renderViews, unitToMetres, type DetectRoom, type SnappedOpening } from "@/lib/plan/openings-detect";
import { deriveWallSegments } from "@/lib/plan/geometry";

type Pt = [number, number];
interface DumpPlan { id: string; project: string; deleted: boolean; pdf_url: string | null; source: string | null; total_area_m2: number | null; sheet: unknown; parse_rooms: { polygon: unknown }[] | null }
interface DumpRoom { id: string; plan_id: string; name_en: string | null; room_type: string | null; polygon: Pt[]; area_m2: number | null }
interface DumpOpening { plan_id: string; kind: string; source: string; position: Pt; width_mm: number | null }

const [dumpPath, outDir] = process.argv.slice(2);
if (!dumpPath || !outDir) throw new Error("usage: r10b-detect-accuracy.ts <dump.json> <outDir>");
mkdirSync(outDir, { recursive: true });
const raw = JSON.parse(readFileSync(dumpPath, "utf8"));
const dump = (raw.rows?.[0]?.dump ?? raw) as { plans: DumpPlan[]; rooms: DumpRoom[]; openings: DumpOpening[] | null };
const only = process.argv.slice(4);

function foundSvg(href: string, w: number, h: number, rooms: DetectRoom[], openings: SnappedOpening[], unitToM: number, frame: { toDrawing: (p: Pt) => Pt; fromDrawing: (p: Pt) => Pt }): string {
  const s = Math.max(w, h);
  const walls = new Map(deriveWallSegments(rooms.map((r) => ({ id: r.id, polygon: r.polygon, room_type: r.room_type }))).map((x) => [x.id, x]));
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#fff"/><image width="${w}" height="${h}" xlink:href="${href}" opacity="0.6"/>`];
  for (const r of rooms) parts.push(`<polygon points="${r.polygon.map(([x, y]) => `${x * w},${y * h}`).join(" ")}" fill="none" stroke="#868e96" stroke-width="${s * 0.0015}"/>`);
  const colour: Record<string, string> = { window: "#1971c2", door: "#e8590c", archway: "#2f9e44" };
  openings.forEach((o, i) => {
    const wall = walls.get(o.wall_ref);
    if (!wall) return;
    const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
    // Width in the drawing frame: a stored-frame length, mapped.
    const a0 = frame.fromDrawing([0, 0]);
    const a1 = frame.fromDrawing([1, 0]);
    const half = (o.width_mm / 1000 / unitToM / 2) / Math.hypot(a1[0] - a0[0], a1[1] - a0[1]);
    const ux = (wall.b[0] - wall.a[0]) / len;
    const uy = (wall.b[1] - wall.a[1]) / len;
    const p0 = [o.position[0] - ux * half, o.position[1] - uy * half];
    const p1 = [o.position[0] + ux * half, o.position[1] + uy * half];
    const c = colour[o.kind] ?? "#000";
    parts.push(`<line x1="${p0[0]! * w}" y1="${p0[1]! * h}" x2="${p1[0]! * w}" y2="${p1[1]! * h}" stroke="${c}" stroke-width="${s * 0.008}" stroke-linecap="butt"/>`);
    parts.push(`<text x="${o.position[0] * w + s * 0.008}" y="${o.position[1] * h - s * 0.006}" font-family="IBM Plex Sans" font-weight="600" font-size="${s * 0.016}" fill="${c}" stroke="#fff" stroke-width="${s * 0.003}" paint-order="stroke">${i + 1}</text>`);
  });
  parts.push("</svg>");
  return parts.join("");
}

const summary: unknown[] = [];
for (const plan of dump.plans) {
  if (only.length && !only.some((p) => plan.id.startsWith(p))) continue;
  const rooms: DetectRoom[] = dump.rooms
    .filter((r) => r.plan_id === plan.id && Array.isArray(r.polygon) && r.polygon.length >= 3)
    .map((r) => ({ id: r.id, name: r.name_en?.trim() || "Room", room_type: r.room_type, polygon: r.polygon, area_m2: r.area_m2 }));
  const tag = plan.id.slice(0, 8);
  if (!plan.pdf_url || rooms.length === 0) {
    summary.push({ plan: tag, project: plan.project, skipped: !plan.pdf_url ? "no drawing" : "no rooms" });
    continue;
  }
  const t0 = Date.now();
  try {
    const parsedJson = { parse: { sheet: plan.sheet }, rooms: plan.parse_rooms ?? [] };
    const frame = drawingFrame(rooms, parsedJson);
    if (!frame) {
      summary.push({ plan: tag, project: plan.project, skipped: "no frame" });
      continue;
    }
    const drawing = await loadDrawing(plan.pdf_url, parsedJson);
    if (!drawing) {
      summary.push({ plan: tag, project: plan.project, skipped: "drawing unreadable" });
      continue;
    }
    const shown = rooms.map((r) => ({ ...r, polygon: r.polygon.map(frame.toDrawing) }));
    const views = renderViews(drawing, shown);
    writeFileSync(path.join(outDir, `${tag}-overlay.png`), views.overlay);
    const result = await detectOpenings({ drawing, rooms, frame, totalAreaM2: plan.total_area_m2 });
    const unitToM = unitToMetres(rooms, plan.total_area_m2);
    const href = `data:${drawing.mime};base64,${drawing.bytes.toString("base64")}`;
    const fit = Math.min(1568, Math.max(drawing.width, drawing.height));
    const png = new Resvg(foundSvg(href, drawing.width, drawing.height, shown, result.openings.map((o) => ({ ...o, position: frame.toDrawing(o.position) })), unitToM, frame), { fitTo: drawing.width >= drawing.height ? { mode: "width", value: fit } : { mode: "height", value: fit }, font: documentFontOptions() }).render().asPng();
    writeFileSync(path.join(outDir, `${tag}-found.png`), png);
    const name = (id: string | null | undefined) => rooms.find((r) => r.id === id)?.name ?? null;
    const byKind = (k: string) => result.openings.filter((o) => o.kind === k).length;
    const recorded = (dump.openings ?? []).filter((o) => o.plan_id === plan.id);
    summary.push({
      plan: tag,
      project: plan.project,
      deleted: plan.deleted,
      frame: drawing.frame,
      mapping: frame.kind,
      skew: frame.skew,
      rooms: rooms.length,
      proposals: result.proposals.length,
      found: result.openings.length,
      windows: byKind("window"),
      doors: byKind("door"),
      openings: byKind("archway"),
      dropped: result.dropped.map((d) => d.reason),
      recorded_before: recorded.length,
      seconds: Math.round((Date.now() - t0) / 1000),
      list: result.openings.map((o, i) => ({
        n: i + 1,
        kind: o.kind,
        room: name(o.room_id),
        to: o.detection.opens_to_room_id ? name(o.detection.opens_to_room_id) : o.detection.opens_to,
        width_m: o.width_mm / 1000,
        ftc: o.detection.floor_to_ceiling ?? false,
        confidence: o.detection.confidence,
      })),
    });
    console.log(`${tag} ${plan.project}: ${result.openings.length} found (${byKind("window")} windows, ${byKind("door")} doors, ${byKind("archway")} openings), ${result.dropped.length} dropped, ${Math.round((Date.now() - t0) / 1000)} s`);
  } catch (e) {
    summary.push({ plan: tag, project: plan.project, error: e instanceof Error ? e.message : String(e) });
    console.log(`${tag} ${plan.project}: ERROR ${e instanceof Error ? e.message : e}`);
  }
}
writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
