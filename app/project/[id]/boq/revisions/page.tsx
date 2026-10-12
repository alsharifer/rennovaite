import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { z } from "zod";

import { Button } from "@/components/blueprint/Button";
import { RevisionsScreen } from "@/components/blueprint/revisions/RevisionsScreen";
import { StateBlock } from "@/components/blueprint/StateBlock";
import { getPageCaller } from "@/lib/auth/caller";
import { RevisionNotFound, buildProjectRevisionDiff, listRevisions } from "@/lib/boq/revisions";
import { buildRevisionsView } from "@/lib/boq/revisions-view";
import { FIRM_STEPS } from "@/lib/journey";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// U4 / K4 — 07 Revisions & Approval (R7 §3.5, Figma 21:450):
// /project/:id/boq/revisions?from=&to=
//
// Any two revisions of the project's BoQ, line by line: what moved, old → new,
// and the cause where one was recorded. The page renders the SAME diff object
// the JSON route and the PDF do (lib/boq/revisions.ts), shaped for the screen
// by lib/boq/revisions-view.ts. Project members only (proxy + layout).

type RevisionsProps = { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> };

const Frame = ({ children }: { children: React.ReactNode }) => <div className="mx-auto max-w-[720px] px-6 py-10">{children}</div>;

export default async function RevisionsPage({ params, searchParams }: RevisionsProps) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const caller = await getPageCaller();
  if (!caller) {
    return (
      <Frame>
        <StateBlock kind="gate" title="Sign in to see the revision history" actions={<Button kind="primary" tone="inverse" href={`/auth?next=/project/${id}/boq/revisions`}>Sign in</Button>}>
          A revision history is a price history. Sign in with the account that works on this project.
        </StateBlock>
      </Frame>
    );
  }

  const sb = getSupabaseAdmin() as unknown as SupabaseClient;
  const [project, revisions, sp] = await Promise.all([
    sb.from("projects").select("id, firm_id").eq("id", id).maybeSingle<{ id: string; firm_id: string | null }>(),
    listRevisions(sb, id),
    searchParams,
  ]);
  if (!project.data) notFound();
  const firmId = project.data.firm_id;

  if (revisions.length === 0) {
    return (
      <Frame>
        <StateBlock kind="empty" icon="history" title="No revisions yet" actions={<Button kind="primary" href={`/project/${id}/boq`}>Go to BoQ &amp; Review</Button>}>
          Every generation of the BoQ becomes a revision here, kept for good. Generate the first one on the BoQ page.
        </StateBlock>
      </Frame>
    );
  }

  const uuid = (v: string | undefined) => (v && z.string().uuid().safeParse(v).success ? v : null);
  const to = uuid(sp.to) ?? revisions[0]!.boq_id;
  const toIdx = revisions.findIndex((r) => r.boq_id === to);
  const from = uuid(sp.from) ?? revisions[toIdx + 1]?.boq_id ?? to;

  // Who can record an approval: on a firm project, its members (U4's
  // recordApproval answers 403 otherwise); without a firm, any project member.
  const [diff, member] = await Promise.all([
    buildProjectRevisionDiff(sb, id, from, to).catch((e: unknown) => (e instanceof RevisionNotFound ? e : Promise.reject(e))),
    firmId ? sb.from("firm_members").select("user_id").eq("firm_id", firmId).eq("user_id", caller.id).maybeSingle() : Promise.resolve({ data: { user_id: caller.id } }),
  ]);
  if (diff instanceof RevisionNotFound) {
    return (
      <Frame>
        <StateBlock kind="error" title="That revision is not on this project" actions={<Button kind="primary" tone="inverse" href={`/project/${id}/boq/revisions`}>Compare the latest two</Button>}>
          {diff.message} Nothing was changed. The latest two revisions are always comparable.
        </StateBlock>
      </Frame>
    );
  }
  const canApprove = !!member.data;
  // The step number comes from the journey, never a literal: a member of the
  // project's firm works the firm journey (step 07); for everyone else this is
  // a surface of the owner's Costing & BoQ step, so it carries no number.
  const step = firmId && canApprove ? FIRM_STEPS.find((s) => s.key === "revisions") : null;
  const eyebrow = step ? `${step.number} · ${step.label.toUpperCase()}` : "REVISIONS & APPROVAL";
  return <RevisionsScreen view={buildRevisionsView(id, revisions, diff)} eyebrow={eyebrow} canApprove={canApprove} approveBlock={canApprove ? null : "Only a member of this project's firm can record an approval."} />;
}
