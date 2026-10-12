"use client";

// =============================================================================
// components/blueprint/shell/SegmentError.tsx — a segment's error.tsx body
// (K8 #11, spec §6.8, 63:1175): "Something went wrong on our side", what is
// safe, Try again, Contact support and the reference code (Next's error digest
// — the server log key). It renders inside the segment's layout, so the rail
// and top bar stay. Not role="alert": it replaces the page on load, it is not
// the result of a click (spec §4.2 #13).
// =============================================================================

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { Button } from "../Button";
import { PageMessage, errorRef } from "./PageMessage";

export function SegmentError({ safe, error, reset }: { what?: string; safe: string; error: Error & { digest?: string }; reset: () => void }) {
  const pathname = usePathname();
  useEffect(() => {
    // Route context is the point: the same message with the route tells support where to look.
    console.error("[route-error]", { route: pathname, digest: error.digest ?? null, message: error.message });
  }, [error, pathname]);
  return (
    <PageMessage
      icon="error"
      title="Something went wrong on our side"
      refCode={errorRef(error.digest)}
      action={
        <Button kind="primary" onClick={reset}>
          Try again
        </Button>
      }
    >
      {safe}
    </PageMessage>
  );
}
