import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// T5 — no ungated output path remains. Two halves:
//   1. every route that produces a client document calls guardDocumentRoute;
//   2. nothing in the app's UI links or fetches those routes directly — the only
//      way in is the Export pack action (components/documents/PackExport.tsx),
//      which talks to /pack-export and receives signed links to a PASSED job.
// Plus the guard's own behaviour, flag off and on.

const ROOT = path.resolve(__dirname, "../../../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|mjs)$/.test(name)) out.push(p);
  }
  return out;
}
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join("/");

const DOCUMENT_ROUTES = [
  "app/api/projects/[id]/drawings/route.ts",
  "app/api/projects/[id]/render-pack/route.ts",
  "app/api/projects/[id]/boq-pdf/route.ts",
];

describe("every document route is gated", () => {
  it.each(DOCUMENT_ROUTES)("%s calls guardDocumentRoute", (file) => {
    const src = readFileSync(path.join(ROOT, file), "utf8");
    expect(src).toMatch(/guardDocumentRoute\(request, /);
  });

  it("no other route renders a client PDF", () => {
    const producers = walk(path.join(ROOT, "app"))
      .filter((f) => /route\.ts$/.test(f))
      .filter((f) => /\b(generateDrawingSetPdf|generateRenderPack|renderBoqPdf|renderSheetPdf)\b/.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(producers.every((f) => DOCUMENT_ROUTES.includes(f))).toBe(true);
  });

  it("the design-lock archive mints no download URL", () => {
    const src = readFileSync(path.join(ROOT, "lib/drawings/persist.ts"), "utf8");
    expect(src).not.toMatch(/createSignedUrl/);
  });
});

describe("the UI has no direct link to a document route", () => {
  const DIRECT = /\/api\/projects\/\$\{[^}]+\}\/(drawings|render-pack|boq-pdf)\b/;
  const files = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "components"))].filter((f) => !/[\\/]api[\\/]/.test(f));

  it("scans the app's pages and components", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("finds none", () => {
    const hits = files.filter((f) => DIRECT.test(readFileSync(f, "utf8"))).map(rel);
    expect(hits).toEqual([]);
  });

  it("the export entry points are the Export pack action only", () => {
    const entry = files.filter((f) => /pack-export|PackExport|drawings\?export=1/.test(readFileSync(f, "utf8"))).map(rel).sort();
    expect(entry).toEqual([
      "app/project/[id]/boq/_components/boq-view.tsx",
      "app/project/[id]/boq/page.tsx",
      "app/project/[id]/drawings/page.tsx",
      "components/documents/PackExport.tsx",
    ]);
  });
});

// --- the guard ---------------------------------------------------------------------
const job = { value: null as null | { project_id: string; status: string; started_at: string } };
vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: job.value ? { id: "j", ...job.value } : null }) }) }),
    }),
  }),
}));

describe("guardDocumentRoute", () => {
  const PID = "00000000-0000-4000-8000-0000000000aa";
  const JOB = "00000000-0000-4000-8000-0000000000bb";
  const env = { ...process.env };
  beforeEach(() => {
    process.env.PACK_EXPORT_ENABLED = "true";
    process.env.DRAWINGS_ENABLED = "true";
    job.value = null;
  });
  afterEach(() => {
    process.env = { ...env };
  });
  const req = async (headers: Record<string, string> = {}) => {
    const { NextRequest } = await import("next/server");
    return new NextRequest(`http://localhost/api/projects/${PID}/boq-pdf`, { headers });
  };

  it("flag off → 404 (invisible), even to a job", async () => {
    const { guardDocumentRoute, packExportEnabled } = await import("../guard");
    process.env.PACK_EXPORT_ENABLED = "false";
    expect(packExportEnabled()).toBe(false);
    job.value = { project_id: PID, status: "running", started_at: new Date().toISOString() };
    expect((await guardDocumentRoute(await req({ "x-pack-export-job": JOB }), PID))!.status).toBe(404);
  });

  it("the one visibility rule needs DRAWINGS_ENABLED too (the old BoQ-button 404)", async () => {
    const { packExportEnabled } = await import("../guard");
    process.env.DRAWINGS_ENABLED = "false";
    expect(packExportEnabled()).toBe(false);
  });

  it("a running job for this project is served", async () => {
    const { guardDocumentRoute } = await import("../guard");
    job.value = { project_id: PID, status: "running", started_at: new Date().toISOString() };
    expect(await guardDocumentRoute(await req({ "x-pack-export-job": JOB }), PID)).toBeNull();
  });

  it("a finished job, another project's job or an expired job is not", async () => {
    const { guardDocumentRoute } = await import("../guard");
    for (const v of [
      { project_id: PID, status: "passed", started_at: new Date().toISOString() },
      { project_id: "00000000-0000-4000-8000-0000000000cc", status: "running", started_at: new Date().toISOString() },
      { project_id: PID, status: "running", started_at: new Date(Date.now() - 4 * 3600_000).toISOString() },
    ]) {
      job.value = v;
      expect((await guardDocumentRoute(await req({ "x-pack-export-job": JOB }), PID))!.status).toBe(403);
    }
  });

  it("a browser navigation is sent to Export pack; a bare request gets a readable 403", async () => {
    const { guardDocumentRoute } = await import("../guard");
    const nav = (await guardDocumentRoute(await req({ accept: "text/html" }), PID))!;
    expect(nav.status).toBe(303);
    expect(nav.headers.get("location")).toBe(`http://localhost/project/${PID}/drawings?export=1`);
    const api = (await guardDocumentRoute(await req(), PID))!;
    expect(api.status).toBe(403);
    expect(await api.json()).toMatchObject({ code: "use_pack_export" });
  });
});
