// =============================================================================
// lib/uploads/register.ts — what each kind of upload becomes once it is
// verified (H9). The pipelines are the ones the multipart routes ran before
// H9, moved here unchanged — they now start from a COMPLETED upload
// (lib/uploads/server.ts) instead of a request body:
//
//   plan           a new project + plan + floorplan asset   (was /api/upload)
//   project_asset  a project_assets row (+ room photo)      (was /api/project-asset)
//   room_photo     a room_photos row                        (was /api/room-photo)
//   quote          the quote import, in review (U3)         (was /api/firms/:id/quotes)
//   logo           the firm's proposal logo (L4)            (was /api/firms/:id/branding)
//
// POST /api/uploads/complete and each of those routes (now JSON { path, … })
// call finishUpload — one path, whichever URL the client used.
// =============================================================================

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { ASSET_BUCKET, assetStoragePath, publicUrlForPath } from "@/lib/assets/load";
import { isAssetKind, isAssetSource, type AssetKind } from "@/lib/assets/types";
import type { Caller } from "@/lib/auth/caller";
import { setLogoPath } from "@/lib/firms/branding";
import { addProjectMember, authorizeProject } from "@/lib/projects/access";
import { recordProjectCreator } from "@/lib/projects/lifecycle";
import { importQuote } from "@/lib/quotes/store";
import { StoreError } from "@/lib/store-error";

import type { UploadKind } from "./limits";
import { UploadError, completeUpload, dropPending, parsePendingPath, promoteUpload, type CompletedUpload } from "./server";

const Uuid = z.string().uuid();

/** Fields a completion may carry besides the path, per kind. */
export interface FinishFields {
  /** The browser's original file name (shown in the asset library; never trusted for type). */
  filename?: string | null;
  // project_asset
  asset_kind?: string | null;
  source?: string | null;
  room_id?: string | null;
  // quote — the quote's terms (validated by QuoteMetaSchema)
  [k: string]: unknown;
}

export const QuoteMetaSchema = z.object({
  supplier_label: z.string().trim().min(1).max(160),
  supplier_role: z.enum(["supplier", "contractor", "manufacturer", "other"]).default("supplier"),
  quote_ref: z.string().trim().max(120).optional().nullable(),
  quote_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal("").transform(() => null)),
  valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal("").transform(() => null)),
  currency: z.string().trim().min(3).max(3).default("AED"),
  vat_treatment: z.enum(["excl", "incl", "unknown"]).default("excl"),
  rates_are: z.enum(["net", "list"]).default("net"),
  discount_pct: z.coerce.number().min(0).max(99.99).default(0),
});

const fileName = (f: FinishFields, done: CompletedUpload) => (typeof f.filename === "string" && f.filename.trim() ? f.filename.trim().slice(0, 240) : `upload.${done.ext}`);

// --- plan ---------------------------------------------------------------------------

async function registerPlan(db: SupabaseClient, caller: Caller, done: CompletedUpload, f: FinishFields) {
  let projectId: string | null = null;
  let stored: string | null = null;
  try {
    const { data: project, error } = await db.from("projects").insert({ city: "Dubai", name: "Untitled" }).select("id").single<{ id: string }>();
    if (error || !project) throw error ?? new Error("Failed to create project row.");
    projectId = project.id;
    // H5: creating a project makes the uploader its member (rolled back with it).
    await addProjectMember(db, project.id, caller.id);
    // K10 (055): the creator is who may delete an owner project.
    await recordProjectCreator(db, project.id, caller.id);

    const path = `${project.id}/${randomUUID()}.${done.ext}`;
    await promoteUpload(db, done, ASSET_BUCKET, path);
    stored = path;
    const pdf_url = publicUrlForPath(path);

    const { data: plan, error: planErr } = await db.from("plans").insert({ project_id: project.id, pdf_url }).select("id").single<{ id: string }>();
    if (planErr || !plan) throw planErr ?? new Error("Failed to create plan row.");

    // Best-effort: the floorplan in the project asset library (024).
    try {
      await db.from("project_assets").insert({ project_id: project.id, kind: "floorplan", storage_path: path, filename: fileName(f, done), mime: done.mime, bytes: done.size, source: "intake" });
    } catch {
      /* project_assets not applied yet — non-fatal */
    }
    return { project_id: project.id, plan_id: plan.id, pdf_url, sha256: done.sha256 };
  } catch (e) {
    if (stored) await db.storage.from(ASSET_BUCKET).remove([stored]).catch(() => undefined);
    if (projectId) await db.from("projects").delete().eq("id", projectId);
    throw e;
  }
}

// --- project asset ------------------------------------------------------------------

