import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";

import { PlanLayers, type PlanInspectData } from "@/app/project/[id]/plan/_components/plan-layers";
import { Button } from "@/components/blueprint/Button";
import { DocumentsExport } from "@/components/blueprint/documents/DocumentsExport";
import { StateBlock } from "@/components/blueprint/StateBlock";
import { packExportEnabled } from "@/lib/documents/pack-export/guard";
import { latestPackJobs } from "@/lib/documents/pack-export/job";
import { preflightChecklist } from "@/lib/documents/pack-export/preflight";
import { generateDrawingSet } from "@/lib/drawings/export";
import { loadBookAttention } from "@/lib/firms/book-view";
import { curateBoq, loadWithheldNames } from "@/lib/identity/curation";
import { journeyFlagsFromEnv } from "@/lib/journey";
import { stepEyebrow } from "@/lib/journey-eyebrow";
import type { RawRoomInput } from "@/lib/overlays/viewbox";
import { derivePlanGraph } from "@/lib/plan/derive";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { styleFinishes } from "@/lib/viewer/finishes";
import type { InspectBoq, RoomMeta } from "@/lib/viewer/inspect";

export const dynamic = "force-dynamic";
export const maxDuration = 120;


/** Make a fixed-size (mm) sheet SVG scale responsively inside its frame. */
function toDisplaySvg(svg: string): string {
  return svg.replace(
    /width="420mm"\s+height="297mm"/,
    'width="100%" height="auto" style="display:block"',
  );
}

const SHEET_BLURB: Record<string, string> = {
  as_built: "Dimensioned as-built plan derived from the parsed geometry.",
  proposed: "Proposed plan with demolition (terracotta) and new-work marking.",
  finish_schedule: "Room-by-room floor / wall / ceiling finishes from the locked style.",
  opening_schedule:
    "Every door, window and archway by mark — size, sill, and whether the dimensions were measured or defaulted.",
  electrical: "Electrical services plan — sockets, switches, lighting, AC & data points.",
  plumbing: "Plumbing / water services plan — WC, basin, shower, drains & heaters.",
  cover: "What the set contains, whether it is a draft and why, and what already stands on site.",
  site_plan: "Bird's-eye garden plan — every zone, overall dimensions, zone schedule and levels legend.",
  zone_plan: "One zone at a readable scale — every straight edge dimensioned in millimetres.",
  lighting_overlay: "Lighting as designed — points by fitting and an indicative cable route.",
  irrigation_overlay: "Irrigated zones, drip runs, indicative routing and drainage points. No HVAC.",
  structure_elevation: "Sectional elevation — heights, build-up and FFL levels, every figure from the plan.",
  garden_elevation: "The boundary lines in elevation, with every structure in profile at its height.",
};

