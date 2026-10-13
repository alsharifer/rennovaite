"use client";

import { SegmentError } from "@/components/blueprint/shell/SegmentError";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="your design" safe="Nothing was lost — your answers, direction and pinned references are saved." error={error} reset={reset} />;
}
