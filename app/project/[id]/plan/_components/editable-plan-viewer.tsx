"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Layers, Plus, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { RoomAreaDispute } from "@/lib/parse/disputes";
import { defaultUnroofed, roomTypeOptions } from "@/lib/plan/zones";
import { findOverlaps } from "@/lib/plan/overlaps";
import { polygonArea } from "@/lib/plan/polygon";
import { separateOverlappingRooms } from "@/lib/plan/separate";
import { cn } from "@/lib/utils";

import {
  editingEnabled,
  roomInteraction,
  svgDragEnabled,
  type PlanViewerMode,
} from "./plan-interaction";

const VIEW_W = 1000;
const VIEW_H = 600;
const PADDING = 24;
const HISTORY_LIMIT = 20;
// Atelier viewer palette — bone room fills at 50% on a paper canvas with
// ink-900 walls.
const BONE_FILL = "#EDE6D8";
const PRIMARY_FIXED = "#FFDDB3";
const INK_900 = "#0F1B2D";
const INK_700 = "#4F4539";
// G1: open zones read as ground, not as floor — a muted sage against the bone.
const OPEN_ZONE_FILL = "#DCE3D2";
const BRASS_600 = "#A4793A";

type Point = [number, number];

type RoomInput = {
  id: string;
  name_en: string | null;
  name_ar: string | null;
  room_type: string | null;
  area_m2: number | null;
  polygon: unknown;
  /** Provider confidence 0..1 (nullable); low values flag the room for review. */
  confidence?: number | null;
  /** G1: open to the sky. Absent → the type's default. */
  unroofed?: boolean | null;
  /** G5: existing feature from site photos, the designer's call on it, derived outline. */
  site_reference?: boolean | null;
  disposition?: string | null;
  dims_derived?: boolean | null;
};

/** G5: an existing, out-of-scope footprint drawn under the zones (the house, a wall). */
export type ContextOutline = { id: string; name: string; kind: string; polygon: number[][] };

/** G1: an authored plan's measured plot. Its presence changes the canvas from
 *  fit-to-content to fit-to-plot, which is what makes a drawn area exact. */
export type PlotSize = { width_m: number; depth_m: number };

type Room = {
  id: string;
  name_en: string;
  name_ar: string | null;
  room_type: string | null;
  area_m2: number;
  // N-vertex polygon in viewBox space (may be non-rectilinear / diagonal).
  polygon: Point[];
  confidence: number | null;
  /** G1: open to the sky — no ceiling, and its edges emit no wall. */
  unroofed: boolean;
  site_reference: boolean;
  disposition: string | null;
  dims_derived: boolean;
  isNew?: boolean;
  isDeleted?: boolean;
};

// "move" drags the whole room; "vertex" drags a single polygon vertex.
type DragKind = "move" | "vertex";
type DragState = {
  kind: DragKind;
  roomId: string;
  vertexIndex?: number;
  start: Point;
  startPolygon: Point[];
  pointerId: number;
};

/** Threshold below which a room is flagged low-confidence in the editor. */
const LOW_CONFIDENCE_FLAG = 0.6;

function isPointArray(value: unknown): value is number[][] {
  if (!Array.isArray(value)) return false;
  for (const point of value) {
    if (
      !Array.isArray(point) ||
      point.length < 2 ||
      typeof point[0] !== "number" ||
      typeof point[1] !== "number"
    ) {
      return false;
    }
  }
  return value.length >= 3;
}

function rectFromBbox(
  xL: number,
  yT: number,
  xR: number,
  yB: number,
): [Point, Point, Point, Point] {
  const x1 = Math.min(xL, xR);
  const x2 = Math.max(xL, xR);
  const y1 = Math.min(yT, yB);
  const y2 = Math.max(yT, yB);
  return [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
  ];
}

function bboxOf(points: Point[]): {
  xL: number;
  yT: number;
  xR: number;
  yB: number;
} {
  let xL = Infinity,
    yT = Infinity,
    xR = -Infinity,
    yB = -Infinity;
  for (const [x, y] of points) {
    if (x < xL) xL = x;
    if (y < yT) yT = y;
    if (x > xR) xR = x;
    if (y > yB) yB = y;
  }
  return { xL, yT, xR, yB };
}

// [x, y, w, h] from a polygon's bounding box. x/y is the top-left
// corner; w/h are the bbox extents. Reused by the dimensions display, the
// overlap-detection effect, and the separation algorithm.
function polygonToRect(
  polygon: Point[],
): [number, number, number, number] {
  const bb = bboxOf(polygon);
  return [bb.xL, bb.yT, bb.xR - bb.xL, bb.yB - bb.yT];
}

// Convert a single linear distance in viewBox pixels to metres, given
// the m² / px² scale factor. One decimal place.
function pixelToM(px: number, scale: number): number {
  return Math.round(px * Math.sqrt(scale) * 10) / 10;
}

// The separation algorithm itself lives in lib/plan/separate.ts so it can be
// unit-tested outside this client component — that is where "zero overlaps +
// every area preserved" is pinned, and where the one non-shape-preserving case
// (the viewBox clamp flattening an N-vertex room to its bbox) is documented.
// `Room` structurally satisfies the module's generic `SeparableRoom`.

type Fit = {
  rooms: Room[];
  /** m² per viewBox px². */
  unitToM2Factor: number;
  initialTotalViewBoxArea: number;
  /**
   * viewBox point → the space the polygon is PERSISTED in.
   *
   * A parsed plan stores viewBox coordinates and re-fits them to content on
   * every load, so this is the identity there and nothing about that path
   * changes. An authored plan stores normalised PLOT coordinates, because its
   * canvas is anchored to the plot rather than to whatever has been drawn so
   * far — which is the only way a zone's area survives a reload unchanged when
   * the next zone drawn would otherwise re-fit the whole canvas.
   */
  toStored: (p: Point) => Point;
  /** Inverse of `toStored` — used when the server hands back repaired geometry. */
  toViewBox: (p: Point) => Point;
};

function toRoom(r: RoomInput, pts: Point[]): Room {
  return {
    id: r.id,
    name_en: r.name_en?.trim() || "Room",
    name_ar: r.name_ar ?? null,
    room_type: r.room_type ?? null,
    area_m2: typeof r.area_m2 === "number" ? r.area_m2 : 0,
    polygon: pts,
    confidence: typeof r.confidence === "number" ? r.confidence : null,
    unroofed: r.unroofed == null ? defaultUnroofed(r.room_type) : r.unroofed === true,
    site_reference: r.site_reference === true,
    disposition: r.disposition ?? null,
    dims_derived: r.dims_derived === true,
  };
}

/**
 * G1: fit the PLOT (not the content) into the viewBox. Normalised plot space
 * has x ∈ [0, 1] spanning the plot width and y scaled by the same factor, so
 * the mapping is isotropic and matches the metric contract in
 * lib/plan/geometry.ts, where unit_to_m is exactly the plot width.
 */
