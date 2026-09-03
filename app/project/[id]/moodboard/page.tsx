import type { SupabaseClient } from "@supabase/supabase-js";

import { AppShell } from "@/components/app/AppShell";
import { JourneyChrome } from "@/components/app/JourneyChrome";
import { loadProjectAssetsOfKind } from "@/lib/assets/load";
import { journeyFlagsFromEnv, nextStep } from "@/lib/journey";
import { loadMoodboard } from "@/lib/moodboard/load";
import { styleImageCatalog } from "@/lib/moodboard/types";
import { tasteSeedEnabled } from "@/lib/render-grounding";
import { STYLES } from "@/lib/styles";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { MoodboardBuilder } from "./_components/moodboard-builder";

export const dynamic = "force-dynamic";

/** Journey step 4 — Moodboard. Stored, generated and uploaded references. */
export default async function MoodboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = getSupabaseAdmin() as unknown as SupabaseClient;

  const [items, referenceAssets] = await Promise.all([
    loadMoodboard(id),
    loadProjectAssetsOfKind(id, "reference_image"),
  ]);

  // The locked style, so its art sorts first in the picker.
  const { data: styleRow } = await sb
    .from("style_choices")
    .select("style_key")
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ style_key: string | null }>();

  // Completed renders are pinnable as references for the rest of the villa.
  let renderOptions: { id: string; image_url: string; room_name: string | null }[] = [];
  try {
    const { data } = await sb
      .from("renders")
      .select("id, image_url, rooms(name_en)")
      .eq("project_id", id)
      .not("image_url", "is", null)
      .order("created_at", { ascending: false })
      .limit(24);
    // PostgREST types the embedded relation as an array; take the first row.
    renderOptions = (data ?? []).map((r) => {
      const rooms = r.rooms as unknown as { name_en?: string | null }[] | { name_en?: string | null } | null;
      const room = Array.isArray(rooms) ? rooms[0] : rooms;
      return {
        id: r.id as string,
        image_url: r.image_url as string,
        room_name: room?.name_en ?? null,
      };
    });
  } catch {
    renderOptions = [];
  }

  const flags = journeyFlagsFromEnv();
  const next = nextStep("moodboard", flags);

  return (
    <AppShell pageName="Moodboard">
      <div className="mx-auto max-w-[1200px] pb-2xl">
        <JourneyChrome
          stepKey="moodboard"
          projectId={id}
          title="Collect the references."
          intro="Pull together the images that describe the feeling you're after. These become the taste reference every room render is measured against."
        />
        <MoodboardBuilder
          projectId={id}
          initialItems={items}
          initialAssets={referenceAssets}
          styleOptions={styleImageCatalog(STYLES)}
          renderOptions={renderOptions}
          lockedStyleKey={styleRow?.style_key ?? null}
          nextHref={next ? next.href(id) : `/project/${id}`}
          nextLabel={next ? `Continue to ${next.label.toLowerCase()}` : "Back to project"}
          tasteSeedOn={tasteSeedEnabled()}
        />
      </div>
    </AppShell>
  );
}
