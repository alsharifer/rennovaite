import { FadeIn } from "@/app/_components/fade-in";
import { AppShell } from "@/components/AppShell";
import { BackButton } from "@/components/back-button";

export default async function BoqPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <AppShell pageName="Bill of Quantities">
      <main className="flex min-h-[calc(100vh-4rem)] flex-col px-6 py-16 sm:py-24">
        <div className="mx-auto w-full max-w-[1200px]">
          <BackButton />
        </div>
        <div className="flex flex-1 items-center justify-center">
          <FadeIn className="text-center">
            <p className="text-xs uppercase tracking-widest text-text-tertiary">
              Step 5 of 6 · Project {id.slice(0, 8)}
            </p>
            <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-brand-accent sm:text-5xl">
              Bill of Quantities
            </h1>
            <p className="mt-3 text-sm text-text-secondary">Coming next.</p>
          </FadeIn>
        </div>
      </main>
    </AppShell>
  );
}
