import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { z } from "zod";

import { signInPath } from "@/lib/auth/access";
import { getPageCaller } from "@/lib/auth/caller";
import { StoreError, authorizeProject } from "@/lib/projects/access";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

// H5 — every page under /project/:id is for the project's members. The FIRST
// check is proxy.ts (before any page code runs — a page renders in parallel
// with its layout, so this layout alone cannot stop a page's reads). This is
// the second: a non-member who got past the proxy (a matcher change, say) sees
// the project's not-found page — its words already say "a project on a
// different account" — rather than a 403 that would confirm the project exists.
// Pages are read with the cookie session or, by scripts, a Bearer (getPageCaller).
export default async function ProjectLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const caller = await getPageCaller();
  if (!caller) redirect(signInPath(`/project/${id}`));
  try {
    await authorizeProject(getSupabaseAdmin() as unknown as SupabaseClient, caller, { project_id: id });
  } catch (e) {
    if (e instanceof StoreError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  }
  return children;
}
