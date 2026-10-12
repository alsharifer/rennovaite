"use client";

// =============================================================================
// app/dev/villa-orbit/_components/villa-orbit.tsx — the sign-in page's design
// view, drawn once to be captured (K6, R7 §3.9a, Figma 35:1152).
//
// A FICTIONAL demo villa — never a client project: a two-storey massing on a
// walled plot, a terrace with a louvred pergola and two benches, a planter
// run along the front — in the hidden-line clay look (graphite faces, light
// hairline edges, a faint ground grid) on the dark surface. The camera makes a
// slow, seamless 10 s ping-pong orbit. scripts/k6-capture-villa.mjs records it
// with MediaRecorder (WebM + MP4) and takes the poster at t = 0; the sign-in
// page plays the files — there is NO live WebGL on the sign-in page.
// =============================================================================

import { useEffect, useRef } from "react";
import * as THREE from "three";

const BG = 0x0b0d0f;
const FACE = 0x16191c;
const EDGE = 0xd9d6cf;
const GRID = 0x3a3f44;
export const ORBIT_SECONDS = 10;

function box(group: THREE.Group, w: number, h: number, d: number, x: number, y: number, z: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: FACE, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
  mesh.position.set(x, y + h / 2, z);
  group.add(mesh);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: EDGE, transparent: true, opacity: 0.85 }));
  edges.position.copy(mesh.position);
  group.add(edges);
}

function villa(): THREE.Group {
  const v = new THREE.Group();
  // Plot 30 × 22 m; the house sits back-left, the terrace front-right.
  box(v, 30, 0.05, 22, 0, 0, 0); // plot slab
  box(v, 30, 1.6, 0.2, 0, 0, -11); // boundary walls (back, left)
  box(v, 0.2, 1.6, 22, -15, 0, 0);
  box(v, 14, 3.4, 11, -5, 0, -4); // ground floor
  box(v, 10, 3.2, 8, -6.5, 3.4, -5); // first floor
  box(v, 10.4, 0.4, 0.2, -6.5, 6.6, -1); // parapet
  box(v, 9, 0.15, 8, 6.5, 0, 2.5); // terrace
  // Pergola: four posts and louvres.
  for (const [px, pz] of [[4, 0], [9.5, 0], [4, 5], [9.5, 5]] as const) box(v, 0.15, 2.8, 0.15, px, 0.15, pz);
  for (let i = 0; i < 14; i++) box(v, 5.7, 0.08, 0.12, 6.75, 2.95, 0 + i * 0.38);
  box(v, 2.4, 0.45, 0.7, 5.3, 0.15, 3.6); // benches
  box(v, 0.7, 0.45, 2.4, 9.0, 0.15, 2.2);
  box(v, 9, 0.5, 0.8, -5, 0, 7.5); // planter run along the front
  return v;
}

function grid(): THREE.LineSegments {
  const pts: number[] = [];
  for (let i = -24; i <= 24; i++) {
    pts.push(i, 0, -24, i, 0, 24, -24, 0, i, 24, 0, i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: GRID, transparent: true, opacity: 0.55 }));
}

declare global {
  interface Window {
    __villaOrbit?: { frame: (t: number) => void; canvas: HTMLCanvasElement; ready: boolean };
  }
}

export function VillaOrbit({ width, height }: { width: number; height: number }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height);
    renderer.setClearColor(BG, 1);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(grid());
    scene.add(villa());
    // Axonometric: an orthographic camera high on the diagonal.
    const aspect = width / height;
    const span = 19;
    const camera = new THREE.OrthographicCamera(-span * aspect, span * aspect, span, -span, 0.1, 400);
    const frame = (t: number) => {
      // A slow, seamless ping-pong around the villa: ±14° over ORBIT_SECONDS.
      const a = THREE.MathUtils.degToRad(40 + 14 * Math.sin((2 * Math.PI * t) / ORBIT_SECONDS));
      camera.position.set(Math.cos(a) * 60, 42, Math.sin(a) * 60);
      camera.lookAt(-1.5, 1.5, 0);
      renderer.render(scene, camera);
    };
    frame(0);
    window.__villaOrbit = { frame, canvas: renderer.domElement, ready: true };
    let raf = 0;
    const t0 = performance.now();
    const loop = () => {
      frame((performance.now() - t0) / 1000);
      raf = requestAnimationFrame(loop);
    };
    if (!new URLSearchParams(window.location.search).has("still")) raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      renderer.dispose();
      el.removeChild(renderer.domElement);
      delete window.__villaOrbit;
    };
  }, [width, height]);
  return <div ref={host} style={{ width, height }} data-villa-orbit />;
}