async function registerAsset(db: SupabaseClient, caller: Caller, done: CompletedUpload, f: FinishFields) {
  const kind = f.asset_kind as AssetKind;
  const roomId = typeof f.room_id === "string" && Uuid.safeParse(f.room_id).success ? f.room_id : null;
  // The room must be this project's (H5: every id a request carries).
  if (roomId) await authorizeProject(db, caller, { project_id: done.scopeId, room_id: roomId });
  const path = assetStoragePath(done.scopeId, randomUUID(), done.ext);
  await promoteUpload(db, done, ASSET_BUCKET, path);
  try {
    const { data: row, error } = await db
      .from("project_assets")
      .insert({ project_id: done.scopeId, kind, room_id: kind === "photo" ? roomId : null, storage_path: path, filename: fileName(f, done), mime: done.mime, bytes: done.size, source: isAssetSource(f.source) ? f.source : null })
      .select("id")
      .single<{ id: string }>();
    if (error || !row) throw error ?? new Error("Failed to save asset row.");
    // A photo uploaded for a room becomes that room's photo — the render pipeline reads room_photos.
    if (kind === "photo" && roomId) await db.from("room_photos").insert({ room_id: roomId, storage_path: path, public_url: publicUrlForPath(path) });
    return { asset_id: row.id, kind, room_id: kind === "photo" ? roomId : null, public_url: publicUrlForPath(path), sha256: done.sha256 };
  } catch (e) {
    await db.storage.from(ASSET_BUCKET).remove([path]).catch(() => undefined);
    throw e;
  }
}

// --- room photo ---------------------------------------------------------------------

async function registerRoomPhoto(db: SupabaseClient, caller: Caller, done: CompletedUpload, f: FinishFields) {
  const roomId = typeof f.room_id === "string" && Uuid.safeParse(f.room_id).success ? f.room_id : null;
  if (!roomId) throw new StoreError(400, "room_required", "A valid room_id is required.");
  await authorizeProject(db, caller, { project_id: done.scopeId, room_id: roomId });
  const path = `${done.scopeId}/rooms/${roomId}/${randomUUID()}.${done.ext}`;
  await promoteUpload(db, done, ASSET_BUCKET, path);
  try {
    const public_url = publicUrlForPath(path);
    const { data: row, error } = await db.from("room_photos").insert({ room_id: roomId, storage_path: path, public_url }).select("id").single<{ id: string }>();
    if (error || !row) throw error ?? new Error("Failed to save room photo row.");
    return { room_photo_id: row.id, room_id: roomId, public_url, storage_path: path, sha256: done.sha256 };
  } catch (e) {
    await db.storage.from(ASSET_BUCKET).remove([path]).catch(() => undefined);
    throw e;
  }
}

// --- quote --------------------------------------------------------------------------

async function registerQuote(db: SupabaseClient, caller: Caller, done: CompletedUpload, f: FinishFields) {
  const meta = QuoteMetaSchema.safeParse(f);
  if (!meta.success) {
    await dropPending(db, done);
    throw new StoreError(400, "invalid_quote_terms", meta.error.message);
  }
  try {
    // Parsed in place and NOT retained (as before H9): the quote record and its
    // lines are the record; the supplier's workbook is not kept.
    const result = await importQuote(db, done.scopeId, caller, meta.data, { name: fileName(f, done), bytes: done.bytes });
    return { success: true, ...result };
  } finally {
    await dropPending(db, done);
  }
}

// --- logo ---------------------------------------------------------------------------

async function registerLogo(db: SupabaseClient, caller: Caller, done: CompletedUpload) {
  const path = `firms/${done.scopeId}/logo-${randomUUID()}.${done.ext}`;
  await promoteUpload(db, done, ASSET_BUCKET, path);
  try {
    const b = await setLogoPath(db, done.scopeId, path, caller);
    // The branding route's view (logo_url resolved), so either URL answers the same.
    return { success: true, branding: { firm_id: b.firm_id, name: b.name, display_name: b.display_name, brand: b.brand, terms_text: b.terms_text, logo_url: b.logo_path ? publicUrlForPath(b.logo_path) : null } };
  } catch (e) {
    await db.storage.from(ASSET_BUCKET).remove([path]).catch(() => undefined);
    throw e;
  }
}

// --- the one entry ------------------------------------------------------------------

/**
 * Complete a pending upload and run its kind's pipeline. `expectKind` lets a
 * kind-specific route (e.g. /api/upload) refuse another kind's path.
 */
export async function finishUpload(db: SupabaseClient, caller: Caller | null, path: unknown, fields: FinishFields = {}, expectKind?: UploadKind) {
  const ref = parsePendingPath(path);
  const assetKind = ref?.kind === "project_asset" ? fields.asset_kind : undefined;
  if (ref?.kind === "project_asset" && (!isAssetKind(assetKind) || assetKind === "floorplan")) {
    // Floorplans arrive as a plan upload, never as a library asset (a second write path).
    throw new UploadError("unsupported_type", "project_asset");
  }
  const done = await completeUpload(db, caller, path, { assetKind: typeof assetKind === "string" ? assetKind : null, expectKind });
  switch (done.kind) {
    case "plan":
      return registerPlan(db, caller!, done, fields);
    case "project_asset":
      return registerAsset(db, caller!, done, fields);
    case "room_photo":
      return registerRoomPhoto(db, caller!, done, fields);
    case "quote":
      return registerQuote(db, caller!, done, fields);
    case "logo":
      return registerLogo(db, caller!, done);
  }
}
