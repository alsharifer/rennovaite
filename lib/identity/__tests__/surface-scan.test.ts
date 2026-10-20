// Sprint C1 #5 — the identity / leak scan over EVERY rendered surface, in the
// test suite (not by hand on dev). Fixture: Jumeirah Parks Garden's 13 Oct
// revision — the one whose inspector showed "Mudon ground-truth quotations"
// and eight lines naming Mudon's rooms — and Mudon's own latest revision.
//
// Surfaces, each built in-process by the function the app renders it from:
//   inspector + popovers   buildBoqProvenance (every figure's chain)
//   BoQ page               buildReviewModel (what BoqReview receives) + the
//                          Issues navigator (boqIssues)
//   revision diff          diffRevisions (page, JSON and PDF render this object)
//   proposal               buildProposalPages (the client document's pages)
//   BoQ PDF                buildBoqPdfPages
//
// The scan (lib/identity/surface-scan.ts): withheld identities, every other
// project's name and the reference-project markers, and every reference-order
// room label absent from THIS plan.

import { describe, expect, it } from "vitest";

import jumeirah from "@/lib/boq/__fixtures__/c1-jumeirah-rev1.json";
import mudon from "@/lib/boq/__fixtures__/c1-mudon-latest.json";
import { pricedGlazing } from "@/lib/boq/assemble";
import { glazingOpeningsFrom, glazingScope } from "@/lib/boq/glazing";
import { boqIssues } from "@/lib/boq/issues";
import { appendJoineryAluminumSections } from "@/lib/boq/joinery-aluminum";
import { RateResolver } from "@/lib/boq/rates";
import { buildReviewModel } from "@/lib/boq/review-model";
import { C1_ADDED_CAUSE, C1_REMOVED_CAUSE, C1_REMOVED_LABEL, diffRevisions, snapshotRevision } from "@/lib/boq/revision-diff";
import { ENGINE_VERSION } from "@/lib/boq/rules";
import { buildBoqPdfPages } from "@/lib/documents/boq-pdf-pages";
import { buildProposalPages } from "@/lib/documents/proposal";
import { buildPlanGraph } from "@/lib/plan/geometry";
import { metresPerUnit, openingsOnWalls } from "@/lib/plan/plan-rules";
import { buildBoqProvenance, EMPTY_CONTEXT } from "@/lib/provenance/boq";

import { scanSurface, type ScanContext, type ScanFinding } from "../surface-scan";

type Fx = typeof jumeirah;
const PROJECTS = [jumeirah as Fx, mudon as unknown as Fx];

function graphOf(fx: Fx) {
  const rooms = fx.rooms.map((r) => ({ id: r.id, name_en: r.name_en, name_ar: null, room_type: r.room_type, area_m2: r.area_m2, polygon: r.polygon, unroofed: r.unroofed }));
  const mPerU = metresPerUnit(rooms, fx.plan.total_area_m2);
  const confirmed = fx.openings.filter((o) => !(o.source === "detected" && !o.confirmed_at));
  const on = new Set(openingsOnWalls(confirmed.map((o) => ({ id: o.id, kind: o.kind, width_mm: o.width_mm, position: o.position, room_id: o.room_id })), rooms, mPerU).map((o) => o.id));
  return buildPlanGraph({ projectId: fx.project.id, planId: fx.plan.id, scale: null, total_area_m2: fx.plan.total_area_m2, rooms, openings: confirmed.filter((o) => on.has(o.id)).map((o) => ({ id: o.id, type: o.kind, width_mm: o.width_mm, height_mm: o.height_mm, sill_mm: o.sill_mm, position: o.position, source: o.source, derived: o.derived, room_id: o.room_id })) } as never);
}

/** The revision a regenerate under C1 stores: today's aluminium post-pass on the plan's own openings, engine 0.4.0. */
function regenerated(fx: Fx) {
  const rooms = fx.rooms.filter((r) => r.in_scope !== false);
  const glazing = glazingScope(glazingOpeningsFrom(graphOf(fx), new Set(rooms.map((r) => r.id))));
  const doc = appendJoineryAluminumSections(fx.boq.sections as never, rooms as never, pricedGlazing({ rooms: rooms as never, glazing, wetRoom: null }, new RateResolver([], [], "mid"))) as Record<string, unknown>;
  return { ...doc, engine: { ...(doc.engine as object), version: ENGINE_VERSION } };
}

const ctxOf = (fx: Fx): ScanContext => ({
  ownNames: [fx.project.name],
  ownRooms: fx.rooms.map((r) => r.name_en),
  otherProjectNames: [...PROJECTS.filter((p) => p.project.id !== fx.project.id).map((p) => p.project.name), "Arabella Garden — Draft for Review"],
});

