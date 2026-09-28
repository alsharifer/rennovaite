"use client";

import { useState } from "react";

// L5 — a support touch, captured where it happens. A help request from the
// firm, or an intervention by us, is pilot data: counted per firm and project
// ("support load") rather than remembered afterwards. One POST to the pilot
// events route; nothing else.

const CHANNELS: { value: "in_app" | "call" | "chat" | "email" | "session" | "intervention"; label: string }[] = [
  { value: "in_app", label: "Asked here" },
  { value: "call", label: "Phone call" },
  { value: "chat", label: "Chat / WhatsApp" },
  { value: "email", label: "E-mail" },
  { value: "session", label: "At a working session" },
  { value: "intervention", label: "RennovAIte stepped in" },
];

export function SupportTouch({ projectId, area }: { projectId: string; area: string }) {
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]["value"]>("in_app");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pilot-events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "support_touch", project_id: projectId, channel, note: `[${area}] ${note.trim()}`, resolved: false }),
      });
      if (!res.ok) {
        setError("The request could not be recorded.");
        return;
      }
      setDone("Recorded — we will follow up.");
      setNote("");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inline-block" data-testid="support-touch">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="focus-ring inline-flex h-11 items-center gap-sm rounded-lg border border-ink-100 bg-paper px-lg font-body-sm text-body-sm font-semibold text-ink-900 transition-colors hover:bg-surface-container">
        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
          support_agent
        </span>
        Ask for help
      </button>
      {open && (
        <div className="mt-sm w-full max-w-[560px] rounded-md border border-ink-100 bg-paper p-md text-left">
          <p className="label-caps text-ink-500">What do you need help with?</p>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} aria-label="Support request" className="focus-ring mt-xs w-full rounded border border-ink-100 bg-paper px-sm py-xs font-body text-body-sm text-ink-900" placeholder="e.g. the paving rate looks wrong for this site" />
          <div className="mt-sm flex flex-wrap items-center gap-sm">
            <select value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)} aria-label="Channel" className="focus-ring rounded border border-ink-100 bg-paper px-sm py-xs text-body-sm text-ink-900">
              {CHANNELS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <button type="button" onClick={send} disabled={busy || note.trim().length < 3} className="focus-ring rounded-lg bg-brass-600 px-md py-xs text-body-sm font-semibold text-white disabled:opacity-50">
              Send
            </button>
            {error && (
              <span role="alert" className="text-body-sm text-error">
                {error}
              </span>
            )}
          </div>
        </div>
      )}
      {done && !open && <span className="ml-sm font-body text-body-sm text-ink-500">{done}</span>}
    </div>
  );
}
