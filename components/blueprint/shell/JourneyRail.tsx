"use client";

// =============================================================================
// components/blueprint/shell/JourneyRail.tsx — the left rail (R7 §2 9:361).
//
// Firm persona: wordmark · firm switcher · project switcher (rev + date) ·
// FIRM JOURNEY 00–08 · footer (Firm rate book, Settings, Support, Theme,
// account). Owner persona: wordmark · MY HOME switcher · YOUR RENOVATION ·
// footer (Support, Theme, Account). No project (K8, "Rail · No project" 52:278
// — the Projects home, settings, rate books): wordmark · firm switcher (firm
// users only) · "Projects" · footer; the page's own footer item is the active
// one (brass left rule + raised wash, like a step). Width / compact / phone are CSS (the
// .bp-shell rules in app/globals.css): compact hides every .bp-rail-x element
// and shows .bp-rail-c, and hover / focus expands it as an overlay.
//
// The states arrive computed (lib/journey-facts.ts → lib/journey-state.ts);
// this component only lays them out and lights the step the pathname is on.
// =============================================================================

import Link from "next/link";
import { usePathname } from "next/navigation";

import { signOut } from "@/app/_actions/sign-out";
import { SIGNED_IN_HOME } from "@/lib/auth/link-error";
import type { RailContext } from "@/lib/journey-state";

import { Icon } from "../Icon";
import { THEME_LABEL, ThemeSwitch, useThemePref } from "../ThemeSwitch";
import { revLine } from "./rev-line";
import { StepList, type RailStep } from "./StepList";

export const HELP_EVENT = "bp:help";
export const openHelp = () => window.dispatchEvent(new Event(HELP_EVENT));


/** The same page on another project, when the path is project-scoped. */
function onProject(pathname: string, from: string | null, to: string): string {
  if (from && pathname.startsWith(`/project/${from}`)) return `/project/${to}${pathname.slice(`/project/${from}`.length)}`;
  return `/project/${to}`;
}

/** A rail link; the current one wears the step's active treatment (brass 2 px left rule + raised wash). */
function railItem(active: boolean, base: string): string {
  return `${base} relative ${active ? "t-nav-item-active bg-bp-surface-raised text-bp-ink-primary before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-bp-brass" : "t-nav-item text-bp-ink-secondary hover:bg-bp-surface-raised hover:text-bp-ink-primary"}`;
}

function Switcher({ eyebrow, title, sub, icon, children }: { eyebrow: string; title: string; sub?: string; icon: string; children: React.ReactNode }) {
  return (
    <details className="border-b border-bp-line-hairline">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-6 py-3 hover:bg-bp-surface-raised [&::-webkit-details-marker]:hidden" aria-label={`${eyebrow}: ${title}${sub ? `, ${sub}` : ""} — switch`}>
        <span className="bp-rail-c w-full justify-center">
          <Icon name={icon} className="text-[18px] text-bp-ink-secondary" />
        </span>
        <span className="bp-rail-x min-w-0 flex-1">
          <span className="t-label-caps block text-bp-ink-tertiary">{eyebrow}</span>
          <span className="t-heading-sm block truncate text-bp-ink-primary">{title}</span>
          {sub ? <span className="t-label-md block text-bp-ink-tertiary">{sub}</span> : null}
        </span>
        <Icon name="unfold_more" className="bp-rail-x text-[18px] text-bp-ink-tertiary" />
      </summary>
      <div className="bp-rail-x border-t border-bp-line-hairline bg-bp-surface-raised py-2">{children}</div>
    </details>
  );
}

