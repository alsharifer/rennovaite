import type { Metadata } from "next";

import { AppShell } from "@/components/app/AppShell";
import { JourneyProgress } from "@/components/app/JourneyChrome";

import { VillaIntake } from "./_components/villa-intake";

export const metadata: Metadata = {
  title: "New project · RennovAIte",
};


export default function NewProjectPage() {
  return (
    <AppShell pageName="New Project">
      <div className="mx-auto max-w-[1100px]">
        {/* Header */}
        <header className="mb-2xl">
          <JourneyProgress stepKey="intake" projectId={null} />
          <h1 className="mb-md font-display text-headline-lg text-ink-900">
            Let&apos;s start with your villa.
          </h1>
          <p className="max-w-[640px] font-body text-body-lg text-on-surface-variant">
            Drop your floorplan and a few photos of the rooms you&apos;d like
            to renovate. We accept PDF, DWG, RVT, JPG, PNG, HEIC.
          </p>
        </header>

        <VillaIntake />
      </div>
    </AppShell>
  );
}
