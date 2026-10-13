"use client";

// =============================================================================
// components/blueprint/shell/HelpDrawer.tsx — Help, on every page (K8 #13,
// spec §6.8, Figma 65:1247; R7 §3.10 "/support → help drawer on every page").
//
// A native modal <dialog>, 440 px on the right over a 32 % ink scrim (black
// 55 % in dark): focus is trapped while it is open, Escape closes it and focus
// returns to whatever opened it. Opened by the rail's Support item, the phone
// ⋮ menu, the "?" key (outside a text field), or a link carrying ?help=1 (where
// /support lands). Search reaches every article (lib/help/articles); "About
// this page" shows the current page's. "Ask the RenovAIte team" records a
// `support_touch` pilot event on the project — or on the firm off a project
// (L5) — with the topic, and, when ticked, this page and the project's BoQ
// revision (never file contents). With neither, it offers e-mail.
// =============================================================================

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { HELP_TOPICS, articlesFor, searchArticles, type HelpArticle } from "@/lib/help/articles";

import { Button } from "../Button";
import { Icon } from "../Icon";
import { HELP_EVENT } from "./JourneyRail";

function Article({ a }: { a: HelpArticle }) {
  return (
    <details className="group border-b border-bp-line-hairline">
      <summary className="t-body-sm flex cursor-pointer list-none items-center justify-between gap-3 py-3 text-bp-ink-primary [&::-webkit-details-marker]:hidden">
        {a.title}
        <Icon name="chevron_right" className="text-[18px] text-bp-ink-secondary transition-transform group-open:rotate-90" />
      </summary>
      <div className="pb-3">
        {a.body.map((p, i) => (
          <p key={i} className="t-body-sm mt-1 text-bp-ink-secondary">
            {p}
          </p>
        ))}
      </div>
    </details>
  );
}

const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

