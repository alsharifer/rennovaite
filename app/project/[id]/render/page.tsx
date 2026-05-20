import { AppShell } from "@/components/app/AppShell";
import { getStyleByKey } from "@/lib/styles";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { RenderInteractive } from "./_components/render-interactive";

export const dynamic = "force-dynamic";

type RenderRow = {
  id: string;
  room_id: string | null;
  prompt: string | null;
  image_url: string | null;
  parent_render_id: string | null;
  created_at: string | null;
};

type RenderItem = { id: string; imageUrl: string; prompt: string };

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
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = await params;
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
  const style = styleChoice?.style_key
    ? (getStyleByKey(styleChoice.style_key) ?? null)
    : null;

  if (!project || !plan) {
    return (
      <AppShell pageName="AI Designer">
        <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-6">
          <p className="text-on-surface-variant">
            {!project
              ? `Project ${projectId} not found.`
              : "No plan attached to this project yet."}
          </p>
        </main>
      </AppShell>
    );
  }

  const { data: rooms } = await supabase
    .from("rooms")
    .select("id, name_en, room_type, area_m2, polygon")
    .eq("plan_id", plan.id)
    .order("name_en");

  const roomList = rooms ?? [];

  // Fetch every render for this project, then reconstruct a linear chain
  // per room (root → … → latest leaf). This rehydrates the iteration UI on
  // page load so users see their previous renders instead of starting blank.
  const { data: renderRows } = await supabase
    .from("renders")
    .select("id, room_id, prompt, image_url, parent_render_id, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  const initialChains = buildInitialChains(renderRows ?? []);

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

  if (roomList.length === 0) {
    return (
      <AppShell pageName="AI Designer">
        <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-6">
          <p className="text-on-surface-variant">
            No rooms found on this plan. Go back and confirm the plan first.
          </p>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell pageName="AI Designer" noPadding>
      <RenderInteractive
        projectId={project.id}
        rooms={roomList}
        style={style}
        initialChains={initialChains}
        initialLockedRoomIds={initialLockedRoomIds}
      />
    </AppShell>
  );
}
