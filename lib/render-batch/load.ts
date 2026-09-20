// Server-side reads for the render batch (G4). Degrades before migration 035.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { BatchRender } from "./plan";

/** Renders with their view; before migration 035 every render reads as a day view. */
export async function loadRenders(supabase: SupabaseClient, projectId: string): Promise<BatchRender[]> {
  const cols = "id, room_id, status, image_url, parent_render_id, created_at";
  const withView = await supabase.from("renders").select(`${cols}, view`).eq("project_id", projectId);
  if (!withView.error) return (withView.data ?? []) as BatchRender[];
  const base = await supabase.from("renders").select(cols).eq("project_id", projectId);
  return (base.data ?? []) as BatchRender[];
}
