import { FadeIn } from "@/app/_components/fade-in";
import { AppShell } from "@/components/AppShell";
import { BackButton } from "@/components/back-button";
import { Badge } from "@/components/ui/badge";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { BoqView, type BoqPayload } from "./_components/boq-view";
import { GenerateBoqButton } from "./_components/generate-boq-button";

export const dynamic = "force-dynamic";

const PAGE_NAME = "Bill of Quantities";
const FALLBACK_BUDGET_AED = 400000;

function isBoqPayload(value: unknown): value is BoqPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.sections) &&
    typeof v.subtotal_aed === "number" &&
    typeof v.grand_total_aed === "number"
  );
}

export default async function BoqPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = getSupabaseAdmin();
  const [projectRes, boqRes] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, city, budget_aed")
      .eq("id", id)
      .single(),
    supabase
      .from("boqs")
      .select("id, total_aed, sections, locked_at, created_at")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  if (projectRes.error || !projectRes.data) {
    return (
      <AppShell pageName={PAGE_NAME}>
        <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-6">
          <p className="text-status-error">Project not found.</p>
        </main>
      </AppShell>
    );
  }

  const project = projectRes.data;
  const projectName = project.name?.trim() || "Untitled";
  const projectTitle =
    projectName === "Untitled"
      ? `${project.city ?? "Dubai"} · First-floor refit`
      : `${projectName} · First-floor refit`;
  const budgetAed = project.budget_aed ?? FALLBACK_BUDGET_AED;

  const latestBoq = boqRes.data?.[0];
  const boqPayload =
    latestBoq && isBoqPayload(latestBoq.sections) ? latestBoq.sections : null;

  return (
    <AppShell pageName={PAGE_NAME}>
      <main className="flex min-h-[calc(100vh-4rem)] justify-center px-6 py-12">
        <FadeIn className="w-full max-w-[1200px]">
          <BackButton />

          <header className="mt-4 flex flex-wrap items-center justify-between gap-4">
            <h1 className="max-w-[720px] text-h1 text-on-surface">
              Bill of Quantities
            </h1>
            <Badge
              variant="secondary"
              className="shrink-0 bg-surface-container text-on-surface-variant"
            >
              Step 5 of 6 — Cost it out
            </Badge>
          </header>

          <p className="mt-3 max-w-[720px] text-body-md text-on-surface-variant">
            POMI-formatted, sourced from QS-vetted labour rates and Dubai supplier SKUs.
          </p>

          {boqPayload ? (
            <BoqView
              projectId={id}
              projectTitle={projectTitle}
              budgetAed={budgetAed}
              boq={boqPayload}
            />
          ) : (
            <EmptyState projectId={id} />
          )}
        </FadeIn>
      </main>
    </AppShell>
  );
}

function EmptyState({ projectId }: { projectId: string }) {
  return (
    <div className="mt-16 flex flex-col items-center gap-6 rounded-2xl border border-dashed border-outline-variant bg-surface-container-low px-6 py-16 text-center">
      <span
        className="material-symbols-outlined text-5xl text-on-surface-variant"
        aria-hidden="true"
      >
        request_quote
      </span>
      <div className="flex flex-col gap-2">
        <h2 className="text-h3 text-on-surface">No BoQ yet</h2>
        <p className="max-w-[520px] text-body-md text-on-surface-variant">
          Generate a priced bill of quantities from the plan, your chosen style, and the
          approved designs. This takes about a minute.
        </p>
      </div>
      <GenerateBoqButton projectId={projectId} />
    </div>
  );
}
