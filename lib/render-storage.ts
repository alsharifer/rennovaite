// =============================================================================
// lib/render-storage.ts — durable re-hosting of render outputs.
//
// Replicate delivery URLs (`replicate.delivery/...`) are EPHEMERAL — the output
// is deleted within ~a day, after which the stored image_url 404s and the render
// shows as a broken image. To keep locked/approved renders durable, we copy the
// bytes into a PUBLIC Supabase Storage bucket (`renders`) at generation time and
// store that permanent public URL instead.
//
// Fully best-effort: any failure (bucket missing, fetch/upload error, or the URL
// is already durable) returns the ORIGINAL url, so a storage gap never breaks a
// completed render — it just falls back to today's ephemeral-URL behaviour.
//
// Manual step: create a PUBLIC Storage bucket named `renders` (Supabase → Storage
// → New bucket → Public). Without it, uploads no-op and the source url is kept.
// =============================================================================

import { getSupabaseAdmin } from "@/lib/supabase-admin";

const BUCKET = "renders";

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
};

function supabaseHost(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").host;
  } catch {
    return "";
  }
}

/**
 * Copy an image URL into the public `renders` bucket and return a durable public
 * URL. `pathBase` is the object path WITHOUT extension (e.g.
 * `projects/<id>/renders/<renderId>`); the extension is inferred from the
 * response content-type. Returns the original url unchanged on any failure or
 * when the url already points at our own Supabase Storage.
 */
export async function rehostImage(
  sourceUrl: string,
  pathBase: string,
): Promise<string> {
  if (!sourceUrl) return sourceUrl;

  // Already durable (our own Supabase storage) → nothing to do.
  const host = supabaseHost();
  if (host && sourceUrl.includes(host)) return sourceUrl;

  try {
    const res = await fetch(sourceUrl);
    if (!res.ok) {
      console.warn(`[render-storage] source fetch ${res.status} — keeping url`);
      return sourceUrl;
    }
    const contentType = (res.headers.get("content-type") || "image/png")
      .split(";")[0]!
      .trim();
    const ext = EXT_BY_TYPE[contentType] ?? "png";
    const bytes = new Uint8Array(await res.arrayBuffer());

    const storage = getSupabaseAdmin().storage.from(BUCKET);
    const path = `${pathBase}.${ext}`;
    const { error } = await storage.upload(
      path,
      new Blob([bytes], { type: contentType }),
      { upsert: true, contentType, cacheControl: "31536000" },
    );
    if (error) {
      console.warn("[render-storage] upload skipped:", error.message);
      return sourceUrl;
    }
    const publicUrl = storage.getPublicUrl(path).data.publicUrl;
    return publicUrl || sourceUrl;
  } catch (e) {
    console.warn(
      "[render-storage] rehost failed (keeping source url):",
      e instanceof Error ? e.message : e,
    );
    return sourceUrl;
  }
}

/**
 * G4b: upload bytes we produced ourselves (a 3D scene render) to the `renders`
 * bucket and return the public URL. Unlike rehostImage this is NOT best-effort:
 * a scene image is the geometry authority a render is checked against, so a
 * failed upload is an error the caller must see.
 */
export async function uploadRenderBytes(path: string, bytes: Uint8Array, contentType: "image/png" | "image/jpeg"): Promise<string> {
  const storage = getSupabaseAdmin().storage.from(BUCKET);
  // G5d: a dropped connection ("fetch failed") is transient — it lost two views of a
  // paid render run. Retry it (the upload is an upsert); a real storage error still
  // throws on the last try.
  let error: { message: string } | null = null;
  for (let i = 0; i < 4; i++) {
    ({ error } = await storage.upload(path, new Blob([bytes as BlobPart], { type: contentType }), { upsert: true, contentType, cacheControl: "31536000" }));
    if (!error || !/fetch failed|network|timeout|ECONNRESET/i.test(error.message)) break;
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  if (error) throw new Error(`render upload failed (${path}): ${error.message}`);
  return storage.getPublicUrl(path).data.publicUrl;
}
