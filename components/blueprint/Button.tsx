// =============================================================================
// components/blueprint/Button.tsx — Primary / Secondary / Quiet (R7 §2, 10:230).
//
// 36 px tall (44 px hit area on a coarse pointer), zero radius. Primary and
// Secondary carry 16 px side padding; Quiet sits flush with the text column. One Primary per
// view. Primary is an ink fill — brass never fills an area; focus is the brass
// ring from tokens.css.
//
// DISABLED ALWAYS CARRIES A VISIBLE REASON (spec §4.2 #6): it renders
// aria-disabled + aria-describedby → the reason, and stays focusable so a
// keyboard user can reach it and hear why. Clicks are swallowed while disabled.
// Renders a Next <Link> when given `href`.
// =============================================================================

import Link from "next/link";
import type { ReactNode } from "react";

export type ButtonKind = "primary" | "secondary" | "quiet";

const BASE =
  "relative inline-flex h-9 items-center justify-center gap-2 rounded-none t-nav-item-active whitespace-nowrap select-none " +
  // 44 px hit area on touch without changing the visual size.
  "pointer-coarse:before:absolute pointer-coarse:before:-inset-y-1 pointer-coarse:before:-inset-x-0 pointer-coarse:before:content-['']";

// On the inverse block (error / gate refusal) the same three kinds, in its ink.
const INVERSE: Record<ButtonKind, { on: string; off: string }> = {
  primary: { on: "px-4 bg-bp-alert-ink text-bp-alert-surface hover:opacity-90", off: "px-4 border border-bp-alert-ink/40 text-bp-alert-ink/60 cursor-not-allowed" },
  secondary: { on: "px-4 border border-bp-alert-ink text-bp-alert-ink hover:bg-bp-alert-ink/10", off: "px-4 border border-bp-alert-ink/40 text-bp-alert-ink/60 cursor-not-allowed" },
  quiet: { on: "px-0 text-bp-alert-ink hover:opacity-80", off: "px-0 text-bp-alert-ink/60 cursor-not-allowed" },
};

const KIND: Record<ButtonKind, { on: string; off: string }> = {
  primary: {
    on: "px-4 bg-bp-ink-primary text-bp-ink-on-inverse hover:bg-bp-ink-secondary",
    off: "px-4 bg-bp-surface-sunken text-bp-ink-tertiary cursor-not-allowed",
  },
  secondary: {
    on: "px-4 border border-bp-line-control bg-transparent text-bp-ink-primary hover:bg-bp-surface-sunken",
    off: "px-4 border border-bp-line-hairline bg-transparent text-bp-ink-tertiary cursor-not-allowed",
  },
  quiet: {
    on: "px-0 text-bp-ink-primary hover:text-bp-ink-secondary",
    off: "px-0 text-bp-ink-tertiary cursor-not-allowed",
  },
};

export interface ButtonProps {
  kind?: ButtonKind;
  /** "inverse" inside an error / gate-refusal block (.surface-inverse). */
  tone?: "default" | "inverse";
  children: ReactNode;
  href?: string;
  onClick?: () => void;
  type?: "button" | "submit";
  /** Disabled requires the reason, shown by the caller with this id (or rendered here when `showReason`). */
  disabled?: { reason: string; reasonId: string; showReason?: boolean } | false;
  className?: string;
  "aria-label"?: string;
  /** data-testid for page checks. */
  testId?: string;
}

export function Button({ kind = "secondary", tone = "default", children, href, onClick, type = "button", disabled = false, className, testId, ...rest }: ButtonProps) {
  const off = !!disabled;
  const set = tone === "inverse" ? INVERSE : KIND;
  const cls = `${BASE} ${off ? set[kind].off : set[kind].on}${className ? ` ${className}` : ""}`;
  const a11y = off ? { "aria-disabled": true as const, "aria-describedby": disabled.reasonId } : {};
  const reason = off && disabled.showReason ? (
    <span id={disabled.reasonId} className="t-label-md text-bp-ink-tertiary">
      {disabled.reason}
    </span>
  ) : null;

  const el =
    href && !off ? (
      <Link href={href} className={cls} aria-label={rest["aria-label"]} data-testid={testId}>
        {children}
      </Link>
    ) : (
      <button type={type} className={cls} onClick={off ? undefined : onClick} aria-label={rest["aria-label"]} data-testid={testId} {...a11y}>
        {children}
      </button>
    );
  return reason ? (
    <span className="inline-flex items-center gap-3">
      {el}
      {reason}
    </span>
  ) : (
    el
  );
}
