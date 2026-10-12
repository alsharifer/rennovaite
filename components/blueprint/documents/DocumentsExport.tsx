"use client";

// =============================================================================
// components/blueprint/documents/DocumentsExport.tsx — 06 Documents: the
// export checks and the one way documents leave (K4, R7 §3.6, Figma 22:548).
//
// Left: EXPORT CHECKS — the gate the run applies (lib/documents/pack-export/
// checklist.ts, server-computed: never re-derived here), each PASS or BLOCKS,
// then the checks the run makes on the PRINTED pages (identity scan, draft
// statement, contents) from the latest run. Right: Export pack (the T5 job:
// start, progress, downloads), the internal review pack (not built — shown with
// its reason), and on a firm project the client proposal: locked by the
// reference-basis gate with both ways out, or open.
// =============================================================================

import { useEffect, useId, useRef, useState } from "react";

import type { ChecklistItem, PackProgress } from "@/lib/documents/pack-export/types";

import { Button } from "../Button";
import { Icon } from "../Icon";
import { StateBlock } from "../StateBlock";

type Preflight = {
  ready: boolean;
  documentName: string | null;
  checklist: ChecklistItem[];
  firm: { brand: string; logo: boolean; terms: boolean; book_status: "draft" | "reviewed" | null } | null;
};
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
  finished_at?: string | null;
};

/** The proposal's own items: they block the proposal, never the rest of the pack. */
const PROPOSAL_KEYS = new Set(["proposal_firm", "reference_basis", "branding"]);

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

