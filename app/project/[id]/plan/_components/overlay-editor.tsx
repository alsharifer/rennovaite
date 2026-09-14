"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { FIXTURE_META } from "@/lib/overlays/catalog";
import {
  ELECTRICAL_TYPES,
  GARDEN_TYPES,
  LANDSCAPE_TYPES,
  PLUMBING_TYPES,
  type FixtureType,
  type OverlayLayer,
} from "@/lib/overlays/types";
import {
  fitRooms,
  roomAt,
  VIEW_H,
  VIEW_W,
  type Pt,
  type RawRoomInput,
} from "@/lib/overlays/viewbox";

const BONE = "#EDE6D8";
const INK_900 = "#0F1B2D";
const INK_500 = "#64748b";
const BRASS = "#A4793A";

interface Fixture {
  id: string;
  layer: OverlayLayer;
  type: FixtureType;
  room_id: string | null;
  position: Pt;
  source: "rule" | "user";
  spec?: Record<string, unknown> | null;
  /** G5 */
  site_reference?: boolean;
  disposition?: string | null;
  dims_derived?: boolean;
}

/**
 * G5: what a newly placed item starts as. A planter box or wall feature with no
 * size is invisible to the 3D scene and has no elevation, and a garden light with
 * no fitting renders as a generic glow — so each starts from a stated default the
 * designer then edits, marked assumed until they do.
 */
const DEFAULT_SPEC: Partial<Record<FixtureType, Record<string, unknown>>> = {
  planter_box: { width_mm: 1200, depth_mm: 1200, height_mm: 450, wall_mm: 200, assumed: true },
  wall_feature: { width_mm: 2500, depth_mm: 300, height_mm: 1800, assumed: true },
  tree: { species: "tree", height_mm: 4000, canopy_mm: 3000, assumed: true },
  garden_light: { fitting: "spike", source: "as_designed" },
  boundary_light: { fitting: "wall", source: "as_designed" },
};

const LIGHT_FITTINGS = ["spike", "inground", "strip", "bollard"] as const;

export interface ContextOutline {
  id: string;
  name: string;
  kind: string;
  polygon: number[][];
}

