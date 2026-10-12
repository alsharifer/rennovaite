import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { z } from "zod";

import { HubFiles } from "@/components/blueprint/hub/HubFiles";
import { HubScreen } from "@/components/blueprint/hub/HubScreen";
import { OwnerOverview } from "@/components/blueprint/hub/OwnerOverview";
import { ProjectShell, loadProjectRail } from "@/components/blueprint/shell/ProjectShell";
import { loadProjectAssets, toAssetLite } from "@/lib/assets/load";
import { loadHubView } from "@/lib/hub/hub-view";
import { loadOverviewView } from "@/lib/hub/overview-view";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// The project's landing, by journey (the persona the rail already decided):
//   firm   K5a — 00 Project hub (R7 §3.1, Figma 11:48): the estimate and its
//          basis, Next, the revisions with their recorded causes, documents.
//   owner  K8 #2 — 00 Overview (spec §6.2, Figma 54:145): the estimate in the
//          owner's words, Your design, Next, Timeline, Documents — never a
//          firm-only item.
// The rail facts are shared with the shell (loadProjectRail is memoised per
// request). The project's files are listed below (HubFiles). The [id] layout
// has authorised the caller already.
export default async function ProjectHubPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  if (!z.string().uuid().safeParse(projectId).success) notFound();
  const sb = getSupabaseAdmin() as unknown as SupabaseClient;
  const rail = await loadProjectRail(projectId);
  if (!rail) notFound();
  const assets = loadProjectAssets(projectId).then((a) => a.map(toAssetLite));
  if (rail.persona === "owner") {
    const [view, files] = await Promise.all([loadOverviewView(sb, projectId, rail), assets]);
    return (
      <ProjectShell projectId={projectId}>
        <OwnerOverview view={view} />
        <HubFiles assets={files} />
      </ProjectShell>
    );
  }
  const [view, files] = await Promise.all([loadHubView(sb, projectId, rail), assets]);
  return (
    <ProjectShell projectId={projectId}>
      <HubScreen view={view} />
      <HubFiles assets={files} />
    </ProjectShell>
  );
}
