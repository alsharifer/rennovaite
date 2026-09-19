// =============================================================================
// lib/scene-render/prompts.ts — pure pieces of the plan-faithful pipeline (G4b).
//
// Prompts, the cache key and the manifest's plain-language description. No
// network, no DB: unit-tested, including the rule that a cache key can never be
// shared by two projects, however alike their gardens are.
// =============================================================================

import { createHash } from "node:crypto";

import type { GardenStyle } from "@/lib/garden-styles";
import type { Scene } from "@/lib/scene/mesh";
import type { CameraManifest } from "@/lib/scene/cameras";

import { gateChecks, placementLandmarks } from "./gate";

/** Bump when the pipeline changes what a render is conditioned on. */
// g5-1: narrow-plot cameras (elevated corridor views, clean-view check).
// g5c-1: textured conditioning image, shared design specification + anchor render,
//        in-plot cameras and an aerial view, every zone attempted.
// g5d-1: built-feature placement — the gate locates every built feature and holds
//        it to the scene (missing / moved / duplicated / swapped), and the restyle
//        is told the left-to-right order of built features and landmark walls.
// g5d-2: placement boxes normalised (pixel replies had failed correct renders).
export const SCENE_PIPELINE_VERSION = "g5d-2";

export type SceneView = "day" | "evening";

export const PRIMARY_MODEL = "google/nano-banana-pro";

/** Stable hash of the scene geometry and objects (what the camera looks at). */
export function sceneHash(scene: Scene): string {
  const h = createHash("sha256");
  for (const t of scene.tris) {
    h.update(`${t.mat}|${t.obj}|${t.a.map((v) => v.toFixed(4)).join(",")}|${t.b.map((v) => v.toFixed(4)).join(",")}|${t.c.map((v) => v.toFixed(4)).join(",")};`);
  }
  for (const o of scene.objects) h.update(`${o.id}:${o.key}:${o.noun};`);
  for (const l of scene.lights) h.update(`${l.kind}:${l.pos.map((v) => v.toFixed(3)).join(",")};`);
  return h.digest("hex");
}

/**
 * The render cache key. The PROJECT is the first component on purpose: two
 * projects with identical gardens and same-named zones produce identical
 * scenes, cameras and prompts, and must still never share an image.
 */
export function sceneCacheKey(parts: { projectId: string; cameraId: string; view: SceneView; sceneHash: string; styleKey: string; camera: { pos: number[]; target: number[]; fovDeg: number }; specHash?: string; anchorId?: string | null }): string {
  if (!parts.projectId) throw new Error("sceneCacheKey: projectId is required");
  return createHash("sha256")
    .update(
      JSON.stringify([
        parts.projectId,
        SCENE_PIPELINE_VERSION,
        parts.cameraId,
        parts.view,
        parts.sceneHash,
        parts.styleKey,
        parts.camera.pos.map((v) => v.toFixed(3)),
        parts.camera.target.map((v) => v.toFixed(3)),
        parts.camera.fovDeg,
        // G5c: what every view shares — the design specification and the anchor render.
        ...(parts.specHash ? [parts.specHash, parts.anchorId ?? null] : []),
      ]),
    )
    .digest("hex");
}

/**
 * Every attempt died before producing an image — no credit, an outage. That is
 * an infrastructure fault, not a render that failed the gate, and it must never
 * be saved (and cached) as a substitution.
 */
export function isInfrastructureFailure(attempts: readonly { image_url: string }[]): boolean {
  return attempts.length > 0 && attempts.every((a) => !a.image_url);
}

/**
 * May this camera/view spend a render attempt? G5c: every day view is attempted
 * — a pack whose zone pages are flat design views is not client-viable, and the
 * textured conditioning image plus in-plot cameras give every zone a paintable
 * view. The camera's clean-view verdict still ranks cameras and is reported. An
 * evening still needs a passed day render to relight.
 */
export function shouldAttemptRender(_cam: { clean?: boolean }, view: SceneView, hasPassedDay: boolean): boolean {
  return view === "day" || hasPassedDay;
}

/**
 * A cached evening that shipped as the 3D night view WITHOUT any attempt did so
 * only because no day render had passed. Once one has, it is not a verdict any
 * more and is re-rendered. An evening that was attempted and failed stands.
 */
export function isStaleEveningSubstitution(view: SceneView, cachedAttempts: readonly unknown[], passedDayExists: boolean): boolean {
  return view === "evening" && cachedAttempts.length === 0 && passedDayExists;
}

const region =(b: [number, number, number, number]) => `${b[0]}–${b[2]}% across, ${b[1]}–${b[3]}% down`;

function styleLine(style: GardenStyle): string {
  return `${style.name_en}: ${style.one_line} ${style.what_changes.join(" ")}`;
}

function keepLine(m: CameraManifest): string {
  const checks = gateChecks(m);
  const structures = checks.filter((c) => c.category === "structure");
  const context = checks.filter((c) => c.category === "context");
  const kept = checks.filter((c) => c.category === "planting");
  const parts: string[] = [];
  if (kept.length) parts.push(`the existing trees the client is keeping — ${kept.map((c) => `${c.noun.replace(/^existing | \(kept\)$/g, "")} (${region(c.box)})`).join("; ")}`);
  if (structures.length) parts.push(`built elements — ${structures.map((c) => `the ${c.noun} (${region(c.box)})`).join("; ")}`);
  if (context.length) parts.push(`${[...new Set(context.map((c) => c.noun))].join(", ")}`);
  const keep = parts.length ? `Keep exactly as modelled, same position, shape, size and height: ${parts.join("; ")}; plus every step and level.` : "Keep every wall, step and level exactly as modelled.";
  return [keep, arrangementLine(m)].filter(Boolean).join(" ");
}

