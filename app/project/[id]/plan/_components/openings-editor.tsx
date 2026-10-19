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
// Wall ids stay volatile by contract (an outline edit renumbers them), so an
// opening is drawn and dragged on the wall it SITS on (by position, within
// 0.15 m) and never on its stored `wall_ref` — that hint went stale on
// Jumeirah Parks and drew windows across their walls (15 Oct). The hard plan
// rules (lib/plan/plan-rules.ts) refuse an add, a drop or a resize, with the
// reason; an opening on no wall is drawn as "Needs a wall" and can be dragged
// back onto one.
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
import { roomNameLabel as nameLabel } from "./label-render";
import { Icon } from "@/components/blueprint/Icon";
import { OPENINGS_CHANGED_EVENT } from "@/components/blueprint/plan/OpeningsCheckPanel";
import { isUnconfirmedDetected, type DetectionMeta } from "@/lib/plan/openings-vocab";
import { END_CLEAR_M, hardProblemFor, inGarden, ON_WALL_TOL_M, wallAt, type RuleOpening, type RuleRoom } from "@/lib/plan/plan-rules";

import {
  CANVAS_FRAME,
  chipState,
  CHIP_BTN,
  FIELD,
  LABEL,
  NUM_FIELD_BASE,
  SMALL_BTN,
  SVG,
  TAG,
  TOOL_BTN,
} from "./editor-chrome";
import { hingeSideOf, resolveHinge } from "@/lib/plan/door-hinge";

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
  /** R10b: "detected" = found on the drawing (lib/plan/openings-detect.ts). */
  source: "parsed" | "user_drawn" | "detected";
  derived: boolean;
  /** R10b: when a detected opening was confirmed; null = not confirmed (derived, never priced). */
  confirmed_at: string | null;
  detection: DetectionMeta | null;
  /** B7: spec.hinge_side ("left" | "right" as seen from the room) and its source. */
  spec: Record<string, unknown> | null;
}

const KINDS: { key: OpeningKind; label: string; glyph: string }[] = [
  { key: "door", label: "Door", glyph: "door_front" },
  { key: "window", label: "Window", glyph: "window" },
  { key: "archway", label: "Archway", glyph: "meeting_room" },
];

/** Minimum wall length (m) that can still take an opening of the given width. */
function fitsOnWall(wallLenM: number, widthM: number): boolean {
  return wallLenM >= widthM + 2 * END_CLEAR_M;
}

const HISTORY_LIMIT = 20;

