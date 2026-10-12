# H9 — uploads bypass the 4.5 MB function limit (direct-to-storage signed uploads)

*Status: **built** (2026-10-12), branch `fix/h9-direct-uploads`. Migration
**052** (`uploads` bucket) applied on dev; **prod must be pushed before the
merge**. Live-verified on dev (`scripts/upload-direct-check.mjs`, 23/23).*

## The finding

Vercel rejects a request body over ~4.5 MB before our code runs: the response is
a plain-text `413 FUNCTION_PAYLOAD_TOO_LARGE`, not our structured 413.
Measured 2026-10-12 against **production** with unauthenticated multipart
`POST /api/upload` (nothing created): 1.0 MB and 4.3 MB reached the app
(`401 unauthenticated`); 4.7 MB and 6.2 MB were answered by Vercel (`413
text/plain`). A 6 MB PDF through intake on a preview fails the same way.
Function **responses** have the same cap.

## Step 0 — the audit (before any change)

**Where each upload went (pre-H9)** — every one through a function body:

| Route | Kind | Store | Path | Our limit |
|---|---|---|---|---|
| `POST /api/upload` | intake floorplan (PDF/PNG/JPG) | `plan-uploads` (**public**) | `<projectId>/<uuid>.<ext>` + a `project_assets` floorplan row | 20 MB |
| `POST /api/project-asset` | drawings (PDF/DWG/DXF), photos, references | `plan-uploads` | `<projectId>/assets/<uuid>.<ext>` | 25 MB |
| `POST /api/room-photo` | a room's photo | `plan-uploads` | `<projectId>/rooms/<roomId>/<uuid>.<ext>` | 20 MB |
| `POST /api/firms/:id/quotes` | quote workbook (xlsx) | none — parsed in memory, not retained | — | 5 MB |
| `POST /api/firms/:id/branding` | proposal logo | `plan-uploads` | `firms/<firmId>/logo-<uuid>.<ext>` | 1 MB |

Other buckets are server-written only: `renders` (public), `drawings`
(private, design-lock archive), `packs` (private, pack-export outputs — already
served by signed URLs). No other store.

**Every route that returns a file**, and whether it can pass 4.5 MB
(measured on dev, 12 Oct):

| Route | Can exceed? | Measured |
|---|---|---|
| `GET /api/projects/:id/render-pack` (PDF) | **yes** | reference garden 7.28 MB; Arabella 3.52 MB |
| `GET /api/projects/:id/drawings?format=pdf` (set PDF) | **yes** | reference garden 4.58 MB; Arabella 4.11 MB |
| `GET /api/projects/:id/boq-pdf` | not today (grows with lines) | ~0.5 MB |
| `GET /api/projects/:id/proposal` | not today | < 1 MB |
| `GET /api/projects/:id/boq-diff?format=pdf` | not today | < 1 MB |
| `GET /api/firms/:id/quotes/template` (xlsx) | no | ~10 KB |

All five PDF routes now answer through `fileResponse` (below), so a growth past
the cap cannot break any of them.

## What H9 built

1. **One limits table** — `lib/uploads/limits.ts`: per kind (`plan`,
   `project_asset`, `room_photo`, `quote`, `logo`) the max bytes, allowed types
   **by magic bytes** (`sniffType`: PDF, PNG, JPG, DWG, DXF, xlsx), and scope
   (project / firm / new project). Project-asset kinds narrow it further
   (photos are images). The browser pre-check, the sign route and the complete
   route all read it; a grep test fails on any other numeric upload limit in
   `app/`, `lib/`, `components/`, `proxy.ts` or `next.config.ts` (the one
   exception, `lib/image/compress.ts`'s passthrough size, is named with its
   reason). The bucket's own cap in 052 is held equal to the table's largest
   kind by test.
2. **Sign** — `POST /api/uploads/sign {kind, project_id|firm_id, size, type,
   filename?, asset_kind?}`: session (H1) → project membership (H5) / firm
   membership (U1) → the declared size + type against the table (structured
   `413` / `415` **before any byte moves**, no URL minted) →
   `createSignedUploadUrl` for a server-chosen path in the new **private**
   `uploads` bucket: `pending/<kind>/<projectId|firmId|new>/<signerId>/<uuid>.<ext>`.
   No storage policies at all (no anonymous or authenticated insert).
