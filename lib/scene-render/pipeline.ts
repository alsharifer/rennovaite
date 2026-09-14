// =============================================================================
// lib/scene-render/pipeline.ts — plan-faithful garden renders (G4b).
//
// For one camera and one view:
//   1. Build the 3D scene from the PlanGraph and render it from the camera. The
//      scene image is the geometry authority; the manifest says what it shows.
//   2. Restyle it with an image-to-image model (nano-banana-pro) — the style
//      direction only paints it.
//   3. Gate the result against the manifest. On failure, re-render ONCE with
//      tightened conditioning (the gate's findings, surface regions, framing).
//   4. Still failing: ship the RAW 3D design view, and say so. An honest design
//      view beats a beautiful lie; no render that has not passed enters a pack.
//
// Text-prompted off-plan generation is retired for gardens: nothing here ever
// asks a model to imagine a layout.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { GardenFixture } from "@/lib/drawings/garden-sheets";
import { gardenStyleFor, getGardenStyle, isGardenStyleKey, type GardenStyle } from "@/lib/garden-styles";
import { derivePlanGraph } from "@/lib/plan/derive";
import type { PlanGraph } from "@/lib/plan/geometry";
import { lightingByZone, type ZoneLight } from "@/lib/render-batch/plan";
import { buildEditInput, getRenderPrediction, createRenderPrediction, extractImageUrl } from "@/lib/render-image";
import { uploadRenderBytes } from "@/lib/render-storage";
import { buildManifest, chooseCameras, RENDER_H, RENDER_W, type CameraManifest, type GardenCamera } from "@/lib/scene/cameras";
import { buildGardenScene } from "@/lib/scene/garden-scene";
import type { Scene } from "@/lib/scene/mesh";
import { encodePng } from "@/lib/scene/png";
import { depthImage, renderScene } from "@/lib/scene/raster";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { runFaithfulnessGate, type GateVerdict, type ImageSource } from "./gate";
import {
  dayPrompt,
  eveningScenePrompt,
  isInfrastructureFailure,
  isStaleEveningSubstitution,
  PRIMARY_MODEL,
  SCENE_PIPELINE_VERSION,
  sceneCacheKey,
  sceneHash,
  shouldAttemptRender,
  tightenedDayPrompt,
  type SceneView,
} from "./prompts";

export interface GardenSceneContext {
  projectId: string;
  graph: PlanGraph;
  fixtures: GardenFixture[];
  variants: Record<string, string | null>;
  scene: Scene;
  cameras: GardenCamera[];
  style: GardenStyle;
  sceneHash: string;
}

export interface AttemptRecord {
  attempt: number;
  model: string;
  image_url: string;
  passed: boolean;
  failures: string[];
  summary: string;
  gate_status: GateVerdict["status"];
}

/**
 * G5: why a 3D design view shipped instead of a styled render.
 *   no_clean_camera — decided from the geometry before any attempt (narrow plot);
 *   no_passed_day   — an evening with no faithful day render to relight;
 *   gate_failed     — every attempt failed the faithfulness gate.
 */
export type DesignViewReason = "no_clean_camera" | "no_passed_day" | "gate_failed";

export interface SceneGateRecord {
  pipeline: string;
  outcome: "passed" | "substituted";
  design_view_reason?: DesignViewReason | null;
  /** The camera's clean-view verdict when it was not clean. */
  camera_reasons?: string[];
  camera: GardenCamera;
  manifest: CameraManifest;
  scene_url: string;
  depth_url: string | null;
  attempts: AttemptRecord[];
  gate_model: string;
}

export interface SceneRenderResult {
  render_id: string;
  image_url: string;
  view: SceneView;
  camera_id: string;
  outcome: "passed" | "substituted";
  design_view_reason?: DesignViewReason | null;
  cached: boolean;
  attempts: AttemptRecord[];
}

const CAMERA_MEMO = new Map<string, GardenCamera[]>();

function db(): SupabaseClient {
  return getSupabaseAdmin() as unknown as SupabaseClient;
}

