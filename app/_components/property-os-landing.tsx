import Link from "next/link";

// =============================================================================
// Property OS intro / landing page (gated on PROPERTY_OS_LANDING).
//
// Four-pillar platform vision with RennovAIte as the only live product; the
// other three pillars are honest, INERT roadmap tiles (no links, no product
// pages). Atelier tokens are used for every standard role (canvas / paper /
// ink-900 / brass-600 / bone / ink-100 borders); the design's bespoke band
// colours + green dot have no semantic token and use their design hex values.
// Token↔design hex divergences are listed in the PR/report.
//
// Server component — static content, inert roadmap tiles, CSS-only hover.
// =============================================================================

const ENTER_ARROW = (
  <svg
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="size-4 shrink-0"
    aria-hidden="true"
  >
    <path d="M4 10h11M11 5l5 5-5 5" />
  </svg>
);

type Roadmap = {
  code: string; // "P2A"
  mobileLabel: string; // "P2A · RECONSTRUCTION"
  title: string;
  descDesktop: string;
  descMobile: string;
  meta: string;
  note: string;
  bandClass: string; // band background
  codeClass: string; // band left label colour
  roadmapClass: string; // band right "ROADMAP" colour
};

const ROADMAP: Roadmap[] = [
  {
    code: "P2A",
    mobileLabel: "P2A · RECONSTRUCTION",
    title: "Reconstruction",
    descDesktop:
      "Major structural works, extensions, and full rebuilds, higher-ticket projects with design and project management end-to-end.",
    descMobile:
      "Major structural works, extensions, and full rebuilds with design and project management end-to-end.",
    meta: "HOMEOWNERS + DEVELOPERS",
    note: "Opens after the renovation marketplace proves out",
    bandClass: "bg-[#D9BE8C]",
    codeClass: "text-[#4a3d22]",
    roadmapClass: "text-[#4a3d22]",
  },
  {
    code: "P2B",
    mobileLabel: "P2B · GROUND-UP",
    title: "Ground-up",
    descDesktop:
      "From plot to keys; generative design to construction documents, quantities, and compliance for new builds.",
    descMobile:
      "From plot to keys; generative design to construction documents, quantities, and compliance.",
    meta: "DEVELOPERS · CONSULTANTS",
    note: "Built on the same graph that prices renovations today",
    bandClass: "bg-[#131F33]",
    codeClass: "text-[#F4F1EA]",
    roadmapClass: "text-[#8fa0bd]",
  },
  {
    code: "P3",
    mobileLabel: "P3 · FACILITIES MGMT",
    title: "Facilities Management",
    descDesktop:
      "Everything after handover; maintenance, service contracts, and compliance for the property you already run.",
    descMobile:
      "Everything after handover; maintenance, service contracts, and compliance for the property you run.",
    meta: "OWNERS · OPERATORS",
    note: "The end-state platform layer",
    bandClass: "bg-ink-900",
    codeClass: "text-[#F4F1EA]",
    roadmapClass: "text-[#7E7A6F]",
  },
];

const EDGE = "mx-auto w-full max-w-[1440px] px-6 lg:px-[72px]";

