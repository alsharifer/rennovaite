import { createCanvas } from "@napi-rs/canvas";

// Output a wireframe-box "child's drawing" of an empty room as a base64 PNG.
// Intended as a control input for Flux Canny — only crisp black edges + a
// white background. No fills, no shading, no doors/windows.

const CANVAS_W = 1024;
const CANVAS_H = 768;
const CEIL_H_M = 3.0;
const COS30 = Math.cos(Math.PI / 6); // ≈ 0.866
const SIN30 = Math.sin(Math.PI / 6); // = 0.5
const STROKE_PX = 3;
const STROKE_COLOR = "#000000";
const FILL_BG = "#FFFFFF";
const MARGIN_PX = 80;

type Point2D = [number, number];
type Point3D = [number, number, number];

type RoomLike = {
  polygon: unknown;
  area_m2: number | null;
};

function parsePolygon(value: unknown): Point2D[] | null {
  if (!Array.isArray(value)) return null;
  const pts: Point2D[] = [];
  for (const p of value) {
    if (!Array.isArray(p) || p.length < 2) return null;
    const x = Number(p[0]);
    const y = Number(p[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    pts.push([x, y]);
  }
  return pts.length >= 3 ? pts : null;
}

// Pick the polygon's bounding-box width/height in viewBox units, then use the
// known area_m2 to recover real-world width and depth in metres.
function realWorldDimensions(
  polygon: Point2D[],
  areaM2: number,
): { widthM: number; depthM: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of polygon) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const bboxW = Math.max(maxX - minX, 1e-6);
  const bboxH = Math.max(maxY - minY, 1e-6);
  const aspect = bboxW / bboxH;
  const safeArea = Math.max(areaM2, 1);
  const widthM = Math.sqrt(safeArea * aspect);
  const depthM = Math.sqrt(safeArea / aspect);
  return { widthM, depthM };
}

// Standard 30°/30° isometric. World axes:
//   x → screen lower-right (cos30, sin30)
//   y → screen lower-left  (-cos30, sin30)
//   z → screen straight up (0, -1)
function isoProject([x, y, z]: Point3D): Point2D {
  return [(x - y) * COS30, (x + y) * SIN30 - z];
}

export async function buildControlImageBase64(
  room: RoomLike,
): Promise<string> {
  const polygon = parsePolygon(room.polygon);
  if (!polygon) {
    throw new Error("Room polygon is missing or malformed.");
  }

  const { widthM, depthM } = realWorldDimensions(
    polygon,
    room.area_m2 ?? 0,
  );

  // Eight corners of the box.
  // 0..3 — floor: (0,0,0), (W,0,0), (W,D,0), (0,D,0)
  // 4..7 — ceiling at z = ceiling height
  const verts3D: Point3D[] = [
    [0, 0, 0],
    [widthM, 0, 0],
    [widthM, depthM, 0],
    [0, depthM, 0],
    [0, 0, CEIL_H_M],
    [widthM, 0, CEIL_H_M],
    [widthM, depthM, CEIL_H_M],
    [0, depthM, CEIL_H_M],
  ];

  // Project to raw 2D, then auto-fit into the canvas.
  const raw = verts3D.map(isoProject);
  let pMinX = Infinity;
  let pMinY = Infinity;
  let pMaxX = -Infinity;
  let pMaxY = -Infinity;
  for (const [px, py] of raw) {
    if (px < pMinX) pMinX = px;
    if (py < pMinY) pMinY = py;
    if (px > pMaxX) pMaxX = px;
    if (py > pMaxY) pMaxY = py;
  }
  const projW = pMaxX - pMinX;
  const projH = pMaxY - pMinY;
  const availW = CANVAS_W - 2 * MARGIN_PX;
  const availH = CANVAS_H - 2 * MARGIN_PX;
  const scale = Math.min(availW / projW, availH / projH);
  const offsetX = (CANVAS_W - projW * scale) / 2 - pMinX * scale;
  const offsetY = (CANVAS_H - projH * scale) / 2 - pMinY * scale;

  const verts: Point2D[] = raw.map(([px, py]) => [
    px * scale + offsetX,
    py * scale + offsetY,
  ]);

  // 12 edges of the box: 4 floor + 4 ceiling + 4 vertical risers.
  const edges: ReadonlyArray<readonly [number, number]> = [
    [0, 1], [1, 2], [2, 3], [3, 0], // floor
    [4, 5], [5, 6], [6, 7], [7, 4], // ceiling
    [0, 4], [1, 5], [2, 6], [3, 7], // verticals
  ];

  const canvas = createCanvas(CANVAS_W, CANVAS_H);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = FILL_BG;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  ctx.strokeStyle = STROKE_COLOR;
  ctx.lineWidth = STROKE_PX;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const [a, b] of edges) {
    ctx.beginPath();
    ctx.moveTo(verts[a][0], verts[a][1]);
    ctx.lineTo(verts[b][0], verts[b][1]);
    ctx.stroke();
  }

  return canvas.toBuffer("image/png").toString("base64");
}