function fitToPlot(rooms: RoomInput[], plot: PlotSize): Fit {
  const spanX = 1;
  const spanY = Math.max(plot.depth_m / plot.width_m, 1e-6);
  const availW = VIEW_W - 2 * PADDING;
  const availH = VIEW_H - 2 * PADDING;
  const scale = Math.min(availW / spanX, availH / spanY);
  const offsetX = (VIEW_W - spanX * scale) / 2;
  const offsetY = (VIEW_H - spanY * scale) / 2;

  const fitted = rooms
    .filter((r) => isPointArray(r.polygon))
    .map((r) =>
      toRoom(
        r,
        (r.polygon as number[][]).map<Point>(([x, y]) => [
          x * scale + offsetX,
          y * scale + offsetY,
        ]),
      ),
    );

  // Metres per viewBox pixel is fixed by the plot, not by what is drawn.
  const mPerPx = plot.width_m / scale;
  return {
    rooms: fitted,
    unitToM2Factor: mPerPx * mPerPx,
    initialTotalViewBoxArea: fitted.reduce((s, r) => s + polygonArea(r.polygon), 0),
    toStored: ([x, y]) => [(x - offsetX) / scale, (y - offsetY) / scale],
    toViewBox: ([x, y]) => [x * scale + offsetX, y * scale + offsetY],
  };
}

// Convert any coordinate space (Claude's [0,1] or pixel) to viewBox space,
// fitting all rooms aspect-preserving with PADDING.
function fitToViewBox(rooms: RoomInput[]): Fit {
  const valid = rooms.filter((r) => isPointArray(r.polygon));
  if (valid.length === 0) {
    return {
      rooms: [],
      unitToM2Factor: 1,
      initialTotalViewBoxArea: 0,
      toStored: (p) => p,
      toViewBox: (p) => p,
    };
  }

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const r of valid) {
    for (const [x, y] of r.polygon as number[][]) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const availW = VIEW_W - 2 * PADDING;
  const availH = VIEW_H - 2 * PADDING;
  const scale = Math.min(availW / spanX, availH / spanY);
  const offsetX = (VIEW_W - spanX * scale) / 2;
  const offsetY = (VIEW_H - spanY * scale) / 2;

  const fitted: Room[] = valid.map((r) => {
    // Keep ALL vertices — do NOT flatten to a bounding rectangle (that was the
    // load-path bug that made every room render rectilinear).
    const pts = (r.polygon as number[][]).map<Point>(([x, y]) => [
      (x - minX) * scale + offsetX,
      (y - minY) * scale + offsetY,
    ]);
    return toRoom(r, pts);
  });

  const initialTotalViewBoxArea = fitted.reduce(
    (s, r) => s + polygonArea(r.polygon),
    0,
  );
  const totalM2 = fitted.reduce((s, r) => s + r.area_m2, 0);
  const unitToM2Factor =
    initialTotalViewBoxArea > 0 && totalM2 > 0
      ? totalM2 / initialTotalViewBoxArea
      : 1;

  return {
    rooms: fitted,
    unitToM2Factor,
    initialTotalViewBoxArea,
    // Parsed plans persist viewBox coordinates, exactly as before.
    toStored: (p) => p,
    toViewBox: (p) => p,
  };
}

type Props = {
  planId: string;
  initialRooms: RoomInput[];
  initialTotalAreaM2: number | null;
  /** Required — every call site must choose. read = view-only + tap-to-inspect,
   *  edit = full geometry editing (parse-confirm). */
  mode: PlanViewerMode;
  /** read mode only: fired when a room is clicked (opens the inspect panel). */
  onInspectRoom?: (roomId: string) => void;
  /** Rooms whose printed dimension and whose outline disagree materially. The
   *  measurement was kept; this is the question that asks a human which to
   *  believe. */
  areaDisputes?: RoomAreaDispute[];
  /** G1: authored plan — the measured plot. Present ⇒ plot-anchored canvas. */
  plot?: PlotSize | null;
  /** G1: offer outdoor zone types in the picker (garden pilot flag). */
  outdoorEnabled?: boolean;
  /** G5: existing footprints (house, garage, boundary walls), normalised plot space. */
  context?: ContextOutline[];
  /** G5: zone id → site-reference state from the latest server render. Wins over
   *  the state this editor was mounted with, so a keep/remove decision taken in
   *  the garden panel shows on the canvas without discarding unsaved edits. */
  siteRefs?: Record<string, { site_reference: boolean; disposition: string | null; dims_derived: boolean }>;
};

