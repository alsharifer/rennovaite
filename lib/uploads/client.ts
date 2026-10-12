// =============================================================================
// lib/uploads/client.ts — the browser half of a direct upload (H9).
//
//   1. pre-check   size + type against lib/uploads/limits.ts — the type by the
//                  file's own leading bytes, so a renamed file is caught here
//                  too (the server checks again; this only saves a round trip)
//   2. sign        POST /api/uploads/sign → a signed URL for a private path
//   3. upload      PUT the file STRAIGHT to Storage, with progress events
//   4. complete    POST /api/uploads/complete { path, …fields } → the kind's
//                  answer (new project, asset, quote in review, logo)
//
// Every failure is an UploadFailed carrying the one error shape
// { code: payload_too_large | unsupported_type | upload_failed, kind }.
// Browser-only (XMLHttpRequest, File); no React.
// =============================================================================

import { SNIFF_BYTES, checkDeclared, declaredType, sniffType, uploadError, type UploadErrorCode, type UploadKind } from "./limits";

export class UploadFailed extends Error {
  constructor(
    public readonly code: UploadErrorCode | string,
    public readonly kind: UploadKind,
    message: string,
    public readonly status = 0,
  ) {
    super(message);
  }
}

export interface DirectUploadOptions {
  kind: UploadKind;
  projectId?: string | null;
  firmId?: string | null;
  /** project_asset: the asset kind (photo, drawing_mep, …) narrows the allowed types. */
  assetKind?: string | null;
  /** 0–100 while the bytes travel to Storage. */
  onProgress?: (pct: number) => void;
}

const fail = (code: UploadErrorCode, kind: UploadKind) => new UploadFailed(code, kind, uploadError(code, kind).error);

async function failFrom(res: Response, kind: UploadKind): Promise<UploadFailed> {
  const body = (await res.json().catch(() => null)) as { code?: string; error?: string } | null;
  return new UploadFailed(body?.code ?? "upload_failed", kind, body?.error ?? uploadError("upload_failed", kind).error, res.status);
}

/** The browser's own check — the same table the server reads. null = fine. */
export async function precheckUpload(file: File, kind: UploadKind, assetKind?: string | null): Promise<UploadErrorCode | null> {
  const declared = checkDeclared(kind, file.size, declaredType(file.type, file.name), assetKind);
  if (declared) return declared;
  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  const real = sniffType(head);
  return real && checkDeclared(kind, file.size, real, assetKind) === null ? null : "unsupported_type";
}

function put(url: string, file: File, contentType: string, onProgress?: (pct: number) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", contentType);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress((e.loaded / e.total) * 100);
    };
    xhr.onload = () => resolve(xhr.status);
    xhr.onerror = () => reject(new Error("network"));
    xhr.send(file);
  });
}

/** Steps 1–3: the file is in Storage under a pending path signed for this caller. */
export async function uploadDirect(file: File, opts: DirectUploadOptions): Promise<{ path: string }> {
  const refused = await precheckUpload(file, opts.kind, opts.assetKind);
  if (refused) throw fail(refused, opts.kind);

  const sign = await fetch("/api/uploads/sign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: opts.kind, project_id: opts.projectId ?? null, firm_id: opts.firmId ?? null, size: file.size, type: file.type || null, filename: file.name, asset_kind: opts.assetKind ?? null }),
  });
  if (!sign.ok) throw await failFrom(sign, opts.kind);
  const signed = (await sign.json()) as { path: string; signedUrl: string; contentType: string };

  let status: number;
  try {
    status = await put(signed.signedUrl, file, signed.contentType, opts.onProgress);
  } catch {
    throw fail("upload_failed", opts.kind);
  }
  if (status === 413) throw fail("payload_too_large", opts.kind);
  if (status < 200 || status >= 300) throw fail("upload_failed", opts.kind);
  return { path: signed.path };
}

/** Step 4: verify + register. Answers what the kind's pipeline answers. */
export async function completeUpload<T = Record<string, unknown>>(path: string, kind: UploadKind, fields: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch("/api/uploads/complete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, ...fields }) });
  if (!res.ok) throw await failFrom(res, kind);
  return (await res.json()) as T;
}

/** All four steps. */
export async function uploadFile<T = Record<string, unknown>>(file: File, opts: DirectUploadOptions, fields: Record<string, unknown> = {}): Promise<T> {
  const { path } = await uploadDirect(file, opts);
  return completeUpload<T>(path, opts.kind, { filename: file.name, ...fields });
}
