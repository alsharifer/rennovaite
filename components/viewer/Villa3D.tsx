"use client";

/* eslint-disable react-hooks/immutability -- react-three-fiber is imperative:
   mutating the three.js camera / refs inside useFrame/useEffect every frame is
   the correct pattern, not a render-phase side effect. */

// =============================================================================
// components/viewer/Villa3D.tsx — view-only 3D walkthrough (Prompt P3).
//
// HARD CONSTRAINT (Way Forward): view-only. Orbit, walk, measure, inspect.
// There are NO transform gizmos, drag handles, or geometry mutation anywhere in
// this file. Editing lives in the 2D plan (P1/P2).
// =============================================================================

import { Edges, Html, PointerLockControls, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";

import type { SceneModel, WallSegment } from "@/lib/viewer/scene";
import { WALL_WHITE } from "@/lib/viewer/scene";
import type { FinishPlan, Highlight, MaterialSpecInput, Quality, SurfaceFinish } from "@/lib/viewer/materials";
import { materialCacheKey, surfaceMaterialSpec } from "@/lib/viewer/materials";
import { applyMetricUVs, disposeTextures, familyTexture, repeatMetres } from "@/lib/viewer/textures";
import {
  floorTarget,
  wallTarget,
  type InspectBoq,
  type InspectTarget,
  type RoomMeta,
  type WallMeta,
} from "@/lib/viewer/inspect";

import { InspectPanel } from "./InspectPanel";

export interface InspectData {
  projectId: string;
  boq: InspectBoq;
  rooms: RoomMeta[];
  walls: WallMeta[];
}

export interface RoomRenders {
  roomId: string;
  roomName: string;
  latestUrl: string;
  latestKind: "still" | "pano" | string;
  gallery: { id: string; url: string }[];
}

type Mode = "orbit" | "walk";
const EYE_H = 1.6;
const BODY_R = 0.3; // collision radius
const BRASS = "#A4793A";

// Never blank/crash: if anything in the 3D subtree throws, show a message.
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.error("[Villa3D] 3D scene error:", err);
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="flex h-full w-full items-center justify-center rounded-xl border border-ink-100 bg-canvas p-8 text-center">
          <p className="max-w-[420px] font-body text-body-md text-on-surface-variant">
            The 3D view couldn&apos;t load in this browser. Your plan and drawings are
            unaffected.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

// -------------------------------------------------------------- geometry
type ElementKind = "floor" | "wall";

interface PickProps {
  onElement: (kind: ElementKind, id: string, p: THREE.Vector3) => void;
  onHover: (id: string | null) => void;
  selectedId: string | null;
  hoveredId: string | null;
}

export type { Quality } from "@/lib/viewer/materials";

/**
 * Materials are SHARED between meshes, and the highlight state is part of the
 * cache key rather than mutated onto a material at render time.
 *
 * That detail is the whole design. A villa is dozens of wall boxes: giving each
 * its own material means dozens of uploads of the same texture and no batching,
 * but mutating one shared material to glow would light up every surface that
 * happens to share the finish. Keying on appearance — family, colour, highlight
 * — keeps both properties: two bathrooms with the same tile share one material,
 * and selecting one wall lights only that wall.
 *
 * Tiling lives in the vertex UVs (applyMetricUVs), so a family needs exactly
 * one texture however many surfaces use it.
 */
function useMaterialCache(quality: Quality) {
  const cacheRef = useRef(new Map<string, THREE.MeshStandardMaterial>());

  // Quality is part of the cache KEY rather than something an effect
  // invalidates. Disposing on a [quality] change would free materials the
  // current render has already handed to meshes; keying instead means the two
  // quality settings simply coexist, and the set stays small either way.
  useEffect(() => {
    const map = cacheRef.current;
    return () => {
      for (const m of map.values()) m.dispose();
      map.clear();
      disposeTextures();
    };
  }, []);

  return useMemo(
    () =>
      function material(input: Omit<MaterialSpecInput, "quality">): THREE.MeshStandardMaterial {
        // Every visible value comes from surfaceMaterialSpec, which is pure and
        // unit-tested. Nothing about how a surface looks is decided here.
        const spec = surfaceMaterialSpec({ ...input, quality });
        const key = materialCacheKey(spec);
        const hit = cacheRef.current.get(key);
        if (hit) return hit;

        const mat = new THREE.MeshStandardMaterial({
          color: spec.color,
          roughness: spec.roughness,
          metalness: 0,
          side: spec.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
          transparent: spec.transparent,
          opacity: spec.opacity,
          emissive: new THREE.Color(BRASS),
          emissiveIntensity: spec.emissiveIntensity,
        });
        if (spec.textureFamily) {
          const tex = familyTexture(spec.textureFamily);
          if (tex) mat.map = tex;
        }
        cacheRef.current.set(key, mat);
        return mat;
      },
    [quality],
  );
}

function hl(selected: boolean, hovered: boolean): Highlight {
  return selected ? "selected" : hovered ? "hover" : "none";
}

function Floors({
  scene,
  finishes,
  quality,
  onElement,
  onHover,
  selectedId,
  hoveredId,
}: { scene: SceneModel; finishes?: FinishPlan; quality: Quality } & PickProps) {
  const material = useMaterialCache(quality);
  const meshes = useMemo(
    () =>
      scene.floors.map((f) => {
        const shape = new THREE.Shape();
        f.points.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x, -z) : shape.lineTo(x, -z)));
        shape.closePath();
        return { key: f.roomId, shape, color: f.color, finish: finishes?.floorByRoom[f.roomId] ?? null };
      }),
    [scene, finishes],
  );

  return (
    <group>
      {meshes.map((m) => (
        <mesh
          key={m.key}
          material={material({
            finish: m.finish,
            clayColor: m.color,
            kind: "floor",
            highlight: hl(m.key === selectedId, m.key === hoveredId),
          })}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0, 0]}
          onClick={(e) => { e.stopPropagation(); onElement("floor", m.key, e.point); }}
          onPointerOver={(e) => { e.stopPropagation(); onHover(m.key); }}
          onPointerOut={() => onHover(null)}
        >
          {/* Geometry is declared as a child so react-three-fiber owns its
              lifecycle. Building it in a useMemo and disposing it from an
              effect looked tidier but freed live GPU buffers under React
              StrictMode's double-invoke, and the villa rendered blank.
              ShapeGeometry lies in XY before the -90 degree X rotation, so its
              normal is +Z and applyMetricUVs reads x/y — which become world
              x/z. */}
          <shapeGeometry
            args={[m.shape]}
            onUpdate={(g: THREE.ShapeGeometry) => {
              if (m.finish) applyMetricUVs(g, repeatMetres(m.finish.family));
            }}
          />
        </mesh>
      ))}
    </group>
  );
}

