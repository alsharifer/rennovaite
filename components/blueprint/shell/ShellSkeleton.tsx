// =============================================================================
// components/blueprint/shell/ShellSkeleton.tsx — the chrome while a page that
// frames ITSELF is loading (the hub). Pages framed by a layout never need it:
// their rail and top bar stay on screen.
// =============================================================================

import { SkeletonRows } from "../StateBlock";

export function ShellSkeleton({ what }: { what: string }) {
  return (
    <div data-system="blueprint" className="bp-shell min-h-screen bg-bp-surface-base" aria-busy="true">
      <div className="bp-rail border-r border-bp-line-strong bg-bp-surface-base p-6" aria-hidden="true">
        <span className="bp-pulse block h-4 w-24 bg-bp-surface-sunken" />
        <span className="bp-pulse mt-10 block h-3 w-32 bg-bp-surface-sunken" />
        <span className="bp-pulse mt-8 block h-3 w-28 bg-bp-surface-sunken" />
      </div>
      <div className="bp-topbar border-b border-bp-line-hairline bg-bp-surface-base" aria-hidden="true" />
      <main className="bp-main">
        <div className="mx-auto max-w-[1280px] p-4 md:p-12">
          <p className="t-label-caps mb-3 text-bp-ink-tertiary">Loading {what}</p>
          <SkeletonRows rows={6} />
        </div>
      </main>
    </div>
  );
}
