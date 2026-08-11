// =============================================================================
// Synthetic non-rectilinear regression fixtures for the parse pipeline.
//
// Each fixture is a small plan in normalised [0,1] space with rooms that
// deliberately overlap (except where noted) so the overlap-repair + geometry
// stages can be regression-tested for: zero pairwise overlap, areas within ±2%
// of the hand-computed expected values, diagonal/L-shape/curved survival, and
// diagonal wall derivation. `total_area_m2` is chosen so the post-repair scale
// yields clean expected areas.
// =============================================================================

import type { Pt } from "@/lib/plan/polygon";

export interface FixtureRoom {
  id: string;
  name_en: string;
  name_ar: string | null;
  room_type: string;
  area_m2: number;
  polygon: Pt[];
  confidence: number;
}

export interface SyntheticFixture {
  projectId: string;
  planId: string;
  scale: string;
  total_area_m2: number;
  rooms: FixtureRoom[];
  /** Expected per-room area_m2 AFTER overlap repair. */
  expected: Record<string, number>;
  /** Rooms expected to be confidence-downgraded (heavily carved). */
  expectedDowngraded?: string[];
}

const room = (
  id: string,
  room_type: string,
  polygon: Pt[],
  confidence = 0.8,
): FixtureRoom => ({
  id,
  name_en: id,
  name_ar: null,
  room_type,
  area_m2: 0, // repair recomputes; value here is unused by repair
  confidence,
  polygon,
});

// Two axis-aligned rooms overlapping in x∈[0.4,0.6]. Equal conf + area → id
// tie-break: "a-left" wins, "b-right" is carved to [0.6,1].
export const OVERLAP_PAIR: SyntheticFixture = {
  projectId: "00000000-0000-4000-8000-000000000001",
  planId: "00000000-0000-4000-8000-000000000101",
  scale: "1:100",
  total_area_m2: 100,
  rooms: [
    room("a-left", "living", [[0, 0], [0.6, 0], [0.6, 1], [0, 1]]),
    room("b-right", "bedroom", [[0.4, 0], [1, 0], [1, 1], [0.4, 1]]),
  ],
  expected: { "a-left": 60, "b-right": 40 },
  expectedDowngraded: ["b-right"],
};

// Concave L-shape (rectilinear) + a room overlapping its notch. L (conf 0.9)
// wins; notch room (conf 0.7) is carved to the exact notch [0.4,0.4]-[1,1].
export const L_SHAPE_WITH_NOTCH: SyntheticFixture = {
  projectId: "00000000-0000-4000-8000-000000000002",
  planId: "00000000-0000-4000-8000-000000000102",
  scale: "1:100",
  total_area_m2: 100,
  rooms: [
    room("l-room", "living", [[0, 0], [1, 0], [1, 0.4], [0.4, 0.4], [0.4, 1], [0, 1]], 0.9),
    room("notch-room", "bedroom", [[0.3, 0.3], [1, 0.3], [1, 1], [0.3, 1]], 0.7),
  ],
  expected: { "l-room": 64, "notch-room": 36 },
  expectedDowngraded: ["notch-room"],
};

// Two triangles sharing the hypotenuse [1,0]-[0,1] — NO overlap. Tests that
// diagonal geometry survives repair untouched (and drives an S2 diagonal party
// wall). total 50 → each 25 m².
export const DIAGONAL_SPLIT: SyntheticFixture = {
  projectId: "00000000-0000-4000-8000-000000000003",
  planId: "00000000-0000-4000-8000-000000000103",
  scale: "1:100",
  total_area_m2: 50,
  rooms: [
    room("tri-a", "living", [[0, 0], [1, 0], [0, 1]]),
    room("tri-b", "bedroom", [[1, 0], [1, 1], [0, 1]]),
  ],
  expected: { "tri-a": 25, "tri-b": 25 },
};

// A curved-bay room (right edge bulges out via two diagonal segments) + a
// neighbour rect overlapping the bulge. Bay (conf 0.85) wins; neighbour carved.
// Bay footprint 0.85, neighbour post-carve 0.1375 → total 98.75, unit 10.
export const CURVED_BAY: SyntheticFixture = {
  projectId: "00000000-0000-4000-8000-000000000004",
  planId: "00000000-0000-4000-8000-000000000104",
  scale: "1:100",
  total_area_m2: 98.75,
  rooms: [
    room("bay", "living", [[0, 0], [0.8, 0], [0.9, 0.5], [0.8, 1], [0, 1]], 0.85),
    room("bay-neighbour", "bedroom", [[0.85, 0], [1, 0], [1, 1], [0.85, 1]], 0.7),
  ],
  expected: { bay: 85, "bay-neighbour": 13.75 },
};

export const SYNTHETIC_FIXTURES: SyntheticFixture[] = [
  OVERLAP_PAIR,
  L_SHAPE_WITH_NOTCH,
  DIAGONAL_SPLIT,
  CURVED_BAY,
];
