"use client";

// =============================================================================
// components/blueprint/boq/GenerateFirst.tsx — the BoQ page's empty state
// (R7 §3.2 States: "No BoQ yet" + Generate). The first generation of a
// project's BoQ, on the same route as every regeneration (POST
// /api/generate-boq). Overlapping rooms are a known, fixable refusal (D3):
// they get the gate block with the pairs and the fix, never a bare error.
// =============================================================================

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AnalyticsEvent, track } from "@/lib/analytics";

import { Button } from "../Button";
import { StateBlock } from "../StateBlock";

type Overlap = { a_name: string; b_name: string };

export function GenerateFirst({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overlaps, setOverlaps] = useState<{ rooms: string[]; pairs: Overlap[] } | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/generate-boq", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project_id: projectId }) });
      const body = (await res.json().catch(() => null)) as { success?: boolean; error?: string; code?: string; overlap_pairs?: Overlap[]; overlap_room_names?: string[] } | null;
      if (res.status === 409 && body?.code === "plan_has_overlaps") {
        setOverlaps({ rooms: body.overlap_room_names ?? [], pairs: body.overlap_pairs ?? [] });
        return;
      }
      if (!res.ok || !body?.success) throw new Error(body?.error ?? `BoQ generation failed (${res.status}).`);
      track(AnalyticsEvent.BoqGenerated, { project_id: projectId });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "BoQ generation failed.");
    } finally {
      setBusy(false);
    }
  }

  if (overlaps) {
    return (
      <StateBlock
        kind="gate"
        title={`This plan has ${overlaps.rooms.length} overlapping room${overlaps.rooms.length === 1 ? "" : "s"}`}
        options={overlaps.pairs.map((p) => `${p.a_name} overlaps ${p.b_name}`)}
        actions={
          <>
            <Button kind="primary" tone="inverse" href={`/project/${projectId}/plan`}>
              Fix overlaps on the plan
            </Button>
            <Button kind="quiet" tone="inverse" onClick={() => setOverlaps(null)}>
              Try again
            </Button>
          </>
        }
      >
        Where two rooms sit on top of each other the take-off counts the same floor twice and derives walls that are not there — every price built on them would be wrong. The plan editor&rsquo;s Fix overlaps resolves it and keeps each room&rsquo;s shape and area.
      </StateBlock>
    );
  }

  if (error) {
    return (
      <StateBlock kind="error" title="The BoQ was not generated" afterUserAction actions={<Button kind="primary" tone="inverse" onClick={generate}>Try again</Button>}>
        {error} Nothing was stored — the plan is unchanged.
      </StateBlock>
    );
  }

  if (busy) {
    return (
      <StateBlock kind="pending" title="Generating the BoQ" placeholder={false} duration="Usually under a minute. Keep this tab open.">
        Measuring the plan and pricing every line against the current rates.
      </StateBlock>
    );
  }

  return (
    <StateBlock kind="empty" icon="request_quote" title="No BoQ yet" actions={<Button kind="primary" onClick={generate}>Generate BoQ</Button>}>
      Generating measures the plan, prices each line against the rate books in their resolution order, and stores revision 1. Every figure will show where it came from.
    </StateBlock>
  );
}
