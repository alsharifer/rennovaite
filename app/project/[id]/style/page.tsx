import type { SupabaseClient } from "@supabase/supabase-js";

import { AppShell } from "@/components/app/AppShell";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { STYLES } from "@/lib/styles";

import { StyleGrid } from "./_components/style-grid";

export const dynamic = "force-dynamic";

const PAGE_NAME = "Style Direction";
const SEGMENTS = 5;

export default async function StylePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const sb = supabase as unknown as SupabaseClient;

  // style_choices stores one row per pick; latest row = current selection.
  const { data: selection } = await sb
    .from("style_choices")
    .select("style_key")
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ style_key: string | null }>();

  return (
    <AppShell pageName={PAGE_NAME}>
      <div className="mx-auto max-w-[1440px] pb-32">
        {/* Header */}
        <header className="mb-2xl">
          <p className="label-caps mb-md text-brass-600">Step 03 of 05</p>
          <div className="mb-xl flex gap-sm" aria-hidden="true">
            {Array.from({ length: SEGMENTS }).map((_, i) => (
              <span
                key={i}
                className={
                  "h-1 flex-1 rounded-full " +
                  (i < 3 ? "bg-brass-600" : "bg-bone")
                }
              />
            ))}
          </div>
          <h1 className="mb-md font-display text-headline-lg text-ink-900">
            Pick a direction.
          </h1>
          <p className="max-w-[720px] font-body text-body-lg text-on-surface-variant">
            We tuned six directions to Dubai villas and your AED 850k budget.
            Each one comes with an indicative cost delta against a baseline
            finish.
          </p>
        </header>

        <StyleGrid
          styles={STYLES}
          projectId={id}
          initialSelectedKey={selection?.style_key ?? null}
        />
      </div>
    </AppShell>
  );
}
