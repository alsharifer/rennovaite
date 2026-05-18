import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";

import { FadeIn } from "./_components/fade-in";

export default function Home() {
  return (
    <AppShell pageName="Welcome">
      <main className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center px-6 text-center md:px-12">
        <FadeIn className="flex flex-1 flex-col items-center justify-center">
          {/*
            One hero per screen (principle 3): the wordmark.
            One indigo per page (principle 4): on the wordmark only.
            Typography is the star (principle 2): text-h1 token at the
            spec'd 60px and the natural Plus Jakarta Sans 700.
          */}
          <h1 className="text-h1 text-indigo-500 sm:text-[72px] sm:leading-[1.05] sm:tracking-[-0.03em]">
            RennovAIte
          </h1>
          <p className="mt-6 max-w-[560px] text-body-lg text-on-surface-variant">
            Coming soon to Dubai
          </p>
          <Button
            size="lg"
            nativeButton={false}
            render={<Link href="/project" />}
            className="mt-12 transition-transform duration-150 hover:scale-[1.02] active:scale-[0.98]"
          >
            Start a project
            <ArrowRight />
          </Button>
        </FadeIn>
        <footer className="pb-8 pt-16 text-label-sm text-on-surface-variant">
          Built in Dubai · From floorplan to finished home in 5 days
        </footer>
      </main>
    </AppShell>
  );
}
