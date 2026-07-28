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
}

export function OverlayEditor({
  projectId,
  rooms,
  layer,
}: {
  projectId: string;
  rooms: RawRoomInput[];
  layer: OverlayLayer;
}) {
  const fit = useMemo(() => fitRooms(rooms), [rooms]);
  const types = layer === "electrical" ? ELECTRICAL_TYPES : PLUMBING_TYPES;

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
    const raw = fit.toRaw(clientToViewBox(e.clientX, e.clientY));
    setFixtures((cur) => cur.map((f) => (f.id === d.id ? { ...f, position: raw } : f)));
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (d.moved) {
      const f = fixtures.find((x) => x.id === d.id);
      if (f) void persistMove({ ...f, position: fit.toRaw(clientToViewBox(e.clientX, e.clientY)) });
    }
  };

  // Click empty canvas: add (if a palette type is armed) or deselect.
  const onSvgPointerDown = async (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.target !== e.currentTarget) return;
    if (!paletteType) {
      setSelectedId(null);
      return;
    }
    const raw = fit.toRaw(clientToViewBox(e.clientX, e.clientY));
    const type = paletteType;
    try {
      const res = await fetch("/api/plan-fixtures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, type, position: raw, room_id: roomAt(fit, raw) }),
      });
      const body = await res.json();
      if (body.fixture) setFixtures((cur) => [...cur, body.fixture as Fixture]);
    } catch {
      /* best-effort */
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
      {/* Palette + delete toolbar */}
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

      <div className="overflow-hidden rounded-xl border border-ink-100 bg-paper">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="block h-auto w-full select-none touch-none"
          role="img"
          aria-label={`${layer} overlay editor`}
          onPointerDown={onSvgPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
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
                style={{ cursor: "grab" }}
                onPointerDown={(e) => onFixturePointerDown(e, f)}
              >
                <circle
                  cx={vx}
                  cy={vy}
                  r={13}
                  fill="#FFFFFF"
                  stroke={selected ? BRASS : INK_900}
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
            : `${layerFixtures.length} ${layer} fixtures. Drag to move, pick a type above and click to add, select and Delete to remove. Rule-seeded defaults are editable.`}
      </p>
    </div>
  );
}
