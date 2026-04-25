import { FadeIn } from "@/app/_components/fade-in";
import { AppShell } from "@/components/AppShell";
import { BackButton } from "@/components/back-button";
import { Badge } from "@/components/ui/badge";
import { STYLES } from "@/lib/styles";

import { StyleGrid } from "./_components/style-grid";

const HARDCODED_BUDGET_AED = 850000;

function formatBudget(value: number): string {
  return value.toLocaleString("en-US");
}

export default async function StylePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <AppShell pageName="Direction">
      <main className="flex min-h-[calc(100vh-4rem)] justify-center px-6 py-16 sm:py-24">
        <FadeIn className="w-full max-w-[1200px]">
          <BackButton />

          <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
            <h1 className="font-display text-4xl font-semibold tracking-tight text-brand-accent sm:text-5xl">
              Style
            </h1>
            <Badge
              variant="secondary"
              className="bg-bg-elevated text-text-secondary"
            >
              Step 3 of 6 — Choose a direction
            </Badge>
          </div>

          <p className="mt-4 max-w-2xl text-sm text-text-secondary">
            Six directions tuned to Dubai villas and your AED{" "}
            {formatBudget(HARDCODED_BUDGET_AED)} budget.
          </p>

          <div className="mt-10">
            <StyleGrid styles={STYLES} projectId={id} />
          </div>
        </FadeIn>
      </main>
    </AppShell>
  );
}