/** Everything about a project's garden a camera render needs. Read-only. */
export async function loadGardenSceneContext(projectId: string): Promise<GardenSceneContext> {
  const graph = await derivePlanGraph(projectId);
  const sb = db();
  const [fixturesRes, styleRes, variantsRes] = await Promise.all([
    sb.from("plan_fixtures").select("id, layer, type, room_id, position, spec").eq("project_id", projectId),
    sb.from("style_choices").select("style_key").eq("project_id", projectId).is("room_id", null).order("created_at", { ascending: false }).limit(1),
    graph.planId ? sb.from("plan_elements").select("id, variant").eq("plan_id", graph.planId) : Promise.resolve({ data: [] as { id: string; variant: string | null }[] }),
  ]);
  const fixtures = (fixturesRes.data ?? []) as GardenFixture[];
  const variants = Object.fromEntries(((variantsRes.data ?? []) as { id: string; variant: string | null }[]).map((r) => [r.id, r.variant]));
  const key = (styleRes.data?.[0]?.style_key as string | undefined) ?? null;
  if (!key) throw new Error("Pick a style direction before rendering.");
  const style = getGardenStyle(isGardenStyleKey(key) ? key : gardenStyleFor(key))!;
  const scene = buildGardenScene({ graph, fixtures, variants });
  const lit = new Set(
    lightingByZone(
      graph.rooms.map((r) => ({ id: r.id, name_en: r.name_en, room_type: r.type, polygon: r.polygon.map(([x, y]) => [x / (graph.meta.unit_to_m || 1) + graph.meta.norm_origin[0], y / (graph.meta.unit_to_m || 1) + graph.meta.norm_origin[1]]) })),
      fixtures,
    ).keys(),
  );
  // Choosing cameras renders a few hundred probe views; the result is a pure
  // function of the scene and the lit zones, so it is remembered per both.
  const hash = sceneHash(scene);
  const memoKey = `${projectId}|${hash}|${[...lit].sort().join(",")}`;
  let cameras = CAMERA_MEMO.get(memoKey);
  if (!cameras) {
    cameras = chooseCameras(scene, graph, fixtures, lit);
    CAMERA_MEMO.set(memoKey, cameras);
    if (CAMERA_MEMO.size > 32) CAMERA_MEMO.delete(CAMERA_MEMO.keys().next().value!);
  }
  return { projectId, graph, fixtures, variants, scene, cameras, style, sceneHash: hash };
}

/** G5: shared with the photo-pair runner. */
export async function runRenderModel(model: string, input: Record<string, unknown>): Promise<string> {
  return runModel(model, input);
}

export async function fetchSceneBytes(url: string): Promise<Uint8Array> {
  return fetchBytes(url);
}

async function runModel(model: string, input: Record<string, unknown>): Promise<string> {
  const apiKey = process.env.REPLICATE_API_TOKEN;
  if (!apiKey) throw new Error("REPLICATE_API_TOKEN is not configured.");
  // Throttling is not a failed attempt: back off and try again, so a busy
  // account never turns into a substituted render.
  let p: Awaited<ReturnType<typeof createRenderPrediction>> | null = null;
  for (let i = 0; i < 30 && !p; i++) {
    try {
      p = await createRenderPrediction(apiKey, model as never, input);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/429|throttl/i.test(msg)) throw e;
      await new Promise((r) => setTimeout(r, 10_000 + i * 2_000));
    }
  }
  if (!p) throw new Error(`${model} stayed throttled`);
  const t0 = Date.now();
  while (p.status !== "succeeded" && p.status !== "failed" && p.status !== "canceled") {
    if (Date.now() - t0 > 240_000) throw new Error(`${model} timed out`);
    await new Promise((r) => setTimeout(r, 2500));
    p = await getRenderPrediction(apiKey, p.id);
  }
  if (p.status !== "succeeded") throw new Error(`${model} ${p.status}: ${typeof p.error === "string" ? p.error : ""}`);
  return extractImageUrl(p.output);
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
    } catch {
      /* retry */
    }
  }
  throw new Error(`could not fetch ${url}`);
}

const b64 = (bytes: Uint8Array, mediaType: "image/png" | "image/jpeg"): ImageSource => ({ kind: "base64", mediaType, data: Buffer.from(bytes).toString("base64") });
const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8;

function lightsLine(lights: ZoneLight[] | undefined, structure: boolean): string {
  const parts = (lights ?? []).map((l) => `${l.count} × ${l.label.toLowerCase()}`);
  if (structure) parts.unshift("the pergola's integral warm-white downlights");
  return parts.join(", ");
}

/**
 * Render one camera/view through the ladder and persist the result. Returns
 * the cached result when this project already has one for the same key.
 */
