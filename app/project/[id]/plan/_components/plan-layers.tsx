"use client";

import { useState } from "react";

import { InspectPanel } from "@/components/viewer/InspectPanel";
import type { RoomAreaDispute } from "@/lib/parse/disputes";
import type { RawRoomInput } from "@/lib/overlays/viewbox";
import {
  roomTarget,
  type InspectBoq,
  type InspectTarget,
  type RoomMeta,
} from "@/lib/viewer/inspect";

import { EditablePlanViewer, type PlotSize } from "./editable-plan-viewer";
import { ElementsEditor } from "./elements-editor";
import { OpeningsEditor } from "./openings-editor";
import { OverlayEditor } from "./overlay-editor";
import type { PlanViewerMode } from "./plan-interaction";

type Layer = "plan" | "openings" | "elements" | "electrical" | "plumbing";

const PLAN_LAYER = { key: "plan" as const, label: "Plan", glyph: "grid_on" };
// A5 openings are NOT gated by OVERLAYS_ENABLED — doors/windows are part of the
// plan itself (they change wall quantities), not an MEP overlay.
const OPENINGS_LAYER = { key: "openings" as const, label: "Openings", glyph: "door_front" };
// G1 linear elements. Like openings, these are part of the plan rather than an
// MEP overlay — a boundary wall IS a wall — so they follow the garden-pilot
// flag, not OVERLAYS_ENABLED.
const ELEMENTS_LAYER = { key: "elements" as const, label: "Elements", glyph: "fence" };
const OVERLAY_LAYERS = [
  { key: "electrical" as const, label: "Electrical", glyph: "bolt" },
  { key: "plumbing" as const, label: "Plumbing", glyph: "water_drop" },
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
  areaDisputes,
  gardenPilot = false,
  plot = null,
}: {
  projectId: string;
  planId: string;
  initialRooms: RawRoomInput[];
  initialTotalAreaM2: number | null;
  overlaysEnabled: boolean;
  mode: PlanViewerMode;
  inspect?: PlanInspectData;
  /** Rooms whose printed dimension and whose outline disagree materially. */
  areaDisputes?: RoomAreaDispute[];
  /** G1: garden pilot on — offer outdoor zone types and the elements layer. */
  gardenPilot?: boolean;
  /** G1: authored plan's measured plot. */
  plot?: PlotSize | null;
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
      areaDisputes={areaDisputes}
      mode={mode}
      onInspectRoom={onInspectRoom}
      plot={plot}
      outdoorEnabled={gardenPilot}
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

  const openingsEditor = (
    <OpeningsEditor
      planId={planId}
      rooms={initialRooms}
      totalAreaM2={initialTotalAreaM2}
      readOnly={mode === "read"}
    />
  );

  const layers = [
    PLAN_LAYER,
    OPENINGS_LAYER,
    ...(gardenPilot ? [ELEMENTS_LAYER] : []),
    ...(overlaysEnabled ? OVERLAY_LAYERS : []),
  ];

  return (
    <div className="space-y-3">
      <div className="inline-flex gap-0.5 rounded-lg border border-ink-100 bg-paper p-0.5">
        {layers.map((l) => {
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
      ) : layer === "openings" ? (
        openingsEditor
      ) : layer === "elements" ? (
        <ElementsEditor
          planId={planId}
          rooms={initialRooms}
          plot={plot}
          readOnly={mode === "read"}
        />
      ) : (
        <OverlayEditor
          projectId={projectId}
          rooms={initialRooms}
          layer={layer}
          readOnly={mode === "read"}
          gardenPilot={gardenPilot}
        />
      )}

      {panel}
    </div>
  );
}
