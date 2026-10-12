// =============================================================================
// components/blueprint/shell/SegmentStates.tsx — loading / not-found inside the
// shell (R7 §2 State block, K2). A redesigned segment's loading.tsx and
// not-found.tsx render one of these; its layout keeps the rail and top bar on
// screen around them. (error.tsx must be a client component — SegmentError.)
// =============================================================================

import { Button } from "../Button";
import { StateBlock } from "../StateBlock";

/** Skeleton rows inside the shell: aria-busy + the words a screen reader hears. */
export function SegmentLoading({ what, rows = 6, columns = 5 }: { what: string; rows?: number; columns?: number }) {
  return (
    <div data-system="blueprint" className="mx-auto max-w-[1280px]">
      <StateBlock kind="loading" title={`Loading ${what}`} rows={rows} columns={columns} />
    </div>
  );
}

export function SegmentNotFound({ title, body, href, action }: { title: string; body: string; href: string; action: string }) {
  return (
    <div data-system="blueprint" className="mx-auto max-w-[720px]">
      <StateBlock kind="empty" icon="search_off" title={title} actions={<Button kind="primary" href={href}>{action}</Button>}>
        {body}
      </StateBlock>
    </div>
  );
}