export default async function DrawingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ export?: string; proposal?: string }>;
}) {
  // Whole surface is gated by DRAWINGS_ENABLED — invisible (404) when off.
  if (process.env.DRAWINGS_ENABLED !== "true") notFound();

  const { id: projectId } = await params;
  // ?export=1 (the document-route redirect) lands here — the export panel is always open now;
  // ?proposal=1 (08 Proposal → Generate) starts with the client proposal included.
  const wantsProposal = (await searchParams).proposal === "1";
  // T5: documents leave the app only through Export pack (every gate on).
  const canExport = packExportEnabled();
  const db = getSupabaseAdmin() as unknown as SupabaseClient;

  const [setResult, project, revCount, jobs] = await Promise.all([
    generateDrawingSet(projectId).then(
      (v) => ({ set: v, error: null as string | null }),
      (err: unknown) => ({ set: null, error: err instanceof Error ? err.message : "Failed to generate drawings." }),
    ),
    db.from("projects").select("firm_id").eq("id", projectId).maybeSingle<{ firm_id: string | null }>(),
    db.from("boqs").select("id", { count: "exact", head: true }).eq("project_id", projectId),
    // Only in-app runs: a CLI run releases into a local folder, and a verification read releases nothing.
    canExport ? latestPackJobs(db, projectId, 5).then((js) => js.filter((j) => j.source === "app")).catch(() => []) : Promise.resolve([]),
  ]);
  const { set, error } = setResult;
  const firmId = project.data?.firm_id ?? null;
  // Persona invariant (K2): on a firm project every member is the firm's.
  const persona = firmId ? "firm" : "owner";
  const [preflight, bookOpen] =
    canExport && set && set.sheets.length > 0
      ? await Promise.all([preflightChecklist(db, projectId, { proposal: !!firmId }), firmId ? loadBookAttention(db, firmId).catch(() => null) : Promise.resolve(null)])
      : [null, null];
  const rev = revCount.count || null;

  // Read-mode tap-to-inspect plan (P4 Step 4) — flagged with the viewer/inspect
  // feature. Same inspect data shape the 3D host builds.
  let inspectPlan:
    | { rawRooms: RawRoomInput[]; planId: string; inspect: PlanInspectData }
    | null = null;
  if (process.env.VIEWER_3D_ENABLED === "true") {
    try {
      const supabase = db;
      const graph = await derivePlanGraph(projectId);
      if (graph.walls.length > 0 && graph.planId) {
        const [{ data: rawRooms }, { data: boqRows }, { data: styleRows }] = await Promise.all([
          supabase
            .from("rooms")
            .select("id, name_en, name_ar, room_type, area_m2, polygon")
            .eq("plan_id", graph.planId)
            .order("name_en"),
          supabase
            .from("boqs")
            .select("sections")
            .eq("project_id", projectId)
            .order("created_at", { ascending: false })
            .limit(1),
          supabase
            .from("style_choices")
            .select("style_key")
            .eq("project_id", projectId)
            .is("room_id", null)
            .order("created_at", { ascending: false })
            .limit(1),
        ]);
        const rawSections = boqRows?.[0]?.sections;
        const boq: InspectBoq =
          rawSections && typeof rawSections === "object" && "sections" in rawSections
            ? curateBoq(rawSections as unknown as InspectBoq, await loadWithheldNames(supabase, projectId))
            : { sections: [] };
        const fin = styleFinishes(styleRows?.[0]?.style_key ?? null);
        const wallIdsByRoom = new Map<string, string[]>();
        for (const w of graph.walls) {
          for (const rid of w.room_ids) {
            (wallIdsByRoom.get(rid) ?? wallIdsByRoom.set(rid, []).get(rid)!).push(w.id);
          }
        }
        const roomsMeta: RoomMeta[] = graph.rooms.map((r) => ({
          id: r.id,
          name: r.name_en,
          area_m2: r.area_m2,
          floorFinish: fin.floor,
          wallFinish: fin.wall,
          ceilingFinish: fin.ceiling,
          wallIds: wallIdsByRoom.get(r.id) ?? [],
        }));
        inspectPlan = {
          rawRooms: (rawRooms ?? []) as RawRoomInput[],
          planId: graph.planId,
          inspect: { projectId, boq, rooms: roomsMeta },
        };
      }
    } catch {
      /* read-mode plan is best-effort */
    }
  }

  const isGardenSet = !!set?.sheets.some((s) => s.kind === "site_plan");
  const eyebrow = stepEyebrow(persona, "documents", "downloads", journeyFlagsFromEnv(), "Documents");
  const checkedAt = new Date()
    .toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Dubai" })
    .replace(",", "")
    .toUpperCase();

  return (
    <div className="mx-auto max-w-[1344px] px-6 py-8 pb-24 lg:px-10">
      <p className="t-label-caps text-bp-brass-text">{eyebrow}</p>
      <h1 className="t-heading-lg mt-2 text-bp-ink-primary">{canExport ? "Export pack" : "Drawings"}</h1>
      <p className="t-body-md mt-2 max-w-[760px] text-bp-ink-secondary">
        {canExport
          ? `Every document leaves through one gate. Drawings, renders and BoQ are checked together${rev ? ` against rev ${rev}` : ""}; nothing downloads until its checks pass.`
          : "Deterministic, dimensioned drawings derived from your plan geometry — no AI in this output."}
      </p>

      {error || !set || set.sheets.length === 0 ? (
        <div className="mt-8 max-w-[720px]">
          {error ? (
            <StateBlock
              kind="error"
              title="The drawings could not be generated"
              actions={
                <Button kind="primary" tone="inverse" href={`/project/${projectId}/plan`}>
                  Open the plan
                </Button>
              }
            >
              {error} Nothing was saved or sent.
            </StateBlock>
          ) : (
            <StateBlock
              kind="empty"
              icon="draft"
              title="No drawings yet"
              actions={
                <Button kind="primary" href={`/project/${projectId}/plan`}>
                  Open the plan
                </Button>
              }
            >
              The drawing set is generated from the confirmed plan. Confirm or draw the plan and the sheets appear here, dimensioned.
            </StateBlock>
          )}
        </div>
      ) : (
        <>
          {canExport && preflight ? (
            <div className="mt-8">
              <DocumentsExport projectId={projectId} rev={rev} checkedAt={checkedAt} initial={preflight} initialProposal={wantsProposal} latestJobId={jobs[0]?.id ?? null} sheetCount={set.sheets.length} bookOpen={bookOpen} />
            </div>
          ) : null}

          {inspectPlan ? (
            <section className="mt-10" aria-labelledby="explore-h">
              <h2 id="explore-h" className="t-label-caps text-bp-ink-tertiary">
                EXPLORE YOUR PLAN — TAP A ROOM TO SEE WHAT IT IS AND WHAT IT COSTS
              </h2>
              {/* The canvas on the sunken surface, as on 02 Scope (K5): its internals are the editor's own. */}
              <div className="mt-3 border border-bp-line-hairline bg-bp-surface-sunken p-4">
                <PlanLayers
                  mode="read"
                  projectId={projectId}
                  planId={inspectPlan.planId}
                  initialRooms={inspectPlan.rawRooms}
                  initialTotalAreaM2={null}
                  overlaysEnabled={process.env.OVERLAYS_ENABLED === "true"}
                  inspect={inspectPlan.inspect}
                />
              </div>
            </section>
          ) : null}

          <section className="mt-10" aria-labelledby="sheets-h">
            <h2 id="sheets-h" className="t-label-caps text-bp-ink-tertiary">
              {isGardenSet ? "DRAWING SET · A3 · SCALED TO FIT" : "DRAWING SET · A3 · 1:100"} · {set.sheets.length} SHEET{set.sheets.length === 1 ? "" : "S"}
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
              {set.sheets.map((sheet) => (
                <article key={sheet.sheetNumber} className="flex flex-col border border-bp-line-hairline bg-bp-surface-raised p-4" data-sheet={sheet.sheetNumber}>
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="t-heading-sm text-bp-ink-primary">{sheet.title}</h3>
                    <span className="t-num-sm text-bp-ink-tertiary">{sheet.sheetNumber}</span>
                  </div>
                  {/* A sheet is paper: it stays white in either theme, inside a hairline frame. */}
                  <div
                    className="mt-3 border border-bp-line-hairline bg-white"
                    role="img"
                    aria-label={`Sheet ${sheet.sheetNumber} — ${sheet.title}`}
                    // Deterministic, server-generated SVG (no user input) — safe to inline.
                    dangerouslySetInnerHTML={{ __html: toDisplaySvg(sheet.svg) }}
                  />
                  <p className="t-body-sm mt-3 flex-1 text-bp-ink-secondary">{SHEET_BLURB[sheet.kind]}</p>
                </article>
              ))}
            </div>
          </section>

          {set.derivedNotes.length > 0 ? (
            <section className="mt-10 border-t border-bp-line-hairline pt-4" aria-labelledby="derived-h">
              <h2 id="derived-h" className="t-label-caps text-bp-ink-tertiary">
                CONFIDENCE — DERIVED VALUES
              </h2>
              <ul className="t-body-sm mt-3 space-y-1 text-bp-ink-secondary">
                {set.derivedNotes.map((n, i) => (
                  <li key={i}>· {n}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
