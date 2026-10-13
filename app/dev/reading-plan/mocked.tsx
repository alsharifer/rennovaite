"use client";

// The sandbox's parse never answers, so the screen stays on its reading (or,
// with `slow`, its taking-longer) state.
import { ReadingPlan } from "@/components/blueprint/intake/ReadingPlan";

let patched = false;
function holdParse() {
  if (patched || typeof window === "undefined") return;
  patched = true;
  const real = window.fetch.bind(window);
  window.fetch = (input, init) => (String(input instanceof Request ? input.url : input).includes("/api/parse-plan") ? new Promise<Response>(() => {}) : real(input, init));
}

export function MockedReadingPlan({ slow, eyebrow }: { slow: boolean; eyebrow: string }) {
  holdParse();
  return <ReadingPlan projectId="00000000-0000-4000-8000-000000000000" planId="00000000-0000-4000-8000-000000000000" eyebrow={eyebrow} subtitle="Sandbox villa · ground-floor-plan.pdf · 6.2 MB" slowAfterMs={slow ? 50 : undefined} />;
}
