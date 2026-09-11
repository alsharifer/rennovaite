// =============================================================================
// lib/parse/__tests__/parse-eval.ts — the parse eval comparator.
//
// Test-only. Scores a recorded parse against a ground-truth room table read off
// the drawing itself, and reports the three numbers a QS actually argues about:
// which rooms were found, how far each area is off, and how much geometry
// double-counts.
//
// THREE OVERLAP NUMBERS, deliberately:
//   polygon  computed here — rooms that actually share floor area, which is what
//            double-counts in a take-off.
//   gate     whatever `findOverlaps` says today. This is the number the editor
//            banner and the BoQ 409 act on, so it is the one with consequences.
//   bbox     the bounding-box test the gate used to run, kept as a fixed
//            reference. It is why the gate changed: the moment repair carves an
//            L-shape the polygons separate and the boxes do not, so a correct
//            plan was reported as three overlaps and refused costing.
// `gate` should now equal `polygon`; keeping all three is what proves it.
// =============================================================================

import polygonClipping from "polygon-clipping";

import { findOverlaps } from "@/lib/plan/overlaps";
import { polygonArea, type Pt } from "@/lib/plan/polygon";

import type { GroundTruthRoom } from "./fixtures/mudon-first-floor.ground-truth";
import type { EvalRoom, RecordedParse } from "./fixtures/mudon-first-floor.parses";

export interface MatchedRoom {
  tag: string;
  gt_name: string;
  gt_area_m2: number | null;
  parse_id: string;
  parse_name: string;
  parse_area_m2: number;
  /** (parse − ground truth) / ground truth, in percent. null when the sheet
   *  prints no dimension for the room. */
  delta_pct: number | null;
  /** True when the pair came from a same-name group (terraces, balconies),
   *  where only presence is meaningful. */
  grouped: boolean;
}

export interface EvalResult {
  label: string;
  rooms_expected: number;
  rooms_found: number;
  missing_tags: string[];
  /** Parse rooms matched to no ground-truth room, split by whether the sheet
   *  draws that space untagged (stairs) or the parser invented it. */
  extra_expected: string[];
  extra_unexpected: string[];
  matched: MatchedRoom[];
  /** Over rooms whose ground truth has a printed dimension. */
  area_scored: number;
  area_exact: number; // |delta| <= 0.5 %
  area_within_3pct: number;
  mean_abs_delta_pct: number | null;
  max_abs_delta_pct: number | null;
  /** Pairs whose POLYGONS share interior area. Should be 0 after repair. */
  overlap_pairs_polygon: number;
  /** Pairs the shipped detector reports — the editor banner and the BoQ 409. */
  overlap_pairs_gate: number;
  /** Pairs whose BOUNDING BOXES share interior area. The gate's old test. */
  overlap_pairs_bbox: number;
  /** Summed polygon intersection as a fraction of summed room area, percent. */
  overlap_area_pct: number;
}

function closedRing(poly: Pt[]): number[][] {
  const ring = poly.map(([x, y]) => [x, y]);
  const f = ring[0]!;
  const l = ring[ring.length - 1]!;
  if (f[0] !== l[0] || f[1] !== l[1]) ring.push([f[0]!, f[1]!]);
  return ring;
}

/** Area shared by two polygons, in normalised units. 0 when they only touch. */
export function intersectionArea(a: Pt[], b: Pt[]): number {
  let out = 0;
  try {
    const mp = polygonClipping.intersection(
      [closedRing(a)] as never,
      [closedRing(b)] as never,
    ) as unknown as Pt[][][];
    for (const poly of mp) {
      for (let i = 0; i < poly.length; i++) {
        const ringArea = polygonArea(poly[i]!);
        out += i === 0 ? ringArea : -ringArea; // subtract holes
      }
    }
  } catch {
    return 0; // clipping failure — report no overlap rather than a made-up one
  }
  return out;
}

