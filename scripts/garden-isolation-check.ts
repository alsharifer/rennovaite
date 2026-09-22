// =============================================================================
// scripts/garden-isolation-check.ts — project isolation, asserted (garden pilot G4b).
//
// Villa 94 (the reference) and the client garden are separate projects that
// share rates and styles and nothing else. The client garden's measurements
// have not landed, so the check uses a STAND-IN seeded from the same Villa 94
// records: identical zone names, geometry, cameras and scene. That is the worst
// case for isolation — if anything were keyed on content rather than project,
// this is where it would collide.
//
// For each direction it snapshots the OTHER project (row counts and fingerprints
// across every garden table, plus every storage object under its prefix),
// regenerates this project's full render pack through the real routes, and
// snapshots the other project again. Any difference fails.
//
// Also asserted end-to-end: every render row, camera manifest, drawing sheet and
// BoQ line resolves to its own project; no cache key is shared.
//
// G5: the client garden now exists, so the check can run against it directly
// instead of the stand-in: pass --client <project-id>. The snapshot also covers
// what a client project adds — its photo assets and room photos, the plan-uploads
// storage prefix they live under, pilot events and review corrections.
//
// Run (dev server on the port with GARDEN_PILOT_ENABLED=true DRAWINGS_ENABLED=true):
//   node --import ./scripts/_alias-hook.mjs scripts/garden-isolation-check.ts [port]
//        [--client <project-id>] [--no-render-reference] [--no-render-client] [--out <name>]
// Writes screenshots/garden-pilot/<name>.json (default g4b-isolation) and prints the gate tables.
// =============================================================================

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { verificationJobs } from "./lib/verification-job.mjs";

// T5: the document routes answer only a pack job; this check READS documents, so it
// opens one per project (released nothing) — set in main().
let VJ: ReturnType<typeof verificationJobs>;
const docHeaders = async (projectId: string) => VJ.headers(projectId);

import { seedVilla94Garden } from "./lib/garden-seed.ts";

const ROOT = "C:/dev/rennovaite";
const ARGS = process.argv.slice(2);
const argValue = (flag: string) => {
  const i = ARGS.indexOf(flag);
  return i >= 0 ? ARGS[i + 1] ?? null : null;
};
const PORT = ARGS.find((a) => /^\d+$/.test(a)) ?? "3098";
const CLIENT_ID = argValue("--client");
const RENDER_REFERENCE = !ARGS.includes("--no-render-reference");
const RENDER_CLIENT = !ARGS.includes("--no-render-client");
const OUT_NAME = argValue("--out") ?? "g4b-isolation";
const BASE = `http://localhost:${PORT}`;
const REFERENCE = "Villa 94 garden (ground truth)";
const STAND_IN = "Client garden stand-in (isolation fixture)";
const OUT = `${ROOT}/screenshots/garden-pilot`;

