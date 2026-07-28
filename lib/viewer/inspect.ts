// =============================================================================
// lib/viewer/inspect.ts — element → BoQ-line lookup (Prompt P4, pure).
//
// Shared by the 3D viewer and the 2D plan so tap-to-inspect is one behaviour in
// two hosts. Given an element (a room's floor/ceiling, a wall, or a whole room)
// it finds every aggregated BoQ line whose element_refs include that element,
// computing the same REF the BoQ table uses so a row can deep-link + highlight.
// =============================================================================

export interface InspectBoqLine {
  description: string;
  quantity: number;
  unit: string;
  total_aed: number;
  element_refs?: string[] | null;
  rate_status?: "priced" | "needs_qs";
}
export interface InspectBoqSection {
  work_section: string;
  lines: InspectBoqLine[];
}
export interface InspectBoq {
  sections: InspectBoqSection[];
}

export interface DimRow {
  label: string;
  value: string;
}

export interface InspectTarget {
  kind: "floor" | "wall" | "ceiling" | "room";
  title: string;
  roomName: string | null;
  /** Element ids to match against line.element_refs. */
  elementIds: string[];
  dims: DimRow[];
  finish: string | null;
}

export interface MatchedLine {
  ref: string;
  work_section: string;
  description: string;
  quantity: number;
  unit: string;
  total_aed: number;
  needs_qs: boolean;
}

/** Same REF the BoQ table renders (components boq-view.tsx sectionRef). */
export function sectionRef(work_section: string, idx: number): string {
  const initials = work_section
    .split(/[\s&/]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join("")
    .slice(0, 4);
  return `${initials}-${String(idx + 1).padStart(2, "0")}`;
}

/** Every BoQ line whose element_refs intersect the given element ids. */
export function findBoqLines(boq: InspectBoq, elementIds: string[]): MatchedLine[] {
  const want = new Set(elementIds);
  const out: MatchedLine[] = [];
  for (const section of boq.sections) {
    section.lines.forEach((line, idx) => {
      const refs = line.element_refs;
      if (!refs || refs.length === 0) return;
      if (refs.some((r) => want.has(r))) {
        out.push({
          ref: sectionRef(section.work_section, idx),
          work_section: section.work_section,
          description: line.description,
          quantity: line.quantity,
          unit: line.unit,
          total_aed: line.total_aed,
          needs_qs: line.rate_status === "needs_qs",
        });
      }
    });
  }
  return out;
}

/** True when the BoQ has any line with no element mapping (project-level). */
export function hasUnmappedLines(boq: InspectBoq): boolean {
  return boq.sections.some((s) =>
    s.lines.some((l) => !l.element_refs || l.element_refs.length === 0),
  );
}

// --- target builders (metadata the hosts pass in) ---------------------------

export interface RoomMeta {
  id: string;
  name: string;
  area_m2: number;
  floorFinish: string | null;
  wallFinish: string | null;
  ceilingFinish: string | null;
  wallIds: string[];
}

export interface WallMeta {
  id: string;
  roomName: string | null;
  length_m: number;
  height_m: number;
  thickness_mm: number;
  net_area_m2: number;
  wallFinish: string | null;
}

const m2 = (n: number) => `${Math.round(n * 10) / 10} m²`;
const m = (n: number) => `${Math.round(n * 100) / 100} m`;

export function floorTarget(room: RoomMeta): InspectTarget {
  return {
    kind: "floor",
    title: "Floor",
    roomName: room.name,
    elementIds: [room.id],
    dims: [{ label: "Floor area", value: m2(room.area_m2) }],
    finish: room.floorFinish,
  };
}

export function wallTarget(wall: WallMeta): InspectTarget {
  return {
    kind: "wall",
    title: "Wall",
    roomName: wall.roomName,
    elementIds: [wall.id],
    dims: [
      { label: "Length × height", value: `${m(wall.length_m)} × ${m(wall.height_m)}` },
      { label: "Thickness", value: `${Math.round(wall.thickness_mm)} mm` },
      { label: "Net area", value: m2(wall.net_area_m2) },
    ],
    finish: wall.wallFinish,
  };
}

export function roomTarget(room: RoomMeta): InspectTarget {
  return {
    kind: "room",
    title: room.name,
    roomName: room.name,
    elementIds: [room.id, ...room.wallIds],
    dims: [{ label: "Floor area", value: m2(room.area_m2) }],
    finish: room.floorFinish,
  };
}
