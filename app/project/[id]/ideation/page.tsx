import type { SupabaseClient } from "@supabase/supabase-js";

import { AppShell } from "@/components/app/AppShell";
import { JourneyChrome } from "@/components/app/JourneyChrome";
import { journeyFlagsFromEnv, nextStep } from "@/lib/journey";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { IdeationFlow, type IdeationBrief } from "./_components/ideation-flow";

export const dynamic = "force-dynamic";

/**
 * Journey step 3 — Ideation. Style selection folds in here: the questionnaire
 * recommends a direction, and `/style` is a second surface on this same step
 * for browsing all six side by side.
 */
export default async function IdeationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = getSupabaseAdmin() as unknown as SupabaseClient;

  // Best-effort: before migration 027 this returns nothing and the flow starts
  // empty rather than erroring.
  let brief: IdeationBrief | null = null;
  try {
    const { data } = await sb
      .from("project_briefs")
      .select(
        "answers, recommended_style_key, recommendation, override_style_key, completed_at",
      )
      .eq("project_id", id)
      .maybeSingle<IdeationBrief>();
    brief = data ?? null;
  } catch {
    brief = null;
  }

  const flags = journeyFlagsFromEnv();
  const next = nextStep("ideation", flags);

  return (
    <AppShell pageName="Ideation">
      <div className="mx-auto max-w-[1100px] pb-2xl">
        <JourneyChrome
          stepKey="ideation"
          projectId={id}
          title="What should it feel like?"
          intro="Six quick questions. We'll suggest a direction tuned to Dubai villas — and you can override it at any point."
        />
        <IdeationFlow
          projectId={id}
          initialBrief={brief}
          nextHref={next ? next.href(id) : `/project/${id}`}
          nextLabel={next ? `Continue to ${next.label.toLowerCase()}` : "Back to project"}
          styleHref={`/project/${id}/style`}
        />
      </div>
    </AppShell>
  );
}
