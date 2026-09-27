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

import { randomUUID } from "node:crypto";

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

export const LOGO_MAX_BYTES = 1_000_000;
export const LOGO_MIMES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg" };

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

/** Store a logo and point the firm at it. The previous file is left in place (a proposal already exported may reference it). */
export async function setLogo(db: SupabaseClient, firmId: string, file: { bytes: Uint8Array; mime: string }, caller: Caller | null): Promise<FirmBranding> {
  await requireFirm(db, firmId, caller);
  const ext = LOGO_MIMES[file.mime];
  if (!ext) throw new StoreError(422, "logo_type", "A logo must be a PNG or JPG.");
  if (file.bytes.byteLength === 0 || file.bytes.byteLength > LOGO_MAX_BYTES) throw new StoreError(422, "logo_size", `A logo must be under ${LOGO_MAX_BYTES / 1e6} MB.`);
  const path = `firms/${firmId}/logo-${randomUUID()}.${ext}`;
  const up = await db.storage.from(ASSET_BUCKET).upload(path, file.bytes, { contentType: file.mime, upsert: false });
  if (up.error) throw new Error(`logo upload failed: ${up.error.message}`);
  const { error } = await db.from("firms").update({ logo_path: path }).eq("id", firmId);
  if (error) {
    await db.storage.from(ASSET_BUCKET).remove([path]);
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
