"use client";

// Catches anything thrown below the root layout that a nearer boundary did not
// (K8 #11, 63:1175). A client boundary cannot load the shell, so it draws the
// same message on a Blueprint page of its own; every redesigned segment has
// its own error.tsx inside its shell.
import { SegmentError } from "@/components/blueprint/shell/SegmentError";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div data-system="blueprint" className="min-h-screen bg-bp-surface-base font-bp-sans text-bp-ink-primary">
      <SegmentError safe="Nothing in your project has changed." error={error} reset={reset} />
    </div>
  );
}
