"use client";

import { SegmentError } from "@/components/blueprint/shell/SegmentError";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="the proposal" safe="Nothing was lost — no proposal was issued." error={error} reset={reset} />;
}
