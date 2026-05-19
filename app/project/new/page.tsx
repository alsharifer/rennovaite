import type { Metadata } from "next";

import { AppShell } from "@/components/app/AppShell";

import { VillaIntake } from "./_components/villa-intake";

export const metadata: Metadata = {
  title: "New project · RennovAIte",
};

const SEGMENTS = 5;

export default function NewProjectPage() {
  return (
    <AppShell pageName="New Project">
      <div className="mx-auto max-w-[1100px]">
        {/* Header */}
        <header className="mb-2xl">
          <p className="label-caps mb-md text-brass-600">Step 01 of 05</p>
          <div className="mb-xl flex gap-sm" aria-hidden="true">
            {Array.from({ length: SEGMENTS }).map((_, i) => (
              <span
                key={i}
                className={
                  "h-1 flex-1 rounded-full " +
                  (i === 0 ? "bg-brass-600" : "bg-bone")
                }
              />
            ))}
          </div>
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
