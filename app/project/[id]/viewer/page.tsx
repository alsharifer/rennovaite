import { curateBoq, loadWithheldNames } from "@/lib/identity/curation";
import { notFound } from "next/navigation";

import { Button } from "@/components/blueprint/Button";
import { PageHeader } from "@/components/blueprint/PageHeader";
import { StateBlock } from "@/components/blueprint/StateBlock";
import { loadProjectRail } from "@/components/blueprint/shell/ProjectShell";
import type { BackTargets, ViewerData } from "@/components/blueprint/viewer/Viewer3D";
import { ViewerLoader } from "@/components/blueprint/viewer/ViewerLoader";
import { FIRM_STEPS, OWNER_STEPS, journeyFlagsFromEnv, ownerStepHref } from "@/lib/journey";
import { roomFacts } from "@/lib/viewer/room-facts";
import { derivePlanGraph } from "@/lib/plan/derive";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { buildScene } from "@/lib/viewer/scene";
import { styleFinishes, styleFloorColor } from "@/lib/viewer/finishes";
import { buildFinishPlan } from "@/lib/viewer/materials";
import type { InspectBoq, RoomMeta, WallMeta } from "@/lib/viewer/inspect";

export const dynamic = "force-dynamic";
export const maxDuration = 60;


// K8 #9 — the 3D view (spec §6.8, Figma 62:1017): a side surface, off the
// numbered journey (the rail keeps the step you came from). The scene, the
// finishes and the inspect data are built here exactly as before; the screen
// is components/blueprint/viewer.
export default async function ViewerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (process.env.VIEWER_3D_ENABLED !== "true") notFound();

  const { id: projectId } = await params;
  const supabase = getSupabaseAdmin();

  const graph = await derivePlanGraph(projectId);

  // Empty state — never a blank canvas or a crash.
  if (graph.walls.length === 0) {
    return (
      <div className="mx-auto max-w-[1344px] px-6 pb-16 pt-8 lg:px-12" data-viewer-empty>
        <PageHeader eyebrow="3D VIEW" title="Your plan in 3D" />
        <div className="mt-8 max-w-[720px]">
          {graph.rooms.length > 0 ? (
            // An open garden: zones, no walls — its 3D design views are on Renders.
            <StateBlock kind="empty" icon="view_in_ar" title="Nothing to stand up in 3D yet" actions={<Button kind="primary" href={`/project/${projectId}/render`}>Open renders</Button>}>
              The 3D view builds the walls of your rooms. Your plan has open zones and no walls, so its 3D design views are on Renders.
            </StateBlock>
          ) : (
            <StateBlock kind="empty" icon="view_in_ar" title="We need a confirmed plan" actions={<Button kind="primary" href={`/project/${projectId}/plan`}>Open plan</Button>}>
              The 3D view is built from your plan&apos;s rooms and walls. Confirm the plan and it appears here.
            </StateBlock>
          )}
        </div>
      </div>
    );
  }

  // Locked style → floor tint.
  const { data: styleRows } = await supabase
    .from("style_choices")
    .select("style_key")
    .eq("project_id", projectId)
    .is("room_id", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const styleKey = styleRows?.[0]?.style_key ?? null;
  const floorColor = styleFloorColor(styleKey);
  const floorColorByRoom = Object.fromEntries(graph.rooms.map((r) => [r.id, floorColor]));

  const scene = buildScene(graph, { floorColorByRoom });

  // F1 textured walkthrough. Flag off => `finishes` is undefined and the
  // viewer renders exactly the clay model it rendered before this existed —
  // same scene object, same materials, same pixels.
  //
  // Note this reads the SAME `styleKey` the clay floor tint already used, so
  // changing the StyleBoard selection changes the walkthrough on next load with
  // no extra wiring and no cache to invalidate.
  const finishes =
    process.env.TEXTURED_WALKTHROUGH === "true"
      ? buildFinishPlan(
          styleKey,
          graph.rooms.map((r) => ({ id: r.id, type: r.type })),
        )
      : undefined;

  // P4 tap-to-inspect data: latest BoQ (with element_refs) + element metadata.
  const { data: boqRows } = await supabase
    .from("boqs")
    .select("sections")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1);
  const rawSections = boqRows?.[0]?.sections;
  const boq: InspectBoq =
    rawSections && typeof rawSections === "object" && "sections" in rawSections
      ? curateBoq(rawSections as unknown as InspectBoq, await loadWithheldNames(supabase, projectId))
      : { sections: [] };

  const roomNameById = new Map(graph.rooms.map((r) => [r.id, r.name_en]));
  const fin = styleFinishes(styleKey);
  const wallIdsByRoom = new Map<string, string[]>();
  for (const w of graph.walls) {
    for (const rid of w.room_ids) {
      (wallIdsByRoom.get(rid) ?? wallIdsByRoom.set(rid, []).get(rid)!).push(w.id);
    }
  }
  const ceilingByRoom = new Map(graph.rooms.map((r) => [r.id, r.ceiling_h_m || 2.9]));
  const globalCeiling = graph.rooms.reduce((mx, r) => Math.max(mx, r.ceiling_h_m || 0), 0) || 2.9;

  const inspectRooms: RoomMeta[] = graph.rooms.map((r) => ({
    id: r.id,
    name: r.name_en,
    area_m2: r.area_m2,
    floorFinish: fin.floor,
    wallFinish: fin.wall,
    ceilingFinish: fin.ceiling,
    wallIds: wallIdsByRoom.get(r.id) ?? [],
  }));
  const inspectWalls: WallMeta[] = graph.walls.map((w) => {
    const a = w.polyline[0]!;
    const b = w.polyline[w.polyline.length - 1]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const h = w.room_ids.reduce((mx, id) => Math.max(mx, ceilingByRoom.get(id) ?? 0), 0) || globalCeiling;
    return {
      id: w.id,
      roomName: roomNameById.get(w.room_ids[0] ?? "") ?? null,
      length_m: length,
      height_m: h,
      thickness_mm: w.thickness_mm,
      net_area_m2: length * h,
      wallFinish: fin.wall,
    };
  });
  const data: ViewerData = { projectId, boq, rooms: inspectRooms, walls: inspectWalls, facts: roomFacts(graph) };

  // "Back to …" the step you came from (remembered in the browser), else the
  // step the 3D view is most often opened from.
  const rail = await loadProjectRail(projectId);
  const flags = journeyFlagsFromEnv();
  const back: BackTargets =
    rail?.persona === "firm"
      ? { steps: Object.fromEntries(FIRM_STEPS.map((x) => [x.key, { label: x.label, href: x.href(projectId) }])), fallback: "scope" }
      : { steps: Object.fromEntries(OWNER_STEPS.map((x) => [x.key, { label: x.label, href: ownerStepHref(x.key, projectId, flags) }])), fallback: "renders" };

  return <ViewerLoader scene={scene} data={data} finishes={finishes} back={back} />;
}
