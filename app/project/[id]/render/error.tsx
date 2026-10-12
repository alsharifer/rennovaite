"use client";

import { SegmentError } from "@/components/blueprint/shell/SegmentError";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="the renders studio" safe="Nothing was lost — your renders and locked views are saved." error={error} reset={reset} />;
}
