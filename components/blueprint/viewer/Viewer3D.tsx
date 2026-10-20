"use client";

/* eslint-disable react-hooks/immutability -- react-three-fiber is imperative:
   mutating the three.js camera / renderer / refs inside useFrame/useEffect is
   the correct pattern, not a render-phase side effect. */

// =============================================================================
// components/blueprint/viewer/Viewer3D.tsx — the 3D view (K8 #9, spec §6.8,
// Figma 62:1017). The P3 walkthrough, unchanged in what it does and moved onto
// Blueprint (it was components/viewer/Villa3D.tsx).
//
// HARD CONSTRAINT (Way Forward): view-only. Orbit, walk, measure, inspect,
// section. There are NO transform gizmos, drag handles or geometry mutation
// anywhere in this file. Editing lives in the 2D plan.
//
// The canvas draws with the TOKENS, read at runtime from the Blueprint root
// (and re-read when the theme changes): raised volumes, a sunken ground, ink
// edges; brass only for lines — the selection and the measure. The clay model
// is the default; "Show chosen finishes" lays the StyleBoard finishes on when
// the deployment has them (TEXTURED_WALKTHROUGH). Room labels are buttons, so
// a room can be inspected from the keyboard.
// =============================================================================

import { Edges, Html, OrbitControls, PointerLockControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Component, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import * as THREE from "three";

import type { FinishPlan, MaterialSpecInput, SurfaceFinish } from "@/lib/viewer/materials";
import { materialCacheKey, surfaceMaterialSpec } from "@/lib/viewer/materials";
import { roomTarget, wallTarget, type InspectBoq, type InspectTarget, type RoomMeta, type WallMeta } from "@/lib/viewer/inspect";
import type { RoomFacts } from "@/lib/viewer/room-facts";
import type { SceneModel, WallSegment } from "@/lib/viewer/scene";
import { applyMetricUVs, disposeTextures, familyTexture, repeatMetres } from "@/lib/viewer/textures";

import { Button } from "../Button";
import { Icon } from "../Icon";
import { TopBarActions } from "../shell/TopBar";
import { noSubscribe, readStep } from "../shell/step-memory";
import { StateBlock } from "../StateBlock";
import { ViewerInspector } from "./ViewerInspector";

export interface ViewerData {
  projectId: string;
  boq: InspectBoq;
  rooms: RoomMeta[];
  walls: WallMeta[];
  facts: RoomFacts[];
}

type Mode = "orbit" | "walk";
type Selection = { kind: "room"; id: string } | { kind: "wall"; id: string } | null;
const EYE_H = 1.6;
const BODY_R = 0.3; // collision radius
/** The section tool cuts the model at sill height — a plan cut. */
const SECTION_CUT_M = 1.2;

// ---------------------------------------------------------------- tokens
interface Tokens {
  raised: string;
  sunken: string;
  ink: string;
  hairline: string;
  brass: string;
}
const TOKEN_VARS: Record<keyof Tokens, string> = {
  raised: "--color-surface-raised",
  sunken: "--color-surface-sunken",
  ink: "--color-ink-primary",
  hairline: "--color-line-hairline",
  brass: "--color-active-brass",
};
/** "" until the Blueprint root's tokens can be read — the canvas waits for them (no colour of its own). */
function readTokens(): string {
  const root = document.querySelector("[data-system='blueprint']");
  if (!root) return "";
  const cs = getComputedStyle(root);
  const vals = Object.values(TOKEN_VARS).map((v) => cs.getPropertyValue(v).trim());
  return vals.every(Boolean) ? vals.join("|") : "";
}
function subscribeTheme(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", cb);
  return () => {
    mo.disconnect();
    mq.removeEventListener("change", cb);
  };
}
/** C5 #4: can this browser draw WebGL at all? Read once — a browser with it off gets a sentence, not a crash. */
let webglCache: boolean | null = null;
function hasWebGL(): boolean {
  if (webglCache === null) {
    try {
      const c = document.createElement("canvas");
      webglCache = !!(c.getContext("webgl2") ?? c.getContext("webgl"));
    } catch {
      webglCache = false;
    }
  }
  return webglCache;
}
function useWebGL(): boolean {
  return useSyncExternalStore(noSubscribe, hasWebGL, () => true);
}

function useTokens(): Tokens | null {
  const raw = useSyncExternalStore(subscribeTheme, readTokens, () => "");
  return useMemo(() => {
    if (!raw) return null;
    const [raised, sunken, ink, hairline, brass] = raw.split("|") as [string, string, string, string, string];
    return { raised, sunken, ink, hairline, brass };
  }, [raw]);
}

// Never blank/crash: if anything in the 3D subtree throws, say so.
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.error("[Viewer3D] 3D scene error:", err);
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="flex h-full items-center justify-center p-8">
          <StateBlock kind="error" title="The 3D view couldn’t load in this browser">
            Your plan, cost and drawings are unaffected.
          </StateBlock>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------- materials
/**
 * Materials are SHARED between meshes and keyed on appearance, so two rooms
 * with the same finish share one material and nothing is mutated per mesh.
 * No surface glows: on Blueprint a selection is drawn as a brass LINE (the
 * edges), never as a fill.
 */
function useMaterialCache(textured: boolean) {
  const cacheRef = useRef(new Map<string, THREE.MeshStandardMaterial>());
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
      function material(input: Omit<MaterialSpecInput, "quality" | "highlight">): THREE.MeshStandardMaterial {
        const spec = surfaceMaterialSpec({ ...input, highlight: "none", quality: textured ? "textured" : "flat" });
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
          // The clay model reads as raised paper with ink edges (62:1017): most of
          // its tone is its own, the lights only model the faces a little.
          ...(textured ? {} : { emissive: new THREE.Color(spec.color), emissiveIntensity: 0.72 }),
        });
        if (spec.textureFamily) {
          const tex = familyTexture(spec.textureFamily);
          if (tex) mat.map = tex;
        }
        cacheRef.current.set(key, mat);
        return mat;
      },
    [textured],
  );
}

