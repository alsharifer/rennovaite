"use client";

// =============================================================================
// components/blueprint/shell/SegmentError.tsx — a segment's error.tsx body
// (R7 §2 State block Error, 18:355): the inverse block with the cause, what is
// safe, Try again, and a ref code (Next's error digest — the server log key).
// It renders inside the segment's layout, so the rail and top bar stay.
// Not role="alert": it replaces the page on load, it is not the result of a
// click (spec §4.2 #13).
// =============================================================================

import { Button } from "../Button";
import { StateBlock } from "../StateBlock";

export function SegmentError({ what, safe, error, reset }: { what: string; safe: string; error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div data-system="blueprint" className="mx-auto max-w-[720px]">
      <StateBlock
        kind="error"
        title={`Couldn't load ${what}`}
        refCode={error.digest ? `ERR-${error.digest.slice(0, 10).toUpperCase()}` : undefined}
        actions={
          <Button kind="secondary" tone="inverse" onClick={reset}>
            Try again
          </Button>
        }
      >
        <p>Something went wrong on our side. {safe}</p>
      </StateBlock>
    </div>
  );
}
