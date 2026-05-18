import { FadeIn } from "@/app/_components/fade-in";
import { AppShell } from "@/components/AppShell";
import { BackButton } from "@/components/back-button";

export default async function VendorsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <AppShell pageName="Vendors">
      <main className="flex min-h-[calc(100vh-4rem)] flex-col px-6 py-16 sm:py-24">
        <div className="mx-auto w-full max-w-[1200px]">
          <BackButton />
        </div>
        <div className="flex flex-1 items-center justify-center">
          <FadeIn className="text-center">
            <p className="text-xs uppercase tracking-widest text-on-surface-variant">
              Step 6 of 6 · Project {id.slice(0, 8)}
            </p>
            <h1 className="mt-3 text-h2 text-on-surface">
              Send to contractors
            </h1>
            <p className="mt-3 text-body-md text-on-surface-variant">
              Coming next.
            </p>
          </FadeIn>
        </div>
      </main>
    </AppShell>
  );
}