export function EditablePlanViewer({
  planId,
  initialRooms,
  mode,
  onInspectRoom,
  areaDisputes,
  plot,
  outdoorEnabled = false,
  context = [],
  siteRefs,
}: Props) {
  const router = useRouter();
  const editing = editingEnabled(mode);
  const fitted = useMemo(
    () => (plot ? fitToPlot(initialRooms, plot) : fitToViewBox(initialRooms)),
    [initialRooms, plot],
  );
  const typeGroups = useMemo(() => roomTypeOptions(outdoorEnabled), [outdoorEnabled]);
  // m²-per-unit factor is anchored to the initial fit and stays stable
  // across edits because `fitted` is memoised on `[initialRooms]` — resize
  // ops on local state never change it.
  const unitToM2Factor = fitted.unitToM2Factor;

  const [rooms, setRooms] = useState<Room[]>(fitted.rooms);
  const [history, setHistory] = useState<Room[][]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  // Derived from `rooms` — `useMemo` instead of state+effect so we don't
  // trigger a second render to sync (the "you might not need an effect"
  // pattern). The lint rule at the old setState-in-effect site was a smell
  // for exactly this case.
  // findOverlaps is the single detector the BoQ 409 and the save record also
  // use. The banner used to run its own bounding-box loop here, which flagged
  // rooms whose boxes crossed while their polygons did not — every L-shaped
  // room next to a neighbour — so the banner could say "uncostable" about a
  // plan the costing route would happily accept.
  const overlappingIds = useMemo(
    () =>
      new Set(
        findOverlaps(
          rooms
            // G5: a removed site-reference zone is not in the design; a zone
            // drawn over its footprint is not an overlap.
            .filter((r) => {
              const s = siteRefs?.[r.id] ?? r;
              return !r.isDeleted && !(s.site_reference && s.disposition === "remove");
            })
            .map((r) => ({ id: r.id, name: r.name_en, polygon: r.polygon })),
        ).room_ids,
      ),
    [rooms, siteRefs],
  );
  // Rooms the parser flagged low-confidence — surfaced for review in the editor.
  const lowConfidenceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of rooms) {
      if (!r.isDeleted && r.confidence != null && r.confidence < LOW_CONFIDENCE_FLAG) {
        ids.add(r.id);
      }
    }
    return ids;
  }, [rooms]);
  // Rooms the user has flagged (split/merge/other) this session — shown marked.
  const [flaggedIds, setFlaggedIds] = useState<Set<string>>(() => new Set());
  // Area disputes the parse recorded, minus the ones answered this session.
  // Answering is not a preference to remember: if someone keeps the label and
  // leaves the outline alone, the contradiction is still there next time, and
  // the plan should say so. Correcting either one clears it for good, because
  // the room's area stops matching the stated figure the dispute was keyed on.
  const [answeredDisputeIds, setAnsweredDisputeIds] = useState<Set<string>>(
    () => new Set(),
  );
  const openDisputes = useMemo(() => {
    const byRoom = new Map<string, RoomAreaDispute>();
    for (const d of areaDisputes ?? []) {
      if (answeredDisputeIds.has(d.room_id)) continue;
      const room = rooms.find((r) => r.id === d.room_id && !r.isDeleted);
      // Once the area no longer matches what the dispute was raised against,
      // somebody has already resolved it by editing.
      if (room && Math.abs(room.area_m2 - d.stated_area_m2) < 0.005) byRoom.set(d.room_id, d);
    }
    return byRoom;
  }, [areaDisputes, answeredDisputeIds, rooms]);
  // Per-session correction counts → posted to parse_metrics on save (the KPI).
  const correctionCounts = useRef({ move: 0, vertex: 0, relabel: 0, delete: 0 });
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const infoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  // Track whether any mutation has been attempted in the current pointer
  // gesture, so we only push history once per drag.
  const dirtyDragRef = useRef(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const visibleRooms = rooms.filter((r) => !r.isDeleted);
  const selectedRoom = visibleRooms.find((r) => r.id === selectedId) ?? null;

  const liveTotalM2 = visibleRooms.reduce((s, r) => s + r.area_m2, 0);
  const openZoneCount = visibleRooms.filter((r) => r.unroofed).length;

  // Push current state onto history (capped to HISTORY_LIMIT entries).
  const snapshot = useCallback(() => {
    setHistory((h) => {
      const next = [...h, rooms.map((r) => ({ ...r, polygon: [...r.polygon] as Room["polygon"] }))];
      return next.length > HISTORY_LIMIT
        ? next.slice(next.length - HISTORY_LIMIT)
        : next;
    });
  }, [rooms]);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setRooms(prev);
      // Selection may point at a room that no longer exists in `prev`.
      setSelectedId((id) => (prev.some((r) => r.id === id) ? id : null));
      setRenamingId(null);
      return h.slice(0, -1);
    });
  }, []);

  // Convert a pointer event's clientX/Y into viewBox coordinates.
  const toViewBox = useCallback((clientX: number, clientY: number): Point => {
    const svg = svgRef.current;
    if (!svg) return [0, 0];
    const rect = svg.getBoundingClientRect();
    return [
      ((clientX - rect.left) / rect.width) * VIEW_W,
      ((clientY - rect.top) / rect.height) * VIEW_H,
    ];
  }, []);

  const recomputeArea = useCallback(
    (poly: Point[]): number => {
      const a = polygonArea(poly) * unitToM2Factor;
      return Math.round(a * 10) / 10;
    },
    [unitToM2Factor],
  );

  const clampToView = (v: number, hi: number) => Math.max(0, Math.min(hi, v));

  // Begin a body-drag (move) — also handles selection on click.
  const onRoomPointerDown = (
    e: ReactPointerEvent<SVGElement>,
    room: Room,
  ) => {
    if (renamingId) return;
    e.stopPropagation();
    setSelectedId(room.id);
    const [px, py] = toViewBox(e.clientX, e.clientY);
    dragRef.current = {
      kind: "move",
      roomId: room.id,
      start: [px, py],
      startPolygon: room.polygon.map(([x, y]) => [x, y] as Point),
      pointerId: e.pointerId,
    };
    dirtyDragRef.current = false;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  // G5: metres ↔ viewBox on a plot-anchored canvas. Identity off a plot.
  const toPlotM = useCallback(
    (p: Point): Point => {
      if (!plot) return p;
      const s = fitted.toStored(p);
      return [s[0] * plot.width_m, s[1] * plot.width_m];
    },
    [plot, fitted],
  );
  const fromPlotM = useCallback(
    (m: Point): Point => (plot ? fitted.toViewBox([m[0] / plot.width_m, m[1] / plot.width_m]) : m),
    [plot, fitted],
  );
  const snapToPlot = useCallback(
    (p: Point): Point => {
      if (!plot) return p;
      const [mx, my] = toPlotM(p);
      return fromPlotM([Math.round(mx * 20) / 20, Math.round(my * 20) / 20]);
    },
    [plot, toPlotM, fromPlotM],
  );

  /** G5: set a zone to an exact rectangle, in metres from the plot's rear-left corner. */
  const setRoomRect = (roomId: string, x: number, y: number, w: number, d: number) => {
    if (!plot || !(w > 0) || !(d > 0)) return;
    snapshot();
    correctionCounts.current.vertex += 1;
    const poly = rectFromBbox(...fromPlotM([x, y]), ...fromPlotM([x + w, y + d])) as Point[];
    setRooms((current) => current.map((r) => (r.id === roomId ? { ...r, polygon: poly, area_m2: recomputeArea(poly) } : r)));
  };

  /** G5: split a zone's longest edge, so an outline can become an L or a notch. */
  const addVertex = (roomId: string) => {
    snapshot();
    setRooms((current) =>
      current.map((r) => {
        if (r.id !== roomId) return r;
        let best = 0;
        let bestLen = -1;
        r.polygon.forEach((p, i) => {
          const q = r.polygon[(i + 1) % r.polygon.length]!;
          const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (len > bestLen) {
            bestLen = len;
            best = i;
          }
        });
        const a = r.polygon[best]!;
        const b = r.polygon[(best + 1) % r.polygon.length]!;
        const mid = snapToPlot([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
        const poly = [...r.polygon.slice(0, best + 1), mid, ...r.polygon.slice(best + 1)];
        return { ...r, polygon: poly, area_m2: recomputeArea(poly) };
      }),
    );
  };

  const removeVertex = (roomId: string, vertexIndex: number) => {
    snapshot();
    correctionCounts.current.vertex += 1;
    setRooms((current) =>
      current.map((r) => {
        if (r.id !== roomId || r.polygon.length <= 3) return r;
        const poly = r.polygon.filter((_, i) => i !== vertexIndex);
        return { ...r, polygon: poly, area_m2: recomputeArea(poly) };
      }),
    );
  };

  // Begin a single-vertex drag.
  const onVertexPointerDown = (
    e: ReactPointerEvent<SVGCircleElement>,
    room: Room,
    vertexIndex: number,
  ) => {
    e.stopPropagation();
    setSelectedId(room.id);
    if (e.shiftKey && room.polygon.length > 3) {
      removeVertex(room.id, vertexIndex);
      return;
    }
    const [px, py] = toViewBox(e.clientX, e.clientY);
    dragRef.current = {
      kind: "vertex",
      roomId: room.id,
      vertexIndex,
      start: [px, py],
      startPolygon: room.polygon.map(([x, y]) => [x, y] as Point),
      pointerId: e.pointerId,
    };
    dirtyDragRef.current = false;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<SVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const [px, py] = toViewBox(e.clientX, e.clientY);
    const dx = px - drag.start[0];
    const dy = py - drag.start[1];

    if (!dirtyDragRef.current) {
      // First move event of this gesture — capture pre-mutation snapshot.
      snapshot();
      dirtyDragRef.current = true;
    }

    setRooms((current) =>
      current.map((r) => {
        if (r.id !== drag.roomId) return r;
        let nextPoly: Point[];
        const snap = snapToPlot;
        if (drag.kind === "move") {
          // Shift the whole polygon; clamp so its bbox stays inside the viewBox
          // (preserves shape — every vertex moves by the same delta).
          const bb = bboxOf(drag.startPolygon);
          let ddx = dx;
          let ddy = dy;
          if (bb.xL + ddx < 0) ddx = -bb.xL;
          if (bb.yT + ddy < 0) ddy = -bb.yT;
          if (bb.xR + ddx > VIEW_W) ddx = VIEW_W - bb.xR;
          if (bb.yB + ddy > VIEW_H) ddy = VIEW_H - bb.yB;
          // G5: on a plot, the top-left corner snaps to a 5 cm grid.
          const corner = snap([bb.xL + ddx, bb.yT + ddy]);
          ddx = corner[0] - bb.xL;
          ddy = corner[1] - bb.yT;
          nextPoly = drag.startPolygon.map(([x, y]) => [x + ddx, y + ddy] as Point);
        } else {
          // Move only the grabbed vertex (clamped into the viewBox).
          const vi = drag.vertexIndex ?? 0;
          nextPoly = drag.startPolygon.map((p, i) =>
            i === vi
              ? snap([clampToView(p[0] + dx, VIEW_W), clampToView(p[1] + dy, VIEW_H)] as Point)
              : ([p[0], p[1]] as Point),
          );
        }
        return { ...r, polygon: nextPoly, area_m2: recomputeArea(nextPoly) };
      }),
    );
  };

  const onPointerUp = (e: ReactPointerEvent<SVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    try {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    // Count a correction only if the gesture actually mutated geometry.
    if (dirtyDragRef.current) {
      if (drag.kind === "move") correctionCounts.current.move += 1;
      else correctionCounts.current.vertex += 1;
    }
    dragRef.current = null;
    dirtyDragRef.current = false;
  };

  // Click on background SVG → deselect.
  const onSvgPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.target === e.currentTarget) {
      setSelectedId(null);
      setRenamingId(null);
    }
  };

  const addRoom = () => {
    snapshot();
    const cx = VIEW_W / 2;
    const cy = VIEW_H / 2;
    const w = 200;
    const h = 150;
    const polygon = rectFromBbox(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2);
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `tmp-${Math.random().toString(36).slice(2)}`;
    // Before G1 this was hard-coded "other" with no way to change it, so every
    // hand-drawn room was permanently unclassified and silently dropped out of
    // the render, the takeoff buckets and the overlay seeding. It now starts on
    // a plausible type for the plan being drawn, and the picker below can
    // change it.
    const room_type = plot && outdoorEnabled ? "paving" : "other";
    const next: Room = {
      id,
      name_en: plot && outdoorEnabled ? "New zone" : "New room",
      name_ar: null,
      room_type,
      area_m2: recomputeArea(polygon),
      polygon,
      confidence: null,
      unroofed: defaultUnroofed(room_type),
      site_reference: false,
      disposition: null,
      dims_derived: false,
      isNew: true,
    };
    setRooms((current) => [...current, next]);
    setSelectedId(id);
  };

  /**
   * Change a room's type. The enclosure flag follows the new type's default,
   * because someone re-typing a room from "living" to "artificial_grass" means
   * it, and leaving a stale roof over a lawn would put a ceiling finish in the
   * BoQ. The explicit toggle below is how you disagree with the default.
   */
  const setRoomType = (roomId: string, room_type: string) => {
    snapshot();
    correctionCounts.current.relabel += 1;
    setRooms((current) =>
      current.map((r) =>
        r.id === roomId ? { ...r, room_type, unroofed: defaultUnroofed(room_type) } : r,
      ),
    );
  };

  const toggleUnroofed = (roomId: string) => {
    snapshot();
    setRooms((current) =>
      current.map((r) => (r.id === roomId ? { ...r, unroofed: !r.unroofed } : r)),
    );
  };

  const deleteRoom = (roomId: string) => {
    snapshot();
    correctionCounts.current.delete += 1;
    setRooms((current) =>
      current
        .map((r) =>
          r.id === roomId
            ? r.isNew
              ? null
              : { ...r, isDeleted: true }
            : r,
        )
        .filter((r): r is Room => r !== null),
    );
    setSelectedId(null);
  };

  const beginRename = (room: Room) => {
    setRenamingId(room.id);
    setRenameDraft(room.name_en);
    setSelectedId(room.id);
    setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 0);
  };

  const commitRename = () => {
    if (!renamingId) return;
    const next = renameDraft.trim() || "Room";
    snapshot();
    correctionCounts.current.relabel += 1;
    setRooms((current) =>
      current.map((r) =>
        r.id === renamingId ? { ...r, name_en: next } : r,
      ),
    );
    setRenamingId(null);
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameDraft("");
  };

  // Recompute the set of overlapping rooms whenever the room layout changes.
  // Show a transient toast-style message at the top of the editor.
  const flashInfo = useCallback((message: string) => {
    setInfoMessage(message);
    if (infoTimerRef.current) clearTimeout(infoTimerRef.current);
    infoTimerRef.current = setTimeout(() => setInfoMessage(null), 2800);
  }, []);

  // Cleanup the info timer on unmount.
  useEffect(
    () => () => {
      if (infoTimerRef.current) clearTimeout(infoTimerRef.current);
    },
    [],
  );

  const fixOverlaps = useCallback(() => {
    const visible = rooms.filter((r) => !r.isDeleted);
    if (visible.length < 2) {
      flashInfo("No overlaps detected");
      return;
    }
    snapshot();
    const adjusted = separateOverlappingRooms(visible, VIEW_W, VIEW_H);
    // Recompute area_m2 in case clamp shrunk a too-large room.
    const adjustedWithAreas = adjusted.map((r) => ({
      ...r,
      area_m2: recomputeArea(r.polygon),
    }));
    // Count rooms whose bbox actually shifted.
    let movedCount = 0;
    for (let i = 0; i < visible.length; i++) {
      const before = polygonToRect(visible[i].polygon);
      const after = polygonToRect(adjustedWithAreas[i].polygon);
      if (
        before[0] !== after[0] ||
        before[1] !== after[1] ||
        before[2] !== after[2] ||
        before[3] !== after[3]
      ) {
        movedCount++;
      }
    }
    // Merge the adjusted visible rooms back into the full rooms array
    // (preserving any deleted ones).
    const adjustedById = new Map(
      adjustedWithAreas.map((r) => [r.id, r] as const),
    );
    setRooms((current) =>
      current.map((r) => (r.isDeleted ? r : (adjustedById.get(r.id) ?? r))),
    );
    flashInfo(
      movedCount > 0
        ? `Adjusted ${movedCount} ${movedCount === 1 ? "room" : "rooms"} to remove overlaps`
        : "No overlaps detected",
    );
  }, [rooms, snapshot, recomputeArea, flashInfo]);

  // Best-effort parse-metrics post (table/route may be absent pre-025).
  const postParseMetrics = useCallback(
    async (body: Record<string, unknown>) => {
      try {
        await fetch("/api/parse-metrics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan_id: planId, ...body }),
        });
      } catch {
        /* best-effort */
      }
    },
    [planId],
  );

  // Escape valve for the deferred split/merge: record unmet demand + mark room.
  const flagIssue = useCallback(
    (roomId: string, reason: "split" | "merge" | "other") => {
      setFlaggedIds((prev) => new Set(prev).add(roomId));
      void postParseMetrics({
        kind: "corrections",
        needed_split_count: reason === "split" ? 1 : 0,
        needed_merge_count: reason === "merge" ? 1 : 0,
        detail: { flag: reason, room_id: roomId },
      });
      flashInfo(
        reason === "split"
          ? "Flagged: should be two rooms"
          : reason === "merge"
            ? "Flagged: should be merged"
            : "Flagged for review",
      );
    },
    [postParseMetrics, flashInfo],
  );

  // A dispute is answered one of two ways, and both are real answers worth
  // recording: the drawing's dimension stands and the outline needs redrawing,
  // or the outline is right and the label was misread. Neither is a dismissal.
  const resolveDispute = useCallback(
    (roomId: string, choice: "label" | "outline") => {
      const dispute = openDisputes.get(roomId);
      if (!dispute) return;
      if (choice === "outline") {
        snapshot();
        setRooms((prev) =>
          prev.map((r) =>
            r.id === roomId ? { ...r, area_m2: dispute.geometric_area_m2 } : r,
          ),
        );
        correctionCounts.current.relabel += 1;
      }
      setAnsweredDisputeIds((prev) => new Set(prev).add(roomId));
      void postParseMetrics({
        kind: "corrections",
        detail: {
          flag: "area_dispute",
          room_id: roomId,
          choice,
          stated_area_m2: dispute.stated_area_m2,
          geometric_area_m2: dispute.geometric_area_m2,
        },
      });
      flashInfo(
        choice === "outline"
          ? `Area set to ${dispute.geometric_area_m2.toFixed(2)} m² from the outline`
          : "Kept the drawing's dimension — check the outline",
      );
    },
    [openDisputes, snapshot, postParseMetrics, flashInfo],
  );

  const save = async () => {
    setSaveStatus("saving");
    setSaveError(null);
    const payload = {
      plan_id: planId,
      rooms: visibleRooms.map((r) => ({
        id: r.id,
        name_en: r.name_en,
        name_ar: r.name_ar,
        room_type: r.room_type,
        area_m2: r.area_m2,
        polygon: r.polygon.map(fitted.toStored),
        unroofed: r.unroofed,
      })),
      deleted_ids: rooms
        .filter((r) => r.isDeleted && !r.isNew)
        .map((r) => r.id),
    };
    try {
      const res = await fetch("/api/update-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => null)) as
        | {
            success?: boolean;
            error?: string;
            repaired_rooms?: { id: string; name_en: string; polygon: Point[]; area_m2: number }[];
          }
        | null;
      if (!res.ok || !body?.success) {
        throw new Error(body?.error ?? `Save failed (${res.status}).`);
      }
      setSaveStatus("saved");
      setHistory([]);
      // The server trims overlapping rooms on the way in. Show what was stored
      // rather than what was dragged, and say so — a silent reshape on the next
      // page load would read as data loss.
      const fixed = body.repaired_rooms ?? [];
      if (fixed.length > 0) {
        const byId = new Map(fixed.map((r) => [r.id, r] as const));
        setRooms((current) =>
          current.map((r) => {
            const f = byId.get(r.id);
            // The server repairs in the space it was sent, so a plot-anchored
            // plan gets normalised polygons back and has to come home.
            return f
              ? { ...r, polygon: f.polygon.map(fitted.toViewBox), area_m2: f.area_m2 }
              : r;
          }),
        );
        flashInfo(
          `Trimmed ${fixed.length} overlapping ${fixed.length === 1 ? "room" : "rooms"}: ${fixed
            .map((r) => r.name_en)
            .join(", ")}`,
        );
      }
      // Record correction counts for the "<3 corrections/plan" KPI, then reset.
      const c = correctionCounts.current;
      const correction_total = c.move + c.vertex + c.relabel + c.delete;
      if (correction_total > 0) {
        void postParseMetrics({ kind: "corrections", corrections: { ...c }, correction_total });
        correctionCounts.current = { move: 0, vertex: 0, relabel: 0, delete: 0 };
      }
      // Make the page re-render so server-fetched totals/rooms refresh.
      router.refresh();
      setTimeout(() => setSaveStatus("idle"), 1500);
    } catch (err) {
      setSaveStatus("error");
      setSaveError(err instanceof Error ? err.message : "Save failed.");
    }
  };

  const canUndo = history.length > 0;

  return (
    <div className="space-y-3">
      {/* D3: persistent and non-dismissible while overlaps exist. Saving stays
          ENABLED — an overlap is a normal transient state mid-edit, and
          blocking the save would leave unsaved work one refresh from being
          lost. What overlaps actually block is COSTING, so the banner says
          exactly that rather than nagging. */}
      {editing && overlappingIds.size > 0 && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-md rounded-lg border border-[#E8C9A0] bg-[#FEF6EC] px-lg py-md"
        >
          <span
            className="material-symbols-outlined text-[20px] text-[#92400E]"
            aria-hidden="true"
          >
            layers
          </span>
          <div className="min-w-[18rem] flex-1">
            <p className="font-body-sm text-body-sm font-semibold text-ink-900">
              {overlappingIds.size} overlapping{" "}
              {overlappingIds.size === 1 ? "room" : "rooms"} — this plan
              can&apos;t be costed until they&apos;re resolved.
            </p>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              Overlaps double-count floor and wall area, so the BoQ would be
              wrong. Your changes still save normally. Fixing moves the rooms
              apart rather than reshaping them, so every room keeps its area.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={fixOverlaps}
            className="bg-brass-600 text-on-primary hover:bg-primary"
          >
            <Layers />
            Fix overlaps
          </Button>
        </div>
      )}

      {editing && (
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addRoom}
            className="border-ink-100 bg-paper text-ink-900 hover:bg-surface-container"
          >
            <Plus />
            Add room
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={undo}
            disabled={!canUndo}
            className="text-on-surface-variant hover:text-ink-900"
          >
            <Undo2 />
            Undo
            {canUndo && (
              <span className="ml-1 text-xs text-ink-500">
                ({history.length})
              </span>
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={fixOverlaps}
            className={cn(
              "border-ink-100 bg-paper text-ink-900 hover:bg-surface-container",
              overlappingIds.size > 0 &&
                "border-status-error/60 text-status-error hover:bg-status-error/10",
            )}
          >
            <Layers />
            Fix overlaps
            {overlappingIds.size > 0 && (
              <span className="ml-1 text-xs">({overlappingIds.size})</span>
            )}
          </Button>
          {lowConfidenceIds.size > 0 && (
            <span className="ml-1 rounded-full bg-[#FEF3C7] px-2 py-0.5 text-xs font-medium text-[#92400E]">
              {lowConfidenceIds.size} to review
            </span>
          )}
          {/* G1: the type picker. Every downstream classifier — render, takeoff
              bucket, overlay seeding — keys off this one field, and until now a
              drawn room could not set it at all. */}
          {selectedRoom && (
            <span className="ml-2 flex items-center gap-1.5 text-xs text-ink-500">
              <label htmlFor="room-type-picker" className="sr-only">
                Room or zone type
              </label>
              <select
                id="room-type-picker"
                value={selectedRoom.room_type ?? "other"}
                onChange={(e) => setRoomType(selectedRoom.id, e.target.value)}
                className="focus-ring rounded border border-ink-100 bg-paper px-1.5 py-0.5 text-xs text-ink-900"
              >
                {typeGroups.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                        {o.note ? ` (${o.note})` : ""}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <button
                type="button"
                onClick={() => toggleUnroofed(selectedRoom.id)}
                aria-pressed={selectedRoom.unroofed}
                title={
                  selectedRoom.unroofed
                    ? "Open to the sky: no ceiling, and its edges emit no wall"
                    : "Enclosed: walls at shared edges, ceiling finish priced"
                }
                className={cn(
                  "focus-ring inline-flex items-center gap-1 rounded border px-1.5 py-0.5",
                  selectedRoom.unroofed
                    ? "border-brass-600 bg-primary-fixed/40 text-ink-900"
                    : "border-ink-100 bg-paper text-ink-700 hover:bg-surface-container",
                )}
              >
                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                  {selectedRoom.unroofed ? "wb_sunny" : "roofing"}
                </span>
                {selectedRoom.unroofed ? "Unroofed" : "Roofed"}
              </button>
            </span>
          )}
          {selectedId && (
            <span className="ml-2 flex items-center gap-1 text-xs text-ink-500">
              Flag:
              <button
                type="button"
                onClick={() => flagIssue(selectedId, "split")}
                className="rounded border border-ink-100 px-1.5 py-0.5 text-ink-700 hover:bg-surface-container"
              >
                split
              </button>
              <button
                type="button"
                onClick={() => flagIssue(selectedId, "merge")}
                className="rounded border border-ink-100 px-1.5 py-0.5 text-ink-700 hover:bg-surface-container"
              >
                merge
              </button>
              <button
                type="button"
                onClick={() => flagIssue(selectedId, "other")}
                className="rounded border border-ink-100 px-1.5 py-0.5 text-ink-700 hover:bg-surface-container"
              >
                other
              </button>
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {infoMessage && (
            <span className="text-xs text-on-surface-variant">{infoMessage}</span>
          )}
          {saveStatus === "saved" && (
            <span className="text-xs text-status-success">Saved.</span>
          )}
          {saveStatus === "error" && saveError && (
            <span className="max-w-[260px] truncate text-xs text-status-error">
              {saveError}
            </span>
          )}
          <Button
            type="button"
            size="sm"
            onClick={save}
            disabled={saveStatus === "saving"}
          >
            {saveStatus === "saving" ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
      )}

      {/* G5: exact geometry for the selected zone, in metres on the plot. A
          garden is set out from dimensions, not dragged into place. */}
      {editing && plot && selectedRoom && (
        <ZoneGeometryBar
          key={`${selectedRoom.id}:${selectedRoom.polygon.map((p) => p.join(",")).join(";")}`}
          room={selectedRoom}
          toPlotM={toPlotM}
          onRect={(x, y, w, d) => setRoomRect(selectedRoom.id, x, y, w, d)}
          onAddVertex={() => addVertex(selectedRoom.id)}
        />
      )}

      {/* Area disputes. The drawing prints a dimension for this room and the
          outline works out to something materially different; both cannot be
          right, and only a person can say which. The parse kept the printed
          figure — it does not get overruled by a vision model's guess at where
          the walls are — so what is left is a question, asked here with both
          numbers in it rather than a flag nobody can act on. */}
      {editing && openDisputes.size > 0 && (
        <div className="mb-3 rounded-md border border-[#FDE68A] bg-[#FFFBEB] p-3">
          <p className="mb-2 text-xs font-medium text-[#92400E]">
            {openDisputes.size === 1
              ? "1 room where the drawing and the outline disagree"
              : `${openDisputes.size} rooms where the drawing and the outline disagree`}
          </p>
          <ul className="space-y-2">
            {[...openDisputes.values()].map((d) => {
              const room = visibleRooms.find((r) => r.id === d.room_id);
              if (!room) return null;
              return (
                <li
                  key={d.room_id}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-700"
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(d.room_id)}
                    className="font-medium text-ink-900 underline decoration-dotted underline-offset-2"
                  >
                    {room.name_en}
                  </button>
                  <span>
                    drawing says{" "}
                    <span className="font-mono tabular-nums">
                      {d.stated_area_m2.toFixed(2)}
                    </span>{" "}
                    m², outline measures{" "}
                    <span className="font-mono tabular-nums">
                      {d.geometric_area_m2.toFixed(2)}
                    </span>{" "}
                    m².
                  </span>
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => resolveDispute(d.room_id, "label")}
                      className="rounded border border-ink-100 bg-paper px-1.5 py-0.5 text-ink-700 hover:bg-surface-container"
                    >
                      Keep the drawing
                    </button>
                    <button
                      type="button"
                      onClick={() => resolveDispute(d.room_id, "outline")}
                      className="rounded border border-ink-100 bg-paper px-1.5 py-0.5 text-ink-700 hover:bg-surface-container"
                    >
                      Use the outline
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-ink-100 bg-paper">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="block h-auto w-full select-none touch-none"
          role="img"
          aria-label={editing ? "Editable floorplan" : "Floorplan (view-only)"}
          onPointerDown={svgDragEnabled(mode) ? onSvgPointerDown : undefined}
          onPointerMove={svgDragEnabled(mode) ? onPointerMove : undefined}
          onPointerUp={svgDragEnabled(mode) ? onPointerUp : undefined}
        >
          {/* Hover affordances per spec — pure CSS keeps the state
              machine untouched. fill is overridable because the polygon
              sets it as a presentation attribute (not inline style). */}
          <style>{`
            .room-group .room-poly { transition: fill 200ms ease-out, fill-opacity 200ms ease-out; }
            .room-group .room-label { transition: transform 200ms ease-out; }
            .room-group:hover .room-poly { fill: ${PRIMARY_FIXED}; fill-opacity: 0.7; }
            .room-group:hover .room-label { transform: translateY(-2px); }
          `}</style>
          {/* G5: existing footprints under the zones — the house is where the
              garden is not, and designing without it is designing blind. */}
          {plot &&
            context.map((c) => {
              const pts = c.polygon.map(([x, y]) => fitted.toViewBox([x, y]));
              const bb = bboxOf(pts);
              const building = c.kind === "existing_building";
              return (
                <g key={`ctx-${c.id}`} pointerEvents="none">
                  <polygon
                    points={pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}
                    fill={building ? "#D9D6CF" : "#8A8F98"}
                    fillOpacity={building ? 0.7 : 0.9}
                    stroke="#6B7280"
                    strokeWidth={1}
                  />
                  {building && (
                    <text x={(bb.xL + bb.xR) / 2} y={(bb.yT + bb.yB) / 2} textAnchor="middle" dominantBaseline="middle" fontSize="12" fill="#4B5563" style={{ fontFamily: "var(--font-inter), sans-serif", letterSpacing: "0.05em" }}>
                      {c.name.toUpperCase()}
                    </text>
                  )}
                </g>
              );
            })}
          {visibleRooms.length === 0 ? (
            <text
              x={VIEW_W / 2}
              y={VIEW_H / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="var(--color-ink-500)"
              fontSize="16"
            >
              {plot
                ? "Nothing drawn yet — click “Add room” to place your first zone."
                : "No rooms yet — click “Add room” to start."}
            </text>
          ) : (
            visibleRooms.map((stored, index) => {
              const room = siteRefs?.[stored.id] ? { ...stored, ...siteRefs[stored.id] } : stored;
              const selected = selectedId === room.id;
              const renaming = renamingId === room.id;
              const overlapping = overlappingIds.has(room.id);
              const flagged =
                lowConfidenceIds.has(room.id) ||
                flaggedIds.has(room.id) ||
                openDisputes.has(room.id);
              const bb = bboxOf(room.polygon);
              // Mode gate: edit → body-drag, read → inspect-on-click.
              const roomMode = roomInteraction(mode);
              const cx = (bb.xL + bb.xR) / 2;
              const cy = (bb.yT + bb.yB) / 2;
              const rectWPx = bb.xR - bb.xL;
              const rectHPx = bb.yB - bb.yT;
              const widthM = pixelToM(rectWPx, unitToM2Factor);
              const heightM = pixelToM(rectHPx, unitToM2Factor);
              const areaInt = Math.round(room.area_m2);
              // G5: a derived outline says so on the canvas, not only in a report.
              const dimsLine = `${room.dims_derived ? "≈ " : ""}${widthM} × ${heightM} m`;
              const removed = room.site_reference && room.disposition === "remove";
              const areaLabel = `${areaInt} m²`;
              const inlineLine = `${dimsLine} · ${areaLabel}`;
              return (
                <motion.g
                  key={room.id}
                  className="room-group"
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{
                    duration: 0.35,
                    ease: "easeOut",
                    delay: index * 0.06,
                  }}
                  style={{ transformOrigin: `${cx}px ${cy}px` }}
                >
                  {/* G1: an unroofed zone is drawn with an open edge — a dashed
                      hairline, not a wall line — because its boundary emits no
                      wall unless one is drawn. The plan should look like what
                      the geometry actually says. */}
                  <polygon
                    className="room-poly"
                    points={room.polygon
                      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
                      .join(" ")}
                    fill={room.unroofed ? OPEN_ZONE_FILL : BONE_FILL}
                    fillOpacity={removed ? 0.12 : room.unroofed ? 0.45 : 0.5}
                    stroke={room.site_reference ? BRASS_600 : room.unroofed ? INK_700 : INK_900}
                    strokeOpacity={room.unroofed ? 0.7 : 1}
                    strokeDasharray={room.site_reference ? "3 3" : room.unroofed ? "6 4" : undefined}
                    strokeWidth={editing && selected ? 2.5 : room.site_reference ? 2 : 1.5}
                    style={{ cursor: roomMode === "drag" ? "grab" : "pointer" }}
                    onPointerDown={
                      roomMode === "drag"
                        ? (e) => onRoomPointerDown(e, room)
                        : undefined
                    }
                    onClick={
                      roomMode === "inspect"
                        ? () => onInspectRoom?.(room.id)
                        : undefined
                    }
                  />

                  {room.site_reference && (
                    <text
                      x={bb.xL + 6}
                      y={bb.yT + 14}
                      fontSize="10"
                      fill={BRASS_600}
                      pointerEvents="none"
                      style={{ fontFamily: "var(--font-inter), sans-serif", letterSpacing: "0.06em", fontWeight: 600 }}
                    >
                      {room.disposition === "remove" ? "EXISTING · TO REMOVE" : room.disposition === "replace" ? "EXISTING · REPLACE" : room.disposition === "keep" ? "EXISTING · KEEP" : "EXISTING · UNDECIDED"}
                    </text>
                  )}

                  {overlapping && (
                    <polygon
                      points={room.polygon
                        .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
                        .join(" ")}
                      fill="none"
                      stroke="#F87171"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      pointerEvents="none"
                    />
                  )}

                  {/* Low-confidence / user-flagged room → amber "check me" outline. */}
                  {flagged && !overlapping && (
                    <polygon
                      points={room.polygon
                        .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
                        .join(" ")}
                      fill="none"
                      stroke="#D97706"
                      strokeWidth={1.5}
                      strokeDasharray="5 3"
                      pointerEvents="none"
                    />
                  )}

                  {renaming ? (
                    <foreignObject
                      x={cx - 110}
                      y={cy - 16}
                      width={220}
                      height={30}
                    >
                      <input
                        ref={renameInputRef}
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            commitRename();
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            cancelRename();
                          }
                        }}
                        onBlur={commitRename}
                        className="h-7 w-full rounded-md border border-brass-600 bg-paper px-2 text-center text-sm font-medium text-ink-900 outline-none ring-2 ring-brass-600/20"
                        aria-label="Rename room"
                      />
                    </foreignObject>
                  ) : (
                    <g className="room-label">
                      {(() => {
                        const hasAr = !!room.name_ar?.trim();
                        // Layout per width bucket. The y values position the
                        // EN baseline so the stack reads visually centred:
                        //   wide   (≥120): EN, AR (if any), area
                        //   medium (70–119): EN, area
                        //   narrow (<70):    area only
                        const wide = rectWPx >= 120;
                        const medium = rectWPx >= 70 && rectWPx < 120;
                        const enY = wide ? (hasAr ? cy - 14 : cy - 8) : medium ? cy - 6 : cy;
                        const arY = wide && hasAr ? cy + 4 : null;
                        const areaY = wide
                          ? hasAr
                            ? cy + 22
                            : cy + 10
                          : medium
                            ? cy + 10
                            : cy + 4;
                        return (
                          <>
                            {(wide || medium) && (
                              <text
                                x={cx}
                                y={enY}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                fontSize="13"
                                fontWeight={500}
                                fill={INK_900}
                                pointerEvents={editing ? undefined : "none"}
                                style={{
                                  cursor: editing ? "text" : "pointer",
                                  fontFamily: "var(--font-inter), sans-serif",
                                }}
                                onPointerDown={
                                  editing
                                    ? (e) => onRoomPointerDown(e, room)
                                    : undefined
                                }
                                onDoubleClick={
                                  editing
                                    ? (e) => {
                                        e.stopPropagation();
                                        beginRename(room);
                                      }
                                    : undefined
                                }
                              >
                                {room.name_en}
                              </text>
                            )}
                            {arY != null && (
                              <text
                                x={cx}
                                y={arY}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                fontSize="13"
                                fontWeight={500}
                                fill={INK_900}
                                pointerEvents="none"
                                style={{
                                  fontFamily: "var(--font-rubik), serif",
                                  direction: "rtl",
                                }}
                              >
                                {room.name_ar}
                              </text>
                            )}
                            <text
                              x={cx}
                              y={areaY}
                              textAnchor="middle"
                              dominantBaseline="middle"
                              fontSize="11"
                              fontWeight={500}
                              fill={INK_700}
                              pointerEvents="none"
                              style={{
                                fontFamily:
                                  "var(--font-jetbrains-mono), monospace",
                              }}
                            >
                              {wide && !hasAr ? inlineLine : areaLabel}
                              {medium ? ` · ${dimsLine}` : ""}
                            </text>
                          </>
                        );
                      })()}
                    </g>
                  )}

                  {editing && selected && !renaming && (
                    <>
                      {/* One draggable handle per polygon vertex (N-vertex). */}
                      {room.polygon.map(([hx, hy], vertexIndex) => (
                        <circle
                          key={vertexIndex}
                          cx={hx}
                          cy={hy}
                          r={7}
                          fill="#A855F7"
                          stroke="#0B0712"
                          strokeWidth={2}
                          style={{ cursor: "move" }}
                          onPointerDown={(e) => onVertexPointerDown(e, room, vertexIndex)}
                        >
                          <title>{`Drag to reshape${plot ? " (snaps to 5 cm)" : ""}; shift-click to remove this vertex`}</title>
                        </circle>
                      ))}

                      {/* Delete X above the top-right corner. */}
                      <g
                        style={{ cursor: "pointer" }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          deleteRoom(room.id);
                        }}
                      >
                        <circle
                          cx={bb.xR + 10}
                          cy={bb.yT - 10}
                          r={11}
                          fill="#F87171"
                          stroke="#0B0712"
                          strokeWidth={2}
                        />
                        <line
                          x1={bb.xR + 6}
                          y1={bb.yT - 14}
                          x2={bb.xR + 14}
                          y2={bb.yT - 6}
                          stroke="#0B0712"
                          strokeWidth={2}
                          strokeLinecap="round"
                        />
                        <line
                          x1={bb.xR + 14}
                          y1={bb.yT - 14}
                          x2={bb.xR + 6}
                          y2={bb.yT - 6}
                          stroke="#0B0712"
                          strokeWidth={2}
                          strokeLinecap="round"
                        />
                      </g>
                    </>
                  )}
                </motion.g>
              );
            })
          )}
        </svg>
      </div>

      <p className="text-xs text-ink-500">
        {editing ? (
          <>
            Click a room to select. Drag the body to move, drag a vertex to
            reshape, double-click the name to rename. Set its type with the
            picker above.{" "}
            {openZoneCount > 0
              ? `${openZoneCount} zone${openZoneCount === 1 ? " is" : "s are"} open to the sky (dashed) — those edges carry no wall. `
              : ""}
            Amber = low confidence; use Flag if a room should be split or
            merged. Live total:{" "}
          </>
        ) : (
          <>Click a room to see what it is and what it costs. Total:{" "}</>
        )}
        <span className="text-on-surface-variant">
          {liveTotalM2.toFixed(1)} m²
        </span>
        .
      </p>
    </div>
  );
}


/**
 * G5: the selected zone's exact geometry. A rectangle is edited as X / Y / W / D
 * in metres from the plot's rear-left corner; any other outline shows its vertex
 * count and can still gain a vertex (the longest edge splits) or lose one
 * (shift-click its handle).
 */
function ZoneGeometryBar({
  room,
  toPlotM,
  onRect,
  onAddVertex,
}: {
  room: Room;
  toPlotM: (p: Point) => Point;
  onRect: (x: number, y: number, w: number, d: number) => void;
  onAddVertex: () => void;
}) {
  const m = room.polygon.map(toPlotM);
  const xs = m.map((p) => p[0]);
  const ys = m.map((p) => p[1]);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const isRect =
    m.length === 4 &&
    m.every((p, i) => {
      const q = m[(i + 1) % 4]!;
      return Math.abs(p[0] - q[0]) < 0.011 || Math.abs(p[1] - q[1]) < 0.011;
    });
  const init = { x: r2(Math.min(...xs)), y: r2(Math.min(...ys)), w: r2(Math.max(...xs) - Math.min(...xs)), d: r2(Math.max(...ys) - Math.min(...ys)) };
  const [v, setV] = useState(init);
  const apply = () => onRect(v.x, v.y, v.w, v.d);
  const field = (k: keyof typeof v, label: string) => (
    <label className="flex items-center gap-1">
      <span className="text-ink-500">{label}</span>
      <input
        type="number"
        step={0.05}
        value={v[k]}
        onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })}
        onKeyDown={(e) => {
          if (e.key === "Enter") apply();
        }}
        className="focus-ring w-[72px] rounded border border-ink-100 bg-paper px-1.5 py-0.5 text-right font-mono text-xs tabular-nums text-ink-900"
      />
    </label>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-ink-100 bg-canvas px-3 py-2 text-xs text-ink-700">
      <span className="font-semibold text-ink-900">{room.name_en}</span>
      {isRect ? (
        <>
          {field("x", "X")}
          {field("y", "Y")}
          {field("w", "W")}
          {field("d", "D")}
          <span className="text-ink-500">m</span>
          <button type="button" onClick={apply} className="focus-ring rounded border border-ink-100 bg-paper px-2 py-0.5 font-medium text-ink-900 hover:bg-surface-container">
            Apply
          </button>
        </>
      ) : (
        <span className="font-mono tabular-nums">{m.length} vertices · {init.w} × {init.d} m extents</span>
      )}
      <button type="button" onClick={onAddVertex} className="focus-ring rounded border border-ink-100 bg-paper px-2 py-0.5 font-medium text-ink-900 hover:bg-surface-container">
        + Vertex
      </button>
      <span className="text-ink-500">Shift-click a vertex to remove it. X/Y from the plot&apos;s top-left corner.</span>
      {room.dims_derived && <span className="rounded-full bg-[#FEF3C7] px-2 py-0.5 font-medium text-[#92400E]">Derived outline</span>}
    </div>
  );
}
