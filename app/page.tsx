import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";

import { FadeIn } from "./_components/fade-in";

export default function Home() {
  return (
    <AppShell pageName="Welcome">
      <main className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center px-6 text-center">
        <FadeIn className="flex flex-1 flex-col items-center justify-center">
          <h1 className="font-display text-5xl font-semibold tracking-tight text-brand-primary sm:text-7xl">
            RennovAIte
          </h1>
          <p className="mt-6 font-serif text-lg italic text-brand-accent sm:text-xl">
            Coming soon to Dubai
          </p>
          <Button
            size="lg"
            nativeButton={false}
            render={<Link href="/project" />}
            className="mt-10"
          >
            Start a project
            <ArrowRight />
          </Button>
        </FadeIn>
        <footer className="pb-8 pt-16 text-sm text-text-tertiary">
          Built in Dubai · From floorplan to finished home in 5 days
        </footer>
      </main>
    </AppShell>
  );
}
