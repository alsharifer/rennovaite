"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  LINEAR_ELEMENT_KINDS,
  LINEAR_ELEMENT_META,
  polylineLength,
  type LinearElementKind,
} from "@/lib/plan/elements";
import {
  fitRooms,
  roomAt,
  VIEW_H,
  VIEW_W,
  type Pt,
  type RawRoomInput,
} from "@/lib/overlays/viewbox";

const BONE = "#EDE6D8";
const OPEN_ZONE = "#DCE3D2";
const INK_900 = "#0F1B2D";
const INK_500 = "#64748b";
const BRASS = "#A4793A";

interface Element {
  id: string;
  kind: LinearElementKind;
  room_id: string | null;
  polyline: Pt[];
  height_mm: number | null;
  width_mm: number | null;
  /** Counter runs only. null = nobody has chosen yet. */
  variant: "bar" | "bbq" | null;
  derived: boolean;
}

const COUNTER_VARIANTS = [
  { value: "bar" as const, label: "Bar counter", hint: "Blockwork and cladding only." },
  { value: "bbq" as const, label: "BBQ counter", hint: "Adds sink, water, drainage and sockets — priced inclusive of them." },
];

/**
 * G1 linear-element layer: boundary walls and bench / planter / counter runs.
 *
 * Draw by clicking vertices; Enter or a double-click finishes the run. That is
 * the only sane gesture for something measured in linear metres — a drag gives
 * you a straight line and nothing else, and a garden bench turns corners.
 *
 * A boundary wall drawn here is the only thing that puts a wall on an unroofed
 * zone's edge, because lib/plan/geometry.ts suppresses derived walls there. So
 * this layer is load-bearing rather than decorative.
 */
