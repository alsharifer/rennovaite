import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { AppShell } from "@/components/app/AppShell";
import { Badge } from "@/components/ui/badge";

import { FadeIn } from "../_components/fade-in";
import { FloorplanUpload } from "./_components/floorplan-upload";

export default function ProjectPage() {
  return (
    <AppShell pageName="New Project">
      <main className="flex min-h-[calc(100vh-4rem)] justify-center px-6 py-16 sm:py-24">
        <div className="w-full max-w-[720px]">
          <FadeIn>
            <Link
              href="/my-projects"
              className="-ml-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-sm text-text-secondary transition-colors hover:bg-bg-elevated/60 hover:text-text-primary"
            >
              <ChevronLeft className="size-4" />
              My Projects
            </Link>

            <div className="mt-6 flex flex-wrap items-start justify-between gap-3">
              <h1 className="font-display text-4xl font-semibold tracking-tight text-brand-accent sm:text-5xl">
                Start a new project
              </h1>
              <Badge
                variant="secondary"
                className="bg-bg-elevated text-text-secondary"
              >
                Step 1 of 6 — Upload your floorplan
              </Badge>
            </div>

            <section className="mt-10">
              <FloorplanUpload />
            </section>
          </FadeIn>
        </div>
      </main>
    </AppShell>
  );
}