function normalise(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function nameMatches(gt: GroundTruthRoom, room: EvalRoom): boolean {
  const n = normalise(room.name_en);
  return gt.names.some((needle) => n.includes(needle));
}

/**
 * Pair ground-truth rooms with parse rooms.
 *
 * Ungrouped rooms match on name, narrowed by `types` when several parse rooms
 * answer to the same name (the sheet's two "BATH"s are told apart by ensuite vs
 * bathroom). Grouped rooms — the two terraces and the two balconies, none of
 * which the sheet dimensions — are paired in order and scored for presence
 * only, because nothing on the drawing distinguishes them by name.
 */
export function matchRooms(
  groundTruth: GroundTruthRoom[],
  parse: RecordedParse,
): { matched: MatchedRoom[]; missing: GroundTruthRoom[]; extra: EvalRoom[] } {
  const pool = [...parse.rooms];
  const matched: MatchedRoom[] = [];
  const missing: GroundTruthRoom[] = [];
  const take = (gt: GroundTruthRoom, room: EvalRoom, grouped: boolean) => {
    pool.splice(pool.indexOf(room), 1);
    matched.push({
      tag: gt.tag,
      gt_name: gt.name,
      gt_area_m2: gt.area_m2,
      parse_id: room.id,
      parse_name: room.name_en,
      parse_area_m2: room.area_m2,
      delta_pct:
        gt.area_m2 && gt.area_m2 > 0
          ? ((room.area_m2 - gt.area_m2) / gt.area_m2) * 100
          : null,
      grouped,
    });
  };

  for (const gt of groundTruth.filter((g) => !g.group)) {
    const byName = pool.filter((r) => nameMatches(gt, r));
    const byType = gt.types
      ? byName.filter((r) => gt.types!.includes(r.room_type))
      : byName;
    const pick = (byType.length > 0 ? byType : byName)[0];
    if (pick) take(gt, pick, false);
    else missing.push(gt);
  }

  const groups = new Set(groundTruth.filter((g) => g.group).map((g) => g.group!));
  for (const group of groups) {
    const members = groundTruth.filter((g) => g.group === group);
    const candidates = pool.filter((r) => members.some((g) => nameMatches(g, r)));
    members.forEach((gt, i) => {
      const pick = candidates[i];
      if (pick && pool.includes(pick)) take(gt, pick, true);
      else missing.push(gt);
    });
  }

  matched.sort((a, b) => a.tag.localeCompare(b.tag));
  missing.sort((a, b) => a.tag.localeCompare(b.tag));
  return { matched, missing, extra: pool };
}

export function evaluateParse(
  groundTruth: GroundTruthRoom[],
  parse: RecordedParse,
  untaggedSpaces: string[],
): EvalResult {
  const { matched, missing, extra } = matchRooms(groundTruth, parse);

  const scored = matched.filter((m) => m.delta_pct !== null);
  const absDeltas = scored.map((m) => Math.abs(m.delta_pct!));

  const polys = parse.rooms.map((r) => r.polygon);
  let pairsPolygon = 0;
  let sharedArea = 0;
  for (let i = 0; i < polys.length - 1; i++) {
    for (let j = i + 1; j < polys.length; j++) {
      const a = intersectionArea(polys[i]!, polys[j]!);
      if (a > 1e-12) {
        pairsPolygon++;
        sharedArea += a;
      }
    }
  }
  const totalNorm = polys.reduce((s, p) => s + polygonArea(p), 0);
  const gate = findOverlaps(
    parse.rooms.map((r) => ({ id: r.id, name: r.name_en, polygon: r.polygon })),
  );

  // The detector's old bounding-box test, reimplemented here so the fixture
  // keeps reporting it after the shipped one moved on.
  const boxes = polys.map((p) => ({
    x0: Math.min(...p.map((q) => q[0])),
    y0: Math.min(...p.map((q) => q[1])),
    x1: Math.max(...p.map((q) => q[0])),
    y1: Math.max(...p.map((q) => q[1])),
  }));
  let pairsBbox = 0;
  for (let i = 0; i < boxes.length - 1; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (
        Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 1e-9 &&
        Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 1e-9
      ) {
        pairsBbox++;
      }
    }
  }

  const isExpectedExtra = (r: EvalRoom) => {
    const n = normalise(r.name_en);
    return untaggedSpaces.some((u) => n.includes(u)) || untaggedSpaces.includes(r.room_type);
  };

  return {
    label: parse.label,
    rooms_expected: groundTruth.length,
    rooms_found: matched.length,
    missing_tags: missing.map((m) => m.tag),
    extra_expected: extra.filter(isExpectedExtra).map((r) => r.name_en),
    extra_unexpected: extra.filter((r) => !isExpectedExtra(r)).map((r) => r.name_en),
    matched,
    area_scored: scored.length,
    area_exact: absDeltas.filter((d) => d <= 0.5).length,
    area_within_3pct: absDeltas.filter((d) => d <= 3).length,
    mean_abs_delta_pct: absDeltas.length
      ? absDeltas.reduce((s, d) => s + d, 0) / absDeltas.length
      : null,
    max_abs_delta_pct: absDeltas.length ? Math.max(...absDeltas) : null,
    overlap_pairs_polygon: pairsPolygon,
    overlap_pairs_gate: gate.pairs.length,
    overlap_pairs_bbox: pairsBbox,
    overlap_area_pct: totalNorm > 0 ? (sharedArea / totalNorm) * 100 : 0,
  };
}

const pct = (v: number | null) => (v === null ? "   —  " : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);

/** Human-readable report; printed by the test so a failing run explains itself. */
export function formatEval(result: EvalResult): string {
  const lines: string[] = [];
  lines.push(`── ${result.label}`);
  lines.push(
    `   rooms ${result.rooms_found}/${result.rooms_expected} found` +
      (result.missing_tags.length ? `  missing: ${result.missing_tags.join(", ")}` : "") +
      (result.extra_unexpected.length ? `  unexpected extra: ${result.extra_unexpected.join(", ")}` : "") +
      (result.extra_expected.length ? `  untagged extra: ${result.extra_expected.join(", ")}` : ""),
  );
  lines.push("   tag  ground truth              parse                          gt m²    parse m²   delta");
  for (const m of result.matched) {
    lines.push(
      `   ${m.tag}  ${m.gt_name.padEnd(24)}  ${m.parse_name.padEnd(28)}  ` +
        `${(m.gt_area_m2 ?? "—").toString().padStart(6)}  ${m.parse_area_m2.toFixed(2).padStart(9)}   ${pct(m.delta_pct)}` +
        (m.grouped ? "  (grouped — presence only)" : ""),
    );
  }
  lines.push(
    `   area: ${result.area_exact}/${result.area_scored} exact (±0.5%), ${result.area_within_3pct}/${result.area_scored} within ±3%, ` +
      `mean |Δ| ${result.mean_abs_delta_pct?.toFixed(1) ?? "—"}%, worst ${result.max_abs_delta_pct?.toFixed(1) ?? "—"}%`,
  );
  lines.push(
    `   overlaps: ${result.overlap_pairs_polygon} polygon-exact pair(s) (${result.overlap_area_pct.toFixed(2)}% of room area), ` +
      `gate reports ${result.overlap_pairs_gate}, old bounding-box test would report ${result.overlap_pairs_bbox}`,
  );
  return lines.join("\n");
}
