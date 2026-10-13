import type { Metadata } from "next";

import { AccountShell } from "@/components/blueprint/shell/ProjectShell";
import { ownerStep } from "@/lib/journey";

import { VillaIntake } from "./_components/villa-intake";

export const metadata: Metadata = {
  title: "New project · RenovAIte",
};

// The garden-pilot flag is read per request, so the page cannot be static.
export const dynamic = "force-dynamic";

// K6 — 01 Intake (R7 §3.9, Figma 29:1016): the owner front door's working
// half, Blueprint with the warm skin (data-skin="warm" on the Blueprint root).
// The step number comes from the journey, never a literal.
export default function NewProjectPage() {
  // K8: the intake is part of 01 Plan (spec §6.0).
  const step = ownerStep("plan");
  return (
    <AccountShell skin="warm">
      <div className="mx-auto max-w-[1100px] px-6 py-10 lg:px-12" data-skin-page="intake">
        <VillaIntake gardenPilot={process.env.GARDEN_PILOT_ENABLED === "true"} eyebrow={`${step.number} · ${step.label.toUpperCase()}`} />
      </div>
    </AccountShell>
  );
}
