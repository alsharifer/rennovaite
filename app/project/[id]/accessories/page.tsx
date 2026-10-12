import { NO_CATALOGUE_REASON } from "@/lib/accessories/seed-data";
import { EMPTY_PICKER_DATA, loadPickerData } from "@/lib/accessories/picker-data";
import { journeyFlagsFromEnv, nextOwnerStep, ownerStepHref } from "@/lib/journey";

import { AccessoryPicker } from "./_components/accessory-picker";
import { PageHeader } from "@/components/blueprint/PageHeader";
import { AtelierCanvas } from "@/components/blueprint/shell/AtelierCanvas";
import { StepTabs } from "@/components/blueprint/shell/StepTabs";
import { ownerEyebrow } from "@/lib/journey-eyebrow";

export const dynamic = "force-dynamic";

/**
 * Accessory / spec selection — a surface of journey step 6 (Costing & BoQ),
 * not a step of its own: the canonical workflow names step 6 "Costing & BoQ —
 * accessory/spec selection".
 *
 * Data comes from /api/accessories, which resolves the rule-derived defaults
 * with the same RateResolver the BoQ uses, so "what the engine assumed" is the
 * engine's own answer rather than a second implementation of it.
 */
export default async function AccessoriesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const data = await loadPickerData(id).catch(() => EMPTY_PICKER_DATA);

  const flags = journeyFlagsFromEnv();
  const next = nextOwnerStep("cost");

  return (
    <>
      <PageHeader className="mx-auto max-w-[1280px] px-6 pt-10 lg:px-12" eyebrow={ownerEyebrow("cost")} title="Specification" intro="Every line is priced by rule until you pick the actual product. Quantities stay the plan's — only the rate moves." tabs={<StepTabs step="cost" projectId={id} active="specification" persona="owner" />} />
      <AtelierCanvas>
      <div className="mx-auto max-w-[1200px] pb-2xl">
        <AccessoryPicker
          projectId={id}
          catalog={data.catalog ?? []}
          initialSelections={data.selections ?? {}}
          defaults={data.defaults ?? {}}
          quantities={data.quantities ?? {}}
          measurements={data.measurements ?? {}}
          noCatalogueReasons={NO_CATALOGUE_REASON}
          nextHref={next ? ownerStepHref(next.key, id, flags) : `/project/${id}/boq`}
          nextLabel={next ? `Continue to ${next.label.toLowerCase()}` : "Back to the BoQ"}
          boqHref={`/project/${id}/boq`}
          degraded={data.degraded ?? true}
        />
      </div>
    </AtelierCanvas>
    </>
  );
}
