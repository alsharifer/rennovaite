// =============================================================================
// lib/uploads/server.ts — sign + complete for direct-to-storage uploads (H9).
//
//   sign      session + membership (H1/H5) → the declared size and type are
//             checked against lib/uploads/limits.ts BEFORE any byte moves →
//             a signed upload URL for a server-chosen path in the PRIVATE
//             `uploads` bucket (migration 052; no anonymous insert policy).
//   (browser) PUTs the file straight to Storage with progress. No function
//             body ever carries file bytes.
//   complete  the object exists, the caller is the one who signed it (the
//             signer is in the path), its REAL size is under the limit and its
//             magic bytes are an allowed type — otherwise it is deleted and
//             the answer is 413 / 415. Then sha256, and the bytes are handed to
//             the kind's pipeline (lib/uploads/register.ts), which moves them
//             out of pending/.
//
// The path carries everything complete needs, so no table records intents:
//   pending/<kind>/<scopeId|new>/<callerId>/<uuid>.<ext>
// =============================================================================

import { createHash, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Caller } from "@/lib/auth/caller";
import { requireFirm } from "@/lib/firms/store";
import { authorizeProject } from "@/lib/projects/access";
import { StoreError } from "@/lib/store-error";

import {
  FILE_TYPES,
  UPLOAD_ERROR_STATUS,
  UPLOAD_KINDS,
  UPLOAD_LIMITS,
  allowedTypes,
  checkDeclared,
  declaredType,
  sniffType,
  uploadError,
  type FileType,
  type UploadErrorBody,
  type UploadErrorCode,
  type UploadKind,
} from "./limits";

/** The private bucket pending uploads land in (migration 052). */
export const UPLOAD_BUCKET = "uploads";
const PENDING = "pending";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An upload refusal in the one shape (limits.ts). */
export class UploadError extends Error {
  constructor(
    public readonly code: UploadErrorCode,
    public readonly kind: UploadKind,
  ) {
    super(code);
  }
  get status(): number {
    return UPLOAD_ERROR_STATUS[this.code];
  }
  get body(): UploadErrorBody {
    return uploadError(this.code, this.kind);
  }
}

export const isUploadKind = (k: unknown): k is UploadKind => typeof k === "string" && (UPLOAD_KINDS as readonly string[]).includes(k);

// --- Paths ------------------------------------------------------------------------

export interface PendingRef {
  kind: UploadKind;
  /** The project or firm id — "new" for an intake plan (its project does not exist yet). */
  scopeId: string;
  callerId: string;
  uuid: string;
  ext: string;
  path: string;
}

export function pendingPath(kind: UploadKind, scopeId: string, callerId: string, ext: string, uuid: string = randomUUID()): string {
  return `${PENDING}/${kind}/${scopeId}/${callerId}/${uuid}.${ext}`;
}

/** Parse a pending path — null for anything that is not one we would have signed. */
export function parsePendingPath(path: unknown): PendingRef | null {
  if (typeof path !== "string") return null;
  const m = /^pending\/([a-z_]+)\/([0-9a-f-]{36}|new)\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.([a-z0-9]{1,5})$/i.exec(path);
  if (!m) return null;
  const [, kind, scopeId, callerId, uuid, ext] = m;
  if (!isUploadKind(kind)) return null;
  if ((scopeId !== "new" && !UUID.test(scopeId!)) || !UUID.test(callerId!) || !UUID.test(uuid!)) return null;
  if ((UPLOAD_LIMITS[kind].scope === "new") !== (scopeId === "new")) return null;
  return { kind, scopeId: scopeId!, callerId: callerId!, uuid: uuid!, ext: ext!, path };
}

// --- Authority --------------------------------------------------------------------

/** The caller may upload into this scope: a member of the project (H5) / firm (U1); anyone signed in for a new project. */
async function authorizeScope(db: SupabaseClient, caller: Caller, kind: UploadKind, scopeId: string): Promise<void> {
  const scope = UPLOAD_LIMITS[kind].scope;
  if (scope === "project") await authorizeProject(db, caller, { project_id: scopeId });
  else if (scope === "firm") await requireFirm(db, scopeId, caller);
}

// --- Sign -------------------------------------------------------------------------

export interface SignRequest {
  kind: UploadKind;
  /** The project (project-scoped kinds) or firm (firm-scoped kinds); absent for a plan. */
  scopeId?: string | null;
  size: number;
  /** The browser's MIME for the file. */
  type?: string | null;
  filename?: string | null;
  /** project_asset only: the asset kind narrows the allowed types. */
  assetKind?: string | null;
}