function Walls({
  scene,
  finishes,
  quality,
  onElement,
  onHover,
  selectedId,
  hoveredId,
}: { scene: SceneModel; finishes?: FinishPlan; quality: Quality } & PickProps) {
  const material = useMaterialCache(quality);

  const boxes = useMemo(
    () =>
      scene.walls.map((w) => {
        const posFin = w.roomPos ? finishes?.wallByRoom[w.roomPos] ?? null : null;
        const negFin = w.roomNeg ? finishes?.wallByRoom[w.roomNeg] ?? null : null;
        // One UV set serves both faces; scale it to whichever side is finished
        // (they are usually the same family) so grout stays square.
        const fam = posFin?.family ?? negFin?.family ?? null;
        return { w, posFin, negFin, fam };
      }),
    [scene, finishes],
  );

  return (
    <group>
      {boxes.map(({ w, posFin, negFin, fam }) => {
        const baseId = w.id.split(":")[0]!; // split walls (openings) share a base id
        const on = baseId === selectedId;
        const hov = baseId === hoveredId;
        const h = hl(on, hov);
        // BoxGeometry group order: +X, -X, +Y, -Y, +Z, -Z. The two large faces
        // are +Z / -Z and take the finish of the room on THAT side, so a
        // bathroom/bedroom party wall is tiled on the bathroom face only.
        const ends = material({ finish: null, clayColor: WALL_WHITE, kind: "wall", highlight: h, derived: w.derived });
        const face = (finish: SurfaceFinish | null) =>
          material({ finish, clayColor: WALL_WHITE, kind: "wall", highlight: h, derived: w.derived });
        const mats = [ends, ends, ends, ends, face(posFin), face(negFin)];
        return (
          <mesh
            key={w.id}
            material={mats}
            position={w.center}
            rotation={[0, w.rotationY, 0]}
            castShadow={false}
            onClick={(e) => { e.stopPropagation(); onElement("wall", baseId, e.point); }}
            onPointerOver={(e) => { e.stopPropagation(); onHover(baseId); }}
            onPointerOut={() => onHover(null)}
          >
            <boxGeometry
              args={w.size}
              onUpdate={(g: THREE.BoxGeometry) => {
                if (fam) applyMetricUVs(g, repeatMetres(fam));
              }}
            />
            {(w.derived || on) && <Edges threshold={15} color={on ? BRASS : "#CBD5E1"} />}
          </mesh>
        );
      })}
    </group>
  );
}

