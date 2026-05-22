// Backfill script — repopulates hero renders for projects whose stored
// `renders.image_url` is a dead Replicate presigned URL. For each project
// that has a project-level style pick and at least one renderable room, it
// triggers a fresh /api/render call (with `force: true` so the prompt cache
// is bypassed). The API route re-hosts the output in Supabase Storage, so
// the new row gets a permanent public URL.
//
// Usage:
//   pnpm tsx scripts/backfill-renders.ts            # dry run, prints plan
//   pnpm tsx scripts/backfill-renders.ts --run      # actually triggers renders
//   pnpm tsx scripts/backfill-renders.ts --run --limit 2
//
// Requires the Next dev server to be running locally (the script POSTs to
// http://localhost:3091/api/render by default — override with API_BASE).
//
// Renders are fired with a small concurrency limit so we don't overwhelm
// the dev server or Replicate.

import { readFile } from "node:fs/promises";

import { supabaseAdmin } from "../lib/supabase-admin";

const ENV_PATH = "C:/dev/rennovaite/.env.local";
const API_BASE = process.env.API_BASE ?? "http://localhost:3091";
// Replicate's free-tier rate limit is "6 req/min with burst 1" when account
// credit is below $5. We run serially with a short pause between calls so
// the bursts never collide. The script also handles 429 retry-after, so even
// if you bump CONCURRENCY back up it should self-throttle.
const CONCURRENCY = 1;
const INTER_RENDER_PAUSE_MS = 12_000;
const PER_RENDER_TIMEOUT_MS = 180_000;
const MAX_RETRIES_ON_429 = 3;

// Hero-room preference order — pick the largest "living" if one exists,
// fall through to bedrooms/bathrooms so every candidate project at least
// gets *some* hero image. Mirrors the renderable set in lib/render-prompts.ts.
const HERO_ROOM_ORDER = [
  "living",
  "majlis",
  "dining",
  "master_bedroom",
  "bedroom",
  "bathroom",
  "ensuite",
  "powder",
];
const RENDERABLE = new Set(HERO_ROOM_ORDER);

type Candidate = {
  project_id: string;
  project_name: string;
  room_id: string;
  room_type: string;
  area_m2: number | null;
  style_key: string;
};

