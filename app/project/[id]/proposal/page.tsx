import type { SupabaseClient } from "@supabase/supabase-js";
import type { Metadata } from "next";

import { Button } from "@/components/blueprint/Button";
import { StateBlock } from "@/components/blueprint/StateBlock";
import { loadProposalGate } from "@/lib/documents/proposal-gate";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const metadata: Metadata = { title: "Proposal · RenovAIte" };
export const dynamic = "force-dynamic";

// K2 — firm step 08 Proposal. The gate speaks here (spec §3.7): when the
// reference-basis gate refuses, the page is that refusal and what unlocks it —
// the SAME verdict the export runs (loadProposalGate, L4). When it passes,
// the proposal is generated with the document pack until K4 builds the setup
// and preview on this page.
export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await loadProposalGate(getSupabaseAdmin() as unknown as SupabaseClient, id);
  const basis = gate.boq?.basis ?? null;

  return (
    <div className="mx-auto max-w-[880px] p-4 md:p-12">
      <p className="t-label-caps text-bp-brass-text">08 · Proposal</p>
      <h1 className="t-heading-lg mb-6">Client proposal</h1>
      {gate.verdict.ok ? (
        <StateBlock kind="empty" icon="description" title="Ready to generate" actions={<Button kind="primary" href={`/project/${id}/drawings`}>Open Documents</Button>}>
          The proposal goes out with the document pack: open Documents, include the client proposal and export. Setup and a client preview arrive on this page next.
        </StateBlock>
      ) : !gate.firm ? (
        <StateBlock kind="gate" title="Client proposal locked" options={["Attach your firm to this project on the project hub"]} actions={<Button kind="secondary" tone="inverse" href={`/project/${id}`}>Open the project hub</Button>}>
          A client proposal is the firm&rsquo;s document — this project has no firm attached.
        </StateBlock>
      ) : !gate.boq ? (
        <StateBlock kind="gate" title="Client proposal locked" options={["Generate the BoQ from the plan"]} actions={<Button kind="secondary" tone="inverse" href={`/project/${id}/boq`}>Open BoQ</Button>}>
          There is no priced BoQ to propose yet.
        </StateBlock>
      ) : (
        <StateBlock
          kind="gate"
          title="Client proposal locked"
          options={["Review your rate book and mark it reviewed", "Or accept the market basis for this revision — recorded with your name"]}
          actions={
            <>
              <Button kind="secondary" tone="inverse" href={`/project/${id}/rates`}>Review rates</Button>
              <Button kind="quiet" tone="inverse" href={`/project/${id}/boq#reference-basis`}>
                Accept market basis
              </Button>
            </>
          }
        >
          {basis ? `${basis.reference_lines} of ${basis.total_lines} lines are priced from the market reference, not your book. ` : ""}A client document can&rsquo;t be priced from market reference without your say-so. One of these unlocks it:
        </StateBlock>
      )}
    </div>
  );
}
