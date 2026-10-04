// H5 — the route-side face of lib/projects/access.ts: a project check that
// either yields the project id or the response to return. Every project-scoped
// handler calls this right after its caller check (the route-auth scan test
// fails one that does not).
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Caller } from "@/lib/auth/caller";

import { StoreError, authorizeProject, type ProjectRefs } from "./access";

export type ProjectAccess = { projectId: string; denied?: never } | { projectId?: never; denied: NextResponse };

export async function projectAccess(db: SupabaseClient, caller: Caller | null, refs: ProjectRefs): Promise<ProjectAccess> {
  try {
    return { projectId: await authorizeProject(db, caller, refs) };
  } catch (e) {
    if (e instanceof StoreError) return { denied: NextResponse.json({ success: false, error: e.message, code: e.code }, { status: e.status }) };
    throw e;
  }
}
