import { describe, expect, it } from "vitest";

import {
  editingEnabled,
  roomInteraction,
  svgDragEnabled,
} from "@/app/project/[id]/plan/_components/plan-interaction";

// Verification gate (c): assert no mutating listener is registered in read mode.
describe("EditablePlanViewer mode gate — handler registration", () => {
  it("read mode registers NO svg drag listeners (onPointerMove is the mutator)", () => {
    expect(svgDragEnabled("read")).toBe(false);
  });

  it("edit mode registers the svg drag listeners", () => {
    expect(svgDragEnabled("edit")).toBe(true);
  });

  it("read mode → room click inspects, never drags", () => {
    expect(roomInteraction("read")).toBe("inspect");
  });

  it("edit mode → room body-drag, never inspects", () => {
    expect(roomInteraction("edit")).toBe("drag");
  });

  it("editing affordances (toolbar/handles/rename) gate on mode", () => {
    expect(editingEnabled("edit")).toBe(true);
    expect(editingEnabled("read")).toBe(false);
  });
});