export async function renderGardenCamera(ctx: GardenSceneContext, cameraId: string, view: SceneView): Promise<SceneRenderResult> {
  const cam = ctx.cameras.find((c) => c.id === cameraId);
  if (!cam) throw new Error(`Unknown camera '${cameraId}' for this plan.`);
  const sb = db();
  const cacheKey = sceneCacheKey({ projectId: ctx.projectId, cameraId, view, sceneHash: ctx.sceneHash, styleKey: ctx.style.key, camera: cam });

  const { data: cached } = await sb
    .from("renders")
    .select("id, image_url, gate")
    .eq("project_id", ctx.projectId)
    .eq("cache_key", cacheKey)
    .eq("status", "succeeded")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; image_url: string; gate: SceneGateRecord | null }>();
  // An evening shipped as the 3D night view only because no day render had
  // passed yet is not a verdict: once a passed day exists it is re-rendered.
  let staleEvening = false;
  if (cached?.gate && view === "evening" && cached.gate.attempts.length === 0) {
    const dayKey = sceneCacheKey({ projectId: ctx.projectId, cameraId, view: "day", sceneHash: ctx.sceneHash, styleKey: ctx.style.key, camera: cam });
    const { data: passedDay } = await sb
      .from("renders")
      .select("id, gate")
      .eq("project_id", ctx.projectId)
      .eq("cache_key", dayKey)
      .eq("status", "succeeded")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; gate: SceneGateRecord | null }>();
    staleEvening = isStaleEveningSubstitution(view, cached.gate.attempts, passedDay?.gate?.outcome === "passed");
  }
  if (cached?.image_url && cached.gate && !staleEvening) {
    return { render_id: cached.id, image_url: cached.image_url, view, camera_id: cameraId, outcome: cached.gate.outcome, design_view_reason: cached.gate.design_view_reason ?? null, cached: true, attempts: cached.gate.attempts };
  }

  const base = `projects/${ctx.projectId}/scene/${cacheKey.slice(0, 24)}`;
  const day = renderScene(ctx.scene, cam, RENDER_W, RENDER_H, { lighting: "day" });
  const manifest = buildManifest(ctx.projectId, cameraId, ctx.scene, day);
  const dayPng = encodePng(day.rgb, day.width, day.height, 3);
  const dayUrl = await uploadRenderBytes(`${base}-day-model.png`, dayPng, "image/png");
  let designPng = dayPng;
  let designUrl = dayUrl;
  let depthUrl: string | null = null;
  if (view === "day") {
    depthUrl = await uploadRenderBytes(`${base}-depth.png`, encodePng(depthImage(day), day.width, day.height, 1), "image/png");
  } else {
    const night = renderScene(ctx.scene, cam, RENDER_W, RENDER_H, { lighting: "evening" });
    designPng = encodePng(night.rgb, night.width, night.height, 3);
    designUrl = await uploadRenderBytes(`${base}-evening-model.png`, designPng, "image/png");
  }

  const attempts: AttemptRecord[] = [];
  const sceneUri = `data:image/png;base64,${Buffer.from(dayPng).toString("base64")}`;

  // What an evening edits: the passed day render for this camera, if there is one.
  let dayRenderBytes: Uint8Array | null = null;
  if (view === "evening") {
    const dayKey = sceneCacheKey({ projectId: ctx.projectId, cameraId, view: "day", sceneHash: ctx.sceneHash, styleKey: ctx.style.key, camera: cam });
    const { data: dayRow } = await sb
      .from("renders")
      .select("image_url, gate")
      .eq("project_id", ctx.projectId)
      .eq("cache_key", dayKey)
      .eq("status", "succeeded")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ image_url: string; gate: SceneGateRecord | null }>();
    if (dayRow?.gate?.outcome === "passed") dayRenderBytes = await fetchBytes(dayRow.image_url);
  }

  const zoneLights = cam.zoneId
    ? lightingByZone(
        ctx.graph.rooms.map((r) => ({ id: r.id, name_en: r.name_en, room_type: r.type, polygon: r.polygon.map(([x, y]) => [x / (ctx.graph.meta.unit_to_m || 1) + ctx.graph.meta.norm_origin[0], y / (ctx.graph.meta.unit_to_m || 1) + ctx.graph.meta.norm_origin[1]]) })),
        ctx.fixtures,
      ).get(cam.zoneId)
    : undefined;
  const zone = cam.zoneId ? ctx.graph.rooms.find((r) => r.id === cam.zoneId) : undefined;

  let final: { url: string; outcome: "passed" | "substituted"; prompt: string; model: string } | null = null;
  // An evening needs a faithful day to relight; without one it ships the 3D night view.
  // G5: a camera with no clean view never spends a render attempt — the labelled
  // 3D design view is the honest image there, decided from the geometry.
  const canAttempt = shouldAttemptRender(cam, view, dayRenderBytes !== null);
  for (let attempt = 1; canAttempt && attempt <= 2 && !final; attempt++) {
    const failures = attempts.at(-1)?.failures ?? [];
    let prompt: string;
    let images: string[];
    if (view === "day") {
      prompt = attempt === 1 ? dayPrompt(manifest, ctx.style) : tightenedDayPrompt(manifest, ctx.style, failures);
      // Style by TEXT only: a style image pulls composition and surfaces
      // towards itself (calibration: reframed views, lawns paved).
      images = [sceneUri];
    } else {
      const lights = lightsLine(zoneLights, zone?.type === "structure");
      prompt = eveningScenePrompt(manifest, lights) + (attempt === 2 && failures.length ? ` A previous attempt was rejected for: ${failures.join("; ")}. Correct exactly these.` : "");
      images = [`data:image/jpeg;base64,${Buffer.from(dayRenderBytes!).toString("base64")}`, `data:image/png;base64,${Buffer.from(designPng).toString("base64")}`];
    }
    let url: string;
    let bytes: Uint8Array;
    try {
      const out = await runModel(PRIMARY_MODEL, { ...buildEditInput(PRIMARY_MODEL as never, prompt, images), aspect_ratio: "3:2", resolution: "1K", output_format: "jpg" });
      bytes = await fetchBytes(out);
      url = await uploadRenderBytes(`${base}-${view}-attempt${attempt}.${isJpeg(bytes) ? "jpg" : "png"}`, bytes, isJpeg(bytes) ? "image/jpeg" : "image/png");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      attempts.push({ attempt, model: PRIMARY_MODEL, image_url: "", passed: false, failures: [`render error: ${msg.slice(0, 160)}`], summary: "", gate_status: "unavailable" });
      // Out of credit will not recover on a retry.
      if (/402|insufficient credit/i.test(msg)) break;
      continue;
    }
    // Gate against the DAY design model: geometry is what is checked, and the
    // day model shows it best. An evening is also checked against the NIGHT
    // model, whose glows mark the designed lights — light anywhere else fails.
    const verdict = await runFaithfulnessGate(
      manifest,
      b64(dayPng, "image/png"),
      b64(bytes, isJpeg(bytes) ? "image/jpeg" : "image/png"),
      view === "evening" ? b64(designPng, "image/png") : undefined,
    );
    attempts.push({ attempt, model: PRIMARY_MODEL, image_url: url, passed: verdict.passed, failures: verdict.failures, summary: verdict.reply?.summary ?? "", gate_status: verdict.status });
    if (verdict.passed) final = { url, outcome: "passed", prompt, model: PRIMARY_MODEL };
  }
  // A model that could not run at all (no credit, outage) is not a render that
  // failed the gate. Recording it as a substitution would cache an
  // infrastructure fault as a verdict about the design — so nothing is saved
  // and the caller sees the error.
  if (!final && canAttempt && isInfrastructureFailure(attempts)) {
    throw new Error(`render model unavailable: ${attempts.at(-1)!.failures[0] ?? "unknown error"}`);
  }
  if (!final) final = { url: designUrl, outcome: "substituted", prompt: "(raw 3D design view)", model: "scene-raster" };

  const designViewReason: DesignViewReason | null =
    final.outcome === "passed" ? null : cam.clean === false ? "no_clean_camera" : view === "evening" && dayRenderBytes === null ? "no_passed_day" : "gate_failed";
  const gate: SceneGateRecord = {
    pipeline: SCENE_PIPELINE_VERSION,
    outcome: final.outcome,
    design_view_reason: designViewReason,
    ...(cam.clean === false ? { camera_reasons: cam.cleanReasons } : {}),
    camera: cam,
    manifest,
    scene_url: dayUrl,
    depth_url: depthUrl,
    attempts,
    gate_model: "claude-opus-5",
  };
  const { data: row, error } = await sb
    .from("renders")
    .insert({
      project_id: ctx.projectId,
      room_id: cam.zoneId,
      prompt: final.prompt,
      image_url: final.url,
      source_image_url: designUrl,
      model: final.model,
      mode: "scene",
      view,
      camera: cameraId,
      cache_key: cacheKey,
      gate,
      status: "succeeded",
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !row) throw new Error(`could not save the render: ${error?.message}`);
  return { render_id: row.id, image_url: final.url, view, camera_id: cameraId, outcome: final.outcome, design_view_reason: designViewReason, cached: false, attempts };
}