export function JourneyRail({ ctx, steps, activeKey }: { ctx: RailContext; steps: RailStep[]; activeKey: string | null }) {
  const pathname = usePathname();
  const theme = useThemePref();
  const firm = ctx.persona === "firm";
  const initials = (ctx.caller.email ?? "?").split("@")[0]!.replace(/[^a-z]/gi, "").slice(0, 2).toUpperCase() || "?";

  return (
    <aside className="bp-rail flex flex-col overflow-y-auto overflow-x-hidden border-r border-bp-line-strong bg-bp-surface-base" aria-label="Navigation">
      <div className="flex h-16 shrink-0 items-center border-b border-bp-line-hairline px-6">
        <Link href={ctx.project ? `/project/${ctx.project.id}` : SIGNED_IN_HOME} className="t-heading-md font-bp-mono text-bp-ink-primary" aria-label="RenovAIte — home">
          <span className="bp-rail-x">RenovAIte</span>
          <span className="bp-rail-c -ml-2">AI</span>
        </Link>
      </div>

      {firm && ctx.firm ? (
        <Switcher eyebrow="Firm" title={ctx.firm.name} icon="domain">
          <p className="t-label-caps px-4 pb-1 pt-1 text-bp-ink-tertiary">Your firms</p>
          {ctx.firms.map((f) => (
            <Link key={f.id} href={`/firms/${f.id}`} className="t-nav-item block px-4 py-2 text-bp-ink-primary hover:bg-bp-surface-sunken" aria-current={f.id === ctx.firm?.id ? "true" : undefined}>
              {f.name}
            </Link>
          ))}
        </Switcher>
      ) : null}

      {ctx.project ? (
        <Switcher eyebrow={firm ? "Project" : "My home"} title={ctx.project?.name ?? "Choose a project"} sub={ctx.project ? revLine(ctx.project) : undefined} icon="unfold_more">
          <p className="t-label-caps px-4 pb-1 pt-1 text-bp-ink-tertiary">{firm ? "Projects" : "Your homes"}</p>
          {ctx.projects.map((p) => (
            <Link key={p.id} href={onProject(pathname, ctx.project?.id ?? null, p.id)} className="block px-4 py-2 hover:bg-bp-surface-sunken" aria-current={p.id === ctx.project?.id ? "true" : undefined}>
              <span className="t-nav-item block text-bp-ink-primary">{p.name}</span>
              <span className="t-label-md block text-bp-ink-tertiary">{revLine(p)}</span>
            </Link>
          ))}
          <Link href="/project/new" className="t-nav-item mt-1 flex items-center gap-2 border-t border-bp-line-hairline px-4 py-2 text-bp-ink-secondary hover:bg-bp-surface-sunken">
            <Icon name="add" className="text-[16px]" />
            New project
          </Link>
        </Switcher>
      ) : null}

      {!ctx.project && pathname !== "/project/new" ? (
        <nav aria-label="Projects" className="flex-1 py-2">
          <Link href={SIGNED_IN_HOME} aria-label="Projects" aria-current={pathname === SIGNED_IN_HOME ? "page" : undefined} className={railItem(pathname === SIGNED_IN_HOME, "flex items-center gap-3 px-6 py-2.5")}>
            <Icon name="folder_open" className="bp-rail-c text-[18px]" />
            <span className="bp-rail-x">Projects</span>
          </Link>
        </nav>
      ) : steps.length > 0 ? (
        <nav aria-label={firm ? "Firm journey" : "Your renovation"} className="flex-1 py-2">
          <p className="t-label-caps bp-rail-x px-6 pb-2 pt-3 text-bp-ink-tertiary">{firm ? "Firm journey" : "Your renovation"}</p>
          <StepList steps={steps} activeKey={activeKey} />
        </nav>
      ) : (
        <div className="flex-1" />
      )}

      <div className="border-t border-bp-line-hairline py-2">
        {firm && ctx.firm ? (
          <Link href={`/firms/${ctx.firm.id}`} aria-current={!ctx.project && pathname.startsWith("/firms") ? "page" : undefined} className={railItem(!ctx.project && pathname.startsWith("/firms"), "flex items-center gap-3 px-6 py-2")} aria-label="Firm rate book">
            <Icon name="menu_book" className="text-[18px]" />
            <span className="bp-rail-x">Firm rate book</span>
          </Link>
        ) : null}
        <Link href="/settings" aria-current={pathname.startsWith("/settings") ? "page" : undefined} className={railItem(pathname.startsWith("/settings"), "flex items-center gap-3 px-6 py-2")} aria-label="Settings">
          <Icon name="settings" className="text-[18px]" />
          <span className="bp-rail-x">Settings</span>
        </Link>
        <button type="button" onClick={openHelp} className="t-nav-item flex w-full items-center gap-3 px-6 py-2 text-left text-bp-ink-secondary hover:bg-bp-surface-raised hover:text-bp-ink-primary" aria-label="Support — open the help drawer">
          <Icon name="help" className="text-[18px]" />
          <span className="bp-rail-x">Support</span>
        </button>
        <details>
          <summary className="t-nav-item flex cursor-pointer list-none items-center gap-3 px-6 py-2 text-bp-ink-secondary hover:bg-bp-surface-raised hover:text-bp-ink-primary [&::-webkit-details-marker]:hidden" aria-label={`Theme: ${THEME_LABEL[theme]}`}>
            <Icon name="contrast" className="text-[18px]" />
            <span className="bp-rail-x">Theme · {THEME_LABEL[theme]}</span>
          </summary>
          <div className="bp-rail-x bg-bp-surface-raised px-6 py-3">
            <ThemeSwitch />
          </div>
        </details>
      </div>

      <details className="border-t border-bp-line-hairline">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-6 py-3 hover:bg-bp-surface-raised [&::-webkit-details-marker]:hidden" aria-label={`Account: ${ctx.caller.email ?? "signed in"}`}>
          <span className="t-label-md flex h-8 w-8 shrink-0 items-center justify-center border border-bp-line-control text-bp-ink-primary">{initials}</span>
          <span className="bp-rail-x min-w-0">
            <span className="t-body-sm block truncate text-bp-ink-primary">{ctx.caller.email ?? "Signed in"}</span>
            <span className="t-label-caps block text-bp-ink-tertiary">{firm ? (ctx.firm?.admin ? "Firm admin" : "Firm member") : "Owner"}</span>
          </span>
        </summary>
        <div className="bp-rail-x border-t border-bp-line-hairline bg-bp-surface-raised py-2">
          <Link href="/settings" className="t-nav-item block px-4 py-2 text-bp-ink-primary hover:bg-bp-surface-sunken">
            Account settings
          </Link>
          <form action={signOut}>
            <button type="submit" className="t-nav-item block w-full px-4 py-2 text-left text-bp-ink-primary hover:bg-bp-surface-sunken">
              Sign out
            </button>
          </form>
        </div>
      </details>
    </aside>
  );
}
