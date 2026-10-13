import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FIRM_STEPS, OWNER_STEPS, nextOwnerStep, ownerStepHref, ownerSubTabs, type JourneyFlags } from "@/lib/journey";
import { stepEyebrow } from "@/lib/journey-eyebrow";

// =============================================================================
// K8 (spec §6.0) — the owner journey, rethought: seven steps with fixed
// numbers; 04 Cost and 06 Tender own two routes each (sub-tabs); 02 Design is
// one route with two views; the old step routes 308 to it.
// =============================================================================

const ON: JourneyFlags = { drawingsEnabled: true };
const OFF: JourneyFlags = { drawingsEnabled: false };

describe("the owner journey", () => {
  it("is 00 Overview · 01 Plan · 02 Design · 03 Renders · 04 Cost · 05 Timeline · 06 Tender", () => {
    expect(OWNER_STEPS.map((s) => `${s.number} ${s.label}`)).toEqual(["00 Overview", "01 Plan", "02 Design", "03 Renders", "04 Cost", "05 Timeline", "06 Tender"]);
  });

  it("numbers never move with a flag — Tender opens on suppliers when there are no drawings", () => {
    expect(ownerStepHref("tender", "p", ON)).toBe("/project/p/drawings");
    expect(ownerStepHref("tender", "p", OFF)).toBe("/project/p/vendors");
    expect(OWNER_STEPS.map((s) => s.number)).toEqual(["00", "01", "02", "03", "04", "05", "06"]);
  });

  it("every step opens on a route that exists", () => {
    const routes: Record<string, string> = {
      overview: "/project/p",
      plan: "/project/p/plan",
      design: "/project/p/design",
      renders: "/project/p/render",
      cost: "/project/p/boq",
      timeline: "/project/p/timeline",
      tender: "/project/p/drawings",
    };
    for (const s of OWNER_STEPS) expect(ownerStepHref(s.key, "p", ON), s.key).toBe(routes[s.key]);
  });

  it("04 Cost and 06 Tender carry their two routes as sub-tabs, each a real link", () => {
    expect(ownerSubTabs("cost", "p", ON).map((t) => [t.label, t.href])).toEqual([
      ["Bill of quantities", "/project/p/boq"],
      ["Specification", "/project/p/accessories"],
    ]);
    expect(ownerSubTabs("tender", "p", ON).map((t) => [t.label, t.href])).toEqual([
      ["Documents", "/project/p/drawings"],
      ["Contractors & suppliers", "/project/p/vendors"],
    ]);
    // No Documents tab where the drawings route does not exist.
    expect(ownerSubTabs("tender", "p", OFF).map((t) => t.key)).toEqual(["suppliers"]);
    expect(ownerSubTabs("design", "p", ON)).toEqual([]);
  });

  it("walks forward with no dead ends", () => {
    const walked = [OWNER_STEPS[0]!.key as string];
    for (let s = nextOwnerStep(OWNER_STEPS[0]!.key); s; s = nextOwnerStep(s.key)) walked.push(s.key);
    expect(walked).toEqual(OWNER_STEPS.map((s) => s.key));
  });

  it("keeps the 3D viewer off the numbered path", () => {
    expect(OWNER_STEPS.some((s) => s.activeOn.includes("/viewer"))).toBe(false);
  });

  it("the firm journey is untouched (00–08)", () => {
    expect(FIRM_STEPS.map((s) => s.number)).toEqual(["00", "01", "02", "03", "04", "05", "06", "07", "08"]);
  });

  it("a page's eyebrow names the reader's step", () => {
    expect(stepEyebrow("owner", "documents", "tender", "Documents")).toBe("06 · TENDER");
    expect(stepEyebrow("firm", "documents", "tender", "Documents")).toBe("06 · DOCUMENTS");
    expect(stepEyebrow("owner", "proposal", null, "Proposal")).toBe("PROPOSAL");
  });
});

describe("02 Design is one route; the old step routes 308 to it", () => {
  const config = readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8");
  it("permanent redirects from /ideation, /style, /moodboard", () => {
    expect(config).toContain(`{ source: "/project/:id/ideation", destination: "/project/:id/design", permanent: true }`);
    expect(config).toContain(`{ source: "/project/:id/style", destination: "/project/:id/design", permanent: true }`);
    expect(config).toContain(`{ source: "/project/:id/moodboard", destination: "/project/:id/design?view=references", permanent: true }`);
  });
  it("the old route folders are gone, so nothing can shadow a redirect", () => {
    for (const r of ["ideation", "style", "moodboard"]) {
      expect(() => readFileSync(path.join(process.cwd(), `app/project/[id]/${r}/page.tsx`))).toThrow();
    }
  });
});