/**
 * G5d: the arrangement, stated. Built features and landmark walls, left to right
 * as the scene projects them, each exactly once — the restyle drifted and invented
 * placement (a bench on the other side of the separator wall, a second counter)
 * when all it had was "keep as modelled".
 */
export function arrangementLine(m: CameraManifest): string {
  const built = gateChecks(m).filter((c) => c.category === "structure");
  if (built.length === 0) return "";
  const items = [...built, ...placementLandmarks(m)].sort((a, b) => a.box[0] + a.box[2] - (b.box[0] + b.box[2]));
  const order = items.map((c) => `the ${c.noun}`).join(", then ");
  const counts = new Map<string, number>();
  for (const c of built) counts.set(c.noun, (counts.get(c.noun) ?? 0) + 1);
  const once = [...counts.entries()].map(([n, k]) => `${k === 1 ? "one" : k} ${n}`).join(", ");
  return `The built arrangement is fixed by the plan: from left to right in the frame, ${order}. The picture shows exactly ${once} — never a second copy, never moved to another side, never mirrored.`;
}

/**
 * Attempt 1: restyle the design model into a photograph. The style arrives as
 * TEXT only — calibration showed a style image pulls composition and surfaces
 * towards itself (reframed views, lawns paved to match the art).
 */
export interface DayPromptOptions {
  /** G5c: the project's design specification (lib/scene-render/design-spec.ts). */
  spec?: string;
  /** G5c: IMAGE 2 is a passed render of another view of the same garden. */
  anchor?: boolean;
}

export function dayPrompt(m: CameraManifest, style: GardenStyle, opts: DayPromptOptions = {}): string {
  return [
    opts.spec
      ? "IMAGE 1 is a textured 3D design model of a real garden: every surface already shows its material at true scale. Turn it into a photorealistic photograph of that exact garden."
      : "This image is a 3D design model of a real garden. Turn it into a photorealistic photograph of that exact garden.",
    FRAMING,
    keepLine(m),
    surfaceLine(m),
    "Existing buildings in the model (plain pale volumes) stay buildings of the same size and position: render them as plain rendered villa walls, never as sky.",
    "Do not add, remove, move or resize any structure, wall, step or level. Do not add a pergola, canopy, pool, wall, bench, planter or steps that are not in the model. Only paint materials, planting, sky and daylight.",
    opts.spec ?? "",
    opts.anchor
      ? "IMAGE 2 is a finished photograph of ANOTHER part of this same garden. Match its pergola design, paving material and colour, wall finish and planting palette exactly. Take nothing of its layout, camera or composition: the layout is IMAGE 1's."
      : "",
    // With a design specification the style sets the mood only: its sentences name
    // features (corten planters, sandstone) the design may not have.
    opts.spec ? `Mood — ${style.name_en}: ${style.one_line}` : `Style — ${styleLine(style)} Apply the style to materials and planting only.`,
  ]
    .filter(Boolean)
    .join(" ");
}

function surfaceLine(m: CameraManifest): string {
  const surfaces = gateChecks(m)
    .filter((c) => c.category === "surface")
    .map((c) => `${c.noun} at ${region(c.box)}`);
  return surfaces.length ? `Every surface stays what it is in the model — ${surfaces.join("; ")}. Green in the model is lawn and stays lawn; do not pave it.` : "";
}

const FRAMING =
  "Keep the model's exact camera position, lens and horizon: every edge of the frame shows the same things as the model — no wider, tighter or re-centred framing.";

/** Attempt 2: the same, with what the gate found wrong. */
export function tightenedDayPrompt(m: CameraManifest, style: GardenStyle, failures: string[], opts: DayPromptOptions = {}): string {
  return [
    dayPrompt(m, style, opts),
    failures.length ? `A previous attempt was rejected for: ${failures.map((f) => f.replace(/^[SFC]\d+ /, "")).join("; ")}. Correct exactly these.` : "",
    "If in doubt, change less: a plainer photograph that matches the model beats a richer one that does not.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Evening: relight a passed day render; IMAGE 2 marks the designed lights. */
export function eveningScenePrompt(m: CameraManifest, lights: string): string {
  return [
    "IMAGE 1 is a photograph of a garden by day. Relight this exact photograph as a night scene at late blue hour, well after sunset.",
    "Remove all daylight: deep indigo-to-navy sky with no sun, no sunlit highlights and no sun shadows; the whole image about three stops darker.",
    `The only light is the garden's designed lighting${lights ? ` — ${lights}` : ""}, as warm 2700 K pools and wall washes. IMAGE 2 is the design model at night: its warm glows mark where those lights are. Put light only there.`,
    keepLine(m),
    "Change nothing else: same camera, same structures, same materials and planting. Add no light fittings that are not marked.",
  ].join(" ");
}
