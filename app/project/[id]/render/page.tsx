import { OpeningsAutoDetect } from "@/components/blueprint/plan/OpeningsAutoDetect";
import { renderOpeningsLabel, type OpeningsBasis } from "@/lib/plan/openings-vocab";
import { viewerHref } from "@/lib/viewer/available";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";

import { loadProjectPhotoAssets } from "@/lib/assets/load";
import { roomRollup } from "@/lib/boq/elements";
import type { TakeoffItem, WorkItemKey } from "@/lib/boq/quantify";
import { resolveAnyStyle } from "@/lib/garden-styles";
import { loadRenders } from "@/lib/render-batch/load";
import { currentDayRender, planBatch, planSceneBatch, type BatchFixture, type SceneRenderRow } from "@/lib/render-batch/plan";
import { isExteriorRoomType, roomTypeFromDb } from "@/lib/render-prompts";
import { loadGardenSceneContext } from "@/lib/scene-render/pipeline";
import { getStyleByKey } from "@/lib/styles";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { Button } from "@/components/blueprint/Button";
import { StateBlock } from "@/components/blueprint/StateBlock";
import { RendersStudio } from "@/components/blueprint/renders/RendersStudio";
import { journeyFlagsFromEnv, ownerStepHref } from "@/lib/journey";
import { outOfScopeRoomIds } from "@/lib/plan/scope-load";
import type { PhotoViewsInitial } from "@/components/blueprint/renders/PhotoViewStudio";
import { loadMiniPlans, loadPhotoViews } from "@/lib/render/photo-views-load";
import { loadStudioState } from "@/lib/render/photo-view-anchor";
import { photoViewCostAed, photoViewMaxAttempts } from "@/lib/render/photo-view-run";
import { projectRenderSpend } from "@/lib/render/render-spend";
import { loadMaterialState } from "@/lib/render/material-labels-load";
import { roomRenderCheckRows, type DesignCheckRow, type QaLike, type SceneGateLike } from "@/lib/render/design-check-items";

export const dynamic = "force-dynamic";

type RenderRow = {
  id: string;
  room_id: string | null;
  prompt: string | null;
  image_url: string | null;
  parent_render_id: string | null;
  qa: unknown;
  created_at: string | null;
  /** R10b (060). */
  openings_basis?: OpeningsBasis | null;
};

type RenderItem = {
  id: string;
  imageUrl: string;
  prompt: string;
  qa?: "passed" | "failed" | null;
  qaReason?: string | null;
  openings?: string | null;
};

// K8 #5 (spec §6.4, Figma 57:612 · phone 66:1443): the renders studio, Blueprint.
function NotReady({ projectId, title, body }: { projectId: string; title: string; body: string }) {
  return (
    <div className="mx-auto max-w-[720px] px-6 py-10">
      <StateBlock kind="empty" icon="photo_camera" title={title} actions={<Button kind="primary" href={`/project/${projectId}/plan`}>Open the plan</Button>}>
        {body}
      </StateBlock>
    </div>
  );
}

// The stored qa jsonb is {passed, reason, ...} (or null). Flatten it to the
// compact shape the render UI consumes so a QA-flagged render still shows its
// warning after a page reload.
function qaFrom(qa: unknown): Pick<RenderItem, "qa" | "qaReason"> {
  if (qa && typeof qa === "object" && "passed" in qa) {
    const passed = (qa as { passed: unknown }).passed;
    const reason =
      "reason" in qa && typeof (qa as { reason: unknown }).reason === "string"
        ? (qa as { reason: string }).reason
        : null;
    return {
      qa: passed ? "passed" : "failed",
      qaReason: passed ? null : reason,
    };
  }
  return { qa: null, qaReason: null };
}

// For each room: walk back from the most-recent leaf (a render with no
// children) to its root via parent_render_id, building a linear chain.
// Orphan branches from earlier styles are excluded.
function buildInitialChains(
  rows: RenderRow[],
): Record<string, RenderItem[]> {
  const byRoom: Record<string, RenderRow[]> = {};
  for (const r of rows) {
    if (!r.room_id || !r.image_url || !r.prompt) continue;
    (byRoom[r.room_id] ??= []).push(r);
  }

  const result: Record<string, RenderItem[]> = {};
  for (const [roomId, list] of Object.entries(byRoom)) {
    const byId = new Map(list.map((r) => [r.id, r]));
    const hasChild = new Set<string>();
    for (const r of list) {
      if (r.parent_render_id) hasChild.add(r.parent_render_id);
    }
    const leaves = list.filter((r) => !hasChild.has(r.id));
    if (leaves.length === 0) continue;
    leaves.sort((a, b) =>
      (b.created_at ?? "").localeCompare(a.created_at ?? ""),
    );
    const leaf = leaves[0];

    const chain: RenderItem[] = [];
    let cur: RenderRow | undefined = leaf;
    while (cur) {
      if (cur.image_url && cur.prompt) {
        chain.unshift({
          id: cur.id,
          imageUrl: cur.image_url,
          prompt: cur.prompt,
          ...qaFrom(cur.qa),
          openings: renderOpeningsLabel(cur.openings_basis),
        });
      }
      cur = cur.parent_render_id ? byId.get(cur.parent_render_id) : undefined;
    }
    if (chain.length > 0) result[roomId] = chain;
  }
  return result;
}

