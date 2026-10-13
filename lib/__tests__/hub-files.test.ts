import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FILES_SHOWN, HubFiles } from "@/components/blueprint/hub/HubFiles";
import type { AssetLite } from "@/lib/assets/types";

// K10 #9 — "Project files" on the Overview / hub: on the body grid (the
// screens' `files` slot, not a full-width block below the page), the first 5
// and "Show all N".
const ROOT = path.resolve(__dirname, "../..");
const asset = (i: number, kind: AssetLite["kind"] = "photo"): AssetLite => ({ id: `a${i}`, kind, filename: `file-${i}.jpg`, bytes: 1024 * (i + 1), url: `https://x.test/${i}.jpg`, room_id: null });
const html = (assets: AssetLite[]) => renderToStaticMarkup(createElement(HubFiles, { assets }));

describe("Project files on the Overview", () => {
  it("shows the first 5 and offers the rest", () => {
    const out = html([asset(0, "floorplan"), ...Array.from({ length: 7 }, (_, i) => asset(i + 1))]);
    expect(FILES_SHOWN).toBe(5);
    expect(out).toContain('data-files-shown="5"');
    expect((out.match(/<li /g) ?? []).length).toBe(5);
    expect(out).toContain("Show all 8");
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain("8 files");
  });

  it("five or fewer: all of them, no button; none: nothing", () => {
    const out = html([asset(1), asset(2), asset(3)]);
    expect((out.match(/<li /g) ?? []).length).toBe(3);
    expect(out).not.toContain("Show all");
    expect(html([])).toBe("");
  });

  it("sits on the body grid: both screens take it as a slot, the page passes it in", () => {
    const page = readFileSync(path.join(ROOT, "app/project/[id]/page.tsx"), "utf8");
    expect(page).toContain("<OwnerOverview view={view} files={<HubFiles assets={files} />} />");
    expect(page).toContain('<HubScreen view={view} files={<HubFiles assets={files} className="mt-14" />} />');
    expect(page).not.toMatch(/^\s*<HubFiles assets=\{files\} \/>\s*$/m);
    const owner = readFileSync(path.join(ROOT, "components/blueprint/hub/OwnerOverview.tsx"), "utf8");
    // In the main column, before the aside (Next and documents).
    expect(owner.indexOf("{files}")).toBeGreaterThan(-1);
    expect(owner.indexOf("{files}")).toBeLessThan(owner.indexOf('<aside aria-label="Next and documents"'));
  });
});
