import { describe, expect, it } from "vitest";

import {
  buildJoinerySection,
  buildAluminumSection,
  appendJoineryAluminumSections,
} from "../joinery-aluminum";
import { ALUMINUM, TRADE_TOTALS } from "@/lib/ground-truth/mudon-actuals";

// Mudon parse: master_bedroom×1, bedroom×2, bathroom×1, ensuite×1, powder×1.
const MUDON_ROOMS = [
  { room_type: "master_bedroom" }, { room_type: "bedroom" }, { room_type: "bedroom" },
  { room_type: "bathroom" }, { room_type: "ensuite" }, { room_type: "powder" },
  { room_type: "living" }, { room_type: "terrace" }, { room_type: "stairs" },
];

describe("Joinery section (Step 4)", () => {
  const section = buildJoinerySection(MUDON_ROOMS)!;

  it("produces joinery lines, all supply_and_install with actual provenance", () => {
    expect(section.work_section).toBe("Joinery");
    expect(section.lines.length).toBeGreaterThan(0);
    for (const l of section.lines) {
      expect(l.scope).toBe("supply_and_install");
      expect(l.rate_status).toBe("actual_transaction");
      expect(l.total_aed).toBe(Math.round(l.quantity * l.rate_aed));
    }
  });

  it("never emits an install/labour line (composites price their own install)", () => {
    expect(section.lines.some((l) => /install|labour/i.test(l.description))).toBe(false);
  });

  it("totals in the ballpark of the Atrium net actual (heuristic, not exact)", () => {
    // Heuristic quantities → 66,016; Atrium net actual = 70,090.56. Delta is the
    // point (captured in the delta log), so allow a band, not an equality.
    expect(section.section_total_aed).toBeGreaterThan(55_000);
    expect(section.section_total_aed).toBeLessThan(TRADE_TOTALS.joinery.excl_vat * 1.1);
  });
});

describe("Aluminum & Glass section (Step 4)", () => {
  const section = buildAluminumSection()!;

  it("is all site_assessment allowances carrying the measurement caveat", () => {
    expect(section.work_section).toBe("Aluminum & Glass");
    expect(section.lines).toHaveLength(ALUMINUM.length);
    for (const l of section.lines) {
      expect(l.rate_status).toBe("site_assessment");
      expect(l.notes).toMatch(/allowance only/i);
    }
  });

  it("reconciles to the quoted total (92,449)", () => {
    expect(section.section_total_aed).toBe(TRADE_TOTALS.aluminum.excl_vat);
  });
});

describe("append post-pass", () => {
  const baseBoq = {
    sections: [{ work_section: "Floor Finishes", lines: [], section_total_aed: 100_000 }],
    subtotal_aed: 100_000, contingency_pct: 8, contingency_aed: 8_000, vat_pct: 5, vat_aed: 5_400,
    grand_total_aed: 113_400,
  };

  it("adds both sections and recomputes the total chain", () => {
    const out = appendJoineryAluminumSections(baseBoq, MUDON_ROOMS);
    const names = out.sections.map((s) => s.work_section);
    expect(names).toContain("Joinery");
    expect(names).toContain("Aluminum & Glass");
    expect(out.subtotal_aed).toBe(out.sections.reduce((s, x) => s + x.section_total_aed, 0));
    expect(out.grand_total_aed).toBe(out.subtotal_aed + out.contingency_aed + out.vat_aed);
  });

  it("supersedes the engine's generic Joinery & Carpentry (no double-count)", () => {
    const withEngineJoinery = {
      ...baseBoq,
      sections: [
        ...baseBoq.sections,
        { work_section: "Joinery & Carpentry", lines: [], section_total_aed: 26_080 },
      ],
    };
    const out = appendJoineryAluminumSections(withEngineJoinery, MUDON_ROOMS);
    // The engine estimate is dropped; only the actuals-based Joinery remains.
    expect(out.sections.filter((s) => s.work_section === "Joinery & Carpentry")).toHaveLength(0);
    expect(out.sections.filter((s) => s.work_section === "Joinery")).toHaveLength(1);
  });

  it("is idempotent (no duplicate sections on re-append)", () => {
    const once = appendJoineryAluminumSections(baseBoq, MUDON_ROOMS);
    const twice = appendJoineryAluminumSections(once, MUDON_ROOMS);
    expect(twice.sections.filter((s) => s.work_section === "Joinery")).toHaveLength(1);
    expect(twice.sections.filter((s) => s.work_section === "Aluminum & Glass")).toHaveLength(1);
    expect(twice.grand_total_aed).toBe(once.grand_total_aed);
  });
});
