import type { SupabaseClient } from "@supabase/supabase-js";

import { Button } from "@/components/blueprint/Button";
import { PageHeader } from "@/components/blueprint/PageHeader";
import { loadProjectRail } from "@/components/blueprint/shell/ProjectShell";
import { StepTabs } from "@/components/blueprint/shell/StepTabs";
import { TopBarActions } from "@/components/blueprint/shell/TopBar";
import { revLine } from "@/components/blueprint/shell/rev-line";
import { Specification } from "@/components/blueprint/spec/Specification";
import { NO_CATALOGUE_REASON } from "@/lib/accessories/seed-data";
import { ALL_ACCESSORY_ITEM_KEYS, EMPTY_PICKER_DATA, loadPickerData } from "@/lib/accessories/picker-data";
import type { RevisionBoq } from "@/lib/boq/revision-diff";
import { formatAED } from "@/lib/format/aed";
import { estimateOf } from "@/lib/hub/estimate";
import { FIRM_STEPS, journeyFlagsFromEnv, nextOwnerStep, ownerStepHref } from "@/lib/journey";
import { stepEyebrow } from "@/lib/journey-eyebrow";
import { loadProvenanceContext } from "@/lib/provenance/load";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// K8 #6 — Specification (spec §6.5, Figma 58:738): the owner's 04 Cost ·
// Specification tab, and the firm's step 03 Specification (same page, firm
// rail, no tabs). The data is the D1 picker's (lib/accessories/picker-data —
// "what the engine assumed" is the engine's own resolver run with no
// selections).
export default async function AccessoriesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getSupabaseAdmin() as unknown as SupabaseClient;
  const [data, rail, latest] = await Promise.all([
    loadPickerData(id).catch(() => EMPTY_PICKER_DATA),
    loadProjectRail(id),
    db
      .from("boqs")
      .select("sections")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ sections: RevisionBoq }>()
      .then((r) => r.data, () => null),
  ]);
  const persona = rail?.persona ?? "owner";
  const flags = journeyFlagsFromEnv();

  // The BoQ tab carries the stored headline (the same figure the BoQ page pins).
  let boqMeta: string | undefined;
  if (persona === "owner" && latest) {
    try {
      const e = estimateOf(latest.sections, await loadProvenanceContext(db, id));
      boqMeta = `${e.estimate ? "≈ " : ""}${formatAED(e.grand)}${e.excluded.length ? "*" : ""}`;
    } catch {
      boqMeta = undefined;
    }
  }
  const chosen = Object.keys(data.selections ?? {}).length;

  const next =
    persona === "firm"
      ? (() => {
          const i = FIRM_STEPS.findIndex((s) => s.key === "specification");
          const s = FIRM_STEPS[i + 1]!;
          return { label: s.label, href: s.href(id) };
        })()
      : (() => {
          const s = nextOwnerStep("cost")!;
          return { label: s.label, href: ownerStepHref(s.key, id, flags) };
        })();

  return (
    <div className="mx-auto max-w-[1344px] px-6 pb-16 pt-8 lg:px-12" data-specification>
      <TopBarActions>
        {rail?.project ? <span className="t-label-md hidden font-bp-mono text-bp-ink-tertiary lg:inline">{revLine(rail.project)}</span> : null}
        <Button kind="primary" href={next.href}>
          Continue to {next.label.toLowerCase()}
        </Button>
      </TopBarActions>
      <PageHeader
        eyebrow={stepEyebrow(persona, "specification", "cost", "Specification")}
        title="Specification"
        intro="Every line is priced by rule until you pick the actual product. Quantities stay the plan's — only the rate moves."
        tabs={persona === "owner" ? <StepTabs step="cost" projectId={id} active="specification" persona={persona} meta={{ boq: boqMeta, specification: `${chosen} of ${ALL_ACCESSORY_ITEM_KEYS.length} chosen` }} /> : undefined}
      />
      <div className="mt-8">
        <Specification
          projectId={id}
          persona={persona}
          catalog={data.catalog ?? []}
          initialSelections={data.selections ?? {}}
          defaults={data.defaults ?? {}}
          quantities={data.quantities ?? {}}
          measurements={data.measurements ?? {}}
          noCatalogueReasons={NO_CATALOGUE_REASON}
          degraded={data.degraded ?? true}
          rev={rail?.project?.rev ?? null}
          boqHref={`/project/${id}/boq`}
        />
      </div>
    </div>
  );
}
