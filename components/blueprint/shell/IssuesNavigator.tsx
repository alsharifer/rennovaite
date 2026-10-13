"use client";

// =============================================================================
// components/blueprint/shell/IssuesNavigator.tsx — "⚑ N TO FIX" (K11 #3,
// spec §7.1, Figma 80:49).
//
// A top-bar button (ink outline, label caps) that opens a 400 px popover: the
// groups with their counts (lib/boq/issues.ts — from the gates and the rail's
// own StepStatus, never a rule of its own), one row per issue (REF · title ·
// action ›). A row that names a line hands it to the page (`onRow`: scroll,
// select, open the inspector on the right action); a row with a fix is a link.
// Footer: "Show only these lines" (when the page can filter) and "Next issue
// J". Hidden at N = 0. Escape closes and returns focus to the button.
// =============================================================================

import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import type { IssueList, IssueRow } from "@/lib/boq/issues";

import { Icon } from "../Icon";

export interface IssuesNavigatorProps {
  issues: IssueList;
  /** A row that names a line. */
  onRow?: (row: IssueRow) => void;
  /** K11: a row with its own actions (an unmatched price: Remove / Re-apply to…). */
  onAction?: (row: IssueRow, action: "release" | "retarget") => void;
  /** "Show only these lines" — present when the page can filter. */
  onlyThese?: { on: boolean; set: (on: boolean) => void };
  /** "Next issue J" — present when the page cycles issue lines. */
  onNext?: () => void;
  /** The revision the list is about ("rev 4"), for the header. */
  context?: string | null;
}

export function IssuesNavigator({ issues, onRow, onAction, onlyThese, onNext, context }: IssuesNavigatorProps) {
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const r = button.current.getBoundingClientRect();
    setAlignRight(r.left + 400 > window.innerWidth - 16);
    panel.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  if (issues.count === 0) return null;
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) requestAnimationFrame(() => button.current?.focus());
  };
  const label = `${issues.count} to fix`;

  return (
    <div className="relative" data-issues-navigator="" data-issue-count={issues.count}>
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-panel` : undefined}
        onClick={() => setOpen((o) => !o)}
        className="t-label-caps inline-flex h-9 items-center gap-2 rounded-none border border-bp-ink-primary px-3 text-bp-ink-primary hover:bg-bp-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring"
        data-testid="issues-button"
      >
        <Icon name="flag" size={18} />
        {label.toUpperCase()}
        <Icon name="expand_more" size={18} />
      </button>
      {open ? (
        <div
          ref={panel}
          id={`${id}-panel`}
          role="dialog"
          aria-labelledby={`${id}-title`}
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              close();
            }
          }}
          className={`absolute top-full z-50 mt-2 w-[400px] max-w-[calc(100vw-32px)] border border-bp-line-strong bg-bp-surface-raised text-bp-ink-primary outline-none ${alignRight ? "right-0" : "left-0"}`}
          data-issues-panel=""
        >
          <div className="flex items-baseline justify-between gap-3 border-b border-bp-line-hairline px-4 py-3">
            <h2 id={`${id}-title`} className="t-nav-item-active">
              {issues.count} thing{issues.count === 1 ? "" : "s"} need{issues.count === 1 ? "s" : ""} attention
            </h2>
            {context ? <span className="t-label-md font-bp-mono text-bp-ink-tertiary">{context}</span> : null}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {issues.groups.map((g) => (
              <section key={g.key} aria-labelledby={`${id}-${g.key}`} className="border-b border-bp-line-hairline py-2" data-issue-group={g.key}>
                <h3 id={`${id}-${g.key}`} className="t-label-caps flex justify-between gap-3 px-4 py-2 text-bp-ink-tertiary">
                  <span>{g.title}</span>
                  <span className="font-bp-mono">{g.count}</span>
                </h3>
                <ul>
                  {g.rows.map((r) => {
                    const inner = (
                      <>
                        <span className="t-label-md w-16 shrink-0 font-bp-mono text-bp-ink-tertiary">{r.ref ?? ""}</span>
                        <span className="min-w-0 flex-1">
                          <span className="t-body-sm block text-bp-ink-primary">{r.title}</span>
                          {r.detail ? <span className="t-label-md block text-bp-ink-tertiary">{r.detail}</span> : null}
                        </span>
                        <span className="t-nav-item-active flex shrink-0 items-center gap-1 text-bp-ink-primary">
                          {r.action}
                          <Icon name="chevron_right" size={18} />
                        </span>
                      </>
                    );
                    const cls = "flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-bp-surface-sunken focus-visible:bg-bp-surface-sunken focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-bp-focus-ring";
                    if (r.actions && onAction) {
                      return (
                        <li key={r.id} className="px-4 py-2.5" data-issue-row={r.id}>
                          <span className="t-body-sm block text-bp-ink-primary">{r.title}</span>
                          {r.detail ? <span className="t-label-md block font-bp-mono text-bp-ink-tertiary">{r.detail}</span> : null}
                          <span className="mt-2 flex gap-5">
                            {r.actions.map((a) => (
                              <button
                                key={a.key}
                                type="button"
                                onClick={() => {
                                  close(false);
                                  onAction(r, a.key);
                                }}
                                className="t-nav-item-active text-bp-ink-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring"
                                data-issue-action={a.key}
                              >
                                {a.label}
                              </button>
                            ))}
                          </span>
                        </li>
                      );
                    }
                    return (
                      <li key={r.id}>
                        {r.lineKey && onRow ? (
                          <button
                            type="button"
                            className={cls}
                            onClick={() => {
                              close(false);
                              onRow(r);
                            }}
                            data-issue-row={r.id}
                          >
                            {inner}
                          </button>
                        ) : r.href ? (
                          <Link href={r.href} className={cls} onClick={() => close(false)} data-issue-row={r.id}>
                            {inner}
                          </Link>
                        ) : (
                          <div className={cls} data-issue-row={r.id}>
                            {inner}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
          {onlyThese || onNext ? (
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              {onlyThese && issues.lineKeys.length > 0 ? (
                <label className="t-body-sm flex cursor-pointer items-center gap-2 text-bp-ink-primary">
                  <input type="checkbox" checked={onlyThese.on} onChange={(e) => onlyThese.set(e.target.checked)} className="size-4 accent-bp-ink-primary" data-show-only="" />
                  Show only these lines
                </label>
              ) : (
                <span />
              )}
              {onNext && issues.lineKeys.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    close(false);
                    onNext();
                  }}
                  className="t-label-caps flex items-center gap-2 text-bp-ink-secondary hover:text-bp-ink-primary"
                  aria-keyshortcuts="J"
                >
                  Next issue <kbd className="border border-bp-line-control px-1.5 font-bp-mono">J</kbd>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
