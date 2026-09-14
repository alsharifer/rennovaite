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

/** G5: an existing footprint drawn under the plan (house, garage, boundary wall). */
export interface ContextOutline {
  id: string;
  name: string;
  kind: string;
  polygon: number[][];
}

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
  /** G5 */
  spec?: Record<string, unknown> | null;
  dims_derived?: boolean;
  site_reference?: boolean;
  disposition?: string | null;
}

/** A counter that still needs a type is one that is NEW work (G5: a kept or removed existing counter is not). */
const needsVariant = (el: Element) =>
  el.kind === "counter_run" && el.variant == null && (!el.site_reference || el.disposition === "replace");

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
  context = [],
  readOnly = false,
}: {
  planId: string;
  rooms: RawRoomInput[];
  /** Authored plan's measured plot — lets the layer report true lengths. */
  plot?: { width_m: number; depth_m: number } | null;
  /** G5: existing footprints to draw under the plan. */
  context?: ContextOutline[];
  readOnly?: boolean;
}) {
  const fit = useMemo(() => fitRooms(rooms, plot), [rooms, plot]);
  // G5: on a plot, points snap to a 5 cm grid — a run is set out, not sketched.
  const snap = useCallback(
    (raw: Pt): Pt => (plot ? [Math.round(raw[0] * plot.width_m * 20) / 20 / plot.width_m, Math.round(raw[1] * plot.width_m * 20) / 20 / plot.width_m] : raw),
    [plot],
  );

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
    const raw = snap(fit.toRaw(clientToViewBox(e.clientX, e.clientY)));
    setDraft((cur) => [...cur, raw]);
  };

  const onSvgPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (readOnly || !kind || draft.length === 0) return;
    setCursor(snap(fit.toRaw(clientToViewBox(e.clientX, e.clientY))));
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

  /** G5: give a run a measured cross-section (both values → no longer derived). */
  const setSection = async (id: string, height_mm: number, width_mm: number) => {
    if (!(height_mm > 0) || !(width_mm > 0)) return;
    setElements((cur) => cur.map((el) => (el.id === id ? { ...el, height_mm, width_mm, derived: false } : el)));
    try {
      const res = await fetch("/api/plan-elements", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, height_mm, width_mm }),
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
  const untypedCounters = elements.filter(needsVariant).length;

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

      {/* G5: what the selected run is — its name, cross-section, and whether it
          is an existing feature or sits on derived geometry. */}
      {selected && (
        <RunInspector
          key={`${selected.id}:${selected.height_mm}:${selected.width_mm}`}
          el={selected}
          length={lengthLabel(selected.polyline)}
          readOnly={readOnly}
          onSection={(h, w) => setSection(selected.id, h, w)}
        />
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
          {needsVariant(selected) && (
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
          {/* G5: existing footprints, then the plot outline. */}
          {context.map((c) => {
            const pts = c.polygon.map((p) => fit.toViewBox([p[0]!, p[1]!]));
            return (
              <polygon
                key={`ctx-${c.id}`}
                pointerEvents="none"
                points={pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")}
                fill={c.kind === "existing_building" ? "#D9D6CF" : "#8A8F98"}
                fillOpacity={c.kind === "existing_building" ? 0.7 : 0.9}
                stroke="#6B7280"
                strokeWidth={1}
              />
            );
          })}

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
                  strokeOpacity={el.site_reference && el.disposition === "remove" ? 0.3 : selected ? 1 : 0.85}
                  strokeDasharray={el.site_reference ? "5 4" : undefined}
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
                  {meta.code} {el.dims_derived ? "≈ " : ""}{lengthLabel(el.polyline)}{el.site_reference ? " · existing" : ""}
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

/** G5: the selected run — name, cross-section (editable), existing / derived badges. */
function RunInspector({
  el,
  length,
  readOnly,
  onSection,
}: {
  el: Element;
  length: string;
  readOnly: boolean;
  onSection: (height_mm: number, width_mm: number) => void;
}) {
  const meta = LINEAR_ELEMENT_META[el.kind];
  const name = typeof el.spec?.name === "string" ? el.spec.name : meta.label;
  const [h, setH] = useState(el.height_mm ?? meta.defaultHeightMm);
  const [w, setW] = useState(el.width_mm ?? meta.defaultWidthMm);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-ink-100 bg-canvas px-md py-sm text-[12px] text-ink-700">
      <span className="font-semibold text-ink-900">{name}</span>
      <span className="font-mono tabular-nums">{length}</span>
      {readOnly ? (
        <span className="font-mono tabular-nums">
          H {el.height_mm ?? "—"} · W {el.width_mm ?? "—"} mm
        </span>
      ) : (
        <>
          <label className="flex items-center gap-1">
            <span className="text-ink-500">H</span>
            <input type="number" step={10} value={h} onChange={(e) => setH(Number(e.target.value))} className="focus-ring w-[70px] rounded border border-ink-100 bg-paper px-1.5 py-0.5 text-right font-mono tabular-nums" />
          </label>
          <label className="flex items-center gap-1">
            <span className="text-ink-500">W</span>
            <input type="number" step={10} value={w} onChange={(e) => setW(Number(e.target.value))} className="focus-ring w-[70px] rounded border border-ink-100 bg-paper px-1.5 py-0.5 text-right font-mono tabular-nums" />
          </label>
          <span className="text-ink-500">mm</span>
          <button type="button" onClick={() => onSection(h, w)} className="focus-ring rounded border border-ink-100 bg-paper px-2 py-0.5 font-medium text-ink-900 hover:bg-surface-container">
            Set section
          </button>
        </>
      )}
      {el.derived && <span className="rounded-full bg-[#FEF3C7] px-2 py-0.5 font-medium text-[#92400E]">Section assumed</span>}
      {el.dims_derived && <span className="rounded-full bg-[#FEF3C7] px-2 py-0.5 font-medium text-[#92400E]">Position derived</span>}
      {el.site_reference && (
        <span className="rounded-full border border-brass-600 px-2 py-0.5 font-medium text-brass-600">
          Existing · {el.disposition ?? "undecided"}
        </span>
      )}
    </div>
  );
}
