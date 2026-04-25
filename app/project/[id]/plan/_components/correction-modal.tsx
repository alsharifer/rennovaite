"use client";

import { useState } from "react";
import { Check, MessageSquareWarning } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

type Status = "idle" | "saving" | "saved" | "error";

export function CorrectionModal({
  planId,
  initialNotes,
}: {
  planId: string;
  initialNotes: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = notes.trim();
    if (!trimmed) {
      setError("Add a short description of what's missing or wrong.");
      setStatus("error");
      return;
    }
    setStatus("saving");
    setError(null);
    try {
      const res = await fetch("/api/correct-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: planId, notes: trimmed }),
      });
      const body = (await res.json().catch(() => null)) as
        | { success?: boolean; error?: string }
        | null;
      if (!res.ok || !body?.success) {
        throw new Error(body?.error ?? `Save failed (${res.status}).`);
      }
      setStatus("saved");
      // Auto-close after a moment so the user sees confirmation.
      setTimeout(() => setOpen(false), 900);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Save failed.");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setStatus("idle");
          setError(null);
        }
      }}
    >
      <DialogTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-xs text-text-tertiary underline-offset-4 hover:text-text-secondary hover:underline"
          />
        }
      >
        <MessageSquareWarning className="size-3.5" />
        Something missing? Tell us
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-base">
            Tell us what to fix
          </DialogTitle>
          <DialogDescription>
            Free-text. Examples: "the kitchen is much smaller than shown",
            "Bedroom 3 is missing", "the en-suite belongs to bedroom 2 not the
            master".
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            if (status === "error") {
              setStatus("idle");
              setError(null);
            }
          }}
          placeholder="Describe the correction…"
          rows={5}
          disabled={status === "saving" || status === "saved"}
          className="bg-bg-elevated text-text-primary"
        />
        {status === "error" && error && (
          <p className="text-xs text-status-error">{error}</p>
        )}
        {status === "saved" && (
          <p className="inline-flex items-center gap-1.5 text-xs text-status-success">
            <Check className="size-3.5" />
            Saved.
          </p>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            onClick={submit}
            disabled={status === "saving" || status === "saved"}
          >
            {status === "saving" ? "Saving…" : "Save correction"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
