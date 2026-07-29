"use client";

// =============================================================================
// components/staging/FurnitureOptIn.tsx — the ghost "Add furniture to your
// budget?" opt-in (P7). Shown once per locked room, non-pushy. Accepting POSTs
// to /api/furniture-opt-in; the optional "Furniture (optional)" BoQ section
// then appears on the BoQ page. Dismissing hides it for the session.
// =============================================================================

import { useState } from "react";

export function FurnitureOptIn({
  projectId,
  roomId,
  alreadyOptedIn = false,
}: {
  projectId: string;
  roomId: string;
  alreadyOptedIn?: boolean;
}) {
  const [state, setState] = useState<
    "offer" | "accepted" | "dismissed" | "saving"
  >(alreadyOptedIn ? "accepted" : "offer");

  if (state === "dismissed") return null;

  if (state === "accepted") {
    return (
      <p className="flex items-center gap-xs font-body-sm text-[12px] italic text-on-surface-variant">
        <span className="material-symbols-outlined text-[16px] text-brass-600" aria-hidden="true">
          chair
        </span>
        Furniture added to your budget as an optional line — toggle it off any
        time on the BoQ.
      </p>
    );
  }

  async function accept() {
    setState("saving");
    try {
      await fetch("/api/furniture-opt-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, room_id: roomId }),
      });
    } catch {
      /* best-effort — the section still renders from staging_set on reload */
    }
    setState("accepted");
  }

  return (
    <div className="flex items-center gap-sm rounded-lg border border-dashed border-ink-100 bg-canvas px-md py-sm">
      <span className="material-symbols-outlined text-[18px] text-on-surface-variant" aria-hidden="true">
        chair
      </span>
      <p className="flex-1 font-body-sm text-[12px] text-on-surface-variant">
        Add the staged furniture to your budget?{" "}
        <span className="text-ink-500">Optional — never in contractor scope.</span>
      </p>
      <button
        type="button"
        onClick={accept}
        disabled={state === "saving"}
        className="focus-ring rounded font-body-sm text-[12px] font-semibold text-brass-600 hover:underline disabled:opacity-50"
      >
        {state === "saving" ? "Adding…" : "Add"}
      </button>
      <button
        type="button"
        onClick={() => setState("dismissed")}
        aria-label="Dismiss"
        className="focus-ring flex size-6 items-center justify-center rounded text-on-surface-variant hover:text-ink-900"
      >
        <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
          close
        </span>
      </button>
    </div>
  );
}
