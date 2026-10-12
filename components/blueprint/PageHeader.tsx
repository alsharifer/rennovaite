// =============================================================================
// components/blueprint/PageHeader.tsx — a working page's head (R7 §1.2, J6).
//
// Eyebrow (label/caps, brass text — the step "02 · DESIGN" from the journey,
// never a literal) · title (heading/lg — working screens carry no display
// serif) · one intro sentence (body/md, secondary) · then the step's sub-tabs
// when it has them. The frames put 32 px between the intro and the tabs.
// =============================================================================

import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, intro, tabs, className = "" }: { eyebrow: string; title: string; intro?: ReactNode; tabs?: ReactNode; className?: string }) {
  return (
    <header className={className}>
      <p className="t-label-caps text-bp-brass-text">{eyebrow}</p>
      <h1 className="t-heading-lg mt-3 text-bp-ink-primary">{title}</h1>
      {intro ? <p className="t-body-md mt-2 max-w-[760px] text-bp-ink-secondary">{intro}</p> : null}
      {tabs ? <div className="mt-8">{tabs}</div> : null}
    </header>
  );
}
