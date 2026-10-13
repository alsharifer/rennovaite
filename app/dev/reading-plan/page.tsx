import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AccountShell } from "@/components/blueprint/shell/ProjectShell";
import { ownerStep } from "@/lib/journey";

import { MockedReadingPlan } from "./mocked";

// =============================================================================
// /dev/reading-plan — "Reading your plan" (K8 #12, 63:4510) with the parse
// mocked in the browser, so its states can be checked without a real upload
// or a model call. ?state=reading (default) | slow. Signed-in only (the proxy
// gates every page) and absent in production.
// =============================================================================

export const metadata: Metadata = { title: "Reading your plan · sandbox", robots: { index: false, follow: false } };

export default async function ReadingPlanSandbox({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (process.env.VERCEL_ENV === "production") notFound();
  const { state } = await searchParams;
  const step = ownerStep("plan");
  return (
    <AccountShell skin="warm">
      <div className="mx-auto max-w-[1100px] px-6 py-10 lg:px-12" data-skin-page="intake">
        <MockedReadingPlan slow={state === "slow"} eyebrow={`${step.number} · ${step.label.toUpperCase()}`} />
      </div>
    </AccountShell>
  );
}
