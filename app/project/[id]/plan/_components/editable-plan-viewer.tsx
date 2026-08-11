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
import { polygonArea } from "@/lib/plan/polygon";
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
};

type Room = {
  id: string;
  name_en: string;
  name_ar: string | null;
  room_type: string | null;
  area_m2: number;
  // N-vertex polygon in viewBox space (may be non-rectilinear / diagonal).
  polygon: Point[];
  confidence: number | null;
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

function applyOffset(room: Room, dx: number, dy: number): Room {
  return {
    ...room,
    polygon: room.polygon.map(([x, y]) => [x + dx, y + dy] as Point),
  };
}

// Keep a room inside [0, vw] x [0, vh]. If it's larger than the viewBox
// it is shrunk; if it spills past an edge it is shifted (preserving size).
// Caller is responsible for recomputing area_m2 if width/height changed.
function clampToViewBox(room: Room, vw: number, vh: number): Room {
  const [x, y, w, h] = polygonToRect(room.polygon);
  const nw = Math.min(w, vw);
  const nh = Math.min(h, vh);
  let nx = x;
  let ny = y;
  if (nx < 0) nx = 0;
  if (ny < 0) ny = 0;
  if (nx + nw > vw) nx = vw - nw;
  if (ny + nh > vh) ny = vh - nh;
  if (nx === x && ny === y && nw === w && nh === h) return room;
  return {
    ...room,
    polygon: rectFromBbox(nx, ny, nx + nw, ny + nh),
  };
}

// Iteratively push apart any axis-aligned rectangles that overlap.
// Pushes along the axis of LEAST overlap (less disruptive). Bounded by
// MAX_ITERATIONS so it always terminates even on pathological inputs.
function separateOverlappingRooms(
  rooms: Room[],
  vw: number,
  vh: number,
): Room[] {
  const MAX_ITERATIONS = 80;
  const PADDING_GAP = 4;
  let next = rooms.map((r) => ({ ...r }));

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let movedAny = false;

    for (let i = 0; i < next.length - 1; i++) {
      for (let j = i + 1; j < next.length; j++) {
        const [ax, ay, aw, ah] = polygonToRect(next[i].polygon);
        const [bx, by, bw, bh] = polygonToRect(next[j].polygon);

        const overlapX = Math.min(ax + aw, bx + bw) - Math.max(ax, bx);
        const overlapY = Math.min(ay + ah, by + bh) - Math.max(ay, by);

        if (overlapX > 0 && overlapY > 0) {
          movedAny = true;
          if (overlapX < overlapY) {
            const push = (overlapX + PADDING_GAP) / 2;
            const aCenterX = ax + aw / 2;
            const bCenterX = bx + bw / 2;
            if (aCenterX < bCenterX) {
              next[i] = applyOffset(next[i], -push, 0);
              next[j] = applyOffset(next[j], push, 0);
            } else {
              next[i] = applyOffset(next[i], push, 0);
              next[j] = applyOffset(next[j], -push, 0);
            }
          } else {
            const push = (overlapY + PADDING_GAP) / 2;
            const aCenterY = ay + ah / 2;
            const bCenterY = by + bh / 2;
            if (aCenterY < bCenterY) {
              next[i] = applyOffset(next[i], 0, -push);
              next[j] = applyOffset(next[j], 0, push);
            } else {
              next[i] = applyOffset(next[i], 0, push);
              next[j] = applyOffset(next[j], 0, -push);
            }
          }
        }
      }
    }

    next = next.map((r) => clampToViewBox(r, vw, vh));
    if (!movedAny) break;
  }

  return next;
}

// True iff two axis-aligned rectangles share interior area.
function rectsOverlap(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  return (
    Math.min(ax + aw, bx + bw) - Math.max(ax, bx) > 0 &&
    Math.min(ay + ah, by + bh) - Math.max(ay, by) > 0
  );
}