async function loadEnvLocal(): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(ENV_PATH, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function findCandidates(): Promise<Candidate[]> {
  const sb = supabaseAdmin;

  const { data: projects, error: projErr } = await sb
    .from("projects")
    .select("id, name")
    .order("created_at", { ascending: false });
  if (projErr) throw projErr;
  if (!projects) return [];

  const { data: styles, error: styleErr } = await sb
    .from("style_choices")
    .select("project_id, room_id, style_key, created_at")
    .is("room_id", null)
    .order("created_at", { ascending: false });
  if (styleErr) throw styleErr;
  const styleByProject = new Map<string, string>();
  for (const s of styles ?? []) {
    if (s.project_id && s.style_key && !styleByProject.has(s.project_id)) {
      styleByProject.set(s.project_id, s.style_key);
    }
  }

  // Skip projects whose latest render is ALREADY a Supabase Storage URL —
  // those got re-hosted by a previous backfill run.
  const { data: existingRenders } = await sb
    .from("renders")
    .select("project_id, image_url, created_at")
    .order("created_at", { ascending: false });
  const latestRenderByProject = new Map<string, string | null>();
  for (const r of existingRenders ?? []) {
    if (!r.project_id) continue;
    if (!latestRenderByProject.has(r.project_id)) {
      latestRenderByProject.set(r.project_id, r.image_url ?? null);
    }
  }

  const out: Candidate[] = [];
  for (const p of projects) {
    const styleKey = styleByProject.get(p.id);
    if (!styleKey) continue;

    // Already has a stable Supabase URL — skip.
    const latest = latestRenderByProject.get(p.id) ?? null;
    if (latest && !latest.includes("replicate.delivery")) {
      console.log(
        `[backfill] skip ${p.id.slice(0, 8)} — already on Supabase Storage`,
      );
      continue;
    }

    const { data: plan } = await sb
      .from("plans")
      .select("id")
      .eq("project_id", p.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!plan) continue;

    const { data: rooms } = await sb
      .from("rooms")
      .select("id, room_type, area_m2")
      .eq("plan_id", plan.id);
    if (!rooms?.length) continue;

    const valid = rooms.filter(
      (r) => r.room_type && RENDERABLE.has(r.room_type),
    );
    if (!valid.length) continue;

    let hero: (typeof valid)[number] | null = null;
    for (const rt of HERO_ROOM_ORDER) {
      const match = valid
        .filter((r) => r.room_type === rt)
        .sort((a, b) => (b.area_m2 ?? 0) - (a.area_m2 ?? 0));
      if (match[0]) {
        hero = match[0]!;
        break;
      }
    }
    if (!hero) hero = valid[0]!;

    out.push({
      project_id: p.id,
      project_name: p.name?.trim() || "Untitled",
      room_id: hero.id,
      room_type: hero.room_type!,
      area_m2: hero.area_m2,
      style_key: styleKey,
    });
  }
  return out;
}

async function triggerRender(
  candidate: Candidate,
): Promise<{ ok: boolean; ms: number; image_url?: string; error?: string }> {
  const t0 = Date.now();
  for (let attempt = 0; attempt <= MAX_RETRIES_ON_429; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      PER_RENDER_TIMEOUT_MS,
    );
    try {
      const res = await fetch(`${API_BASE}/api/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: candidate.project_id,
          room_id: candidate.room_id,
          force: true,
        }),
        signal: controller.signal,
      });
      const body = (await res.json().catch(() => null)) as
        | { image_url?: string; error?: string }
        | null;
      if (res.ok && body?.image_url) {
        return { ok: true, ms: Date.now() - t0, image_url: body.image_url };
      }
      const errMsg = body?.error ?? `HTTP ${res.status}`;
      // Replicate 429 surfaces as a 502 from our route with the original
      // message embedded. Extract retry_after if present.
      const m = errMsg.match(/retry_after"?:\s*(\d+)/);
      const retryAfterSec = m ? Number(m[1]!) : null;
      const is429 = errMsg.includes("429") || errMsg.includes("throttled");
      if (is429 && attempt < MAX_RETRIES_ON_429) {
        const wait = (retryAfterSec ?? 10) + 2;
        console.log(
          `[backfill]   ⟳ rate-limited; waiting ${wait}s before retry ${attempt + 1}/${MAX_RETRIES_ON_429}`,
        );
        await sleep(wait * 1000);
        continue;
      }
      return { ok: false, ms: Date.now() - t0, error: errMsg };
    } catch (err) {
      return {
        ok: false,
        ms: Date.now() - t0,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
  return { ok: false, ms: Date.now() - t0, error: "exhausted retries" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

async function runWithConcurrency<T, U>(
  items: T[],
  limit: number,
  work: (item: T, i: number) => Promise<U>,
): Promise<U[]> {
  const out: U[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i]!, i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return out;
}

async function main(): Promise<void> {
  await loadEnvLocal();

  const args = process.argv.slice(2);
  const run = args.includes("--run");
  const limitIdx = args.indexOf("--limit");
  const limit =
    limitIdx >= 0 ? Math.max(1, Number(args[limitIdx + 1] ?? 0)) : Infinity;

  console.log(`[backfill] API_BASE=${API_BASE}`);

  const all = await findCandidates();
  const candidates = Number.isFinite(limit) ? all.slice(0, limit) : all;

  console.log(
    `[backfill] ${all.length} candidate project(s) with style+plan+room.`,
  );
  for (const [i, c] of candidates.entries()) {
    console.log(
      `  ${i + 1}. ${c.project_id.slice(0, 8)}… "${c.project_name}" — ${c.style_key} / ${c.room_type} (${c.area_m2 ?? "?"} m²)`,
    );
  }
  if (!run) {
    console.log(
      `[backfill] dry run — re-invoke with --run to trigger ${candidates.length} render(s).`,
    );
    return;
  }
  if (candidates.length === 0) {
    console.log(`[backfill] nothing to do.`);
    return;
  }

  console.log(
    `[backfill] running ${candidates.length} render(s) with concurrency ${CONCURRENCY}…`,
  );
  const startedAt = Date.now();
  const results = await runWithConcurrency(
    candidates,
    CONCURRENCY,
    async (c, i) => {
      // Stagger so back-to-back requests stay under Replicate's
      // "burst 1 / 6 per minute" reduced rate limit.
      if (i > 0 && CONCURRENCY === 1) await sleep(INTER_RENDER_PAUSE_MS);
      console.log(
        `[backfill]   → ${i + 1}/${candidates.length} ${c.project_id.slice(0, 8)} ${c.room_type}`,
      );
      const r = await triggerRender(c);
      if (r.ok) {
        console.log(
          `[backfill]   ✓ ${i + 1}/${candidates.length} ${c.project_id.slice(0, 8)} in ${(r.ms / 1000).toFixed(1)}s → ${r.image_url}`,
        );
      } else {
        console.log(
          `[backfill]   ✗ ${i + 1}/${candidates.length} ${c.project_id.slice(0, 8)} after ${(r.ms / 1000).toFixed(1)}s: ${r.error}`,
        );
      }
      return r;
    },
  );

  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(
    `[backfill] done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s — ${ok} succeeded, ${failed} failed.`,
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[backfill] fatal", err);
  process.exit(1);
});
