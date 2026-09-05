"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { AnalyticsEvent, track } from "@/lib/analytics";

type Status = "idle" | "submitting" | "error" | "overlaps";

type OverlapPair = { a_name: string; b_name: string };

export function GenerateBoqButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [overlapRooms, setOverlapRooms] = useState<string[]>([]);
  const [overlapPairs, setOverlapPairs] = useState<OverlapPair[]>([]);

  async function onClick() {
    setStatus("submitting");
    setError(null);
    try {
      const res = await fetch("/api/generate-boq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId }),
      });
      const body = (await res.json().catch(() => null)) as
        | {
            success?: boolean;
            error?: string;
            code?: string;
            overlap_pairs?: OverlapPair[];
            overlap_room_names?: string[];
          }
        | null;
      // D3: overlapping rooms are not a failure to apologise for — they are a
      // specific, fixable state with a known next action, so they get their own
      // designed panel rather than a red error string.
      if (res.status === 409 && body?.code === "plan_has_overlaps") {
        setOverlapRooms(body.overlap_room_names ?? []);
        setOverlapPairs(body.overlap_pairs ?? []);
        setStatus("overlaps");
        return;
      }
      if (!res.ok || !body?.success) {
        throw new Error(body?.error ?? `BoQ generation failed (${res.status}).`);
      }
      track(AnalyticsEvent.BoqGenerated, { project_id: projectId });
      router.refresh();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "BoQ generation failed.");
    }
  }

  if (status === "overlaps") {
    return (
      <section className="w-full max-w-[560px] rounded-xl border border-[#E8C9A0] bg-[#FEF6EC] p-xl text-left">
        <span
          className="material-symbols-outlined mb-sm text-[28px] text-[#92400E]"
          aria-hidden="true"
        >
          layers
        </span>
        <h3 className="mb-sm font-display text-headline-md text-ink-900">
          This plan has {overlapRooms.length} overlapping{" "}
          {overlapRooms.length === 1 ? "room" : "rooms"}.
        </h3>
        <p className="mb-lg font-body text-body-md text-on-surface-variant">
          Resolve them before costing. Where two rooms sit on top of each other
          the take-off counts the same floor twice and derives walls that
          aren&apos;t there, so the quantities — and every price built on them —
          would be wrong.
        </p>

        {overlapPairs.length > 0 && (
          <ul className="mb-lg space-y-xs">
            {overlapPairs.map((p) => (
              <li
                key={`${p.a_name}-${p.b_name}`}
                className="font-mono text-[12px] tabular-nums text-ink-700"
              >
                {p.a_name} <span className="text-ink-500">overlaps</span>{" "}
                {p.b_name}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-md">
          <Link
            href={`/project/${projectId}/plan`}
            className="focus-ring flex h-11 items-center gap-sm rounded-lg bg-brass-600 px-lg font-body-sm text-body-sm font-semibold text-on-primary transition-colors hover:bg-primary"
          >
            Open the plan editor
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
              arrow_forward
            </span>
          </Link>
          <button
            type="button"
            onClick={() => setStatus("idle")}
            className="focus-ring rounded-lg px-md py-sm font-body-sm text-body-sm text-ink-700 hover:bg-surface-container"
          >
            Try again
          </button>
        </div>
        <p className="mt-md font-body-sm text-[12px] text-on-surface-variant">
          The editor&apos;s <strong>Fix overlaps</strong> button resolves this in
          one click and preserves every room&apos;s shape and area.
        </p>
      </section>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <Button
        size="lg"
        onClick={onClick}
        disabled={status === "submitting"}
        className="bg-indigo-600 text-white hover:bg-indigo-500"
      >
        {status === "submitting" ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" />
            Generating BoQ… (~1 minute)
          </>
        ) : (
          <>Generate BoQ</>
        )}
      </Button>
      {status === "submitting" && (
        <p className="text-label-sm text-on-surface-variant">
          Claude is pricing the project against labour rates and supplier SKUs. Don&apos;t close this tab.
        </p>
      )}
      {status === "error" && error && (
        <p className="text-label-sm text-status-error">{error}</p>
      )}
    </div>
  );
}
