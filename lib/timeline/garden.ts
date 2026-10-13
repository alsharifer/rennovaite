// =============================================================================
// lib/timeline/garden.ts — the timeline of a GARDEN project (K9; K8 review
// ruling 3, 13 Oct). Pure.
//
// lib/timeline/estimate.ts is the INTERIOR phase model (an 82-day villa refit):
// on a garden it can only see mobilisation and snagging, and printed 1–3 weeks
// for Arabella. A garden project never uses it. Its timeline is the BoQ's own
// indicative programme (lib/boq/programme.ts, stored on the BoQ since G5d —
// re-derived from the sections for an older revision that lacks one), shown as
// a DERIVED duration with its basis. A project with any interior room keeps
// the interior model.
// =============================================================================

import { indicativeProgramme, type IndicativeProgramme } from "@/lib/boq/programme";
import { TIMELINE } from "@/lib/ground-truth/villa94-garden";
import { isOutdoorType } from "@/lib/plan/zones";

export interface GardenTimeline {
  totalDays: number;
  phases: IndicativeProgramme["phases"];
  /** The ruling's words: one real garden, its duration. */
  basis: string;
}

export const GARDEN_TIMELINE_BASIS = `Scaled from one real Dubai garden project (~${TIMELINE.actual_days} days) by the value of this bill of quantities. Indicative — the contractor's programme replaces it.`;

/** Every zone outdoor (balcony / terrace are interior rooms, zones.ts). An empty plan is not a garden. */
export function isGardenProject(roomTypes: readonly (string | null)[]): boolean {
  return roomTypes.length > 0 && roomTypes.every((t) => isOutdoorType(t));
}

type BoqDoc = {
  sections?: { work_section: string; section_total_aed: number }[];
  subtotal_aed?: number;
  programme?: IndicativeProgramme | null;
};

/** The garden timeline from the stored BoQ document, or null when it has nothing to programme. */
export function gardenTimeline(doc: BoqDoc): GardenTimeline | null {
  const prog = doc.programme ?? (doc.sections && doc.subtotal_aed != null ? indicativeProgramme(doc.sections, doc.subtotal_aed) : null);
  if (!prog || !prog.phases.length) return null;
  // Days only: the reference counts days from mobilisation to handover, not working days, so no week conversion.
  return { totalDays: prog.total_days, phases: prog.phases, basis: GARDEN_TIMELINE_BASIS };
}