/** Every rendered surface of one revision (and the diff from the stored one to it). */
function surfaces(fx: Fx, doc: Record<string, unknown>): [string, unknown][] {
  const provenance = buildBoqProvenance(doc as never, EMPTY_CONTEXT);
  const model = buildReviewModel({ projectId: fx.project.id, boqId: "rev", rev: 2, revDate: "2026-10-20", persona: "owner", boq: doc as never, provenance, tierCtx: { qsValidated: {} }, firm: null, basis: null, duplicates: [], budget: null });
  const diff = diffRevisions(
    snapshotRevision(fx.boq.id, fx.boq.created_at, fx.boq.sections as never),
    snapshotRevision("rev-2", "2026-10-20T12:00:00Z", doc as never),
  );
  const boqPdf = { projectName: fx.project.name, community: "Dubai", dateISO: "2026-10-20", boq: doc as never };
  return [
    ["inspector + popovers (provenance chains)", provenance],
    ["BoQ page (review model)", model],
    ["Issues navigator", boqIssues(model, null)],
    ["revision diff", diff],
    ["proposal pages", buildProposalPages({ ...boqPdf, brand: "Contractor", logoDataUri: null, termsText: null, rooms: fx.rooms.map((r) => ({ name: r.name_en, kind: r.room_type, area_m2: r.area_m2 })) })],
    ["BoQ PDF pages", buildBoqPdfPages(boqPdf)],
  ];
}

const scanAll = (fx: Fx, doc: Record<string, unknown>): ScanFinding[] => surfaces(fx, doc).flatMap(([name, payload]) => scanSurface(name, payload, ctxOf(fx)));

describe("the scan catches the defect on the stored revisions", () => {
  it("Jumeirah rev 1: its BoQ page and inspector name Mudon's rooms", () => {
    const found = surfaces(jumeirah as Fx, jumeirah.boq.sections as never)
      .filter(([name]) => name !== "revision diff")
      .flatMap(([name, p]) => scanSurface(name, p, ctxOf(jumeirah as Fx)));
    const rooms = new Set(found.filter((f) => f.kind === "room").map((f) => f.text));
    for (const r of ["Guest bedroom", "Master bedroom", "Master bathroom", "Kids bedroom", "Office", "Living area"]) expect(rooms).toContain(r);
    expect(new Set(found.map((f) => f.surface))).toContain("inspector + popovers (provenance chains)");
  });

  it("another project's name is caught on any surface", () => {
    expect(scanSurface("x", { title: "Priced like the Mudon villa" }, ctxOf(jumeirah as Fx)).map((f) => f.text)).toEqual(["Mudon"]);
    expect(scanSurface("x", "Jumeirah Parks Garden", ctxOf(mudon as unknown as Fx)).map((f) => f.kind)).toEqual(["project"]);
    // A project's own name is allowed on its own surfaces.
    expect(scanSurface("x", "Mudon pilot villa", ctxOf(mudon as unknown as Fx))).toEqual([]);
  });
});

describe.each([
  ["Jumeirah Parks Garden", jumeirah as Fx],
  ["Mudon pilot villa (its own quotation's labels never matched its own plan)", mudon as unknown as Fx],
])("after C1 — %s", (_n, fx) => {
  const doc = regenerated(fx);

  it("no surface shows another project, its quotation or a room this plan lacks", () => {
    expect(scanAll(fx, doc)).toEqual([]);
  });

  it("the revision diff shows −92,449.00 of removed reference-order lines with their cause, and the plan's glazing added", () => {
    const diff = diffRevisions(snapshotRevision(fx.boq.id, fx.boq.created_at, fx.boq.sections as never), snapshotRevision("rev-2", "2026-10-20T12:00:00Z", doc as never));
    const removed = diff.lines.filter((l) => l.causes.some((c) => c.summary === C1_REMOVED_CAUSE));
    expect(removed).toHaveLength(8);
    expect(removed.every((l) => l.description === C1_REMOVED_LABEL && l.class === "removed")).toBe(true);
    expect(Math.round(removed.reduce((s, l) => s + l.delta_aed, 0) * 100) / 100).toBe(-92_449);
    const added = diff.lines.filter((l) => l.causes.some((c) => c.summary === C1_ADDED_CAUSE));
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((l) => l.class === "added" && ["alum.window", "alum.external_door"].includes(l.item_key ?? ""))).toBe(true);
  });
});

it("the C1 cause is named only where the stored engine versions straddle 0.4.0", () => {
  const doc = regenerated(jumeirah as Fx);
  const sameEngine = { ...doc, engine: { ...(doc.engine as object), version: "0.3.0" } };
  const diff = diffRevisions(snapshotRevision("a", jumeirah.boq.created_at, jumeirah.boq.sections as never), snapshotRevision("b", "2026-10-20T12:00:00Z", sameEngine as never));
  expect(diff.lines.some((l) => l.causes.some((c) => c.kind === "engine_change"))).toBe(false);
});
