// =============================================================================
// lib/viewer/available.ts — whether the 3D view has anything to show (C5 #4).
// Server-side. ONE answer for every entry (01 Plan, the Overview, Renders):
// the flag is on AND the plan stands up walls. An open garden (zones, no walls)
// or a project with no plan shows no "3D view" link — it would open an empty
// state. A plan that cannot be read is "nothing to show", never an error page.
// =============================================================================

import { derivePlanGraph } from "@/lib/plan/derive";

export async function viewerAvailable(projectId: string): Promise<boolean> {
  if (process.env.VIEWER_3D_ENABLED !== "true") return false;
  try {
    return (await derivePlanGraph(projectId)).walls.length > 0;
  } catch {
    return false;
  }
}

/** The 3D view's href when it has something to show, else null. */
export async function viewerHref(projectId: string): Promise<string | null> {
  return (await viewerAvailable(projectId)) ? `/project/${projectId}/viewer` : null;
}
