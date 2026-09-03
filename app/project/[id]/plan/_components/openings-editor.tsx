"use client";

// =============================================================================
// openings-editor.tsx — A5 door/window capture on the 2D plan.
//
// Mirrors OverlayEditor's architecture (the sanctioned 2D editing surface):
// read-only room fill from the shared viewBox fit, immediate per-change
// persistence, no batched save. Openings differ from overlay fixtures in one
// way that drives the whole component: an opening belongs to a WALL, not to a
// free point. So the flow is select-wall → add → drag ALONG that wall, and a
// position is only ever a point on a wall segment.
//
// Walls come from `deriveWallSegments` — the same derivation buildPlanGraph
// prices from — so the wall the user picks is the wall the take-off deducts.
// Wall ids stay volatile by contract; `wall_ref` is persisted as a hint and the
// graph re-snaps by position at build time.
// =============================================================================

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  DEFAULT_OPENING_DIMS,
  deriveWallSegments,
  polygonArea,
  projectOntoSegment,
  type RawWallSegment,
} from "@/lib/plan/geometry";
import {
  fitRooms,
  VIEW_H,
  VIEW_W,
  type Pt,
  type RawRoomInput,
} from "@/lib/overlays/viewbox";
import { cn } from "@/lib/utils";

const BONE = "#EDE6D8";
const INK_900 = "#0F1B2D";
const INK_500 = "#64748b";
const BRASS = "#A4793A";
const AMBER = "#92400E";

export type OpeningKind = "door" | "window" | "archway";

export interface PlanOpening {
  id: string;
  plan_id: string;
  room_id: string | null;
  wall_ref: string | null;
  kind: OpeningKind;
  width_mm: number;
  height_mm: number;
  sill_mm: number;
  /** Raw plan space (same space as rooms.polygon). */
  position: Pt | null;
  along_offset: number | null;
  source: "parsed" | "user_drawn";
  derived: boolean;
}

const KINDS: { key: OpeningKind; label: string; glyph: string }[] = [
  { key: "door", label: "Door", glyph: "door_front" },
  { key: "window", label: "Window", glyph: "window" },
  { key: "archway", label: "Archway", glyph: "meeting_room" },
];

/** Minimum wall length (m) that can still take an opening of the given width. */
function fitsOnWall(wallLenM: number, widthM: number): boolean {
  return wallLenM >= widthM;
}

const HISTORY_LIMIT = 20;

/**
 * One reversible step. Because every edit persists immediately (the overlay
 * pattern — there is no batched save to roll back), undo is expressed as the
 * INVERSE operation replayed through the same API, not as a state snapshot.
 * `label` is what the button announces so undo is never a mystery.
 */
type UndoStep =
  | { kind: "delete"; label: string; id: string }
  | { kind: "recreate"; label: string; opening: PlanOpening }
  | {
      kind: "restore";
      label: string;
      id: string;
      patch: Record<string, unknown>;
    };

