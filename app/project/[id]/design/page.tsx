import type { SupabaseClient } from "@supabase/supabase-js";

import { Button } from "@/components/blueprint/Button";
import { PageHeader } from "@/components/blueprint/PageHeader";
import { SubTabs } from "@/components/blueprint/SubTabs";
import { DirectionView, type IdeationBrief } from "@/components/blueprint/design/DirectionView";
import { ReferencesView } from "@/components/blueprint/design/ReferencesView";
import { TopBarActions } from "@/components/blueprint/shell/TopBar";
import { loadProjectAssetsOfKind } from "@/lib/assets/load";
import { resolveAnyStyle } from "@/lib/garden-styles";
import { journeyFlagsFromEnv, nextOwnerStep, ownerStep, ownerStepHref } from "@/lib/journey";
import { loadMoodboard } from "@/lib/moodboard/load";
import { styleImageCatalog } from "@/lib/moodboard/types";
import { STYLES, getStyleByKey } from "@/lib/styles";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// =============================================================================
// 02 Design (K8 #3–4, spec §6.3, frames 55:296 Direction · 56:434 References) —
// one step, one route, two views: ?view=direction (default; the questionnaire
// and the direction, which /ideation and /style were) and ?view=references
// (the board, which /moodboard was). The old routes 308 here (next.config.ts).
// =============================================================================

type View = "direction" | "references";

async function loadBrief(sb: SupabaseClient, id: string): Promise<IdeationBrief | null> {
  try {
    const { data } = await sb.from("project_briefs").select("answers, recommended_style_key, recommendation, override_style_key, completed_at").eq("project_id", id).maybeSingle<IdeationBrief>();
    return data ?? null;
  } catch {
    return null;
  }
}

async function latestStyleKey(sb: SupabaseClient, id: string): Promise<string | null> {
  const { data } = await sb.from("style_choices").select("style_key").eq("project_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle<{ style_key: string | null }>();
  return data?.style_key ?? null;
}

async function loadRenderOptions(sb: SupabaseClient, id: string): Promise<{ id: string; image_url: string; room_name: string | null }[]> {
  try {
    const { data } = await sb.from("renders").select("id, image_url, rooms(name_en)").eq("project_id", id).not("image_url", "is", null).order("created_at", { ascending: false }).limit(24);
    return (data ?? []).map((r) => {
      const rooms = r.rooms as unknown as { name_en?: string | null }[] | { name_en?: string | null } | null;
      const room = Array.isArray(rooms) ? rooms[0] : rooms;
      return { id: r.id as string, image_url: r.image_url as string, room_name: room?.name_en ?? null };
    });
  } catch {
    return [];
  }
}

export default async function DesignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string }> }) {
  const { id } = await params;
  const view: View = (await searchParams).view === "references" ? "references" : "direction";
  const sb = getSupabaseAdmin() as unknown as SupabaseClient;
  const step = ownerStep("design");
  const next = nextOwnerStep("design")!;
  const nextHref = ownerStepHref(next.key, id, journeyFlagsFromEnv());

  const [items, brief, lockedStyleKey] = await Promise.all([loadMoodboard(id), loadBrief(sb, id), latestStyleKey(sb, id)]);
  const directionKey = brief?.override_style_key ?? brief?.recommended_style_key ?? lockedStyleKey;
  const direction = resolveAnyStyle(directionKey, getStyleByKey)?.name_en ?? null;

  const base = `/project/${id}/design`;
  const tabs = [
    { key: "direction", label: "Direction", href: base, meta: direction ?? undefined },
    { key: "references", label: "References", href: `${base}?view=references`, meta: `${items.length} pinned` },
  ];

  let body: React.ReactNode;
  if (view === "direction") {
    body = <DirectionView projectId={id} initialBrief={brief} referencesHref={`${base}?view=references`} />;
  } else {
    const [referenceAssets, renderOptions] = await Promise.all([loadProjectAssetsOfKind(id, "reference_image"), loadRenderOptions(sb, id)]);
    body = <ReferencesView projectId={id} initialItems={items} initialAssets={referenceAssets} styleOptions={styleImageCatalog(STYLES)} renderOptions={renderOptions} lockedStyleKey={lockedStyleKey} />;
  }

  return (
    <div className="mx-auto max-w-[1344px] px-6 pb-16 pt-8 lg:px-12" data-design={view}>
      <TopBarActions>
        <Button kind="primary" href={nextHref}>
          Continue to {next.label.toLowerCase()}
        </Button>
      </TopBarActions>
      <PageHeader
        eyebrow={`${step.number} · ${step.label.toUpperCase()}`}
        title="Design direction"
        intro={
          view === "direction"
            ? "Answer six quick questions and we suggest a direction tuned to Dubai villas. Take it or choose another, then pin a few references. Every render is checked against both."
            : "Pin 3–6 images that feel right. They become the taste reference every room render is measured against."
        }
        tabs={<SubTabs label={`${step.number} ${step.label}`} tabs={tabs} active={view} />}
      />
      <div className="mt-8">{body}</div>
    </div>
  );
}
