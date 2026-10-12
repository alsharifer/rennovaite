"use client";

import { SegmentError } from "@/components/blueprint/shell/SegmentError";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="contractors and suppliers" safe="Nothing was lost — your chosen suppliers are saved." error={error} reset={reset} />;
}
