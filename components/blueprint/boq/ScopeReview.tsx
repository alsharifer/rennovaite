"use client";

// =============================================================================
// components/blueprint/boq/ScopeReview.tsx — "Scope review needed" on a BoQ line
// (Sprint C3). A product swapped across install classes (an exposed shower set
// for a concealed valve, a wall-hung basin for one on a vanity) left this line
// priced for the old install. The member re-prices it if it changed (Add a
// price / Capture correction), then marks the change reviewed: POST
// /api/projects/:id/scope-review and a regenerate. Until then the Issues
// navigator lists it and the export is blocked.
// =============================================================================

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/blueprint/Button";

export function ScopeReview({ projectId, field, text }: { projectId: string; field: string; text: string }) {
  const router = useRouter();
  const [state, setState] = useState<{ kind: "idle" } | { kind: "running" } | { kind: "error"; text: string }>({ kind: "idle" });

  async function review() {
    setState({ kind: "running" });
    try {
      const r = await fetch(`/api/projects/${projectId}/scope-review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ field }) });
      const b = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(b.error ?? `Not recorded (${r.status}).`);
      const gen = await fetch("/api/generate-boq", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project_id: projectId }) });
      if (!gen.ok) throw new Error("Reviewed — regenerate the BoQ to clear the flag.");
      router.refresh();
      setState({ kind: "idle" });
    } catch (e) {
      setState({ kind: "error", text: e instanceof Error ? e.message : "Not recorded." });
    }
  }

  return (
    <div className="surface-inverse bg-bp-alert-surface px-4 py-3 text-bp-alert-ink" data-scope-review={field} role="note">
      <p className="t-nav-item-active">{text}</p>
      <p className="t-body-sm mt-1">This line is priced for the old install. Re-price it if it changed, then mark the change reviewed — the export stays blocked until you do.</p>
      <div className="mt-3">
        <Button kind="secondary" tone="inverse" onClick={() => void review()} disabled={state.kind === "running" ? { reason: "Recording the review…", reasonId: `scope-review-${field}-why`, showReason: true } : false} testId="scope-review-mark">
          {state.kind === "running" ? "Recording and regenerating…" : "Mark reviewed"}
        </Button>
      </div>
      {state.kind === "error" ? <p className="t-body-sm mt-2" role="alert">{state.text}</p> : null}
    </div>
  );
}