export function OverlayEditor({
  projectId,
  rooms,
  layer,
  readOnly = false,
  gardenPilot = false,
  plot = null,
  context = [],
}: {
  projectId: string;
  rooms: RawRoomInput[];
  layer: OverlayLayer;
  /** G5: authored plot — the canvas is the plot, positions snap to 5 cm. */
  plot?: { width_m: number; depth_m: number } | null;
  context?: ContextOutline[];
  /** read mode: render fixtures but hide the palette + disable drag/add/delete. */
  readOnly?: boolean;
  /** G1: offer the garden light / drainage types. Off ⇒ the palette is exactly
   *  what it was before the pilot. */
  gardenPilot?: boolean;
}) {
  const fit = useMemo(() => fitRooms(rooms, plot), [rooms, plot]);
  const snap = useCallback(
    (raw: Pt): Pt => (plot ? [Math.round(raw[0] * plot.width_m * 20) / 20 / plot.width_m, Math.round(raw[1] * plot.width_m * 20) / 20 / plot.width_m] : raw),
    [plot],
  );
  const types = useMemo((): readonly FixtureType[] => {
    if (layer === "landscape") return LANDSCAPE_TYPES;
    const all = layer === "electrical" ? ELECTRICAL_TYPES : PLUMBING_TYPES;
    return gardenPilot ? all : all.filter((t) => !GARDEN_TYPES.includes(t));
  }, [layer, gardenPilot]);

  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paletteType, setPaletteType] = useState<FixtureType | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ id: string; moved: boolean; pointerId: number } | null>(null);

  // Load fixtures (server seeds rule defaults on first access).
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/plan-fixtures?project_id=${projectId}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (body.error) setError(body.error);
        else setFixtures((body.fixtures ?? []) as Fixture[]);
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const layerFixtures = fixtures.filter((f) => f.layer === layer);
  const selectedFixture = layerFixtures.find((f) => f.id === selectedId) ?? null;

  const clientToViewBox = useCallback((clientX: number, clientY: number): Pt => {
    const svg = svgRef.current;
    if (!svg) return [0, 0];
    const rect = svg.getBoundingClientRect();
    return [
      ((clientX - rect.left) / rect.width) * VIEW_W,
      ((clientY - rect.top) / rect.height) * VIEW_H,
    ];
  }, []);

  const persistMove = useCallback(
    async (f: Fixture) => {
      try {
        await fetch("/api/plan-fixtures", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: f.id, project_id: projectId, type: f.type, room_id: f.room_id, position: f.position }),
        });
      } catch {
        /* best-effort */
      }
    },
    [projectId],
  );

  const onFixturePointerDown = (e: ReactPointerEvent<SVGGElement>, f: Fixture) => {
    e.stopPropagation();
    setSelectedId(f.id);
    dragRef.current = { id: f.id, moved: false, pointerId: e.pointerId };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    d.moved = true;
    const raw = snap(fit.toRaw(clientToViewBox(e.clientX, e.clientY)));
    setFixtures((cur) => cur.map((f) => (f.id === d.id ? { ...f, position: raw } : f)));
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (d.moved) {
      const f = fixtures.find((x) => x.id === d.id);
      if (f) void persistMove({ ...f, position: snap(fit.toRaw(clientToViewBox(e.clientX, e.clientY))) });
    }
  };

  // Click empty canvas: add (if a palette type is armed) or deselect.
  const onSvgPointerDown = async (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.target !== e.currentTarget) return;
    if (!paletteType) {
      setSelectedId(null);
      return;
    }
    const raw = snap(fit.toRaw(clientToViewBox(e.clientX, e.clientY)));
    const type = paletteType;
    try {
      const res = await fetch("/api/plan-fixtures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, type, position: raw, room_id: roomAt(fit, raw), ...(DEFAULT_SPEC[type] ? { spec: DEFAULT_SPEC[type] } : {}) }),
      });
      const body = await res.json();
      if (body.fixture) setFixtures((cur) => [...cur, body.fixture as Fixture]);
    } catch {
      /* best-effort */
    }
  };

  /** G5: edit a selected item's spec (size, fitting). */
  const saveSpec = async (f: Fixture, spec: Record<string, unknown>) => {
    setFixtures((cur) => cur.map((x) => (x.id === f.id ? { ...x, spec } : x)));
    try {
      await fetch("/api/plan-fixtures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: f.id, project_id: projectId, type: f.type, room_id: f.room_id, position: f.position, spec }),
      });
    } catch {
      setError("Could not save the change.");
    }
  };

  const deleteSelected = async () => {
    if (!selectedId) return;
    const id = selectedId;
    setFixtures((cur) => cur.filter((f) => f.id !== id));
    setSelectedId(null);
    try {
      await fetch(`/api/plan-fixtures?id=${id}`, { method: "DELETE" });
    } catch {
      /* best-effort */
    }
  };

  return (
    <div className="space-y-3">
      {/* Palette + delete toolbar (edit only) */}
      {!readOnly && (
      <div className="flex flex-wrap items-center gap-2">
        <span className="label-caps mr-1 text-ink-500">Add:</span>
        {types.map((t) => {
          const active = paletteType === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setPaletteType((cur) => (cur === t ? null : t))}
              className={
                "focus-ring inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[12px] transition-colors " +
                (active
                  ? "border-brass-600 bg-primary-fixed/40 text-ink-900"
                  : "border-ink-100 bg-paper text-ink-700 hover:bg-surface-container")
              }
              title={FIXTURE_META[t].label}
            >
              <span className="font-mono font-semibold">{FIXTURE_META[t].code}</span>
              {FIXTURE_META[t].label}
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          {paletteType && (
            <span className="text-[12px] text-brass-600">
              Click the plan to place a {FIXTURE_META[paletteType].label.toLowerCase()}
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

      {selectedFixture && (
        <FixtureInspector
          key={`${selectedFixture.id}:${JSON.stringify(selectedFixture.spec ?? null)}`}
          f={selectedFixture}
          readOnly={readOnly}
          onSpec={(spec) => saveSpec(selectedFixture, spec)}
        />
      )}

      <div className="overflow-hidden rounded-xl border border-ink-100 bg-paper">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="block h-auto w-full select-none touch-none"
          role="img"
          aria-label={readOnly ? `${layer} overlay (view-only)` : `${layer} overlay editor`}
          onPointerDown={readOnly ? undefined : onSvgPointerDown}
          onPointerMove={readOnly ? undefined : onPointerMove}
          onPointerUp={readOnly ? undefined : onPointerUp}
        >
          {context.map((c) => (
            <polygon
              key={`ctx-${c.id}`}
              pointerEvents="none"
              points={c.polygon.map((p) => fit.toViewBox([p[0]!, p[1]!])).map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")}
              fill={c.kind === "existing_building" ? "#D9D6CF" : "#8A8F98"}
              fillOpacity={c.kind === "existing_building" ? 0.7 : 0.9}
              stroke="#6B7280"
              strokeWidth={1}
            />
          ))}
          {/* Rooms as read-only context */}
          {fit.rooms.map((r) => {
            const cx = r.pts.reduce((s, p) => s + p[0], 0) / r.pts.length;
            const cy = r.pts.reduce((s, p) => s + p[1], 0) / r.pts.length;
            return (
              <g key={r.id} pointerEvents="none">
                <polygon
                  points={r.pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")}
                  fill={BONE}
                  fillOpacity={0.35}
                  stroke={INK_900}
                  strokeOpacity={0.5}
                  strokeWidth={1}
                />
                <text x={cx} y={cy} textAnchor="middle" fontSize="12" fill={INK_500} style={{ fontFamily: "var(--font-inter), sans-serif" }}>
                  {r.name_en}
                </text>
              </g>
            );
          })}

          {/* Fixtures */}
          {layerFixtures.map((f) => {
            const [vx, vy] = fit.toViewBox(f.position);
            const selected = selectedId === f.id;
            return (
              <g
                key={f.id}
                style={{ cursor: readOnly ? "default" : "grab" }}
                onPointerDown={readOnly ? undefined : (e) => onFixturePointerDown(e, f)}
              >
                <circle
                  cx={vx}
                  cy={vy}
                  r={13}
                  fill="#FFFFFF"
                  fillOpacity={f.site_reference && f.disposition === "remove" ? 0.4 : 1}
                  stroke={selected || f.site_reference ? BRASS : INK_900}
                  strokeDasharray={f.site_reference ? "3 2" : undefined}
                  strokeWidth={selected ? 2.5 : 1.5}
                />
                <text
                  x={vx}
                  y={vy + 4}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight={600}
                  fill={INK_900}
                  pointerEvents="none"
                  style={{ fontFamily: "var(--font-inter), sans-serif" }}
                >
                  {FIXTURE_META[f.type].code}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <p className="text-xs text-ink-500">
        {loading
          ? "Loading fixtures…"
          : error
            ? `Error: ${error}`
            : readOnly
              ? `${layerFixtures.length} ${layer} fixtures (view-only). Edit them on the plan step.`
              : `${layerFixtures.length} ${layer} fixtures. Drag to move, pick a type above and click to add, select and Delete to remove. Rule-seeded defaults are editable.`}
      </p>
    </div>
  );
}

/** G5: the selected item's size (landscape units, trees) or fitting (garden lights). */
function FixtureInspector({ f, readOnly, onSpec }: { f: Fixture; readOnly: boolean; onSpec: (spec: Record<string, unknown>) => void }) {
  const spec = (f.spec ?? {}) as Record<string, unknown>;
  const name = typeof spec.name === "string" ? spec.name : FIXTURE_META[f.type].label;
  const sizeKeys: [string, string][] =
    f.type === "tree" ? [["height_mm", "H"], ["canopy_mm", "Canopy"]] : f.type === "planter_box" || f.type === "wall_feature" ? [["width_mm", "W"], ["depth_mm", "D"], ["height_mm", "H"]] : [];
  const [draft, setDraft] = useState<Record<string, number>>(() => Object.fromEntries(sizeKeys.map(([k]) => [k, Number(spec[k] ?? 0)])));
  const isLight = f.type === "garden_light";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-ink-100 bg-canvas px-md py-sm text-[12px] text-ink-700">
      <span className="font-semibold text-ink-900">{name}</span>
      {sizeKeys.map(([k, label]) => (
        <label key={k} className="flex items-center gap-1">
          <span className="text-ink-500">{label}</span>
          <input type="number" step={50} disabled={readOnly} value={draft[k] ?? 0} onChange={(e) => setDraft({ ...draft, [k]: Number(e.target.value) })} className="focus-ring w-[72px] rounded border border-ink-100 bg-paper px-1.5 py-0.5 text-right font-mono tabular-nums" />
        </label>
      ))}
      {sizeKeys.length > 0 && !readOnly && (
        <button type="button" onClick={() => onSpec({ ...spec, ...draft, assumed: false })} className="focus-ring rounded border border-ink-100 bg-paper px-2 py-0.5 font-medium text-ink-900 hover:bg-surface-container">
          Set size (mm)
        </button>
      )}
      {isLight && (
        <label className="flex items-center gap-1">
          <span className="text-ink-500">Fitting</span>
          <select disabled={readOnly} value={String(spec.fitting ?? "spike")} onChange={(e) => onSpec({ ...spec, fitting: e.target.value, source: "as_designed" })} className="focus-ring rounded border border-ink-100 bg-paper px-1.5 py-0.5">
            {LIGHT_FITTINGS.map((x) => (
              <option key={x} value={x}>{x}</option>
            ))}
          </select>
        </label>
      )}
      {spec.assumed === true && <span className="rounded-full bg-[#FEF3C7] px-2 py-0.5 font-medium text-[#92400E]">Size assumed</span>}
      {f.dims_derived && <span className="rounded-full bg-[#FEF3C7] px-2 py-0.5 font-medium text-[#92400E]">Position approximate</span>}
      {f.site_reference && <span className="rounded-full border border-brass-600 px-2 py-0.5 font-medium text-brass-600">Existing · {f.disposition ?? "undecided"}</span>}
    </div>
  );
}