const mb = (bytes: number) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`);

export interface DocumentsExportProps {
  projectId: string;
  rev: number | null;
  checkedAt: string;
  initial: Preflight;
  latestJobId: string | null;
  sheetCount: number;
  /** On a firm project: what keeps the client proposal locked, in the book's words. */
  bookOpen: { conflicts: number; outliers: number } | null;
}

export function DocumentsExport({ projectId, rev, checkedAt, initial, latestJobId, sheetCount, bookOpen }: DocumentsExportProps) {
  const [preflight, setPreflight] = useState<Preflight>(initial);
  const [name, setName] = useState(initial.documentName ?? "");
  const [renders, setRenders] = useState<"full" | "cached">("full");
  const [proposal, setProposal] = useState(false);
  const [job, setJob] = useState<JobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const base = `/api/projects/${projectId}/pack-export`;
  const runReasonId = useId();
  const internalReasonId = useId();

  async function refresh() {
    const res = await fetch(preflight.firm ? `${base}?proposal=1` : base, { cache: "no-store" });
    if (!res.ok) return setError("The export gate could not be checked.");
    setPreflight((await res.json()) as Preflight);
  }

  async function poll(jobId: string) {
    const res = await fetch(`${base}/${jobId}`, { cache: "no-store" });
    if (!res.ok) return setError("The export's progress could not be read.");
    const body = (await res.json()) as JobView;
    setJob(body);
    if (body.status === "running" || body.status === "queued") timer.current = setTimeout(() => void poll(jobId), 2500);
    else if (body.status === "blocked") void refresh();
  }

  // The latest run is followed to its end (or shown, with its signed links), so
  // leaving the page mid-export never loses what it produced.
  useEffect(() => {
    if (latestJobId) void poll(latestJobId);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nameChanged = name.trim() !== (preflight.documentName ?? "");
  async function start() {
    setError(null);
    setJob(null);
    const res = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // A name is sent only when edited: re-sending a working name would store it as the display name.
      body: JSON.stringify({ ...(nameChanged && name.trim() ? { display_name: name.trim() } : {}), renders, proposal }),
    });
    if (!res.ok) return setError("The export could not be started.");
    const { job_id } = (await res.json()) as { job_id: string };
    void poll(job_id);
  }

  const gate = job?.status === "blocked" && job.checklist ? job.checklist : preflight.checklist;
  const core = gate.filter((c) => !PROPOSAL_KEYS.has(c.key));
  const proposalItems = gate.filter((c) => PROPOSAL_KEYS.has(c.key));
  const basis = proposalItems.find((c) => c.key === "reference_basis") ?? null;
  const blocking = core.filter((c) => !c.ok).length + (proposal ? proposalItems.filter((c) => !c.ok).length : 0);
  const running = job?.status === "running" || job?.status === "queued";
  const progress = job && "step" in job.progress ? job.progress : null;
  const runDisabled = running ? { reason: "An export is running", reasonId: runReasonId } : blocking > 0 ? { reason: `Resolve ${blocking} blocking check${blocking === 1 ? "" : "s"} first`, reasonId: runReasonId, showReason: true } : false;

  return (
    <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_400px]" data-pack-export>
      <section aria-labelledby="checks-h" className="min-w-0">
        <h2 id="checks-h" className="t-label-caps border-b border-bp-line-strong bg-bp-surface-sunken px-3 py-2.5 text-bp-ink-tertiary">
          EXPORT CHECKS{rev ? ` · REV ${rev}` : ""} · CHECKED {checkedAt}
        </h2>
        <ul data-pack-checklist>
          {core.map((c) => (
            <CheckRow key={c.key} c={c} status={c.ok ? "PASS" : "BLOCKS EXPORT"} />
          ))}
          {basis ? <CheckRow c={basis} status={basis.ok ? "PASS" : "BLOCKS CLIENT PROPOSAL"} /> : null}
          <PrintedRow job={job} />
        </ul>
      </section>

      <div className="min-w-0 space-y-6">
        <section className="border border-bp-line-hairline bg-bp-surface-raised p-5" aria-labelledby="export-h">
          <h2 id="export-h" className="t-label-caps flex items-center gap-2 text-bp-ink-tertiary">
            <Icon name="inventory_2" size={18} />
            EXPORT PACK · DRAWINGS, RENDERS AND BOQ
          </h2>
          <p className="t-body-sm mt-2 text-bp-ink-secondary">Every client document is produced here, after the checks on the left and the checks on the printed pages. Nothing downloads until they all pass.</p>

          <div className="mt-4 flex flex-col gap-1.5">
            <label htmlFor="pack-name" className="t-label-caps text-bp-ink-tertiary">
              NAME ON THE DOCUMENTS
            </label>
            <input
              id="pack-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={running}
              placeholder="e.g. Arabella Garden — Draft for Review"
              className="t-body-sm h-9 w-full rounded-none border border-bp-line-control bg-bp-surface-base px-3 text-bp-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring"
            />
            {nameChanged ? <span className="t-label-md text-bp-ink-tertiary">Saved when the export starts.</span> : null}
          </div>

          <div className="mt-4 space-y-2">
            <Check label="Use existing renders only" checked={renders === "cached"} onChange={(v) => setRenders(v ? "cached" : "full")} disabled={running} />
            {preflight.firm ? (
              <Check label={`Include the client proposal (${preflight.firm.brand})`} checked={proposal} onChange={setProposal} disabled={running} testId="proposal-toggle" />
            ) : null}
          </div>

          <div className="mt-4 flex flex-col items-start gap-2">
            <Button kind="primary" disabled={runDisabled} onClick={() => void start()} testId="run-export">
              {running ? "Exporting…" : "Run export"}
            </Button>
          </div>

          <div aria-live="polite">
            {running && progress ? (
              <div className="mt-4" data-pack-progress>
                <div className="t-body-sm flex justify-between text-bp-ink-secondary">
                  <span>{STEP_LABEL[progress.step] ?? progress.step}</span>
                  <span className="t-num-sm">{Math.round(progress.pct)}%</span>
                </div>
                <div className="mt-1 h-1 w-full bg-bp-surface-sunken" aria-hidden="true">
                  <div className="h-1 bg-bp-ink-primary transition-[width]" style={{ width: `${progress.pct}%` }} />
                </div>
                {progress.note ? <p className="t-label-md mt-1 text-bp-ink-tertiary">{progress.note}</p> : null}
              </div>
            ) : null}
            {job?.status === "passed" ? (
              <div className="mt-4" data-pack-downloads>
                <p className="t-body-sm text-bp-ink-secondary">
                  All <span className="t-num-sm">{job.checks_total}</span> checks on the printed pages passed.
                </p>
                <ul className="mt-2 space-y-1.5">
                  {job.downloads.map((d) => (
                    <li key={d.name}>
                      <a href={d.url} className="t-body-sm inline-flex items-center gap-2 text-bp-ink-primary underline decoration-bp-line-control underline-offset-2 hover:decoration-bp-ink-primary">
                        <Icon name="download" size={18} />
                        {d.name}
                        <span className="t-num-sm text-bp-ink-tertiary">{mb(d.bytes)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          {job?.status === "failed" ? (
            <div className="surface-inverse mt-4 bg-bp-alert-surface px-4 py-3 text-bp-alert-ink" data-pack-failed role="alert">
              <p className="t-body-sm font-semibold">
                {job.failed_checks.length > 0
                  ? `The export ran, but ${job.failed_checks.length} check${job.failed_checks.length === 1 ? "" : "s"} on the printed documents failed — nothing was released.`
                  : "The export did not complete — nothing was released."}
              </p>
              {job.error ? <p className="t-body-sm mt-1">{job.error}</p> : null}
              <ul className="mt-2 space-y-1">
                {job.failed_checks.map((c) => (
                  <li key={c.label} className="t-body-sm">
                    <span className="font-semibold">{c.label}</span> — {c.detail}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {job?.status === "blocked" ? <p className="t-body-sm mt-4 text-bp-ink-primary">Export blocked — resolve the checks marked BLOCKS first.</p> : null}
          {error ? (
            <div className="surface-inverse mt-4 bg-bp-alert-surface px-4 py-3 text-bp-alert-ink" role="alert">
              <p className="t-body-sm">{error}</p>
            </div>
          ) : null}
        </section>

        <section className="border border-dashed border-bp-line-hairline p-5" aria-labelledby="internal-h" data-internal-pack>
          <h2 id="internal-h" className="t-label-caps flex items-center gap-2 text-bp-ink-tertiary">
            <Icon name="description" size={18} />
            INTERNAL REVIEW PACK · NOT AVAILABLE YET
          </h2>
          <p className="t-body-sm mt-2 text-bp-ink-secondary">For your team and QS: the same documents with every page watermarked DRAFT and market-reference lines labelled as such.</p>
          <ul className="t-body-sm mt-3 space-y-1 text-bp-ink-secondary">
            <li>Drawing set · {sheetCount} sheet{sheetCount === 1 ? "" : "s"} · A3</li>
            <li>Render pack</li>
            <li>BoQ{rev ? ` · rev ${rev}` : ""}</li>
          </ul>
          <div className="mt-4">
            <Button kind="secondary" disabled={{ reason: "Not available yet", reasonId: internalReasonId }}>
              Download internal pack
            </Button>
            <p id={internalReasonId} className="t-label-md mt-2 text-bp-ink-tertiary">
              Not available yet — an internal pack needs its own watermark and its own release rule, which are still to be decided.
            </p>
          </div>
        </section>

        {preflight.firm && basis ? (
          basis.ok ? (
            <section className="border border-bp-line-hairline bg-bp-surface-raised p-5" aria-labelledby="proposal-h" data-proposal-state="open">
              <h2 id="proposal-h" className="t-label-caps flex items-center gap-2 text-bp-ink-tertiary">
                <Icon name="lock_open" size={18} />
                CLIENT PROPOSAL · UNLOCKED
              </h2>
              <p className="t-body-sm mt-2 text-bp-ink-secondary">{basis.detail}</p>
              <div className="mt-4">
                <Button kind="secondary" href={`/project/${projectId}/proposal`}>
                  Set up the proposal
                </Button>
              </div>
            </section>
          ) : (
            <div data-proposal-state="locked">
              <StateBlock
                kind="gate"
                title="Client proposal locked"
                options={[
                  bookOpen && bookOpen.conflicts + bookOpen.outliers > 0
                    ? `Review your rate book (${bookOpen.conflicts} conflict${bookOpen.conflicts === 1 ? "" : "s"}, ${bookOpen.outliers} outlier${bookOpen.outliers === 1 ? "" : "s"} open)`
                    : "Review your rate book and mark it reviewed",
                  "Or accept the market basis for this project — recorded with your name",
                ]}
                actions={
                  <>
                    <Button kind="secondary" tone="inverse" href={`/project/${projectId}/rates`}>
                      Review rates
                    </Button>
                    <Button kind="quiet" tone="inverse" href={`/project/${projectId}/rates#reference-basis`}>
                      Accept market basis
                    </Button>
                  </>
                }
              >
                A client document can&rsquo;t be priced from market reference without your say-so. One of these unlocks it:
              </StateBlock>
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}