export function OpeningsEditor({
  planId,
  rooms,
  totalAreaM2,
  readOnly = false,
}: {
  planId: string;
  rooms: RawRoomInput[];
  /** Authoritative plan area — sets the raw-unit → metre scale. */
  totalAreaM2: number | null;
  /** read mode: render openings + schedule, hide the palette, no editing. */
  readOnly?: boolean;
}) {
  const fit = useMemo(() => fitRooms(rooms), [rooms]);
  const walls = useMemo(
    () => deriveWallSegments(rooms.map((r) => ({ id: r.id, polygon: r.polygon }))),
    [rooms],
  );

  // Raw-unit → metre factor, derived exactly as buildPlanGraph derives it: a
  // single isotropic factor from the authoritative total area. Without it we
  // cannot draw a 0.9 m door at the right size on the plan.
  const rawPerM = useMemo(() => {
    let normArea = 0;
    for (const r of rooms) {
      if (!Array.isArray(r.polygon)) continue;
      const pts = (r.polygon as unknown[]).filter(
        (p): p is [number, number] =>
          Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number",
      );
      if (pts.length >= 3) normArea += polygonArea(pts);
    }
    const total =
      totalAreaM2 && totalAreaM2 > 0
        ? totalAreaM2
        : rooms.reduce((s, r) => s + (r.area_m2 ?? 0), 0);
    const unitToM = normArea > 0 && total > 0 ? Math.sqrt(total / normArea) : 1;
    return unitToM > 0 ? 1 / unitToM : 1;
  }, [rooms, totalAreaM2]);

  // viewBox pixels per raw unit (uniform — fitRooms scales isotropically).
  const pxPerRaw = useMemo(() => {
    const o = fit.toViewBox([0, 0]);
    const x = fit.toViewBox([1, 0]);
    return Math.hypot(x[0] - o[0], x[1] - o[1]) || 1;
  }, [fit]);

  const [openings, setOpenings] = useState<PlanOpening[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [selectedOpeningId, setSelectedOpeningId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [undoStack, setUndoStack] = useState<UndoStep[]>([]);

  const pushUndo = useCallback((step: UndoStep) => {
    setUndoStack((s) => {
      const next = [...s, step];
      return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
    });
  }, []);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{
    id: string;
    wall: RawWallSegment;
    moved: boolean;
    pointerId: number;
    from: {
      position: Pt | null;
      along_offset: number | null;
      wall_ref: string | null;
      room_id: string | null;
    };
  } | null>(null);

  const wallById = useMemo(() => {
    const m = new Map<string, RawWallSegment>();
    for (const w of walls) m.set(w.id, w);
    return m;
  }, [walls]);

  // Load persisted openings. Degrades to an empty layer (the route returns
  // `[]` when the table is absent) rather than breaking the plan page.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/plan-openings?plan_id=${planId}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (body.error) setError(body.error);
        else setOpenings(normaliseAll(body.openings ?? []));
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [planId]);

  const clientToViewBox = useCallback((clientX: number, clientY: number): Pt => {
    const svg = svgRef.current;
    if (!svg) return [0, 0];
    const r = svg.getBoundingClientRect();
    return [
      ((clientX - r.left) / r.width) * VIEW_W,
      ((clientY - r.top) / r.height) * VIEW_H,
    ];
  }, []);

  /** Resolve an opening to the wall it sits on (by ref, else nearest). */
  const wallFor = useCallback(
    (o: PlanOpening): RawWallSegment | null => {
      if (o.wall_ref) {
        const w = wallById.get(o.wall_ref);
        if (w) return w;
      }
      if (!o.position) return null;
      let best: { w: RawWallSegment; d: number } | null = null;
      for (const w of walls) {
        const { dist } = projectOntoSegment(o.position, w.a, w.b);
        if (!best || dist < best.d) best = { w, d: dist };
      }
      return best?.w ?? null;
    },
    [walls, wallById],
  );

  const selectedOpening =
    openings.find((o) => o.id === selectedOpeningId) ?? null;

  // --- mutations -----------------------------------------------------------

  const addOpening = async (kind: OpeningKind) => {
    const wall = selectedWallId ? wallById.get(selectedWallId) : null;
    if (!wall || readOnly) return;
    const def = DEFAULT_OPENING_DIMS[kind];
    const wallLenM = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]) / rawPerM;
    if (!fitsOnWall(wallLenM, def.width_mm / 1000)) {
      setError(
        `A ${def.width_mm / 1000} m ${kind} does not fit on this ${wallLenM.toFixed(2)} m wall.`,
      );
      return;
    }
    // Centre of the selected wall; the user drags from there.
    const t = 0.5;
    const position: Pt = [
      wall.a[0] + (wall.b[0] - wall.a[0]) * t,
      wall.a[1] + (wall.b[1] - wall.a[1]) * t,
    ];
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/plan-openings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan_id: planId,
          room_id: wall.roomIds[0] ?? null,
          wall_ref: wall.id,
          kind,
          position,
          along_offset: t,
          // width/height deliberately omitted → server defaults + derived:true.
        }),
      });
      const body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error ?? "Failed to add opening.");
      const created = normalise(body.opening);
      if (created) {
        setOpenings((cur) => [...cur, created]);
        setSelectedOpeningId(created.id);
        pushUndo({ kind: "delete", label: `Add ${kind}`, id: created.id });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add opening.");
    } finally {
      setBusy(false);
    }
  };

  const patchOpening = useCallback(
    async (id: string, patch: Record<string, unknown>) => {
      try {
        const res = await fetch("/api/plan-openings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, ...patch }),
        });
        const body = await res.json();
        if (!res.ok || body.error) throw new Error(body.error ?? "Update failed.");
        const updated = normalise(body.opening);
        if (updated) setOpenings((cur) => cur.map((o) => (o.id === id ? updated : o)));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Update failed.");
      }
    },
    [],
  );

  const deleteOpening = async (id: string, record = true) => {
    if (readOnly) return;
    const prev = openings;
    const removed = prev.find((o) => o.id === id) ?? null;
    setOpenings((cur) => cur.filter((o) => o.id !== id));
    setSelectedOpeningId(null);
    try {
      const res = await fetch(`/api/plan-openings?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed.");
      if (record && removed) {
        pushUndo({ kind: "recreate", label: `Delete ${removed.kind}`, opening: removed });
      }
    } catch (e) {
      setOpenings(prev); // roll back — the row is still there
      setError(e instanceof Error ? e.message : "Delete failed.");
    }
  };

  /**
   * Replay the inverse of the last edit. Each step goes through the same routes
   * a user action would, so the server keeps deciding `derived` — undoing a
   * measurement uses reset_dims rather than writing derived:false by hand.
   * Recreating a deleted opening mints a NEW id (the row is gone); that is
   * harmless because element_refs are rebuilt on every take-off.
   */
  const undo = useCallback(async () => {
    const step = undoStack[undoStack.length - 1];
    if (!step || readOnly) return;
    setUndoStack((s) => s.slice(0, -1));
    setBusy(true);
    setError(null);
    try {
      if (step.kind === "delete") {
        const res = await fetch(`/api/plan-openings?id=${step.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Undo failed.");
        setOpenings((cur) => cur.filter((o) => o.id !== step.id));
        setSelectedOpeningId(null);
      } else if (step.kind === "recreate") {
        const o = step.opening;
        const res = await fetch("/api/plan-openings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plan_id: o.plan_id || planId,
            room_id: o.room_id,
            wall_ref: o.wall_ref,
            kind: o.kind,
            position: o.position,
            along_offset: o.along_offset,
            // Re-supply measured dimensions only; a derived opening comes back
            // derived because the server re-defaults it.
            ...(o.derived ? {} : { width_mm: o.width_mm, height_mm: o.height_mm }),
            sill_mm: o.sill_mm,
          }),
        });
        const body = await res.json();
        if (!res.ok || body.error) throw new Error(body.error ?? "Undo failed.");
        const created = normalise(body.opening);
        if (created) {
          setOpenings((cur) => [...cur, created]);
          setSelectedOpeningId(created.id);
        }
      } else {
        await patchOpening(step.id, step.patch);
        setSelectedOpeningId(step.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Undo failed.");
    } finally {
      setBusy(false);
    }
  }, [undoStack, readOnly, planId, patchOpening]);

  // --- drag along the wall -------------------------------------------------

  const onOpeningPointerDown = (
    e: ReactPointerEvent<SVGGElement>,
    o: PlanOpening,
  ) => {
    e.stopPropagation();
    setSelectedOpeningId(o.id);
    const wall = wallFor(o);
    if (wall) setSelectedWallId(wall.id);
    if (readOnly || !wall) return;
    dragRef.current = {
      id: o.id,
      wall,
      moved: false,
      pointerId: e.pointerId,
      // Pre-drag placement, so undo can put it back exactly.
      from: {
        position: o.position,
        along_offset: o.along_offset,
        wall_ref: o.wall_ref,
        room_id: o.room_id,
      },
    };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    d.moved = true;
    const raw = fit.toRaw(clientToViewBox(e.clientX, e.clientY));
    // Constrain to the wall: project, then clamp so the leaf stays on-wall.
    const { t } = projectOntoSegment(raw, d.wall.a, d.wall.b);
    const o = openings.find((x) => x.id === d.id);
    const wallLen = Math.hypot(d.wall.b[0] - d.wall.a[0], d.wall.b[1] - d.wall.a[1]);
    const halfT = o && wallLen > 0 ? (o.width_mm / 1000) * rawPerM / 2 / wallLen : 0;
    const ct = Math.max(halfT, Math.min(1 - halfT, t));
    const position: Pt = [
      d.wall.a[0] + (d.wall.b[0] - d.wall.a[0]) * ct,
      d.wall.a[1] + (d.wall.b[1] - d.wall.a[1]) * ct,
    ];
    setOpenings((cur) =>
      cur.map((x) => (x.id === d.id ? { ...x, position, along_offset: ct } : x)),
    );
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || !d.moved) return;
    const o = openings.find((x) => x.id === d.id);
    if (!o || !o.position) return;
    // Persist position only — a drag must never clear the derived flag.
    void patchOpening(o.id, {
      position: o.position,
      along_offset: o.along_offset,
      wall_ref: d.wall.id,
      room_id: d.wall.roomIds[0] ?? null,
    });
    if (d.from.position) {
      pushUndo({
        kind: "restore",
        label: `Move ${o.kind}`,
        id: o.id,
        patch: {
          position: d.from.position,
          along_offset: d.from.along_offset,
          wall_ref: d.from.wall_ref,
          room_id: d.from.room_id,
        },
      });
    }
    void e;
  };

  // --- render --------------------------------------------------------------

  const selectedWall = selectedWallId ? wallById.get(selectedWallId) : null;
  const derivedCount = openings.filter((o) => o.derived).length;

  return (
    <div className="space-y-3">
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-500">
            {selectedWall ? "Add to selected wall:" : "Select a wall to add an opening"}
          </span>
          {KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              disabled={!selectedWall || busy}
              onClick={() => void addOpening(k.key)}
              className={cn(
                "flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs transition-colors",
                selectedWall && !busy
                  ? "border-ink-100 bg-paper text-ink-900 hover:bg-surface-container"
                  : "cursor-not-allowed border-ink-100 bg-paper text-ink-500 opacity-50",
              )}
            >
              <span className="material-symbols-outlined text-sm">{k.glyph}</span>
              {k.label}
            </button>
          ))}
          <button
            type="button"
            disabled={undoStack.length === 0 || busy}
            onClick={() => void undo()}
            title={
              undoStack.length > 0
                ? `Undo: ${undoStack[undoStack.length - 1]!.label}`
                : "Nothing to undo"
            }
            className={cn(
              "flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs transition-colors",
              undoStack.length > 0 && !busy
                ? "text-ink-700 hover:bg-surface-container hover:text-ink-900"
                : "cursor-not-allowed text-ink-500 opacity-50",
            )}
          >
            <span className="material-symbols-outlined text-sm">undo</span>
            Undo
            {undoStack.length > 0 && (
              <span className="text-ink-500">({undoStack.length})</span>
            )}
          </button>
          <span className="ml-auto flex items-center gap-2 text-xs text-ink-500">
            <span>
              {openings.length} opening{openings.length === 1 ? "" : "s"}
            </span>
            {derivedCount > 0 && (
              <span
                className="rounded-full bg-[#FEF3C7] px-2 py-0.5 font-medium text-[#92400E]"
                title="Dimensions were defaulted, not measured — these never read as measured quantities."
              >
                {derivedCount} derived
              </span>
            )}
          </span>
        </div>
      )}

      {error && (
        <p className="rounded border border-status-error/40 bg-status-error/5 px-2 py-1 text-xs text-status-error">
          {error}
        </p>
      )}

      <div className="relative overflow-hidden rounded-md border border-ink-100 bg-paper">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="w-full touch-none select-none"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedWallId(null);
              setSelectedOpeningId(null);
            }
          }}
        >
          {/* Rooms — read-only context. Editing geometry stays on the Plan layer. */}
          {fit.rooms.map((r) => (
            <g key={r.id}>
              <polygon
                points={r.pts.map((p) => p.join(",")).join(" ")}
                fill={BONE}
                fillOpacity={0.5}
                stroke="none"
              />
              <text
                x={r.pts.reduce((s, p) => s + p[0], 0) / r.pts.length}
                y={r.pts.reduce((s, p) => s + p[1], 0) / r.pts.length}
                textAnchor="middle"
                fontSize={13}
                fill={INK_500}
                style={{ fontFamily: "Inter, sans-serif", fontWeight: 500 }}
                pointerEvents="none"
              >
                {r.name_en}
              </text>
            </g>
          ))}

          {/* Walls — the selectable elements. Wide transparent hit-target over a
              thin visible stroke, so a 1.5 px line is still tappable. */}
          {walls.map((w) => {
            const a = fit.toViewBox(w.a);
            const b = fit.toViewBox(w.b);
            const isSel = w.id === selectedWallId;
            return (
              <g key={w.id}>
                <line
                  x1={a[0]}
                  y1={a[1]}
                  x2={b[0]}
                  y2={b[1]}
                  stroke={isSel ? BRASS : INK_900}
                  strokeWidth={isSel ? 4 : 1.5}
                  strokeLinecap="round"
                />
                {!readOnly && (
                  <line
                    x1={a[0]}
                    y1={a[1]}
                    x2={b[0]}
                    y2={b[1]}
                    stroke="transparent"
                    strokeWidth={14}
                    strokeLinecap="round"
                    className="cursor-pointer"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setSelectedWallId(w.id);
                      setSelectedOpeningId(null);
                    }}
                  />
                )}
              </g>
            );
          })}

          {/* Openings — standard architectural notation. */}
          {openings.map((o) => {
            const wall = wallFor(o);
            if (!wall || !o.position) return null;
            return (
              <OpeningGlyph
                key={o.id}
                opening={o}
                wall={wall}
                fit={fit}
                rawPerM={rawPerM}
                pxPerRaw={pxPerRaw}
                selected={o.id === selectedOpeningId}
                readOnly={readOnly}
                onPointerDown={(e) => onOpeningPointerDown(e, o)}
              />
            );
          })}
        </svg>

        {loading && (
          <p className="absolute left-3 top-3 text-xs text-ink-500">Loading openings…</p>
        )}
        {!loading && walls.length === 0 && (
          <p className="absolute left-3 top-3 text-xs text-ink-500">
            No walls derived from this plan — confirm the room geometry first.
          </p>
        )}
      </div>

      {selectedOpening && !readOnly && (
        <OpeningProperties
          key={`${selectedOpening.id}:${selectedOpening.width_mm}:${selectedOpening.height_mm}:${selectedOpening.sill_mm}`}
          opening={selectedOpening}
          onChange={(patch) => {
            // Inverse of a dimension edit: put back the exact previous size.
            // If it was derived, reset_dims is the only honest way back —
            // writing derived:false..true by hand would bypass the server rule.
            if ("width_mm" in patch || "height_mm" in patch || "sill_mm" in patch) {
              pushUndo({
                kind: "restore",
                label: `Resize ${selectedOpening.kind}`,
                id: selectedOpening.id,
                patch: selectedOpening.derived
                  ? { reset_dims: true }
                  : {
                      width_mm: selectedOpening.width_mm,
                      height_mm: selectedOpening.height_mm,
                      sill_mm: selectedOpening.sill_mm,
                    },
              });
            } else if ("kind" in patch) {
              pushUndo({
                kind: "restore",
                label: "Change type",
                id: selectedOpening.id,
                patch: { kind: selectedOpening.kind },
              });
            }
            void patchOpening(selectedOpening.id, patch);
          }}
          onDelete={() => void deleteOpening(selectedOpening.id)}
        />
      )}
    </div>
  );
}

