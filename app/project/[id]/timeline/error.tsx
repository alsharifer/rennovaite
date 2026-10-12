"use client";

import { SegmentError } from "@/components/blueprint/shell/SegmentError";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="the timeline" safe="Nothing was lost — the timeline is worked out from your BoQ each visit." error={error} reset={reset} />;
}
