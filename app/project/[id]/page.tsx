import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { z } from "zod";

import { HubFiles } from "@/components/blueprint/hub/HubFiles";
import { HubScreen } from "@/components/blueprint/hub/HubScreen";
import { ProjectShell, loadProjectRail } from "@/components/blueprint/shell/ProjectShell";
import { loadProjectAssets, toAssetLite } from "@/lib/assets/load";
import { loadHubView } from "@/lib/hub/hub-view";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// K5a — 00 Project hub (R7 §3.1, Figma 11:48): the estimate and the basis it
// adds up from, Next from the rail's own state, the revisions with their
// recorded causes, and the documents with what each gate answers. Blueprint
// for both journeys (the owner's Next is the owner's steps); the rail facts
// are shared with the shell (loadProjectRail is memoised per request). The
// project's files are listed below (HubFiles). The [id] layout has authorised
// the caller already.
export default async function ProjectHubPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  if (!z.string().uuid().safeParse(projectId).success) notFound();
  const sb = getSupabaseAdmin() as unknown as SupabaseClient;
  const rail = await loadProjectRail(projectId);
  if (!rail) notFound();
  const [view, assets] = await Promise.all([loadHubView(sb, projectId, rail), loadProjectAssets(projectId).then((a) => a.map(toAssetLite))]);
  return (
    <ProjectShell projectId={projectId}>
      <HubScreen view={view} />
      <HubFiles assets={assets} />
    </ProjectShell>
  );
}
