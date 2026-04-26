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

          {/*
            Header is one full-width block above the grid. Row 1 is a
            flex justify-between with the H1 on the left and the step
            badge on the right; `shrink-0` on the badge prevents it
            from squeezing the H1 into a single-letter column at any
            viewport. Row 2 is the subtitle, capped at 720px.
          */}
          <header className="mt-4 flex flex-wrap items-center justify-between gap-4">
            <h1 className="max-w-[720px] text-h1 text-on-surface">Style</h1>
            <Badge
              variant="secondary"
              className="shrink-0 bg-surface-container text-on-surface-variant"
            >
              Step 3 of 6 — Choose a direction
            </Badge>
          </header>

          <p className="mt-3 max-w-[720px] text-body-md text-on-surface-variant">
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
