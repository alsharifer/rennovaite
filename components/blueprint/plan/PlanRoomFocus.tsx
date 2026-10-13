"use client";

// =============================================================================
// components/blueprint/plan/PlanRoomFocus.tsx — /plan?room=<id> (the 3D view's
// "Show on plan", K8 #9) selects that room in the editor, through the same
// window event the Plan check panel uses. The editor mounts on its own clock,
// so the selection is sent a few times; selecting a room twice is harmless.
// =============================================================================

import { useEffect } from "react";

import { PLAN_SELECT_ROOMS_EVENT } from "./PlanCheckPanel";

export function PlanRoomFocus({ roomId }: { roomId: string }) {
  useEffect(() => {
    const send = () => window.dispatchEvent(new CustomEvent(PLAN_SELECT_ROOMS_EVENT, { detail: { ids: [roomId] } }));
    const timers = [0, 400, 1200].map((ms) => window.setTimeout(send, ms));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [roomId]);
  return null;
}
