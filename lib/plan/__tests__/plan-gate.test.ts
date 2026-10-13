import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import demo from "../__fixtures__/demo-villa-plan.json";
import { planGate } from "../plan-gate";

// K10 #4 — the plan page opens the editor whenever the plan has rooms, counted
// from the same list as the header; "No drawing attached" only with truly none.
const ROOT = path.resolve(__dirname, "../../..");

describe("plan page gate", () => {
  it("the Demo villa (13 rooms, no parsed_json, no drawing) opens the editor", () => {
    expect(demo.plan).toMatchObject({ source: "parsed", pdf_url: null, parsed_json: null });
    expect(demo.rooms).toHaveLength(13);
    expect(planGate({ authored: demo.plan.source === "user_drawn", roomCount: demo.rooms.length })).toBe("editor");
  });

  it("no rooms and not authored → not analysed (the 'No drawing attached' card); authored → editor even with none", () => {
    expect(planGate({ authored: false, roomCount: 0 })).toBe("not_analysed");
    expect(planGate({ authored: true, roomCount: 0 })).toBe("editor");
    expect(planGate({ authored: false, roomCount: 1 })).toBe("editor");
  });

  it("the page gates on the same list its header counts — no parse record required", () => {
    const src = readFileSync(path.join(ROOT, "app/project/[id]/plan/page.tsx"), "utf8");
    expect(src).toContain("planGate({ authored, roomCount: roomList.length })");
    expect(src).toMatch(/\{roomList\.length\} \{authored \? "ZONES DRAWN" : "ROOMS DETECTED"\}/);
    expect(src).not.toMatch(/planReady = .*parsed_json/);
  });
});
