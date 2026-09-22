"use client";

// =============================================================================
// components/documents/PackExport.tsx — the in-app "Export pack" action (T5).
//
// The ONLY way the app hands out a client document. It shows the export gate as
// a readable checklist before anything runs, starts a background job that runs
// lib/documents/pack-export/run.ts (the same module as the CLI), polls its
// progress, and lists download links only once every gate has held.
// Rendered only when packExportEnabled() — the parent decides, server-side.
// =============================================================================

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { ChecklistItem, PackProgress } from "@/lib/documents/pack-export/types";

type Preflight = { ready: boolean; documentName: string | null; checklist: ChecklistItem[] };
type JobView = {
  id: string;
  status: "queued" | "running" | "passed" | "blocked" | "failed";
  progress: (PackProgress & { log?: string[] }) | Record<string, never>;
  checklist: ChecklistItem[] | null;
  failed_checks: { label: string; detail: string }[];
  checks_passed: number;
  checks_total: number;
  error: string | null;
  downloads: { name: string; bytes: number; url: string }[];
};

const STEP_LABEL: Record<string, string> = {
  readiness: "Checking the export gate",
  boq: "Regenerating the BoQ",
  renders: "Rendering and checking every view",
  photo_pairs: "Before / after photo pairs",
  documents: "Assembling the documents",
  checks: "Checking what was printed",
  manifest: "Saving the pack",
  done: "Done",
};

