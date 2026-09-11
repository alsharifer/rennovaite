// =============================================================================
// lib/parse/sheet/pdf.ts — the ONLY module that opens a PDF.
//
// Everything else under lib/parse/sheet takes plain data, so the interpretation
// (region, labels, scale) is unit-tested without WebAssembly. This file's job is
// narrow: turn a PDF buffer into text lines, vector segments, and a PNG of a
// chosen rectangle.
//
// mupdf is a WASM build — no native binary, but it is big and must not be
// bundled, so it is listed in next.config.ts `serverExternalPackages` and
// imported lazily so a raster/photo parse never pays for loading it.
//
// EVERY entry point here is best-effort by contract. A PDF we cannot open, a
// page we cannot rasterise, a build where the WASM will not load — all return
// null, and the caller falls back to handing the whole document to the model
// exactly as before. A parse must never fail because an optimisation could not
// run.
// =============================================================================

// Type-only: erased at compile time, so naming these does NOT load the WASM.
import type { Matrix, Path, StrokeState } from "mupdf";

import type { SheetExtract, SheetSegment, SheetTextLine, Region } from "./types";

type MupdfModule = typeof import("mupdf");

let mupdfPromise: Promise<MupdfModule | null> | null = null;

async function loadMupdf(): Promise<MupdfModule | null> {
  mupdfPromise ??= import("mupdf").then(
    (m) => m,
    (err) => {
      console.warn("[parse/sheet] mupdf unavailable, falling back to the whole document:", err);
      return null;
    },
  );
  return mupdfPromise;
}

/** Below this many characters a PDF's "text layer" is a scan with a stamp on
 *  it, not a CAD sheet — there is nothing to be authoritative about. */
export const MIN_TEXT_LAYER_CHARS = 200;

/** Vision models downscale to roughly this many pixels; rasterising beyond it
 *  costs bytes and buys nothing. Matches what the API reports for a full page. */
export const RASTER_MAX_PIXELS = 1_150_000;

/** Never rasterise below this DPI — a crop that small is not worth sending. */
const MIN_RASTER_DPI = 40;
const MAX_RASTER_DPI = 400;

function applyMatrix(m: number[], x: number, y: number): [number, number] {
  return [m[0]! * x + m[2]! * y + m[4]!, m[1]! * x + m[3]! * y + m[5]!];
}

/**
 * Text lines and flattened vector segments from page 0, in PDF points.
 *
 * Returns null when the document cannot be read at all. An empty text layer is
 * NOT null — the caller decides what a scanned page means.
 */
export async function extractSheet(pdf: Buffer): Promise<SheetExtract | null> {
  const mupdf = await loadMupdf();
  if (!mupdf) return null;
  try {
    const doc = mupdf.Document.openDocument(pdf, "application/pdf");
    if (doc.countPages() < 1) return null;
    const page = doc.loadPage(0);
    const bounds = page.getBounds();
    const page_pt: [number, number] = [bounds[2]! - bounds[0]!, bounds[3]! - bounds[1]!];

    const lines: SheetTextLine[] = [];
    const st = JSON.parse(page.toStructuredText("preserve-whitespace").asJSON()) as {
      blocks?: { lines?: { text?: string; bbox: { x: number; y: number; w: number; h: number } }[] }[];
    };
    for (const block of st.blocks ?? []) {
      for (const line of block.lines ?? []) {
        const text = (line.text ?? "").trim();
        if (text.length === 0) continue;
        lines.push({ text, x: line.bbox.x, y: line.bbox.y, w: line.bbox.w, h: line.bbox.h });
      }
    }

    const segments: SheetSegment[] = [];
    const walk = (path: Path, ctm: Matrix, lw: number) => {
      let cur: [number, number] | null = null;
      let start: [number, number] | null = null;
      const push = (to: [number, number]) => {
        if (cur) segments.push({ x1: cur[0], y1: cur[1], x2: to[0], y2: to[1], lw });
        cur = to;
      };
      path.walk({
        moveTo(x: number, y: number) {
          cur = start = applyMatrix(ctm, x, y);
        },
        lineTo(x: number, y: number) {
          push(applyMatrix(ctm, x, y));
        },
        curveTo(_a: number, _b: number, _c: number, _d: number, x: number, y: number) {
          push(applyMatrix(ctm, x, y)); // chord approximation: enough for ink density
        },
        closePath() {
          if (start) push(start);
        },
      });
    };
    const scaleOf = (m: Matrix) =>
      Math.sqrt(Math.abs(m[0]! * m[3]! - m[1]! * m[2]!)) || 1;

    const device = new mupdf.Device({
      fillPath(path: Path, _evenOdd: boolean, ctm: Matrix) {
        walk(path, ctm, 0);
      },
      strokePath(path: Path, stroke: StrokeState, ctm: Matrix) {
        let lw = 1;
        try {
          lw = stroke.getLineWidth() * scaleOf(ctm);
        } catch {
          /* default pen */
        }
        walk(path, ctm, Math.round(lw * 1000) / 1000);
      },
      beginTile: () => 0,
    });
    page.run(device, mupdf.Matrix.identity);

    return { page_pt, lines, segments };
  } catch (err) {
    console.warn("[parse/sheet] could not read the PDF's layers:", err);
    return null;
  }
}

