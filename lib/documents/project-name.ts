// =============================================================================
// lib/documents/project-name.ts — the project name a DOCUMENT prints (G5).
//
// Every client-facing document (drawing set, render pack, BoQ PDF) reads the
// project through here, so display_name (migration 038) wins everywhere at once
// and the working name — "…(ground truth)", "…Draft for Review" — never leaks
// onto a cover by one builder forgetting it.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

export interface DocumentProject {
  name: string;
  city: string;
}

export function documentName(row: { name?: string | null; display_name?: string | null } | null | undefined, fallback: string): string {
  return row?.display_name?.trim() || row?.name?.trim() || fallback;
}

export async function loadDocumentProject(sb: SupabaseClient, projectId: string, fallback = "Untitled garden"): Promise<DocumentProject> {
  for (const cols of ["name, city, display_name", "name, city"]) {
    const { data, error } = await sb.from("projects").select(cols).eq("id", projectId).maybeSingle<{ name: string | null; city: string | null; display_name?: string | null }>();
    if (!error) return { name: documentName(data, fallback), city: data?.city?.trim() || "Dubai" };
  }
  return { name: fallback, city: "Dubai" };
}