function mb(bytes: number): string {
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

function Checklist({ items }: { items: ChecklistItem[] }) {
  return (
    <ul className="flex flex-col gap-md" data-pack-checklist>
      {items.map((c) => (
        <li key={c.key} className="flex gap-md" data-check={c.key} data-ok={c.ok}>
          <span
            className={`material-symbols-outlined mt-[2px] text-[20px] ${c.ok ? "text-brass-600" : "text-error"}`}
            aria-hidden="true"
          >
            {c.ok ? "check_circle" : "error"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-body text-body-sm font-semibold text-ink-900">{c.title}</p>
            {!c.ok && (
              <>
                <p className="font-body text-body-sm text-ink-700">{c.detail}</p>
                {c.items.length > 0 && (
                  <ul className="mt-xs flex flex-col gap-[2px]">
                    {c.items.slice(0, 12).map((it) => (
                      <li key={it} className="font-body text-body-sm text-ink-700">
                        · {it}
                      </li>
                    ))}
                    {c.items.length > 12 && (
                      <li className="font-body text-body-sm text-ink-500">… and {c.items.length - 12} more</li>
                    )}
                  </ul>
                )}
                {c.fix && (
                  <Link href={c.fix.href} className="focus-ring mt-xs inline-flex text-body-sm font-semibold text-brass-600">
                    {c.fix.label} →
                  </Link>
                )}
              </>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function PackExport({ projectId, autoOpen = false }: { projectId: string; autoOpen?: boolean }) {
  const [open, setOpen] = useState(autoOpen);
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [name, setName] = useState("");
  const [renders, setRenders] = useState<"full" | "cached">("full");
  const [job, setJob] = useState<JobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const base = `/api/projects/${projectId}/pack-export`;

  // Plain functions (they call each other); state is set only after a fetch resolves.
  async function loadPreflight() {
    const res = await fetch(base, { cache: "no-store" });
    if (!res.ok) {
      setError("The export gate could not be checked.");
      return;
    }
    const body = (await res.json()) as Preflight & { jobs: { id: string; status: string }[] };
    setError(null);
    setPreflight(body);
    setName((n) => n || body.documentName || "");
    const running = body.jobs.find((j) => j.status === "running");
    if (running) void poll(running.id);
  }

  async function poll(jobId: string) {
    const res = await fetch(`${base}/${jobId}`, { cache: "no-store" });
    if (!res.ok) {
      setError("The export's progress could not be read.");
      return;
    }
    const body = (await res.json()) as JobView;
    setJob(body);
    if (body.status === "running" || body.status === "queued") {
      timer.current = setTimeout(() => void poll(jobId), 2500);
    } else if (body.status === "blocked") {
      void loadPreflight();
    }
  }

  // ?export=1 (a redirect from a document link) opens the panel with the gate loaded.
  const loaded = useRef(false);
  useEffect(() => {
    if (autoOpen && !loaded.current) {
      loaded.current = true;
      void loadPreflight();
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !loaded.current) {
      loaded.current = true;
      void loadPreflight();
    }
  }

  async function start() {
    setError(null);
    setJob(null);
    const res = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // The name is sent only when it was edited: re-sending a working name would
      // store it as the display name.
      body: JSON.stringify({ ...(nameChanged && name.trim() ? { display_name: name.trim() } : {}), renders }),
    });
    if (!res.ok) {
      setError("The export could not be started.");
      return;
    }
    const { job_id } = (await res.json()) as { job_id: string };
    void poll(job_id);
  }

  const running = job?.status === "running" || job?.status === "queued";
  const progress = job && "step" in job.progress ? job.progress : null;
  const gate = job?.status === "blocked" && job.checklist ? job.checklist : preflight?.checklist ?? [];
  const nameChanged = !!preflight && name.trim() !== (preflight.documentName ?? "");

  return (
    <div data-pack-export>
      <button
        type="button"
        onClick={toggle}
        className="focus-ring inline-flex h-10 items-center gap-sm rounded-lg bg-brass-600 px-lg font-body-sm text-body-sm font-semibold text-on-primary transition-colors hover:bg-primary"
        aria-expanded={open}
      >
        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
          inventory_2
        </span>
        Export pack
      </button>

      {open && (
        <section className="mt-md max-w-[760px] rounded-xl border border-ink-100 bg-paper p-lg text-left" aria-label="Export pack">
          <p className="label-caps mb-sm text-ink-500">Export pack · drawings, renders and BoQ, checked together</p>
          <p className="mb-lg font-body text-body-sm text-ink-700">
            Every client document is produced here, after the same checks the pilot script runs. Nothing downloads until
            they all pass.
          </p>

          {error && <p className="mb-md font-body text-body-sm text-error">{error}</p>}

          {!preflight && !error && <p className="font-body text-body-sm text-ink-500">Checking the export gate…</p>}

          {preflight && (
            <>
              <label className="mb-lg block">
                <span className="label-caps mb-xs block text-ink-500">Name on the documents</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={running}
                  className="focus-ring h-10 w-full rounded border border-ink-100 bg-paper px-md font-body text-body-sm text-ink-900"
                  placeholder="e.g. Arabella Garden — Draft for Review"
                />
                {nameChanged && (
                  <span className="mt-xs block font-body text-body-sm text-ink-500">Saved when the export starts.</span>
                )}
              </label>

              <p className="label-caps mb-sm text-ink-500">
                {job?.status === "blocked" ? "Export blocked — resolve these first" : "Before you export"}
              </p>
              <Checklist items={gate} />

              <div className="mt-lg flex flex-wrap items-center gap-md">
                <button
                  type="button"
                  onClick={() => void start()}
                  disabled={running}
                  className="focus-ring inline-flex h-10 items-center gap-sm rounded-lg bg-brass-600 px-lg font-body-sm text-body-sm font-semibold text-on-primary transition-colors hover:bg-primary disabled:opacity-50"
                >
                  {running ? "Exporting…" : "Run export"}
                </button>
                <label className="inline-flex items-center gap-xs font-body text-body-sm text-ink-700">
                  <input
                    type="checkbox"
                    checked={renders === "cached"}
                    onChange={(e) => setRenders(e.target.checked ? "cached" : "full")}
                    disabled={running}
                  />
                  Use existing renders only
                </label>
              </div>
            </>
          )}

          {running && progress && (
            <div className="mt-lg" data-pack-progress>
              <div className="mb-xs flex justify-between font-body text-body-sm text-ink-700">
                <span>{STEP_LABEL[progress.step] ?? progress.step}</span>
                <span className="font-mono tabular-nums">{Math.round(progress.pct)}%</span>
              </div>
              <div className="h-1 w-full rounded bg-bone">
                <div className="h-1 rounded bg-brass-600 transition-all" style={{ width: `${progress.pct}%` }} />
              </div>
              {progress.note && <p className="mt-xs font-body text-body-sm text-ink-500">{progress.note}</p>}
            </div>
          )}

          {job?.status === "failed" && (
            <div className="mt-lg rounded-md border border-ink-100 p-md" data-pack-failed>
              <p className="font-body text-body-sm font-semibold text-error">
                The export ran, but {job.failed_checks.length || "a"} check{job.failed_checks.length === 1 ? "" : "s"} on the
                printed documents failed — nothing was released.
              </p>
              {job.error && <p className="mt-xs font-body text-body-sm text-ink-700">{job.error}</p>}
              <ul className="mt-sm flex flex-col gap-xs">
                {job.failed_checks.map((c) => (
                  <li key={c.label} className="font-body text-body-sm text-ink-700">
                    <span className="font-semibold text-ink-900">{c.label}</span> — {c.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {job?.status === "passed" && (
            <div className="mt-lg" data-pack-downloads>
              <p className="mb-sm font-body text-body-sm text-ink-700">
                All <span className="font-mono tabular-nums">{job.checks_total}</span> checks passed.
              </p>
              <ul className="flex flex-col gap-xs">
                {job.downloads.map((d) => (
                  <li key={d.name}>
                    <a href={d.url} className="focus-ring inline-flex items-center gap-sm text-body-sm font-semibold text-brass-600">
                      <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                        download
                      </span>
                      {d.name}
                      <span className="font-mono text-[12px] tabular-nums text-ink-500">{mb(d.bytes)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