interface PickProps {
  onPick: (s: Selection, p: THREE.Vector3) => void;
  onHover: (on: boolean) => void;
  selection: Selection;
  tokens: Tokens;
  finishes?: FinishPlan;
}

function Floors({ scene, finishes, onPick, onHover, selection, tokens }: { scene: SceneModel } & PickProps) {
  const material = useMaterialCache(!!finishes);
  const meshes = useMemo(
    () =>
      scene.floors.map((f) => {
        const shape = new THREE.Shape();
        f.points.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x, -z) : shape.lineTo(x, -z)));
        shape.closePath();
        return { key: f.id, roomId: f.roomId, shape, elevation: f.elevation, finish: finishes?.floorByRoom[f.roomId] ?? null };
      }),
    [scene, finishes],
  );
  return (
    <group>
      {meshes.map((m) => {
        const on = selection?.kind === "room" && selection.id === m.roomId;
        return (
          <mesh
            key={m.key}
            material={material({ finish: m.finish, clayColor: tokens.raised, kind: "floor" })}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, m.elevation, 0]}
            onClick={(e) => {
              e.stopPropagation();
              onPick({ kind: "room", id: m.roomId }, e.point);
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              onHover(true);
            }}
            onPointerOut={() => onHover(false)}
          >
            {/* Geometry as a child so react-three-fiber owns its lifecycle (a
                memoised geometry disposed from an effect freed live buffers
                under StrictMode's double-invoke). */}
            <shapeGeometry
              args={[m.shape]}
              onUpdate={(g: THREE.ShapeGeometry) => {
                if (m.finish) applyMetricUVs(g, repeatMetres(m.finish.family));
              }}
            />
            <Edges threshold={15} color={on ? tokens.brass : tokens.ink} lineWidth={on ? 2 : 1} />
          </mesh>
        );
      })}
    </group>
  );
}

