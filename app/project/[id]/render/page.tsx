import { FadeIn } from "@/app/_components/fade-in";
import { AppShell } from "@/components/AppShell";
import { BackButton } from "@/components/back-button";
import { Badge } from "@/components/ui/badge";
import { getStyleByKey } from "@/lib/styles";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { RenderInteractive } from "./_components/render-interactive";

export const dynamic = "force-dynamic";

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

  // Whole-project style choice (room_id null). The schema doesn't track
  // created_at on style_choices, so just take the first row.
  const { data: styleChoiceRows } = await supabase
    .from("style_choices")
    .select("style_key")
    .eq("project_id", projectId)
    .is("room_id", null)
    .limit(1);

  const styleChoice = styleChoiceRows?.[0] ?? null;

  const style = styleChoice?.style_key
    ? (getStyleByKey(styleChoice.style_key) ?? null)
    : null;

  if (!project || !plan) {
    return (
      <AppShell pageName="AI Designer">
        <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-6">
          <p className="text-text-secondary">
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
    .select("id, name_en, room_type, area_m2")
    .eq("plan_id", plan.id)
    .order("name_en");

  const roomList = rooms ?? [];

  return (
    <AppShell pageName="AI Designer">
      <main className="flex min-h-[calc(100vh-4rem)] justify-center px-6 py-16 sm:py-24">
        <FadeIn className="w-full max-w-[1400px]">
          <BackButton />

          <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="font-display text-4xl font-semibold tracking-tight text-brand-accent sm:text-5xl">
                Render rooms
              </h1>
              {style && (
                <p className="mt-2 text-sm text-text-secondary">
                  Style direction:{" "}
                  <span className="text-text-primary">{style.name_en}</span>
                </p>
              )}
              {!style && (
                <p className="mt-2 text-sm text-text-tertiary">
                  No style chosen yet — defaults will be used.
                </p>
              )}
            </div>
            <Badge
              variant="secondary"
              className="bg-bg-elevated text-text-secondary"
            >
              Step 4 of 6 — See it rendered
            </Badge>
          </div>

          {roomList.length === 0 ? (
            <div className="mt-10 rounded-xl border border-bg-border bg-bg-elevated/60 p-8 text-center backdrop-blur-sm">
              <p className="text-sm text-text-secondary">
                No rooms found on this plan. Go back and confirm the plan
                first.
              </p>
            </div>
          ) : (
            <div className="mt-10">
              <RenderInteractive rooms={roomList} style={style} />
            </div>
          )}
        </FadeIn>
      </main>
    </AppShell>
  );
}