export function ElementsEditor({
  planId,
  rooms,
  plot,
  readOnly = false,
}: {
  planId: string;
  rooms: RawRoomInput[];
  /** Authored plan's measured plot — lets the layer report true lengths. */
  plot?: { width_m: number; depth_m: number } | null;
  readOnly?: boolean;
}) {
  const fit = useMemo(() => fitRooms(rooms), [rooms]);

  const [elements, setElements] = useState<Element[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<LinearElementKind | null>(null);
  const [draft, setDraft] = useState<Pt[]>([]);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/plan-elements?plan_id=${planId}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (body.error) setError(body.error);
        else setElements((body.elements ?? []) as Element[]);
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
    const rect = svg.getBoundingClientRect();
    return [
      ((clientX - rect.left) / rect.width) * VIEW_W,
      ((clientY - rect.top) / rect.height) * VIEW_H,
    ];
  }, []);

  // Normalised-unit to metres. An authored plan's normalised x-span IS the plot
  // width, which is the point of storing it. Without a plot there is no honest
  // linear scale, so lengths read as a dash rather than an invented number.
  const metresPerUnit = plot?.width_m ?? null;
  const lengthLabel = useCallback(
    (pts: Pt[]) =>
      metresPerUnit == null
        ? "—"
        : `${(polylineLength(pts) * metresPerUnit).toFixed(2)} m`,
    [metresPerUnit],
  );

  const commitDraft = useCallback(
    async (pts: Pt[]) => {
      if (!kind || pts.length < 2) {
        setDraft([]);
        return;
      }
      setDraft([]);
      try {
        const res = await fetch("/api/plan-elements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plan_id: planId,
            kind,
            polyline: pts,
            room_id: roomAt(fit, pts[0]!),
          }),
        });
        const body = await res.json();
        if (body.element) setElements((cur) => [...cur, body.element as Element]);
        else if (body.error) setError(body.error);
      } catch (e) {
        setError(String(e));
      }
    },
    [kind, planId, fit],
  );

  const onSvgPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (readOnly) return;
    if (!kind) {
      if (e.target === e.currentTarget) setSelectedId(null);
      return;
    }
    const raw = fit.toRaw(clientToViewBox(e.clientX, e.clientY));
    setDraft((cur) => [...cur, raw]);
  };

  const onSvgPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (readOnly || !kind || draft.length === 0) return;
    setCursor(fit.toRaw(clientToViewBox(e.clientX, e.clientY)));
  };

  const finish = useCallback(() => {
    if (draft.length >= 2) void commitDraft(draft);
    else setDraft([]);
    setCursor(null);
  }, [draft, commitDraft]);

  // Enter finishes the run, Escape abandons it. Both beat hunting for a button
  // mid-gesture, and Escape has to exist or a mis-started run is a stuck state.
  useEffect(() => {
    if (readOnly) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        finish();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        setDraft([]);
        setCursor(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finish, readOnly]);

  /**
   * Type a counter run. Until this is answered the take-off prices the run as a
   * bar counter — the cheaper of the two — and flags the BoQ line, because the
   * two differ by AED 968/lm and the BBQ rate is what carries its MEP.
   */
  const setVariant = async (id: string, variant: "bar" | "bbq") => {
    setElements((cur) => cur.map((el) => (el.id === id ? { ...el, variant } : el)));
    try {
      const res = await fetch("/api/plan-elements", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, variant }),
      });
      const body = await res.json();
      if (body.error) setError(body.error);
    } catch (e) {
      setError(String(e));
    }
  };

  const deleteSelected = async () => {
    if (!selectedId) return;
    const id = selectedId;
    setElements((cur) => cur.filter((el) => el.id !== id));
    setSelectedId(null);
    try {
      await fetch(`/api/plan-elements?id=${id}`, { method: "DELETE" });
    } catch {
      /* best-effort */
    }
  };

  const totals = useMemo(() => {
    const out = new Map<LinearElementKind, number>();
    for (const el of elements) {
      const len = metresPerUnit == null ? 0 : polylineLength(el.polyline) * metresPerUnit;
      out.set(el.kind, (out.get(el.kind) ?? 0) + len);
    }
    return out;
  }, [elements, metresPerUnit]);

  const drawPts = cursor && draft.length > 0 ? [...draft, cursor] : draft;
  const selected = elements.find((el) => el.id === selectedId) ?? null;
  const untypedCounters = elements.filter(
    (el) => el.kind === "counter_run" && el.variant == null,
  ).length;

  return (
    <div className="space-y-3">
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="label-caps mr-1 text-ink-500">Draw:</span>
          {LINEAR_ELEMENT_KINDS.map((k) => {
            const meta = LINEAR_ELEMENT_META[k];
            const active = kind === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setDraft([]);
                  setCursor(null);
                  setKind((cur) => (cur === k ? null : k));
                }}
                className={
                  "focus-ring inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[12px] transition-colors " +
                  (active
                    ? "border-brass-600 bg-primary-fixed/40 text-ink-900"
                    : "border-ink-100 bg-paper text-ink-700 hover:bg-surface-container")
                }
                title={meta.boqDescription}
              >
                <span className="font-mono font-semibold" style={{ color: meta.color }}>
                  {meta.code}
                </span>
                {meta.label}
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-2">
            {kind && (
              <span className="text-[12px] text-brass-600">
                Click to add points · Enter to finish · Esc to cancel
              </span>
            )}
            <button
              type="button"
              onClick={deleteSelected}
              disabled={!selectedId}
              className="focus-ring rounded-lg border border-ink-100 bg-paper px-3 py-1 text-[12px] text-ink-900 transition-colors hover:bg-surface-container disabled:opacity-40"
            >
              Delete selected
            </button>
          </div>
        </div>
      )}

      {/* Properties for the selected run. Today the only property that changes
          a price is the counter variant, so that is what this holds. */}
      {!readOnly && selected?.kind === "counter_run" && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-ink-100 bg-canvas px-md py-sm">
          <span className="label-caps text-ink-500">Counter type:</span>
          {COUNTER_VARIANTS.map((v) => {
            const active = selected.variant === v.value;
            return (
              <button
                key={v.value}
                type="button"
                onClick={() => setVariant(selected.id, v.value)}
                aria-pressed={active}
                title={v.hint}
                className={
                  "focus-ring rounded-lg border px-2 py-1 text-[12px] transition-colors " +
                  (active
                    ? "border-brass-600 bg-primary-fixed/40 font-semibold text-ink-900"
                    : "border-ink-100 bg-paper text-ink-700 hover:bg-surface-container")
                }
              >
                {v.label}
              </button>
            );
          })}
          {selected.variant == null && (
            <span className="flex items-center gap-1 text-[12px] text-[#9A3412]">
              <span className="inline-block h-2 w-2 rounded-full bg-[#C2410C]" aria-hidden="true" />
              Not chosen — priced as a bar counter and flagged on the BoQ.
            </span>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-ink-100 bg-paper">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="block h-auto w-full select-none touch-none"
          role="img"
          aria-label={readOnly ? "Linear elements (view-only)" : "Linear element editor"}
          onPointerDown={onSvgPointerDown}
          onPointerMove={onSvgPointerMove}
          onDoubleClick={readOnly ? undefined : finish}
        >
          {/* Zones as read-only context. Open zones keep their dashed edge so
              this layer reads the same as the plan layer underneath it. */}
          {fit.rooms.map((r) => {
            const cx = r.pts.reduce((s, p) => s + p[0], 0) / r.pts.length;
            const cy = r.pts.reduce((s, p) => s + p[1], 0) / r.pts.length;
            const open = r.unroofed === true;
            return (
              <g key={r.id} pointerEvents="none">
                <polygon
                  points={r.pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")}
                  fill={open ? OPEN_ZONE : BONE}
                  fillOpacity={0.35}
                  stroke={INK_900}
                  strokeOpacity={open ? 0.4 : 0.5}
                  strokeDasharray={open ? "6 4" : undefined}
                  strokeWidth={1}
                />
                <text
                  x={cx}
                  y={cy}
                  textAnchor="middle"
                  fontSize="12"
                  fill={INK_500}
                  style={{ fontFamily: "var(--font-inter), sans-serif" }}
                >
                  {r.name_en}
                </text>
              </g>
            );
          })}

          {/* Persisted elements */}
          {elements.map((el) => {
            const meta = LINEAR_ELEMENT_META[el.kind];
            const pts = el.polyline.map(fit.toViewBox);
            const selected = selectedId === el.id;
            const mid = pts[Math.floor(pts.length / 2)] ?? pts[0]!;
            return (
              <g
                key={el.id}
                style={{ cursor: readOnly ? "default" : "pointer" }}
                onPointerDown={
                  readOnly
                    ? undefined
                    : (e) => {
                        e.stopPropagation();
                        setSelectedId(el.id);
                      }
                }
              >
                <polyline
                  points={pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")}
                  fill="none"
                  stroke={selected ? BRASS : meta.color}
                  strokeWidth={el.kind === "boundary_wall" ? 6 : 4}
                  strokeOpacity={selected ? 1 : 0.85}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <text
                  x={mid[0]}
                  y={mid[1] - 8}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight={600}
                  fill={selected ? BRASS : meta.color}
                  pointerEvents="none"
                  style={{ fontFamily: "var(--font-jetbrains-mono), monospace" }}
                >
                  {meta.code} {lengthLabel(el.polyline)}
                </text>
              </g>
            );
          })}

          {/* In-progress run */}
          {drawPts.length > 0 && kind && (
            <g pointerEvents="none">
              <polyline
                points={drawPts
                  .map(fit.toViewBox)
                  .map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`)
                  .join(" ")}
                fill="none"
                stroke={LINEAR_ELEMENT_META[kind].color}
                strokeWidth={3}
                strokeDasharray="6 4"
              />
              {draft.map(fit.toViewBox).map((p, i) => (
                <circle
                  key={i}
                  cx={p[0]}
                  cy={p[1]}
                  r={4}
                  fill={LINEAR_ELEMENT_META[kind].color}
                />
              ))}
            </g>
          )}
        </svg>
      </div>

      <p className="text-xs text-ink-500">
        {loading
          ? "Loading elements…"
          : error
            ? `Error: ${error}`
            : elements.length === 0
              ? readOnly
                ? "No boundary walls or runs drawn."
                : "Pick a kind above, then click along the plan to draw a run. Enter finishes it."
              : LINEAR_ELEMENT_KINDS.filter((k) => (totals.get(k) ?? 0) > 0)
                  .map(
                    (k) =>
                      `${LINEAR_ELEMENT_META[k].label}: ${(totals.get(k) ?? 0).toFixed(2)} m`,
                  )
                  .join(" · ")}
        {!loading && !error && metresPerUnit == null && elements.length > 0
          ? " — lengths need a measured plot, which only a drawn plan has."
          : ""}
        {untypedCounters > 0 && !readOnly
          ? ` · ${untypedCounters} counter run${untypedCounters === 1 ? "" : "s"} still need a type — select one to choose.`
          : ""}
      </p>
    </div>
  );
}
