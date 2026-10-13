// =============================================================================
// components/blueprint/shell/SegmentStates.tsx — loading / not-found inside the
// shell (R7 §2 State block, K2; the not-found layout is K8 #11, 63:1175). A
// redesigned segment's loading.tsx and not-found.tsx render one of these; its
// layout keeps the rail and top bar on screen around them. (error.tsx must be
// a client component — SegmentError.)
// =============================================================================

import { SIGNED_IN_HOME } from "@/lib/auth/link-error";

import { Button } from "../Button";
import { StateBlock } from "../StateBlock";
import { PageMessage } from "./PageMessage";

/** Skeleton rows inside the shell: aria-busy + the words a screen reader hears. */
export function SegmentLoading({ what, rows = 6, columns = 5 }: { what: string; rows?: number; columns?: number }) {
  return (
    <div data-system="blueprint" className="mx-auto max-w-[1280px]">
      <StateBlock kind="loading" title={`Loading ${what}`} rows={rows} columns={columns} />
    </div>
  );
}

/**
 * ONE message for "doesn't exist" and "no access" (spec §6.8): it never
 * confirms that a project exists to someone who is not its member.
 */
export const NOT_FOUND_TITLE = "We can’t find that page";
export const NOT_FOUND_BODY = "It may have moved, or it belongs to a project you’re not a member of. Ask the project owner to add you if you think you should see it.";

export function SegmentNotFound({ title = NOT_FOUND_TITLE, body = NOT_FOUND_BODY, href = SIGNED_IN_HOME, action = "Back to projects" }: { title?: string; body?: string; href?: string; action?: string }) {
  return (
    <PageMessage icon="search_off" title={title} action={<Button kind="primary" href={href}>{action}</Button>}>
      {body}
    </PageMessage>
  );
}
