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
import { cn } from "@/lib/utils";

const VIEW_W = 1000;
const VIEW_H = 600;
const PADDING = 24;
const HISTORY_LIMIT = 20;
const SAND_FILL = "#F5EFE6";
const TERRACOTTA = "#B85042";

type Point = [number, number];

type RoomInput = {
  id: string;
  name_en: string | null;
  name_ar: string | null;
  room_type: string | null;
  area_m2: number | null;
  polygon: unknown;
};

type Room = {
  id: string;
  name_en: string;
  name_ar: string | null;
  room_type: string | null;
  area_m2: number;
  // Editor always uses an axis-aligned 4-point rectangle in viewBox space.
  // Order: [TL, TR, BR, BL].
  polygon: [Point, Point, Point, Point];
  isNew?: boolean;
  isDeleted?: boolean;
};

type DragKind = "move" | "resize";
type DragState = {
  kind: DragKind;
  roomId: string;
  cornerIndex?: 0 | 1 | 2 | 3;
  start: Point;
  startBbox: { xL: number; yT: number; xR: number; yB: number };
  pointerId: number;
};

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

function rectArea(rect: [Point, Point, Point, Point]): number {
  const w = Math.abs(rect[1][0] - rect[0][0]);
  const h = Math.abs(rect[2][1] - rect[1][1]);
  return w * h;
}

// [x, y, w, h] from a 4-point axis-aligned polygon. x/y is the top-left
// corner; w/h are the bbox extents. Reused by the dimensions display, the
// overlap-detection effect, and the separation algorithm.
function polygonToRect(
  polygon: [Point, Point, Point, Point],
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
    polygon: room.polygon.map(
      ([x, y]) => [x + dx, y + dy] as Point,
    ) as [Point, Point, Point, Point],
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
    const pts = (r.polygon as number[][]).map<Point>(([x, y]) => [
      (x - minX) * scale + offsetX,
      (y - minY) * scale + offsetY,
    ]);
    const bb = bboxOf(pts);
    return {
      id: r.id,
      name_en: r.name_en?.trim() || "Room",
      name_ar: r.name_ar ?? null,
      room_type: r.room_type ?? null,
      area_m2: typeof r.area_m2 === "number" ? r.area_m2 : 0,
      polygon: rectFromBbox(bb.xL, bb.yT, bb.xR, bb.yB),
    };
  });

  const initialTotalViewBoxArea = fitted.reduce(
    (s, r) => s + rectArea(r.polygon),
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
};

