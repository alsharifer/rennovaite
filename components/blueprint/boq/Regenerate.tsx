"use client";

// =============================================================================
// components/blueprint/boq/Regenerate.tsx — the Regenerate control wired to
// H4's path (R7 §2 15:292, K3).
//
// The server decides the starting state with the SAME functions every other
// surface uses — never a rule of its own:
//   blocked    regenerateReadiness() (lib/boq/regenerate.ts): authority (H5)
//              and the plan refusals generation would answer with, each with
//              where to fix it
//   ready      changesSinceRevision() (lib/boq/changes-since.ts — the one
//              "changed since rev N" the journey rail shows too) found a
//              recorded change: "plan edited, 1 book entry changed since rev 4"
//   unchanged  nothing recorded since rev N (disabled, with that reason)
// Running POSTs /api/generate-boq { trigger: "regenerate" } — the route
// enforces who may store a revision and records the event; the status is a
// polite live region, and the page keeps showing rev N with "Showing rev N
// while rev N+1 is generated". Done names the new rev, its total and Δ, and
// links the U4 diff against the revision it superseded (the route's own
// previous_boq_id). A refusal becomes Blocked with the route's reason.
// =============================================================================

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { RegenerateState } from "@/components/blueprint/RegenerateControl";
import { AnalyticsEvent, track } from "@/lib/analytics";

export interface RegenerateStart {
  rev: number;
  block: { code: string; reason: string; fix?: { label: string; href: string } } | null;
  /** changesSinceRevision().summary — null when nothing was recorded since rev N. */
  changed: string | null;
}

type Result = { boqId: string; total: number; previousId: string | null; previousTotal: number | null };

export function initialRegenerateState(s: RegenerateStart): RegenerateState {
  if (s.block) return { state: "blocked", reason: s.block.reason, fixLabel: s.block.fix?.label, fixHref: s.block.fix?.href };
  if (s.changed) return { state: "ready", changed: s.changed };
  return { state: "unchanged", rev: s.rev };
}

export function useRegenerate(projectId: string, start: RegenerateStart) {
  const router = useRouter();
  const [value, setValue] = useState<RegenerateState>(() => initialRegenerateState(start));
  const [elapsed, setElapsed] = useState(0);
  const [last, setLast] = useState<Result | null>(null);
  const started = useRef(0);
  const running = value.state === "running";

  // A fresh server answer (after a refresh, or an edit elsewhere) replaces a
  // resting state — never a running or done one.
  const startKey = `${start.rev}|${start.block?.code ?? ""}|${start.changed ?? ""}`;
  const [seenKey, setSeenKey] = useState(startKey);
  if (seenKey !== startKey) {
    setSeenKey(startKey);
    if (value.state !== "running" && value.state !== "done") setValue(initialRegenerateState(start));
  }

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started.current) / 1000)), 250);
    return () => clearInterval(t);
  }, [running]);

  async function run() {
    started.current = Date.now();
    setElapsed(0);
    setValue({ state: "running", doing: "Re-measuring the plan and pricing it against the current rates" });
    try {
      const res = await fetch("/api/generate-boq", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project_id: projectId, trigger: "regenerate" }),
      });
      const body = (await res.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
        code?: string;
        boq_id?: string;
        grand_total_aed?: number;
        previous_boq_id?: string | null;
        previous_total_aed?: number | null;
      } | null;
      if (!res.ok || !body?.success || !body.boq_id) {
        const code = body?.code ?? `http_${res.status}`;
        setValue({
          state: "blocked",
          reason: body?.error ?? `Regeneration failed (${res.status}). Nothing was stored — rev ${start.rev} stands.`,
          ...(code === "plan_has_overlaps" ? { fixLabel: "Fix overlaps on the plan", fixHref: `/project/${projectId}/plan` } : {}),
        });
        return;
      }
      const result: Result = { boqId: body.boq_id, total: body.grand_total_aed ?? 0, previousId: body.previous_boq_id ?? null, previousTotal: body.previous_total_aed ?? null };
      setLast(result);
      setValue({
        state: "done",
        newRev: start.rev + 1,
        previousRev: start.rev,
        total: result.total,
        delta: result.previousTotal === null ? 0 : Math.round((result.total - result.previousTotal) * 100) / 100,
        // The diff against the revision the route says this one superseded.
        diffHref: result.previousId ? `/project/${projectId}/boq/revisions?from=${result.previousId}&to=${result.boqId}` : `/project/${projectId}/boq/revisions`,
      });
      track(AnalyticsEvent.BoqGenerated, { project_id: projectId, trigger: "regenerate" });
      router.refresh();
    } catch (e) {
      setValue({ state: "blocked", reason: e instanceof Error ? `${e.message} — nothing was stored.` : "Regeneration failed — nothing was stored." });
    }
  }

  const shown: RegenerateState = running ? { state: "running", doing: `${(value as { doing: string }).doing} — ${elapsed} s` } : value;
  return { value: shown, run, running, result: last };
}
