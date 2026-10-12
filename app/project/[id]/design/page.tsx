import type { SupabaseClient } from "@supabase/supabase-js";

import { Button } from "@/components/blueprint/Button";
import { SubTabs } from "@/components/blueprint/SubTabs";
import { AtelierCanvas } from "@/components/blueprint/shell/ShellFrame";
import { TopBarActions } from "@/components/blueprint/shell/TopBar";
import { loadProjectAssetsOfKind } from "@/lib/assets/load";
import { journeyFlagsFromEnv, nextOwnerStep, ownerStep, ownerStepHref } from "@/lib/journey";
import { loadMoodboard } from "@/lib/moodboard/load";
import { styleImageCatalog } from "@/lib/moodboard/types";
import { tasteSeedEnabled } from "@/lib/render-grounding";
import { STYLES } from "@/lib/styles";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { IdeationFlow, type IdeationBrief } from "./_components/ideation-flow";
import { MoodboardBuilder } from "./_components/moodboard-builder";

export const dynamic = "force-dynamic";

// =============================================================================
// 02 Design (K8, spec §6.3, frames 55:296 Direction · 56:434 References) — one
// step, one route, two views: ?view=direction (default; the questionnaire and
// the direction, which /ideation and /style were) and ?view=references (the
// board, which /moodboard was). The old routes 308 here (next.config.ts).
//
// K8.1 lands the route, the tabs and the step; the view bodies are the
// existing flows on their Atelier canvas until K8 #3–4 rebuilds them from the
// frames.
// =============================================================================

type View = "direction" | "references";

async function latestStyleKey(sb: SupabaseClient, id: string): Promise<string | null> {
  const { data } = await sb.from("style_choices").select("style_key").eq("project_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle<{ style_key: string | null }>();
  return data?.style_key ?? null;
}

async function loadBrief(sb: SupabaseClient, id: string): Promise<IdeationBrief | null> {
  try {
    const { data } = await sb.from("project_briefs").select("answers, recommended_style_key, recommendation, override_style_key, completed_at").eq("project_id", id).maybeSingle<IdeationBrief>();
    return data ?? null;
  } catch {
    return null;
  }
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
  const flags = journeyFlagsFromEnv();
  const step = ownerStep("design");
  const next = nextOwnerStep("design")!;
  const nextHref = ownerStepHref(next.key, id, flags);

  const items = await loadMoodboard(id);
  const base = `/project/${id}/design`;
  const tabs = [
    { key: "direction", label: "Direction", href: base },
    { key: "references", label: "References", href: `${base}?view=references`, meta: `${items.length} pinned` },
  ];

  let body: React.ReactNode;
  if (view === "direction") {
    const brief = await loadBrief(sb, id);
    body = <IdeationFlow projectId={id} initialBrief={brief} nextHref={`${base}?view=references`} nextLabel="Continue to references" styleHref={base} />;
  } else {
    const [referenceAssets, lockedStyleKey, renderOptions] = await Promise.all([loadProjectAssetsOfKind(id, "reference_image"), latestStyleKey(sb, id), loadRenderOptions(sb, id)]);
    body = (
      <MoodboardBuilder
        projectId={id}
        initialItems={items}
        initialAssets={referenceAssets}
        styleOptions={styleImageCatalog(STYLES)}
        renderOptions={renderOptions}
        lockedStyleKey={lockedStyleKey}
        nextHref={nextHref}
        nextLabel={`Continue to ${next.label.toLowerCase()}`}
        tasteSeedOn={tasteSeedEnabled()}
      />
    );
  }

  return (
    <>
      <TopBarActions>
        <Button kind="primary" href={nextHref}>
          Continue to {next.label.toLowerCase()}
        </Button>
      </TopBarActions>
      <div className="mx-auto max-w-[1280px] px-6 pt-10 lg:px-12">
        <p className="t-label-caps text-bp-brass-text">{`${step.number} · ${step.label.toUpperCase()}`}</p>
        <h1 className="t-heading-lg mt-3 text-bp-ink-primary">{view === "direction" ? "Design direction" : "References"}</h1>
        <p className="t-body-md mt-2 max-w-[760px] text-bp-ink-secondary">
          Answer six quick questions and we suggest a direction tuned to Dubai villas. Take it or choose another, then pin a few references. Every render is checked against both.
        </p>
        <div className="mt-8">
          <SubTabs label={`${step.number} ${step.label}`} tabs={tabs} active={view} />
        </div>
      </div>
      <AtelierCanvas>
        <div className="mx-auto max-w-[1200px]">{body}</div>
      </AtelierCanvas>
    </>
  );
}