export function EditablePlanViewer({
  planId,
  initialRooms,
}: Props) {
  const router = useRouter();
  const fitted = useMemo(() => fitToViewBox(initialRooms), [initialRooms]);
  const factorRef = useRef(fitted.unitToM2Factor);
  // Keep factor stable across edits — recomputing it on every state change
  // would let resize ops drift the m²-per-unit ratio.
  useEffect(() => {
    factorRef.current = fitted.unitToM2Factor;
  }, [fitted.unitToM2Factor]);

  const [rooms, setRooms] = useState<Room[]>(fitted.rooms);
  const [history, setHistory] = useState<Room[][]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [overlappingIds, setOverlappingIds] = useState<Set<string>>(
    () => new Set(),
  );
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
    (rect: [Point, Point, Point, Point]): number => {
      const a = rectArea(rect) * factorRef.current;
      return Math.round(a * 10) / 10;
    },
    [],
  );

  // Begin a body-drag (move) — also handles selection on click.
  const onRoomPointerDown = (
    e: ReactPointerEvent<SVGElement>,
    room: Room,
  ) => {
    if (renamingId) return;
    e.stopPropagation();
    setSelectedId(room.id);
    const [px, py] = toViewBox(e.clientX, e.clientY);
    const bb = bboxOf(room.polygon);
    dragRef.current = {
      kind: "move",
      roomId: room.id,
      start: [px, py],
      startBbox: bb,
      pointerId: e.pointerId,
    };
    dirtyDragRef.current = false;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  // Begin a corner-drag (resize).
  const onHandlePointerDown = (
    e: ReactPointerEvent<SVGCircleElement>,
    room: Room,
    cornerIndex: 0 | 1 | 2 | 3,
  ) => {
    e.stopPropagation();
    setSelectedId(room.id);
    const [px, py] = toViewBox(e.clientX, e.clientY);
    const bb = bboxOf(room.polygon);
    dragRef.current = {
      kind: "resize",
      roomId: room.id,
      cornerIndex,
      start: [px, py],
      startBbox: bb,
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
        let nextBbox: { xL: number; yT: number; xR: number; yB: number };
        if (drag.kind === "move") {
          nextBbox = {
            xL: drag.startBbox.xL + dx,
            yT: drag.startBbox.yT + dy,
            xR: drag.startBbox.xR + dx,
            yB: drag.startBbox.yB + dy,
          };
        } else {
          // Resize: move the corner the user grabbed; opposite corner stays put.
          const minSize = 30;
          let { xL, yT, xR, yB } = drag.startBbox;
          if (drag.cornerIndex === 0) {
            // TL
            xL = Math.min(drag.startBbox.xL + dx, xR - minSize);
            yT = Math.min(drag.startBbox.yT + dy, yB - minSize);
          } else if (drag.cornerIndex === 1) {
            // TR
            xR = Math.max(drag.startBbox.xR + dx, xL + minSize);
            yT = Math.min(drag.startBbox.yT + dy, yB - minSize);
          } else if (drag.cornerIndex === 2) {
            // BR
            xR = Math.max(drag.startBbox.xR + dx, xL + minSize);
            yB = Math.max(drag.startBbox.yB + dy, yT + minSize);
          } else {
            // BL
            xL = Math.min(drag.startBbox.xL + dx, xR - minSize);
            yB = Math.max(drag.startBbox.yB + dy, yT + minSize);
          }
          nextBbox = { xL, yT, xR, yB };
        }

        // Clamp the bbox inside the viewBox.
        const w = nextBbox.xR - nextBbox.xL;
        const h = nextBbox.yB - nextBbox.yT;
        if (nextBbox.xL < 0) {
          nextBbox.xL = 0;
          if (drag.kind === "move") nextBbox.xR = w;
        }
        if (nextBbox.yT < 0) {
          nextBbox.yT = 0;
          if (drag.kind === "move") nextBbox.yB = h;
        }
        if (nextBbox.xR > VIEW_W) {
          nextBbox.xR = VIEW_W;
          if (drag.kind === "move") nextBbox.xL = VIEW_W - w;
        }
        if (nextBbox.yB > VIEW_H) {
          nextBbox.yB = VIEW_H;
          if (drag.kind === "move") nextBbox.yT = VIEW_H - h;
        }

        const nextPoly = rectFromBbox(
          nextBbox.xL,
          nextBbox.yT,
          nextBbox.xR,
          nextBbox.yB,
        );
        return {
          ...r,
          polygon: nextPoly,
          area_m2: recomputeArea(nextPoly),
        };
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
      isNew: true,
    };
    setRooms((current) => [...current, next]);
    setSelectedId(id);
  };

  const deleteRoom = (roomId: string) => {
    snapshot();
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
  useEffect(() => {
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
    setOverlappingIds(ids);
  }, [rooms]);

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
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addRoom}
            className="border-bg-border bg-bg-elevated text-text-primary hover:bg-bg-overlay"
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
            className="text-text-secondary hover:text-text-primary"
          >
            <Undo2 />
            Undo
            {canUndo && (
              <span className="ml-1 text-xs text-text-tertiary">
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
              "border-bg-border bg-bg-elevated text-text-primary hover:bg-bg-overlay",
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
        </div>
        <div className="flex items-center gap-3">
          {infoMessage && (
            <span className="text-xs text-text-secondary">{infoMessage}</span>
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

      <div className="overflow-hidden rounded-xl border border-bg-border bg-bg-elevated/60 backdrop-blur-sm">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="block h-auto w-full select-none touch-none"
          role="img"
          aria-label="Editable floorplan"
          onPointerDown={onSvgPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {visibleRooms.length === 0 ? (
            <text
              x={VIEW_W / 2}
              y={VIEW_H / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="var(--color-text-tertiary)"
              fontSize="16"
            >
              No rooms yet — click &quot;Add room&quot; to start.
            </text>
          ) : (
            visibleRooms.map((room, index) => {
              const selected = selectedId === room.id;
              const renaming = renamingId === room.id;
              const overlapping = overlappingIds.has(room.id);
              const bb = bboxOf(room.polygon);
              const cx = (bb.xL + bb.xR) / 2;
              const cy = (bb.yT + bb.yB) / 2;
              const rectWPx = bb.xR - bb.xL;
              const rectHPx = bb.yB - bb.yT;
              const widthM = pixelToM(rectWPx, factorRef.current);
              const heightM = pixelToM(rectHPx, factorRef.current);
              const areaInt = Math.round(room.area_m2);
              const dimsLine = `${widthM} × ${heightM} m`;
              const areaLabel = `${areaInt} m²`;
              const inlineLine = `${dimsLine} · ${areaLabel}`;
              return (
                <motion.g
                  key={room.id}
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
                    points={room.polygon
                      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
                      .join(" ")}
                    fill={SAND_FILL}
                    fillOpacity={0.88}
                    stroke={selected ? TERRACOTTA : TERRACOTTA}
                    strokeOpacity={selected ? 1 : 0.7}
                    strokeWidth={selected ? 2.5 : 1.5}
                    style={{ cursor: "grab" }}
                    onPointerDown={(e) => onRoomPointerDown(e, room)}
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
                        className="h-7 w-full rounded-md border border-[#B85042] bg-white px-2 text-center text-sm font-medium text-[#1F1830] outline-none ring-2 ring-[#B85042]/20"
                        aria-label="Rename room"
                      />
                    </foreignObject>
                  ) : (
                    <text
                      x={cx}
                      y={cy - 4}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize="14"
                      fontWeight={500}
                      fill="#1F1830"
                      style={{ cursor: "text" }}
                      onPointerDown={(e) => onRoomPointerDown(e, room)}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        beginRename(room);
                      }}
                    >
                      {room.name_en}
                    </text>
                  )}

                  {!renaming && (
                    <g pointerEvents="none">
                      {rectWPx >= 120 ? (
                        <text
                          x={cx}
                          y={cy + 14}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fontSize="11"
                          fontWeight={400}
                          fill={TERRACOTTA}
                        >
                          {inlineLine}
                        </text>
                      ) : rectWPx >= 70 ? (
                        <>
                          <text
                            x={cx}
                            y={cy + 12}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fontSize="10"
                            fontWeight={400}
                            fill={TERRACOTTA}
                          >
                            {dimsLine}
                          </text>
                          <text
                            x={cx}
                            y={cy + 24}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fontSize="10"
                            fontWeight={400}
                            fill={TERRACOTTA}
                          >
                            {areaLabel}
                          </text>
                        </>
                      ) : (
                        <text
                          x={cx}
                          y={cy + 14}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fontSize="11"
                          fontWeight={400}
                          fill={TERRACOTTA}
                        >
                          {areaLabel}
                        </text>
                      )}
                    </g>
                  )}

                  {selected && !renaming && (
                    <>
                      {/* Resize handles at the four corners. */}
                      {([0, 1, 2, 3] as const).map((cornerIndex) => {
                        const [hx, hy] = room.polygon[cornerIndex];
                        const cursorMap = [
                          "nwse-resize",
                          "nesw-resize",
                          "nwse-resize",
                          "nesw-resize",
                        ];
                        return (
                          <circle
                            key={cornerIndex}
                            cx={hx}
                            cy={hy}
                            r={7}
                            fill="#A855F7"
                            stroke="#0B0712"
                            strokeWidth={2}
                            style={{ cursor: cursorMap[cornerIndex] }}
                            onPointerDown={(e) =>
                              onHandlePointerDown(e, room, cornerIndex)
                            }
                          />
                        );
                      })}

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

      <p className="text-xs text-text-tertiary">
        Click a room to select. Drag the body to move, drag a corner handle to
        resize, double-click the name to rename. Live total:{" "}
        <span className="text-text-secondary">
          {liveTotalM2.toFixed(1)} m²
        </span>
        .
      </p>
    </div>
  );
}

