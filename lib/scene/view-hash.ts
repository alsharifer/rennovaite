// =============================================================================
// lib/scene/view-hash.ts — is a render still a render of THIS garden? (G5d)
//
// The render cache key carries the whole scene's hash, so any change anywhere —
// a front-garden zone at the far end of the plot — invalidated every view and a
// pack of 30 renders had to be paid for again. That is safe but wasteful, and it
// makes a small amendment expensive enough to discourage making it.
//
// A render is stale only when the VIEW changed. Two conditions, both pure:
//
//   1. the camera's manifest — what the flat design model shows, object by
//      object, with each one's box and share of the frame — is identical to the
//      manifest the render was checked against. Anything that entered, left,
//      moved or resized in view breaks it;
//   2. every object whose geometry changed anywhere in the scene is at least
//      SHADOW_CLEAR_M from the camera, so it cannot have cast a shadow into a
//      frame it does not appear in (the textured model casts sun shadows).
//
// Fail closed: no stored fingerprint, an unknown object, anything short of an
// exact manifest match — re-render. A reused image is recorded as reused, with
// the render it came from, so no pack shows an image nobody can trace.
// =============================================================================

import { createHash } from "node:crypto";

import type { CameraManifest } from "./cameras";
import type { Scene } from "./mesh";

/** How far a changed object must be from the lens to be certain it is not in the picture. */
export const SHADOW_CLEAR_M = 12;

export interface ViewFingerprint {
  /** Object key → hash of its geometry (every triangle, its material). */
  objects: Record<string, string>;
  /** Object key → centroid in world metres. */
  centres: Record<string, [number, number, number]>;
}

export function viewFingerprint(scene: Scene): ViewFingerprint {
  const byId = new Map(scene.objects.map((o) => [o.id, o.key]));
  const tris = new Map<string, string[]>();
  const sums = new Map<string, { x: number; y: number; z: number; n: number }>();
  for (const t of scene.tris) {
    const key = byId.get(t.obj);
    if (!key) continue;
    const line = `${t.mat}|${[t.a, t.b, t.c].map((v) => v.map((n) => n.toFixed(4)).join(",")).join("|")}`;
    (tris.get(key) ?? tris.set(key, []).get(key)!).push(line);
    const s = sums.get(key) ?? { x: 0, y: 0, z: 0, n: 0 };
    for (const v of [t.a, t.b, t.c]) {
      s.x += v[0];
      s.y += v[1];
      s.z += v[2];
      s.n += 1;
    }
    sums.set(key, s);
  }
  const objects: Record<string, string> = {};
  const centres: Record<string, [number, number, number]> = {};
  for (const [key, lines] of tris) {
    objects[key] = createHash("sha256").update(lines.sort().join(";")).digest("hex").slice(0, 16);
    const s = sums.get(key)!;
    centres[key] = [s.x / s.n, s.y / s.n, s.z / s.n];
  }
  // An object with no geometry (a light point) still exists; hash its noun so a
  // renamed or retyped one is a change.
  for (const o of scene.objects) if (!objects[o.key]) objects[o.key] = createHash("sha256").update(`noun:${o.noun}`).digest("hex").slice(0, 16);
  return { objects, centres };
}

/** Manifests are equal when they list the same objects, each at the same box and share. */
export function manifestEquals(a: CameraManifest | null | undefined, b: CameraManifest | null | undefined): boolean {
  if (!a || !b || a.cameraId !== b.cameraId || a.projectId !== b.projectId) return false;
  const key = (m: CameraManifest) => m.items.map((i) => `${i.key}|${i.noun}|${i.share}|${i.box.join(",")}`).sort().join(";");
  return key(a) === key(b) && JSON.stringify(a.counts) === JSON.stringify(b.counts);
}

export interface ReuseInput {
  storedManifest: CameraManifest | null | undefined;
  currentManifest: CameraManifest;
  stored: ViewFingerprint | null | undefined;
  current: ViewFingerprint;
  cameraPos: readonly number[];
  clearM?: number;
}

/**
 * May a render made against `stored` still stand for `current`? Pure; the reasons
 * are recorded on the render row either way.
 */
export function reuseVerdict(input: ReuseInput): { reusable: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.stored || !input.storedManifest) return { reusable: false, reasons: ["no view fingerprint on the earlier render"] };
  if (!manifestEquals(input.storedManifest, input.currentManifest)) return { reusable: false, reasons: ["the camera shows something different"] };
  const clear = input.clearM ?? SHADOW_CLEAR_M;
  const keys = new Set([...Object.keys(input.stored.objects), ...Object.keys(input.current.objects)]);
  const changed: string[] = [];
  for (const k of keys) if (input.stored.objects[k] !== input.current.objects[k]) changed.push(k);
  const visible = new Set(input.currentManifest.items.map((i) => i.key));
  for (const k of changed) {
    if (visible.has(k)) {
      reasons.push(`${k} is in view and changed`);
      continue;
    }
    const c = input.current.centres[k] ?? input.stored.centres?.[k];
    if (!c) {
      reasons.push(`${k} changed and its position is unknown`);
      continue;
    }
    const d = Math.hypot(c[0] - (input.cameraPos[0] ?? 0), c[1] - (input.cameraPos[1] ?? 0), c[2] - (input.cameraPos[2] ?? 0));
    if (d < clear) reasons.push(`${k} changed ${d.toFixed(1)} m from the camera — close enough to light or shadow this frame`);
  }
  return reasons.length ? { reusable: false, reasons } : { reusable: true, reasons: changed.length ? [`${changed.length} object(s) changed, none of them in or near this view`] : ["the scene is unchanged for this camera"] };
}
