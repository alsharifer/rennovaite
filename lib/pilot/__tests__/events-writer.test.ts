import { describe, expect, it } from "vitest";

import { fakeDb } from "@/lib/firms/__tests__/fake-db";

import { recordPilotEvent } from "../events";

// L5 — the writer: every project records (no authored-plan guard), the firm is
// resolved from the project, the 048 columns ride along, and a pre-048 table
// still gets the old shape for the old kinds — never an error.

describe("recordPilotEvent", () => {
  it("writes the 048 shape for an interior project, resolving the firm from the project", async () => {
    const db = fakeDb({ projects: [{ id: "p1", firm_id: "f1" }], plans: [{ id: "pl", project_id: "p1", source: "parsed" }], pilot_events: [] });
    await recordPilotEvent(db.client, "p1", "boq_generated", { full: true, stage: "x" }, { actor: "u1", durationMs: 1234.6, sessionRef: "s" });
    expect(db.tables.pilot_events).toHaveLength(1);
    expect(db.tables.pilot_events![0]).toMatchObject({ project_id: "p1", kind: "boq_generated", firm_id: "f1", actor: "u1", duration_ms: 1235, session_ref: "s", stage: "x", detail: { full: true, stage: "x" } });
  });

  it("a firm-level event needs no project; a project-less, firm-less event is dropped", async () => {
    const db = fakeDb({ pilot_events: [] });
    await recordPilotEvent(db.client, null, "rate_book_change", { action: "promote" }, { firmId: "f1", actor: "u1" });
    await recordPilotEvent(db.client, null, "rate_book_change", { action: "promote" }, {});
    expect(db.tables.pilot_events!.map((e) => e.firm_id)).toEqual(["f1"]);
  });

  it("falls back to the old shape on a pre-048 table for an old kind, and drops a new kind", async () => {
    const db = fakeDb({ projects: [{ id: "p1", firm_id: null }], pilot_events: [] });
    const real = db.client.from.bind(db.client);
    let calls = 0;
    (db.client as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const q = real(t) as { insert: (r: Record<string, unknown>) => unknown };
      if (t !== "pilot_events") return q;
      return {
        insert: (row: Record<string, unknown>) => {
          calls++;
          if ("firm_id" in row) return Promise.resolve({ data: null, error: { code: "42703", message: 'column "firm_id" of relation "pilot_events" does not exist' } });
          return q.insert(row);
        },
      };
    };
    await recordPilotEvent(db.client, "p1", "friction", { note: "old kind" });
    await recordPilotEvent(db.client, "p1", "boq_viewed", { boq_id: "b" });
    expect(db.tables.pilot_events!.map((e) => e.kind)).toEqual(["friction"]);
    expect(calls).toBe(3); // 048 attempt + fallback for friction; one refused attempt for the new kind
  });
});
