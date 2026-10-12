# H9 — uploads over ~4.5 MB never reach the app (direct-to-storage signed uploads)

*Status: **written up, not started** (2026-10-12). Runs next, before K3. Not
worked around in K.*

## The finding

Vercel rejects a request body over ~4.5 MB before our code runs: the response is
a plain-text `413 FUNCTION_PAYLOAD_TOO_LARGE`, not our structured 413.

Measured on 2026-10-12 against **production** (`https://rennovaite.vercel.app`,
the same Vercel project and platform limits as every preview), with
unauthenticated multipart `POST /api/upload` requests — so nothing was created
and no sign-in was needed. A request that passes the platform reaches our proxy
and is answered `401 unauthenticated`; one that does not is answered by Vercel:

| Body | Response | Reached the app? |
|---|---|---|
| 1.0 MB PDF | `401 application/json {"code":"unauthenticated"}` | yes |
| 4.3 MB PDF | `401` | yes |
| 4.7 MB PDF | `413 text/plain` `FUNCTION_PAYLOAD_TOO_LARGE` | **no** |
| 6.2 MB PDF | `413 text/plain` `FUNCTION_PAYLOAD_TOO_LARGE` | **no** |

**Not done: the same 6 MB PDF through the intake UI on a preview deployment.**
Previews sit behind Vercel Authentication (no Vercel CLI here), and intake needs
a magic-link sign-in to the preview (the built-in mailer was rate-limited that
day). The production measurement is the same platform limit; the intake would
show its generic "Upload failed (413)." for any plan over the limit, because the
platform's body is not JSON.

## Who it hits

| Path | Limit we enforce | Client-side compression | Over ~4.5 MB today |
|---|---|---|---|
| `POST /api/upload` — intake floorplan (PDF / PNG / JPG) | 20 MB (structured 413 since K1) | images only; **PDFs are sent as-is** | platform 413 |
| `POST /api/project-asset` — drawings (PDF / DWG / DXF), photos | 25 MB | photos compressed (S1); **drawings as-is** | platform 413 for drawings |
| `POST /api/room-photo` | 20 MB | compressed to ~0.5–2 MB | fine in practice |
| `POST /api/firms/:id/quotes` — quote workbook | 5 MB | none | platform 413 between 4.5 and 5 MB |
| `POST /api/firms/:id/branding` — logo | 1 MB | none | fine |

The pilot is not blocked today — the real plans on file are 0.6–1.6 MB — but a
scanned or photographed drawing set passes 4.5 MB easily.

## The fix (H9)

Bytes never pass through a function:

1. **Ask** — the client calls a small route (`POST /api/uploads/sign`, signed-in
   + project membership, H1/H5) with `{ project_id, kind, filename, mime,
   bytes }`. The route validates kind / type / size with the SAME rules the
   upload routes use today (`lib/assets/types.ts`, the plan's PDF/PNG/JPG set,
   the size caps) and answers a Supabase Storage signed upload URL
   (`createSignedUploadUrl`) for a path it chooses (`<projectId>/…`).
2. **Upload** — the browser PUTs the file straight to Storage
   (`uploadToSignedUrl`), with progress.
3. **Register** — the client calls the existing route with the storage PATH,
   not the bytes. The route re-checks the object (size + content type from the
   storage metadata, the path is the one it signed for this project), then does
   what it does today (insert the project / asset row, start the parse) and
   removes the object if registration fails.

Same for quotes (the workbook is read from Storage server-side). Logos and room
photos can stay as they are.

**Acceptance**: a 15 MB plan PDF and a 15 MB drawing go through intake on a
preview deployment; an over-cap file gets our structured 413 / the intake's
"too large" state (never the platform's); a signed URL for project A cannot
register into project B (isolation sweep extended); the sign-in limit message
gets the right wait ("about an hour", not "a minute").
