// =============================================================================
// components/blueprint/SubTabs.tsx — a step's text tabs (K8, spec §6.0).
//
// Each tab is a real link to its own route (04 Cost: /boq | /accessories,
// 06 Tender: /drawings | /vendors) or view (02 Design: ?view=direction |
// references). Active = semibold ink + the brass 2 px underline (brass draws
// lines only) + aria-current="page"; a tab may carry a mono suffix — a count or
// the step's figure ("≈ 412,640.00*", "3 of 14 chosen"). A hairline runs under
// the strip. Navigation, not WAI-ARIA tabs: each tab loads a page.
// =============================================================================

import Link from "next/link";

export interface SubTab {
  key: string;
  label: string;
  href: string;
  /** Mono suffix after the label: a count, a status, a figure. */
  meta?: string;
}

export function SubTabs({ label, tabs, active }: { label: string; tabs: SubTab[]; active: string }) {
  if (tabs.length < 2) return null;
  return (
    <nav aria-label={label} className="border-b border-bp-line-hairline">
      <ul className="-mb-px flex flex-wrap gap-x-6">
        {tabs.map((t) => {
          const on = t.key === active;
          return (
            <li key={t.key}>
              <Link
                href={t.href}
                aria-current={on ? "page" : undefined}
                data-tab={t.key}
                className={`inline-flex min-h-11 items-center gap-2 border-b-2 py-2 outline-offset-2 ${on ? "t-nav-item-active border-bp-brass text-bp-ink-primary" : "t-nav-item border-transparent text-bp-ink-secondary hover:text-bp-ink-primary"}`}
              >
                {t.label}
                {t.meta ? <span className="t-label-md text-bp-ink-tertiary">{t.meta}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