export function HelpDrawer({ projectId, firmId = null, area, areaLabel, rev = null }: { projectId: string | null; firmId?: string | null; area: string; areaLabel?: string; rev?: number | null }) {
  const ref = useRef<HTMLDialogElement>(null);
  const ids = useId();
  const params = useSearchParams();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState<string>(HELP_TOPICS[0]);
  const [note, setNote] = useState("");
  const [include, setInclude] = useState(true);
  const [sent, setSent] = useState<"idle" | "busy" | "done" | "error">("idle");

  useEffect(() => {
    const open = () => {
      if (!ref.current?.open) ref.current?.showModal();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e.target)) {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener(HELP_EVENT, open);
    window.addEventListener("keydown", onKey);
    if (params.get("help") === "1") open();
    return () => {
      window.removeEventListener(HELP_EVENT, open);
      window.removeEventListener("keydown", onKey);
    };
  }, [params]);

  const own = useMemo(() => articlesFor(area), [area]);
  const found = useMemo(() => searchArticles(query), [query]);
  const canAsk = !!projectId || !!firmId;

  const send = async () => {
    setSent("busy");
    const highlight = params.get("highlight");
    const reference = include ? [`page ${pathname}`, projectId ? `project ${projectId}` : null, rev ? `BoQ rev ${rev}` : null, topic === HELP_TOPICS[0] && highlight ? `line ${highlight}` : null].filter(Boolean).join(" · ") : null;
    try {
      const res = await fetch("/api/pilot-events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "support_touch",
          ...(projectId ? { project_id: projectId } : { firm_id: firmId }),
          channel: "in_app",
          note: `[${topic}]${reference ? ` [${reference}]` : ""} ${note.trim()}`,
          resolved: false,
        }),
      });
      setSent(res.ok ? "done" : "error");
      if (res.ok) setNote("");
    } catch {
      setSent("error");
    }
  };

  const tooShort = note.trim().length < 3;
  return (
    <dialog
      ref={ref}
      aria-labelledby="bp-help-title"
      className="bp-drawer fixed inset-y-0 left-auto right-0 m-0 h-full max-h-none w-full max-w-[440px] overflow-y-auto border-l border-bp-line-hairline bg-bp-surface-base text-bp-ink-primary"
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close();
      }}
      data-help-drawer
    >
      <div className="flex items-center justify-between gap-4 border-b border-bp-line-hairline px-6 py-4">
        <h2 id="bp-help-title" className="t-heading-md">
          Help
        </h2>
        <button type="button" onClick={() => ref.current?.close()} className="flex size-11 items-center justify-center text-bp-ink-secondary hover:text-bp-ink-primary" aria-label="Close help">
          <Icon name="close" className="text-[20px]" />
        </button>
      </div>

      <div className="px-6 py-5">
        <label className="relative block">
          <span className="sr-only">Search help</span>
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-bp-ink-secondary" />
          <input
            type="text"
            role="searchbox"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search help"
            className="t-body-sm h-10 w-full rounded-none border border-bp-line-control bg-bp-surface-raised pl-10 pr-3 text-bp-ink-primary placeholder:text-bp-ink-tertiary"
          />
        </label>

        <section aria-labelledby={`${ids}-about`} className="mt-5" aria-live="polite">
          <h3 id={`${ids}-about`} className="t-label-caps text-bp-ink-tertiary">
            {query.trim() ? `${found.length} RESULT${found.length === 1 ? "" : "S"}` : `ABOUT THIS PAGE${areaLabel ? ` · ${areaLabel.toUpperCase()}` : ""}`}
          </h3>
          <div className="mt-1">
            {(query.trim() ? found : own).map((a) => (
              <Article key={a.id} a={a} />
            ))}
            {query.trim() && !found.length ? <p className="t-body-sm py-3 text-bp-ink-secondary">Nothing matches. Ask us below.</p> : null}
          </div>
        </section>

        <section aria-labelledby={`${ids}-ask`} className="mt-6">
          <h3 id={`${ids}-ask`} className="t-label-caps text-bp-ink-tertiary">
            ASK THE RENOVAITE TEAM
          </h3>
          {canAsk ? (
            <div className="mt-3 flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="t-nav-item-active text-bp-ink-primary">Topic</span>
                <select value={topic} onChange={(e) => setTopic(e.target.value)} className="t-body-sm h-10 rounded-none border border-bp-line-control bg-bp-surface-raised px-3 text-bp-ink-primary">
                  {HELP_TOPICS.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="t-nav-item-active text-bp-ink-primary">Message</span>
                <textarea
                  rows={4}
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value);
                    if (sent !== "busy") setSent("idle");
                  }}
                  placeholder="Tell us what you expected and what you saw."
                  className="t-body-sm rounded-none border border-bp-line-control bg-bp-surface-raised p-3 text-bp-ink-primary placeholder:text-bp-ink-tertiary"
                />
              </label>
              <label className="t-body-sm flex items-center gap-2.5 text-bp-ink-primary">
                <input type="checkbox" checked={include} onChange={(e) => setInclude(e.target.checked)} className="size-4 rounded-none accent-[var(--color-ink-primary)]" />
                Include this page and project reference (no file contents)
              </label>
              <div className="flex flex-wrap items-center gap-4">
                <Button kind="primary" onClick={send} disabled={tooShort || sent === "busy" ? { reason: sent === "busy" ? "Sending…" : "Write at least a few words first", reasonId: `${ids}-why` } : false}>
                  Send
                </Button>
                <span id={`${ids}-why`} className="t-label-md font-bp-mono text-bp-ink-tertiary" aria-live="polite">
                  {sent === "done" ? "Sent — the team will reply by e-mail." : sent === "error" ? "Not sent — try again, or e-mail us." : tooShort ? "Write at least a few words first" : ""}
                </span>
              </div>
            </div>
          ) : null}
          <p className="t-body-sm mt-4 text-bp-ink-secondary">
            {canAsk ? "Or e-mail " : "E-mail "}
            <a className="underline underline-offset-4" href="mailto:hello@rennovaite.fit">
              hello@rennovaite.fit
            </a>
            .
          </p>
        </section>
      </div>
    </dialog>
  );
}
