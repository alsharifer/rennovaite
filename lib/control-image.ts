import { createCanvas } from "@napi-rs/canvas";

// Two control-image variants for Flux:
//
//   buildControlImageBase64       — black-on-white edge map for flux-*-canny.
//                                   One-point perspective interior sketch:
//                                   back wall + four perspective lines.
//
//   buildDepthControlImageBase64  — greyscale depth map for flux-*-depth.
//                                   Same perspective layout as the canny
//                                   variant but rendered as smooth gradients
//                                   (white = near camera, dark = far).
//
// Both treat the polygon as a rectangle (use its bbox aspect) and recover
// real-world width/depth in metres from area_m2. Output: 1024×768 base64 PNG.

const CANVAS_W = 1024;
const CANVAS_H = 768;
const CEIL_H_M = 3.0;

// Canny edge-map look.
const STROKE_PX = 3;
const STROKE_COLOR = "#000000";
const FILL_BG = "#FFFFFF";

// Depth map look. White = near, dark = far.
const DEPTH_NEAR = "#FFFFFF";
const DEPTH_FAR = "#1A1A1A";

type Point2D = [number, number];

type RoomLike = {
  polygon: unknown;
  area_m2: number | null;
};

// ---------------------------------------------------------------------------
// Geometry helpers (shared by both variants)
// ---------------------------------------------------------------------------

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

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

// Photographer's convention: shoot the LONGER axis of the room so depth
// perspective reads. So depth = max(real width, real height); width = min.
function realWorldDimensions(
  polygon: Point2D[],
  areaM2: number,
): { widthM: number; depthM: number } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of polygon) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const bboxW = Math.max(maxX - minX, 1e-6);
  const bboxH = Math.max(maxY - minY, 1e-6);
  const aspect = bboxW / bboxH;
  const area = Math.max(areaM2, 1);
  const dimA = Math.sqrt(area * aspect);
  const dimB = Math.sqrt(area / aspect);
  return {
    depthM: Math.max(dimA, dimB),
    widthM: Math.min(dimA, dimB),
  };
}

// Back wall sized by room aspect. Deep narrow rooms → smaller, more recessed
// back wall. Wide shallow rooms → larger, less recessed.
function backWallRect(widthM: number, depthM: number) {
  const aspect = widthM / depthM; // ≤ 1 because of how realWorldDimensions sorts
  const fracW = clamp(0.25 + 0.15 * aspect, 0.25, 0.6);
  const fracH = clamp(0.35 + 0.05 * aspect, 0.35, 0.55);
  const w = fracW * CANVAS_W;
  const h = fracH * CANVAS_H;
  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2;
  return {
    left: cx - w / 2,
    right: cx + w / 2,
    top: cy - h / 2,
    bottom: cy + h / 2,
    width: w,
    height: h,
  };
}

// ---------------------------------------------------------------------------
// Canny variant — black lines on white
// ---------------------------------------------------------------------------

export async function buildControlImageBase64(
  room: RoomLike,
): Promise<string> {
  const polygon = parsePolygon(room.polygon);
  if (!polygon) throw new Error("Room polygon is missing or malformed.");

  const { widthM, depthM } = realWorldDimensions(polygon, room.area_m2 ?? 0);
  // depthM is implicitly the camera distance to the back wall; CEIL_H_M is
  // unused in the perspective layout because the back-wall fractions already
  // encode "how far back". Reference here keeps the model honest.
  void CEIL_H_M;

  const back = backWallRect(widthM, depthM);

  const canvas = createCanvas(CANVAS_W, CANVAS_H);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = FILL_BG;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  ctx.strokeStyle = STROKE_COLOR;
  ctx.lineWidth = STROKE_PX;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Back wall outline
  ctx.strokeRect(back.left, back.top, back.width, back.height);

  // Four perspective lines from each back-wall corner to the matching canvas
  // corner. These define the side walls, floor, and ceiling trapezoids.
  const lines: Array<[number, number, number, number]> = [
    [back.left, back.top, 0, 0],
    [back.right, back.top, CANVAS_W, 0],
    [back.left, back.bottom, 0, CANVAS_H],
    [back.right, back.bottom, CANVAS_W, CANVAS_H],
  ];
  for (const [x1, y1, x2, y2] of lines) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  return canvas.toBuffer("image/png").toString("base64");
}

// ---------------------------------------------------------------------------
// Depth variant — greyscale gradients (white = near, dark = far)
// ---------------------------------------------------------------------------

export async function buildDepthControlImageBase64(
  room: RoomLike,
): Promise<string> {
  const polygon = parsePolygon(room.polygon);
  if (!polygon) throw new Error("Room polygon is missing or malformed.");

  const { widthM, depthM } = realWorldDimensions(polygon, room.area_m2 ?? 0);
  const back = backWallRect(widthM, depthM);

  const canvas = createCanvas(CANVAS_W, CANVAS_H);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = DEPTH_NEAR;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Helper: clip to a polygon, then fill with a linear gradient between two
  // points (in canvas coords). near/far stops describe depth, not screen pos.
  function fillTrapezoidWithGradient(
    polygon: Point2D[],
    farX: number,
    farY: number,
    nearX: number,
    nearY: number,
  ) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(polygon[0][0], polygon[0][1]);
    for (let i = 1; i < polygon.length; i++) {
      ctx.lineTo(polygon[i][0], polygon[i][1]);
    }
    ctx.closePath();
    ctx.clip();
    const grad = ctx.createLinearGradient(farX, farY, nearX, nearY);
    grad.addColorStop(0, DEPTH_FAR);
    grad.addColorStop(1, DEPTH_NEAR);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.restore();
  }

  // Floor: top edge at back-wall bottom (FAR), bottom edge at canvas bottom (NEAR)
  fillTrapezoidWithGradient(
    [
      [back.left, back.bottom],
      [back.right, back.bottom],
      [CANVAS_W, CANVAS_H],
      [0, CANVAS_H],
    ],
    0,
    back.bottom,
    0,
    CANVAS_H,
  );

  // Ceiling: bottom edge at back-wall top (FAR), top edge at canvas top (NEAR)
  fillTrapezoidWithGradient(
    [
      [0, 0],
      [CANVAS_W, 0],
      [back.right, back.top],
      [back.left, back.top],
    ],
    0,
    back.top,
    0,
    0,
  );

  // Left wall: right edge at back-wall left (FAR), left edge at canvas left (NEAR)
  fillTrapezoidWithGradient(
    [
      [0, 0],
      [back.left, back.top],
      [back.left, back.bottom],
      [0, CANVAS_H],
    ],
    back.left,
    0,
    0,
    0,
  );

  // Right wall: left edge at back-wall right (FAR), right edge at canvas right (NEAR)
  fillTrapezoidWithGradient(
    [
      [CANVAS_W, 0],
      [CANVAS_W, CANVAS_H],
      [back.right, back.bottom],
      [back.right, back.top],
    ],
    back.right,
    0,
    CANVAS_W,
    0,
  );

  // Back wall: solid FAR — all of it at one depth.
  ctx.fillStyle = DEPTH_FAR;
  ctx.fillRect(back.left, back.top, back.width, back.height);

  return canvas.toBuffer("image/png").toString("base64");
}
