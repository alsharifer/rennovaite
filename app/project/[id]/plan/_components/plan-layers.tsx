"use client";

import { useState } from "react";

import { InspectPanel } from "@/components/viewer/InspectPanel";
import type { RawRoomInput } from "@/lib/overlays/viewbox";
import {
  roomTarget,
  type InspectBoq,
  type InspectTarget,
  type RoomMeta,
} from "@/lib/viewer/inspect";

import { EditablePlanViewer } from "./editable-plan-viewer";
import { OverlayEditor } from "./overlay-editor";
import type { PlanViewerMode } from "./plan-interaction";

type Layer = "plan" | "electrical" | "plumbing";

const LAYERS: { key: Layer; label: string; glyph: string }[] = [
  { key: "plan", label: "Plan", glyph: "grid_on" },
  { key: "electrical", label: "Electrical", glyph: "bolt" },
  { key: "plumbing", label: "Plumbing", glyph: "water_drop" },
];

/** Read-mode tap-to-inspect data (same shape the 3D host builds). */
export interface PlanInspectData {
  projectId: string;
  boq: InspectBoq;
  rooms: RoomMeta[];
}

/**
 * Layer toggle over the 2D plan. `mode` is required — parse-confirm passes
 * "edit" (full geometry editing); every read-only surface passes "read"
 * (view-only + tap-to-inspect, no editing toolbar/palette). Layer visibility
 * toggles stay in both modes — viewing overlays is reading.
 */
export function PlanLayers({
  projectId,
  planId,
  initialRooms,
  initialTotalAreaM2,
  overlaysEnabled,
  mode,
  inspect,
}: {
  projectId: string;
  planId: string;
  initialRooms: RawRoomInput[];
  initialTotalAreaM2: number | null;
  overlaysEnabled: boolean;
  mode: PlanViewerMode;
  inspect?: PlanInspectData;
}) {
  const [layer, setLayer] = useState<Layer>("plan");
  const [target, setTarget] = useState<InspectTarget | null>(null);

  const onInspectRoom = (roomId: string) => {
    const room = inspect?.rooms.find((r) => r.id === roomId);
    if (room) setTarget(roomTarget(room));
  };

  const planViewer = (
    <EditablePlanViewer
      planId={planId}
      initialRooms={initialRooms}
      initialTotalAreaM2={initialTotalAreaM2}
      mode={mode}
      onInspectRoom={onInspectRoom}
    />
  );

  const panel =
    mode === "read" && inspect && target ? (
      <InspectPanel
        target={target}
        boq={inspect.boq}
        projectId={inspect.projectId}
        onClose={() => setTarget(null)}
      />
    ) : null;

  if (!overlaysEnabled) {
    return (
      <>
        {planViewer}
        {panel}
      </>
    );
  }

  return (
    <div className="space-y-3">
      <div className="inline-flex gap-0.5 rounded-lg border border-ink-100 bg-paper p-0.5">
        {LAYERS.map((l) => {
          const active = layer === l.key;
          return (
            <button
              key={l.key}
              type="button"
              onClick={() => setLayer(l.key)}
              aria-pressed={active}
              className={
                "focus-ring inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-body-sm font-semibold transition-colors " +
                (active
                  ? "bg-brass-600 text-on-primary"
                  : "text-ink-700 hover:bg-surface-container")
              }
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                {l.glyph}
              </span>
              {l.label}
            </button>
          );
        })}
      </div>

      {layer === "plan" ? (
        planViewer
      ) : (
        <OverlayEditor
          projectId={projectId}
          rooms={initialRooms}
          layer={layer}
          readOnly={mode === "read"}
        />
      )}

      {panel}
    </div>
  );
}
