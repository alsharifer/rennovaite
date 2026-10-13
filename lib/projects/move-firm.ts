// =============================================================================
// lib/projects/move-firm.ts — "Move to firm…" (K11 #5): attach a project to one
// of the caller's firms, move it between firms, or make it a personal project
// again. SERVER-ONLY.
//
// The act itself is the existing PATCH /api/projects/:id { firm_id } →
// assignProjectFirm (lib/firms/store.ts), which holds the rules:
//   attach / move  the project's CREATOR (projects.created_by, 055), who is a
//                  member of the target firm — and every project member must
//                  be in that firm (the persona invariant, firm-invariant.ts);
//   detach         a member of the current firm.
// `moveFirmPreview` answers the same rules per option BEFORE the click, with
// who is outside each firm, so the dialog can say why an option is blocked.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Caller } from "@/lib/auth/caller";
import { listFirms } from "@/lib/firms/store";
import { StoreError } from "@/lib/store-error";

import { NOT_CREATOR_REASON, emailOf, membersOutsideFirm, outsideReason } from "./firm-invariant";

export interface MoveOption {
  /** null = "No firm — personal project". */
  firmId: string | null;
  name: string;
  current: boolean;
  allowed: boolean;
  reason: string | null;
  /** Project members outside this firm (their e-mail addresses — they are on the caller's project). */
  outside: string[];
}

export interface MovePreview {
  projectId: string;
  name: string;
  currentFirm: { id: string; name: string } | null;
  creator: boolean;
  options: MoveOption[];
}

export async function moveFirmPreview(db: SupabaseClient, projectId: string, caller: Caller): Promise<MovePreview> {
  const { data: p, error } = await db.from("projects").select("id, name, display_name, firm_id, created_by").eq("id", projectId).maybeSingle<{ id: string; name: string | null; display_name: string | null; firm_id: string | null; created_by: string | null }>();
  if (error) throw new Error(`project read failed: ${error.message}`);
  if (!p) throw new StoreError(404, "project_not_found", "Project not found.");
  const firms = await listFirms(db, caller);
  const { data: pm } = await db.from("project_members").select("user_id").eq("project_id", projectId);
  const projectMembers = ((pm ?? []) as { user_id: string }[]).map((r) => r.user_id);
  const creator = p.created_by === caller.id;

  // The current firm by name, whether or not the caller is in it.
  let currentFirm: MovePreview["currentFirm"] = null;
  if (p.firm_id) {
    const mine = firms.find((f) => f.id === p.firm_id);
    if (mine) currentFirm = { id: mine.id, name: mine.name };
    else {
      const { data: f } = await db.from("firms").select("id, name, display_name").eq("id", p.firm_id).maybeSingle<{ id: string; name: string; display_name: string | null }>();
      currentFirm = f ? { id: f.id, name: f.name } : { id: p.firm_id, name: "its firm" };
    }
  }
  const memberOfCurrent = !!p.firm_id && firms.some((f) => f.id === p.firm_id);

  const options: MoveOption[] = [];
  for (const f of firms) {
    const name = f.name;
    if (f.id === p.firm_id) {
      options.push({ firmId: f.id, name, current: true, allowed: false, reason: "The project is in this firm now.", outside: [] });
      continue;
    }
    const { data: fm } = await db.from("firm_members").select("user_id").eq("firm_id", f.id);
    const outsideIds = membersOutsideFirm(projectMembers, ((fm ?? []) as { user_id: string }[]).map((r) => r.user_id));
    const outside = await Promise.all(outsideIds.map((u) => emailOf(db, u)));
    const reason = !creator ? NOT_CREATOR_REASON : outside.length > 0 ? outsideReason(name, outside) : null;
    options.push({ firmId: f.id, name, current: false, allowed: !reason, reason, outside });
  }
  options.push({
    firmId: null,
    name: "No firm — personal project",
    current: !p.firm_id,
    allowed: !!p.firm_id && memberOfCurrent,
    reason: !p.firm_id ? "The project is personal now." : memberOfCurrent ? null : `Only a member of ${currentFirm?.name ?? "its firm"} can make it a personal project.`,
    outside: [],
  });

  return { projectId, name: (p.display_name || p.name || "Untitled project").trim(), currentFirm, creator, options };
}
