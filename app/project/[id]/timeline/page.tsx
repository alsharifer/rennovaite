import { Button } from "@/components/blueprint/Button";
import { PageHeader } from "@/components/blueprint/PageHeader";
import { StateBlock } from "@/components/blueprint/StateBlock";
import { TopBarActions } from "@/components/blueprint/shell/TopBar";
import { GardenTimelineView, TimelineView } from "@/components/blueprint/timeline/TimelineView";
import { journeyFlagsFromEnv, nextOwnerStep, ownerStepHref } from "@/lib/journey";
import { ownerEyebrow } from "@/lib/journey-eyebrow";
import { loadTimeline } from "@/lib/timeline/load";

export const dynamic = "force-dynamic";

/**
 * 05 Timeline (K8 #7, spec §6.6, Figma 59:837). Re-derived on every visit from
 * the project's current take-off and latest BoQ (lib/timeline), so it follows
 * product picks and plan edits without anyone remembering to refresh it.
 */
export default async function TimelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadTimeline(id);
  const next = nextOwnerStep("timeline")!;
  return (
    <div className="mx-auto max-w-[1344px] px-6 pb-16 pt-8 lg:px-12" data-timeline>
      <TopBarActions>
        <Button kind="primary" href={ownerStepHref(next.key, id, journeyFlagsFromEnv())}>
          Continue to {next.label.toLowerCase()}
        </Button>
      </TopBarActions>
      <PageHeader eyebrow={ownerEyebrow("timeline")} title="How long it will take" intro={data.garden ? "A programme scaled from a real Dubai garden project. One reference project earns an honest estimate, not a promise." : "A phase plan scaled from a real Dubai villa refit. Durations are ranges: one calibrated project earns an honest estimate, not a promise."} />
      <div className="mt-7">
        {data.garden ? (
          // K9: a garden project shows its BoQ programme — never the interior model.
          <GardenTimelineView timeline={data.garden} />
        ) : data.estimate ? (
          <TimelineView estimate={data.estimate} />
        ) : (
          <div className="max-w-[720px]">
            <StateBlock kind="empty" icon="calendar_month" title="No timeline yet" actions={<Button kind="primary" href={`/project/${id}/boq`}>Open cost</Button>}>
              {data.blocked}
            </StateBlock>
          </div>
        )}
      </div>
    </div>
  );
}
