// =============================================================================
// components/blueprint/shell/step-memory.ts — the last journey step a project
// was on, per tab (sessionStorage). A side surface (the 3D view, spec §6.8) is
// off the numbered journey: the rail keeps that step lit and "Back to …" goes
// to it. Written by the shell on every step page; read on side surfaces.
// =============================================================================

export const stepMemoryKey = (projectId: string) => `rv:step:${projectId}`;

/** A store that never changes while the page is open (useSyncExternalStore). */
export const noSubscribe = () => () => {};

export function readStep(projectId: string | null): string | null {
  if (!projectId) return null;
  try {
    return window.sessionStorage.getItem(stepMemoryKey(projectId));
  } catch {
    return null;
  }
}

export function writeStep(projectId: string, stepKey: string): void {
  try {
    window.sessionStorage.setItem(stepMemoryKey(projectId), stepKey);
  } catch {
    /* the rail simply lights nothing on a side surface */
  }
}
