"use server";

import { revalidatePath } from "next/cache";

import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function updateProjectName(
  projectId: string,
  name: string,
): Promise<{ success: true } | { success: false; error: string }> {
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