// Convert any coordinate space (Claude's [0,1] or pixel) to viewBox space,
// fitting all rooms aspect-preserving with PADDING.
function fitToViewBox(rooms: RoomInput[]): {
  rooms: Room[];
  unitToM2Factor: number;
  initialTotalViewBoxArea: number;
} {
  const valid = rooms.filter((r) => isPointArray(r.polygon));
  if (valid.length === 0) {
    return { rooms: [], unitToM2Factor: 1, initialTotalViewBoxArea: 0 };
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
    return {
      id: r.id,
      name_en: r.name_en?.trim() || "Room",
      name_ar: r.name_ar ?? null,
      room_type: r.room_type ?? null,
      area_m2: typeof r.area_m2 === "number" ? r.area_m2 : 0,
      polygon: pts,
      confidence: typeof r.confidence === "number" ? r.confidence : null,
    };
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

  return { rooms: fitted, unitToM2Factor, initialTotalViewBoxArea };
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
};

export function EditablePlanViewer({
  planId,
  initialRooms,
  mode,
  onInspectRoom,
}: Props) {
  const router = useRouter();
  const editing = editingEnabled(mode);
  const fitted = useMemo(() => fitToViewBox(initialRooms), [initialRooms]);
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
  const overlappingIds = useMemo(() => {
    const visible = rooms.filter((r) => !r.isDeleted);
    const ids = new Set<string>();
    for (let i = 0; i < visible.length - 1; i++) {
      for (let j = i + 1; j < visible.length; j++) {
        if (
          rectsOverlap(
            polygonToRect(visible[i].polygon),
            polygonToRect(visible[j].polygon),
          )
        ) {
          ids.add(visible[i].id);
          ids.add(visible[j].id);
        }
      }
    }
    return ids;
  }, [rooms]);
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

  const liveTotalM2 = visibleRooms.reduce((s, r) => s + r.area_m2, 0);

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

  // Begin a single-vertex drag.
  const onVertexPointerDown = (
    e: ReactPointerEvent<SVGCircleElement>,
    room: Room,
    vertexIndex: number,
  ) => {
    e.stopPropagation();
    setSelectedId(room.id);
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
          nextPoly = drag.startPolygon.map(([x, y]) => [x + ddx, y + ddy] as Point);
        } else {
          // Move only the grabbed vertex (clamped into the viewBox).
          const vi = drag.vertexIndex ?? 0;
          nextPoly = drag.startPolygon.map((p, i) =>
            i === vi
              ? ([clampToView(p[0] + dx, VIEW_W), clampToView(p[1] + dy, VIEW_H)] as Point)
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
    const next: Room = {
      id,
      name_en: "New room",
      name_ar: null,
      room_type: "other",
      area_m2: recomputeArea(polygon),
      polygon,
      confidence: null,
      isNew: true,
    };
    setRooms((current) => [...current, next]);
    setSelectedId(id);
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
        polygon: r.polygon,
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
        | { success?: boolean; error?: string }
        | null;
      if (!res.ok || !body?.success) {
        throw new Error(body?.error ?? `Save failed (${res.status}).`);
      }
      setSaveStatus("saved");
      setHistory([]);
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
          {visibleRooms.length === 0 ? (
            <text
              x={VIEW_W / 2}
              y={VIEW_H / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="var(--color-ink-500)"
              fontSize="16"
            >
              No rooms yet — click &quot;Add room&quot; to start.
            </text>
          ) : (
            visibleRooms.map((room, index) => {
              const selected = selectedId === room.id;
              const renaming = renamingId === room.id;
              const overlapping = overlappingIds.has(room.id);
              const flagged = lowConfidenceIds.has(room.id) || flaggedIds.has(room.id);
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
              const dimsLine = `${widthM} × ${heightM} m`;
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
                  <polygon
                    className="room-poly"
                    points={room.polygon
                      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
                      .join(" ")}
                    fill={BONE_FILL}
                    fillOpacity={0.5}
                    stroke={INK_900}
                    strokeOpacity={1}
                    strokeWidth={editing && selected ? 2.5 : 1.5}
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
                        />
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
            reshape, double-click the name to rename. Amber = low confidence;
            use Flag if a room should be split or merged. Live total:{" "}
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