/** An opening as the plan rules read it. */
const asRule = (o: PlanOpening): RuleOpening => ({ id: o.id, kind: o.kind, width_mm: o.width_mm, height_mm: o.height_mm, sill_mm: o.sill_mm, position: o.position, room_id: o.room_id, detection: o.detection });

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
  focus = null,
  defaults,
}: {
  /** R10b: select this opening (the confirmation panel's "show me"). */
  focus?: { id: string; n: number } | null;
  /** B1: a room-from-dimensions plan's door / window sizes (the route stores the same). */
  defaults?: Partial<typeof DEFAULT_OPENING_DIMS>;
  planId: string;
  rooms: RawRoomInput[];
  /** Authoritative plan area — sets the raw-unit → metre scale. */
  totalAreaM2: number | null;
  /** read mode: render openings + schedule, hide the palette, no editing. */
  readOnly?: boolean;
}) {
  const fit = useMemo(() => fitRooms(rooms), [rooms]);
  const walls = useMemo(
    // The same walls the BoQ prices: an open garden edge is not a wall (G1).
    () => deriveWallSegments(rooms.map((r) => ({ id: r.id, polygon: r.polygon, room_type: r.room_type, unroofed: r.unroofed ?? null }))),
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
    /** The wall under the pointer — it can change mid-drag (snaps to the nearest wall). */
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
  // R10b: re-read when the confirmation panel confirms, removes or re-detects.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch(`/api/plan-openings?plan_id=${planId}`)
        .then((r) => r.json())
        .then((body) => {
          if (cancelled) return;
          if (body.error) setError(body.error);
          else setOpenings(normaliseAll(body.openings ?? []));
        })
        .catch((e) => !cancelled && setError(String(e)))
        .finally(() => !cancelled && setLoading(false));
    void load();
    const on = (e: Event) => {
      if ((e as CustomEvent<{ from?: string }>).detail?.from !== "editor") void load();
    };
    window.addEventListener(OPENINGS_CHANGED_EVENT, on);
    return () => {
      cancelled = true;
      window.removeEventListener(OPENINGS_CHANGED_EVENT, on);
    };
  }, [planId]);

  const announce = useCallback(() => window.dispatchEvent(new CustomEvent(OPENINGS_CHANGED_EVENT, { detail: { from: "editor" } })), []);

  const clientToViewBox = useCallback((clientX: number, clientY: number): Pt => {
    const svg = svgRef.current;
    if (!svg) return [0, 0];
    const r = svg.getBoundingClientRect();
    return [
      ((clientX - r.left) / r.width) * VIEW_W,
      ((clientY - r.top) / r.height) * VIEW_H,
    ];
  }, []);

  /** The nearest wall to a point (any distance). */
  const nearestWallTo = useCallback(
    (p: Pt): { w: RawWallSegment; d: number } | null => {
      let best: { w: RawWallSegment; d: number } | null = null;
      for (const w of walls) {
        const { dist } = projectOntoSegment(p, w.a, w.b);
        if (!best || dist < best.d) best = { w, d: dist };
      }
      return best;
    },
    [walls],
  );

  /** The wall an opening SITS on — by its position, within 0.15 m — or null ("Needs a wall"). */
  const wallFor = useCallback(
    (o: PlanOpening): RawWallSegment | null => {
      return o.position ? wallAt(walls, o.position, ON_WALL_TOL_M * rawPerM) : null;
    },
    [walls, rawPerM],
  );

  // The plan rules, in the editor: every hard rule for one opening at a proposed place.
  const ruleRooms: RuleRoom[] = useMemo(
    () => rooms.map((r) => ({ id: r.id, name_en: r.name_en, room_type: r.room_type, polygon: r.polygon, unroofed: r.unroofed ?? null, ceiling_h_m: r.ceiling_h_m ?? null })),
    [rooms],
  );
  const refusal = useCallback(
    (cand: PlanOpening): string | null => {
      const p = hardProblemFor(asRule(cand), openings.filter((x) => x.id !== cand.id).map(asRule), ruleRooms, 1 / rawPerM);
      return p ? p.message : null;
    },
    [openings, ruleRooms, rawPerM],
  );

  const selectedOpening =
    openings.find((o) => o.id === selectedOpeningId) ?? null;

  // R10b: the panel's "show me" — select the opening and the wall it sits on.
  const focusKey = focus ? `${focus.id}:${focus.n}` : null;
  const [seenFocus, setSeenFocus] = useState<string | null>(null);
  if (focusKey && focusKey !== seenFocus && !loading) {
    const target = openings.find((o) => o.id === focus!.id);
    setSeenFocus(focusKey);
    if (target) {
      setSelectedOpeningId(target.id);
      setSelectedWallId(wallFor(target)?.id ?? null);
    }
  }

  // --- mutations -----------------------------------------------------------

  const addOpening = async (kind: OpeningKind) => {
    const wall = selectedWallId ? wallById.get(selectedWallId) : null;
    if (!wall || readOnly) return;
    const def = defaults?.[kind] ?? DEFAULT_OPENING_DIMS[kind];
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
    const no = refusal({ id: "new", plan_id: planId, room_id: wall.roomIds[0] ?? null, wall_ref: wall.id, kind, ...def, position, along_offset: t, source: "user_drawn", derived: true, confirmed_at: null, detection: null, spec: null });
    if (no) {
      setError(no);
      return;
    }
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
        setOpenings((cur) => withOpening(cur, created));
        setSelectedOpeningId(created.id);
        pushUndo({ kind: "delete", label: `Add ${kind}`, id: created.id });
        announce();
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
        announce();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Update failed.");
      }
    },
    [announce],
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
      announce();
      // An unconfirmed find is not recreated by undo — Re-detect brings it back.
      if (record && removed && !isUnconfirmedDetected(removed)) {
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
          setOpenings((cur) => withOpening(cur, created));
          setSelectedOpeningId(created.id);
        }
      } else {
        await patchOpening(step.id, step.patch);
        setSelectedOpeningId(step.id);
      }
      announce();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Undo failed.");
    } finally {
      setBusy(false);
    }
  }, [undoStack, readOnly, planId, patchOpening, announce]);

  // --- drag along the wall -------------------------------------------------

  const onOpeningPointerDown = (
    e: ReactPointerEvent<SVGGElement>,
    o: PlanOpening,
  ) => {
    e.stopPropagation();
    setSelectedOpeningId(o.id);
    setError(null);
    const wall = wallFor(o) ?? (o.position ? nearestWallTo(o.position)?.w ?? null : null);
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
    // Rule 1: it snaps to the wall under the pointer (within 0.6 m), else stays on its wall.
    const under = nearestWallTo(raw);
    if (under && under.d <= 0.6 * rawPerM) d.wall = under.w;
    const { t } = projectOntoSegment(raw, d.wall.a, d.wall.b);
    const o = openings.find((x) => x.id === d.id);
    const wallLen = Math.hypot(d.wall.b[0] - d.wall.a[0], d.wall.b[1] - d.wall.a[1]);
    // Rule 3: the leaf stays 0.1 m clear of each end.
    const halfT = o && wallLen > 0 ? Math.min(0.5, ((o.width_mm / 1000 / 2 + END_CLEAR_M) * rawPerM) / wallLen) : 0;
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
    const no = refusal({ ...o, room_id: d.wall.roomIds[0] ?? o.room_id });
    if (no) {
      // Hard rule: back where it was, with the reason.
      setOpenings((cur) => cur.map((x) => (x.id === d.id ? { ...x, position: d.from.position, along_offset: d.from.along_offset } : x)));
      setError(`Not moved: ${no}`);
      return;
    }
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
  const derivedCount = openings.filter((o) => o.derived && !isUnconfirmedDetected(o)).length;
  const foundCount = openings.filter(isUnconfirmedDetected).length;

  return (
    <div className="space-y-3">
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <span id="openings-add-hint" className={`${LABEL} mr-1`}>
            {selectedWall ? "Add to selected wall" : "Select a wall to add an opening"}
          </span>
          {KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              disabled={!selectedWall || busy}
              aria-describedby={!selectedWall ? "openings-add-hint" : undefined}
              onClick={() => void addOpening(k.key)}
              className={`${CHIP_BTN} ${chipState(false)}`}
              data-add-opening={k.key}
            >
              <Icon name={k.glyph} className="text-[16px]" />
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
            className={TOOL_BTN}
          >
            <Icon name="undo" className="text-[16px]" />
            Undo
            {undoStack.length > 0 && (
              <span className="t-num-sm text-bp-ink-secondary">({undoStack.length})</span>
            )}
          </button>
          <span className="ml-auto flex items-center gap-2 t-label-md text-bp-ink-secondary">
            <span>
              {openings.length} opening{openings.length === 1 ? "" : "s"}
            </span>
            {derivedCount > 0 && (
              <span
                className={TAG}
                title="Dimensions were defaulted, not measured — these never read as measured quantities."
              >
                {derivedCount} derived
              </span>
            )}
            {foundCount > 0 && (
              <span
                className={TAG}
                title="Found on the drawing and not yet confirmed — they shape the renders but are not priced until confirmed."
                data-testid="openings-found-tag"
              >
                {foundCount} found · to confirm
              </span>
            )}
          </span>
        </div>
      )}

      {error && (
        <div role="alert" className="surface-inverse bg-bp-alert-surface px-4 py-3 text-bp-alert-ink">
          <p className="t-body-sm">{error}</p>
        </div>
      )}

      <div className={`relative ${CANVAS_FRAME}`}>
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
                fill={SVG.roomFill}
                fillOpacity={0.5}
                stroke="none"
              />
              {nameLabel(r, (nl) => (
                <text
                  x={nl.x}
                  y={nl.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={nl.fontPx}
                  fill={SVG.inkTertiary}
                  style={{ fontFamily: SVG.sans, fontWeight: 500 }}
                  pointerEvents="none"
                >
                  <title>{r.name_en}</title>
                  {nl.text}
                </text>
              ), 13)}
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
                  stroke={isSel ? SVG.brass : SVG.ink}
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
                    data-wall-hit={w.id}
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
            if (!o.position) return null;
            if (!wall) {
              const c = fit.toViewBox(o.position);
              // In the garden (a gate, a garden wall, a zone edge): exempt from the house rules (15 Oct).
              if (inGarden(asRule(o), ruleRooms, 1 / rawPerM)) {
                return (
                  <g key={o.id} data-garden-opening={o.id} className="cursor-pointer" onPointerDown={(e) => { e.stopPropagation(); setSelectedOpeningId(o.id); }}>
                    <title>{`${o.kind} in the garden — not on a house wall`}</title>
                    <circle cx={c[0]} cy={c[1]} r={6} fill={SVG.inkSecondary} stroke={o.id === selectedOpeningId ? SVG.brass : "none"} strokeWidth={2} />
                  </g>
                );
              }
              // Rule 1/2: on no wall — out of the BoQ and the renders until it is put back on one.
              return (
                <g key={o.id} onPointerDown={(e) => onOpeningPointerDown(e, o)} className={readOnly ? undefined : "cursor-grab"} style={{ touchAction: "none" }} data-needs-wall={o.id}>
                  <title>{`${o.kind} — needs a wall: drag it onto one`}</title>
                  <circle cx={c[0]} cy={c[1]} r={10} fill={SVG.surface} stroke={o.id === selectedOpeningId ? SVG.brass : SVG.ink} strokeWidth={1.5} strokeDasharray="3 2" />
                  <text x={c[0]} y={c[1] + 0.5} textAnchor="middle" dominantBaseline="middle" fontSize={12} fill={SVG.ink} style={{ fontFamily: SVG.mono }} pointerEvents="none">
                    !
                  </text>
                </g>
              );
            }
            return (
              <OpeningGlyph
                key={o.id}
                opening={o}
                roomPts={fit.rooms.find((r) => r.id === o.room_id)?.pts ?? null}
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
          <p className="absolute left-3 top-3 t-label-md text-bp-ink-secondary">Loading openings…</p>
        )}
        {!loading && walls.length === 0 && (
          <p className="absolute left-3 top-3 t-body-sm text-bp-ink-secondary">
            No walls derived from this plan — confirm the room geometry first.
          </p>
        )}
      </div>

      {selectedOpening && !readOnly && (
        <OpeningProperties
          key={`${selectedOpening.id}:${selectedOpening.width_mm}:${selectedOpening.height_mm}:${selectedOpening.sill_mm}`}
          opening={selectedOpening}
          needsWall={!wallFor(selectedOpening) && !inGarden(asRule(selectedOpening), ruleRooms, 1 / rawPerM)}
          onChange={(patch) => {
            const no = refusal({ ...selectedOpening, ...(patch as Partial<PlanOpening>) });
            if (no) {
              setError(`Not changed: ${no}`);
              return;
            }
            setError(null);
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
          onConfirm={
            isUnconfirmedDetected(selectedOpening)
              ? async () => {
                  const res = await fetch("/api/plan-openings/confirm", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ plan_id: planId, ids: [selectedOpening.id] }),
                  });
                  if (!res.ok) {
                    setError("Could not confirm — try again.");
                    return;
                  }
                  setOpenings((cur) => cur.map((o) => (o.id === selectedOpening.id ? { ...o, confirmed_at: new Date().toISOString() } : o)));
                  announce();
                }
              : undefined
          }
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
 * A derived (defaulted-dimension) opening is drawn dashed in the secondary ink
 * so it reads as provisional at a glance (Blueprint: no status hue — the dash
 * says it).
 */
function OpeningGlyph({
  opening: o,
  roomPts,
  wall,
  fit,
  rawPerM,
  pxPerRaw,
  selected,
  readOnly,
  onPointerDown,
}: {
  opening: PlanOpening;
  /** The opening's room in viewBox space — which side of the wall is "inside". */
  roomPts: Pt[] | null;
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

  // R10b: an unconfirmed find is provisional however its size was read.
  const provisional = o.derived || isUnconfirmedDetected(o);
  const stroke = provisional ? SVG.inkSecondary : SVG.ink;
  const accent = selected ? SVG.brass : stroke;
  const dash = provisional ? "3 2" : undefined;

  // Leaf length = opening width (a door leaf is as long as its clear opening).
  const leafLen = halfPx * 2;
  // B7: the leaf hangs on the resolved hinge jamb and swings into the room.
  let inward: Pt = [nx, ny];
  if (roomPts?.length) {
    const cx = roomPts.reduce((t, p) => t + p[0], 0) / roomPts.length, cy = roomPts.reduce((t, p) => t + p[1], 0) / roomPts.length;
    if ((cx - centre[0]) * nx + (cy - centre[1]) * ny < 0) inward = [-nx, -ny];
  }
  const hr = resolveHinge(p0, p1, inward, a, b, o.spec);
  const into: Pt = o.spec?.swing === "out" ? [-inward[0], -inward[1]] : inward;
  const tip: Pt = [hr.hinge[0] + into[0] * leafLen, hr.hinge[1] + into[1] * leafLen];
  const sweep = (tip[0] - hr.hinge[0]) * (hr.free[1] - hr.hinge[1]) - (tip[1] - hr.hinge[1]) * (hr.free[0] - hr.hinge[0]) > 0 ? 1 : 0;

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
        stroke={SVG.surface}
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
            x1={hr.hinge[0]}
            y1={hr.hinge[1]}
            x2={tip[0]}
            y2={tip[1]}
            stroke={accent}
            strokeWidth={1.6}
            strokeDasharray={dash}
            data-hinge={hr.source === "estimate" ? `estimate-${hr.side}` : hr.side}
          />
          <path
            d={`M ${tip[0]} ${tip[1]} A ${leafLen} ${leafLen} 0 0 ${sweep} ${hr.free[0]} ${hr.free[1]}`}
            fill="none"
            stroke={accent}
            strokeWidth={1}
            strokeDasharray={hr.source === "estimate" ? "2 2" : (dash ?? undefined)}
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
        <circle cx={centre[0]} cy={centre[1]} r={3.5} fill={SVG.brass} stroke={SVG.surface} strokeWidth={1} />
      )}
    </g>
  );
}

