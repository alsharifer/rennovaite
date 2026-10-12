import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { boqPricingFingerprint } from "@/lib/documents/reference-basis";

import { changesSinceRevision, summarizeChanges } from "../changes-since";
import { generateDeterministicBoq } from "../engine";
import { MUDON_FIRST_FLOOR } from "../fixtures/mudon-first-floor";
import { appendJoineryAluminumSections } from "../joinery-aluminum";
import { appendOverlaySections } from "../../overlays/boq-feed";
import { LABOUR_RATES_FIXTURE } from "./labour-rates.fixture";
import { PRICING_SKUS_FIXTURE } from "./pricing-skus.fixture";

// =============================================================================
// "Changed since rev N" (K2 review) — ONE function, read by the journey rail and
// by K3's Regenerate control. The runbook check (docs/ONBOARDING_RUNBOOK.md,
// "regenerate … must not move"): when nothing was recorded since a revision,
// the function says "unchanged" AND regenerating from the same state gives the
// same BoQ — so "Unchanged" is never a lie.
// =============================================================================

/** A database where nothing was recorded: every query answers no rows. */
function emptyDb(): SupabaseClient {
  const result = { data: [], error: null };
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gt", "lte", "gte", "lt", "in", "order", "limit", "is", "not"]) chain[m] = () => chain;
  chain.then = (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return { from: () => chain } as unknown as SupabaseClient;
}

const causes = (...kinds: string[]) => kinds.map((kind) => ({ kind }) as { kind: "plan_edit" });

describe("summarizeChanges — what can move a regenerated BoQ", () => {
  it("nothing recorded → unchanged, no summary", () => {
    expect(summarizeChanges([], 4)).toEqual({ planEdits: 0, bookChanges: 0, decisions: 0, corrections: 0, changed: false, summary: null });
  });

  it("plan edits, book entries and decisions are changes, named in one line", () => {
    expect(summarizeChanges(causes("plan_edit", "firm_rate"), 4)).toMatchObject({ changed: true, summary: "plan edited, 1 book entry changed since rev 4" });
    expect(summarizeChanges(causes("firm_rate", "firm_rate", "session_decision"), 2).summary).toBe("2 book entries changed, 1 decision recorded since rev 2");
  });

  it("a recorded correction is not a change — corrections are never applied to a BoQ", () => {
    expect(summarizeChanges(causes("correction", "correction"), 4)).toMatchObject({ corrections: 2, changed: false, summary: null });
  });

  it("the regeneration that produced a revision is not a change after it", () => {
    expect(summarizeChanges(causes("regeneration"), 4).changed).toBe(false);
  });
});

describe("the runbook check: no recorded change ⇒ regenerating leaves the BoQ unchanged", () => {
  async function regenerate() {
    const { boq } = generateDeterministicBoq({
      rooms: MUDON_FIRST_FLOOR,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      labourRates: LABOUR_RATES_FIXTURE as any,
      skus: PRICING_SKUS_FIXTURE,
      styleKey: "contemporary-arabic",
    });
    const overlaid = await appendOverlaySections(boq, "p0", emptyDb());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return appendJoineryAluminumSections(overlaid, MUDON_FIRST_FLOOR.map((r) => ({ ...r, name_en: r.name })) as any);
  }

  it("changesSinceRevision reads the recorded causes and finds none — and the regenerated BoQ is the same, line for line", async () => {
    const rev4 = await regenerate();
    const changes = await changesSinceRevision(emptyDb(), "p0", { id: "boq-rev-4", created_at: "2026-10-01T10:00:00Z" }, 4, new Date("2026-10-12T10:00:00Z"));
    expect(changes.changed).toBe(false);
    expect(changes.summary).toBeNull();

    const rev5 = await regenerate();
    expect(boqPricingFingerprint(rev5)).toBe(boqPricingFingerprint(rev4));
    expect(rev5.grand_total_aed).toBe(rev4.grand_total_aed);
  });
});