function RoomAreaLabels({ scene }: { scene: SceneModel }) {
  // DOM labels via drei <Html> — no external font/worker (troika <Text> is a
  // common R3F crash under bundlers). distanceFactor scales them with distance.
  return (
    <group>
      {scene.labels.map((l) => (
        <Html
          key={l.roomId}
          position={[l.center[0], 0.05, l.center[1]]}
          center
          distanceFactor={14}
          zIndexRange={[10, 0]}
        >
          <div className="pointer-events-none whitespace-nowrap rounded bg-paper/85 px-1.5 py-0.5 font-mono text-[11px] text-ink-900 shadow-hairline">
            {l.name} · {Math.round(l.area_m2)} m²
          </div>
        </Html>
      ))}
    </group>
  );
}

// -------------------------------------------------------------- render anchors
function RenderAnchors({
  scene,
  renders,
  onOpen,
}: {
  scene: SceneModel;
  renders: RoomRenders[];
  onOpen: (r: RoomRenders) => void;
}) {
  const byRoom = useMemo(() => new Map(renders.map((r) => [r.roomId, r])), [renders]);
  return (
    <group>
      {scene.labels.map((l) => {
        const rr = byRoom.get(l.roomId);
        if (!rr) return null;
        return (
          <mesh
            key={l.roomId}
            position={[l.center[0], 1.4, l.center[1]]}
            onClick={(e) => { e.stopPropagation(); onOpen(rr); }}
            onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; }}
            onPointerOut={() => { document.body.style.cursor = "auto"; }}
          >
            <sphereGeometry args={[0.16, 24, 24]} />
            <meshStandardMaterial color={BRASS} roughness={0.35} metalness={0.6} emissive={BRASS} emissiveIntensity={0.15} />
          </mesh>
        );
      })}
    </group>
  );
}

// -------------------------------------------------------------- measurement
function Measurement({ points }: { points: THREE.Vector3[] }) {
  if (points.length === 0) return null;
  const a = points[0]!;
  const b = points[1];
  return (
    <group>
      {points.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.06, 16, 16]} />
          <meshBasicMaterial color={BRASS} />
        </mesh>
      ))}
      {b && (
        <>
          {/* Native three line (avoids three-stdlib Line2 fragility). */}
          <line>
            <bufferGeometry
              ref={(g) => {
                if (g) g.setFromPoints([a, b]);
              }}
            />
            <lineBasicMaterial color={BRASS} />
          </line>
          <Html position={a.clone().add(b).multiplyScalar(0.5)} center>
            <div className="rounded bg-ink-900 px-2 py-0.5 font-mono text-[12px] text-paper shadow-level-1">
              {a.distanceTo(b).toFixed(2)} m
            </div>
          </Html>
        </>
      )}
    </group>
  );
}

