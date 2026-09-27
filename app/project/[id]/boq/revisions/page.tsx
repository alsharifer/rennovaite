import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { AppShell } from "@/components/app/AppShell";
import { getCaller } from "@/lib/auth/caller";
import { RevisionNotFound, buildProjectRevisionDiff, listRevisions } from "@/lib/boq/revisions";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { ApprovalsPanel } from "./_components/approvals-panel";
import { RevisionDiffView } from "./_components/revision-diff-view";

export const dynamic = "force-dynamic";

const PAGE_NAME = "BoQ revisions";

// U4 — /project/:id/boq/revisions?from=&to=
//
// Any two revisions of the project's BoQ, line by line: what moved, old → new,
// and the cause where one was recorded. The page renders the SAME diff object
// the JSON route and the PDF do (lib/boq/revisions.ts). Figures carry their
// provenance popovers from the two stored revisions. Signed-in accounts only.

export default async function RevisionsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const caller = await getCaller();
  if (!caller) {
    return (
      <AppShell pageName={PAGE_NAME}>
        <div className="mx-auto max-w-4xl">
          <section className="rounded-xl border border-ink-100 bg-paper p-lg" aria-label="Sign in required">
            <p className="label-caps text-ink-500">Signed-in accounts only</p>
            <h2 className="mt-xs font-display text-headline-md text-ink-900">Sign in to see the revision history</h2>
            <p className="mt-sm max-w-xl text-body-md text-ink-700">A revision history is a price history. Sign in with the account that works on this project.</p>
            <Link href="/auth" className="focus-ring mt-md inline-flex items-center gap-xs rounded-lg bg-brass-600 px-md py-sm text-body-sm font-semibold text-white">
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                login
              </span>
              Sign in
            </Link>
          </section>
        </div>
      </AppShell>
    );
  }

  const sb = getSupabaseAdmin() as unknown as SupabaseClient;
  const project = await sb.from("projects").select("id, firm_id").eq("id", id).maybeSingle<{ id: string; firm_id: string | null }>();
  if (!project.data) notFound();
  const revisions = await listRevisions(sb, id);
  const sp = await searchParams;
  const uuid = (v: string | undefined) => (v && z.string().uuid().safeParse(v).success ? v : null);
  const to = uuid(sp.to) ?? revisions[0]?.boq_id ?? null;
  const toIdx = revisions.findIndex((r) => r.boq_id === to);
  const from = uuid(sp.from) ?? revisions[toIdx + 1]?.boq_id ?? to;

  let result: Awaited<ReturnType<typeof buildProjectRevisionDiff>> | null = null;
  let error: string | null = null;
  if (from && to) {
    try {
      result = await buildProjectRevisionDiff(sb, id, from, to);
    } catch (e) {
      if (e instanceof RevisionNotFound) error = e.message;
      else throw e;
    }
  }

  return (
    <AppShell pageName={PAGE_NAME}>
      <div className="mx-auto max-w-[1440px]">
        <header className="mb-xl">
          <p className="label-caps text-ink-500">
            <Link href={`/project/${id}/boq`} className="focus-ring hover:text-brass-600">
              Bill of Quantities
            </Link>{" "}
            · Revisions
          </p>
          <h1 className="mb-md font-display text-headline-lg text-ink-900">Revision history &amp; approvals.</h1>
          <p className="max-w-[800px] font-body text-body-lg text-on-surface-variant">
            Every regeneration of this project&apos;s BoQ is kept. Compare any two, line by line: what moved, old to new, and the cause where one
            was recorded. Nothing is inferred — a line with no recorded cause says so.
          </p>
        </header>

        {revisions.length === 0 ? (
          <section className="rounded-xl border border-ink-100 bg-paper p-lg">
            <p className="label-caps text-ink-500">No revisions yet</p>
            <p className="mt-sm text-body-md text-ink-700">Generate a BoQ first; every generation becomes a revision here.</p>
          </section>
        ) : error ? (
          <section className="rounded-xl border border-[#9d3e1d] bg-[#FDF3EE] p-lg" role="alert">
            <p className="text-body-md text-[#9d3e1d]">{error}</p>
          </section>
        ) : result ? (
          <>
            <RevisionDiffView projectId={id} revisions={revisions} result={result} />
            <ApprovalsPanel projectId={id} revisions={revisions} fromId={result.before.boq_id} toId={result.after.boq_id} firmScoped={!!project.data.firm_id} />
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
