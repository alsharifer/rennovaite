-- 052_upload_bucket.sql — the private bucket for direct-to-storage uploads (H9).
--
-- Vercel caps a function's request body at ~4.5 MB (measured 12 Oct), so a
-- floorplan, drawing, photo batch or quote workbook above that never reached
-- the upload routes. Since H9 the browser PUTs the file straight to Storage on a
-- signed upload URL (POST /api/uploads/sign) for a server-chosen path
--     pending/<kind>/<project|firm id | new>/<signer>/<uuid>.<ext>
-- and POST /api/uploads/complete verifies it (real size, magic bytes, the
-- signer) before moving it where the pipeline expects it (plan-uploads, as
-- before). Pending objects live HERE:
--
--   * PRIVATE (public = false): nothing in it is reachable by URL.
--   * NO storage policies are created: no anonymous or authenticated insert or
--     select — only the service role and the single-object signed upload
--     tokens the sign route mints.
--   * file_size_limit is the largest kind in lib/uploads/limits.ts (25 MiB,
--     project assets) — defence in depth: Storage itself refuses a bigger PUT.
--     A test holds this number equal to the table (lib/uploads/__tests__).
--
-- Pending objects never completed are swept daily (GET /api/cron/uploads-sweep,
-- older than 24 h). Additive: no existing bucket or object changes.

insert into storage.buckets (id, name, public, file_size_limit)
values ('uploads', 'uploads', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;