export function PropertyOsLanding() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink-900">
      {/* NAV ------------------------------------------------------------- */}
      <header className="border-b border-ink-100">
        <div className={`${EDGE} flex h-[76px] items-center justify-between`}>
          <span className="font-mono text-[13px] tracking-[0.22em] text-ink-900">
            PROPERTY OS
          </span>
          <nav className="flex items-center gap-md">
            {/* Desktop: text link + primary button */}
            <Link
              href="/auth"
              className="focus-ring hidden items-center font-body text-[13px] font-medium text-on-surface-variant transition-colors hover:text-ink-900 sm:inline-flex"
            >
              Sign in
            </Link>
            <Link
              href="/rennovaite"
              className="focus-ring hidden items-center rounded-lg bg-ink-900 px-[18px] py-[9px] font-body text-[13px] font-semibold text-canvas transition-opacity hover:opacity-90 sm:inline-flex"
            >
              Open RennovAIte
            </Link>
            {/* Mobile: single ink Sign in button */}
            <Link
              href="/auth"
              className="focus-ring inline-flex items-center rounded-lg bg-ink-900 px-[18px] py-[9px] font-body text-[13px] font-semibold text-canvas transition-opacity hover:opacity-90 sm:hidden"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      {/* MAIN ------------------------------------------------------------ */}
      <main className={`${EDGE} flex-1`}>
        {/* HERO */}
        <section className="max-w-[880px] pb-10 pt-14">
          <p className="font-mono text-[11px] tracking-[0.24em] text-brass-600">
            ONE PLATFORM FOR THE LIFE OF A PROPERTY
          </p>
          <h1
            className="mt-md font-display text-[34px] font-semibold leading-[1.08] text-ink-900 sm:text-[54px]"
            style={{ textWrap: "balance" }}
          >
            Design it. Price it. Get it built.
          </h1>
          {/* Desktop subline */}
          <p className="mt-md hidden max-w-[640px] font-body text-[17px] leading-[1.6] text-on-surface-variant sm:block">
            Beginning with the deepest renovation engine in Dubai, calibrated
            against real signed contracts and expanding to everything your
            property will ever need.
          </p>
          {/* Mobile subline */}
          <p className="mt-md max-w-[640px] font-body text-[17px] leading-[1.6] text-on-surface-variant sm:hidden">
            Beginning with the deepest renovation engine in Dubai — calibrated
            against real signed contracts.
          </p>
        </section>

        {/* PILLAR GRID */}
        <ul className="grid grid-cols-1 gap-[22px] pb-2xl sm:grid-cols-2 xl:grid-cols-4">
          {/* 1 — RennovAIte (LIVE) */}
          <li className="group flex flex-col overflow-hidden rounded-md border border-ink-100 bg-paper shadow-level-1 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-level-2">
            <div className="flex items-center justify-between bg-[#C9964B] px-[18px] py-[10px]">
              <span className="font-mono text-[10px] tracking-[0.14em] text-white">
                LIVE NOW
              </span>
              <span className="size-2 rounded-full bg-[#3FA97A]" aria-hidden="true" />
            </div>
            <div className="flex flex-1 flex-col gap-3 px-5 py-[22px]">
              <h2 className="font-display text-[26px] font-bold text-ink-900">RennovAIte</h2>
              <p className="font-body text-[13px] leading-[1.55] text-on-surface-variant">
                Redesign and renovate your home. AI design, an itemized cost plan
                accurate to the line, permits, and trusted execution.
              </p>
              <p className="hidden font-mono text-[10px] tracking-[0.1em] text-brass-600 sm:block">
                RENOVATION · DUBAI
              </p>
              <Link
                href="/rennovaite"
                className="focus-ring mt-auto flex items-center justify-center gap-sm rounded-[9px] bg-ink-900 py-3 font-body text-[14px] font-semibold text-canvas transition-opacity hover:opacity-90"
              >
                Enter RennovAIte
                {ENTER_ARROW}
              </Link>
            </div>
          </li>

          {/* 2–4 — roadmap tiles (INERT: no link, no hover, no pointer) */}
          {ROADMAP.map((p) => (
            <li
              key={p.code}
              aria-label={`${p.title} — on the roadmap, not yet available`}
              className="flex flex-col overflow-hidden rounded-md border border-ink-100 bg-bone"
            >
              <div className={`flex items-center justify-between px-[18px] py-[10px] ${p.bandClass}`}>
                {/* Desktop band: code left, ROADMAP right */}
                <span className={`hidden font-mono text-[10px] tracking-[0.14em] sm:inline ${p.codeClass}`}>
                  {p.code}
                </span>
                {/* Mobile band: "PXX · PILLAR NAME" */}
                <span className={`font-mono text-[10px] tracking-[0.14em] sm:hidden ${p.codeClass}`}>
                  {p.mobileLabel}
                </span>
                <span
                  className={`hidden font-mono text-[10px] tracking-[0.14em] sm:inline ${p.roadmapClass}`}
                  aria-label="on the roadmap, not yet available"
                >
                  ROADMAP
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-3 px-5 py-[22px]">
                <h2 className="hidden font-display text-[26px] font-bold text-ink-900 sm:block">
                  {p.title}
                </h2>
                {/* Desktop description */}
                <p className="hidden font-body text-[13px] leading-[1.55] text-on-surface-variant sm:block">
                  {p.descDesktop}
                </p>
                {/* Mobile description (shorter, per spec) */}
                <p className="font-body text-[13px] leading-[1.55] text-on-surface-variant sm:hidden">
                  {p.descMobile}
                </p>
                <p className="hidden font-mono text-[10px] tracking-[0.1em] text-brass-600 sm:block">
                  {p.meta}
                </p>
                <p className="mt-auto hidden border-t border-dashed border-ink-100 pt-3 text-center font-body text-[12px] italic text-on-surface-variant sm:block">
                  {p.note}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </main>

      {/* FOOTER ---------------------------------------------------------- */}
      <footer className="border-t border-ink-100">
        <div className={`${EDGE} py-5`}>
          <p className="font-mono text-[11px] leading-[1.6] text-on-surface-variant">
            Every number traces to a real element, rule, or transaction —
            calibrated on signed Dubai contracts.
          </p>
        </div>
      </footer>
    </div>
  );
}