const results: string[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`;
  results.push(line);
  console.log(line);
};

async function loadEnv() {
  const env: Record<string, string> = {};
  for (const line of (await readFile(`${ROOT}/.env.local`, "utf8")).split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const e = t.indexOf("=");
    if (e !== -1) env[t.slice(0, e).trim()] = t.slice(e + 1).trim();
  }
  return env;
}

const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);

interface Snapshot {
  counts: Record<string, number>;
  fingerprints: Record<string, string>;
  storage: { objects: number; fingerprint: string };
}

async function listStorage(db: SupabaseClient, prefix: string, bucket = "renders"): Promise<{ name: string; size: number; updated: string }[]> {
  const out: { name: string; size: number; updated: string }[] = [];
  const walk = async (dir: string) => {
    for (let offset = 0; ; offset += 1000) {
      const { data } = await db.storage.from(bucket).list(dir, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
      if (!data || data.length === 0) break;
      for (const o of data) {
        if (o.id === null) await walk(`${dir}/${o.name}`);
        else out.push({ name: `${dir}/${o.name}`, size: Number((o.metadata as { size?: number } | null)?.size ?? 0), updated: String(o.updated_at ?? "") });
      }
      if (data.length < 1000) break;
    }
  };
  await walk(prefix);
  return out;
}

async function snapshot(db: SupabaseClient, projectId: string): Promise<Snapshot> {
  const { data: plans } = await db.from("plans").select("id, updated_at:created_at").eq("project_id", projectId);
  const planIds = (plans ?? []).map((p) => p.id as string);
  const byProject = async (table: string, cols = "*") => {
    const { data } = await db.from(table).select(cols).eq("project_id", projectId);
    return (data ?? []) as unknown as Record<string, unknown>[];
  };
  const byPlan = async (table: string) => {
    if (planIds.length === 0) return [];
    const { data } = await db.from(table).select("*").in("plan_id", planIds);
    return (data ?? []) as Record<string, unknown>[];
  };
  const tables: Record<string, Record<string, unknown>[]> = {
    renders: await byProject("renders"),
    boqs: await byProject("boqs"),
    takeoff_items: await byProject("takeoff_items"),
    plan_fixtures: await byProject("plan_fixtures"),
    moodboard_items: await byProject("moodboard_items"),
    style_choices: await byProject("style_choices"),
    boq_outcomes: await byProject("boq_outcomes"),
    plans: (plans ?? []) as Record<string, unknown>[],
    rooms: await byPlan("rooms"),
    plan_elements: await byPlan("plan_elements"),
    plan_context: await byPlan("plan_context"),
    // G5: what a client project adds.
    project_assets: await byProject("project_assets"),
    pilot_events: await byProject("pilot_events"),
    boq_corrections: await byProject("boq_corrections"),
  };
  const roomIds = tables.rooms.map((r) => r.id as string);
  if (roomIds.length > 0) {
    const { data } = await db.from("room_photos").select("*").in("room_id", roomIds);
    tables.room_photos = (data ?? []) as Record<string, unknown>[];
  } else tables.room_photos = [];
  const counts: Record<string, number> = {};
  const fingerprints: Record<string, string> = {};
  for (const [t, rows] of Object.entries(tables)) {
    counts[t] = rows.length;
    fingerprints[t] = sha([...rows].sort((a, b) => String(a.id).localeCompare(String(b.id))));
  }
  const objects = [
    ...(await listStorage(db, `projects/${projectId}`)),
    // Client photos and assets live in plan-uploads under the project id.
    ...(await listStorage(db, projectId, "plan-uploads")).map((o) => ({ ...o, name: `plan-uploads/${o.name}` })),
  ];
  return { counts, fingerprints, storage: { objects: objects.length, fingerprint: sha(objects) } };
}

function sameSnapshot(a: Snapshot, b: Snapshot): string[] {
  const diffs: string[] = [];
  for (const t of Object.keys(a.counts)) {
    if (a.counts[t] !== b.counts[t]) diffs.push(`${t}: ${a.counts[t]} → ${b.counts[t]} rows`);
    else if (a.fingerprints[t] !== b.fingerprints[t]) diffs.push(`${t}: contents changed`);
  }
  if (a.storage.objects !== b.storage.objects) diffs.push(`storage: ${a.storage.objects} → ${b.storage.objects} objects`);
  else if (a.storage.fingerprint !== b.storage.fingerprint) diffs.push("storage: objects changed");
  return diffs;
}

interface GateRow {
  camera: string;
  label: string;
  view: string;
  outcome: string;
  attempts: { attempt: number; passed: boolean; failures: string[] }[];
}

async function regeneratePack(projectId: string, tag: string, render = true): Promise<{ gate: GateRow[]; packBytes: number; pages: number }> {
  // The documents are regenerated whether or not the views are re-rendered: the
  // BoQ (and its take-off rows) and the drawing set are part of the pack.
  const gen = (await (await fetch(`${BASE}/api/generate-boq`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId }) })).json()) as { error?: string };
  console.log(`  [${tag}] BoQ regenerated${gen.error ? ` — ERROR ${gen.error}` : ""}`);
  await fetch(`${BASE}/api/projects/${projectId}/drawings`, { headers: await docHeaders(projectId) });
  if (!render) {
    const summary = (await (await fetch(`${BASE}/api/projects/${projectId}/render-pack?format=json`, { headers: await docHeaders(projectId) })).json()) as { gate: GateRow[]; pages: unknown[]; bytes: number; error?: string };
    return { gate: summary.gate ?? [], packBytes: summary.bytes ?? 0, pages: summary.pages?.length ?? 0 };
  }
  const cams = (await (await fetch(`${BASE}/api/render/scene?project_id=${projectId}`)).json()) as { cameras: { id: string; label: string; lit: boolean }[]; error?: string };
  if (!cams.cameras) throw new Error(`cameras: ${cams.error}`);
  const run = async (jobs: { id: string; view: "day" | "evening" }[]) => {
    const queue = [...jobs];
    const worker = async () => {
      for (let j = queue.shift(); j; j = queue.shift()) {
        const t0 = Date.now();
        const res = await fetch(`${BASE}/api/render/scene`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId, camera_id: j.id, view: j.view }) });
        const body = (await res.json().catch(() => ({}))) as { outcome?: string; cached?: boolean; error?: string };
        console.log(`  [${tag}] ${j.view.padEnd(7)} ${j.id.slice(0, 44).padEnd(44)} ${body.outcome ?? `ERROR ${body.error}`}${body.cached ? " (cached)" : ""} ${Math.round((Date.now() - t0) / 1000)}s`);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  };
  await run(cams.cameras.map((c) => ({ id: c.id, view: "day" as const })));
  await run(cams.cameras.filter((c) => c.lit).map((c) => ({ id: c.id, view: "evening" as const })));
  const summary = (await (await fetch(`${BASE}/api/projects/${projectId}/render-pack?format=json`, { headers: await docHeaders(projectId) })).json()) as { gate: GateRow[]; pages: unknown[]; bytes: number; error?: string };
  if (!summary.gate) throw new Error(`render pack: ${summary.error}`);
  return { gate: summary.gate, packBytes: summary.bytes, pages: summary.pages.length };
}

function printGate(title: string, gate: GateRow[]) {
  console.log(`\n  ${title}`);
  console.log(`  ${"VIEW".padEnd(34)} ${"".padEnd(8)} OUTCOME       ATTEMPTS`);
  for (const g of gate) {
    const att = g.attempts.map((a) => `${a.attempt}:${a.passed ? "pass" : "fail"}`).join(" ");
    console.log(`  ${g.label.slice(0, 34).padEnd(34)} ${g.view.padEnd(8)} ${g.outcome.padEnd(13)} ${att}`);
    for (const a of g.attempts.filter((x) => !x.passed)) console.log(`      attempt ${a.attempt}: ${a.failures.join(" | ").slice(0, 220)}`);
  }
  const passed = gate.filter((g) => g.outcome === "passed").length;
  const subst = gate.filter((g) => g.outcome === "substituted").length;
  console.log(`  → ${passed} passed, ${subst} substituted by the 3D design view, ${gate.length - passed - subst} missing`);
}

async function endToEnd(db: SupabaseClient, projectId: string, otherId: string, tag: string) {
  const { data: rows } = await db.from("renders").select("id, project_id, image_url, source_image_url, cache_key, gate, mode").eq("project_id", projectId).in("mode", ["scene", "photo_pair"]);
  const all = (rows ?? []) as { id: string; project_id: string; image_url: string; source_image_url: string; cache_key: string; mode: string; gate: { manifest?: { projectId?: string }; scene_url?: string } | null }[];
  const scene = all.filter((r) => r.mode === "scene");
  const pairs = all.filter((r) => r.mode === "photo_pair");
  if (scene.length === 0) {
    check(`[${tag}] scene render rows`, true, "none rendered on this run — row, manifest and storage assertions not applicable");
  } else {
    check(`[${tag}] every scene render row carries this project`, scene.every((r) => r.project_id === projectId), `${scene.length} rows`);
    check(`[${tag}] every camera manifest carries this project`, scene.every((r) => r.gate?.manifest?.projectId === projectId));
    check(`[${tag}] every image and scene model lives under this project's storage prefix`, scene.every((r) => [r.image_url, r.source_image_url, r.gate?.scene_url].every((u) => String(u).includes(`/projects/${projectId}/`) && !String(u).includes(otherId))));
  }
  if (pairs.length > 0) {
    check(`[${tag}] every photo pair carries this project — manifest, restyle and source photo`, pairs.every((r) => r.gate?.manifest?.projectId === projectId && String(r.source_image_url).includes(`/${projectId}/`) && !String(r.image_url).includes(otherId)), `${pairs.length} pairs`);
  }

  const drawings = (await (await fetch(`${BASE}/api/projects/${projectId}/drawings`, { headers: await docHeaders(projectId) })).json()) as { sheets?: { svg: string }[] };
  check(`[${tag}] every drawing sheet carries this project`, (drawings.sheets ?? []).length > 0 && (drawings.sheets ?? []).every((s) => s.svg.includes(`data-project-id="${projectId}"`) && !s.svg.includes(otherId)), `${drawings.sheets?.length} sheets`);

  const { data: plan } = await db.from("plans").select("id").eq("project_id", projectId).maybeSingle<{ id: string }>();
  const own = new Set<string>();
  for (const t of ["rooms", "plan_elements", "plan_context"]) {
    const { data } = await db.from(t).select("id").eq("plan_id", plan!.id);
    for (const r of data ?? []) own.add(r.id as string);
  }
  const { data: fx } = await db.from("plan_fixtures").select("id").eq("project_id", projectId);
  for (const r of fx ?? []) own.add(r.id as string);
  const { data: boq } = await db.from("boqs").select("project_id, sections").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle<{ project_id: string; sections: { sections: { lines: { element_refs?: string[] }[] }[] } }>();
  const refs = (boq?.sections?.sections ?? []).flatMap((s) => s.lines.flatMap((l) => l.element_refs ?? []));
  check(`[${tag}] every BoQ line's element_refs resolve inside this project`, !!boq && boq.project_id === projectId && refs.length > 0 && refs.every((r) => own.has(r)), `${refs.length} refs`);
  const { count: ti } = await db.from("takeoff_items").select("id", { count: "exact", head: true }).eq("project_id", projectId);
  check(`[${tag}] take-off rows carry this project`, (ti ?? 0) > 0, `${ti} rows`);
  return new Set(all.map((r) => r.cache_key));
}

