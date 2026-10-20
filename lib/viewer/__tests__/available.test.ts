// C5 #4 — the 3D view is linked only where it has something to show: every
// entry (01 Plan, the Overview, Renders) asks lib/viewer/available.ts — flag on
// AND the plan stands up walls — and the page itself never errors on a plan it
// cannot read, nor draws a blank canvas in a browser without WebGL.
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ROOT } from "@/lib/__tests__/helpers/import-graph";

const graph = vi.hoisted(() => ({ next: null as null | { walls: unknown[]; rooms: unknown[] } | Error }));
vi.mock("@/lib/plan/derive", () => ({
  derivePlanGraph: async () => {
    if (graph.next instanceof Error) throw graph.next;
    return graph.next;
  },
}));

const { viewerAvailable, viewerHref } = await import("../available");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("viewerAvailable — one answer for every entry", () => {
  it("flag on + walls → the link; open garden (no walls), unreadable plan, flag off → none", async () => {
    vi.stubEnv("VIEWER_3D_ENABLED", "true");
    graph.next = { walls: [{}], rooms: [{}] };
    expect(await viewerHref("p1")).toBe("/project/p1/viewer");
    graph.next = { walls: [], rooms: [{}] };
    expect(await viewerAvailable("p1")).toBe(false);
    graph.next = new Error("plan load failed");
    expect(await viewerAvailable("p1")).toBe(false);
    vi.stubEnv("VIEWER_3D_ENABLED", "");
    graph.next = { walls: [{}], rooms: [{}] };
    expect(await viewerHref("p1")).toBeNull();
  });

  it("no entry decides for itself", () => {
    const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
    expect(read("app/project/[id]/plan/page.tsx")).toMatch(/viewerHref\(projectId\)/);
    expect(read("app/project/[id]/render/page.tsx")).toMatch(/viewerHref=\{await viewerHref\(projectId\)\}/);
    expect(read("lib/hub/overview-view.ts")).toMatch(/viewerAvailable\(projectId\)/);
    for (const f of ["app/project/[id]/plan/page.tsx", "app/project/[id]/render/page.tsx", "lib/hub/overview-view.ts"]) expect(read(f), f).not.toMatch(/VIEWER_3D_ENABLED/);
  });

  it("the page: an unreadable plan is an empty state; no WebGL is a sentence, never a blank canvas", () => {
    const page = readFileSync(path.join(ROOT, "app/project/[id]/viewer/page.tsx"), "utf8");
    expect(page).toMatch(/derivePlanGraph\(projectId\)\.catch/);
    const viewer = readFileSync(path.join(ROOT, "components/blueprint/viewer/Viewer3D.tsx"), "utf8");
    expect(viewer).toMatch(/data-viewer-no-webgl/);
    expect(viewer).not.toMatch(/<\/SceneBoundary>\s*\) : null\}/);
  });
});