// -------------------------------------------------------------- walk controls
const KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};

function distToSegment(px: number, pz: number, s: WallSegment): number {
  const [ax, az] = s.a;
  const [bx, bz] = s.b;
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz || 1e-9;
  let t = ((px - ax) * dx + (pz - az) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function WalkControls({ scene }: { scene: SceneModel }) {
  const { camera } = useThree();
  const keys = useRef<Set<string>>(new Set());
  const halfW = scene.bounds.size[0] / 2 - BODY_R;
  const halfD = scene.bounds.size[1] / 2 - BODY_R;

  useEffect(() => {
    camera.position.setY(EYE_H);
    const down = (e: KeyboardEvent) => { if (KEYS[e.code]) keys.current.add(e.code); };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [camera]);

  const forward = useRef(new THREE.Vector3());
  const right = useRef(new THREE.Vector3());
  useFrame((_, dt) => {
    let mx = 0, mz = 0;
    for (const code of keys.current) { const k = KEYS[code]; if (k) { mx += k[0]; mz += k[1]; } }
    if (mx === 0 && mz === 0) { camera.position.setY(EYE_H); return; }
    camera.getWorldDirection(forward.current);
    forward.current.y = 0; forward.current.normalize();
    right.current.crossVectors(forward.current, camera.up).normalize();
    const speed = 2.4 * Math.min(dt, 0.05);
    const step = new THREE.Vector3()
      .addScaledVector(forward.current, -mz * speed)
      .addScaledVector(right.current, mx * speed);
    // Axis-separated move so a blocked axis still allows sliding along a wall.
    for (const axis of ["x", "z"] as const) {
      const nx = camera.position.x + (axis === "x" ? step.x : 0);
      const nz = camera.position.z + (axis === "z" ? step.z : 0);
      const clampedX = Math.max(-halfW, Math.min(halfW, nx));
      const clampedZ = Math.max(-halfD, Math.min(halfD, nz));
      const blocked = scene.wallSegments.some(
        (s) => distToSegment(clampedX, clampedZ, s) < s.thickness / 2 + BODY_R,
      );
      if (!blocked) { camera.position.x = clampedX; camera.position.z = clampedZ; }
    }
    camera.position.setY(EYE_H);
  });
  return <PointerLockControls />;
}

// -------------------------------------------------------------- orbit rig
function OrbitRig({ scene }: { scene: SceneModel }) {
  const max = Math.max(scene.bounds.size[0], scene.bounds.size[1]);
  return (
    <OrbitControls
      makeDefault
      target={[0, scene.bounds.height / 2, 0]}
      minDistance={2}
      maxDistance={max * 2.5}
      // Clamp so the camera never dips to/under the floor plane.
      maxPolarAngle={Math.PI / 2 - 0.05}
      enableDamping
    />
  );
}

// -------------------------------------------------------------- main
export function Villa3D({
  scene,
  renders,
  inspect,
  finishes,
}: {
  scene: SceneModel;
  renders: RoomRenders[];
  inspect?: InspectData;
  /** StyleBoard finishes. Undefined = flag off, and the viewer stays clay. */
  finishes?: FinishPlan;
}) {
  const [mode, setMode] = useState<Mode>("orbit");
  // Quality is a per-viewer preference, so it lives in localStorage rather than
  // the URL — it says something about the machine, not about the villa.
  // Lazy initialiser rather than an effect: this component is only ever
  // mounted client-side (ssr:false), so localStorage is available on the first
  // render and there is no hydration mismatch to avoid.
  const [quality, setQuality] = useState<Quality>(() => {
    try {
      return window.localStorage.getItem("rv:viewer-quality") === "flat" ? "flat" : "textured";
    } catch {
      return "textured"; // private mode / blocked storage — the default stands
    }
  });
  const setQualityPersisted = (q: Quality) => {
    setQuality(q);
    try {
      window.localStorage.setItem("rv:viewer-quality", q);
    } catch {
      /* preference simply will not survive the reload */
    }
  };
  const [showAreas, setShowAreas] = useState(true);
  const [measureMode, setMeasureMode] = useState(false);
  const [measurePts, setMeasurePts] = useState<THREE.Vector3[]>([]);
  const [active, setActive] = useState<RoomRenders | null>(null);
  const [target, setTarget] = useState<InspectTarget | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const roomById = useMemo(() => new Map((inspect?.rooms ?? []).map((r) => [r.id, r])), [inspect]);
  const wallById = useMemo(() => new Map((inspect?.walls ?? []).map((w) => [w.id, w])), [inspect]);

  // Click: in measure mode → drop a measurement point; otherwise inspect.
  const onElement = (kind: ElementKind, id: string, p: THREE.Vector3) => {
    if (measureMode) {
      setMeasurePts((cur) => (cur.length >= 2 ? [p] : [...cur, p]));
      return;
    }
    if (!inspect) return;
    if (kind === "floor") {
      const room = roomById.get(id);
      if (room) { setTarget(floorTarget(room)); setSelectedId(id); }
    } else {
      const wall = wallById.get(id);
      if (wall) { setTarget(wallTarget(wall)); setSelectedId(id); }
    }
  };
  const onHover = (id: string | null) => {
    setHoveredId(id);
    if (typeof document !== "undefined") {
      document.body.style.cursor = id && !measureMode && inspect ? "pointer" : "auto";
    }
  };

  const max = Math.max(scene.bounds.size[0], scene.bounds.size[1]);
  const camStart: [number, number, number] = [max * 0.9, max * 0.8, max * 0.9];

  return (
    <div className="relative h-[calc(100vh-9rem)] w-full overflow-hidden rounded-xl border border-ink-100 bg-canvas">
      {/* Controls — top-left */}
      <div className="absolute left-4 top-4 z-10 flex flex-col gap-2">
        <div className="inline-flex gap-0.5 rounded-lg border border-ink-100 bg-paper p-0.5 shadow-level-1">
          {(["orbit", "walk"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setMeasureMode(false); }}
              className={
                "focus-ring inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-body-sm font-semibold capitalize transition-colors " +
                (mode === m ? "bg-brass-600 text-on-primary" : "text-ink-700 hover:bg-surface-container")
              }
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                {m === "orbit" ? "3d_rotation" : "directions_walk"}
              </span>
              {m}
            </button>
          ))}
        </div>
        <div className="inline-flex gap-0.5 rounded-lg border border-ink-100 bg-paper p-0.5 shadow-level-1">
          <button
            type="button"
            title="Measure"
            aria-pressed={measureMode}
            onClick={() => { setMeasureMode((v) => !v); setMeasurePts([]); }}
            className={
              "focus-ring inline-flex size-9 items-center justify-center rounded-md transition-colors " +
              (measureMode ? "bg-brass-600 text-on-primary" : "text-ink-700 hover:bg-surface-container")
            }
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">straighten</span>
          </button>
          <button
            type="button"
            title="Room areas"
            aria-pressed={showAreas}
            onClick={() => setShowAreas((v) => !v)}
            className={
              "focus-ring inline-flex size-9 items-center justify-center rounded-md transition-colors " +
              (showAreas ? "bg-brass-600 text-on-primary" : "text-ink-700 hover:bg-surface-container")
            }
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">square_foot</span>
          </button>
          {finishes && (
            <button
              type="button"
              title={quality === "textured" ? "Materials on — switch to flat colour" : "Flat colour — switch materials on"}
              aria-pressed={quality === "textured"}
              onClick={() => setQualityPersisted(quality === "textured" ? "flat" : "textured")}
              className={
                "focus-ring inline-flex size-9 items-center justify-center rounded-md transition-colors " +
                (quality === "textured" ? "bg-brass-600 text-on-primary" : "text-ink-700 hover:bg-surface-container")
              }
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">texture</span>
            </button>
          )}
        </div>
      </div>

      {/* Hints — bottom-left */}
      <div className="absolute bottom-4 left-4 z-10 font-body-sm text-body-sm text-on-surface-variant">
        {mode === "walk" ? (
          <span className="rounded bg-paper/80 px-2 py-1 shadow-hairline">Click to walk · WASD/arrows · Esc to release</span>
        ) : measureMode ? (
          <span className="rounded bg-paper/80 px-2 py-1 shadow-hairline">Click two points to measure</span>
        ) : null}
      </div>

      <SceneBoundary>
      <Canvas
        shadows={false}
        dpr={[1, 2]}
        camera={{ position: camStart, fov: 55, near: 0.05, far: max * 12 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <color attach="background" args={["#F7F3EC"]} />
        <ambientLight intensity={0.75} />
        <directionalLight position={[max, max * 1.5, max * 0.5]} intensity={1.1} />
        <directionalLight position={[-max, max, -max * 0.5]} intensity={0.3} />

        <Floors finishes={finishes} quality={quality} scene={scene} onElement={onElement} onHover={onHover} selectedId={selectedId} hoveredId={hoveredId} />
        <Walls finishes={finishes} quality={quality} scene={scene} onElement={onElement} onHover={onHover} selectedId={selectedId} hoveredId={hoveredId} />
        {showAreas && <RoomAreaLabels scene={scene} />}
        <RenderAnchors scene={scene} renders={renders} onOpen={setActive} />
        <Measurement points={measurePts} />

        {mode === "orbit" ? <OrbitRig scene={scene} /> : <WalkControls scene={scene} />}
      </Canvas>
      </SceneBoundary>

      {/* Tap-to-inspect panel */}
      {inspect && target && (
        <InspectPanel
          target={target}
          boq={inspect.boq}
          projectId={inspect.projectId}
          onClose={() => { setTarget(null); setSelectedId(null); }}
        />
      )}

      {/* Render overlay — "step into the photoreal view" */}
      {active && <RenderOverlay room={active} onClose={() => setActive(null)} />}
    </div>
  );
}

function RenderOverlay({ room, onClose }: { room: RoomRenders; onClose: () => void }) {
  const isPano = room.latestKind === "pano";
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-ink-900/60 p-8" onClick={onClose}>
      <div className="max-h-full w-full max-w-4xl overflow-hidden rounded-xl bg-paper p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-md flex items-center justify-between">
          <div>
            <p className="label-caps text-ink-500">Renders of this room</p>
            <h3 className="font-display text-headline-md text-ink-900">{room.roomName}</h3>
          </div>
          <button type="button" onClick={onClose} className="focus-ring flex size-9 items-center justify-center rounded text-on-surface-variant hover:text-ink-900" aria-label="Close">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        {/* TODO(P-later): pano generation via render pipeline — when latestKind
            === 'pano' (2:1 equirectangular) render inside an inverted sphere
            instead of this flat frame. For now panos fall back to the frame. */}
        <div className="matte-image">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={room.latestUrl} alt={`${room.roomName} render`} className="max-h-[60vh] w-full rounded-lg object-contain" />
        </div>
        {isPano && (
          <p className="mt-sm font-body-sm text-body-sm text-on-surface-variant">
            360° panorama — immersive sphere view coming soon.
          </p>
        )}
        {room.gallery.length > 1 && (
          <div className="mt-md flex gap-sm overflow-x-auto">
            {room.gallery.map((g) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={g.id} src={g.url} alt="" className="h-16 w-24 shrink-0 rounded border border-ink-100 object-cover" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
