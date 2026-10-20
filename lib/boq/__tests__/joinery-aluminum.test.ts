import { lineTotal, sumMoney } from "@/lib/boq/money";
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

  it("produces joinery lines, all supply_and_install, quoted lines from actuals", () => {
    expect(section.work_section).toBe("Joinery");
    expect(section.lines.length).toBeGreaterThan(0);
    for (const l of section.lines) {
      expect(l.scope).toBe("supply_and_install");
      expect(l.total_aed).toBe(lineTotal(l.quantity, l.rate_aed));
    }
    // Everything the Atrium quotation covered is an actual. The S6-pre vanity
    // slab (G19) is the one line it did NOT cover, so it must NOT claim to be
    // one — that distinction is the whole point of recording the exclusion.
    const quoted = section.lines.filter((l) => !/vanity counter slab/i.test(l.description));
    expect(quoted.length).toBeGreaterThan(0);
    for (const l of quoted) expect(l.rate_status).toBe("actual_transaction");
  });

  it("adds the G19 vanity slab as an allowance, never as an actual", () => {
    const slab = section.lines.find((l) => /vanity counter slab/i.test(l.description));
    expect(slab, "G19 vanity slab line missing").toBeDefined();
    expect(slab!.rate_status).toBe("site_assessment");
    expect(slab!.rate_status).not.toBe("actual_transaction");
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

describe("Aluminum & Glass section (C1: the plan's own openings, never the reference order)", () => {
  it("prints no line of the reference villa's aluminium order", () => {
    const section = buildAluminumSection(MUDON_ROOMS)!;
    const quoted = new Set(ALUMINUM.flatMap((a) => [a.item, a.location]));
    for (const l of section.lines) {
      expect(l.rule_id.startsWith("GT/aluminum/")).toBe(false);
      for (const q of quoted) expect(l.description).not.toContain(q);
    }
  });

  it("without glazing lines it carries only the S6-pre shower glass and mirrors", () => {
    const section = buildAluminumSection(MUDON_ROOMS)!;
    expect(section.lines.map((l) => l.rule_id.split("/")[0]).sort()).toEqual(["S6-06", "S6-07"]);
  });

  it("the glazing lines it is given come first, supply and install, in the section total", () => {
    const glazing = [{ rule_id: "Q-38/R-75", description: "Aluminium windows — thermal-break, double-glazed, supply and install", quantity: 2.88, unit: "m2", rate_aed: 3324.1, total_aed: lineTotal(2.88, 3324.1), vendor_or_source: "reference villa — aluminium & glazing supplier", notes: null }];
    const section = buildAluminumSection(MUDON_ROOMS, glazing)!;
    expect(section.lines[0]).toMatchObject({ rule_id: "Q-38/R-75", scope: "supply_and_install" });
    expect(section.section_total_aed).toBe(sumMoney(section.lines.map((l) => l.total_aed)));
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
    expect(out.subtotal_aed).toBe(sumMoney(out.sections.map((x) => x.section_total_aed)));
    expect(out.grand_total_aed).toBe(sumMoney([out.subtotal_aed, out.contingency_aed, out.vat_aed]));
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
