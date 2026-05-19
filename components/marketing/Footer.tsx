import Link from "next/link";

const COLUMNS: { heading: string; links: string[] }[] = [
  {
    heading: "Product",
    links: ["Floorplans", "AI Rendering", "Cost Calculator", "Contractors"],
  },
  {
    heading: "Company",
    links: ["About Us", "Design Atelier", "Careers", "Contact"],
  },
  {
    heading: "Legal",
    links: ["Privacy Policy", "Terms of Service", "Refund Policy"],
  },
];

export function Footer() {
  return (
    <footer className="bg-ink-900 px-margin py-xl text-white">
      <div className="mx-auto max-w-[1440px]">
        <div className="mb-xl grid grid-cols-12 gap-gutter border-b border-white/10 pb-xl">
          <div className="col-span-12 md:col-span-3">
            <div className="mb-md font-display text-headline-md text-brass-600 tracking-tight">
              RennovAIte
            </div>
            <p className="font-body-sm text-body-sm text-white/60">
              Architectural intelligence for the modern Dubai homeowner.
            </p>
          </div>
          {COLUMNS.map((col, ci) => (
            <div
              key={col.heading}
              className={[
                "col-span-6 md:col-span-2",
                ci === 0 ? "md:col-start-6" : "",
              ].join(" ")}
            >
              <h4 className="mb-lg font-label-caps text-label-caps uppercase tracking-widest text-white">
                {col.heading}
              </h4>
              <ul className="flex flex-col gap-md text-body-sm text-white/60">
                {col.links.map((link) => (
                  <li key={link}>
                    <Link
                      href="#"
                      className="transition-colors hover:text-brass-600"
                    >
                      {link}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="flex flex-col items-center justify-between gap-md font-label-caps text-label-caps uppercase tracking-[0.1em] text-white/40 md:flex-row">
          <div>© 2026 · Dubai, United Arab Emirates</div>
          <div className="flex items-center gap-lg">
            <Link href="#" className="transition-colors hover:text-white">
              EN | AR
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
