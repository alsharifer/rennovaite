"use client";

import { useState } from "react";

import type { RawRoomInput } from "@/lib/overlays/viewbox";

import { EditablePlanViewer } from "./editable-plan-viewer";
import { OverlayEditor } from "./overlay-editor";

type Layer = "plan" | "electrical" | "plumbing";

const LAYERS: { key: Layer; label: string; glyph: string }[] = [
  { key: "plan", label: "Plan", glyph: "grid_on" },
  { key: "electrical", label: "Electrical", glyph: "bolt" },
  { key: "plumbing", label: "Plumbing", glyph: "water_drop" },
];

/**
 * Layer toggle over the 2D plan (P2). Plan → the existing EditablePlanViewer;
 * Electrical / Plumbing → the overlay fixture editor. When OVERLAYS_ENABLED is
 * off the toggle is not rendered — the plan is exactly as before.
 */
export function PlanLayers({
  projectId,
  planId,
  initialRooms,
  initialTotalAreaM2,
  overlaysEnabled,
}: {
  projectId: string;
  planId: string;
  initialRooms: RawRoomInput[];
  initialTotalAreaM2: number | null;
  overlaysEnabled: boolean;
}) {
  const [layer, setLayer] = useState<Layer>("plan");

  if (!overlaysEnabled) {
    return (
      <EditablePlanViewer
        planId={planId}
        initialRooms={initialRooms}
        initialTotalAreaM2={initialTotalAreaM2}
      />
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
        <EditablePlanViewer
          planId={planId}
          initialRooms={initialRooms}
          initialTotalAreaM2={initialTotalAreaM2}
        />
      ) : (
        <OverlayEditor projectId={projectId} rooms={initialRooms} layer={layer} />
      )}
    </div>
  );
}
