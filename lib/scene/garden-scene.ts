// =============================================================================
// lib/scene/garden-scene.ts — the PlanGraph as a 3D garden (G4b).
//
// This scene is the geometry authority for a plan-faithful render: every zone
// at its level, every structure at the height the plan holds, the existing
// villa, garage, steps and boundary walls where they stand. The render model
// is only allowed to paint it.
//
// Nothing here is invented to look nicer. Plant masses in planting beds are
// the one decoration, and they are low, generic and deterministic (seeded by
// the zone id) so the gate never mistakes them for a structure.
// =============================================================================

import { runBand, runSegments } from "@/lib/drawings/garden-elevations";
import { bboxOf, gardenZones, toMetres, type GardenFixture } from "@/lib/drawings/garden-sheets";
import type { PlanGraph, Point } from "@/lib/plan/geometry";
import { isInDesign, type Disposition } from "@/lib/plan/site-reference";

import { SceneBuilder, type MaterialKey, type Scene } from "./mesh";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Deterministic 0..1 sequence from a string seed. */
function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
}

function pointInPolygon(p: Point, poly: readonly Point[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

const SURFACE: Record<string, { mat: MaterialKey; thick: number; noun: string }> = {
  paving: { mat: "paving", thick: 0.02, noun: "paving" },
  path: { mat: "paving", thick: 0.02, noun: "paved path" },
  artificial_grass: { mat: "grass", thick: 0.03, noun: "lawn" },
  planting_bed: { mat: "soil", thick: 0.06, noun: "planting bed" },
  deck: { mat: "timber", thick: 0.05, noun: "deck" },
  structure: { mat: "paving", thick: 0.02, noun: "paving" },
  pool: { mat: "steps", thick: 0.02, noun: "pool" },
};

export interface GardenSceneInput {
  graph: PlanGraph;
  fixtures: readonly GardenFixture[];
  /** plan_elements id → counter variant. */
  variants?: Record<string, string | null>;
}

export function buildGardenScene({ graph: fullGraph, fixtures: allFixtures, variants = {} }: GardenSceneInput): Scene {
  const sb = new SceneBuilder();
  // G5: the scene is the DESIGN. An existing item the design removes is not in
  // it; a kept or undecided one stands where it stands, as what it is.
  const graph: PlanGraph = {
    ...fullGraph,
    rooms: fullGraph.rooms.filter(isInDesign),
    elements: fullGraph.elements.filter(isInDesign),
    context: fullGraph.context.filter(isInDesign),
  };
  const fixtures = allFixtures.filter((f) => isInDesign({ site_reference: f.site_reference ?? false, disposition: f.disposition ?? null }));
  const zones = gardenZones(graph);
  const levelAt = (p: Point): number => {
    const z = zones.find((r) => r.type !== "structure" && pointInPolygon(p, r.polygon)) ?? zones.find((r) => pointInPolygon(p, r.polygon));
    return (z?.level_mm ?? 0) / 1000;
  };
  const zoneIdAt = (p: Point): string | null =>
    (zones.find((r) => r.type !== "structure" && pointInPolygon(p, r.polygon)) ?? zones.find((r) => pointInPolygon(p, r.polygon)))?.id ?? null;

  // Ground: the plot and a margin of neighbouring land.
  const plot = graph.meta.plot;
  const all = bboxOf([...graph.rooms.flatMap((r) => r.polygon), ...graph.context.flatMap((c) => c.polygon)]);
  const g0 = plot ? plot.origin_m : ([all.minX, all.minY] as Point);
  const g1: Point = plot ? [plot.origin_m[0] + plot.width_m, plot.origin_m[1] + plot.depth_m] : [all.maxX, all.maxY];
  const ground = sb.object({ key: "ground", label: "Ground", category: "context", noun: "ground", zoneId: null });
  sb.box(g0[0] - 30, -0.05, g0[1] - 30, g1[0] + 30, -0.001, g1[1] + 30, "ground", ground);

  // G5c: the neighbourhood. Beyond every plot edge that carries a boundary wall
  // stands a neighbouring villa (the client photos show two-storey houses behind
  // each wall). Without them the model looks over the wall at empty land and
  // invents what should be there — gardens, trees, structures. Generic massing,
  // never a claim about the neighbour: a pale two-storey volume set back 3 m.
  if (plot) {
    const walls = graph.context.filter((c) => c.kind === "boundary_wall");
    const edges: { a: Point; b: Point; out: Point }[] = [
      { a: [g0[0], g0[1]], b: [g1[0], g0[1]], out: [0, -1] },
      { a: [g0[0], g1[1]], b: [g1[0], g1[1]], out: [0, 1] },
      { a: [g0[0], g0[1]], b: [g0[0], g1[1]], out: [-1, 0] },
      { a: [g1[0], g0[1]], b: [g1[0], g1[1]], out: [1, 0] },
    ];
    let n = 0;
    for (const e of edges) {
      const alongX = e.out[1] !== 0;
      const len = alongX ? e.b[0] - e.a[0] : e.b[1] - e.a[1];
      // Wall length lying on this edge (within 0.5 m of it).
      let covered = 0;
      for (const w of walls) {
        const wb = bboxOf(w.polygon);
        const onEdge = alongX ? Math.abs((e.out[1] < 0 ? wb.minY : wb.maxY) - e.a[1]) < 0.5 : Math.abs((e.out[0] < 0 ? wb.minX : wb.maxX) - e.a[0]) < 0.5;
        if (onEdge) covered += alongX ? wb.maxX - wb.minX : wb.maxY - wb.minY;
      }
      if (covered < len * 0.3) continue;
      const id = sb.object({ key: `neighbour:${n++}`, label: "neighbouring villa", category: "context", noun: "neighbouring two-storey villas beyond the boundary wall", zoneId: null });
      const set = 3, depth = 11, H = 7.2;
      if (alongX) {
        const y0 = e.out[1] < 0 ? e.a[1] - set - depth : e.a[1] + set;
        sb.box(e.a[0] - 2, 0, y0, e.b[0] + 2, H, y0 + depth, "building", id);
      } else {
        const x0 = e.out[0] < 0 ? e.a[0] - set - depth : e.a[0] + set;
        sb.box(x0, 0, e.a[1] - 2, x0 + depth, H, e.b[1] + 2, "building", id);
      }
    }
  }

  // Zone surfaces at their levels.
  for (const z of zones) {
    const s = SURFACE[z.type ?? ""] ?? SURFACE.paving!;
    const top = (z.level_mm ?? 0) / 1000 + s.thick;
    const id = sb.object({ key: `zone:${z.id}`, label: `${z.name_en}`, category: "surface", noun: s.noun, zoneId: z.id });
    sb.prism(z.polygon.map((p) => [p[0], p[1]] as [number, number]), 0, top, s.mat, id);
    if (z.type === "planting_bed") plantMasses(sb, z.polygon, top, `plants:${z.id}`, z.id);
  }

  // Structure zones (a pergola; G5: or an existing gazebo, drawn as one).
  for (const z of zones.filter((r) => r.type === "structure" && r.height_mm != null)) {
    const spec = (z.spec ?? {}) as Record<string, unknown>;
    const b = bboxOf(z.polygon);
    const lv = (z.level_mm ?? 0) / 1000;
    const H = z.height_mm! / 1000;
    if (spec.form === "gazebo") {
      gazebo(sb, b, lv, H, sb.object({ key: `structure:${z.id}`, label: z.name_en, category: "structure", noun: "gazebo", zoneId: z.id }));
      continue;
    }
    const m = (num(spec.member_mm) ?? 150) / 1000;
    const beam = (num(spec.beam_depth_mm) ?? 150) / 1000;
    // G5: the KIND of pergola is part of the design — a render of shade sails passed
    // a gate that only asked for "a pergola". A louvred one is named as such.
    const louvred = spec.variant === "louvered" || [spec.form, spec.system].some((v) => typeof v === "string" && /louv/i.test(v));
    const id = sb.object({ key: `structure:${z.id}`, label: z.name_en, category: "structure", noun: louvred ? "louvred pergola" : "pergola", zoneId: z.id });
    const posts = (Array.isArray(spec.posts_mm) ? spec.posts_mm : [[0, 0], [(b.maxX - b.minX) * 1000 - 150, 0], [0, (b.maxY - b.minY) * 1000 - 150], [(b.maxX - b.minX) * 1000 - 150, (b.maxY - b.minY) * 1000 - 150]]) as [number, number][];
    for (const [px, pz] of posts) sb.box(b.minX + px / 1000, lv, b.minY + pz / 1000, b.minX + px / 1000 + m, lv + H, b.minY + pz / 1000 + m, "metal", id);
    const bx = (Array.isArray(spec.beams_x_mm) ? spec.beams_x_mm : [0, (b.maxX - b.minX) * 1000 - 150]) as number[];
    const by = (Array.isArray(spec.beams_y_mm) ? spec.beams_y_mm : [0, (b.maxY - b.minY) * 1000 - 150]) as number[];
    for (const off of bx) sb.box(b.minX + off / 1000, lv + H - beam, b.minY, b.minX + off / 1000 + m, lv + H, b.maxY, "metal", id);
    for (const off of by) sb.box(b.minX, lv + H - beam, b.minY + off / 1000, b.maxX, lv + H, b.minY + off / 1000 + m, "metal", id);
    // Louvre blades in each bay, running east–west.
    for (let i = 0; i < by.length - 1; i++) {
      const z0 = b.minY + by[i]! / 1000 + m;
      const z1 = b.minY + by[i + 1]! / 1000;
      for (let zz = z0 + 0.05; zz < z1 - 0.03; zz += 0.12) {
        sb.box(b.minX + m, lv + H - beam + 0.03, zz, b.maxX - m, lv + H - 0.03, zz + 0.07, "louvre", id);
      }
    }
    // Integral downlights: the pergola rate carries eight.
    for (let i = 0; i < 8; i++) {
      const fx = b.minX + ((i % 4) + 0.5) * ((b.maxX - b.minX) / 4);
      const fz = b.minY + (Math.floor(i / 4) + 0.5) * ((b.maxY - b.minY) / 2);
      sb.lights.push({ pos: [fx, lv + H - beam - 0.02, fz], radius: 1.2, kind: "downlight" });
    }
  }

  // Runs.
  for (const el of graph.elements) {
    if (el.kind === "boundary_wall") continue;
    const spec = (el.spec ?? {}) as Record<string, unknown>;
    if (el.kind === "stepping_path") {
      steppingPath(sb, graph, el, levelAt, zoneIdAt);
      continue;
    }
    if (el.kind === "string_light_run") {
      // Festoon lamps along the run: light for the evening view, no geometry a
      // gate could mistake for a structure.
      const segs = runSegments(el);
      const H = el.height_mm / 1000;
      const pitch = 1.0;
      for (const seg of segs) {
        for (let t = pitch / 2; t < seg.len; t += pitch) {
          const p: Point = [seg.a[0] + seg.dir[0] * t, seg.a[1] + seg.dir[1] * t];
          sb.lights.push({ pos: [p[0], levelAt(p) + H - 0.15 * Math.sin((Math.PI * t) / seg.len), p[1]], radius: 0.45, kind: "strip" });
        }
      }
      continue;
    }
    const [o0, o1] = runBand(el);
    const segs = runSegments(el);
    const mid = segs[0] ? ([(segs[0].a[0] + segs[0].b[0]) / 2, (segs[0].a[1] + segs[0].b[1]) / 2] as Point) : ([0, 0] as Point);
    const lv = levelAt(mid);
    const H = el.height_mm / 1000;
    const variant = variants[el.id] ?? null;
    const form = typeof spec.form === "string" ? spec.form : null;
    // G5c: a BBQ counter is priced with its grill and sink (the rate carries them), so
    // the model shows both and the gate checks for them.
    const hasGrillUnit = fixtures.some((u) => u.type === "bbq_grill" && (u.spec as Record<string, unknown> | null)?.on === el.id);
    const noun = el.kind === "counter_run" ? (variant === "bbq" ? (hasGrillUnit ? "BBQ counter with sink" : "BBQ counter with built-in grill and sink") : variant === "bar" ? "bar counter" : form === "sink counter" ? "outdoor sink counter" : "counter") : el.kind === "bench_run" ? "built-in bench" : form === "planter border" ? "planter border" : "raised planter";
    const id = sb.object({ key: `run:${el.id}`, label: noun, category: "structure", noun, zoneId: zoneIdAt(mid) });
    segs.forEach((seg, i) => {
      const ext = 0;
      if (el.kind === "planter_run") {
        const kb = Array.isArray(spec.kerb_band_mm) ? (spec.kerb_band_mm as number[]).map((v) => v / 1000) : [o1 - 0.1, o1];
        sb.bandBox(seg.a, seg.b, kb[0]!, kb[1]!, lv, lv + H, "stone", id, ext);
        sb.bandBox(seg.a, seg.b, o0, kb[0]!, lv, lv + H - 0.08, "soil", id, ext);
        const a0: Point = [seg.a[0] + seg.normal[0] * o0, seg.a[1] + seg.normal[1] * o0];
        const b0: Point = [seg.b[0] + seg.normal[0] * o0, seg.b[1] + seg.normal[1] * o0];
        const b1: Point = [seg.b[0] + seg.normal[0] * kb[0]!, seg.b[1] + seg.normal[1] * kb[0]!];
        const a1: Point = [seg.a[0] + seg.normal[0] * kb[0]!, seg.a[1] + seg.normal[1] * kb[0]!];
        plantMasses(sb, [a0, b0, b1, a1], lv + H - 0.08, `plants:${el.id}:${i}`, null);
      } else if (el.kind === "counter_run") {
        const slab = (num(spec.top_slab_mm) ?? 100) / 1000;
        const support = num(spec.support_mm);
        if (support && !num(spec.cabinet_mm)) {
          const s = support / 1000;
          const len = seg.len;
          const at = (t: number): Point => [seg.a[0] + seg.dir[0] * t, seg.a[1] + seg.dir[1] * t];
          sb.bandBox(seg.a, at(s), o0, o1, lv, lv + H - slab, "stone", id);
          sb.bandBox(at(len - s), seg.b, o0, o1, lv, lv + H - slab, "stone", id);
        } else {
          sb.bandBox(seg.a, seg.b, o0, o1, lv, lv + H - slab, "stone", id);
        }
        sb.bandBox(seg.a, seg.b, o0 - 0.02, o1 + 0.02, lv + H - slab, lv + H, "stone", id, 0.02);
        if (variant === "bbq" && i === 0 && seg.len >= 1.6) {
          // Built-in grill (a dark hood) toward one end, a sink toward the other.
          const at = (t: number, o: number): Point => [seg.a[0] + seg.dir[0] * t + seg.normal[0] * o, seg.a[1] + seg.dir[1] * t + seg.normal[1] * o];
          const oc = (o0 + o1) / 2;
          const top = lv + H;
          if (!hasGrillUnit) {
            const g0 = at(seg.len * 0.22, oc - 0.25), g1 = at(seg.len * 0.22 + 0.75, oc + 0.25);
            sb.box(Math.min(g0[0], g1[0]), top, Math.min(g0[1], g1[1]), Math.max(g0[0], g1[0]), top + 0.22, Math.max(g0[1], g1[1]), "grill", id);
          }
          const s0 = at(seg.len * 0.72, oc - 0.2), s1 = at(seg.len * 0.72 + 0.5, oc + 0.2);
          sb.box(Math.min(s0[0], s1[0]), top - 0.005, Math.min(s0[1], s1[1]), Math.max(s0[0], s1[0]), top + 0.012, Math.max(s0[1], s1[1]), "metal", id);
          const tap = at(seg.len * 0.72 + 0.25, oc + 0.28);
          sb.box(tap[0] - 0.02, top, tap[1] - 0.02, tap[0] + 0.02, top + 0.25, tap[1] + 0.02, "metal", id);
        }
      } else {
        sb.bandBox(seg.a, seg.b, o0, o1, lv, lv + H, "stone", id);
      }
    });
  }

  // Discrete landscape units.
  for (const u of fixtures.filter((f) => f.layer === "landscape")) {
    const s = (u.spec ?? {}) as Record<string, unknown>;
    const p = toMetres(graph, u.position);
    const lv = levelAt(p);
    const zoneId = zoneIdAt(p);
    if (u.type === "shed") {
      // G5c: an existing shed the client keeps stands in every view that sees it.
      const W = (num(s.width_mm) ?? 1500) / 1000;
      const D = (num(s.depth_mm) ?? 1000) / 1000;
      const H = (num(s.height_mm) ?? 2000) / 1000;
      const kept = u.site_reference === true && u.disposition === "keep";
      const id = sb.object({ key: `unit:${u.id}`, label: "garden shed", category: "structure", noun: kept ? "existing grey steel garden shed (kept)" : "garden shed", zoneId });
      sb.box(p[0] - W / 2, lv, p[1] - D / 2, p[0] + W / 2, lv + H - 0.12, p[1] + D / 2, "shed", id);
      sb.box(p[0] - W / 2 - 0.05, lv + H - 0.12, p[1] - D / 2 - 0.05, p[0] + W / 2 + 0.05, lv + H, p[1] + D / 2 + 0.05, "shed", id);
      continue;
    }
    if (u.type === "wall_feature" && num(s.width_mm) && num(s.height_mm)) {
      const W = num(s.width_mm)! / 1000;
      const D = (num(s.depth_mm) ?? 300) / 1000;
      const H = num(s.height_mm)! / 1000;
      const arch = (s.arch ?? {}) as Record<string, number>;
      const bench = (s.bench ?? {}) as Record<string, number>;
      const id = sb.object({ key: `unit:${u.id}`, label: "wall feature with arch", category: "structure", noun: "arched wall feature", zoneId });
      const x0 = p[0] - W / 2;
      const z0 = p[1] - D / 2;
      const z1 = p[1] + D / 2;
      const op = (arch.opening_mm ?? W * 700) / 1000;
      const pier = (W - op) / 2;
      const spring = (arch.spring_mm ?? H * 550) / 1000;
      const crown = (arch.crown_mm ?? H * 900) / 1000;
      sb.box(x0, lv, z0, x0 + pier, lv + H, z1, "stone", id);
      sb.box(x0 + W - pier, lv, z0, x0 + W, lv + H, z1, "stone", id);
      // The spandrel over the arch as a smooth solid: sloped strips whose
      // underside follows the elliptical arch from spring to crown.
      const cols = 48;
      const archAt = (t: number) => {
        const xc = -1 + 2 * t;
        return lv + spring + (crown - spring) * Math.sqrt(Math.max(0, 1 - xc * xc));
      };
      for (let i = 0; i < cols; i++) {
        const t0 = i / cols, t1 = (i + 1) / cols;
        const xa = x0 + pier + op * t0, xb = x0 + pier + op * t1;
        const ya = archAt(t0), yb = archAt(t1);
        const top = lv + H;
        sb.quad([xa, ya, z0], [xb, yb, z0], [xb, top, z0], [xa, top, z0], "stone", id);
        sb.quad([xa, ya, z1], [xa, top, z1], [xb, top, z1], [xb, yb, z1], "stone", id);
        sb.quad([xa, ya, z0], [xa, ya, z1], [xb, yb, z1], [xb, yb, z0], "stone", id);
        sb.quad([xa, top, z0], [xb, top, z0], [xb, top, z1], [xa, top, z1], "stone", id);
      }
      if (bench.top_mm) {
        const bt = bench.top_mm / 1000;
        const bs = (bench.slab_mm ?? 100) / 1000;
        const proj = (bench.projection_mm ?? 275) / 1000;
        // Facing south: the bench projects to +Z.
        sb.box(x0 + pier, lv + bt - bs, z0, x0 + pier + op, lv + bt, z1 + proj, "timber", id);
      }
    } else if (u.type === "planter_box" && num(s.width_mm) && num(s.height_mm)) {
      const W = num(s.width_mm)! / 1000;
      const D = (num(s.depth_mm) ?? num(s.width_mm)!) / 1000;
      const H = num(s.height_mm)! / 1000;
      const t = (num(s.wall_mm) ?? 200) / 1000;
      const id = sb.object({ key: `unit:${u.id}`, label: "planter box", category: "structure", noun: "square planter box", zoneId });
      const [x0, z0, x1, z1] = [p[0] - W / 2, p[1] - D / 2, p[0] + W / 2, p[1] + D / 2];
      sb.box(x0, lv, z0, x1, lv + H, z0 + t, "stone", id);
      sb.box(x0, lv, z1 - t, x1, lv + H, z1, "stone", id);
      sb.box(x0, lv, z0 + t, x0 + t, lv + H, z1 - t, "stone", id);
      sb.box(x1 - t, lv, z0 + t, x1, lv + H, z1 - t, "stone", id);
      sb.box(x0 + t, lv, z0 + t, x1 - t, lv + H - 0.06, z1 - t, "soil", id);
      const tree = sb.object({ key: `plants:${u.id}`, label: "tree in planter", category: "planting", noun: "tree", zoneId });
      sb.box(p[0] - 0.07, lv + H - 0.06, p[1] - 0.07, p[0] + 0.07, lv + H + 1.1, p[1] + 0.07, "trunk", tree);
      canopy(sb, [p[0], lv + H + 1.6, p[1]], 0.75, 0.6, tree);
    } else if (u.type === "tree") {
      const H = (num(s.height_mm) ?? 4000) / 1000;
      const R = (num(s.canopy_mm) ?? 3000) / 2000;
      const palm = String(s.species ?? "").toLowerCase().includes("palm");
      // G5: a tree the client is keeping is a commitment the render must honour, so
      // it is named as one (and the gate checks it); a design tree is just planting.
      const kept = u.site_reference === true && u.disposition === "keep";
      const kind = palm ? "palm tree" : "tree";
      // The species matters to the client who owns it: a frangipani is not a pine.
      const keptKind = !palm && typeof s.species === "string" && s.species.trim() ? `${s.species.trim().toLowerCase()} tree` : kind;
      const tree = sb.object({ key: `plants:${u.id}`, label: kind, category: "planting", noun: kept ? `existing ${keptKind} (kept)` : kind, zoneId });
      const trunk = palm ? 0.14 : 0.1;
      sb.box(p[0] - trunk, lv, p[1] - trunk, p[0] + trunk, lv + H * (palm ? 0.92 : 0.55), p[1] + trunk, "trunk", tree);
      if (palm) canopy(sb, [p[0], lv + H * 0.93, p[1]], R, 0.45, tree);
      else canopy(sb, [p[0], lv + H * 0.7, p[1]], R, H * 0.28, tree);
    } else if (u.type === "bbq_grill") {
      const W = (num(s.width_mm) ?? 700) / 1000;
      const D = (num(s.depth_mm) ?? 500) / 1000;
      const Hg = (num(s.height_mm) ?? 150) / 1000;
      const on = graph.elements.find((e) => e.id === s.on);
      const top = lv + (on ? on.height_mm / 1000 : 0.9);
      let cx = p[0], cz = p[1], alongX = true;
      if (on) {
        const seg = runSegments(on)[0];
        const [o0, o1] = runBand(on);
        if (seg) {
          alongX = Math.abs(seg.dir[0]) > Math.abs(seg.dir[1]);
          const t = Math.max(0, Math.min(seg.len, (p[0] - seg.a[0]) * seg.dir[0] + (p[1] - seg.a[1]) * seg.dir[1]));
          const mid = (o0 + o1) / 2;
          cx = seg.a[0] + seg.dir[0] * t + seg.normal[0] * mid;
          cz = seg.a[1] + seg.dir[1] * t + seg.normal[1] * mid;
        }
      }
      const id = sb.object({ key: `unit:${u.id}`, label: "built-in BBQ grill", category: "structure", noun: "built-in grill", zoneId });
      const [hx, hz] = alongX ? [W / 2, D / 2] : [D / 2, W / 2];
      sb.box(cx - hx, top, cz - hz, cx + hx, top + Hg, cz + hz, "grill", id);
    }
  }

  // Existing context.
  for (const c of graph.context) {
    if (c.height_mm == null) continue;
    const poly = c.polygon.map((p) => [p[0], p[1]] as [number, number]);
    const base = c.base_mm / 1000;
    const top = base + c.height_mm / 1000;
    const noun = c.kind === "existing_building" ? (c.name.toLowerCase().includes("garage") ? "garage" : "villa") : c.kind === "boundary_wall" ? "boundary wall" : c.kind === "steps" ? "steps" : "existing pergola";
    const id = sb.object({ key: `ctx:${c.id}`, label: c.name, category: "context", noun, zoneId: null });
    if (c.kind === "existing_structure") {
      const b = bboxOf(c.polygon);
      const alongZ = b.maxY - b.minY >= b.maxX - b.minX;
      const n = 6;
      for (let i = 0; i < n; i++) {
        if (alongZ) {
          const x = b.minX + (i + 0.5) * ((b.maxX - b.minX) / n);
          sb.box(x - 0.05, top - 0.12, b.minY, x + 0.05, top, b.maxY, "timber", id);
        } else {
          const z = b.minY + (i + 0.5) * ((b.maxY - b.minY) / n);
          sb.box(b.minX, top - 0.12, z - 0.05, b.maxX, top, z + 0.05, "timber", id);
        }
      }
      for (const t of [0.15, 0.85]) {
        if (alongZ) sb.box(b.minX, top - 0.3, b.minY + (b.maxY - b.minY) * t - 0.08, b.maxX, top - 0.12, b.minY + (b.maxY - b.minY) * t + 0.08, "timber", id);
        else sb.box(b.minX + (b.maxX - b.minX) * t - 0.08, top - 0.3, b.minY, b.minX + (b.maxX - b.minX) * t + 0.08, top - 0.12, b.maxY, "timber", id);
      }
    } else {
      const mat: MaterialKey = c.kind === "existing_building" ? (noun === "garage" ? "garage" : "building") : c.kind === "boundary_wall" ? "wall" : "steps";
      sb.prism(poly, base, top, mat, id);
    }
  }

  // G5c: garden gates in context walls — two posts and the leaf, drawn open at 90°
  // toward the plot centre so the view through the opening stays readable.
  for (const o of (graph.openings ?? []).filter((x) => x.type === "gate" && x.position && isInDesign({ site_reference: x.site_reference ?? false, disposition: (x.disposition as Disposition | null) ?? null }))) {
    const wall = graph.context.find((c) => c.id === o.context_id);
    const b = wall ? bboxOf(wall.polygon) : null;
    const alongX = b ? b.maxX - b.minX >= b.maxY - b.minY : true;
    const w = o.width_mm / 1000;
    const H = o.height_mm / 1000;
    const [cx, cz] = o.position!;
    const kept = o.site_reference === true && o.disposition === "keep";
    const id = sb.object({ key: `opening:${o.id}`, label: "garden gate", category: "structure", noun: kept ? "existing garden gate (kept)" : "garden gate", zoneId: null });
    const plot = graph.meta.plot;
    const centre = plot ? [plot.origin_m[0] + plot.width_m / 2, plot.origin_m[1] + plot.depth_m / 2] : [cx, cz];
    const side = alongX ? Math.sign(centre[1]! - cz) || 1 : Math.sign(centre[0]! - cx) || 1;
    const post = 0.08;
    if (alongX) {
      sb.box(cx - w / 2 - post, 0, cz - post / 2, cx - w / 2, H, cz + post / 2, "metal", id);
      sb.box(cx + w / 2, 0, cz - post / 2, cx + w / 2 + post, H, cz + post / 2, "metal", id);
      const z0 = side > 0 ? cz : cz - w;
      sb.box(cx - w / 2, 0.05, z0, cx - w / 2 + 0.04, H - 0.1, z0 + w, "metal", id);
    } else {
      sb.box(cx - post / 2, 0, cz - w / 2 - post, cx + post / 2, H, cz - w / 2, "metal", id);
      sb.box(cx - post / 2, 0, cz + w / 2, cx + post / 2, H, cz + w / 2 + post, "metal", id);
      const x0 = side > 0 ? cx : cx - w;
      sb.box(x0, 0.05, cz - w / 2, x0 + w, H - 0.1, cz - w / 2 + 0.04, "metal", id);
    }
  }

  // G5c: outdoor water taps — a small wall-mounted body with its valve.
  for (const t of fixtures.filter((x) => x.type === "water_tap")) {
    const p = toMetres(graph, t.position);
    const lv = levelAt(p);
    const id = sb.object({ key: `point:${t.id}`, label: "outdoor water tap", category: "fixture", noun: "outdoor water tap", zoneId: zoneIdAt(p) });
    sb.box(p[0] - 0.08, lv + 0.45, p[1] - 0.08, p[0] + 0.08, lv + 0.75, p[1] + 0.08, "metal", id);
  }

  // Designed lighting points (for the evening view).
  for (const f of fixtures.filter((x) => x.type === "garden_light" || x.type === "boundary_light")) {
    const p = toMetres(graph, f.position);
    const lv = levelAt(p);
    const fitting = String((f.spec as Record<string, unknown> | null)?.fitting ?? "").toLowerCase();
    // G5c: the fitting itself, small (spike post, flush disc, wall box).
    const fid = sb.object({ key: `point:${f.id}`, label: f.type === "boundary_light" ? "wall light" : "garden light", category: "fixture", noun: f.type === "boundary_light" ? "wall light" : "garden light", zoneId: zoneIdAt(p) });
    // A wall light sits ON the garden-facing face: placed at the wall centreline it
    // would be buried inside the wall, and no view could show what the BoQ prices.
    const face = ((): Point => {
      if (f.type !== "boundary_light" || !plot) return p;
      const centre: Point = [plot.origin_m[0] + plot.width_m / 2, plot.origin_m[1] + plot.depth_m / 2];
      const d: Point = [centre[0] - p[0], centre[1] - p[1]];
      const len = Math.hypot(d[0], d[1]) || 1;
      const off = 0.16;
      return [p[0] + (d[0] / len) * off, p[1] + (d[1] / len) * off];
    })();
    if (f.type === "boundary_light") sb.box(face[0] - 0.07, 1.5, face[1] - 0.07, face[0] + 0.07, 1.72, face[1] + 0.07, "metal", fid);
    else if (fitting.includes("spike")) sb.box(p[0] - 0.03, lv, p[1] - 0.03, p[0] + 0.03, lv + 0.4, p[1] + 0.03, "metal", fid);
    else sb.box(p[0] - 0.07, lv + 0.02, p[1] - 0.07, p[0] + 0.07, lv + 0.045, p[1] + 0.07, "metal", fid);
    if (f.type === "boundary_light") sb.lights.push({ pos: [face[0], 1.6, face[1]], radius: 1.4, kind: "wall" });
    else if (fitting.includes("strip")) sb.lights.push({ pos: [p[0], lv + 0.08, p[1]], radius: 0.9, kind: "strip" });
    else if (fitting.includes("spike")) sb.lights.push({ pos: [p[0], lv + 0.35, p[1]], radius: 1.0, kind: "spike" });
    else sb.lights.push({ pos: [p[0], lv + 0.03, p[1]], radius: 0.8, kind: "uplight" });
  }

  return sb.build();
}

/** Low plant masses inside a plan polygon — generic, deterministic, never taller than 0.9 m. */
function plantMasses(sb: SceneBuilder, poly: readonly Point[], base: number, seed: string, zoneId: string | null): void {
  const b = bboxOf(poly);
  const area = Math.abs(poly.reduce((s, p, i) => {
    const q = poly[(i + 1) % poly.length]!;
    return s + p[0] * q[1] - q[0] * p[1];
  }, 0)) / 2;
  const id = sb.object({ key: seed, label: "planting", category: "planting", noun: "planting", zoneId });
  const r = rng(seed);
  // G5c: dense enough to read as a planted bed (≈ 5 plants / m²), in three forms.
  const n = Math.min(220, Math.max(3, Math.round(area * 5)));
  let placed = 0;
  for (let tries = 0; placed < n && tries < n * 8; tries++) {
    const p: Point = [b.minX + r() * (b.maxX - b.minX), b.minY + r() * (b.maxY - b.minY)];
    if (!pointInPolygon(p, poly)) continue;
    const kind = r();
    if (kind < 0.55) {
      // Mounded shrub.
      const s = 0.2 + r() * 0.25;
      const h = 0.35 + r() * 0.45;
      canopy(sb, [p[0], base + h / 2, p[1]], s, h / 2, id, "plant");
    } else if (kind < 0.8) {
      // Ornamental grass: a tall narrow tuft.
      const h = 0.6 + r() * 0.5;
      canopy(sb, [p[0], base + h / 2, p[1]], 0.12 + r() * 0.06, h / 2, id, "plant");
    } else {
      // Spiky rosette (agave-like): a low star of blades.
      const len = 0.35 + r() * 0.2;
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + r();
        const tip: [number, number, number] = [p[0] + Math.cos(a) * len, base + 0.3 + r() * 0.2, p[1] + Math.sin(a) * len];
        const w = 0.05;
        sb.tri([p[0] - Math.sin(a) * w, base + 0.02, p[1] + Math.cos(a) * w], tip, [p[0] + Math.sin(a) * w, base + 0.02, p[1] - Math.cos(a) * w], "plant", id);
      }
    }
    placed++;
  }
}

/** An octahedral canopy (reads as foliage mass at render resolution). */
function canopy(sb: SceneBuilder, c: [number, number, number], rxz: number, ry: number, obj: number, mat: MaterialKey = "plant"): void {
  const [x, y, z] = c;
  const top: [number, number, number] = [x, y + ry, z];
  const bot: [number, number, number] = [x, y - ry, z];
  const ring: [number, number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ring.push([x + Math.cos(a) * rxz, y, z + Math.sin(a) * rxz]);
  }
  for (let i = 0; i < 6; i++) {
    const p = ring[i]!, q = ring[(i + 1) % 6]!;
    sb.tri(top, p, q, mat, obj);
    sb.tri(bot, q, p, mat, obj);
  }
}

/**
 * G5: an existing hardtop gazebo — four corner posts, dark glazed panels on three
 * sides with the widest side open, a hipped roof. Read off the client photos; its
 * height is assumed and flagged on the zone, never invented here.
 */
function gazebo(sb: SceneBuilder, b: { minX: number; minY: number; maxX: number; maxY: number }, lv: number, H: number, id: number): void {
  const post = 0.1;
  const eave = lv + H * 0.78;
  const [x0, z0, x1, z1] = [b.minX + 0.1, b.minY + 0.1, b.maxX - 0.1, b.maxY - 0.1];
  for (const [px, pz] of [[x0, z0], [x1 - post, z0], [x0, z1 - post], [x1 - post, z1 - post]] as [number, number][]) {
    sb.box(px, lv, pz, px + post, eave, pz + post, "metal", id);
  }
  // Glazed panels: back (min z) and both ends; the front (max z) stays open.
  sb.box(x0 + post, lv + 0.05, z0, x1 - post, eave - 0.1, z0 + 0.04, "glass", id);
  sb.box(x0, lv + 0.05, z0 + post, x0 + 0.04, eave - 0.1, z1 - post, "glass", id);
  sb.box(x1 - 0.04, lv + 0.05, z0 + post, x1, eave - 0.1, z1 - post, "glass", id);
  // Eave frame and hipped roof.
  sb.box(x0 - 0.15, eave - 0.12, z0 - 0.15, x1 + 0.15, eave, z1 + 0.15, "metal", id);
  const apex: [number, number, number] = [(x0 + x1) / 2, lv + H, (z0 + z1) / 2];
  const e: [number, number, number][] = [[x0 - 0.15, eave, z0 - 0.15], [x1 + 0.15, eave, z0 - 0.15], [x1 + 0.15, eave, z1 + 0.15], [x0 - 0.15, eave, z1 + 0.15]];
  for (let i = 0; i < 4; i++) sb.tri(e[i]!, apex, e[(i + 1) % 4]!, "metal", id);
}

/** G5: concrete slabs set flush in the lawn along a run's centreline. */
function steppingPath(
  sb: SceneBuilder,
  graph: PlanGraph,
  el: PlanGraph["elements"][number],
  levelAt: (p: Point) => number,
  zoneIdAt: (p: Point) => string | null,
): void {
  const spec = (el.spec ?? {}) as Record<string, unknown>;
  const slab = Array.isArray(spec.slab_mm) ? (spec.slab_mm as number[]).map((v) => v / 1000) : [el.width_mm / 1000, 0.5];
  const across = slab[0] ?? 0.6;
  const along = slab[1] ?? 0.5;
  const gap = (num(spec.gap_mm) ?? 150) / 1000;
  const segs = runSegments(el);
  const first = segs[0];
  const mid: Point = first ? [(first.a[0] + first.b[0]) / 2, (first.a[1] + first.b[1]) / 2] : [0, 0];
  const id = sb.object({ key: `run:${el.id}`, label: "stepping-stone path", category: "surface", noun: "stepping-stone path", zoneId: zoneIdAt(mid) });
  void graph;
  for (const seg of segs) {
    for (let t = 0; t + along <= seg.len + 1e-6; t += along + gap) {
      const a: Point = [seg.a[0] + seg.dir[0] * t, seg.a[1] + seg.dir[1] * t];
      const b2: Point = [seg.a[0] + seg.dir[0] * (t + along), seg.a[1] + seg.dir[1] * (t + along)];
      const lv = levelAt(a);
      sb.bandBox(a, b2, -across / 2, across / 2, lv + 0.02, lv + 0.045, "slab", id);
    }
  }
}