// --- glyphs ------------------------------------------------------------------

/**
 * One opening drawn on its wall in standard architectural notation:
 *   door    — the jamb gap, a leaf perpendicular to the wall, and a quarter
 *             swing arc from the leaf tip back to the far jamb.
 *   window  — the jamb gap plus a double line across it.
 *   archway — the jamb gap with open (unstopped) jambs, no leaf and no glazing.
 * A derived (defaulted-dimension) opening is drawn in amber and dashed so it
 * reads as provisional at a glance.
 */
function OpeningGlyph({
  opening: o,
  wall,
  fit,
  rawPerM,
  pxPerRaw,
  selected,
  readOnly,
  onPointerDown,
}: {
  opening: PlanOpening;
  wall: RawWallSegment;
  fit: ReturnType<typeof fitRooms>;
  rawPerM: number;
  pxPerRaw: number;
  selected: boolean;
  readOnly: boolean;
  onPointerDown: (e: ReactPointerEvent<SVGGElement>) => void;
}) {
  const centre = fit.toViewBox(o.position!);
  const a = fit.toViewBox(wall.a);
  const b = fit.toViewBox(wall.b);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  // Unit vectors along the wall and normal to it, in viewBox space.
  const ux = (b[0] - a[0]) / len;
  const uy = (b[1] - a[1]) / len;
  const nx = -uy;
  const ny = ux;

  const halfPx = ((o.width_mm / 1000) * rawPerM * pxPerRaw) / 2;
  const p0: Pt = [centre[0] - ux * halfPx, centre[1] - uy * halfPx];
  const p1: Pt = [centre[0] + ux * halfPx, centre[1] + uy * halfPx];

  const stroke = o.derived ? AMBER : INK_900;
  const accent = selected ? BRASS : stroke;
  const dash = o.derived ? "3 2" : undefined;

  // Leaf length = opening width (a door leaf is as long as its clear opening).
  const leafLen = halfPx * 2;

  return (
    <g
      onPointerDown={onPointerDown}
      className={readOnly ? undefined : "cursor-grab"}
      style={{ touchAction: "none" }}
    >
      {/* Clear the wall through the opening so the jamb gap reads. */}
      <line
        x1={p0[0]}
        y1={p0[1]}
        x2={p1[0]}
        y2={p1[1]}
        stroke="#FFFFFF"
        strokeWidth={6}
        strokeLinecap="butt"
      />
      {/* Jamb ticks at both ends. */}
      {[p0, p1].map((p, i) => (
        <line
          key={i}
          x1={p[0] - nx * 4}
          y1={p[1] - ny * 4}
          x2={p[0] + nx * 4}
          y2={p[1] + ny * 4}
          stroke={accent}
          strokeWidth={1.6}
        />
      ))}

      {o.kind === "door" && (
        <>
          <line
            x1={p0[0]}
            y1={p0[1]}
            x2={p0[0] + nx * leafLen}
            y2={p0[1] + ny * leafLen}
            stroke={accent}
            strokeWidth={1.6}
            strokeDasharray={dash}
          />
          <path
            d={`M ${p0[0] + nx * leafLen} ${p0[1] + ny * leafLen} A ${leafLen} ${leafLen} 0 0 1 ${p1[0]} ${p1[1]}`}
            fill="none"
            stroke={accent}
            strokeWidth={1}
            strokeDasharray={dash ?? "2 2"}
            opacity={0.75}
          />
        </>
      )}

      {o.kind === "window" &&
        [-1.6, 1.6].map((off, i) => (
          <line
            key={i}
            x1={p0[0] + nx * off}
            y1={p0[1] + ny * off}
            x2={p1[0] + nx * off}
            y2={p1[1] + ny * off}
            stroke={accent}
            strokeWidth={1.3}
            strokeDasharray={dash}
          />
        ))}

      {o.kind === "archway" && (
        <line
          x1={p0[0]}
          y1={p0[1]}
          x2={p1[0]}
          y2={p1[1]}
          stroke={accent}
          strokeWidth={1.3}
          strokeDasharray="4 3"
          opacity={0.8}
        />
      )}

      {selected && (
        <circle cx={centre[0]} cy={centre[1]} r={3.5} fill={BRASS} stroke="#FFFFFF" strokeWidth={1} />
      )}
    </g>
  );
}

