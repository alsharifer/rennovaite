"use client";

// =============================================================================
// components/blueprint/shell/ShellFrame.tsx — the Blueprint page frame (K2).
//
// Rail + top bar + main, under ONE data-system="blueprint" root. Client only
// for the pathname: which step is active (lib/journey activeStepKey) and
// whether this page takes the compact-wide rail (the BoQ page, spec §1.5).
//
// `content="atelier"` is the transition: a page whose body is still Atelier
// (redesigned in K3–K5) sits on its own canvas, Inter and light, inside the
// Blueprint chrome — the chrome follows the theme, the body does not yet.
// =============================================================================

import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { FIRM_STEPS, activeStepKey, journeySteps, type JourneyFlags } from "@/lib/journey";
import type { RailContext } from "@/lib/journey-state";

import { HelpDrawer } from "./HelpDrawer";
import { JourneyRail } from "./JourneyRail";
import type { RailStep } from "./StepList";
import { TopBar } from "./TopBar";

/** Page titles for shell pages that are not journey steps. */
const PAGE_TITLES: [RegExp, string][] = [
  [/^\/settings/, "Settings"],
  [/^\/firms\/[^/]+\/quotes\//, "Quotation"],
  [/^\/firms\/[^/]+/, "Rate book"],
  [/^\/firms$/, "Rate books"],
];

export function railSteps(ctx: RailContext, flags: JourneyFlags): RailStep[] {
  const id = ctx.project?.id;
  if (!id) return [];
  const status = (k: string) => ctx.statuses[k] ?? { state: "available" as const };
  if (ctx.persona === "firm") return FIRM_STEPS.map((s) => ({ key: s.key, number: s.number, label: s.label, href: s.href(id), status: status(s.key) }));
  return journeySteps(flags).map((s) => ({ key: s.key, number: String(s.number).padStart(2, "0"), label: s.label, href: s.href(id), status: status(s.key) }));
}

/** An Atelier page body inside the Blueprint chrome (its own light canvas, Inter). */
export function AtelierCanvas({ children }: { children: ReactNode }) {
  return <div className="min-h-[calc(100vh-var(--bp-topbar-h))] bg-canvas p-4 font-sans text-on-background md:p-12">{children}</div>;
}

export function ShellFrame({ ctx, flags, content = "atelier", children }: { ctx: RailContext; flags: JourneyFlags; content?: "atelier" | "blueprint"; children: ReactNode }) {
  const pathname = usePathname();
  const steps = railSteps(ctx, flags);
  const activeKey = activeStepKey(ctx.persona, pathname, ctx.project?.id ?? null, flags);
  const compactWide = activeKey === "boq_review" || (ctx.persona === "owner" && pathname.endsWith("/boq"));
  const pageTitle = PAGE_TITLES.find(([re]) => re.test(pathname))?.[1] ?? null;

  return (
    <div data-system="blueprint" data-rail={compactWide ? "compact-wide" : "standard"} className="bp-shell min-h-screen bg-bp-surface-base font-bp-sans text-bp-ink-primary">
      <JourneyRail ctx={ctx} steps={steps} activeKey={activeKey} />
      <TopBar ctx={ctx} steps={steps} activeKey={activeKey} pageTitle={pageTitle} />
      <main id="main" className="bp-main">
        {content === "atelier" ? <AtelierCanvas>{children}</AtelierCanvas> : children}
      </main>
      <Suspense fallback={null}>
        <HelpDrawer projectId={ctx.project?.id ?? null} area={activeKey ?? pageTitle ?? "app"} />
      </Suspense>
    </div>
  );
}