// --- properties popover ------------------------------------------------------

function OpeningProperties({
  opening: o,
  onChange,
  onDelete,
  onConfirm,
  needsWall = false,
}: {
  opening: PlanOpening;
  /** Rule 1/2: on no wall — out of the BoQ and the renders. */
  needsWall?: boolean;
  onChange: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
  /** R10b: present for an opening found on the drawing and not yet confirmed. */
  onConfirm?: () => void;
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
    <div className="border border-bp-line-hairline bg-bp-surface-raised p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Icon name={o.kind === "door" ? "door_front" : o.kind === "window" ? "window" : "meeting_room"} className="text-[18px] text-bp-ink-secondary" />
        <select
          value={o.kind}
          aria-label="Opening type"
          onChange={(e) => onChange({ kind: e.target.value })}
          className={FIELD}
        >
          {KINDS.map((k) => (
            <option key={k.key} value={k.key}>
              {k.label}
            </option>
          ))}
        </select>
        {needsWall && (
          <span className={TAG} data-needs-wall-tag="">
            Needs a wall — drag it onto one
          </span>
        )}
        <span className={TAG}>
          {o.source === "parsed" ? "From parse" : o.source === "detected" ? (o.confirmed_at ? "Found on the drawing · confirmed" : "Found on the drawing · not confirmed") : "User drawn"}
        </span>
        {onConfirm && (
          <button type="button" onClick={onConfirm} className={SMALL_BTN} data-testid="opening-confirm">
            <Icon name="check" className="text-[16px]" />
            Confirm
          </button>
        )}
        {o.derived && (
          <span
            className={TAG}
            title="Dimensions defaulted, not measured. Enter a width and height to record a measurement."
          >
            {o.source === "detected" ? "≈ width — check" : "derived — defaulted size"}
          </span>
        )}
        <span className="ml-auto t-num-sm text-bp-ink-secondary">
          {areaM2} m²
        </span>
        <button
          type="button"
          onClick={onDelete}
          className={SMALL_BTN}
        >
          <Icon name="delete" className="text-[16px]" />
          Delete
        </button>
      </div>
      {o.kind === "door" && (
        <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Hinge side, as seen from inside the room" data-hinge-control="">
          <span className="t-label-caps text-bp-ink-tertiary">Hinge, seen from the room</span>
          {(["left", "right"] as const).map((side) => (
            <button
              key={side}
              type="button"
              aria-pressed={hingeSideOf(o.spec) === side}
              onClick={() => onChange({ spec: { ...(o.spec ?? {}), hinge_side: side, hinge_source: "entered" } })}
              className={`${CHIP_BTN} ${chipState(hingeSideOf(o.spec) === side)}`}
              data-testid={`hinge-${side}`}
            >
              {side === "left" ? "Left" : "Right"}
            </button>
          ))}
          {!hingeSideOf(o.spec) && !o.spec?.hinge && (
            <span className={TAG} title="Not entered: drawn on the jamb nearer the corner. Choose Left or Right to record it.">
              estimate — nearer the corner
            </span>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        {(
          [
            ["Width (mm)", w, setW],
            ["Height (mm)", h, setH],
            ["Sill (mm)", s, setS],
          ] as const
        ).map(([label, val, set]) => (
          <label key={label} className="flex flex-col gap-1">
            <span className="t-label-caps text-bp-ink-tertiary">{label}</span>
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
              className={`${NUM_FIELD_BASE} w-24`}
            />
          </label>
        ))}
        <p className="t-body-sm text-bp-ink-secondary">
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
    source: r.source === "parsed" ? "parsed" : r.source === "detected" ? "detected" : "user_drawn",
    derived: r.derived === true,
    confirmed_at: typeof r.confirmed_at === "string" ? r.confirmed_at : null,
    detection: r.detection && typeof r.detection === "object" ? (r.detection as DetectionMeta) : null,
    spec: r.spec && typeof r.spec === "object" ? (r.spec as Record<string, unknown>) : null,
  };
}

/**
 * Add an opening the list does not already hold. The layer's first load can
 * answer AFTER an add was stored but BEFORE the add's own response — then the
 * load already carries it, and appending again drew it twice (B1 live check).
 */
function withOpening(list: PlanOpening[], o: PlanOpening): PlanOpening[] {
  return list.some((x) => x.id === o.id) ? list.map((x) => (x.id === o.id ? o : x)) : [...list, o];
}

function normaliseAll(rows: unknown[]): PlanOpening[] {
  return rows
    .map(normalise)
    .filter((o): o is PlanOpening => o !== null);
}
