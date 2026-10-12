"use client";

import { SegmentError } from "@/components/blueprint/shell/SegmentError";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="the BoQ" safe="Nothing was lost — your revisions are intact." error={error} reset={reset} />;
}
