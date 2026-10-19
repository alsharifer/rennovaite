// =============================================================================
// lib/render/fitting-notes.ts — where a small fitting goes in ONE photo view
// (bathroom pilot, client comments 19 Oct). Pure.
//
// The placement check holds the big fixtures to the photo; a small fitting the
// design MOVES (the shattaf, from beside the door to beside the WC) would
// otherwise stay where the photo has it. The plan knows where it goes; this
// turns that into words for one camera: "to the right of the WC in this view".
// =============================================================================

import type { PlanLite } from "./photo-check";
import type { PhotoCamera } from "./photo-views";

/**
 * The prompt lines for the shattaf (health faucet) in a view: beside the WC on
 * the side the plan puts it, as seen from this camera — and nowhere else.
 * `wcInView` = the before photo shows the WC.
 */
export function fittingNotes(camera: PhotoCamera | null, plan: PlanLite, wcInView: boolean): string[] {
  const shattaf = plan.fixtures.find((f) => f.type === "shattaf_point");
  if (!shattaf) return [];
  const wcs = plan.fixtures.filter((f) => f.type === "wc_point");
  const wc = wcs.sort((a, b) => Math.hypot(a.position[0] - shattaf.position[0], a.position[1] - shattaf.position[1]) - Math.hypot(b.position[0] - shattaf.position[0], b.position[1] - shattaf.position[1]))[0];
  if (!wc) return ["The shattaf (a hand spray on a hose with its wall valve) is beside the WC only — remove any hand spray elsewhere, such as beside the door."];
  if (!wcInView) return ["The shattaf (a hand spray on a hose) now hangs beside the WC, which is outside this view — remove any hand spray or hose from this view, such as beside the door."];
  let side = "";
  if (camera) {
    // Compass heading, 0 = plan up (−y), clockwise; the viewer's right in plan space (y down).
    const h = (camera.heading_deg * Math.PI) / 180;
    const right: [number, number] = [Math.cos(h), Math.sin(h)];
    const d = (shattaf.position[0] - wc.position[0]) * right[0] + (shattaf.position[1] - wc.position[1]) * right[1];
    side = d > 0 ? "to the right of the WC as seen in this photo" : "to the left of the WC as seen in this photo";
  }
  return [`The shattaf (a brushed-brass hand spray on a hose with its small wall valve and holder) is on the wall ${side || "beside the WC"}, close beside it at about knee height — and nowhere else: remove any hand spray or hose by the door.`];
}
