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

import { gateChecks } from "./gate";

/** Bump when the pipeline changes what a render is conditioned on. */
export const SCENE_PIPELINE_VERSION = "g4b-2";

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
export function sceneCacheKey(parts: { projectId: string; cameraId: string; view: SceneView; sceneHash: string; styleKey: string; camera: { pos: number[]; target: number[]; fovDeg: number } }): string {
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
  const parts: string[] = [];
  if (structures.length) parts.push(`built elements — ${structures.map((c) => `the ${c.noun} (${region(c.box)})`).join("; ")}`);
  if (context.length) parts.push(`${[...new Set(context.map((c) => c.noun))].join(", ")}`);
  return parts.length ? `Keep exactly as modelled, same position, shape, size and height: ${parts.join("; ")}; plus every step and level.` : "Keep every wall, step and level exactly as modelled.";
}

/**
 * Attempt 1: restyle the design model into a photograph. The style arrives as
 * TEXT only — calibration showed a style image pulls composition and surfaces
 * towards itself (reframed views, lawns paved to match the art).
 */
export function dayPrompt(m: CameraManifest, style: GardenStyle): string {
  return [
    "This image is a 3D design model of a real garden. Turn it into a photorealistic photograph of that exact garden.",
    FRAMING,
    keepLine(m),
    surfaceLine(m),
    "Existing buildings in the model (plain pale volumes) stay buildings of the same size and position: render them as plain rendered villa walls, never as sky.",
    "Do not add, remove, move or resize any structure, wall, step or level. Do not add a pergola, canopy, pool, wall, bench, planter or steps that are not in the model. Only paint materials, planting, sky and daylight.",
    `Style — ${styleLine(style)} Apply the style to materials and planting only.`,
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
export function tightenedDayPrompt(m: CameraManifest, style: GardenStyle, failures: string[]): string {
  return [
    dayPrompt(m, style),
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
