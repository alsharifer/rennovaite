"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";

import { TopBarActions } from "@/components/blueprint/shell/TopBar";
import type { RoomAreaDispute } from "@/lib/parse/disputes";
import { defaultUnroofed, roomTypeOptions } from "@/lib/plan/zones";
import polygonClipping from "polygon-clipping";

import { findOverlaps } from "@/lib/plan/overlaps";
import { polygonArea } from "@/lib/plan/polygon";
import { fitRoomLabel } from "@/lib/plan/label-fit";
import { snapVertexSquare } from "@/lib/plan/plan-rules";
import { labelLanguageMismatch } from "@/lib/plan/room-names";
import { trimOverlappingRooms, type Unresolved } from "@/lib/plan/trim-overlaps";
import { Icon } from "@/components/blueprint/Icon";

import {
  CANVAS_FRAME,
  CAPTION,
  CHIP_BTN,
  chipState,
  FIELD,
  INSPECTOR_BAR,
  NUM_FIELD,
  SMALL_BTN,
  SVG,
  TAG,
  TOOL_BTN,
} from "./editor-chrome";
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
// Blueprint viewer palette (K5 canvas, K8 chrome) — semantic tokens, so the
// canvas follows the theme: room fills at 50% on the raised canvas, ink walls,
// ink handles, brass only as a line (selection, existing items).
const ROOM_FILL = SVG.roomFill;
const HOVER_FILL = SVG.hoverFill;
const INK = SVG.ink;
const INK_ON = SVG.surface;
const INK_SECONDARY = SVG.inkSecondary;
// G1: open zones read as ground, not as floor — lighter than a floor, dashed edge.
const OPEN_ZONE_FILL = SVG.openFill;
const BRASS = SVG.brass;

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
  /** K12 (058): false = not in this renovation (drawn dashed, never priced). */
  in_scope?: boolean | null;
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
  /** K12: in this renovation (the 01 Plan checklist). */
  in_scope: boolean;
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

// Convert a single linear distance in viewBox pixels to metres, given
// the m² / px² scale factor. One decimal place.
function pixelToM(px: number, scale: number): number {
  return Math.round(px * Math.sqrt(scale) * 10) / 10;
}

