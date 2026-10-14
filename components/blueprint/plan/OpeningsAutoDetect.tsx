"use client";

// =============================================================================
// components/blueprint/plan/OpeningsAutoDetect.tsx — read a plan's drawing for
// openings once, lazily (R10b). A plan read before R10b is read the first time
// Plan or Renders opens; the server's claim makes it once per plan however many
// tabs ask. Renders nothing — the Plan page's panel shows the run.
// =============================================================================

import { useEffect, useRef } from "react";

export function OpeningsAutoDetect({ planId, needed }: { planId: string; needed: boolean }) {
  const started = useRef(false);
  useEffect(() => {
    if (!needed || started.current) return;
    started.current = true;
    void fetch("/api/plan-openings/detect", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ plan_id: planId, mode: "auto" }) }).catch(() => undefined);
  }, [planId, needed]);
  return null;
}

/** After a reading finishes: start detection without waiting for it (the Plan page shows it). */
export function startOpeningsDetection(planId: string): void {
  void fetch("/api/plan-openings/detect", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ plan_id: planId, mode: "auto" }) }).catch(() => undefined);
}
