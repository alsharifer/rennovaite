// =============================================================================
// components/blueprint/shell/ProjectShell.tsx — the Blueprint chrome for a
// project page (server). Used by the layouts of the redesigned segments (boq,
// plan, drawings, rates, proposal) so their loading.tsx / error.tsx render
// INSIDE the shell — the rail and top bar stay while the page loads (spec §2).
//
// app/project/[id]/layout.tsx has already authorised the caller as a member;
// this reads the rail's facts (lib/journey-facts.ts) and frames the page.
// =============================================================================

import type { ReactNode } from "react";

import { getPageCaller } from "@/lib/auth/caller";
import { journeyFlagsFromEnv } from "@/lib/journey";
import { loadRailContext, loadRailContextWithoutProject } from "@/lib/journey-facts";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { SupabaseClient } from "@supabase/supabase-js";

import { ShellFrame } from "./ShellFrame";

const db = () => getSupabaseAdmin() as unknown as SupabaseClient;

export async function ProjectShell({ projectId, content = "atelier", children }: { projectId: string; content?: "atelier" | "blueprint"; children: ReactNode }) {
  const caller = await getPageCaller();
  // The [id] layout redirected a signed-out visit already; this is the backstop.
  const ctx = caller ? await loadRailContext(db(), projectId, caller) : null;
  if (!ctx) return <>{children}</>;
  return (
    <ShellFrame ctx={ctx} flags={journeyFlagsFromEnv()} content={content}>
      {children}
    </ShellFrame>
  );
}

/** Settings, the firm book and quote review: the chrome without a project. */
export async function AccountShell({ firmId, content = "atelier", children }: { firmId?: string; content?: "atelier" | "blueprint"; children: ReactNode }) {
  const caller = await getPageCaller();
  if (!caller) return <>{children}</>;
  const ctx = await loadRailContextWithoutProject(db(), caller, { firmId });
  return (
    <ShellFrame ctx={ctx} flags={journeyFlagsFromEnv()} content={content}>
      {children}
    </ShellFrame>
  );
}
