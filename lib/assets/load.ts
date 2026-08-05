// =============================================================================
// lib/assets/load.ts — server-side reads/paths for the project asset library.
//
// Server-only (imports the service-role client). Everything here degrades to an
// empty result if the project_assets table isn't applied yet, so the app works
// before migration 024 is run.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { isAssetKind, isAssetSource, type AssetKind, type AssetLite, type ProjectAsset } from "./types";

/** Reuse the existing public bucket the plan/room-photo uploaders write to. */
export const ASSET_BUCKET = "plan-uploads";

/** Storage key for a new asset: `<projectId>/assets/<uuid>.<ext>`. */
export function assetStoragePath(projectId: string, uuid: string, ext: string): string {
  return `${projectId}/assets/${uuid}.${ext}`;
}

/** Loose client — project_assets isn't in the generated Database types. */
function db(): SupabaseClient {
  return getSupabaseAdmin() as unknown as SupabaseClient;
}

type Row = {
  id: string;
  project_id: string;
  kind: string;
  room_id: string | null;
  storage_path: string;
  filename: string | null;
  mime: string | null;
  bytes: number | null;
  uploaded_at: string | null;
  source: string | null;
};

function normalise(r: Row): ProjectAsset {
  return {
    id: r.id,
    project_id: r.project_id,
    kind: isAssetKind(r.kind) ? r.kind : "other",
    room_id: r.room_id,
    storage_path: r.storage_path,
    filename: r.filename,
    mime: r.mime,
    bytes: r.bytes == null ? null : Number(r.bytes),
    uploaded_at: r.uploaded_at,
    source: isAssetSource(r.source) ? r.source : null,
  };
}

export function publicUrlForPath(path: string): string {
  return db().storage.from(ASSET_BUCKET).getPublicUrl(path).data.publicUrl;
}

export function toAssetLite(a: ProjectAsset): AssetLite {
  return {
    id: a.id,
    url: publicUrlForPath(a.storage_path),
    kind: a.kind,
    room_id: a.room_id,
    filename: a.filename,
    bytes: a.bytes,
  };
}

/** All assets for a project, newest first. `[]` if the table is absent. */
export async function loadProjectAssets(projectId: string): Promise<ProjectAsset[]> {
  try {
    const { data, error } = await db()
      .from("project_assets")
      .select("id, project_id, kind, room_id, storage_path, filename, mime, bytes, uploaded_at, source")
      .eq("project_id", projectId)
      .order("uploaded_at", { ascending: false })
      .returns<Row[]>();
    if (error) return [];
    return (data ?? []).map(normalise);
  } catch {
    return [];
  }
}

/** Photo assets for a project (for the render picker), newest first. */
export async function loadProjectPhotoAssets(projectId: string): Promise<AssetLite[]> {
  const all = await loadProjectAssets(projectId);
  return all.filter((a) => a.kind === "photo").map(toAssetLite);
}

/** Assets of a specific kind, newest first. */
export async function loadProjectAssetsOfKind(
  projectId: string,
  kind: AssetKind,
): Promise<AssetLite[]> {
  const all = await loadProjectAssets(projectId);
  return all.filter((a) => a.kind === kind).map(toAssetLite);
}