export default async function RenderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ room?: string }>;
}) {
  const { id: projectId } = await params;
  const { room: initialRoomId } = await searchParams;
  const supabase = getSupabaseAdmin();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .maybeSingle();

  const { data: plan } = await supabase
    .from("plans")
    .select("id, total_area_m2")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Whole-project style choice (room_id null), most recent first.
  const { data: styleChoiceRows } = await supabase
    .from("style_choices")
    .select("style_key")
    .eq("project_id", projectId)
    .is("room_id", null)
    .order("created_at", { ascending: false })
    .limit(1);

  const styleChoice = styleChoiceRows?.[0] ?? null;
  // G1b: a project may have locked either family, so resolve both rather than
  // showing nothing for a garden direction.
  const style = resolveAnyStyle(styleChoice?.style_key ?? null, getStyleByKey);

  // A missing PROJECT is a 404 and uses the shared boundary. A missing PLAN is
  // not: the project exists and the user simply has not confirmed a layout yet,
  // which is a step in the journey rather than a broken link.
  if (!project) notFound();
  if (!plan) return <NotReady projectId={projectId} title="No plan yet" body="Renders are made room by room from your plan. Add your floor plan first." />;

  const { data: rooms } = await supabase
    .from("rooms")
    .select("id, name_en, room_type, area_m2, polygon")
    .eq("plan_id", plan.id)
    .order("name_en");

  // K12 (058): only the rooms in this renovation are rendered; the rest sit behind "N not in this renovation".
  const outOfScope = await outOfScopeRoomIds(supabase as unknown as import("@supabase/supabase-js").SupabaseClient, projectId);
  const roomList = (rooms ?? []).filter((r) => !outOfScope.has(r.id));
  const notInScope = (rooms ?? []).filter((r) => outOfScope.has(r.id)).map((r) => r.name_en ?? "Room");

  // Latest uploaded photo per room, so the room card rehydrates on load.
  const roomIds = roomList.map((r) => r.id);
  const initialPhotosByRoom: Record<string, string> = {};
  if (roomIds.length > 0) {
    const { data: photoRows } = await supabase
      .from("room_photos")
      .select("room_id, public_url, created_at")
      .in("room_id", roomIds)
      .order("created_at", { ascending: false });
    for (const p of photoRows ?? []) {
      if (p.room_id && p.public_url && !initialPhotosByRoom[p.room_id]) {
        initialPhotosByRoom[p.room_id] = p.public_url;
      }
    }
  }

  // Project-wide photo library for the render photo picker (empty until
  // migration 024 is applied — the panel then falls back to upload-only).
  const initialPhotoAssets = await loadProjectPhotoAssets(projectId);

  // Fetch every render for this project, then reconstruct a linear chain
  // per room (root → … → latest leaf). This rehydrates the iteration UI on
  // page load so users see their previous renders instead of starting blank.
  // R10b: openings_basis (060) first; an older database reads without it.
  const sbRows = supabase as unknown as SupabaseClient;
  let renderRes: { data: (RenderRow & { status?: string })[] | null; error: { message: string } | null } = await sbRows
    .from("renders")
    .select("id, room_id, prompt, image_url, parent_render_id, qa, created_at, status, openings_basis")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (renderRes.error) {
    renderRes = await sbRows
      .from("renders")
      .select("id, room_id, prompt, image_url, parent_render_id, qa, created_at, status")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });
  }
  const renderRows = renderRes.data;

  // G4: an evening view is an edit of a day render, not the next step in the
  // zone's iteration chain — keep it out of the chain, or it would become the
  // "latest" render and every tweak would edit the night scene.
  const sbAny = supabase as unknown as SupabaseClient;
  const viewRows = await loadRenders(sbAny, projectId);
  const eveningIds = new Set(viewRows.filter((r) => r.view === "evening").map((r) => r.id));
  const initialChains = buildInitialChains(
    // R10a: an edit that came back unchanged is on record, never a version.
    (renderRows ?? []).filter((r) => !eveningIds.has(r.id) && (r as { status?: string }).status !== "unchanged"),
  );

  // The evening view shown beside a zone is the one made from its CURRENT day.
  const initialEvenings: Record<string, { id: string; imageUrl: string }> = {};
  for (const room of roomList) {
    const day = currentDayRender(viewRows, room.id);
    if (!day) continue;
    const evening = viewRows
      .filter((r) => r.view === "evening" && r.parent_render_id === day.id && r.status === "succeeded" && r.image_url)
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0];
    if (evening) initialEvenings[room.id] = { id: evening.id, imageUrl: evening.image_url! };
  }

  // G4 "Generate all": every zone and view still to render.
  const { data: fixtureRows } = await sbAny
    .from("plan_fixtures")
    .select("type, room_id, position, spec")
    .eq("project_id", projectId);
  // G4b: a garden plans by camera (plan-faithful pipeline); anything else by room.
  const renderableTypes = roomList.map((r) => roomTypeFromDb(r.room_type)).filter((t) => t !== null);
  const gardenOnly = renderableTypes.length > 0 && renderableTypes.every((t) => isExteriorRoomType(t));
  let batchJobs = planBatch({
    rooms: roomList,
    renders: viewRows,
    fixtures: (fixtureRows ?? []) as BatchFixture[],
  });
  if (gardenOnly) {
    try {
      const ctx = await loadGardenSceneContext(projectId);
      const { data: sceneRows } = await sbAny
        .from("renders")
        .select("id, camera, view, status, gate")
        .eq("project_id", projectId)
        .eq("mode", "scene");
      batchJobs = planSceneBatch(
        // K12: a camera on a zone left out of the renovation is not rendered (whole-garden views stay).
        ctx.cameras.filter((c) => !c.zoneId || !outOfScope.has(c.zoneId)).map((c) => ({ id: c.id, label: c.label, zone_id: c.zoneId, lit: c.lit })),
        (sceneRows ?? []) as SceneRenderRow[],
      );
    } catch {
      /* no style yet, or no plan: the room plan stands */
    }
  }

  // Rooms that already have an approved/locked design — these gate the
  // floating Cost-it CTA on the right.
  const { data: approvedRows } = await supabase
    .from("approved_designs")
    .select("room_id")
    .eq("project_id", projectId);

  const initialLockedRoomIds = Array.from(
    new Set(
      (approvedRows ?? [])
        .map((r) => r.room_id)
        .filter((v): v is string => typeof v === "string"),
    ),
  );

  if (roomList.length === 0 && notInScope.length > 0) return <NotReady projectId={projectId} title="No room is in this renovation" body="Choose the rooms this renovation covers on your plan — each one gets a view here." />;
  if (roomList.length === 0) return <NotReady projectId={projectId} title="No rooms on the plan yet" body="Confirm the rooms on your plan — every room gets a view here." />;

  // P4: per-room element-mapped BoQ totals for the "This room on your BoQ" chip.
  const roomBoqTotals: Record<string, number> = {};
  try {
    const sb = supabase as unknown as SupabaseClient;
    const { data: tRows } = await sb
      .from("takeoff_items")
      .select("work_item_key, room_id, element_id, qty, unit, wet_area")
      .eq("project_id", projectId)
      .returns<
        {
          work_item_key: string;
          room_id: string | null;
          element_id: string | null;
          qty: number;
          unit: string;
          wet_area: boolean;
        }[]
      >();
    const items: TakeoffItem[] = (tRows ?? []).map((r) => ({
      work_item_key: r.work_item_key as WorkItemKey,
      room_id: r.room_id,
      element_id: r.element_id ?? "",
      qty: Number(r.qty),
      unit: r.unit,
      wet_area: !!r.wet_area,
    }));
    for (const r of roomRollup(items)) roomBoqTotals[r.room_id] = r.total_aed;
  } catch {
    /* takeoff_items absent → no chips */
  }

  // P7: furniture-staging flag + rooms already opted into the furniture budget.
  const stagingEnabled = process.env.STAGING_ENABLED === "true";
  let initialFurnitureOptIns: string[] = [];
  if (stagingEnabled) {
    try {
      const sb = supabase as unknown as SupabaseClient;
      const { data: optRows } = await sb
        .from("furniture_opt_ins")
        .select("room_id")
        .eq("project_id", projectId)
        .returns<{ room_id: string }[]>();
      initialFurnitureOptIns = (optRows ?? []).map((r) => r.room_id);
    } catch {
      /* furniture_opt_ins absent → none pre-checked */
    }
  }

  // Every finished render's image and check verdict, by id: a garden camera or an
  // evening view shows its own render, with the gate's outcome (G4b) or the QA verdict.
  const renderInfo: Record<string, { id: string; imageUrl: string; prompt: string; qa: "passed" | "failed" | null; qaReason: string | null; outcome: "passed" | "substituted" | null; checks: DesignCheckRow[] | null }> = {};
  try {
    const { data: infoRows } = await sbAny.from("renders").select("id, image_url, prompt, qa, gate, mode").eq("project_id", projectId).not("image_url", "is", null);
    for (const r of (infoRows ?? []) as { id: string; image_url: string; prompt: string | null; qa: unknown; gate: { outcome?: string } | null; mode: string | null }[]) {
      const outcome = r.gate?.outcome === "passed" || r.gate?.outcome === "substituted" ? r.gate.outcome : null;
      const q = qaFrom(r.qa);
      // C5 #2: the design check itemised (a photo view's rows are the studio's own — PhotoViewStudio).
      const checks = r.mode === "photo_view" ? null : roomRenderCheckRows({ qa: (r.qa && typeof r.qa === "object" ? r.qa : null) as QaLike | null, scene: r.gate as SceneGateLike | null });
      renderInfo[r.id] = { id: r.id, imageUrl: r.image_url, prompt: r.prompt ?? "", qa: q.qa ?? null, qaReason: q.qaReason ?? null, outcome, checks };
    }
  } catch {
    /* a pre-G4b table: chains and evenings still show */
  }

  // R10b: a plan read before R10b is read for openings the first time Renders opens.
  const detectRes = plan
    ? await sbRows.from("plans").select("pdf_url, source, openings_detected_at").eq("id", plan.id).maybeSingle<{ pdf_url: string | null; source: string | null; openings_detected_at: string | null }>()
    : null;
  const detectNeeded = !!plan && !!detectRes && !detectRes.error && !!detectRes.data?.pdf_url && detectRes.data.source !== "user_drawn" && !detectRes.data.openings_detected_at;

  // B2/B4 (MULTIVIEW_RENDERS_ENABLED): every photo of a room as a view, the room plan to place it on,
  // each view's versions and lock, and each room's anchor (064).
  let photoViews: PhotoViewsInitial | null = null;
  if (process.env.MULTIVIEW_RENDERS_ENABLED === "true" && plan) {
    const ids = roomList.map((r) => r.id);
    const planCols = await sbRows.from("plans").select("source, plot_width_m").eq("id", plan.id).maybeSingle<{ source: string | null; plot_width_m: number | null }>();
    const [byRoom, plans] = await Promise.all([
      loadPhotoViews(sbRows, ids),
      loadMiniPlans(sbRows, projectId, { id: plan.id, total_area_m2: plan.total_area_m2 ?? null, source: planCols.data?.source ?? null, plot_width_m: planCols.data?.plot_width_m ?? null }, ids),
    ]);
    const photoIds = Object.values(byRoom).flat().map((v) => v.id);
    const [state, spend, brief] = await Promise.all([
      loadStudioState(sbRows, ids, photoIds),
      projectRenderSpend(sbRows, projectId),
      sbRows.from("project_briefs").select("reference_style").eq("project_id", projectId).maybeSingle<{ reference_style: { text: string; at: string } | null }>(),
    ]);
    // C5 #1: each material labelled (illustrative · specified · priced · changed since approval), and each room's design now.
    const materialState = await loadMaterialState(sbRows as unknown as SupabaseClient, projectId, ids, { plans, anchors: state.anchors, versions: state.versions as never });
    photoViews = { byRoom, plans, ...state, ...materialState, spendAed: spend?.render_spend_aed ?? null, referenceStyle: brief.error ? null : brief.data?.reference_style ?? null, costPerView: photoViewCostAed(photoViewMaxAttempts()) };
  }

  const flags = journeyFlagsFromEnv();
  return (
    <>
    {plan ? <OpeningsAutoDetect planId={plan.id} needed={detectNeeded} /> : null}
    <RendersStudio
      initialRoomId={initialRoomId ?? null}
      projectId={project.id}
      rooms={roomList.map((r) => ({ id: r.id, name_en: r.name_en, room_type: r.room_type }))}
      style={style}
      initialChains={initialChains}
      initialLockedRoomIds={initialLockedRoomIds}
      initialPhotosByRoom={initialPhotosByRoom}
      initialPhotoAssets={initialPhotoAssets}
      roomCost={roomBoqTotals}
      stagingEnabled={stagingEnabled}
      initialFurnitureOptIns={initialFurnitureOptIns}
      batchJobs={batchJobs}
      initialEvenings={initialEvenings}
      renderInfo={renderInfo}
      viewerHref={await viewerHref(projectId)}
      costHref={ownerStepHref("cost", projectId, flags)}
      notInScope={notInScope}
      planHref={`/project/${projectId}/plan`}
      photoViews={photoViews}
    />
    </>
  );
}
