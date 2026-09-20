// =============================================================================
// lib/scene/mesh.ts — the garden scene as triangles (G4b).
//
// World frame: X = plan x (east), Y = up, Z = plan y (south), metres, in the
// PlanGraph's metric frame. Pure data, no rendering.
// =============================================================================

export type Vec3 = [number, number, number];

export type MaterialKey =
  | "ground"
  | "paving"
  | "grass"
  | "soil"
  | "plant"
  | "stone"
  | "timber"
  | "metal"
  | "louvre"
  | "wall"
  | "building"
  | "garage"
  | "steps"
  | "grill"
  | "trunk"
  // G5: an existing gazebo's glazed panels, and concrete stepping slabs.
  | "glass"
  | "slab"
  // G5c: an existing steel garden shed (light grey, unlike the dark pergola metal).
  | "shed";

// G5c: "fixture" — a light fitting or tap. Small, never on the gate's list; it is
// in the scene so a view can be shown to SEE it (the parity gate).
export type ObjectCategory = "surface" | "structure" | "context" | "planting" | "fixture";

export interface SceneObject {
  id: number;
  /** Stable key, e.g. "zone:z-lawn-back", "run:r-counter-bbq", "ctx:c-villa". */
  key: string;
  label: string;
  category: ObjectCategory;
  /** What the gate calls it: "pergola", "counter", "planter box"… */
  noun: string;
  /** Plan zone this object stands in, when there is one. */
  zoneId: string | null;
}

export interface Tri {
  a: Vec3;
  b: Vec3;
  c: Vec3;
  mat: MaterialKey;
  obj: number;
}

export interface LightPoint {
  pos: Vec3;
  /** Relative glow radius in metres. */
  radius: number;
  kind: "uplight" | "spike" | "strip" | "wall" | "downlight";
}

export interface Scene {
  tris: Tri[];
  objects: SceneObject[];
  lights: LightPoint[];
  bounds: { min: Vec3; max: Vec3 };
}

export class SceneBuilder {
  tris: Tri[] = [];
  objects: SceneObject[] = [];
  lights: LightPoint[] = [];

  object(o: Omit<SceneObject, "id">): number {
    const id = this.objects.length + 1;
    this.objects.push({ ...o, id });
    return id;
  }

  tri(a: Vec3, b: Vec3, c: Vec3, mat: MaterialKey, obj: number): void {
    this.tris.push({ a, b, c, mat, obj });
  }

  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, mat: MaterialKey, obj: number): void {
    this.tri(a, b, c, mat, obj);
    this.tri(a, c, d, mat, obj);
  }

  /** Axis-aligned box. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: MaterialKey, obj: number): void {
    const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)];
    const [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
    const [az, bz] = [Math.min(z0, z1), Math.max(z0, z1)];
    if (bx - ax < 1e-6 || by - ay < 1e-6 || bz - az < 1e-6) return;
    const p = (x: number, y: number, z: number): Vec3 => [x, y, z];
    this.quad(p(ax, by, az), p(bx, by, az), p(bx, by, bz), p(ax, by, bz), mat, obj); // top
    this.quad(p(ax, ay, bz), p(bx, ay, bz), p(bx, ay, az), p(ax, ay, az), mat, obj); // bottom
    this.quad(p(ax, ay, bz), p(ax, by, bz), p(bx, by, bz), p(bx, ay, bz), mat, obj); // south
    this.quad(p(bx, ay, az), p(bx, by, az), p(ax, by, az), p(ax, ay, az), mat, obj); // north
    this.quad(p(bx, ay, bz), p(bx, by, bz), p(bx, by, az), p(bx, ay, az), mat, obj); // east
    this.quad(p(ax, ay, az), p(ax, by, az), p(ax, by, bz), p(ax, ay, bz), mat, obj); // west
  }

  /** A box along a plan segment: band [o0, o1] metres to the right of travel. */
  bandBox(a: [number, number], b: [number, number], o0: number, o1: number, y0: number, y1: number, mat: MaterialKey, obj: number, extend = 0): void {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) return;
    const d: [number, number] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const n: [number, number] = [-d[1], d[0]];
    const A: [number, number] = [a[0] - d[0] * extend, a[1] - d[1] * extend];
    const B: [number, number] = [b[0] + d[0] * extend, b[1] + d[1] * extend];
    const corners: [number, number][] = [
      [A[0] + n[0] * o0, A[1] + n[1] * o0],
      [B[0] + n[0] * o0, B[1] + n[1] * o0],
      [B[0] + n[0] * o1, B[1] + n[1] * o1],
      [A[0] + n[0] * o1, A[1] + n[1] * o1],
    ];
    this.prism(corners, y0, y1, mat, obj);
  }

  /** Extrude a simple plan polygon (x, z) between heights. */
  prism(poly: readonly [number, number][], y0: number, y1: number, mat: MaterialKey, obj: number, sideMat: MaterialKey = mat): void {
    if (poly.length < 3 || y1 - y0 < 1e-6) return;
    const ring = signedArea(poly) < 0 ? [...poly].reverse() : [...poly];
    for (const [i, j, k] of earcut(ring)) {
      const p = ring[i]!, q = ring[j]!, r = ring[k]!;
      this.tri([p[0], y1, p[1]], [r[0], y1, r[1]], [q[0], y1, q[1]], mat, obj);
    }
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]!;
      const q = ring[(i + 1) % ring.length]!;
      this.quad([p[0], y0, p[1]], [p[0], y1, p[1]], [q[0], y1, q[1]], [q[0], y0, q[1]], sideMat, obj);
    }
  }

  build(): Scene {
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const t of this.tris) {
      for (const v of [t.a, t.b, t.c]) {
        for (let i = 0; i < 3; i++) {
          if (v[i]! < min[i]!) min[i] = v[i]!;
          if (v[i]! > max[i]!) max[i] = v[i]!;
        }
      }
    }
    return { tris: this.tris, objects: this.objects, lights: this.lights, bounds: { min, max } };
  }
}

export function signedArea(poly: readonly [number, number][]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i]!;
    const [x2, y2] = poly[(i + 1) % poly.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Ear-clipping triangulation of a simple, counter-clockwise polygon. */
export function earcut(poly: readonly [number, number][]): [number, number, number][] {
  const idx = poly.map((_, i) => i);
  const out: [number, number, number][] = [];
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const inside = (p: [number, number], a: [number, number], b: [number, number], c: [number, number]) =>
    cross(a, b, p) >= -1e-12 && cross(b, c, p) >= -1e-12 && cross(c, a, p) >= -1e-12;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10_000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length]!;
      const i1 = idx[i]!;
      const i2 = idx[(i + 1) % idx.length]!;
      const a = poly[i0]!, b = poly[i1]!, c = poly[i2]!;
      if (cross(a, b, c) <= 1e-12) continue; // reflex or degenerate
      let ear = true;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        const p = poly[j]!;
        if ((p[0] === a[0] && p[1] === a[1]) || (p[0] === b[0] && p[1] === b[1]) || (p[0] === c[0] && p[1] === c[1])) continue;
        if (inside(p, a, b, c)) {
          ear = false;
          break;
        }
      }
      if (!ear) continue;
      out.push([i0, i1, i2]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // Degenerate remainder (collinear points): drop a vertex and carry on.
      idx.splice(0, 1);
    }
  }
  if (idx.length === 3) out.push([idx[0]!, idx[1]!, idx[2]!]);
  return out;
}