// --- properties popover ------------------------------------------------------

function OpeningProperties({
  opening: o,
  onChange,
  onDelete,
}: {
  opening: PlanOpening;
  onChange: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  // Drafts seed from the persisted row. The caller keys this component on the
  // opening's id + dimensions, so a new selection (or a server-confirmed edit)
  // remounts it with fresh values — no setState-in-effect resync needed.
  const [w, setW] = useState(String(o.width_mm));
  const [h, setH] = useState(String(o.height_mm));
  const [s, setS] = useState(String(o.sill_mm));

  const commitDims = () => {
    const width = Number(w);
    const height = Number(h);
    const sill = Number(s);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    // Supplying BOTH dimensions is a measurement — the server clears `derived`.
    onChange({
      width_mm: width,
      height_mm: height,
      ...(Number.isFinite(sill) && sill >= 0 ? { sill_mm: sill } : {}),
    });
  };

  const areaM2 = ((o.width_mm / 1000) * (o.height_mm / 1000)).toFixed(2);

  return (
    <div className="rounded-md border border-ink-100 bg-paper p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="material-symbols-outlined text-base text-ink-700">
          {o.kind === "door" ? "door_front" : o.kind === "window" ? "window" : "meeting_room"}
        </span>
        <select
          value={o.kind}
          onChange={(e) => onChange({ kind: e.target.value })}
          className="rounded border border-ink-100 bg-paper px-1.5 py-0.5 text-xs text-ink-900"
        >
          {KINDS.map((k) => (
            <option key={k.key} value={k.key}>
              {k.label}
            </option>
          ))}
        </select>
        <span className="rounded-full border border-ink-100 px-2 py-0.5 text-[11px] text-ink-500">
          {o.source === "parsed" ? "From parse" : "User drawn"}
        </span>
        {o.derived && (
          <span
            className="rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[11px] font-medium text-[#92400E]"
            title="Dimensions defaulted, not measured. Enter a width and height to record a measurement."
          >
            derived — defaulted size
          </span>
        )}
        <span className="ml-auto font-mono text-xs tabular-nums text-ink-500">
          {areaM2} m²
        </span>
        <button
          type="button"
          onClick={onDelete}
          className="rounded border border-ink-100 px-1.5 py-0.5 text-xs text-status-error hover:bg-status-error/10"
        >
          Delete
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {(
          [
            ["Width (mm)", w, setW],
            ["Height (mm)", h, setH],
            ["Sill (mm)", s, setS],
          ] as const
        ).map(([label, val, set]) => (
          <label key={label} className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wider text-ink-500">{label}</span>
            <input
              type="number"
              value={val}
              onChange={(e) => set(e.target.value)}
              onBlur={commitDims}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitDims();
                }
              }}
              className="w-24 rounded border border-ink-100 bg-paper px-2 py-1 font-mono text-xs tabular-nums text-ink-900 focus-ring"
            />
          </label>
        ))}
        <p className="text-[11px] text-ink-500">
          Entering a width <em>and</em> height records a measurement and clears the
          derived flag.
        </p>
      </div>
    </div>
  );
}

