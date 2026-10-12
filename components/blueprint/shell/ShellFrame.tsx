"use client";

// =============================================================================
// components/blueprint/shell/ShellFrame.tsx — the Blueprint page frame (K2).
//
// Rail + top bar + main, under ONE data-system="blueprint" root. Client only
// for the pathname: which step is active (lib/journey activeStepKey) and
// whether this page takes the compact-wide rail (the BoQ page, spec §1.5).
//
// K8: every page body is Blueprint, or wears the Atelier canvas itself while it
// waits for its rebuild (the route scan lists those pages).
// =============================================================================

import { usePathname } from "next/navigation";
import { Suspense, useEffect, useSyncExternalStore, type ReactNode } from "react";

import { FIRM_STEPS, OWNER_STEPS, activeStepKey, ownerStepHref, type JourneyFlags } from "@/lib/journey";
import type { RailContext } from "@/lib/journey-state";

import { HelpDrawer } from "./HelpDrawer";
import { JourneyRail } from "./JourneyRail";
import { noSubscribe, readStep, writeStep } from "./step-memory";
import type { RailStep } from "./StepList";
import { TopBar } from "./TopBar";

/** Page titles for shell pages that are not journey steps. */
const PAGE_TITLES: [RegExp, string][] = [
  [/^\/projects$/, "Projects"],
  [/^\/project\/[^/]+\/viewer$/, "3D view"],
  [/^\/settings/, "Settings"],
  [/^\/firms\/[^/]+\/quotes\//, "Quotation"],
  [/^\/firms\/[^/]+/, "Rate book"],
  [/^\/firms$/, "Rate books"],
];

export function railSteps(ctx: RailContext, flags: JourneyFlags, pathname = ""): RailStep[] {
  const id = ctx.project?.id;
  // K6: on the intake (no project yet) the owner journey is drawn with 01 Plan active;
  // the later steps wait for the project the intake creates (they lead back here).
  if (!id && pathname === "/project/new") {
    return OWNER_STEPS.map((s) => ({ key: s.key, number: s.number, label: s.label, href: "/project/new", status: { state: "available" as const } }));
  }
  if (!id) return [];
  const status = (k: string) => ctx.statuses[k] ?? { state: "available" as const };
  if (ctx.persona === "firm") return FIRM_STEPS.map((s) => ({ key: s.key, number: s.number, label: s.label, href: s.href(id), status: status(s.key) }));
  return OWNER_STEPS.map((s) => ({ key: s.key, number: s.number, label: s.label, href: ownerStepHref(s.key, id, flags), status: status(s.key) }));
}

// A side surface (the 3D view, spec §6.8) is off the numbered journey: the
// rail keeps the step you came from (./step-memory).
const SIDE_SURFACE = /\/viewer$/;

export function ShellFrame({ ctx, flags, skin, title, children }: { ctx: RailContext; flags: JourneyFlags; skin?: "warm"; title?: string; children: ReactNode }) {
  const pathname = usePathname();
  const steps = railSteps(ctx, flags, pathname);
  const projectId = ctx.project?.id ?? null;
  const stepKey = activeStepKey(ctx.persona, pathname, projectId);
  const side = SIDE_SURFACE.test(pathname);
  const remembered = useSyncExternalStore(noSubscribe, () => (side ? readStep(projectId) : null), () => null);
  useEffect(() => {
    if (projectId && stepKey) writeStep(projectId, stepKey);
  }, [projectId, stepKey]);
  const activeKey = stepKey ?? (side && remembered && steps.some((x) => x.key === remembered) ? remembered : null);
  // K4: Revisions & Approval (21:450) takes the compact rail too — a seven-column diff beside a 360 column.
  const compactWide = activeKey === "boq_review" || activeKey === "revisions" || (ctx.persona === "owner" && /\/boq(\/revisions)?$/.test(pathname));
  const pageTitle = title ?? PAGE_TITLES.find(([re]) => re.test(pathname))?.[1] ?? null;

  return (
    <div data-system="blueprint" data-skin={skin} data-rail={compactWide ? "compact-wide" : "standard"} className="bp-shell min-h-screen bg-bp-surface-base font-bp-sans text-bp-ink-primary">
      <JourneyRail ctx={ctx} steps={steps} activeKey={activeKey} />
      <TopBar ctx={ctx} steps={steps} activeKey={activeKey} pageTitle={pageTitle} />
      <main id="main" className="bp-main">
        {children}
      </main>
      <Suspense fallback={null}>
        <HelpDrawer projectId={ctx.project?.id ?? null} area={activeKey ?? pageTitle ?? "app"} />
      </Suspense>
    </div>
  );
}
