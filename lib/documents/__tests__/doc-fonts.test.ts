import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DOCUMENT_FONT_DIR, documentFontFiles, documentFontOptions } from "../doc-fonts";

// K9 (K8 review ruling 1): every server-rendered document prints in IBM Plex
// Sans, JetBrains Mono and EB Garamond — OFL TTFs shipped with their licences.
const ROOT = path.resolve(__dirname, "../../..");
const sources = JSON.parse(readFileSync(path.join(DOCUMENT_FONT_DIR, "SOURCES.json"), "utf8")) as { files: Record<string, { sha256: string; url: string }> };

describe("document fonts", () => {
  it("ships every family the documents name, as TrueType", () => {
    const names = documentFontFiles().map((f) => path.basename(f));
    for (const family of ["IBMPlexSans", "JetBrainsMono", "EBGaramond"]) expect(names.some((n) => n.startsWith(family)), family).toBe(true);
    for (const f of documentFontFiles()) expect(readFileSync(f).subarray(0, 4).toString("hex"), f).toBe("00010000");
  });

  it("each file is the one SOURCES.json records, and each family carries its OFL licence", () => {
    for (const f of readdirSync(DOCUMENT_FONT_DIR).filter((x) => x !== "SOURCES.json")) {
      expect(sources.files[f], f).toBeDefined();
      expect(createHash("sha256").update(readFileSync(path.join(DOCUMENT_FONT_DIR, f))).digest("hex"), f).toBe(sources.files[f]!.sha256);
    }
    for (const lic of ["IBMPlexSans-LICENSE.txt", "JetBrainsMono-OFL.txt", "EBGaramond-OFL.txt"]) {
      expect(readFileSync(path.join(DOCUMENT_FONT_DIR, lic), "utf8")).toMatch(/SIL OPEN FONT LICENSE/i);
    }
  });

  it("maps the generic families onto them", () => {
    expect(documentFontOptions()).toMatchObject({ sansSerifFamily: "IBM Plex Sans", serifFamily: "EB Garamond", monospaceFamily: "JetBrains Mono" });
  });

  it("every resvg render in the app passes the document fonts, and its route traces them", () => {
    const files = ["lib/documents/boq-pdf.ts", "lib/documents/render-pack-pdf.ts", "lib/drawings/export.ts"];
    for (const f of files) {
      const src = readFileSync(path.join(ROOT, f), "utf8");
      const calls = src.split("\n").filter((l) => l.includes("new Resvg("));
      expect(calls.length, f).toBeGreaterThan(0);
      for (const c of calls) expect(c, f).toContain("documentFontOptions()");
    }
    const config = readFileSync(path.join(ROOT, "next.config.ts"), "utf8");
    for (const r of ["boq-pdf", "proposal", "boq-diff", "drawings", "render-pack"]) expect(config).toContain(`"/api/projects/[id]/${r}": ["./lib/documents/fonts/**"]`);
  });
});