// --- normalisation -----------------------------------------------------------

function normalise(row: unknown): PlanOpening | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== "string") return null;
  const kind: OpeningKind =
    r.kind === "window" || r.kind === "archway" ? r.kind : "door";
  const def = DEFAULT_OPENING_DIMS[kind];
  const pos = Array.isArray(r.position) && r.position.length >= 2
    ? ([Number(r.position[0]), Number(r.position[1])] as Pt)
    : null;
  return {
    id: r.id,
    plan_id: String(r.plan_id ?? ""),
    room_id: typeof r.room_id === "string" ? r.room_id : null,
    wall_ref: typeof r.wall_ref === "string" ? r.wall_ref : null,
    kind,
    width_mm: Number(r.width_mm ?? def.width_mm),
    height_mm: Number(r.height_mm ?? def.height_mm),
    sill_mm: Number(r.sill_mm ?? def.sill_mm),
    position: pos && Number.isFinite(pos[0]) && Number.isFinite(pos[1]) ? pos : null,
    along_offset: typeof r.along_offset === "number" ? r.along_offset : null,
    source: r.source === "parsed" ? "parsed" : "user_drawn",
    derived: r.derived === true,
  };
}

function normaliseAll(rows: unknown[]): PlanOpening[] {
  return rows
    .map(normalise)
    .filter((o): o is PlanOpening => o !== null);
}
