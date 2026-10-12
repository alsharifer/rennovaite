"use client";

// =============================================================================
// components/blueprint/shell/TopBar.tsx — breadcrumb + page actions slot
// (R7 §2, frames 11:48 / 13:48) and, on a phone, the step switcher that opens
// the bottom step drawer (26:1041).
//
// Desktop: "Firm / Project / 05 BoQ & Review" on the left; the right holds
// whatever the page portals in with <TopBarActions> (K3+ put Regenerate,
// Export, Revisions there). Phone: "AI · 05 BoQ & Review ▾" opens the drawer
// (a native modal <dialog>: focus is trapped and Escape closes it); ⋮ opens
// Settings / Support.
// =============================================================================

import Link from "next/link";
import { createPortal } from "react-dom";
import { useRef, useSyncExternalStore, type ReactNode } from "react";

import type { RailContext } from "@/lib/journey-state";

import { Icon } from "../Icon";
import { openHelp } from "./JourneyRail";
import { revLine } from "./rev-line";
import { StepList, type RailStep } from "./StepList";

const ACTIONS_ID = "bp-topbar-actions";

/** Pages put their top-bar actions here; they render in the shell's top bar. */
export function TopBarActions({ children }: { children: ReactNode }) {
  const target = useSyncExternalStore(
    () => () => {},
    () => document.getElementById(ACTIONS_ID),
    () => null,
  );
  return target ? createPortal(children, target) : null;
}

export function TopBar({ ctx, steps, activeKey, pageTitle }: { ctx: RailContext; steps: RailStep[]; activeKey: string | null; pageTitle: string | null }) {
  const drawer = useRef<HTMLDialogElement>(null);
  const active = steps.find((s) => s.key === activeKey) ?? null;
  const here = active ? `${active.number} ${active.label}` : (pageTitle ?? "");
  const crumbs = [ctx.persona === "firm" ? ctx.firm?.name : null, ctx.project?.name, here].filter((c): c is string => !!c);

  return (
    <header className="bp-topbar flex items-center gap-4 border-b border-bp-line-hairline bg-bp-surface-base px-6">
      {/* Desktop / tablet */}
      <nav aria-label="Breadcrumb" className="bp-desk-only min-w-0 flex-1">
        <ol className="t-label-md flex min-w-0 items-center gap-3 text-bp-ink-tertiary">
          {crumbs.map((c, i) => (
            <li key={`${i}-${c}`} className={`flex min-w-0 items-center gap-3 ${i === crumbs.length - 1 ? "text-bp-ink-secondary" : ""}`} {...(i === crumbs.length - 1 ? { "aria-current": "page" as const } : {})}>
              {i > 0 ? <span aria-hidden="true">/</span> : null}
              <span className="truncate">{c}</span>
            </li>
          ))}
        </ol>
      </nav>
      <div className="bp-desk-only shrink-0">
        <div id={ACTIONS_ID} className="flex items-center gap-4" />
      </div>

      {/* Phone */}
      <div className="bp-phone-only min-w-0 flex-1 items-center gap-3">
        <span className="t-label-md text-bp-ink-secondary" aria-hidden="true">
          AI
        </span>
        {steps.length > 0 ? (
          <button type="button" onClick={() => drawer.current?.showModal()} className="flex min-w-0 items-center gap-2 text-left" aria-haspopup="dialog" aria-label={`${here} — open the journey`}>
            {active ? <span className="t-label-md text-bp-brass-text">{active.number}</span> : null}
            <span className="t-heading-sm truncate text-bp-ink-primary">{active ? active.label : here}</span>
            <Icon name="expand_more" className="text-[18px] text-bp-ink-secondary" />
          </button>
        ) : (
          <span className="t-heading-sm truncate text-bp-ink-primary">{here}</span>
        )}
      </div>
      <details className="bp-phone-only relative">
        <summary className="flex h-11 w-11 cursor-pointer list-none items-center justify-center [&::-webkit-details-marker]:hidden" aria-label="More">
          <Icon name="more_vert" className="text-bp-ink-secondary" />
        </summary>
        <div className="absolute right-0 top-full z-50 w-48 border border-bp-line-strong bg-bp-surface-raised py-2">
          <Link href="/settings" className="t-nav-item block px-4 py-3 text-bp-ink-primary">
            Settings
          </Link>
          <button type="button" onClick={openHelp} className="t-nav-item block w-full px-4 py-3 text-left text-bp-ink-primary">
            Support
          </button>
        </div>
      </details>

      {steps.length > 0 ? (
        <dialog
          ref={drawer}
          aria-labelledby="bp-step-drawer-title"
          className="bp-sheet fixed inset-x-0 bottom-0 top-auto m-0 max-h-[85vh] w-full max-w-none overflow-y-auto border-t border-bp-line-strong bg-bp-surface-base p-0 text-bp-ink-primary"
          onClick={(e) => {
            if (e.target === e.currentTarget) drawer.current?.close();
          }}
        >
          <div className="mx-auto mt-2 h-1 w-10 bg-bp-line-strong" aria-hidden="true" />
          <div className="px-6 pb-2 pt-4">
            <p className="t-label-caps text-bp-ink-tertiary">
              {ctx.project?.name}
              {ctx.project?.rev ? ` · ${revLine(ctx.project)}` : ""}
            </p>
            <h2 id="bp-step-drawer-title" className="t-heading-lg">
              {ctx.persona === "firm" ? "Firm journey" : "Your renovation"}
            </h2>
          </div>
          <nav aria-label={ctx.persona === "firm" ? "Firm journey" : "Your renovation"} className="pb-6">
            <StepList steps={steps} activeKey={activeKey} onNavigate={() => drawer.current?.close()} />
          </nav>
        </dialog>
      ) : null}
    </header>
  );
}