export interface SignedUpload {
  path: string;
  signedUrl: string;
  token: string;
  /** What the upload is judged as — the browser uses it as the PUT content-type. */
  contentType: string;
}

export async function signUpload(db: SupabaseClient, caller: Caller | null, req: SignRequest): Promise<SignedUpload> {
  if (!caller) throw new StoreError(401, "unauthenticated", "Sign in to upload.");
  const limit = UPLOAD_LIMITS[req.kind];
  const scopeId = limit.scope === "new" ? "new" : (req.scopeId ?? "");
  if (limit.scope !== "new" && !UUID.test(scopeId)) throw new StoreError(400, "scope_required", `A ${limit.scope} id is required for this upload.`);
  await authorizeScope(db, caller, req.kind, scopeId);

  const type = declaredType(req.type, req.filename);
  const refused = checkDeclared(req.kind, req.size, type, req.assetKind);
  if (refused) throw new UploadError(refused, req.kind);

  const path = pendingPath(req.kind, scopeId, caller.id, FILE_TYPES[type!].ext);
  const { data, error } = await db.storage.from(UPLOAD_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(`could not sign an upload: ${error?.message ?? "no data"}`);
  return { path: data.path ?? path, signedUrl: data.signedUrl, token: data.token, contentType: FILE_TYPES[type!].mime };
}

// --- Complete ---------------------------------------------------------------------

export interface CompletedUpload extends PendingRef {
  bytes: Uint8Array;
  size: number;
  type: FileType;
  mime: string;
  sha256: string;
}

async function discard(db: SupabaseClient, path: string): Promise<void> {
  await db.storage.from(UPLOAD_BUCKET).remove([path]).catch(() => undefined);
}

/**
 * Verify a pending upload and read it. Refusals delete the object first, so a
 * rejected file is never left behind. `assetKind` narrows project-asset types.
 */
export async function completeUpload(db: SupabaseClient, caller: Caller | null, path: unknown, opts: { assetKind?: string | null; expectKind?: UploadKind } = {}): Promise<CompletedUpload> {
  if (!caller) throw new StoreError(401, "unauthenticated", "Sign in to upload.");
  const ref = parsePendingPath(path);
  // A path we did not sign — or one someone else signed — is not yours to complete.
  if (!ref || ref.callerId !== caller.id) throw new StoreError(403, "upload_not_yours", "This upload was not signed for you.");
  if (opts.expectKind && ref.kind !== opts.expectKind) throw new StoreError(400, "wrong_upload_kind", `Expected a ${opts.expectKind} upload.`);
  await authorizeScope(db, caller, ref.kind, ref.scopeId);

  const { data, error } = await db.storage.from(UPLOAD_BUCKET).download(ref.path);
  if (error || !data) throw new UploadError("upload_failed", ref.kind); // never arrived (or already completed)
  const bytes = new Uint8Array(await data.arrayBuffer());

  if (bytes.byteLength === 0) {
    await discard(db, ref.path);
    throw new UploadError("upload_failed", ref.kind);
  }
  if (bytes.byteLength > UPLOAD_LIMITS[ref.kind].maxBytes) {
    await discard(db, ref.path);
    throw new UploadError("payload_too_large", ref.kind);
  }
  const type = sniffType(bytes.subarray(0, 1024));
  if (!type || !allowedTypes(ref.kind, opts.assetKind).includes(type)) {
    await discard(db, ref.path);
    throw new UploadError("unsupported_type", ref.kind);
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { ...ref, bytes, size: bytes.byteLength, type, mime: FILE_TYPES[type].mime, sha256 };
}

/** Move a completed upload out of pending/: write it where the pipeline expects it, then drop the pending object. */
export async function promoteUpload(db: SupabaseClient, done: CompletedUpload, bucket: string, finalPath: string): Promise<void> {
  const up = await db.storage.from(bucket).upload(finalPath, done.bytes, { contentType: done.mime, upsert: false });
  if (up.error) throw new Error(`could not store the upload: ${up.error.message}`);
  await discard(db, done.path);
}

/** Drop a completed upload whose bytes were consumed in place (a quote, parsed and not retained). */
export const dropPending = (db: SupabaseClient, done: CompletedUpload) => discard(db, done.path);
