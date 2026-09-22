// =============================================================================
// lib/documents/pack-export/run.ts — THE pack export (T5).
//
// The one sequence behind every client document. scripts/garden-draft-pack.ts
// and the in-app "Export pack" action both call runPackExport; they differ only
// in the transport (which origin the routes are on) and the sink (a local folder
// or the private `packs` bucket). Gates are always on:
//
//   1. BoQ regenerated (optional — the script's behaviour);
//   2. the export gate — readiness + scope-aware parity + a client-facing name —
//      as a readable checklist; any open item BLOCKS before a document is made;
//   3. gardens: every view rendered anchor-first through the faithfulness gate,
//      the cross-view consistency gate, the evenings (renders.ts);
//   4. gardens: before/after photo pairs, one per zone, a second photo tried when
//      the first is withheld;
//   5. documents — drawing set, render pack (gardens), BoQ PDF — through the
//      document routes, which serve a PDF only to a running pack job;
//   6. printed-content checks on exactly what was printed (checks.ts), including
//      the identity-leak scan; any failure and NOTHING is released;
//   7. one manifest: checks, gate table, parity, consistency, mix, metrics and
//      the quantity baseline for the change report — saved WITH the documents.
//
// Server-side and CLI-safe: no next/server, no pdf-lib (PDFs come from routes).
// =============================================================================

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { PackReadiness } from "@/lib/documents/pack-readiness";
import type { ParityResult } from "@/lib/documents/parity";
import { loadWithheldNames } from "@/lib/identity/curation";
import { isOutdoorType } from "@/lib/plan/zones";

import { buildChecklist, checklistReady } from "./checklist";
import { printedChecks } from "./checks";
import { photoCoverage } from "./coverage";
import { renderAllViews, type RenderRunResult, type CameraRow } from "./renders";
import type { PackCheck, PackExportOptions, PackExportResult, PackOutput, PackProgress, PackScope, PackSink, PackTransport } from "./types";

export interface PackExportContext {
  projectId: string;
  db: SupabaseClient;
  transport: PackTransport;
  sink: PackSink;
  options: PackExportOptions;
  /** Who ran it — recorded on the pilot events it causes. */
  source: "app" | "cli";
  onProgress?: (p: PackProgress) => void | Promise<void>;
  log?: (line: string) => void;
  /**
   * Checks a CLI caller adds on top of the standard ones (a reference pack's
   * "no house number"); they gate the release exactly like the built-in ones.
   */
  extraChecks?: (printed: { sheets: { sheetNumber: string; svg: string }[]; packPages: string[]; pdfs: { name: string; bytes: Uint8Array }[] }) => PackCheck[];
}

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "project";

