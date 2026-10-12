// =============================================================================
// An in-memory Supabase Storage for the H9 tests — attached to fakeDb's client
// as `storage`. Buckets hold { bytes, created_at }; a signed upload URL is only
// a token for one path, and `browserPut` plays the browser's PUT to it (the
// bytes never pass through a route). `list` answers one folder at a time with
// folders as `id: null`, like Storage.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

export interface StoredObject {
  bytes: Uint8Array;
  created_at: string;
}

export interface FakeStorage {
  buckets: Map<string, Map<string, StoredObject>>;
  /** Paths a signed upload URL was minted for. */
  signed: Set<string>;
  /** The browser's PUT to a signed URL. */
  browserPut(signedUrl: string, bytes: Uint8Array): number;
  objects(bucket: string): string[];
}

const bucketOf = (s: FakeStorage, name: string) => {
  let b = s.buckets.get(name);
  if (!b) s.buckets.set(name, (b = new Map()));
  return b;
};

export function attachStorage(client: SupabaseClient, opts: { now?: () => Date } = {}): FakeStorage {
  const now = opts.now ?? (() => new Date());
  const s: FakeStorage = {
    buckets: new Map(),
    signed: new Set(),
    browserPut(signedUrl, bytes) {
      const m = /^https:\/\/storage\.test\/upload\/sign\/([^/]+)\/(.+)\?token=/.exec(signedUrl);
      if (!m || !s.signed.has(`${m[1]}/${m[2]}`)) return 403;
      const b = bucketOf(s, m[1]!);
      if (b.has(m[2]!)) return 409;
      b.set(m[2]!, { bytes, created_at: now().toISOString() });
      return 200;
    },
    objects: (bucket) => [...bucketOf(s, bucket).keys()],
  };
  (client as unknown as { storage: unknown }).storage = {
    from: (bucket: string) => ({
      createSignedUploadUrl: async (path: string) => {
        s.signed.add(`${bucket}/${path}`);
        return { data: { signedUrl: `https://storage.test/upload/sign/${bucket}/${path}?token=t`, token: "t", path }, error: null };
      },
      download: async (path: string) => {
        const o = bucketOf(s, bucket).get(path);
        return o ? { data: new Blob([o.bytes as BlobPart]), error: null } : { data: null, error: { message: "Object not found" } };
      },
      upload: async (path: string, bytes: Uint8Array) => {
        const b = bucketOf(s, bucket);
        if (b.has(path)) return { data: null, error: { message: "The resource already exists" } };
        b.set(path, { bytes, created_at: now().toISOString() });
        return { data: { path }, error: null };
      },
      remove: async (paths: string[]) => {
        for (const p of paths) bucketOf(s, bucket).delete(p);
        return { data: paths.map((name) => ({ name })), error: null };
      },
      createSignedUrl: async (path: string, ttl: number, o?: { download?: string }) => ({
        data: { signedUrl: `https://storage.test/object/sign/${bucket}/${path}?ttl=${ttl}${o?.download ? `&download=${o.download}` : ""}` },
        error: null,
      }),
      list: async (prefix: string, o: { limit: number; offset: number }) => {
        const entries = new Map<string, { name: string; id: string | null; created_at: string | null }>();
        for (const [path, obj] of bucketOf(s, bucket)) {
          if (!path.startsWith(`${prefix}/`)) continue;
          const [head, ...rest] = path.slice(prefix.length + 1).split("/");
          entries.set(head!, rest.length ? { name: head!, id: null, created_at: null } : { name: head!, id: `id-${path}`, created_at: obj.created_at });
        }
        return { data: [...entries.values()].slice(o.offset, o.offset + o.limit), error: null };
      },
    }),
  };
  return s;
}

// --- Synthetic files (generated in-test; never client drawings) ----------------------

const fill = (n: number, head: number[] | string) => {
  const b = new Uint8Array(n);
  const h = typeof head === "string" ? [...head].map((c) => c.charCodeAt(0)) : head;
  b.set(h.slice(0, n));
  for (let i = h.length; i < n; i++) b[i] = 0x20 + (i % 90);
  return b;
};

export const syntheticPdf = (n: number) => fill(n, "%PDF-1.7\n%synthetic H9 test file\n");
export const syntheticPng = (n: number) => fill(n, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const syntheticXlsx = (n: number) => fill(n, [0x50, 0x4b, 0x03, 0x04]);
/** A Windows executable's header — what a ".exe renamed .pdf" really is. */
export const syntheticExe = (n: number) => fill(n, "MZ\x90\x00\x03\x00\x00\x00This program cannot be run in DOS mode.");
