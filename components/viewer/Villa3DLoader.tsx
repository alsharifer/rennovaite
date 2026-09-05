"use client";

// Client-only loader: three/fiber must not run during SSR, so Villa3D is
// dynamically imported with ssr:false (only allowed inside a client component).

import dynamic from "next/dynamic";

import type { FinishPlan } from "@/lib/viewer/materials";
import type { SceneModel } from "@/lib/viewer/scene";

import type { InspectData, RoomRenders } from "./Villa3D";

const Villa3D = dynamic(() => import("./Villa3D").then((m) => m.Villa3D), {
  ssr: false,
  loading: () => (
    <div className="flex h-[calc(100vh-9rem)] w-full items-center justify-center rounded-xl border border-ink-100 bg-canvas">
      <p className="font-body text-body-md text-on-surface-variant">Building your villa in 3D…</p>
    </div>
  ),
});

export function Villa3DLoader({
  scene,
  renders,
  inspect,
  finishes,
}: {
  scene: SceneModel;
  renders: RoomRenders[];
  inspect?: InspectData;
  finishes?: FinishPlan;
}) {
  return <Villa3D scene={scene} renders={renders} inspect={inspect} finishes={finishes} />;
}
