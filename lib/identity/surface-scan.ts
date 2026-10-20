// =============================================================================
// lib/identity/surface-scan.ts — does a rendered surface show another project?
// (Sprint C1, docs/SPRINT_C_ROOT_CAUSE.md §1.)
//
// The I4 scans asked one question: does a contractor or supplier name appear?
// Jumeirah's BoQ inspector showed "Mudon ground-truth quotations" and eight
// lines named rooms Jumeirah does not have ("Guest bedroom", "Office") — no
// identity list could catch that, because "Office" is not an identity. This
// scan asks the second question too: does the surface name ANOTHER PROJECT —
// its name, the reference projects, or a room that is not on this plan?
//
//   identity   every withheld identity (lib/identity/curation.ts) + firm names
//   project    every other project's name; the reference-project markers
//              (Mudon, Al Naseem, Villa 94, Arabella) unless this project IS it
//   room       a room label of the reference quotations (the ground-truth
//              orders' locations) or of another plan, absent from this plan
//
// SERVER/TEST-ONLY (it imports the withheld list). Pure: the caller supplies
// the project's own name and rooms. Run over every rendered surface by
// lib/identity/__tests__/surface-scan.test.ts and scripts/read-path-leak-scan.ts.
// =============================================================================

import { ALUMINUM, JOINERY } from "@/lib/ground-truth/mudon-actuals";

import { findWithheldIdentities } from "./curation";

/** Projects whose data the engine was calibrated on — named on no other project's surface. */
export const REFERENCE_PROJECT_MARKERS: readonly string[] = ["Mudon", "Al Naseem", "Villa 94", "Villa94", "Arabella"];

/**
 * The room labels the reference quotations use: the aluminium order's locations
 * ("Guest bedroom", "Office", "G.F–F.F stair", …) and the joinery order's room
 * refs ("Master BR", "Kids BR1", "Kids Bath2"). A surface that prints one for a
 * plan without that room is printing the reference project's scope.
 */
export const REFERENCE_ROOM_LABELS: readonly string[] = [
  ...new Set([
    ...ALUMINUM.map((a) => a.location),
    ...JOINERY.map((j) => j.desc.match(/^(Master BR|Kids BR\s?\d|Kids Bath\s?\d)/)?.[1]).filter((x): x is string => !!x),
  ]),
];

export interface ScanContext {
  /** This project's own names (name, display name) — allowed on its own surfaces. */
  ownNames: readonly string[];
  /** This plan's room names. */
  ownRooms: readonly string[];
  /** Every other project's names (when known) — never on this project's surfaces. */
  otherProjectNames?: readonly string[];
  /** Room labels of other plans to check beyond the reference quotations'. */
  otherRoomLabels?: readonly string[];
  /** Firm names withheld on this project (loadWithheldNames). */
  withheldNames?: readonly string[];
}

export interface ScanFinding {
  kind: "identity" | "project" | "room";
  /** What was found. */
  text: string;
  /** Where (the surface's name, given by the caller). */
  surface: string;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const norm = (s: string) => s.toLowerCase().replace(/[_\s]+/g, " ").replace(/–|—/g, "-").trim();
/** A phrase as a whole word / words, case-insensitive; "_" and spaces are one separator (rule ids are slugs). */
const phraseRe = (p: string) => new RegExp(`(?<![a-z0-9])${escape(norm(p)).replace(/ /g, "[ _]+")}(?![a-z0-9])`, "i");

/** The visible text of a payload: strings joined, SVG/HTML tags stripped, entities decoded. */
export function surfaceText(payload: unknown): string {
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload) ?? "";
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" })[e]!)
    .replace(/–|—/g, "-");
}

/**
 * Is `label` a room on this plan? Equal names, or one contains the other as
 * whole words ("Office" ⊂ "Office (build-out)") — never a fragment: this plan's
 * "Bath" does not make "Master bathroom" one of its rooms.
 */
function onPlan(label: string, ownRooms: readonly string[]): boolean {
  const l = norm(label);
  return ownRooms.some((r) => {
    const o = norm(r);
    return o.length > 0 && (o === l || phraseRe(l).test(o) || phraseRe(o).test(l));
  });
}

/** Every room label printed on the surface that is not a room of this plan. */
export function foreignRooms(text: string, ctx: Pick<ScanContext, "ownRooms" | "otherRoomLabels">): string[] {
  const labels = [...new Set([...REFERENCE_ROOM_LABELS, ...(ctx.otherRoomLabels ?? [])])].filter((l) => norm(l).length >= 3);
  return labels.filter((l) => !onPlan(l, ctx.ownRooms) && phraseRe(l).test(text));
}

/** Every other project's name (and reference-project marker that is not this project) printed on the surface. */
export function foreignProjects(text: string, ctx: Pick<ScanContext, "ownNames" | "otherProjectNames">): string[] {
  const own = ctx.ownNames.map(norm).filter(Boolean);
  const isOwn = (n: string) => own.some((o) => o.includes(norm(n)));
  const names = [...REFERENCE_PROJECT_MARKERS, ...(ctx.otherProjectNames ?? [])]
    .map((n) => n.trim())
    // A project called "Untitled" names nothing.
    .filter((n) => n.length >= 4 && !/^untitled$/i.test(n));
  return [...new Set(names)].filter((n) => !isOwn(n) && phraseRe(n).test(text));
}

/** Scan one rendered surface. Empty = clean. */
export function scanSurface(surface: string, payload: unknown, ctx: ScanContext): ScanFinding[] {
  const text = surfaceText(payload);
  return [
    ...findWithheldIdentities(text, ctx.withheldNames ?? []).map((t) => ({ kind: "identity" as const, text: t, surface })),
    ...foreignProjects(text, ctx).map((t) => ({ kind: "project" as const, text: t, surface })),
    ...foreignRooms(text, ctx).map((t) => ({ kind: "room" as const, text: t, surface })),
  ];
}
