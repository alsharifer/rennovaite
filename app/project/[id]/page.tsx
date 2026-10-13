import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { z } from "zod";

import { HubFiles } from "@/components/blueprint/hub/HubFiles";
import { HubScreen } from "@/components/blueprint/hub/HubScreen";
import { OwnerOverview } from "@/components/blueprint/hub/OwnerOverview";
import { ProjectActionsMenu } from "@/components/blueprint/projects/ProjectActions";
import { TopBarActions } from "@/components/blueprint/shell/TopBar";
import { ProjectShell, loadProjectRail } from "@/components/blueprint/shell/ProjectShell";
import { loadProjectAssets, toAssetLite } from "@/lib/assets/load";
import { getPageCaller } from "@/lib/auth/caller";
import { loadHubView } from "@/lib/hub/hub-view";
import { loadOverviewView } from "@/lib/hub/overview-view";
import { projectActionFacts } from "@/lib/projects/lifecycle";
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
// has authorised the caller already. K10 (§6.12): the top bar carries the
// project's "⋯" menu — Open · Rename · Archive · Delete project….
export default async function ProjectHubPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  if (!z.string().uuid().safeParse(projectId).success) notFound();
  const sb = getSupabaseAdmin() as unknown as SupabaseClient;
  const rail = await loadProjectRail(projectId);
  if (!rail) notFound();
  const assets = loadProjectAssets(projectId).then((a) => a.map(toAssetLite));
  const caller = await getPageCaller();
  const facts = caller ? await projectActionFacts(sb, projectId, caller).catch(() => null) : null;
  const actions = facts ? (
    <TopBarActions>
      <ProjectActionsMenu project={facts} size="topbar" />
    </TopBarActions>
  ) : null;
  if (rail.persona === "owner") {
    const [view, files] = await Promise.all([loadOverviewView(sb, projectId, rail), assets]);
    return (
      <ProjectShell projectId={projectId}>
        <OwnerOverview view={view} />
        {actions}
        <HubFiles assets={files} />
      </ProjectShell>
    );
  }
  const [view, files] = await Promise.all([loadHubView(sb, projectId, rail), assets]);
  return (
    <ProjectShell projectId={projectId}>
      <HubScreen view={view} />
      {actions}
      <HubFiles assets={files} />
    </ProjectShell>
  );
}
