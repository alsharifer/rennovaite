// =============================================================================
// scripts/lib/garden-render-run.ts — render every view of a garden, in the order
// that keeps them consistent (garden pilot G5c).
//
// Cross-view consistency needs ONE view to be the reference every other view is
// conditioned on, and that view has to be a render that PASSED its own
// faithfulness gate. So the anchor is found first, from a short list of the views
// a pack most wants as renders — the pergola, the aerial, the whole-garden view,
// the biggest clean zone — taken in order until one passes. Every remaining day
// view is then rendered against it; the candidates that failed before an anchor
// existed get one more go with it; then the consistency gate compares them all.
// Evenings come last: an evening relights a passed day render.
//
// Shared by the client draft pack and the reference pack, so both are rendered
// and checked the same way.
// =============================================================================

export interface CameraRow {
  id: string;
  label: string;
  zone_id: string | null;
  lit: boolean;
  clean: boolean;
  mode: string;
  clean_reasons: string[];
}

export interface RenderedView {
  camera: string;
  label: string;
  outcome: string;
  cached: boolean;
  seconds: number;
  render_id: string | null;
}

export interface RenderRunResult {
  anchor: { camera: string | null; render_id: string | null; outcome: string; candidates: string[] };
  day: RenderedView[];
  evening: RenderedView[];
  consistency: { render_id: string; camera: string; passed: boolean; failures: string[]; status: string }[];
}

type Post = (path: string, body: unknown) => Promise<{ status: number; body: Record<string, unknown> }>;
type Get = <T>(path: string) => Promise<{ status: number; body: T }>;

/**
 * The views a pack most wants as a styled render, best first. They are the anchor
 * candidates, and every one of them is rendered anyway.
 */
export function anchorCandidates(cameras: readonly CameraRow[]): CameraRow[] {
  const pergola = cameras.filter((c) => c.zone_id !== null && /pergola|structure/i.test(c.label));
  const aerial = cameras.filter((c) => c.mode === "aerial");
  const whole = cameras.filter((c) => c.zone_id === null && c.mode !== "aerial");
  const zones = cameras.filter((c) => c.zone_id !== null && !pergola.includes(c) && c.clean);
  return [...pergola, ...aerial, ...whole, ...zones].slice(0, 4);
}

export async function renderAllViews(opts: {
  projectId: string;
  get: Get;
  post: Post;
  log?: (line: string) => void;
  concurrency?: number;
  /**
   * Condition every view on the anchor IMAGE as well as the shared specification
   * text. Measured on the client garden (G5c): it moved the pass rate from 10/13
   * to 4/13 — a second image pulls composition towards itself, exactly as the G4b
   * style-image calibration found. Off by default; the shared reference is the
   * design specification, and consistency is enforced by the gate, not the prompt.
   */
  anchorImage?: boolean;
}): Promise<RenderRunResult & { cameras: CameraRow[] }> {
  const { projectId, get, post } = opts;
  const log = opts.log ?? ((l: string) => console.log(l));
  const cams = (await get<{ cameras: CameraRow[]; error?: string }>(`/api/render/scene?project_id=${projectId}`)).body;
  if (!cams.cameras) throw new Error(`cameras: ${cams.error}`);
  const cameras = cams.cameras;

  const one = async (camera: CameraRow, view: "day" | "evening", anchorRenderId: string | null): Promise<RenderedView> => {
    const t0 = Date.now();
    const r = await post("/api/render/scene", { project_id: projectId, camera_id: camera.id, view, ...(anchorRenderId && view === "day" ? { anchor_render_id: anchorRenderId } : {}) });
    const row: RenderedView = {
      camera: camera.id,
      label: camera.label,
      outcome: String(r.body.outcome ?? `ERROR ${r.body.error}`),
      cached: r.body.cached === true,
      seconds: Math.round((Date.now() - t0) / 1000),
      render_id: (r.body.render_id as string | undefined) ?? null,
    };
    log(`  ${view.padEnd(7)} ${camera.label.slice(0, 40).padEnd(40)} ${row.outcome}${row.cached ? " (cached)" : ""} ${row.seconds}s`);
    return row;
  };

  // 1. The anchor: candidates in order until one passes its own gate.
  const candidates = anchorCandidates(cameras);
  const day = new Map<string, RenderedView>();
  let anchor: { camera: string; render_id: string } | null = null;
  for (const c of candidates) {
    const row = await one(c, "day", null);
    day.set(c.id, row);
    if (row.outcome === "passed" && row.render_id) {
      anchor = { camera: c.id, render_id: row.render_id };
      log(`  anchor: ${c.label} — every other view is conditioned to match it`);
      break;
    }
    log(`  ${c.label} did not pass; trying the next anchor candidate`);
  }
  if (!anchor) log("  no view passed on its own: the rest are rendered without a reference image");

  // 2. Every other day view, against the anchor.
  const queue = cameras.filter((c) => !day.has(c.id));
  const workers = opts.concurrency ?? 3;
  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (let c = queue.shift(); c; c = queue.shift()) day.set(c.id, await one(c, "day", opts.anchorImage ? (anchor?.render_id ?? null) : null));
    }),
  );

  // 3. The candidates that failed before the anchor existed get one more go with it.
  if (anchor && opts.anchorImage) {
    for (const c of candidates) {
      if (c.id === anchor.camera) continue;
      const row = day.get(c.id);
      if (row && row.outcome !== "passed") {
        log(`  retrying ${c.label} against the anchor`);
        day.set(c.id, await one(c, "day", anchor.render_id));
      }
    }
  }

  // 4. Cross-view consistency, against the anchor.
  let consistency: RenderRunResult["consistency"] = [];
  if (anchor) {
    const r = await post("/api/render/consistency", { project_id: projectId, anchor_render_id: anchor.render_id });
    consistency = (r.body.results as RenderRunResult["consistency"]) ?? [];
    for (const c of consistency.filter((x) => !x.passed)) log(`  consistency FAIL ${c.camera} — ${c.failures.join("; ")}`);
  }

  // 5. Evenings, over the day renders that passed.
  const evening: RenderedView[] = [];
  const litQueue = cameras.filter((c) => c.lit);
  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (let c = litQueue.shift(); c; c = litQueue.shift()) evening.push(await one(c, "evening", null));
    }),
  );

  return {
    cameras,
    anchor: { camera: anchor?.camera ?? null, render_id: anchor?.render_id ?? null, outcome: anchor ? "passed" : "none", candidates: candidates.map((c) => c.label) },
    day: [...day.values()],
    evening,
    consistency,
  };
}