/**
 * Rasterise a rectangle of page 0 to PNG, sized to the vision model's budget.
 *
 * Passing no region rasterises the whole page. Returns null on any failure.
 */
export async function rasterizeRegion(
  pdf: Buffer,
  region: Region | null,
  maxPixels = RASTER_MAX_PIXELS,
): Promise<{ data: string; width: number; height: number } | null> {
  const mupdf = await loadMupdf();
  if (!mupdf) return null;
  try {
    const doc = mupdf.Document.openDocument(pdf, "application/pdf");
    const page = doc.loadPage(0);
    const b = page.getBounds();
    const box: Region = region ?? [b[0]!, b[1]!, b[2]!, b[3]!];
    const wPt = box[2] - box[0];
    const hPt = box[3] - box[1];
    if (!(wPt > 0) || !(hPt > 0)) return null;

    // Points are 1/72", so dpi is just the pixel-per-point factor times 72.
    const dpi = Math.min(
      MAX_RASTER_DPI,
      Math.max(MIN_RASTER_DPI, Math.sqrt(maxPixels / (wPt * hPt)) * 72),
    );
    const k = dpi / 72;

    // Render the WHOLE page at the crop's resolution, then cut pixels out of
    // it. A translate in the render matrix would move the pixmap's own origin
    // too, so the arithmetic that follows would have to track it; rendering
    // the page and indexing into it cannot be off by a pixel.
    const pix = page.toPixmap(mupdf.Matrix.scale(k, k), mupdf.ColorSpace.DeviceRGB, false, true);
    const width = Math.max(1, Math.round(wPt * k));
    const height = Math.max(1, Math.round(hPt * k));
    const originX = Math.round((box[0] - b[0]!) * k);
    const originY = Math.round((box[1] - b[1]!) * k);

    const crop = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, width, height], false);
    crop.clear(255);
    copyRect(pix, crop, originX, originY);
    return { data: Buffer.from(crop.asPNG()).toString("base64"), width, height };
  } catch (err) {
    console.warn("[parse/sheet] could not rasterise the plan region:", err);
    return null;
  }
}

interface PixmapLike {
  getWidth(): number;
  getHeight(): number;
  getStride(): number;
  getNumberOfComponents(): number;
  getPixels(): Uint8ClampedArray;
}

/** Copy the rectangle of `src` starting at (sx, sy) into `dst` at its origin.
 *  Rows are stride-padded, so never index by width. */
function copyRect(src: PixmapLike, dst: PixmapLike, sx: number, sy: number): void {
  const sp = src.getPixels();
  const dp = dst.getPixels();
  const sStride = src.getStride();
  const dStride = dst.getStride();
  const sn = src.getNumberOfComponents();
  const dn = dst.getNumberOfComponents();
  const n = Math.min(sn, dn);
  const sw = src.getWidth();
  const sh = src.getHeight();
  for (let y = 0; y < dst.getHeight(); y++) {
    const srcY = y + sy;
    if (srcY < 0 || srcY >= sh) continue;
    for (let x = 0; x < dst.getWidth(); x++) {
      const srcX = x + sx;
      if (srcX < 0 || srcX >= sw) continue;
      const si = srcY * sStride + srcX * sn;
      const di = y * dStride + x * dn;
      for (let c = 0; c < n; c++) dp[di + c] = sp[si + c]!;
    }
  }
}
