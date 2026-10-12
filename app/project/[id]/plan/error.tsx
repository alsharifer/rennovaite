"use client";

import { SegmentError } from "@/components/blueprint/shell/SegmentError";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="the plan" safe="Nothing was lost — your last saved plan is intact." error={error} reset={reset} />;
}
