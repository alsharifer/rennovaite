// =============================================================================
// components/blueprint/shell/ProjectShell.tsx — the Blueprint chrome for a
// project page (server). Used by the layouts of the redesigned segments (boq,
// plan, drawings, rates, proposal) so their loading.tsx / error.tsx render
// INSIDE the shell — the rail and top bar stay while the page loads (spec §2).
//
// app/project/[id]/layout.tsx has already authorised the caller as a member;
// this reads the rail's facts (lib/journey-facts.ts) and frames the page.
// =============================================================================

import { cache, type ReactNode } from "react";

import { getPageCaller } from "@/lib/auth/caller";
import { journeyFlagsFromEnv } from "@/lib/journey";
import { loadRailContext, loadRailContextWithoutProject } from "@/lib/journey-facts";
import type { RailContext } from "@/lib/journey-state";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { SupabaseClient } from "@supabase/supabase-js";

import { ShellFrame } from "./ShellFrame";

const db = () => getSupabaseAdmin() as unknown as SupabaseClient;

/**
 * The rail's facts for this request's caller on a project — memoised per
 * request (React cache), so a page that reads the same state (the hub's
 * "Next", K5a) shares ONE load with its shell instead of repeating every gate.
 */
export const loadProjectRail = cache(async (projectId: string): Promise<RailContext | null> => {
  const caller = await getPageCaller();
  // The [id] layout redirected a signed-out visit already; this is the backstop.
  return caller ? loadRailContext(db(), projectId, caller) : null;
});

export async function ProjectShell({ projectId, children }: { projectId: string; children: ReactNode }) {
  const ctx = await loadProjectRail(projectId);
  if (!ctx) return <>{children}</>;
  return (
    <ShellFrame ctx={ctx} flags={journeyFlagsFromEnv()}>
      {children}
    </ShellFrame>
  );
}

/** Settings, the firm book and quote review: the chrome without a project. */
/** `title` names a page the pathname cannot (a not-found page, K8 #11). */
export async function AccountShell({ firmId, skin, title, children }: { firmId?: string; skin?: "warm"; title?: string; children: ReactNode }) {
  const caller = await getPageCaller();
  if (!caller) return <>{children}</>;
  const ctx = await loadRailContextWithoutProject(db(), caller, { firmId });
  return (
    <ShellFrame ctx={ctx} flags={journeyFlagsFromEnv()} skin={skin} title={title}>
      {children}
    </ShellFrame>
  );
}