function Walls({ scene, finishes, onPick, onHover, selection, tokens }: { scene: SceneModel } & PickProps) {
  const material = useMaterialCache(!!finishes);
  const boxes = useMemo(
    () =>
      scene.walls.map((w) => {
        const posFin = w.roomPos ? (finishes?.wallByRoom[w.roomPos] ?? null) : null;
        const negFin = w.roomNeg ? (finishes?.wallByRoom[w.roomNeg] ?? null) : null;
        return { w, posFin, negFin, fam: posFin?.family ?? negFin?.family ?? null };
      }),
    [scene, finishes],
  );
  return (
    <group>
      {boxes.map(({ w, posFin, negFin, fam }) => {
        const baseId = w.id.split(":")[0]!; // split walls (openings) share a base id
        const on = selection?.kind === "wall" && selection.id === baseId;
        // Opaque: the volumes read as raised paper (the inspector says walls come from the room outlines).
        const ends = material({ finish: null, clayColor: tokens.raised, kind: "wall" });
        const face = (finish: SurfaceFinish | null) => material({ finish, clayColor: tokens.raised, kind: "wall" });
        // BoxGeometry groups: +X, -X, +Y, -Y, +Z, -Z — the two large faces take the finish of the room on that side.
        return (
          <mesh
            key={w.id}
            material={[ends, ends, ends, ends, face(posFin), face(negFin)]}
            position={w.center}
            rotation={[0, w.rotationY, 0]}
            onClick={(e) => {
              e.stopPropagation();
              onPick({ kind: "wall", id: baseId }, e.point);
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              onHover(true);
            }}
            onPointerOut={() => onHover(false)}
          >
            <boxGeometry
              args={w.size}
              onUpdate={(g: THREE.BoxGeometry) => {
                if (fam) applyMetricUVs(g, repeatMetres(fam));
              }}
            />
            <Edges threshold={15} color={on ? tokens.brass : tokens.ink} lineWidth={on ? 2 : 1} />
          </mesh>
        );
      })}
    </group>
  );
}

function Ground({ scene, tokens }: { scene: SceneModel; tokens: Tokens }) {
  const size = Math.max(scene.bounds.size[0], scene.bounds.size[1]) * 6;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial color={tokens.sunken} />
    </mesh>
  );
}

function RoomLabels({ scene, selection, onSelect }: { scene: SceneModel; selection: Selection; onSelect: (roomId: string) => void }) {
  // DOM labels via drei <Html> (no font worker): real buttons, so a room can be
  // reached and inspected from the keyboard.
  return (
    <group>
      {scene.labels.map((l) => {
        const on = selection?.kind === "room" && selection.id === l.roomId;
        return (
          <Html key={l.roomId} position={[l.center[0], 0.05, l.center[1]]} center zIndexRange={[10, 0]}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => onSelect(l.roomId)}
              className={`t-label-md whitespace-nowrap border px-1.5 py-0.5 font-bp-mono ${on ? "border-bp-ink-primary bg-bp-ink-primary text-bp-ink-on-inverse" : "border-bp-line-hairline bg-bp-surface-raised text-bp-ink-primary hover:border-bp-line-strong"}`}
            >
              {l.name} · {Math.round(l.area_m2)} m²
            </button>
          </Html>
        );
      })}
    </group>
  );
}

function Measurement({ points, tokens }: { points: THREE.Vector3[]; tokens: Tokens }) {
  if (points.length === 0) return null;
  const a = points[0]!;
  const b = points[1];
  return (
    <group>
      {points.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.05, 16, 16]} />
          <meshBasicMaterial color={tokens.brass} />
        </mesh>
      ))}
      {b && (
        <>
          <line>
            <bufferGeometry
              ref={(g) => {
                if (g) g.setFromPoints([a, b]);
              }}
            />
            <lineBasicMaterial color={tokens.brass} />
          </line>
          <Html position={a.clone().add(b).multiplyScalar(0.5)} center>
            <div className="t-num-sm whitespace-nowrap bg-bp-ink-primary px-2 py-0.5 text-bp-ink-on-inverse" data-measure>
              {a.distanceTo(b).toFixed(2)} m
            </div>
          </Html>
        </>
      )}
    </group>
  );
}

/** The section tool: a renderer-wide clipping plane at sill height. */
function SectionCut({ on }: { on: boolean }) {
  const { gl } = useThree();
  useEffect(() => {
    gl.clippingPlanes = on ? [new THREE.Plane(new THREE.Vector3(0, -1, 0), SECTION_CUT_M)] : [];
    return () => {
      gl.clippingPlanes = [];
    };
  }, [gl, on]);
  return null;
}

// ---------------------------------------------------------------- walk + orbit
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

function WalkControls({ scene, onLeave }: { scene: SceneModel; onLeave: () => void }) {
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
    const step = new THREE.Vector3().addScaledVector(forward.current, -mz * speed).addScaledVector(right.current, mx * speed);
    // Axis-separated move so a blocked axis still allows sliding along a wall.
    for (const axis of ["x", "z"] as const) {
      const nx = camera.position.x + (axis === "x" ? step.x : 0);
      const nz = camera.position.z + (axis === "z" ? step.z : 0);
      const cx = Math.max(-halfW, Math.min(halfW, nx));
      const cz = Math.max(-halfD, Math.min(halfD, nz));
      const blocked = scene.wallSegments.some((s) => distToSegment(cx, cz, s) < s.thickness / 2 + BODY_R);
      if (!blocked) { camera.position.x = cx; camera.position.z = cz; }
    }
    camera.position.setY(EYE_H);
  });
  // Esc releases the pointer lock — and leaves walk mode, as the hints say.
  return <PointerLockControls onUnlock={onLeave} />;
}

