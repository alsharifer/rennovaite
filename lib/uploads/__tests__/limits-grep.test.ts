// =============================================================================
// H9 — one limits table, large responses by redirect, the orphan sweep.
// =============================================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { fakeDb } from "@/lib/firms/__tests__/fake-db";
import { fileResponse } from "@/lib/documents/file-response";

import { MAX_UPLOAD_BYTES, MiB, PENDING_MAX_AGE_MS, RESPONSE_INLINE_MAX_BYTES, SIGNED_DOWNLOAD_TTL_S } from "../limits";
import { sweepStaleUploads } from "../sweep";
import { attachStorage, syntheticPdf } from "./fake-storage";

const ROOT = path.resolve(__dirname, "../../..");

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(full);
  }
  return out;
}

const rel = (f: string) => path.relative(ROOT, f).replace(/\\/g, "/");

/** Numeric byte limits allowed outside the table — each with its reason. */
const NOT_UPLOAD_LIMITS: Record<string, string> = {
  "lib/image/compress.ts": "PASSTHROUGH_MAX_BYTES is a compression parameter (when a photo is small enough to skip re-encoding), not an upload limit",
};

const LIMIT_PATTERNS: [RegExp, string][] = [
  [/\b\d+\s*\*\s*1024\s*\*\s*1024\b/, "a MB literal"],
  [/\b\d+(?:\.\d+)?\s*\*\s*MiB\b/, "a MiB multiple"],
  [/\b(?:MAX_[A-Z_]*BYTES|[A-Z_]*_MAX_BYTES|maxBytes|maxSize|bodySizeLimit)\s*[:=]\s*[\d"'`]/, "a numeric size limit"],
  [/\bproxyClientMaxBodySize\s*:/, "a request-body size override"],
];

describe("H9 — no numeric upload limit outside lib/uploads/limits.ts", () => {
  it("app, lib, components, proxy and next.config read the table", () => {
    const files = [...sources(path.join(ROOT, "app")), ...sources(path.join(ROOT, "lib")), ...sources(path.join(ROOT, "components")), path.join(ROOT, "next.config.ts"), path.join(ROOT, "proxy.ts")];
    const offences: string[] = [];
    for (const f of files) {
      const r = rel(f);
      if (r === "lib/uploads/limits.ts" || NOT_UPLOAD_LIMITS[r]) continue;
      readFileSync(f, "utf8")
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (/^\s*(\/\/|\*)/.test(line)) return; // comments explain; they do not limit
          for (const [re, what] of LIMIT_PATTERNS) if (re.test(line)) offences.push(`${r}:${i + 1} — ${what}: ${line.trim()}`);
        });
    }
    expect(offences).toEqual([]);
  });

  it("the private bucket's own cap (migration 052) is the table's largest kind", () => {
    const sql = readFileSync(path.join(ROOT, "supabase/migrations/20260101005200_upload_bucket.sql"), "utf8");
    const m = /values\s*\(\s*'uploads'\s*,\s*'uploads'\s*,\s*false\s*,\s*(\d+)\s*\)/i.exec(sql);
    expect(m, "052 inserts the uploads bucket").not.toBeNull();
    expect(Number(m![1])).toBe(MAX_UPLOAD_BYTES);
    expect(sql).not.toMatch(/create\s+policy/i); // no anonymous (or any) insert policy
  });
});

describe("H9 — a document response above the inline cap is a 302 to a signed URL", () => {
  it("small: the bytes inline", async () => {
    const db = fakeDb();
    const storage = attachStorage(db.client);
    const res = await fileResponse(db.client, syntheticPdf(MiB), { filename: "boq.pdf", contentType: "application/pdf", projectId: "p1" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("boq.pdf");
    expect(storage.objects("packs")).toEqual([]);
  });

  it("large: stored privately, one object, short-lived signed redirect", async () => {
    const db = fakeDb();
    const storage = attachStorage(db.client);
    const bytes = syntheticPdf(RESPONSE_INLINE_MAX_BYTES + 1);
    const res = await fileResponse(db.client, bytes, { filename: "Arabella render pack.pdf", contentType: "application/pdf", projectId: "p1" });
    expect(res.status).toBe(302);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const stored = storage.objects("packs");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatch(/^downloads\/p1\/[0-9a-f-]{36}\/Arabella_render_pack\.pdf$/);
    const loc = res.headers.get("location")!;
    expect(loc).toContain(`/object/sign/packs/${stored[0]}`);
    expect(loc).toContain(`ttl=${SIGNED_DOWNLOAD_TTL_S}`);
    expect(SIGNED_DOWNLOAD_TTL_S).toBeLessThanOrEqual(600); // minutes, not hours
  });
});

describe("H9 — the daily orphan sweep", () => {
  const now = new Date("2026-10-12T01:15:00Z");
  const old = new Date(now.getTime() - PENDING_MAX_AGE_MS - 60_000);

  async function seeded() {
    let clock = old;
    const db = fakeDb();
    const storage = attachStorage(db.client, { now: () => clock });
    const up = (bucket: string, p: string) => db.client.storage.from(bucket).upload(p, syntheticPdf(10));
    await up("uploads", "pending/plan/new/u1/a.pdf");
    await up("packs", "downloads/p1/x/old.pdf");
    await up("packs", "runs/p1/keep-me.pdf"); // a pack output — never swept
    await up("plan-uploads", "p1/plan.pdf"); // a real upload — never swept
    clock = now;
    await up("uploads", "pending/plan/new/u1/b.pdf"); // fresh: an upload in progress
    return { db, storage };
  }

  it("dry-run lists what is stale and deletes nothing", async () => {
    const { db, storage } = await seeded();
    const r = await sweepStaleUploads(db.client, { now, apply: false });
    expect(r.stale.map((s) => `${s.bucket}/${s.path}`).sort()).toEqual(["packs/downloads/p1/x/old.pdf", "uploads/pending/plan/new/u1/a.pdf"]);
    expect(r.deleted).toBe(0);
    expect(storage.objects("uploads")).toHaveLength(2);
  });

  it("apply deletes only stale pending uploads and staged downloads", async () => {
    const { db, storage } = await seeded();
    const r = await sweepStaleUploads(db.client, { now, apply: true });
    expect(r.deleted).toBe(2);
    expect(storage.objects("uploads")).toEqual(["pending/plan/new/u1/b.pdf"]);
    expect(storage.objects("packs")).toEqual(["runs/p1/keep-me.pdf"]);
    expect(storage.objects("plan-uploads")).toEqual(["p1/plan.pdf"]);
  });
});
