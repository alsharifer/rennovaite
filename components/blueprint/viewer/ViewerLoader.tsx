"use client";

// Client-only loader: three / fiber must not run during SSR, so Viewer3D is a
// dynamic import with ssr:false (only allowed inside a client component).

import dynamic from "next/dynamic";

import type { FinishPlan } from "@/lib/viewer/materials";
import type { SceneModel } from "@/lib/viewer/scene";

import { StateBlock } from "../StateBlock";
import type { BackTargets, ViewerData } from "./Viewer3D";

const Viewer3D = dynamic(() => import("./Viewer3D").then((m) => m.Viewer3D), {
  ssr: false,
  loading: () => (
    <div className="px-6 py-8 lg:px-12">
      <StateBlock kind="loading" title="Building your plan in 3D" rows={4} columns={3} />
    </div>
  ),
});

export function ViewerLoader(props: { scene: SceneModel; data: ViewerData; finishes?: FinishPlan; back: BackTargets }) {
  return <Viewer3D {...props} />;
}
