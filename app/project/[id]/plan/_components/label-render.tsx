// Rule 12 (15 Oct) on the read-only layers: a room's name, fitted to its box
// (lib/plan/label-fit.ts) — abbreviated, smaller, or left out; never past it.
import type { ReactNode } from "react";

import { fitNameLabel } from "@/lib/plan/label-fit";

export function roomNameLabel(r: { name_en: string | null; pts: [number, number][] }, draw: (nl: { text: string; fontPx: number; x: number; y: number }) => ReactNode, namePx = 12): ReactNode {
  const xs = r.pts.map((p) => p[0]), ys = r.pts.map((p) => p[1]);
  const nl = fitNameLabel(r.name_en ?? "", Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), namePx);
  // Centred on the box the label was fitted to (a corner average drifts in an irregular room).
  return nl ? draw({ ...nl, x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2 }) : null;
}
