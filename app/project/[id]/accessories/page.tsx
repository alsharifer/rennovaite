import { AppShell } from "@/components/app/AppShell";
import { JourneyChrome } from "@/components/app/JourneyChrome";
import { NO_CATALOGUE_REASON } from "@/lib/accessories/seed-data";
import { EMPTY_PICKER_DATA, loadPickerData } from "@/lib/accessories/picker-data";
import { journeyFlagsFromEnv, nextStep } from "@/lib/journey";

import { AccessoryPicker } from "./_components/accessory-picker";

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
  const next = nextStep("costing", flags);

  return (
    <AppShell pageName="Accessories & Specs">
      <div className="mx-auto max-w-[1200px] pb-2xl">
        <JourneyChrome
          stepKey="costing"
          projectId={id}
          title="Choose the specification."
          intro="Every line below is priced by rule today. Pick the actual product where it matters — quantities stay the take-off's, so only the rate moves."
        />
        <AccessoryPicker
          projectId={id}
          catalog={data.catalog ?? []}
          initialSelections={data.selections ?? {}}
          defaults={data.defaults ?? {}}
          quantities={data.quantities ?? {}}
          measurements={data.measurements ?? {}}
          noCatalogueReasons={NO_CATALOGUE_REASON}
          nextHref={next ? next.href(id) : `/project/${id}/boq`}
          nextLabel={next ? `Continue to ${next.label.toLowerCase()}` : "Back to the BoQ"}
          boqHref={`/project/${id}/boq`}
          degraded={data.degraded ?? true}
        />
      </div>
    </AppShell>
  );
}
