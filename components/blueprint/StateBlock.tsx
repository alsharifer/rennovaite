// =============================================================================
// components/blueprint/StateBlock.tsx — the five designed states (R7 §2, 18:355).
//
//   empty    dashed hairline · what will happen · one action
//   loading  skeleton rows INSIDE the shell (aria-busy + "Loading …" for SR)
//   error    inverse block · cause · what's safe · retry · ref code;
//            role="alert" only when it appears after a user action (§4.2 #13)
//   gate     inverse block · lock · the unlock options as a checklist; a
//            labelled REGION, never an alert, on page load
//   pending  placeholder · what is running · an honest duration
//
// No red / amber / green anywhere: errors and refusals are the inverse ink
// block (`.surface-inverse` swaps the focus ring for the inverse one).
// =============================================================================

import { useId, type ReactNode } from "react";

import { Icon } from "./Icon";

export type StateKind = "empty" | "loading" | "error" | "gate" | "pending";

interface Common {
  /** Heading: "No BoQ yet", "Couldn't load the BoQ", "Client proposal locked". */
  title: string;
  /** One or two sentences: what will happen / the cause and what is safe / why. */
  children?: ReactNode;
  /** Buttons (one action for empty; retry for error; unlock actions for gate). */
  actions?: ReactNode;
  className?: string;
}

export type StateBlockProps =
  | (Common & { kind: "empty"; icon?: string })
  | (Common & { kind: "loading"; rows?: number; columns?: number })
  | (Common & { kind: "error"; refCode?: string; afterUserAction?: boolean })
  | (Common & { kind: "gate"; options?: string[] })
  | (Common & { kind: "pending"; duration?: string; placeholder?: boolean });

export function StateBlock(props: StateBlockProps) {
  const headingId = useId();
  const cls = props.className ? ` ${props.className}` : "";

  if (props.kind === "loading") {
    return (
      <div aria-busy="true" aria-labelledby={headingId} className={`py-2${cls}`} data-state-block="loading">
        <p id={headingId} className="t-label-caps mb-3 text-bp-ink-tertiary">
          {props.title}
        </p>
        <SkeletonRows rows={props.rows ?? 4} columns={props.columns ?? 5} />
      </div>
    );
  }

  if (props.kind === "error" || props.kind === "gate") {
    const isGate = props.kind === "gate";
    return (
      <section
        aria-labelledby={headingId}
        {...(props.kind === "error" && props.afterUserAction ? { role: "alert" } : {})}
        className={`surface-inverse bg-bp-alert-surface p-6 text-bp-alert-ink${cls}`}
        data-state-block={props.kind}
      >
        <h2 id={headingId} className="t-label-caps mb-3 flex items-center gap-2">
          <Icon name={isGate ? "lock" : "error"} className="text-[18px]" />
          {props.title}
        </h2>
        {props.children ? <div className="t-body-sm max-w-[60ch]">{props.children}</div> : null}
        {isGate && props.options?.length ? (
          <ul className="t-body-sm mt-3 space-y-2" aria-label="Any one of these unlocks it">
            {props.options.map((o) => (
              <li key={o} className="flex items-start gap-2">
                <Icon name="radio_button_unchecked" className="mt-0.5 text-[16px]" />
                {o}
              </li>
            ))}
          </ul>
        ) : null}
        {props.actions || (props.kind === "error" && props.refCode) ? (
          <div className="mt-4 flex flex-wrap items-center gap-4">
            {props.actions}
            {props.kind === "error" && props.refCode ? <span className="t-label-md">ref {props.refCode}</span> : null}
          </div>
        ) : null}
      </section>
    );
  }

  if (props.kind === "pending") {
    return (
      <section aria-labelledby={headingId} aria-busy="true" className={`border border-bp-line-hairline p-6${cls}`} data-state-block="pending">
        {props.placeholder !== false ? <div className="mb-4 aspect-[16/9] w-full bg-bp-surface-sunken" aria-hidden="true" /> : null}
        <h2 id={headingId} className="t-label-caps flex items-center gap-2 text-bp-ink-secondary">
          <Icon name="progress_activity" className="animate-spin text-[16px] motion-reduce:animate-none" />
          {props.title}
        </h2>
        {props.children ? <div className="t-body-sm mt-2 text-bp-ink-secondary">{props.children}</div> : null}
        {props.duration ? <p className="t-label-md mt-1 text-bp-ink-tertiary">{props.duration}</p> : null}
      </section>
    );
  }

  // empty
  return (
    <section aria-labelledby={headingId} className={`border border-dashed border-bp-line-strong p-6${cls}`} data-state-block="empty">
      {props.icon ? <Icon name={props.icon} className="mb-3 text-bp-ink-secondary" /> : null}
      <h2 id={headingId} className="t-heading-sm text-bp-ink-primary">
        {props.title}
      </h2>
      {props.children ? <div className="t-body-sm mt-2 max-w-[60ch] text-bp-ink-secondary">{props.children}</div> : null}
      {props.actions ? <div className="mt-4 flex flex-wrap items-center gap-4">{props.actions}</div> : null}
    </section>
  );
}

/** Skeleton rows (18:276): decorative — the container carries aria-busy and the words. */
export function SkeletonRows({ rows = 4, columns = 5 }: { rows?: number; columns?: number }) {
  const widths = ["w-12", "w-28", "w-16", "w-20", "w-24", "w-14"];
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-6 border-b border-bp-line-hairline py-3">
          {Array.from({ length: columns }, (_, c) => (
            <span key={c} className={`h-2.5 ${widths[c % widths.length]} bg-bp-surface-sunken bp-pulse`} />
          ))}
        </div>
      ))}
    </div>
  );
}
