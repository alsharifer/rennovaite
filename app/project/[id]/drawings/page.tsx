import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app/AppShell";
import { PlanLayers, type PlanInspectData } from "@/app/project/[id]/plan/_components/plan-layers";
import { generateDrawingSet } from "@/lib/drawings/export";
import type { RawRoomInput } from "@/lib/overlays/viewbox";
import { derivePlanGraph } from "@/lib/plan/derive";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { styleFinishes } from "@/lib/viewer/finishes";
import type { InspectBoq, RoomMeta } from "@/lib/viewer/inspect";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const PAGE_NAME = "Drawings";

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
  electrical: "Electrical services plan — sockets, switches, lighting, AC & data points.",
  plumbing: "Plumbing / water services plan — WC, basin, shower, drains & heaters.",
};

export default async function DrawingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Whole surface is gated by DRAWINGS_ENABLED — invisible (404) when off.
  if (process.env.DRAWINGS_ENABLED !== "true") notFound();

  const { id: projectId } = await params;

  let set: Awaited<ReturnType<typeof generateDrawingSet>> | null = null;
  let error: string | null = null;
  try {
    set = await generateDrawingSet(projectId);
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to generate drawings.";
  }

  // Read-mode tap-to-inspect plan (P4 Step 4) — flagged with the viewer/inspect
  // feature. Same inspect data shape the 3D host builds.
  let inspectPlan:
    | { rawRooms: RawRoomInput[]; planId: string; inspect: PlanInspectData }
    | null = null;
  if (process.env.VIEWER_3D_ENABLED === "true") {
    try {
      const supabase = getSupabaseAdmin();
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
            ? (rawSections as unknown as InspectBoq)
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

  return (
    <AppShell pageName={PAGE_NAME}>
      <div className="mx-auto max-w-[1440px] pb-24">
        <header className="mb-xl">
          <p className="label-caps mb-md text-brass-600">Drawing set · A3 · 1:100</p>
          <h1 className="mb-md font-display text-headline-lg text-ink-900">
            Auto-generated drawings
          </h1>
          <p className="max-w-[720px] font-body text-body-lg text-on-surface-variant">
            Deterministic, dimensioned drawings derived from your plan geometry —
            no AI in this output. Download each sheet as a print-ready A3 PDF.
          </p>
        </header>

        {error || !set ? (
          <div className="rounded-md border border-ink-100 bg-paper p-lg">
            <p className="text-body-md text-error">
              {error ?? "No drawings available."}
            </p>
            <Link
              href={`/project/${projectId}/plan`}
              className="focus-ring mt-md inline-flex text-body-sm font-semibold text-brass-600"
            >
              Back to plan
            </Link>
          </div>
        ) : (
          <>
            {inspectPlan && (
              <section className="mb-xl rounded-xl border border-ink-100 bg-paper p-lg">
                <p className="label-caps mb-md text-ink-500">
                  Explore your plan — tap a room to see what it is and what it costs
                </p>
                <PlanLayers
                  mode="read"
                  projectId={projectId}
                  planId={inspectPlan.planId}
                  initialRooms={inspectPlan.rawRooms}
                  initialTotalAreaM2={null}
                  overlaysEnabled={process.env.OVERLAYS_ENABLED === "true"}
                  inspect={inspectPlan.inspect}
                />
              </section>
            )}

            <div className="grid grid-cols-1 gap-gutter lg:grid-cols-3">
              {set.sheets.map((sheet) => (
                <article
                  key={sheet.kind}
                  className="flex flex-col rounded-xl border border-ink-100 bg-paper p-lg"
                >
                  <div className="mb-md flex items-baseline justify-between">
                    <h2 className="font-display text-headline-md text-ink-900">
                      {sheet.title}
                    </h2>
                    <span className="font-mono text-[12px] text-ink-500">
                      {sheet.sheetNumber}
                    </span>
                  </div>
                  <div
                    className="matte-image mb-md"
                    // Deterministic, server-generated SVG (no user input) — safe to inline.
                    dangerouslySetInnerHTML={{ __html: toDisplaySvg(sheet.svg) }}
                  />
                  <p className="mb-md flex-1 font-body text-body-sm text-on-surface-variant">
                    {SHEET_BLURB[sheet.kind]}
                  </p>
                  <a
                    href={`/api/projects/${projectId}/drawings?format=pdf&sheet=${sheet.kind}`}
                    className="focus-ring inline-flex h-10 items-center justify-center gap-sm self-start rounded-lg border border-ink-100 bg-paper px-lg font-body-sm text-body-sm font-semibold text-ink-900 transition-colors hover:bg-surface-container"
                  >
                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                      download
                    </span>
                    Download PDF
                  </a>
                </article>
              ))}
            </div>

            {set.derivedNotes.length > 0 && (
              <section className="mt-xl rounded-xl border border-ink-100 bg-paper p-lg">
                <p className="label-caps mb-md text-ink-500">
                  Confidence — derived values
                </p>
                <ul className="flex flex-col gap-xs">
                  {set.derivedNotes.map((n, i) => (
                    <li key={i} className="flex gap-sm font-body text-body-sm text-on-surface-variant">
                      <span className="text-brass-600" aria-hidden="true">•</span>
                      {n}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
