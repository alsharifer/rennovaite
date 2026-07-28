import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app/AppShell";
import { generateDrawingSet } from "@/lib/drawings/export";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const PAGE_NAME = "Drawings";

/** Make a fixed-size (mm) sheet SVG scale responsively inside its frame. */
function toDisplaySvg(svg: string): string {
  return svg.replace(
    /width="420mm"\s+height="297mm"/,
    'width="100%" height="auto" style="display:block"',
  );
}

const SHEET_BLURB: Record<string, string> = {
  as_built: "Dimensioned as-built plan derived from the parsed geometry.",
  proposed: "Proposed plan with demolition (terracotta) and new-work marking.",
  finish_schedule: "Room-by-room floor / wall / ceiling finishes from the locked style.",
};

export default async function DrawingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Whole surface is gated by DRAWINGS_ENABLED — invisible (404) when off.
  if (process.env.DRAWINGS_ENABLED !== "true") notFound();

  const { id: projectId } = await params;

  let set: Awaited<ReturnType<typeof generateDrawingSet>> | null = null;
  let error: string | null = null;
  try {
    set = await generateDrawingSet(projectId);
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to generate drawings.";
  }

  return (
    <AppShell pageName={PAGE_NAME}>
      <div className="mx-auto max-w-[1440px] pb-24">
        <header className="mb-xl">
          <p className="label-caps mb-md text-brass-600">Drawing set · A3 · 1:100</p>
          <h1 className="mb-md font-display text-headline-lg text-ink-900">
            Auto-generated drawings
          </h1>
          <p className="max-w-[720px] font-body text-body-lg text-on-surface-variant">
            Deterministic, dimensioned drawings derived from your plan geometry —
            no AI in this output. Download each sheet as a print-ready A3 PDF.
          </p>
        </header>

        {error || !set ? (
          <div className="rounded-md border border-ink-100 bg-paper p-lg">
            <p className="text-body-md text-error">
              {error ?? "No drawings available."}
            </p>
            <Link
              href={`/project/${projectId}/plan`}
              className="focus-ring mt-md inline-flex text-body-sm font-semibold text-brass-600"
            >
              Back to plan
            </Link>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-gutter lg:grid-cols-3">
              {set.sheets.map((sheet) => (
                <article
                  key={sheet.kind}
                  className="flex flex-col rounded-xl border border-ink-100 bg-paper p-lg"
                >
                  <div className="mb-md flex items-baseline justify-between">
                    <h2 className="font-display text-headline-md text-ink-900">
                      {sheet.title}
                    </h2>
                    <span className="font-mono text-[12px] text-ink-500">
                      {sheet.sheetNumber}
                    </span>
                  </div>
                  <div
                    className="matte-image mb-md"
                    // Deterministic, server-generated SVG (no user input) — safe to inline.
                    dangerouslySetInnerHTML={{ __html: toDisplaySvg(sheet.svg) }}
                  />
                  <p className="mb-md flex-1 font-body text-body-sm text-on-surface-variant">
                    {SHEET_BLURB[sheet.kind]}
                  </p>
                  <a
                    href={`/api/projects/${projectId}/drawings?format=pdf&sheet=${sheet.kind}`}
                    className="focus-ring inline-flex h-10 items-center justify-center gap-sm self-start rounded-lg border border-ink-100 bg-paper px-lg font-body-sm text-body-sm font-semibold text-ink-900 transition-colors hover:bg-surface-container"
                  >
                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                      download
                    </span>
                    Download PDF
                  </a>
                </article>
              ))}
            </div>

            {set.derivedNotes.length > 0 && (
              <section className="mt-xl rounded-xl border border-ink-100 bg-paper p-lg">
                <p className="label-caps mb-md text-ink-500">
                  Confidence — derived values
                </p>
                <ul className="flex flex-col gap-xs">
                  {set.derivedNotes.map((n, i) => (
                    <li key={i} className="flex gap-sm font-body text-body-sm text-on-surface-variant">
                      <span className="text-brass-600" aria-hidden="true">•</span>
                      {n}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