function OrbitRig({ scene }: { scene: SceneModel }) {
  const max = Math.max(scene.bounds.size[0], scene.bounds.size[1]);
  return (
    <OrbitControls makeDefault target={[0, scene.bounds.height / 2, 0]} minDistance={2} maxDistance={max * 2.5} maxPolarAngle={Math.PI / 2 - 0.05} enableDamping />
  );
}

// ---------------------------------------------------------------- toolbar
function Tool({ on, onClick, icon, children, label }: { on: boolean; onClick: () => void; icon: string; children: ReactNode; label?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className={`t-body-sm inline-flex h-9 items-center gap-2 px-3 ${on ? "bg-bp-ink-primary text-bp-ink-on-inverse" : "bg-bp-surface-raised text-bp-ink-primary hover:bg-bp-surface-sunken"}`}
    >
      <Icon name={icon} className="text-[18px]" />
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- main
/** "Back to …": every step of the reader's journey, and the one to use when no step is remembered. */
export interface BackTargets {
  steps: Record<string, { label: string; href: string }>;
  fallback: string;
}

export function Viewer3D({ scene, data, finishes, back }: { scene: SceneModel; data: ViewerData; finishes?: FinishPlan; back: BackTargets }) {
  const tokens = useTokens();
  const webgl = useWebGL();
  const remembered = useSyncExternalStore(noSubscribe, () => readStep(data.projectId), () => null);
  const backTo = (remembered ? back.steps[remembered] : undefined) ?? back.steps[back.fallback];
  const [mode, setMode] = useState<Mode>("orbit");
  const [measure, setMeasure] = useState(false);
  const [section, setSection] = useState(false);
  const [inspectOpen, setInspectOpen] = useState(true);
  const [showFinishes, setShowFinishes] = useState(false);
  const [measurePts, setMeasurePts] = useState<THREE.Vector3[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [hover, setHover] = useState(false);

  const factsById = useMemo(() => new Map(data.facts.map((f) => [f.id, f])), [data.facts]);
  const roomById = useMemo(() => new Map(data.rooms.map((r) => [r.id, r])), [data.rooms]);
  const wallById = useMemo(() => new Map(data.walls.map((w) => [w.id, w])), [data.walls]);

  const select = (s: Selection) => {
    setSelection(s);
    setInspectOpen(true);
  };
  const onPick = (s: Selection, p: THREE.Vector3) => {
    if (measure) {
      setMeasurePts((cur) => (cur.length >= 2 ? [p] : [...cur, p]));
      return;
    }
    select(s);
  };

  let target: InspectTarget | null = null;
  let facts: RoomFacts | null = null;
  if (selection?.kind === "room") {
    const r = roomById.get(selection.id);
    if (r) target = roomTarget(r);
    facts = factsById.get(selection.id) ?? null;
  } else if (selection?.kind === "wall") {
    const w = wallById.get(selection.id);
    if (w) target = wallTarget(w);
  }

  const max = Math.max(scene.bounds.size[0], scene.bounds.size[1]);
  const camStart: [number, number, number] = [max * 0.9, max * 0.8, max * 0.9];

  return (
    <>
    <TopBarActions>
      <span className="t-label-md hidden font-bp-mono text-bp-ink-tertiary md:inline" data-viewer-model>
        {showFinishes && finishes ? "Chosen finishes" : "Clay model"} · from your current plan
      </span>
      {backTo ? (
        <Button kind="secondary" href={backTo.href}>
          Back to {backTo.label.toLowerCase()}
        </Button>
      ) : null}
    </TopBarActions>
    <div className="grid min-h-[calc(100vh-var(--bp-topbar-h))] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px]" data-viewer data-viewer-section={section || undefined}>
      <div className="relative flex min-h-[520px] flex-col bg-bp-surface-sunken">
        <div className="absolute left-6 top-6 z-10 flex flex-wrap gap-3" role="toolbar" aria-label="3D view tools">
          <div className="inline-flex border border-bp-line-control" role="group" aria-label="Camera">
            <Tool on={mode === "orbit"} icon="3d_rotation" onClick={() => { setMode("orbit"); }}>
              Orbit
            </Tool>
            <Tool on={mode === "walk"} icon="directions_walk" onClick={() => { setMode("walk"); setMeasure(false); }}>
              Walk
            </Tool>
          </div>
          <div className="inline-flex divide-x divide-bp-line-hairline border border-bp-line-control" role="group" aria-label="Tools">
            <Tool on={measure} icon="straighten" onClick={() => { setMeasure(!measure); setMeasurePts([]); if (!measure) setMode("orbit"); }}>
              Measure
            </Tool>
            <Tool on={inspectOpen} icon="info" onClick={() => setInspectOpen(!inspectOpen)}>
              Inspect
            </Tool>
            <Tool on={section} icon="layers" onClick={() => setSection(!section)}>
              Section
            </Tool>
          </div>
        </div>

        <div className={`relative min-h-[520px] flex-1 ${hover && !measure ? "cursor-pointer" : measure ? "cursor-crosshair" : ""}`}>
          {!webgl ? (
            <div className="flex h-full items-center justify-center p-8" data-viewer-no-webgl="">
              <StateBlock kind="error" title="This browser can’t draw the 3D view">
                WebGL is turned off or not available here. Your plan, renders and drawings show the same rooms — open the 3D view in another browser to walk them.
              </StateBlock>
            </div>
          ) : !tokens ? (
            <div className="px-6 py-8" data-viewer-waiting="">
              <StateBlock kind="loading" title="Building your plan in 3D" rows={4} columns={3} />
            </div>
          ) : (
          <SceneBoundary>
            <Canvas
              flat
              dpr={[1, 2]}
              camera={{ position: camStart, fov: 45, near: 0.05, far: max * 12 }}
              gl={{ antialias: true, powerPreference: "high-performance" }}
              aria-label="3D model of your plan. Use the room labels to inspect a room."
            >
              <color attach="background" args={[tokens.sunken]} />
              <ambientLight intensity={1.1} />
              <directionalLight position={[max, max * 1.5, max * 0.5]} intensity={0.6} />
              <directionalLight position={[-max, max, -max * 0.5]} intensity={0.2} />
              <Ground scene={scene} tokens={tokens} />
              <Floors scene={scene} finishes={showFinishes ? finishes : undefined} onPick={onPick} onHover={setHover} selection={selection} tokens={tokens} />
              <Walls scene={scene} finishes={showFinishes ? finishes : undefined} onPick={onPick} onHover={setHover} selection={selection} tokens={tokens} />
              <RoomLabels scene={scene} selection={selection} onSelect={(id) => select({ kind: "room", id })} />
              <Measurement points={measurePts} tokens={tokens} />
              <SectionCut on={section} />
              {mode === "orbit" ? <OrbitRig scene={scene} /> : <WalkControls scene={scene} onLeave={() => setMode("orbit")} />}
            </Canvas>
          </SceneBoundary>
          )}
        </div>

        <div className="z-10 flex flex-col gap-2 px-6 pb-5">
          {finishes ? (
            <label className="t-body-sm inline-flex w-fit items-center gap-2.5 border border-bp-line-control bg-bp-surface-raised px-3 py-2 text-bp-ink-primary">
              <input
                type="checkbox"
                checked={showFinishes}
                onChange={(e) => setShowFinishes(e.target.checked)}
                className="size-4 rounded-none accent-[var(--color-ink-primary)]"
              />
              Show chosen finishes
            </label>
          ) : null}
          <p className="t-label-md font-bp-mono text-bp-ink-tertiary" aria-live="polite">
            {measure
              ? measurePts.length === 2
                ? `${measurePts[0]!.distanceTo(measurePts[1]!).toFixed(2)} m measured · click again to start a new measure`
                : "Click two points to measure"
              : mode === "walk"
                ? "Click the model to walk · W A S D or arrows to move · Esc leaves walk mode"
                : "Drag to orbit · scroll to zoom · W A S D to walk · Esc leaves walk mode"}
          </p>
        </div>
      </div>

      {inspectOpen ? (
        <ViewerInspector
          projectId={data.projectId}
          boq={data.boq}
          target={target}
          facts={facts}
          onClose={() => {
            setSelection(null);
            setInspectOpen(false);
          }}
        />
      ) : null}
    </div>
    </>
  );
}
