import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app/AppShell";
import { Villa3DLoader } from "@/components/viewer/Villa3DLoader";
import type { RoomRenders } from "@/components/viewer/Villa3D";
import { derivePlanGraph } from "@/lib/plan/derive";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { buildScene } from "@/lib/viewer/scene";
import { styleFloorColor } from "@/lib/viewer/finishes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE_NAME = "3D Viewer";

type RenderRow = {
  id: string;
  room_id: string | null;
  image_url: string | null;
  kind: string | null;
  created_at: string | null;
};

export default async function ViewerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (process.env.VIEWER_3D_ENABLED !== "true") notFound();

  const { id: projectId } = await params;
  const supabase = getSupabaseAdmin();

  const graph = await derivePlanGraph(projectId);

  // Empty/failure state — never a blank canvas or a crash.
  if (graph.walls.length === 0) {
    return (
      <AppShell pageName={PAGE_NAME}>
        <main className="flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center gap-lg px-6 text-center">
          <p className="max-w-[560px] font-display text-headline-md italic text-ink-700">
            We need a confirmed plan before we can build your villa in 3D.
          </p>
          <Link
            href={`/project/${projectId}/plan`}
            className="focus-ring inline-flex h-11 items-center rounded-lg bg-brass-600 px-lg font-body-sm text-body-sm font-semibold text-on-primary transition-colors hover:bg-primary"
          >
            Back to the plan
          </Link>
        </main>
      </AppShell>
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

  // Latest render per room (+ small gallery) for the brass anchors.
  const { data: renderRows } = await supabase
    .from("renders")
    .select("id, room_id, image_url, kind, created_at")
    .eq("project_id", projectId)
    .eq("status", "succeeded")
    .not("image_url", "is", null)
    .order("created_at", { ascending: false });

  const roomNameById = new Map(graph.rooms.map((r) => [r.id, r.name_en]));
  const byRoom = new Map<string, RenderRow[]>();
  for (const r of (renderRows ?? []) as RenderRow[]) {
    if (!r.room_id || !r.image_url) continue;
    (byRoom.get(r.room_id) ?? byRoom.set(r.room_id, []).get(r.room_id)!).push(r);
  }
  const renders: RoomRenders[] = [];
  for (const [roomId, list] of byRoom) {
    const latest = list[0]!;
    renders.push({
      roomId,
      roomName: roomNameById.get(roomId) ?? "Room",
      latestUrl: latest.image_url!,
      latestKind: latest.kind ?? "still",
      gallery: list.slice(0, 6).map((r) => ({ id: r.id, url: r.image_url! })),
    });
  }

  return (
    <AppShell pageName={PAGE_NAME} noPadding>
      <div className="p-6">
        <Villa3DLoader scene={scene} renders={renders} />
      </div>
    </AppShell>
  );
}
