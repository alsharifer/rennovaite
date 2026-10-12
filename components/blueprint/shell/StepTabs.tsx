// =============================================================================
// components/blueprint/shell/StepTabs.tsx — an owner step's sub-tabs (K8, §6.0).
//
// 04 Cost = Bill of quantities | Specification; 06 Tender = Documents |
// Contractors & suppliers (Documents only where DRAWINGS_ENABLED). Owner
// persona only: on the firm journey these routes are separate steps with no
// tabs (03 Specification, 06 Documents). Server component — the tab list reads
// the deployment's flags (lib/journey.ts ownerSubTabs).
// =============================================================================

import { journeyFlagsFromEnv, ownerStep, ownerSubTabs, type JourneyPersona, type OwnerStepKey } from "@/lib/journey";

import { SubTabs } from "../SubTabs";

export function StepTabs({ step, projectId, active, persona, meta = {} }: { step: OwnerStepKey; projectId: string; active: string; persona: JourneyPersona; meta?: Record<string, string | undefined> }) {
  if (persona !== "owner") return null;
  const s = ownerStep(step);
  const tabs = ownerSubTabs(step, projectId, journeyFlagsFromEnv()).map((t) => ({ key: t.key, label: t.label, href: t.href, meta: meta[t.key] }));
  return <SubTabs label={`${s.number} ${s.label}`} tabs={tabs} active={active} />;
}