const RUN_STARTED = new Date().toISOString();

async function main() {
  const env = await loadEnv();
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }) as SupabaseClient;
  VJ = verificationJobs(db, "garden-isolation-check");
  const projectsBefore = (await db.from("projects").select("id", { count: "exact", head: true })).count ?? 0;

  const { data: ref } = await db.from("projects").select("id").eq("name", REFERENCE).maybeSingle<{ id: string }>();
  if (!ref) throw new Error("Villa 94 ground-truth project not found.");
  let { data: standIn } = CLIENT_ID
    ? await db.from("projects").select("id").eq("id", CLIENT_ID).maybeSingle<{ id: string }>()
    : await db.from("projects").select("id").eq("name", STAND_IN).maybeSingle<{ id: string }>();
  if (CLIENT_ID && !standIn) throw new Error(`client project ${CLIENT_ID} not found`);
  if (!standIn) {
    const { data, error } = await db.from("projects").insert({ name: STAND_IN, city: "Dubai" }).select("id").single<{ id: string }>();
    if (error || !data) throw error ?? new Error("could not create the stand-in");
    standIn = data;
    const seedChecks: string[] = [];
    await seedVilla94Garden(db, BASE, standIn.id, (l, ok, d) => seedChecks.push(`${ok ? "PASS" : "FAIL"} ${l} ${d ?? ""}`));
    const gen = await (await fetch(`${BASE}/api/generate-boq`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: standIn.id }) })).json();
    check("stand-in seeded from the same records, BoQ generated", seedChecks.every((c) => c.startsWith("PASS")) && !gen.error, seedChecks.filter((c) => !c.startsWith("PASS")).join("; "));
  }
  const A = ref.id;
  const B = standIn.id;
  const otherTag = CLIENT_ID ? "client" : "stand-in";
  console.log(`reference ${A}\n${otherTag.padEnd(9)} ${B}\n`);

  // Direction 1: regenerate Villa 94's pack; the stand-in must not change.
  const b0 = await snapshot(db, B);
  const packA = await regeneratePack(A, "villa94", RENDER_REFERENCE);
  const b1 = await snapshot(db, B);
  const d1 = sameSnapshot(b0, b1);
  check(`regenerating Villa 94's pack touches zero rows, assets or cached images of the ${otherTag}`, d1.length === 0, d1.join("; ") || `${Object.values(b1.counts).reduce((s, n) => s + n, 0)} rows, ${b1.storage.objects} storage objects unchanged`);

  // Direction 2: regenerate the stand-in's pack; Villa 94 must not change.
  const a0 = await snapshot(db, A);
  const packB = await regeneratePack(B, otherTag, RENDER_CLIENT);
  const a1 = await snapshot(db, A);
  const d2 = sameSnapshot(a0, a1);
  check(`regenerating the ${otherTag}'s pack touches zero rows, assets or cached images of Villa 94`, d2.length === 0, d2.join("; ") || `${Object.values(a1.counts).reduce((s, n) => s + n, 0)} rows, ${a1.storage.objects} storage objects unchanged`);

  const keysA = await endToEnd(db, A, B, "villa94");
  const keysB = await endToEnd(db, B, A, otherTag);
  const shared = [...keysA].filter((k) => keysB.has(k));
  check("no render cache key is shared between the projects (same zones, same scene)", shared.length === 0, `${keysA.size} vs ${keysB.size} keys, ${shared.length} shared`);

  // Events this run caused on either project are verification, not pilot data.
  // Tagged only now, after every snapshot, so the tagging cannot read as a change.
  for (const id of [A, B]) {
    const { data: evs } = await db.from("pilot_events").select("id, detail, recorded_at").eq("project_id", id).gte("recorded_at", RUN_STARTED);
    for (const e of evs ?? []) {
      const d = (e.detail ?? {}) as Record<string, unknown>;
      if (!d.stage) await db.from("pilot_events").update({ detail: { ...d, stage: "verification" } }).eq("id", e.id);
    }
  }

  const projectsAfter = (await db.from("projects").select("id", { count: "exact", head: true })).count ?? 0;
  console.log(`\n[blast radius] projects ${projectsBefore} → ${projectsAfter} (the stand-in is the only project this script may create)`);

  printGate("GATE — Villa 94 render pack", packA.gate);
  printGate(`GATE — ${otherTag} render pack`, packB.gate);

  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    `${OUT}/${OUT_NAME}.json`,
    JSON.stringify({ reference: A, standIn: B, checks: results, snapshots: { standIn: { before: b0, after: b1 }, villa94: { before: a0, after: a1 } }, gate: { villa94: packA.gate, standIn: packB.gate }, packs: { villa94: { pages: packA.pages, bytes: packA.packBytes }, standIn: { pages: packB.pages, bytes: packB.packBytes } } }, null, 2),
  );
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  await VJ.close();
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