function CheckRow({ c, status }: { c: ChecklistItem; status: string }) {
  return (
    <li className={`grid grid-cols-[24px_minmax(0,1fr)_auto] gap-3 border-b border-bp-line-hairline px-3 py-3 ${c.ok ? "" : "bg-bp-surface-raised"}`} data-check={c.key} data-ok={c.ok}>
      <Icon name={c.ok ? "check_circle" : "lock"} size={20} className="mt-0.5 text-bp-ink-secondary" />
      <div className="min-w-0">
        <p className="t-heading-sm text-bp-ink-primary">{c.title}</p>
        <p className="t-body-sm mt-0.5 text-bp-ink-secondary">{c.detail}</p>
        {!c.ok && c.items.length > 0 ? (
          <ul className="t-body-sm mt-1 space-y-0.5 text-bp-ink-secondary">
            {c.items.slice(0, 12).map((it) => (
              <li key={it}>· {it}</li>
            ))}
            {c.items.length > 12 ? <li className="text-bp-ink-tertiary">… and {c.items.length - 12} more</li> : null}
          </ul>
        ) : null}
        {!c.ok && c.fix ? (
          <a href={c.fix.href} className="t-label-md mt-1.5 inline-flex text-bp-ink-primary underline decoration-bp-line-control underline-offset-2 hover:decoration-bp-ink-primary">
            {c.fix.label} →
          </a>
        ) : null}
      </div>
      <span className="t-label-caps whitespace-nowrap text-bp-ink-secondary">{status}</span>
    </li>
  );
}

