export default function PlanLoading() {
  return (
    <main className="flex min-h-screen justify-center px-6 py-16 sm:py-24">
      <div className="w-full max-w-[980px] animate-pulse">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="h-10 w-64 rounded-md bg-bg-elevated/80 sm:h-12 sm:w-80" />
          <div className="h-6 w-56 rounded-md bg-bg-elevated/80" />
        </div>

        <div className="mt-8 flex justify-end">
          <div className="h-3 w-40 rounded bg-bg-elevated/60" />
        </div>

        <div className="mt-2 h-3 w-full overflow-hidden rounded-xl border border-bg-border bg-bg-elevated/40">
          <div className="h-3 rounded bg-bg-elevated/60" />
        </div>
        <div className="mt-2 aspect-[1000/600] w-full rounded-xl border border-bg-border bg-bg-elevated/40" />

        <section className="mt-10 flex flex-col items-center text-center">
          <div className="h-14 w-40 rounded-md bg-bg-elevated/70 sm:h-16 sm:w-48" />
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <div className="h-6 w-20 rounded-full bg-bg-elevated/70" />
            <div className="h-6 w-24 rounded-full bg-bg-elevated/70" />
            <div className="h-6 w-24 rounded-full bg-bg-elevated/70" />
          </div>
        </section>

        <div className="mt-12 flex justify-center">
          <div className="h-10 w-56 rounded-lg bg-bg-elevated/70" />
        </div>
      </div>
    </main>
  );
}
