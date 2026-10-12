"use client";

import { SegmentError } from "@/components/blueprint/shell/SegmentError";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError what="the 3D view" safe="Nothing was lost — the 3D view is drawn from your saved plan." error={error} reset={reset} />;
}
