"use client";

// =============================================================================
// components/blueprint/shell/HelpDrawer.tsx — Support, on every page (R7 §3.10:
// "/support → help drawer on every page").
//
// A native modal <dialog> on the right: Escape closes it and focus returns to
// whatever opened it. Opened by the rail's Support item, the phone ⋮ menu, or
// a link carrying ?help=1 (that is where /support now lands). On a project it
// records the request as the same `support_touch` pilot event the BoQ page's
// "Ask for help" writes (L5) — one support signal, wherever it is asked.
// =============================================================================

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "../Button";
import { Icon } from "../Icon";
import { HELP_EVENT } from "./JourneyRail";

export function HelpDrawer({ projectId, area }: { projectId: string | null; area: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const params = useSearchParams();
  const [note, setNote] = useState("");
  const [sent, setSent] = useState<"idle" | "busy" | "done" | "error">("idle");

  useEffect(() => {
    const open = () => ref.current?.showModal();
    window.addEventListener(HELP_EVENT, open);
    if (params.get("help") === "1" && !ref.current?.open) open();
    return () => window.removeEventListener(HELP_EVENT, open);
  }, [params]);

  const send = async () => {
    setSent("busy");
    try {
      const res = await fetch("/api/pilot-events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "support_touch", project_id: projectId, channel: "in_app", note: `[${area}] ${note.trim()}`, resolved: false }),
      });
      setSent(res.ok ? "done" : "error");
      if (res.ok) setNote("");
    } catch {
      setSent("error");
    }
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="bp-help-title"
      className="bp-drawer fixed inset-y-0 left-auto right-0 m-0 h-full max-h-none w-full max-w-[400px] overflow-y-auto border-l border-bp-line-strong bg-bp-surface-base p-6 text-bp-ink-primary"
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close();
      }}
    >
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="t-label-caps text-bp-brass-text">Support</p>
          <h2 id="bp-help-title" className="t-heading-lg">
            How can we help?
          </h2>
        </div>
        <button type="button" onClick={() => ref.current?.close()} className="flex h-11 w-11 items-center justify-center" aria-label="Close help">
          <Icon name="close" />
        </button>
      </div>

      <section className="border-t border-bp-line-hairline py-4">
        <h3 className="t-heading-sm">Reading a figure</h3>
        <p className="t-body-sm mt-1 text-bp-ink-secondary">
          Every number carries a mark: solid is measured or your own rate, the half circle is the market reference, the open ring is derived, the dashed ring is still to be priced. Hover or focus a figure for its source.
        </p>
      </section>
      <section className="border-t border-bp-line-hairline py-4">
        <h3 className="t-heading-sm">The journey</h3>
        <p className="t-body-sm mt-1 text-bp-ink-secondary">The rail shows where each step stands. A flag needs a look; a lock says what has to happen first, and opening the step shows how to clear it.</p>
      </section>

      <section className="border-t border-bp-line-hairline py-4">
        <h3 className="t-heading-sm">Ask us</h3>
        {projectId ? (
          <>
            <label htmlFor="bp-help-note" className="t-label-caps mt-3 block text-bp-ink-tertiary">
              What do you need help with?
            </label>
            <textarea
              id="bp-help-note"
              rows={4}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                if (sent !== "busy") setSent("idle");
              }}
              className="t-body-sm mt-2 w-full border border-bp-line-control bg-bp-surface-raised p-3 text-bp-ink-primary"
              placeholder="e.g. the paving rate looks wrong for this site"
            />
            <div className="mt-3 flex items-center gap-4">
              <Button
                kind="primary"
                onClick={send}
                disabled={note.trim().length < 3 || sent === "busy" ? { reason: sent === "busy" ? "Sending…" : "Write at least a few words first", reasonId: "bp-help-reason" } : false}
              >
                Send to RenovAIte
              </Button>
              <span id="bp-help-reason" className="t-label-md text-bp-ink-tertiary" aria-live="polite">
                {sent === "done" ? "Recorded — we will follow up." : sent === "error" ? "Not recorded — try again, or e-mail us." : note.trim().length < 3 ? "Write at least a few words first" : ""}
              </span>
            </div>
          </>
        ) : null}
        <p className="t-body-sm mt-3 text-bp-ink-secondary">
          Or e-mail <a className="underline" href="mailto:hello@rennovaite.fit">hello@rennovaite.fit</a>.
        </p>
      </section>
    </dialog>
  );
}