// "Fix overlaps" lives in lib/plan/trim-overlaps.ts (unit-tested outside this
// client component): it trims shared floor and never moves a room. 15 Oct: it
// PREVIEWS first ("total X → Y m²", the trimmed outlines on the canvas) and
// changes nothing until Apply.
type TrimPreview = {
  /** The rooms the preview was computed from — a different array means it is stale. */
  basis: Room[];
  byId: Map<string, Room>;
  unresolved: Unresolved[];
  before: number;
  after: number;
};

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
    in_scope: r.in_scope !== false,
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
  /** 15 Oct: room id → the size the sheet prints (m²) — Fix overlaps trims the room further over it. */
  printedSizes?: Record<string, number>;
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
  printedSizes,
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
  // Rule 11 (15 Oct): a room renamed in English this session keeps its Arabic
  // label until somebody updates it — flagged here; the plan check flags a
  // pair it can tell disagree (lib/plan/room-names.ts) after the save too.
  const [arStale, setArStale] = useState<Set<string>>(() => new Set());
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
  const overlapReport = useMemo(
    () =>
      findOverlaps(
        rooms
          // G5: a removed site-reference zone is not in the design; a zone
          // drawn over its footprint is not an overlap.
          .filter((r) => {
            const s = siteRefs?.[r.id] ?? r;
            return !r.isDeleted && !(s.site_reference && s.disposition === "remove");
          })
          .map((r) => ({ id: r.id, name: r.name_en, polygon: r.polygon })),
      ),
    [rooms, siteRefs],
  );
  const overlappingIds = useMemo(() => new Set(overlapReport.room_ids), [overlapReport]);
  // K5 (24:814): the floor each overlapping pair counts twice, drawn as its own
  // shape — ink 30% with a dashed ink outline — over rooms at ink 5%.
  const overlapShapes = useMemo(() => {
    if (!overlapReport.has_overlaps) return [] as [number, number][][];
    const byId = new Map(rooms.map((r) => [r.id, r.polygon]));
    const out: [number, number][][] = [];
    for (const p of overlapReport.pairs) {
      const a = byId.get(p.a_id);
      const b = byId.get(p.b_id);
      if (!a || !b) continue;
      try {
        const ring = (pts: [number, number][]) => [...pts, pts[0]!];
        const mp = polygonClipping.intersection([ring(a)] as never, [ring(b)] as never) as unknown as [number, number][][][];
        for (const poly of mp) if (poly[0]) out.push(poly[0]);
      } catch {
        /* a degenerate ring: the pair is still listed in the plan check */
      }
    }
    return out;
  }, [overlapReport, rooms]);
  // K5: the plan check's overlap list selects BOTH rooms of a pair.
  const [focusIds, setFocusIds] = useState<string[]>([]);
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
  const [trimPreviewState, setTrimPreview] = useState<TrimPreview | null>(null);
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
  // A preview holds only while the rooms it was computed from are on screen.
  const trimPreview = trimPreviewState && trimPreviewState.basis === rooms ? trimPreviewState : null;
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
          const n = drag.startPolygon.length;
          // Rule 9 (15 Oct): the edges it meets snap square within 5°.
          const moved = snapVertexSquare(
            drag.startPolygon[(vi - 1 + n) % n]!,
            snap([clampToView(drag.startPolygon[vi]![0] + dx, VIEW_W), clampToView(drag.startPolygon[vi]![1] + dy, VIEW_H)] as Point),
            drag.startPolygon[(vi + 1) % n]!,
          );
          nextPoly = drag.startPolygon.map((p, i) => (i === vi ? moved : ([p[0], p[1]] as Point)));
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
      // K12: a newly drawn room is in this renovation (the column default).
      in_scope: true,
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

  const setArabicName = (roomId: string, nameAr: string) => {
    const next = nameAr.trim() || null;
    const room = rooms.find((r) => r.id === roomId);
    if (!room || (room.name_ar ?? null) === next) return;
    snapshot();
    correctionCounts.current.relabel += 1;
    setRooms((current) => current.map((r) => (r.id === roomId ? { ...r, name_ar: next } : r)));
    setArStale((s) => {
      const n = new Set(s);
      n.delete(roomId);
      return n;
    });
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
    const was = rooms.find((r) => r.id === renamingId);
    if (was && was.name_en !== next && was.name_ar?.trim()) setArStale((s) => new Set(s).add(renamingId));
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

  const nameOfRoom = useCallback((id: string) => rooms.find((r) => r.id === id)?.name_en ?? "a room", [rooms]);
  const unresolvedText = useCallback(
    (unresolved: Unresolved[]) =>
      unresolved.length
        ? ` ${unresolved.length} left: ${unresolved
            .map((u) => `${nameOfRoom(u.a_id)} ${u.reason === "would_cut_hole" ? "contains" : u.reason === "would_split_room" ? "crosses" : "is covered by"} ${nameOfRoom(u.b_id)}`)
            .join("; ")} — split or reshape by hand.`
        : "",
    [nameOfRoom],
  );

  // 15 Oct: Fix overlaps NEVER moves a room. It trims the shared floor from
  // one room of each pair (lib/plan/trim-overlaps.ts) — the old rigid push
  // walked prod Mudon's east rooms off the building — removing exactly the
  // overlap: a trimmed room's area drops by the floor it lost, so the total
  // falls by exactly the floor that was counted twice. It previews first.
  const fixOverlaps = useCallback(() => {
    const visible = rooms.filter((r) => !r.isDeleted);
    if (visible.length < 2) {
      flashInfo("No overlaps detected");
      return;
    }
    const out = trimOverlappingRooms(
      visible.map((r) => ({ ...r, printed_m2: printedSizes?.[r.id] ?? null })),
      { m2PerUnit2: unitToM2Factor },
    );
    if (out.trimmed.length === 0 && out.unresolved.length === 0) {
      flashInfo("No overlaps detected");
      return;
    }
    const changed = new Set(out.trimmed.map((t) => t.id));
    const byId = new Map<string, Room>(
      out.rooms
        .filter((r) => changed.has(r.id))
        .map((r) => {
          const { printed_m2: _printed, ...room } = r;
          void _printed;
          return [r.id, { ...room, area_m2: Math.round(room.area_m2 * 10) / 10 }] as const;
        }),
    );
    setTrimPreview({ basis: rooms, byId, unresolved: out.unresolved, before: out.total_before_m2 ?? liveTotalM2, after: out.total_after_m2 ?? liveTotalM2 });
  }, [rooms, printedSizes, unitToM2Factor, liveTotalM2, flashInfo]);

  const applyTrim = useCallback(() => {
    if (!trimPreview) return;
    const { byId, unresolved } = trimPreview;
    if (byId.size > 0) {
      snapshot();
      setRooms((current) => current.map((r) => (r.isDeleted ? r : (byId.get(r.id) ?? r))));
    }
    setTrimPreview(null);
    flashInfo(
      byId.size > 0
        ? `Trimmed ${byId.size} ${byId.size === 1 ? "room" : "rooms"} where they overlapped — nothing moved.${unresolvedText(unresolved)}`
        : `Nothing trimmed.${unresolvedText(unresolved)}`,
    );
  }, [trimPreview, snapshot, flashInfo, unresolvedText]);

  // K5: the plan page's Plan check panel drives the editor through two window
  // events — "Fix overlaps · N" runs the same separation as the toolbar, and an
  // overlap row selects both rooms of its pair.
  useEffect(() => {
    if (!editing) return;
    const onFix = () => fixOverlaps();
    const onSelect = (e: Event) => {
      const ids = (e as CustomEvent<{ ids?: string[] }>).detail?.ids ?? [];
      setFocusIds(ids);
      setSelectedId(ids[0] ?? null);
    };
    window.addEventListener("rv:plan-fix-overlaps", onFix);
    window.addEventListener("rv:plan-select-rooms", onSelect);
    return () => {
      window.removeEventListener("rv:plan-fix-overlaps", onFix);
      window.removeEventListener("rv:plan-select-rooms", onSelect);
    };
  }, [editing, fixOverlaps]);

  // K12: the "Rooms in this renovation" checklist saves, then tells the canvas which rooms
  // left or joined — they are redrawn dashed / solid at once (nothing else about them changes).
  useEffect(() => {
    const onScope = (e: Event) => {
      const d = (e as CustomEvent<{ ids?: string[]; in_scope?: boolean }>).detail;
      if (!d?.ids?.length || typeof d.in_scope !== "boolean") return;
      const ids = new Set(d.ids);
      setRooms((prev) => prev.map((r) => (ids.has(r.id) ? { ...r, in_scope: d.in_scope! } : r)));
    };
    window.addEventListener("rv:plan-scope", onScope);
    return () => window.removeEventListener("rv:plan-scope", onScope);
  }, []);

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
      // K5: the plan page's Plan check (and the rail) are read on the server — refresh them.
      router.refresh();
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
  // K5: every edit snapshots history and a save clears it, so "something to save" = history, or a save that failed.
  const dirty = canUndo || saveStatus === "error";

  return (
    <div className="space-y-3">
      {/* D3 / K5: overlaps block COSTING, never saving. On the plan page the
          Plan check panel states them (the inverse block, the pairs, what is
          blocked downstream); the canvas draws the floor counted twice. */}
      {editing && (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={addRoom} className={TOOL_BTN}>
            <span className="bp-icon text-[16px]" aria-hidden="true">add_box</span>
            Add room
          </button>
          <button type="button" onClick={fixOverlaps} className={TOOL_BTN} aria-describedby={overlappingIds.size > 0 ? undefined : "fix-overlaps-none"}>
            <span className="bp-icon text-[16px]" aria-hidden="true">layers</span>
            Fix overlaps
            {overlappingIds.size > 0 && <span className="t-num-sm">· {overlapReport.pairs.length}</span>}
          </button>
          {overlappingIds.size === 0 && <span id="fix-overlaps-none" className="sr-only">No overlaps on this plan</span>}
          {lowConfidenceIds.size > 0 && (
            <span className={`ml-1 ${TAG}`}>
              {lowConfidenceIds.size} to review
            </span>
          )}
          {/* G1: the type picker. Every downstream classifier — render, takeoff
              bucket, overlay seeding — keys off this one field, and until now a
              drawn room could not set it at all. */}
          {selectedRoom && (
            <span className="ml-2 flex items-center gap-1.5">
              <label htmlFor="room-type-picker" className="sr-only">
                Room or zone type
              </label>
              <select
                id="room-type-picker"
                value={selectedRoom.room_type ?? "other"}
                onChange={(e) => setRoomType(selectedRoom.id, e.target.value)}
                className={FIELD}
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
                className={`${CHIP_BTN} ${chipState(selectedRoom.unroofed)}`}
              >
                <Icon name={selectedRoom.unroofed ? "wb_sunny" : "roofing"} className="text-[16px]" />
                {selectedRoom.unroofed ? "Unroofed" : "Roofed"}
              </button>
              {/* Rule 11: the Arabic label, editable beside the English one. */}
              <label htmlFor="room-name-ar" className="sr-only">
                Arabic name
              </label>
              <input
                key={`ar-${selectedRoom.id}-${selectedRoom.name_ar ?? ""}`}
                id="room-name-ar"
                dir="rtl"
                lang="ar"
                defaultValue={selectedRoom.name_ar ?? ""}
                placeholder="الاسم بالعربية"
                onBlur={(e) => setArabicName(selectedRoom.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                aria-describedby={arStale.has(selectedRoom.id) || labelLanguageMismatch(selectedRoom.name_en, selectedRoom.name_ar) ? "room-name-ar-stale" : undefined}
                className={`${FIELD} w-36`}
                data-room-name-ar=""
              />
              {arStale.has(selectedRoom.id) || labelLanguageMismatch(selectedRoom.name_en, selectedRoom.name_ar) ? (
                <span id="room-name-ar-stale" className="t-label-md text-bp-ink-primary" data-ar-stale="">
                  Update the Arabic name too
                </span>
              ) : null}
            </span>
          )}
          {selectedId && (
            <span className="ml-2 flex items-center gap-1.5 t-label-md text-bp-ink-tertiary" role="group" aria-label="Flag this room">
              Flag
              <button
                type="button"
                onClick={() => flagIssue(selectedId, "split")}
                className={SMALL_BTN}
              >
                split
              </button>
              <button
                type="button"
                onClick={() => flagIssue(selectedId, "merge")}
                className={SMALL_BTN}
              >
                merge
              </button>
              <button
                type="button"
                onClick={() => flagIssue(selectedId, "other")}
                className={SMALL_BTN}
              >
                other
              </button>
            </span>
          )}
        </div>
        <div className="flex items-center gap-3" aria-live="polite">
          {infoMessage && <span className="t-label-md text-bp-ink-secondary">{infoMessage}</span>}
          {saveStatus === "saved" && <span className="t-label-md text-bp-ink-secondary">Saved.</span>}
          {saveStatus === "error" && saveError && (
            <span role="alert" className="t-label-md max-w-[260px] truncate text-bp-ink-primary">
              {saveError}
            </span>
          )}
        </div>
        {/* K5 (24:814): undo and Save changes live in the top bar; Save is disabled, with its reason, until something changed. */}
        <TopBarActions>
          <button type="button" onClick={undo} disabled={!canUndo} className={TOOL_BTN} aria-label={canUndo ? `Undo (${history.length})` : "Undo — nothing to undo"}>
            <span className="bp-icon text-[16px]" aria-hidden="true">undo</span>
            <span className="bp-boq-wide-only">Undo</span>
          </button>
          <button
            type="button"
            onClick={dirty && saveStatus !== "saving" ? save : undefined}
            aria-disabled={!dirty || saveStatus === "saving"}
            aria-describedby={!dirty ? "save-why" : undefined}
            className={`inline-flex h-9 items-center px-4 t-label-md rounded-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring ${dirty ? "bg-bp-ink-primary text-bp-ink-on-inverse hover:bg-bp-ink-secondary" : "bg-bp-surface-sunken text-bp-ink-tertiary cursor-not-allowed"}`}
            data-testid="plan-save"
          >
            {saveStatus === "saving" ? "Saving…" : "Save changes"}
          </button>
          {!dirty && <span id="save-why" className="sr-only">Nothing to save — no change since the last save</span>}
        </TopBarActions>
      </div>
      )}

      {/* 15 Oct: Fix overlaps previews — the total before and after, the rooms
          it trims, what it cannot resolve — and changes nothing until Apply. */}
      {editing && trimPreview && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-bp-line-strong py-3" role="group" aria-label="Fix overlaps preview" data-trim-preview={trimPreview.byId.size}>
          <p className="t-body-sm min-w-0 flex-1 text-bp-ink-primary">
            <span className="t-label-caps mr-2">Fix overlaps</span>
            {trimPreview.byId.size > 0 ? (
              <>
                trims {trimPreview.byId.size} {trimPreview.byId.size === 1 ? "room" : "rooms"} ({[...trimPreview.byId.values()].map((r) => r.name_en).join(", ")}) · total{" "}
                <span className="t-num-sm" data-trim-before>{trimPreview.before.toFixed(1)}</span> →{" "}
                <span className="t-num-sm" data-trim-after>{trimPreview.after.toFixed(1)}</span> m² — the floor counted twice comes off once; no room moves.
              </>
            ) : (
              <>trims nothing.</>
            )}
            {unresolvedText(trimPreview.unresolved)}
          </p>
          <span className="flex items-center gap-2">
            <button type="button" onClick={() => setTrimPreview(null)} className={TOOL_BTN} data-testid="trim-cancel">
              Cancel
            </button>
            <button
              type="button"
              onClick={trimPreview.byId.size > 0 ? applyTrim : () => setTrimPreview(null)}
              className="inline-flex h-9 items-center bg-bp-ink-primary px-4 t-label-md text-bp-ink-on-inverse rounded-none hover:bg-bp-ink-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring"
              data-testid="trim-apply"
            >
              {trimPreview.byId.size > 0 ? "Apply" : "Close"}
            </button>
          </span>
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
        <div className="mb-3 border-y border-bp-line-hairline py-3" data-area-disputes={openDisputes.size}>
          <p className="mb-2 flex items-center gap-2 t-label-caps text-bp-ink-primary">
            <Icon name="flag" className="text-[16px] text-bp-ink-secondary" />
            {openDisputes.size === 1
              ? "1 room where the drawing and the outline disagree"
              : `${openDisputes.size} rooms where the drawing and the outline disagree`}
          </p>
          <ul>
            {[...openDisputes.values()].map((d) => {
              const room = visibleRooms.find((r) => r.id === d.room_id);
              if (!room) return null;
              return (
                <li
                  key={d.room_id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-bp-line-hairline py-2 t-body-sm text-bp-ink-secondary"
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(d.room_id)}
                    className="t-nav-item-active text-bp-ink-primary underline decoration-dotted underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring"
                  >
                    {room.name_en}
                  </button>
                  <span>
                    drawing says{" "}
                    <span className="t-num-sm text-bp-ink-primary">
                      {d.stated_area_m2.toFixed(2)}
                    </span>{" "}
                    m², outline measures{" "}
                    <span className="t-num-sm text-bp-ink-primary">
                      {d.geometric_area_m2.toFixed(2)}
                    </span>{" "}
                    m².
                  </span>
                  <span className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => resolveDispute(d.room_id, "label")}
                      className={SMALL_BTN}
                    >
                      Keep the drawing
                    </button>
                    <button
                      type="button"
                      onClick={() => resolveDispute(d.room_id, "outline")}
                      className={SMALL_BTN}
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

      <div className={CANVAS_FRAME}>
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
            .room-group:hover .room-poly { fill: ${HOVER_FILL}; fill-opacity: 0.6; }
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
                    fill={building ? SVG.contextBuilding : SVG.contextWall}
                    fillOpacity={building ? 0.5 : 0.6}
                    stroke={SVG.inkTertiary}
                    strokeWidth={1}
                  />
                  {building && (
                    <text x={(bb.xL + bb.xR) / 2} y={(bb.yT + bb.yB) / 2} textAnchor="middle" dominantBaseline="middle" fontSize="12" fill={INK_SECONDARY} style={{ fontFamily: SVG.mono, letterSpacing: "0.05em" }}>
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
              fill={SVG.inkTertiary}
              fontSize="16"
              style={{ fontFamily: SVG.sans }}
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
                    fill={overlapReport.has_overlaps ? INK : room.unroofed ? OPEN_ZONE_FILL : ROOM_FILL}
                    fillOpacity={!room.in_scope ? 0 : overlapReport.has_overlaps ? 0.05 : removed ? 0.12 : room.unroofed ? 0.45 : 0.5}
                    stroke={room.site_reference ? BRASS : !room.in_scope || room.unroofed ? INK_SECONDARY : INK}
                    strokeOpacity={!room.in_scope ? 0.8 : room.unroofed ? 0.7 : 1}
                    strokeDasharray={room.site_reference ? "3 3" : !room.in_scope ? "4 3" : room.unroofed ? "6 4" : undefined}
                    data-in-scope={room.in_scope ? "true" : "false"}
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
                      fill={INK_SECONDARY}
                      pointerEvents="none"
                      style={{ fontFamily: SVG.mono, letterSpacing: "0.06em", fontWeight: 500 }}
                    >
                      {room.disposition === "remove" ? "EXISTING · TO REMOVE" : room.disposition === "replace" ? "EXISTING · REPLACE" : room.disposition === "keep" ? "EXISTING · KEEP" : "EXISTING · UNDECIDED"}
                    </text>
                  )}

                  {/* K12: a room left out of the renovation (81:716) — dashed, unfilled, and said so. */}
                  {!room.in_scope && (
                    <text
                      x={bb.xL + 6}
                      y={bb.yT + (room.site_reference ? 28 : 14)}
                      fontSize="10"
                      fill={INK_SECONDARY}
                      pointerEvents="none"
                      style={{ fontFamily: SVG.mono, letterSpacing: "0.06em", fontWeight: 500 }}
                      data-not-in-scope={room.id}
                    >
                      NOT IN THIS RENOVATION
                    </text>
                  )}

                  {/* K5: a room picked from the plan check's overlap list —
                      selection is a brass line (R7: brass draws lines only). */}
                  {focusIds.includes(room.id) && (
                    <polygon
                      points={room.polygon
                        .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
                        .join(" ")}
                      fill="none"
                      stroke={BRASS}
                      strokeWidth={3}
                      pointerEvents="none"
                      data-focus-room={room.id}
                    />
                  )}

                  {/* Low-confidence / user-flagged room → a dotted "check me"
                      outline inset in ink (Blueprint: no status hue — the dot
                      pattern says it, and the toolbar counts them in words). */}
                  {flagged && !overlapping && (
                    <polygon
                      points={room.polygon
                        .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
                        .join(" ")}
                      fill="none"
                      stroke={INK}
                      strokeWidth={2}
                      strokeDasharray="1 4"
                      strokeLinecap="round"
                      data-flagged-room={room.id}
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
                        className="h-7 w-full rounded-none border border-bp-brass bg-bp-surface-base px-2 text-center t-nav-item text-bp-ink-primary outline-none"
                        aria-label="Rename room"
                      />
                    </foreignObject>
                  ) : (
                    <g className="room-label">
                      {(() => {
                        // Rule 12 (15 Oct): the label is measured against the room's box and
                        // reduced until it fits — long size line → area, smaller type, an
                        // abbreviated name, no Arabic, the area alone (lib/plan/label-fit.ts).
                        const fitted = fitRoomLabel({
                          name: room.name_en,
                          nameAr: room.name_ar,
                          longMeta: inlineLine,
                          area: areaLabel,
                          widthPx: rectWPx,
                          heightPx: rectHPx,
                        });
                        const total = fitted.lines.reduce((h, l) => h + l.fontPx * 1.35, 0);
                        let y = cy - total / 2;
                        const rename = editing
                          ? (e: ReactMouseEvent) => {
                              e.stopPropagation();
                              beginRename(room);
                            }
                          : undefined;
                        return (
                          <>
                            <title>{[room.name_en, room.name_ar].filter(Boolean).join(" · ")}</title>
                            {fitted.lines.map((l, i) => {
                              const lineY = y + (l.fontPx * 1.35) / 2;
                              y += l.fontPx * 1.35;
                              const en = l.kind === "en";
                              const named = en || (l.kind === "meta" && !fitted.lines.some((x) => x.kind === "en"));
                              return (
                                <text
                                  key={i}
                                  x={cx}
                                  y={lineY}
                                  textAnchor="middle"
                                  dominantBaseline="middle"
                                  fontSize={l.fontPx}
                                  fontWeight={500}
                                  fill={l.kind === "meta" ? INK_SECONDARY : INK}
                                  pointerEvents={named && editing ? undefined : "none"}
                                  data-room-label={l.kind}
                                  style={{
                                    cursor: named && editing ? "text" : undefined,
                                    fontFamily: l.kind === "meta" ? SVG.mono : l.kind === "ar" ? "var(--font-ibm-plex-arabic), var(--font-plex-sans), sans-serif" : SVG.sans,
                                    direction: l.kind === "ar" ? "rtl" : undefined,
                                  }}
                                  onPointerDown={named && editing ? (e) => onRoomPointerDown(e, room) : undefined}
                                  onDoubleClick={named ? rename : undefined}
                                >
                                  {l.text}
                                </text>
                              );
                            })}
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
                          fill={INK}
                          stroke={INK_ON}
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
                          fill={INK}
                          stroke={INK_ON}
                          strokeWidth={2}
                        />
                        <line
                          x1={bb.xR + 6}
                          y1={bb.yT - 14}
                          x2={bb.xR + 14}
                          y2={bb.yT - 6}
                          stroke={INK_ON}
                          strokeWidth={2}
                          strokeLinecap="round"
                        />
                        <line
                          x1={bb.xR + 14}
                          y1={bb.yT - 14}
                          x2={bb.xR + 6}
                          y2={bb.yT - 6}
                          stroke={INK_ON}
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
          {/* K5 (24:814): the floor each overlapping pair counts twice, over the
              rooms — ink 30% with a dashed ink outline — and the legend. */}
          {overlapShapes.length > 0 && (
            <g pointerEvents="none" data-overlap-fill={overlapShapes.length}>
              {overlapShapes.map((poly, i) => (
                <polygon
                  key={i}
                  points={poly.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}
                  fill={INK}
                  fillOpacity={0.3}
                  stroke={INK}
                  strokeWidth={1.25}
                  strokeDasharray="4 3"
                />
              ))}
            </g>
          )}
          {trimPreview && trimPreview.byId.size > 0 && (
            <g pointerEvents="none" data-trim-outlines={trimPreview.byId.size}>
              {[...trimPreview.byId.values()].map((r) => (
                <polygon
                  key={r.id}
                  points={r.polygon.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}
                  fill="none"
                  stroke={INK}
                  strokeWidth={3}
                />
              ))}
            </g>
          )}
          {overlapShapes.length > 0 && (
            <g pointerEvents="none" data-overlap-legend aria-hidden="true">
              <rect x={8} y={8} width={410} height={36} fill={INK_ON} stroke={INK} strokeOpacity={0.25} />
              <rect x={20} y={18} width={16} height={16} fill={INK} fillOpacity={0.05} stroke={INK} strokeWidth={1} />
              <text x={44} y={31} fontSize={15} fill={INK} style={{ fontFamily: SVG.mono }}>
                room as parsed
              </text>
              <rect x={206} y={18} width={16} height={16} fill={INK} fillOpacity={0.3} stroke={INK} strokeWidth={1} strokeDasharray="3 2" />
              <text x={230} y={31} fontSize={15} fill={INK} style={{ fontFamily: SVG.mono }}>
                floor counted twice
              </text>
            </g>
          )}
        </svg>
      </div>

      <p className={CAPTION}>
        {editing ? (
          <>
            Click a room to select. Drag the body to move, drag a vertex to
            reshape, double-click the name to rename. Set its type with the
            picker above.{" "}
            {openZoneCount > 0
              ? `${openZoneCount} zone${openZoneCount === 1 ? " is" : "s are"} open to the sky (dashed) — those edges carry no wall. `
              : ""}
            A dotted outline = low confidence; use Flag if a room should be
            split or merged. Live total:{" "}
          </>
        ) : (
          <>Click a room to see what it is and what it costs. Total:{" "}</>
        )}
        <span className="t-num-sm text-bp-ink-primary">
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
    <label className="flex items-center gap-1.5">
      <span className="t-label-md text-bp-ink-tertiary">{label}</span>
      <input
        type="number"
        step={0.05}
        value={v[k]}
        onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })}
        onKeyDown={(e) => {
          if (e.key === "Enter") apply();
        }}
        className={NUM_FIELD}
      />
    </label>
  );
  return (
    <div className={INSPECTOR_BAR}>
      <span className="t-nav-item-active text-bp-ink-primary">{room.name_en}</span>
      {isRect ? (
        <>
          {field("x", "X")}
          {field("y", "Y")}
          {field("w", "W")}
          {field("d", "D")}
          <span className="t-label-md text-bp-ink-tertiary">m</span>
          <button type="button" onClick={apply} className={SMALL_BTN}>
            Apply
          </button>
        </>
      ) : (
        <span className="t-num-sm text-bp-ink-primary">{m.length} vertices · {init.w} × {init.d} m extents</span>
      )}
      <button type="button" onClick={onAddVertex} className={SMALL_BTN}>
        + Vertex
      </button>
      <span className="t-body-sm text-bp-ink-secondary">Shift-click a vertex to remove it. X/Y from the plot&apos;s top-left corner.</span>
      {room.dims_derived && <span className={TAG}>Derived outline</span>}
    </div>
  );
}