export async function runPackExport(ctx: PackExportContext): Promise<PackExportResult> {
  const { projectId: P, db, transport: t, options } = ctx;
  const log = ctx.log ?? (() => {});
  const progress = async (step: PackProgress["step"], pct: number, note: string) => {
    log(`[${pct}%] ${step}: ${note}`);
    await ctx.onProgress?.({ step, pct, note });
  };
  const started = new Date().toISOString();
  const checks: PackCheck[] = [];
  const check = (label: string, ok: boolean, detail = "") => checks.push({ label, ok, detail });

  // --- scope + name ---------------------------------------------------------------
  const { data: proj } = await db.from("projects").select("name, display_name").eq("id", P).maybeSingle<{ name: string | null; display_name: string | null }>();
  const documentName = proj?.display_name ?? proj?.name ?? null;
  const { data: plan } = await db.from("plans").select("id").eq("project_id", P).order("created_at", { ascending: false }).limit(1).maybeSingle<{ id: string }>();
  const { data: roomRows } = plan ? await db.from("rooms").select("room_type").eq("plan_id", plan.id) : { data: [] };
  const types = ((roomRows ?? []) as { room_type: string | null }[]).map((r) => r.room_type ?? "");
  const hasGarden = types.some((x) => isOutdoorType(x));
  const hasInterior = types.some((x) => !isOutdoorType(x));
  const scope: PackScope = hasGarden && hasInterior ? "mixed" : hasGarden ? "garden" : "interior";
  const garden = scope !== "interior";

  // --- 1. BoQ -----------------------------------------------------------------------
  await progress("boq", 5, options.regenerateBoq ? "regenerating the BoQ" : "using the latest BoQ");
  if (options.regenerateBoq) {
    const gen = await t.post("/api/generate-boq", { project_id: P });
    check("BoQ generates", !gen.body.error && gen.status < 400, String(gen.body.error ?? `AED ${gen.body.grand_total_aed}`));
  }

  // --- 2. the export gate -----------------------------------------------------------
  await progress("readiness", 10, "checking the export gate");
  const readiness = (await t.get<{ readiness?: PackReadiness }>(`/api/projects/${P}/boq-pdf?format=json`)).body.readiness ?? null;
  const parityRes = await t.get<{ parity?: ParityResult } & ParityResult>(`/api/projects/${P}/parity`);
  const parity = (parityRes.body.parity ?? (parityRes.body.lines ? (parityRes.body as ParityResult) : null)) as ParityResult | null;
  const checklist = buildChecklist({
    projectId: P,
    readiness: readiness ?? { ready: false, untyped_counters: [], undecided: [], stale_boq_needs_selection: [], has_boq: false },
    parity,
    documentName,
  });
  if (checks.some((c) => !c.ok) || !checklistReady(checklist)) {
    await progress("done", 100, "blocked by the export gate");
    await tagEvents(db, P, started, options.stage, ctx.source);
    return { status: "blocked", scope, checklist, checks, outputs: [], manifest: { project_id: P, scope, blocked_at: new Date().toISOString(), checklist, checks } };
  }

  // --- 3. renders (gardens) ---------------------------------------------------------
  let renderRun: (RenderRunResult & { cameras: CameraRow[] }) | null = null;
  if (garden && options.renders !== "skip") {
    await progress("renders", 15, options.renders === "cached" ? "collecting existing renders (nothing new is rendered)" : "rendering every view, anchor first");
    renderRun = await renderAllViews({ projectId: P, get: t.get, post: t.post, log, cacheOnly: options.renders === "cached" });
  }

  // --- 4. photo pairs (gardens) ------------------------------------------------------
  const pairResults: { file: string; zone: string; outcome: string }[] = [];
  if (garden && options.renders !== "skip" && options.pairs > 0) {
    await progress("photo_pairs", 60, "before/after pairs from the client's photos");
    const { source, queue } = await photoCoverage(db, P, options.pairs);
    const passedZones = new Set<string>();
    const tried = new Map<string, number>();
    for (const c of queue) {
      if (passedZones.has(c.zone) || (tried.get(c.zone) ?? 0) >= 2) continue;
      tried.set(c.zone, (tried.get(c.zone) ?? 0) + 1);
      if (!c.zoneId || !c.assetId) {
        pairResults.push({ file: c.file, zone: c.zone, outcome: "skipped — zone or photo not found (the design renamed or removed it)" });
        continue;
      }
      const r = await t.post("/api/render/photo-pair", { project_id: P, asset_id: c.assetId, zone_id: c.zoneId, item_ids: c.itemIds, ...(options.renders === "cached" ? { cache_only: true } : {}) });
      const outcome = String(r.body.outcome ?? `error: ${r.body.error}`);
      log(`  pair ${c.file} ${outcome}`);
      pairResults.push({ file: c.file, zone: c.zone, outcome });
      if (outcome === "passed") passedZones.add(c.zone);
    }
    log(`  photo coverage: ${source}`);
  }

  // --- 5. documents ------------------------------------------------------------------
  await progress("documents", 70, "producing the documents");
  const base = slug(documentName ?? "project");
  const docs: { name: string; path: string; type: string }[] = [
    { name: `${base}-drawing-set.pdf`, path: `/api/projects/${P}/drawings?format=pdf&sheet=all`, type: "application/pdf" },
    ...(garden ? [{ name: `${base}-render-pack.pdf`, path: `/api/projects/${P}/render-pack`, type: "application/pdf" }] : []),
    ...(options.boqPdf ? [{ name: `${base}-boq.pdf`, path: `/api/projects/${P}/boq-pdf`, type: "application/pdf" }] : []),
  ];
  const produced: { name: string; bytes: Uint8Array; type: string; status: number }[] = [];
  for (const d of docs) {
    const r = await t.bytes(d.path);
    produced.push({ name: d.name, bytes: r.bytes, type: d.type, status: r.status });
  }
  check(
    `${["drawing set", ...(garden ? ["render pack"] : []), ...(options.boqPdf ? ["BoQ"] : [])].join(", ")} export as PDFs`,
    produced.every((p) => p.status === 200 && p.bytes.byteLength > 10_000),
    produced.map((p) => `${p.name}: ${p.status} · ${p.bytes.byteLength} bytes`).join("; "),
  );

  // --- 6. what the documents print ---------------------------------------------------
  await progress("checks", 85, "checking what the documents print");
  const sheets = (await t.get<{ sheets?: { sheetNumber: string; kind: string; title: string; svg: string }[] }>(`/api/projects/${P}/drawings`)).body.sheets ?? [];
  const packPages = garden ? (await t.get<{ pages?: string[] }>(`/api/projects/${P}/render-pack?format=pages`)).body.pages ?? [] : [];
  const packSummary = garden
    ? (await t.get<{ gate?: { camera: string; label: string; view: string; outcome: string; reason?: string | null; consistency?: { passed: boolean; failures: string[]; anchor: boolean } | null; attempts: { attempt: number; passed: boolean }[] }[]; pages?: { kind?: string }[]; mix?: Record<string, number>; missing_images?: string[] }>(`/api/projects/${P}/render-pack?format=json`)).body
    : null;
  const boqPages = options.boqPdf ? (await t.get<{ pages?: string[] }>(`/api/projects/${P}/boq-pdf?format=pages`)).body.pages ?? [] : null;
  const { data: boqRow } = await db.from("boqs").select("id, sections").eq("project_id", P).order("created_at", { ascending: false }).limit(1).maybeSingle<{ id: string; sections: Parameters<typeof printedChecks>[0]["boq"] & { garden?: { draft?: { draft?: boolean; statement?: string | null; derived?: string[] } } } }>();
  const boq = boqRow!.sections;
  const draftStatement = boq.garden?.draft?.draft ? boq.garden.draft.statement ?? null : null;
  const boqHtml = (await t.text(`/project/${P}/boq`)).text;
  const planHtml = draftStatement ? (await t.text(`/project/${P}/plan`)).text : null;

  const { INTERNAL_REF, PUBLIC_SOURCE_LABEL } = await import("@/lib/ground-truth/villa94-garden");
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const identityTokens = [String(INTERNAL_REF).split(/[^A-Za-z0-9]+/)[0]!, String(INTERNAL_REF)].filter((x) => x.length >= 3).map(esc);
  const withheldNames = await loadWithheldNames(db, P);

  let renderInfo: Parameters<typeof printedChecks>[0]["renders"] = null;
  const pairsWithAdds: { outOfCrop: string[]; caption: string }[] = [];
  if (renderRun) {
    const { SCENE_PIPELINE_VERSION } = await import("@/lib/scene-render/prompts");
    const { data: rows } = await db.from("renders").select("camera, gate").eq("project_id", P).eq("mode", "scene").eq("status", "succeeded");
    const current = ((rows ?? []) as { camera: string; gate: { pipeline?: string; outcome?: string; attempts?: { passed: boolean; placement_checked?: boolean }[] } | null }[]).filter((r) => r.gate?.pipeline === SCENE_PIPELINE_VERSION && r.gate.outcome === "passed");
    const bad = renderRun.consistency.filter((c) => !c.passed);
    renderInfo = {
      passedPlacement: current.map((r) => ({ camera: r.camera, placementChecked: !!r.gate!.attempts?.some((a) => a.passed && a.placement_checked === true) })),
      inconsistentInPack: bad.filter((b) => packSummary?.gate?.some((g) => g.camera === b.camera && g.view === "day" && g.outcome === "passed")).map((b) => ({ camera: b.camera, failures: b.failures })),
      checkedAgainstAnchor: renderRun.consistency.length,
      anchor: renderRun.anchor.camera,
    };
    const { PHOTO_PAIR_VERSION } = await import("@/lib/scene-render/photo-pair");
    const { data: pairRows } = await db.from("renders").select("gate").eq("project_id", P).eq("mode", "photo_pair");
    for (const r of (pairRows ?? []) as { gate: { pipeline?: string; outcome?: string; caption?: string; out_of_crop?: string[]; manifest?: { items: { disposition: string }[] } } | null }[]) {
      if (r.gate?.pipeline !== PHOTO_PAIR_VERSION || r.gate.outcome !== "passed" || !r.gate.manifest?.items.some((x) => x.disposition === "add")) continue;
      pairsWithAdds.push({ outOfCrop: r.gate.out_of_crop ?? [], caption: r.gate.caption ?? "" });
    }
  }

  checks.push(
    ...printedChecks({
      scope,
      draftStatement,
      boq,
      sheets,
      packPages,
      packPageKinds: (packSummary?.pages ?? []).map((p) => p.kind),
      boqPages,
      boqHtml,
      planHtml,
      parity,
      identityTokens,
      withheldNames,
      publicSourceLabel: PUBLIC_SOURCE_LABEL,
      renders: renderInfo,
      pairsWithAdds,
    }),
  );

  if (ctx.extraChecks) checks.push(...ctx.extraChecks({ sheets, packPages, pdfs: produced.map((p) => ({ name: p.name, bytes: p.bytes })) }));

  // --- 7. manifest + outputs, saved together -------------------------------------------
  await progress("manifest", 95, "saving the documents with their manifest");
  const passed = checks.every((c) => c.ok);
  const outputs: PackOutput[] = [];
  // A failed run releases nothing: only the manifest (what failed, and why) is written.
  for (const p of produced) {
    if (p.status !== 200 || !passed) continue;
    const { path } = await ctx.sink.write(p.name, p.bytes, p.type);
    outputs.push({ name: p.name, path, bytes: p.bytes.byteLength, sha256: sha256(p.bytes), content_type: p.type });
  }

  let baseline: unknown = null;
  let decisions: unknown = null;
  let layout: unknown = null;
  if (garden) {
    const { snapshotOf } = await import("@/lib/pilot/change-report");
    const { data: takeoff } = await db.from("takeoff_items").select("work_item_key, element_id, qty, unit").eq("project_id", P).like("work_item_key", "garden.%");
    baseline = snapshotOf({ capturedAt: new Date().toISOString(), boqId: boqRow!.id, boq: boq as never, takeoff: takeoff ?? [], draft: { draft: boq.garden?.draft?.draft ?? false, derived: boq.garden?.draft?.derived ?? [] } });
    const { derivePlanGraph } = await import("@/lib/plan/derive");
    const { designDecisions, layoutAssumptions } = await import("@/lib/documents/design-assumptions");
    const g = await derivePlanGraph(P);
    const { data: fxAll } = await db.from("plan_fixtures").select("id, layer, type, room_id, position, spec, site_reference, disposition").eq("project_id", P);
    decisions = designDecisions(g, (fxAll ?? []) as never);
    layout = layoutAssumptions(g);
  }
  await tagEvents(db, P, started, options.stage, ctx.source);
  const metrics = garden ? (await t.get<{ metrics?: unknown }>(`/api/pilot-events?project_id=${P}`)).body.metrics ?? null : null;

  const manifest: Record<string, unknown> = {
    project_id: P,
    scope,
    document_name: documentName,
    source: ctx.source,
    options,
    generated_at: new Date().toISOString(),
    status: passed ? "passed" : "failed",
    boq: { id: boqRow!.id, grand_total_aed: boq.grand_total_aed },
    checklist,
    checks,
    outputs,
    drawings: sheets.map((s) => `${s.sheetNumber} ${s.title}`),
    gate: packSummary?.gate ?? [],
    mix: packSummary?.mix ?? null,
    missing_images: packSummary?.missing_images ?? [],
    parity,
    consistency: renderRun?.consistency ?? [],
    anchor: renderRun?.anchor ?? null,
    cameras: renderRun?.cameras.map((c) => ({ id: c.id, label: c.label, mode: c.mode, clean: c.clean })) ?? [],
    photo_pairs: pairResults,
    decisions,
    layout_assumptions: layout,
    baseline,
    metrics,
  };
  const mbytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  const { path: mpath } = await ctx.sink.write("pack-manifest.json", mbytes, "application/json");
  outputs.push({ name: "pack-manifest.json", path: mpath, bytes: mbytes.byteLength, sha256: sha256(mbytes), content_type: "application/json" });

  await progress("done", 100, passed ? "every gate held" : "a printed-content check failed — nothing is released");
  return { status: passed ? "passed" : "failed", scope, checklist, checks, outputs, manifest };
}

/** The pilot events a pack run causes are the run's, not the designer's — say so. */
async function tagEvents(db: SupabaseClient, projectId: string, since: string, stage: string | null | undefined, source: string): Promise<void> {
  if (!stage) return;
  try {
    const { data } = await db.from("pilot_events").select("id, detail").eq("project_id", projectId).gte("recorded_at", since);
    for (const e of (data ?? []) as { id: string; detail: Record<string, unknown> | null }[]) {
      const d = e.detail ?? {};
      if (!d.stage) await db.from("pilot_events").update({ detail: { ...d, stage, source: `pack-export (${source})` } }).eq("id", e.id);
    }
  } catch {
    /* instrumentation never breaks the export */
  }
}
