// =============================================================================
// lib/scene-render/photo-pair-run.ts — make one before/after pair (G5). Server-only.
//
// photo (client asset) → nano-banana-pro restyle with the design's decisions on
// the existing items in view → pair gate → one tightened retry → otherwise the
// pair is WITHHELD (saved as withheld, so the gate table can say so, and never
// packed). Cached per project + asset + decisions + style.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { publicUrlForPath } from "@/lib/assets/load";
import { LINEAR_ELEMENT_META } from "@/lib/plan/elements";
import { isDisposition } from "@/lib/plan/site-reference";
import { buildEditInput } from "@/lib/render-image";
import { uploadRenderBytes } from "@/lib/render-storage";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { isInfrastructureFailure, PRIMARY_MODEL } from "./prompts";
import { isVerdictless, pairCacheKey, pairManifest, pairPrompt, PHOTO_PAIR_VERSION, runPairGate, type PairManifest } from "./photo-pair";
import { fetchSceneBytes, loadGardenSceneContext, runRenderModel } from "./pipeline";

const SURFACE_NOUN: Record<string, string> = {
  artificial_grass: "artificial grass lawn",
  paving: "porcelain paving",
  path: "paved path",
  deck: "timber deck",
  planting_bed: "planting bed",
  structure: "paving under a structure",
  pool: "pool surround",
};

export interface PhotoPairResult {
  render_id: string;
  image_url: string;
  outcome: "passed" | "withheld";
  cached: boolean;
  attempts: { attempt: number; passed: boolean; failures: string[]; summary: string }[];
}

