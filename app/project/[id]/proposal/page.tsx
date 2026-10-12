import type { SupabaseClient } from "@supabase/supabase-js";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { ProposalScreen } from "@/components/blueprint/proposal/ProposalScreen";
import { loadProposalView } from "@/lib/documents/proposal-view";
import { stepEyebrow } from "@/lib/journey-eyebrow";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const metadata: Metadata = { title: "Proposal · RenovAIte" };
export const dynamic = "force-dynamic";

// K2 / K4 — firm step 08 Proposal (R7 §3.7, Figma 23:689). The gate speaks
// first (the SAME verdict the export runs — loadProposalGate, L4); the setup
// (053) and the preview of what the client receives follow, gate open or not,
// so a firm can prepare the proposal before it decides how to unlock it. The
// proposal itself is generated only through the gated export on 06 Documents.
export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const view = await loadProposalView(getSupabaseAdmin() as unknown as SupabaseClient, id);
  const eyebrow = stepEyebrow(view.firm ? "firm" : "owner", "proposal", null, "Proposal");
  return <ProposalScreen view={view} eyebrow={eyebrow} />;
}
