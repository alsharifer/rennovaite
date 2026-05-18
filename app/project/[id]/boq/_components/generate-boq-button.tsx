"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

type Status = "idle" | "submitting" | "error";

export function GenerateBoqButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

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
        | { success?: boolean; error?: string }
        | null;
      if (!res.ok || !body?.success) {
        throw new Error(body?.error ?? `BoQ generation failed (${res.status}).`);
      }
      router.refresh();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "BoQ generation failed.");
    }
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
