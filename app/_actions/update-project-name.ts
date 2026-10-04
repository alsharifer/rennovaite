"use server";

import { revalidatePath } from "next/cache";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getCaller } from "@/lib/auth/caller";
import { StoreError, authorizeProject } from "@/lib/projects/access";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function updateProjectName(
  projectId: string,
  name: string,
): Promise<{ success: true } | { success: false; error: string }> {
  // H1: a server action is a POST the proxy cannot tell apart from the page's
  // own; it checks the caller itself.
  const caller = await getCaller();
  if (!caller) return { success: false, error: "Sign in to rename a project." };
  // H5: only a member of the project may rename it.
  try {
    await authorizeProject(getSupabaseAdmin() as unknown as SupabaseClient, caller, { project_id: projectId });
  } catch (e) {
    if (e instanceof StoreError) return { success: false, error: e.message };
    throw e;
  }
  const trimmed = name.trim();
  if (!trimmed) {
    return { success: false, error: "Name cannot be empty." };
  }
  if (trimmed.length > 200) {
    return { success: false, error: "Name is too long." };
  }

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("projects")
      .update({ name: trimmed })
      .eq("id", projectId);
    if (error) throw error;

    revalidatePath(`/project/${projectId}/plan`);
    return { success: true };
  } catch (err) {
    console.error("[updateProjectName] error", err);
    const message =
      err instanceof Error ? err.message : "Failed to save the name.";
    return { success: false, error: message };
  }
}
