// =============================================================================
// lib/projects/firm-invariant.ts — the persona invariant (K2 review, 13 Oct).
//
// On a firm-attached project, EVERY project member is a member of that firm.
// The rail's persona rule ("a member of the project's firm works the firm
// journey") is only coherent if nobody on a firm project is outside the firm —
// otherwise two people on one project see two different journeys, and one of
// them is looking at the firm's rates without being in the firm.
//
// Enforced where the state can be broken — and nowhere else needs to:
//   addProjectMember   (lib/projects/access.ts)  refuses a non-firm member
//   assignProjectFirm  (lib/firms/store.ts)      refuses a firm the project's
//                                                members are not all in
// No code path removes a firm member today; if one is added it must check this
// too. Operator scripts (scripts/project-member-add.mjs) apply the same rule.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

/** K11 #5: attaching (or moving) a project to a firm is its creator's act. */
export const NOT_CREATOR_REASON = "Only the person who created this project can move it to a firm.";

/** "2 people on this project are not in Studio X: a@x.test, b@y.test. Add them to the firm first …" */
export function outsideReason(firmName: string, outside: readonly string[]): string {
  const n = outside.length;
  return `${n === 1 ? "1 person" : `${n} people`} on this project ${n === 1 ? "is" : "are"} not in ${firmName}: ${outside.join(", ")}. Add them to the firm first — on a firm project everyone works the firm's journey.`;
}

/** A member's e-mail, as the refusal lists them (they share the caller's project). */
export async function emailOf(db: SupabaseClient, userId: string): Promise<string> {
  try {
    const { data } = await db.auth.admin.getUserById(userId);
    return data.user?.email ?? `member ${userId.slice(0, 8)}`;
  } catch {
    return `member ${userId.slice(0, 8)}`;
  }
}

/** The project members who are not members of the firm (pure). */
export function membersOutsideFirm(projectMemberIds: readonly string[], firmMemberIds: readonly string[]): string[] {
  const firm = new Set(firmMemberIds);
  return [...new Set(projectMemberIds)].filter((u) => !firm.has(u));
}

async function ids(db: SupabaseClient, table: "project_members" | "firm_members", column: "project_id" | "firm_id", value: string): Promise<string[]> {
  const { data, error } = await db.from(table).select("user_id").eq(column, value);
  if (error) throw new Error(`${table} read failed: ${error.message}`);
  return ((data ?? []) as { user_id: string }[]).map((r) => r.user_id);
}

/** Members of `projectId` outside `firmId` — empty means the firm may be attached. */
export async function projectMembersOutsideFirm(db: SupabaseClient, projectId: string, firmId: string): Promise<string[]> {
  const [project, firm] = await Promise.all([ids(db, "project_members", "project_id", projectId), ids(db, "firm_members", "firm_id", firmId)]);
  return membersOutsideFirm(project, firm);
}

/** Whether `userId` may join `projectId`: always, unless the project's firm does not include them. */
export async function mayJoinProject(db: SupabaseClient, projectId: string, userId: string): Promise<boolean> {
  const { data, error } = await db.from("projects").select("firm_id").eq("id", projectId).maybeSingle();
  if (error) throw new Error(`projects read failed: ${error.message}`);
  const firmId = (data as { firm_id: string | null } | null)?.firm_id ?? null;
  if (!firmId) return true;
  return (await ids(db, "firm_members", "firm_id", firmId)).includes(userId);
}