3. **Upload** — the browser PUTs the file straight to Storage on the signed
   URL with progress (`lib/uploads/client.ts`, XHR). No function body carries
   file bytes. (Storage answers the CORS preflight for `content-type,x-upsert`.)
4. **Complete** — `POST /api/uploads/complete {path, …fields}`: the path must
   parse as one we sign and name the caller as signer (else `403
   upload_not_yours`); membership is re-checked; the object is read — real
   size over the limit ⇒ deleted + 413; magic bytes not allowed ⇒ deleted +
   415; then sha256 (fixture convention), the bytes move out of `pending/`, and
   the kind's existing pipeline runs (`lib/uploads/register.ts`: project + plan
   + floorplan asset, asset row + room photo, quote import, logo). The old
   routes (`/api/upload`, `/api/project-asset`, `/api/room-photo`,
   `/api/firms/:id/quotes`, `/api/firms/:id/branding`) take JSON `{path, …}`
   now — the multipart branches are gone, and they call the same
   `finishUpload`. Parse is unchanged: it still reads the plan's public URL.
5. **Large responses** — `lib/documents/file-response.ts`: a document over
   `RESPONSE_INLINE_MAX_BYTES` (4 MiB) is written to the private `packs` bucket
   under `downloads/<projectId>/<uuid>/<name>` and answered `302` to a signed
   URL for that one object, valid `SIGNED_DOWNLOAD_TTL_S` (300 s), after the
   route's own session / membership / pack-job / identity gates. The pack-export
   transport follows the redirect.
6. **Orphans** — `GET /api/cron/uploads-sweep` (Vercel Cron, daily 01:15 UTC,
   `vercel.json`; `Authorization: Bearer $CRON_SECRET`) deletes `uploads/pending/`
   and `packs/downloads/` objects older than 24 h. **Dry-run (logged) until
   `UPLOAD_SWEEP_APPLY="true"`.** Without `CRON_SECRET` it answers 503.
7. **One error shape** for every kind: `{code: payload_too_large |
   unsupported_type | upload_failed, kind, error}` — `error` is a sentence that
   names no number (the K6 copy rule). 413 / 415 / 400.

`next.config.ts`'s `experimental.proxyClientMaxBodySize` is removed: no request
body carries a file any more.

## Verification

- **Unit** (`lib/uploads/__tests__`, synthetic files generated in-test): 6 MB
  and 19 MB PDFs sign → PUT → complete → a project; 21 MB refused at sign with
  no URL and zero bytes stored; declared 1 MB / actual 6 MB quote ⇒ 413 +
  deleted; `.exe` renamed `.pdf` ⇒ 415 + deleted; a second account cannot sign
  for the first's project or firm (403); a path not signed by the caller ⇒ 403;
  the limits grep test; 052 = the table; `fileResponse` inline vs 302; the sweep
  dry-run vs apply. Route-auth: upload routes reach `finishUpload`/`signUpload`,
  which authorize before any storage call.
- **Live on dev** (`node scripts/upload-direct-check.mjs 3098`, `pack` server,
  real Storage): 6 MB plan (the canonical first-floor plan padded after `%%EOF`)
  → PUT direct to Storage → complete → **parse-plan 200, 14 rooms**; the 16.1 MB
  canonical bedroom photo into the asset library; 21 MB → 413 at sign; declared
  1 MB / actual 21 MB → 413 + deleted; `.exe` as `.pdf` → 415 + deleted; a PUT
  above the bucket cap refused by Storage itself; second account 403 / 403; no
  session 401; the reference garden's **7.28 MB render pack and 4.58 MB drawing
  set → 302 → signed URL (299 s) → the PDF**, and no session ⇒ 401, no redirect.
  The sweep dry-run against dev lists the staged downloads (clock + 2 days) and
  deletes nothing.
- **Preview: not possible.** Previews sit behind Vercel Authentication and the
  Supabase env vars are Production-scoped, so nobody can sign in on one. Dev
  stands in (same code, same Storage API).
- **Prod after merge**: one real 6 MB plan upload by Abdallah through intake.

## Deploy order

1. `npm run db:push` against **prod** for `20260101005200_upload_bucket.sql`
   (the private `uploads` bucket) — **before** merging; without it every sign
   fails (no bucket).
2. Vercel env: `CRON_SECRET` (any long random string; Vercel Cron sends it).
   Leave `UPLOAD_SWEEP_APPLY` unset for the first runs, read the logged dry-run,
   then set it to `"true"`.
3. Merge → prod deploy → the 6 MB plan check.
