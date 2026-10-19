import { describe, expect, it } from "vitest";

import { computeTakeoff } from "../takeoff";
import { applyElementMapping } from "../element-map";
import { assembleMappedSections } from "../elements";
import { lineTotal, sumMoney } from "../money";
import { MUDON_FIRST_FLOOR } from "../fixtures/mudon-first-floor";
import { mudonEngineBoq, mudonTakeoff } from "./p4.fixture";

// Bathroom-pilot pre-flight (18 Oct): on a plan with an element take-off,
// Floor Finishes is rebuilt from the take-off — which dropped R-10, the
// skirting (F-04: dry + terrace perimeter − doors), the way #107 found Q-11
// dropped. The take-off measures no skirting, so the engine's line is kept.

type Line = { rule_id?: string; quantity: number; rate_aed: number; total_aed: number; description: string };
const lines = (b: { sections: { work_section: string; lines: unknown[] }[] }) => b.sections.flatMap((s) => s.lines as Line[]);
const skirting = (b: Parameters<typeof lines>[0]) => lines(b).filter((l) => (l.rule_id ?? "").startsWith("Q-10/"));

describe("skirting on a take-off plan", () => {
  it("the engine BoQ prices R-10 skirting", () => {
    const s = skirting(mudonEngineBoq());
    expect(s).toHaveLength(1);
    expect(s[0].rule_id).toBe("Q-10/R-10");
    expect(s[0].quantity).toBe(142.38);
  });

  it("the mapped BoQ keeps it — once, in Floor Finishes, unchanged", () => {
    const engine = mudonEngineBoq();
    const before = skirting(engine)[0];
    const mapped = applyElementMapping(engine, mudonTakeoff());
    const s = skirting(mapped);
    expect(s).toHaveLength(1);
    expect(s[0]).toEqual(before);
    const ff = mapped.sections.find((x) => x.work_section === "Floor Finishes")!;
    expect((ff.lines as Line[]).some((l) => l.rule_id === "Q-10/R-10")).toBe(true);
  });

  it("the take-off itself measures no skirting (no double count)", () => {
    const keys = new Set(mudonTakeoff().map((i) => i.work_item_key as string));
    expect([...keys].some((k) => /skirt/i.test(k))).toBe(false);
    const ffLines = assembleMappedSections(mudonTakeoff()).find((s) => s.work_section === "Floor Finishes")!.lines;
    expect(ffLines.some((l) => /skirt/i.test(l.description))).toBe(false);
  });

  it("wet rooms take no skirting — F-04 counts dry rooms + terrace only (unchanged)", () => {
    const sk = (rooms: typeof MUDON_FIRST_FLOOR) => computeTakeoff(rooms, "porcelain").items.find((i) => i.item_key === "floor.skirting")!;
    const withBath = sk(MUDON_FIRST_FLOOR);
    const dryOnly = sk(MUDON_FIRST_FLOOR.filter((r) => r.room_type !== "bathroom"));
    expect(withBath.quantity).toBe(dryOnly.quantity);
  });

  it("the chain still closes to the fil, and mapping twice keeps one", () => {
    const once = applyElementMapping(mudonEngineBoq(), mudonTakeoff());
    for (const l of lines(once)) expect(l.total_aed).toBe(lineTotal(l.quantity, l.rate_aed));
    for (const s of once.sections) expect(s.section_total_aed).toBe(sumMoney((s.lines as Line[]).map((l) => l.total_aed)));
    expect(once.subtotal_aed).toBe(sumMoney(once.sections.map((s) => s.section_total_aed)));
    const twice = applyElementMapping(once, mudonTakeoff());
    expect(skirting(twice)).toHaveLength(1);
    expect(twice.grand_total_aed).toBe(once.grand_total_aed);
  });
});
