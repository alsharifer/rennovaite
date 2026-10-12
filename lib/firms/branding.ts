// =============================================================================
// lib/firms/branding.ts — what a firm's client sees on a proposal (L4, 047).
//
// The FIRM chooses: a display name (defaults to the registered name), a logo
// (PNG / JPG, stored in the plan-uploads bucket under firms/<firm>/…, referenced
// by path like every asset) and a free-text terms block. Members only for every
// write and for the member-facing read; `loadFirmBranding` is the document path
// (no caller — the proposal route is already behind the pack-job guard).
// Pre-047 a read degrades to the registered name and no logo, never an error.
// =============================================================================


import type { SupabaseClient } from "@supabase/supabase-js";

import { ASSET_BUCKET } from "@/lib/assets/load";
import type { Caller } from "@/lib/auth/caller";
import { StoreError, requireFirm } from "@/lib/firms/store";
import { isMissingSchema } from "@/lib/rates/firm";

export interface FirmBranding {
  firm_id: string;
  /** The registered name (members' eyes). */
  name: string;
  display_name: string | null;
  logo_path: string | null;
  terms_text: string | null;
  /** What the client sees: display_name, or the registered name. */
  brand: string;
}


function toBranding(r: Record<string, unknown>): FirmBranding {
  const display = typeof r.display_name === "string" && r.display_name.trim() ? r.display_name.trim() : null;
  return {
    firm_id: String(r.id),
    name: String(r.name),
    display_name: display,
    logo_path: (r.logo_path ?? null) as string | null,
    terms_text: (r.terms_text ?? null) as string | null,
    brand: display ?? String(r.name),
  };
}

/** The document path: no caller. null = no such firm. */
export async function loadFirmBranding(db: SupabaseClient, firmId: string): Promise<FirmBranding | null> {
  let res = await db.from("firms").select("id, name, display_name, logo_path, terms_text").eq("id", firmId).maybeSingle();
  if (res.error && isMissingSchema(res.error)) res = await db.from("firms").select("id, name").eq("id", firmId).maybeSingle();
  if (res.error) throw new Error(`firm branding read failed: ${res.error.message}`);
  return res.data ? toBranding(res.data as Record<string, unknown>) : null;
}

export async function getBranding(db: SupabaseClient, firmId: string, caller: Caller | null): Promise<FirmBranding> {
  await requireFirm(db, firmId, caller);
  const b = await loadFirmBranding(db, firmId);
  if (!b) throw new StoreError(404, "firm_not_found", "Firm not found.");
  return b;
}

export interface BrandingPatch {
  display_name?: string | null;
  terms_text?: string | null;
}

export async function updateBranding(db: SupabaseClient, firmId: string, patch: BrandingPatch, caller: Caller | null): Promise<FirmBranding> {
  await requireFirm(db, firmId, caller);
  const row: Record<string, unknown> = {};
  if (patch.display_name !== undefined) row.display_name = patch.display_name?.trim() || null;
  if (patch.terms_text !== undefined) row.terms_text = patch.terms_text?.trim() || null;
  if (Object.keys(row).length === 0) throw new StoreError(400, "empty_patch", "Nothing to change.");
  const { error } = await db.from("firms").update(row).eq("id", firmId);
  if (error) {
    if (isMissingSchema(error)) throw new StoreError(500, "branding_unavailable", "Firm branding needs migration 047.");
    throw new Error(`firm branding update failed: ${error.message}`);
  }
  return (await loadFirmBranding(db, firmId))!;
}

/**
 * Point the firm at a stored logo (H9: the file was uploaded straight to
 * Storage, verified — size and PNG / JPG magic bytes, lib/uploads/limits.ts —
 * and moved into place by lib/uploads/register.ts). The previous file is left
 * in place: a proposal already exported may reference it.
 */
export async function setLogoPath(db: SupabaseClient, firmId: string, logoPath: string, caller: Caller | null): Promise<FirmBranding> {
  await requireFirm(db, firmId, caller);
  if (!logoPath.startsWith(`firms/${firmId}/`)) throw new StoreError(400, "logo_path", "That logo is not this firm's.");
  const { error } = await db.from("firms").update({ logo_path: logoPath }).eq("id", firmId);
  if (error) {
    if (isMissingSchema(error)) throw new StoreError(500, "branding_unavailable", "Firm branding needs migration 047.");
    throw new Error(`firm logo update failed: ${error.message}`);
  }
  return (await loadFirmBranding(db, firmId))!;
}

/** The logo's bytes as a data URI for an SVG <image>, or null. Never throws — a missing file prints no logo. */
export async function loadLogoDataUri(db: SupabaseClient, logoPath: string | null): Promise<string | null> {
  if (!logoPath) return null;
  try {
    const { data, error } = await db.storage.from(ASSET_BUCKET).download(logoPath);
    if (error || !data) return null;
    const buf = Buffer.from(await data.arrayBuffer());
    const mime = logoPath.endsWith(".png") ? "image/png" : "image/jpeg";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}