export async function renderPhotoPair(input: { projectId: string; assetId: string; zoneId: string; itemIds: string[] }): Promise<PhotoPairResult> {
  const sb = getSupabaseAdmin() as unknown as SupabaseClient;
  const ctx = await loadGardenSceneContext(input.projectId);

  const { data: asset } = await sb
    .from("project_assets")
    .select("id, project_id, kind, storage_path, mime")
    .eq("id", input.assetId)
    .maybeSingle<{ id: string; project_id: string; kind: string; storage_path: string; mime: string | null }>();
  if (!asset || asset.project_id !== input.projectId || asset.kind !== "photo") throw new Error("That photo is not in this project's library.");
  const photoUrl = publicUrlForPath(asset.storage_path);

  const zone = ctx.graph.rooms.find((r) => r.id === input.zoneId);
  if (!zone) throw new Error("Unknown zone.");

  // What the design says about each existing item in view.
  const { data: fx } = await sb
    .from("plan_fixtures")
    .select("id, type, spec, site_reference, disposition")
    .eq("project_id", input.projectId)
    .in("id", input.itemIds.length ? input.itemIds : ["00000000-0000-0000-0000-000000000000"]);
  const items: { noun: string; disposition: "keep" | "remove" | "replace" | null; replacement?: string | null }[] = [];
  const clean = (s: string) => s.replace(/\s*\(existing\)\s*/i, " ").replace(/\s+—\s+/g, " — ").trim().toLowerCase();
  for (const id of input.itemIds) {
    const r = ctx.graph.rooms.find((x) => x.id === id);
    if (r) {
      const form = typeof r.spec?.form === "string" ? r.spec.form : null;
      const was = typeof r.spec?.replaces_existing === "string" ? r.spec.replaces_existing : null;
      if (r.disposition === "replace" && was) {
        // Replaced in place by something else (gazebo → louvred pergola).
        items.push({ noun: `the ${was}`, disposition: "replace", replacement: `a ${String(r.spec?.system ?? r.name_en).toLowerCase()}` });
      } else {
        items.push({ noun: form === "gazebo" ? "the hardtop gazebo with dark glazed panels" : clean(r.name_en), disposition: r.disposition });
      }
      continue;
    }
    const e = ctx.graph.elements.find((x) => x.id === id);
    if (e) {
      const name = typeof e.spec?.name === "string" ? e.spec.name : LINEAR_ELEMENT_META[e.kind].label;
      const noun = `the ${clean(name.split(" — ")[0]!)}`;
      const by = typeof e.spec?.replaced_by === "string" && e.disposition === "replace" ? e.spec.replaced_by : null;
      if (by && e.spec?.replaced_in_place === true) items.push({ noun, disposition: "replace", replacement: by });
      // Replaced by something placed elsewhere: from this camera it is simply gone.
      else if (by) items.push({ noun, disposition: "remove" });
      else items.push({ noun, disposition: e.disposition });
      continue;
    }
    const f = (fx ?? []).find((x: { id: string }) => x.id === id) as { type: string; spec: Record<string, unknown> | null; site_reference: boolean; disposition: string | null } | undefined;
    if (f) {
      const species = typeof f.spec?.species === "string" ? f.spec.species : f.type;
      items.push({ noun: `the ${species} tree`, disposition: f.site_reference && isDisposition(f.disposition) ? f.disposition : null });
    }
  }
  const manifest: PairManifest = pairManifest({ projectId: input.projectId, assetId: input.assetId, zoneName: zone.name_en, zoneSurface: SURFACE_NOUN[zone.type ?? ""] ?? "garden surface", items });
  const cacheKey = pairCacheKey(manifest, ctx.style.key);
  const camera = `photo:${input.assetId}`;

  const { data: cached } = await sb
    .from("renders")
    .select("id, image_url, gate")
    .eq("project_id", input.projectId)
    .eq("cache_key", cacheKey)
    .eq("mode", "photo_pair")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; image_url: string; gate: { outcome: "passed" | "withheld"; attempts: (PhotoPairResult["attempts"][number] & { image_url?: string })[] } }>();
  if (cached?.gate && !(cached.gate.outcome === "withheld" && isVerdictless(cached.gate.attempts))) return { render_id: cached.id, image_url: cached.image_url, outcome: cached.gate.outcome, cached: true, attempts: cached.gate.attempts };

  const before = await fetchSceneBytes(photoUrl);
  const beforeMime = before[0] === 0x89 ? "image/png" : "image/jpeg";
  const beforeUri = `data:${beforeMime};base64,${Buffer.from(before).toString("base64")}`;
  const base = `projects/${input.projectId}/photo-pairs/${input.assetId}-${cacheKey.slice(0, 12)}`;

  const attempts: (PhotoPairResult["attempts"][number] & { image_url: string })[] = [];
  let passedUrl: string | null = null;
  let prompt = "";
  for (let attempt = 1; attempt <= 2 && !passedUrl; attempt++) {
    prompt = pairPrompt(manifest, ctx.style, attempts.at(-1)?.failures ?? []);
    let bytes: Uint8Array;
    let url: string;
    try {
      const out = await runRenderModel(PRIMARY_MODEL, { ...buildEditInput(PRIMARY_MODEL as never, prompt, [beforeUri]), aspect_ratio: "match_input_image", resolution: "1K", output_format: "jpg" });
      bytes = await fetchSceneBytes(out);
      url = await uploadRenderBytes(`${base}-attempt${attempt}.jpg`, bytes, bytes[0] === 0xff ? "image/jpeg" : "image/png");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      attempts.push({ attempt, image_url: "", passed: false, failures: [`render error: ${msg.slice(0, 160)}`], summary: "" });
      if (/402|insufficient credit/i.test(msg)) break;
      continue;
    }
    const gateOnce = () =>
      runPairGate(
        manifest,
        { kind: "base64", mediaType: beforeMime, data: Buffer.from(before).toString("base64") },
        { kind: "base64", mediaType: bytes[0] === 0xff ? "image/jpeg" : "image/png", data: Buffer.from(bytes).toString("base64") },
      );
    // A gate that could not run says nothing about the image: check the same
    // image again before spending another render on it.
    let verdict = await gateOnce();
    if (verdict.status === "unavailable") verdict = await gateOnce();
    attempts.push({ attempt, image_url: url, passed: verdict.passed, failures: verdict.failures, summary: verdict.reply?.summary ?? "" });
    if (verdict.passed) passedUrl = url;
  }
  if (!passedUrl && isInfrastructureFailure(attempts)) {
    throw new Error(`render model unavailable: ${attempts.at(-1)!.failures[0] ?? "unknown error"}`);
  }
  if (!passedUrl && isVerdictless(attempts)) {
    throw new Error(`pair gate unavailable — not withheld on a verdict, retry later: ${attempts.at(-1)!.failures[0] ?? "unknown error"}`);
  }

  const outcome: "passed" | "withheld" = passedUrl ? "passed" : "withheld";
  const caption = `${zone.name_en}: the client's photo restyled in ${ctx.style.name_en}, with the design's decisions on the existing items in view (${manifest.items.map((i) => `${i.noun} — ${i.disposition ?? "kept as is"}`).join("; ") || "none in view"}). Layout and dimensions are on the drawing set; structures the design adds out of this camera's view are in the plan-faithful renders.`;
  const { data: row, error } = await sb
    .from("renders")
    .insert({
      project_id: input.projectId,
      room_id: zone.id,
      prompt,
      image_url: passedUrl ?? photoUrl,
      source_image_url: photoUrl,
      model: PRIMARY_MODEL,
      mode: "photo_pair",
      camera,
      cache_key: cacheKey,
      gate: { pipeline: PHOTO_PAIR_VERSION, outcome, manifest, attempts, caption, zone_name: zone.name_en, gate_model: "claude-opus-5" },
      status: "succeeded",
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !row) throw new Error(`could not save the pair: ${error?.message}`);
  return { render_id: row.id, image_url: passedUrl ?? photoUrl, outcome, cached: false, attempts };
}
