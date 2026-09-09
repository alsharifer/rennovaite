"use client";

// =============================================================================
// components/app/boundaries.tsx — the shared route boundary set (I10).
//
// ONE implementation. Every error.tsx / not-found.tsx / loading.tsx in the app
// is a three-line file that renders one of these, because Next.js requires a
// file per segment but nobody requires twenty-five copies of the markup.
//
// Two rules the design follows:
//
//   1. A user never sees a stack trace. They see what happened, what it means
//      for their project, and one thing they can do. The `digest` is shown
//      because it is the only handle support has to find the trace in the logs
//      — it is an opaque hash, not an internal detail.
//   2. Money-path errors say the money is safe. On the BoQ or plan route the
//      first fear is "have I lost my work", and the answer is no: rendering
//      failed, nothing was written.
// =============================================================================

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

/** Errors carry a `digest` in production — the handle for finding the trace. */
export interface RouteErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Segments where a failure lands on work the user believes is saved. These get
 * an explicit reassurance rather than a generic apology.
 */
const MONEY_PATH = ["/boq", "/plan", "/accessories", "/vendors", "/timeline"];

function isMoneyPath(pathname: string): boolean {
  return MONEY_PATH.some((seg) => pathname.includes(seg));
}

export function RouteError({ error, reset }: RouteErrorProps) {
  const pathname = usePathname();

  useEffect(() => {
    // Route context is the whole point: "TypeError: undefined" tells you
    // nothing, the same line with /project/<id>/boq tells you where to look.
    console.error("[route-error]", {
      route: pathname,
      digest: error.digest ?? null,
      message: error.message,
      stack: error.stack,
    });
  }, [error, pathname]);

  const money = isMoneyPath(pathname);

  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-lg px-margin py-3xl text-center">
      <span
        className="material-symbols-outlined text-[40px] text-brass-600"
        aria-hidden="true"
      >
        error
      </span>
      <div className="flex max-w-[560px] flex-col gap-sm">
        <h1 className="font-display text-headline-md text-ink-900">
          This page didn&apos;t load.
        </h1>
        <p className="font-body text-body-md text-ink-700">
          {money
            ? "Something went wrong while building this view. Your project and its figures are unchanged — this failed on the way to the screen, not on the way to the database."
            : "Something went wrong while building this view. Nothing in your project has changed."}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-md">
        <button
          type="button"
          onClick={reset}
          className="focus-ring flex h-11 items-center rounded-lg bg-brass-600 px-lg font-body text-body-sm font-semibold text-on-primary transition-colors hover:bg-primary"
        >
          Try again
        </button>
        <Link
          href="/my-projects"
          className="focus-ring flex h-11 items-center rounded-lg border border-ink-100 bg-paper px-lg font-body text-body-sm text-ink-900 transition-colors hover:bg-canvas"
        >
          Back to your projects
        </Link>
      </div>
      {error.digest && (
        <p className="font-mono text-[12px] text-on-surface-variant">
          Reference {error.digest}
        </p>
      )}
    </main>
  );
}

export function RouteNotFound({
  title = "We couldn't find that page.",
  body = "The link may be out of date, or the project may have been removed.",
  backHref = "/my-projects",
  backLabel = "Back to your projects",
}: {
  title?: string;
  body?: string;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-lg px-margin py-3xl text-center">
      <span
        className="material-symbols-outlined text-[40px] text-brass-600"
        aria-hidden="true"
      >
        search_off
      </span>
      <div className="flex max-w-[560px] flex-col gap-sm">
        <h1 className="font-display text-headline-md text-ink-900">{title}</h1>
        <p className="font-body text-body-md text-ink-700">{body}</p>
      </div>
      <Link
        href={backHref}
        className="focus-ring flex h-11 items-center rounded-lg bg-brass-600 px-lg font-body text-body-sm font-semibold text-on-primary transition-colors hover:bg-primary"
      >
        {backLabel}
      </Link>
    </main>
  );
}

// --- skeletons ---------------------------------------------------------------
// Shaped like the page that is coming, not a spinner: a block where the heading
// will be, blocks where the cards will be. A spinner says "wait"; this says
// "here is what is arriving", which is the difference between a page that feels
// slow and one that feels broken.

function Shimmer({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-bone/60 ${className}`}
      aria-hidden="true"
    />
  );
}

export function PageSkeleton({
  /** Cards/rows to suggest below the heading. */
  rows = 3,
  /** Render the wide hero block a detail page opens with. */
  hero = false,
}: {
  rows?: number;
  hero?: boolean;
}) {
  return (
    <div
      className="flex flex-col gap-lg"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Loading…</span>
      <div className="flex flex-col gap-sm">
        <Shimmer className="h-3 w-[120px]" />
        <Shimmer className="h-8 w-[320px] max-w-full" />
      </div>
      {hero && <Shimmer className="h-[280px] w-full" />}
      <div className="flex flex-col gap-md">
        {Array.from({ length: rows }).map((_, i) => (
          <Shimmer key={i} className="h-[92px] w-full" />
        ))}
      </div>
    </div>
  );
}

/** Table-shaped skeleton — the BoQ and schedule views. */
export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div
      className="flex flex-col gap-md"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Loading…</span>
      <Shimmer className="h-8 w-[280px] max-w-full" />
      <div className="overflow-hidden rounded-md border border-ink-100">
        <Shimmer className="h-11 w-full rounded-none" />
        <div className="flex flex-col gap-px bg-ink-100">
          {Array.from({ length: rows }).map((_, i) => (
            <Shimmer key={i} className="h-12 w-full rounded-none" />
          ))}
        </div>
      </div>
    </div>
  );
}
