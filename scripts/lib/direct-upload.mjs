// =============================================================================
// scripts/lib/direct-upload.mjs — a script's file upload, the way the browser
// does it since H9: sign → PUT straight to Storage → complete. No route takes
// multipart any more (lib/uploads/*).
//
//   const r = await directUpload(BASE, headers, { kind: "quote", firm_id, bytes, type, filename },
//                                `/api/firms/${firmId}/quotes`, { supplier_label, … });
//   // r = { status, body } of whichever step answered last — the sign route's
//   // refusal (401 / 403 / 413 / 415) or the completing route's answer.
//
// `headers` carries the caller's credential (a devSession's `.headers`, or
// `{ authorization }` from a devFetch). Plain ESM so .mjs and .ts scripts can
// both import it.
// =============================================================================

/**
 * @param {string} base
 * @param {Record<string, string>} headers
 * @param {{ kind: string, project_id?: string, firm_id?: string, asset_kind?: string, bytes: Uint8Array, type: string, filename: string }} file
 * @param {string} [completeRoute] the route that completes the path (default the generic one)
 * @param {Record<string, unknown>} [fields] what that route takes beside `path`
 * @returns {Promise<{ status: number, body: any, path?: string }>}
 */
export async function directUpload(base, headers, file, completeRoute = "/api/uploads/complete", fields = {}) {
  const json = { ...headers, "content-type": "application/json" };
  const sign = await fetch(`${base}/api/uploads/sign`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ kind: file.kind, project_id: file.project_id ?? null, firm_id: file.firm_id ?? null, size: file.bytes.byteLength, type: file.type, filename: file.filename, asset_kind: file.asset_kind ?? null }),
  });
  const signed = await sign.json().catch(() => ({}));
  if (!sign.ok) return { status: sign.status, body: signed };

  const put = await fetch(signed.signedUrl, { method: "PUT", headers: { "content-type": signed.contentType, "x-upsert": "false" }, body: file.bytes });
  if (!put.ok) return { status: put.status, body: { code: put.status === 413 ? "payload_too_large" : "upload_failed", kind: file.kind, error: (await put.text()).slice(0, 200) }, path: signed.path };

  const done = await fetch(`${base}${completeRoute}`, { method: "POST", headers: json, body: JSON.stringify({ path: signed.path, filename: file.filename, ...fields }) });
  return { status: done.status, body: await done.json().catch(() => ({})), path: signed.path };
}