function PrintedRow({ job }: { job: JobView | null }) {
  const finished = job && (job.status === "passed" || job.status === "failed") && job.checks_total > 0;
  const ok = !!finished && job!.failed_checks.length === 0;
  const status = !finished ? "AT EXPORT" : ok ? "PASS" : "FAILED";
  return (
    <li className="grid grid-cols-[24px_minmax(0,1fr)_auto] gap-3 border-b border-bp-line-hairline px-3 py-3" data-check="printed" data-ok={finished ? ok : undefined}>
      <Icon name={!finished ? "schedule" : ok ? "check_circle" : "error"} size={20} className="mt-0.5 text-bp-ink-secondary" />
      <div className="min-w-0">
        <p className="t-heading-sm text-bp-ink-primary">No contractor or supplier names · draft statement · contents</p>
        <p className="t-body-sm mt-0.5 text-bp-ink-secondary">
          {!finished
            ? "Checked on the printed pages when the export runs: the identity scan, the draft statement on every page, the totals and the sheets each document must carry."
            : ok
              ? `Last export: all ${job!.checks_total} checks on the printed pages passed.`
              : `Last export: ${job!.failed_checks.length} of ${job!.checks_total} checks on the printed pages failed — nothing was released.`}
        </p>
      </div>
      <span className="t-label-caps whitespace-nowrap text-bp-ink-secondary">{status}</span>
    </li>
  );
}

function Check({ label, checked, onChange, disabled, testId }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; testId?: string }) {
  return (
    <label className="t-body-sm flex min-h-6 items-center gap-2 text-bp-ink-primary" data-testid={testId}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} className="h-4 w-4 rounded-none accent-bp-ink-primary" />
      {label}
    </label>
  );
}
