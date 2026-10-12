"use client";

// =============================================================================
// Rates & Basis — a firm's rate book (K4, R7 §3.3, frame 19:48). One component
// for /firms/[firmId] and, in a project's journey, step 04 /project/[id]/rates.
//
// The server builds the view (lib/firms/book-view.ts): what needs attention
// (H8 unit checks with their conversion, outliers, conflicts), what is in use
// beside the figure it shadows, the history, and the corrections waiting to be
// promoted. Every change goes to /api/firms/${firmId}/… (or the vocabulary) —
// the static privacy test (lib/firms/__tests__/page-privacy.test.ts) asserts no
// other URL appears here — then the server view is re-read (router.refresh).
//
// "Mark book reviewed" is disabled WITH its reason while anything needs
// attention; the route refuses the same thing (409 attention_open).
// =============================================================================

import { useRouter } from "next/navigation";
import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/blueprint/Button";
import { Icon } from "@/components/blueprint/Icon";
import { ProvenanceMark } from "@/components/blueprint/ProvenanceMark";
import { TopBarActions } from "@/components/blueprint/shell/TopBar";
import { formatAED } from "@/lib/format/aed";
import type { BookEntryView, BookView } from "@/lib/firms/book-view";
import { checkMagnitude } from "@/lib/firms/magnitude";
import { ENTRY_KINDS, groupBySection, validateDraftAgainst, type EntryKind, type VocabularyItem } from "@/lib/firms/vocabulary-client";

import { BrandingPanel } from "./branding-panel";
import { QuotesPanel } from "./quotes-panel";

type Grade = "economy" | "standard" | "premium";
type Tab = "entries" | "quotes" | "candidates" | "history";
type ApiError = { error?: string; code?: string };

interface FirmSummary {
  id: string;
  name: string;
  ohp_pct: number;
  status: "draft" | "reviewed";
  reviewed_at: string | null;
  private: boolean;
}

interface Draft {
  item_key: string;
  grade: Grade | "";
  unit: string;
  kind: EntryKind;
  rate_aed: string;
  note: string;
}

const EMPTY: Draft = { item_key: "", grade: "", unit: "", kind: "supply_and_install", rate_aed: "", note: "" };
const KIND_LABEL: Record<string, string> = { labour: "labour", supply: "supply", supply_and_install: "supply & install", lump: "lump" };
const unitText = (u: string) => u.replace(/\bm2\b/g, "m²").replace(/\bm3\b/g, "m³");

/** H8: the single figure an item shadows (market reference, or the built-in element / allowance constant). */
const shadowFigure = (v: VocabularyItem | null | undefined): number | null =>
  !v ? null : v.reference.kind === "market" ? v.reference.rate_aed : v.reference.kind === "builtin" ? (v.reference.rate_aed ?? null) : null;

/** Turn an API failure into the inline messages the form shows. */
function inlineErrors(status: number, body: ApiError): string[] {
  if (status === 422 && body.error) return body.error.split(/;\s*/).filter(Boolean);
  if (status === 409 && body.code === "entry_locked") return [body.error ?? "This rate's figures come from its record and cannot be edited here."];
  if (status === 409 && body.code === "entry_retired") return ["This entry is already history."];
  if (status === 409 && body.code === "rate_outlier") return [body.error ?? "This rate is far from the reference — check the unit."];
  if (status === 409 && body.code === "attention_open") return [body.error ?? "Resolve the entries that need attention first."];
  if (status === 409) return ["The book changed while you were editing — reload it."];
  if (status === 401) return ["Your session has ended — sign in again."];
  if (status === 403) return ["You are no longer a member of this firm."];
  return [body.error ?? `The request failed (${status}).`];
}

export function FirmBookEditor({
  initialFirm,
  view,
  basisControl,
  startAdding = false,
}: {
  initialFirm: FirmSummary;
  view: BookView;
  /** Step 04 in a project: the reference-basis accept control (a project route — kept out of this file). */
  basisControl?: ReactNode;
  /** The page was opened with ?add= (the BoQ inspector's "Add to my book"). */
  startAdding?: boolean;
}) {
  const firmId = initialFirm.id;
  const router = useRouter();
  const ids = useId();
  const [tab, setTab] = useState<Tab>("entries");
  const [importOpen, setImportOpen] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [vocab, setVocab] = useState<VocabularyItem[] | null>(null);
  const [vocabError, setVocabError] = useState<string | null>(null);
  // The add form starts open on an empty book, and when "Add to my book" sent the member here (?add=).
  const [adding, setAdding] = useState(view.entries.length === 0 || startAdding);
  const firm = view.firm;
  const reviewed = firm.status === "reviewed";

  useEffect(() => {
    let cancelled = false;
    fetch("/api/rate-vocabulary")
      .then(async (r) => ({ ok: r.ok, status: r.status, body: (await r.json().catch(() => ({}))) as { items?: VocabularyItem[]; error?: string } }))
      .then(({ ok, status, body }) => {
        if (cancelled) return;
        if (!ok || !body.items) setVocabError(body.error ?? `Vocabulary unavailable (${status}).`);
        else setVocab(body.items);
      })
      .catch(() => !cancelled && setVocabError("Vocabulary unavailable."));
    return () => {
      cancelled = true;
    };
  }, []);
  const byKey = useMemo(() => new Map((vocab ?? []).map((v) => [v.item_key, v])), [vocab]);

  /** One action against this firm's routes, then the server view is read again. */
  async function act(key: string, url: string, init: RequestInit): Promise<{ ok: boolean; status: number; body: ApiError & Record<string, unknown> }> {
    setBusy(key);
    setBanner(null);
    try {
      const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
      const body = (await res.json().catch(() => ({}))) as ApiError & Record<string, unknown>;
      if (!res.ok) setBanner(inlineErrors(res.status, body).join(" "));
      else router.refresh();
      return { ok: res.ok, status: res.status, body };
    } finally {
      setBusy(null);
    }
  }

  // --- status + OH&P ---------------------------------------------------------------
  const setStatus = (status: "draft" | "reviewed") => act("status", `/api/firms/${firmId}`, { method: "PATCH", body: JSON.stringify({ status }) });
  const [ohpOpen, setOhpOpen] = useState(false);
  const [ohp, setOhp] = useState(String(firm.ohp_pct));
  const [ohpError, setOhpError] = useState<string | null>(null);
  async function saveOhp() {
    const n = Number(ohp);
    if (!Number.isFinite(n) || n < 0 || n > 50) {
      setOhpError("OH&P must be a percentage between 0 and 50.");
      return;
    }
    setOhpError(null);
    const r = await act("ohp", `/api/firms/${firmId}`, { method: "PATCH", body: JSON.stringify({ ohp_pct: n }) });
    if (r.ok) setOhpOpen(false);
  }

  // --- attention actions -------------------------------------------------------------
  const keep = (e: BookEntryView) => act(`keep-${e.id}`, `/api/firms/${firmId}/rates/${e.id}`, { method: "PATCH", body: JSON.stringify({ confirm_outlier: true }) });
  const retire = (e: BookEntryView) => act(`retire-${e.id}`, `/api/firms/${firmId}/rates/${e.id}`, { method: "DELETE" });
  const convert = (e: BookEntryView) =>
    act(`convert-${e.id}`, `/api/firms/${firmId}/rates`, {
      method: "POST",
      body: JSON.stringify({ item_key: e.item_key, grade: e.grade, unit: e.attention!.offer!.unit, kind: e.kind, rate_aed: e.attention!.offer!.rate_aed, note: `converted on review — ${e.attention!.offer!.note}` }),
    });
  const [conflictPick, setConflictPick] = useState<Record<string, string>>({});
  async function resolveConflict(item: string, options: BookEntryView[]) {
    const keepId = conflictPick[item] ?? options[0]!.id;
    for (const o of options) if (o.id !== keepId) await act(`retire-${o.id}`, `/api/firms/${firmId}/rates/${o.id}`, { method: "DELETE" });
  }

  // --- edit (typed entries only — a promoted or imported rate is its record's) --------
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ rate_aed: string; kind: EntryKind; grade: Grade | ""; note: string }>({ rate_aed: "", kind: "labour", grade: "", note: "" });
  const [editErrors, setEditErrors] = useState<string[]>([]);
  const [editOutlier, setEditOutlier] = useState(false);
  function startEdit(e: BookEntryView) {
    setEditing(e.id);
    setEdit({ rate_aed: String(e.rate_aed), kind: e.kind as EntryKind, grade: (e.grade ?? "") as Grade | "", note: e.note ?? "" });
    setEditErrors([]);
    setEditOutlier(false);
  }
  async function saveEdit(e: BookEntryView, confirmOutlier = false) {
    const item = byKey.get(e.item_key) ?? null;
    const errs = validateDraftAgainst(item, { item_key: e.item_key, unit: e.unit, kind: edit.kind, rate_aed: Number(edit.rate_aed) });
    if (edit.rate_aed.trim() === "") errs.unshift("Enter a rate.");
    if (errs.length) {
      setEditErrors(errs);
      return;
    }
    const r = await act(`edit-${e.id}`, `/api/firms/${firmId}/rates/${e.id}`, {
      method: "PATCH",
      body: JSON.stringify({ rate_aed: Number(edit.rate_aed), kind: edit.kind, grade: edit.grade || null, note: edit.note.trim() || null, ...(confirmOutlier ? { confirm_outlier: true } : {}) }),
    });
    if (!r.ok) {
      setBanner(null);
      setEditErrors(inlineErrors(r.status, r.body));
      setEditOutlier(r.status === 409 && r.body.code === "rate_outlier");
      return;
    }
    setEditing(null);
  }

  // --- item trail (U4) -----------------------------------------------------------------
  const [trail, setTrail] = useState<Record<string, { id: string; rate_aed: number; unit: string; created_at: string; superseded_at: string | null; retire_reason: string | null; origin: string }[] | "loading" | "error">>({});
  async function toggleHistory(itemKey: string) {
    if (trail[itemKey]) {
      setTrail(({ [itemKey]: _drop, ...rest }) => (void _drop, rest));
      return;
    }
    setTrail((t) => ({ ...t, [itemKey]: "loading" }));
    try {
      const res = await fetch(`/api/firms/${firmId}/rates/history?item_key=${encodeURIComponent(itemKey)}`);
      const body = (await res.json().catch(() => ({}))) as { history?: { id: string; rate_aed: number; unit: string; created_at: string; superseded_at: string | null; retire_reason: string | null; origin: string }[] };
      setTrail((t) => ({ ...t, [itemKey]: res.ok && body.history ? body.history : "error" }));
    } catch {
      setTrail((t) => ({ ...t, [itemKey]: "error" }));
    }
  }

  // --- corrections to promote --------------------------------------------------------------
  const promote = (id: string) => act(`promote-${id}`, `/api/firms/${firmId}/promote`, { method: "POST", body: JSON.stringify({ correction_id: id }) });

  const counts = { entries: view.entries.length, quotes: view.quotes, candidates: view.candidates.length };
  const tabs: { key: Tab; label: string }[] = [
    { key: "entries", label: `Entries · ${counts.entries}` },
    { key: "quotes", label: `Quote imports · ${counts.quotes}` },
    { key: "candidates", label: `Corrections to promote · ${counts.candidates}` },
    { key: "history", label: "History" },
  ];
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const reviewWhy = `${ids}-review-why`;

  return (
    <div data-firm-id={firmId} className="mx-auto max-w-[1180px] px-6 pb-16 pt-8 md:px-12">
      <TopBarActions>
        <Button kind="quiet" href={`/api/firms/${firmId}/quotes/template`}>
          Download quote template
        </Button>
        <Button
          kind="secondary"
          onClick={() => {
            setTab("quotes");
            setImportOpen(true);
            requestAnimationFrame(() => document.getElementById("quote-upload")?.scrollIntoView({ block: "start" }));
          }}
        >
          Import a quote
        </Button>
        <Button
          kind="secondary"
          onClick={() => {
            setTab("entries");
            setAdding(true);
            requestAnimationFrame(() => document.getElementById("new-entry")?.scrollIntoView({ block: "start" }));
          }}
        >
          Add rate
        </Button>
      </TopBarActions>

      <p className="t-label-caps text-bp-brass-text">{view.project ? "04 · RATES & BASIS" : "RATE BOOK"}</p>
      <h1 className="t-heading-lg mt-2">Your rate book</h1>
      <p className="t-label-md mt-1 text-bp-ink-tertiary">
        {firm.name} · {firm.private ? "private to your firm" : "shared"} ·{" "}
        <button type="button" onClick={() => setOhpOpen((o) => !o)} className="underline decoration-bp-line-strong underline-offset-2 hover:text-bp-ink-primary" aria-expanded={ohpOpen}>
          OH&amp;P {firm.ohp_pct}% at assembly
        </button>{" "}
        · {view.entries.length} active {view.entries.length === 1 ? "entry" : "entries"}
        {view.lastChange ? ` · last change ${view.lastChange}` : ""}
      </p>
      {ohpOpen ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label htmlFor={`${ids}-ohp`} className="t-label-caps text-bp-ink-tertiary">
            OH&amp;P %
          </label>
          <input id={`${ids}-ohp`} value={ohp} onChange={(e) => setOhp(e.target.value)} inputMode="decimal" aria-invalid={!!ohpError} className="t-num-md h-9 w-20 rounded-none border border-bp-line-control bg-bp-surface-base px-2 text-right" />
          <Button kind="secondary" onClick={busy ? undefined : saveOhp}>
            Save OH&amp;P
          </Button>
          <span className="t-label-md text-bp-ink-tertiary">Applied once at BoQ assembly as its own line — never inside a rate. 0–50%.</span>
          {ohpError ? (
            <span role="alert" className="t-body-sm text-bp-ink-primary">
              {ohpError}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Status strip (3 columns, hairline top) */}
      <div className="mt-6 grid grid-cols-1 gap-6 border-t border-bp-line-strong pt-5 md:grid-cols-3">
        <section aria-labelledby={`${ids}-st`}>
          <h2 id={`${ids}-st`} className="t-label-caps text-bp-ink-tertiary">
            BOOK STATUS
          </h2>
          <p className="t-heading-sm mt-2" data-testid="book-status" data-status={firm.status}>
            <span>{reviewed ? "Reviewed" : "Draft"}</span>
            {reviewed ? ` · ${firm.reviewed_at ? new Date(firm.reviewed_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""}` : " — not reviewed"}
          </p>
          <div className="mt-3 flex flex-wrap items-start gap-3">
            {reviewed ? (
              <Button kind="quiet" onClick={() => setStatus("draft")}>
                Back to draft
              </Button>
            ) : (
              <Button kind="secondary" onClick={() => setStatus("reviewed")} disabled={view.reviewBlock ? { reason: view.reviewBlock, reasonId: reviewWhy, showReason: true } : false} testId="mark-reviewed">
                Mark book reviewed
              </Button>
            )}
          </div>
        </section>
        <section aria-labelledby={`${ids}-op`}>
          <h2 id={`${ids}-op`} className="t-label-caps text-bp-ink-tertiary">
            {view.project ? "ON THIS PROJECT" : "PROJECTS"}
          </h2>
          {view.project ? (
            view.project.basis === "no_boq" ? (
              <p className="t-body-sm mt-2 text-bp-ink-secondary">No BoQ yet on this project.</p>
            ) : (
              <>
                <p className="t-heading-sm mt-2">
                  {view.project.firmLines} of {view.project.totalLines} lines price from your book
                </p>
                <p className="t-label-md mt-1 text-bp-ink-tertiary">
                  {view.project.referenceLines} from market reference or derived · {view.project.unpricedLines} to be priced
                </p>
              </>
            )
          ) : (
            <p className="t-heading-sm mt-2">
              {view.projectCount} {view.projectCount === 1 ? "project prices" : "projects price"} from this book
            </p>
          )}
        </section>
        <section id="reference-basis" className="scroll-mt-20" aria-labelledby={`${ids}-rb`}>
          <h2 id={`${ids}-rb`} className="t-label-caps text-bp-ink-tertiary">
            REFERENCE BASIS
          </h2>
          {view.project ? (
            basisControl
          ) : (
            <p className="t-body-sm mt-2 text-bp-ink-secondary">Accepted per project, on its BoQ, or by marking this book reviewed.</p>
          )}
        </section>
      </div>

      {banner ? (
        <p role="alert" className="surface-inverse t-body-sm mt-6 bg-bp-alert-surface px-4 py-3 text-bp-alert-ink">
          {banner}
        </p>
      ) : null}

      {/* Tabs */}
      <div role="tablist" aria-label="Rate book" className="mt-8 flex gap-6 border-b border-bp-line-hairline">
        {tabs.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            role="tab"
            type="button"
            id={`${ids}-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`${ids}-panel`}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => setTab(t.key)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const n = (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
              setTab(tabs[n]!.key);
              tabRefs.current[n]?.focus();
            }}
            className={`-mb-px border-b-2 pb-3 ${tab === t.key ? "t-nav-item-active border-bp-brass" : "t-nav-item border-transparent text-bp-ink-secondary hover:text-bp-ink-primary"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`${ids}-panel`} aria-labelledby={`${ids}-tab-${tab}`} className="mt-4">
        {tab === "entries" ? (
          <>
            {adding ? (
              <AddEntry
                firmId={firmId}
                vocab={vocab}
                vocabError={vocabError}
                byKey={byKey}
                entries={view.entries}
                onDone={() => router.refresh()}
                onCancel={() => setAdding(false)}
              />
            ) : null}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px]" data-testid="entries">
                <thead>
                  <tr className="t-label-caps whitespace-nowrap bg-bp-surface-sunken text-left text-bp-ink-tertiary">
                    <th scope="col" className="px-3 py-3 font-normal">ITEM</th>
                    <th scope="col" className="px-3 py-3 font-normal">KIND</th>
                    <th scope="col" className="px-3 py-3 font-normal">UNIT</th>
                    <th scope="col" className="px-3 py-3 text-right font-normal">YOUR RATE</th>
                    <th scope="col" className="px-3 py-3 text-right font-normal">MARKET REF</th>
                    <th scope="col" className="px-3 py-3 text-right font-normal">VS REF</th>
                    <th scope="col" className="px-3 py-3 font-normal">ORIGIN</th>
                    <th scope="col" className="px-3 py-3 font-normal">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                {view.attention.length + view.conflicts.length > 0 ? (
                  <tbody data-group="attention">
                    <tr>
                      <th colSpan={8} scope="rowgroup" className="t-label-caps px-3 pb-2 pt-5 text-left font-normal text-bp-ink-primary">
                        NEEDS ATTENTION · {view.attention.length + view.conflicts.length}
                      </th>
                    </tr>
                    {view.attention.map((e) => (
                      <Fragment key={e.id}>
                        <EntryRow e={e} raised icon={e.attention!.kind === "unit_check" ? "straighten" : "priority_high"} />
                        <tr className="bg-bp-surface-raised" data-attention={e.attention!.kind} data-attention-for={e.item_key}>
                          <td colSpan={8} className="border-b border-bp-line-hairline px-10 pb-5 pt-1">
                            <p className="t-label-caps text-bp-ink-primary">{e.attention!.headline}</p>
                            <p className="t-body-sm mt-2 max-w-[90ch] text-bp-ink-secondary">{e.attention!.sentence}</p>
                            <div className="mt-4 flex flex-wrap items-center gap-6">
                              {e.attention!.offer ? (
                                <>
                                  <Button kind="primary" onClick={busy ? undefined : () => convert(e)} testId="convert">
                                    Convert to {formatAED(e.attention!.offer.rate_aed)} / {unitText(e.attention!.offer.unit)}
                                  </Button>
                                  <Button kind="quiet" onClick={busy ? undefined : () => keep(e)} testId="keep">
                                    Keep {formatAED(e.rate_aed)}
                                  </Button>
                                </>
                              ) : (
                                <Button kind="secondary" onClick={busy ? undefined : () => keep(e)} testId="keep">
                                  Confirm {formatAED(e.rate_aed)}
                                </Button>
                              )}
                              <Button kind="quiet" onClick={busy ? undefined : () => retire(e)}>
                                Retire entry
                              </Button>
                            </div>
                          </td>
                        </tr>
                      </Fragment>
                    ))}
                    {view.conflicts.map((c) => (
                      <tr key={`${c.item_key}|${c.grade ?? "*"}`} className="bg-bp-surface-raised" data-attention="conflict">
                        <td colSpan={8} className="border-b border-bp-line-hairline px-3 py-4">
                          <p className="t-body-sm flex items-center gap-2">
                            <Icon name="call_split" size={18} />
                            {c.label} <span className="t-label-md text-bp-ink-tertiary">{c.item_key}</span>
                          </p>
                          <fieldset className="mt-3 pl-7">
                            <legend className="t-label-caps text-bp-ink-primary">Conflict — two active rates for the same item. Keep one; the other is retired with its history.</legend>
                            {c.options.map((o) => (
                              <label key={o.id} className="mt-2 flex cursor-pointer items-center gap-4">
                                <input type="radio" name={`conflict-${c.item_key}`} checked={(conflictPick[c.item_key] ?? c.options[0]!.id) === o.id} onChange={() => setConflictPick((p) => ({ ...p, [c.item_key]: o.id }))} />
                                <span className="t-num-md w-24">{formatAED(o.rate_aed)}</span>
                                <ProvenanceMark tier="measured" />
                                <span className="t-label-md w-16 text-bp-ink-secondary">{o.vsRef}</span>
                                <span className="t-label-md text-bp-ink-secondary">{o.originLabel}</span>
                              </label>
                            ))}
                            <div className="mt-4">
                              <Button kind="secondary" onClick={busy ? undefined : () => resolveConflict(c.item_key, c.options)}>
                                Keep selected, retire the other
                              </Button>
                            </div>
                          </fieldset>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                ) : null}
                <tbody data-group="in-use">
                  <tr>
                    <th colSpan={8} scope="rowgroup" className="t-label-caps px-3 pb-2 pt-5 text-left font-normal text-bp-ink-primary">
                      IN USE · {view.inUse.length}
                    </th>
                  </tr>
                  {view.inUse.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="t-body-sm px-3 py-4 text-bp-ink-secondary">
                        No entries yet. Every item this firm does not price falls back to the figure it shadows.
                      </td>
                    </tr>
                  ) : null}
                  {view.inUse.map((e) => (
                    <Fragment key={e.id}>
                      {editing === e.id ? (
                        <tr data-entry-id={e.id} data-item-key={e.item_key} data-rate={e.rate_aed} className="bg-bp-surface-raised">
                          <td className="px-3 py-3" colSpan={3}>
                            <p className="t-body-sm">{e.label}</p>
                            <p className="t-label-md text-bp-ink-tertiary">{e.item_key}</p>
                            <div className="mt-2 flex gap-2">
                              <select aria-label="Grade" value={edit.grade} onChange={(ev) => setEdit((d) => ({ ...d, grade: ev.target.value as Grade | "" }))} className="t-body-sm h-9 rounded-none border border-bp-line-control bg-bp-surface-base px-2">
                                <option value="">all grades</option>
                                <option value="economy">economy</option>
                                <option value="standard">standard</option>
                                <option value="premium">premium</option>
                              </select>
                              <select aria-label="Kind" value={edit.kind} onChange={(ev) => setEdit((d) => ({ ...d, kind: ev.target.value as EntryKind }))} className="t-body-sm h-9 rounded-none border border-bp-line-control bg-bp-surface-base px-2">
                                {(byKey.get(e.item_key)?.kinds ?? ENTRY_KINDS).map((k) => (
                                  <option key={k} value={k}>
                                    {KIND_LABEL[k]}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right">
                            <input aria-label="Rate AED" value={edit.rate_aed} onChange={(ev) => setEdit((d) => ({ ...d, rate_aed: ev.target.value }))} inputMode="decimal" className="t-num-md h-9 w-28 rounded-none border border-bp-line-control bg-bp-surface-base px-2 text-right" />
                          </td>
                          <td colSpan={4} className="px-3 py-3">
                            <div className="flex flex-wrap items-center gap-4">
                              <Button kind="primary" onClick={busy ? undefined : () => saveEdit(e)}>
                                Save
                              </Button>
                              <Button kind="quiet" onClick={() => setEditing(null)}>
                                Cancel
                              </Button>
                              {editOutlier ? (
                                <Button kind="quiet" onClick={() => saveEdit(e, true)} testId="edit-confirm-outlier">
                                  Save anyway — my confirmation is recorded
                                </Button>
                              ) : null}
                            </div>
                            {editErrors.length ? (
                              <ul role="alert" className="t-body-sm mt-2 text-bp-ink-primary" data-testid="edit-errors">
                                {editErrors.map((m) => (
                                  <li key={m}>{m}</li>
                                ))}
                              </ul>
                            ) : null}
                          </td>
                        </tr>
                      ) : (
                        <EntryRow
                          e={e}
                          actions={
                            <span className="flex items-center justify-end gap-1">
                              {e.locked ? (
                                <span className="flex size-8 items-center justify-center text-bp-ink-tertiary" title="Figures come from the record this rate cites">
                                  <Icon name="lock" size={16} label={`${e.item_key} is ${e.origin === "quote_import" ? "from a quotation" : "a promoted correction"} — its figures cannot be edited`} />
                                </span>
                              ) : (
                                <button type="button" onClick={() => startEdit(e)} aria-label={`Edit ${e.item_key}`} className="flex size-8 items-center justify-center text-bp-ink-secondary hover:text-bp-ink-primary">
                                  <Icon name="edit" size={16} />
                                </button>
                              )}
                              <button type="button" onClick={() => toggleHistory(e.item_key)} aria-label={`History of ${e.item_key}`} aria-expanded={!!trail[e.item_key]} className="flex size-8 items-center justify-center text-bp-ink-secondary hover:text-bp-ink-primary">
                                <Icon name="history" size={16} />
                              </button>
                              <button type="button" onClick={busy ? undefined : () => retire(e)} aria-label={`Retire ${e.item_key}`} title="Retire — kept in the book's history, stops pricing" className="flex size-8 items-center justify-center text-bp-ink-secondary hover:text-bp-ink-primary">
                                <Icon name="archive" size={16} />
                              </button>
                            </span>
                          }
                        />
                      )}
                      {trail[e.item_key] ? (
                        <tr data-history-for={e.item_key}>
                          <td colSpan={8} className="bg-bp-surface-sunken px-10 py-3">
                            {trail[e.item_key] === "loading" ? (
                              <p className="t-label-md text-bp-ink-tertiary">Loading the trail…</p>
                            ) : trail[e.item_key] === "error" ? (
                              <p role="alert" className="t-body-sm">
                                The trail could not be loaded.
                              </p>
                            ) : (
                              <ul className="t-label-md space-y-1" data-testid="entry-history">
                                {(trail[e.item_key] as { id: string; rate_aed: number; unit: string; created_at: string; superseded_at: string | null; retire_reason: string | null; origin: string }[]).map((h, i) => (
                                  <li key={h.id ?? i} data-history-id={h.id} data-active={!h.superseded_at} className="flex flex-wrap gap-4">
                                    <span className="w-36 text-bp-ink-tertiary">{h.created_at.slice(0, 16).replace("T", " ")}</span>
                                    <span className="w-32">
                                      {formatAED(h.rate_aed)} / {unitText(h.unit)}
                                    </span>
                                    <span className="text-bp-ink-secondary">{h.superseded_at ? `retired ${h.superseded_at.slice(0, 10)}${h.retire_reason ? ` — ${h.retire_reason}` : ""}` : "active"}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : tab === "quotes" ? (
          <div id="quote-upload">
            <QuotesPanel firmId={firmId} open={importOpen} onOpenChange={setImportOpen} />
          </div>
        ) : tab === "candidates" ? (
          view.candidates.length === 0 ? (
            <p className="t-body-sm py-4 text-bp-ink-secondary">No rate corrections are waiting. A correction captured on a BoQ with “Promote to our rate book after review” appears here; promoting it puts its rate in the book, and the next regeneration prices from it.</p>
          ) : (
            <ul className="divide-y divide-bp-line-hairline border-y border-bp-line-hairline" data-testid="candidates">
              {view.candidates.map((c) => (
                <li key={c.id} className="flex flex-wrap items-start justify-between gap-4 py-4">
                  <div className="min-w-0">
                    <p className="t-body-sm">
                      {c.label} <span className="t-label-md text-bp-ink-tertiary">{c.item_key}</span>
                    </p>
                    <p className="t-num-sm mt-1">
                      {c.old_value != null ? formatAED(c.old_value) : "—"} → {c.new_value != null ? formatAED(c.new_value) : "—"}
                      {c.unit ? ` / ${unitText(c.unit)}` : ""}
                    </p>
                    <p className="t-label-md mt-1 text-bp-ink-tertiary">
                      {c.line_description} · {c.recorded_at.slice(0, 10)}
                      {c.note ? ` · ${c.note}` : ""}
                    </p>
                  </div>
                  <Button kind="secondary" onClick={busy ? undefined : () => promote(c.id)} disabled={c.new_value == null ? { reason: "No corrected figure to promote", reasonId: `${ids}-np-${c.id}`, showReason: true } : false}>
                    Promote to the book
                  </Button>
                </li>
              ))}
            </ul>
          )
        ) : (
          <table className="w-full" data-testid="book-history">
            <thead>
              <tr className="t-label-caps bg-bp-surface-sunken text-left text-bp-ink-tertiary">
                <th className="px-3 py-3 font-normal">WHEN</th>
                <th className="px-3 py-3 font-normal">ITEM</th>
                <th className="px-3 py-3 text-right font-normal">RATE</th>
                <th className="px-3 py-3 font-normal">ORIGIN</th>
                <th className="px-3 py-3 font-normal">STATUS</th>
              </tr>
            </thead>
            <tbody>
              {view.history.map((h) => (
                <tr key={h.id} className="border-b border-bp-line-hairline" data-active={!h.superseded_at}>
                  <td className="t-label-md px-3 py-2.5 text-bp-ink-tertiary">{h.created_at.slice(0, 16).replace("T", " ")}</td>
                  <td className="t-body-sm px-3 py-2.5">
                    {h.label} <span className="t-label-md text-bp-ink-tertiary">{h.item_key}</span>
                  </td>
                  <td className="t-num-sm px-3 py-2.5 text-right">
                    {formatAED(h.rate_aed)} / {unitText(h.unit)}
                  </td>
                  <td className="t-label-md px-3 py-2.5 text-bp-ink-secondary">{h.origin === "quote_import" ? "quotation" : h.origin === "promoted_correction" ? "promoted correction" : "firm entry"}</td>
                  <td className="t-label-md px-3 py-2.5 text-bp-ink-secondary">{h.superseded_at ? `retired ${h.superseded_at.slice(0, 10)}${h.retire_reason ? ` — ${h.retire_reason}` : ""}` : "active"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <details className="mt-12 border-t border-bp-line-hairline pt-5">
        <summary className="t-label-caps cursor-pointer text-bp-ink-tertiary">PROPOSAL BRANDING · DISPLAY NAME, LOGO, TERMS</summary>
        <div className="mt-4">
          <BrandingPanel firmId={firmId} />
        </div>
      </details>
    </div>
  );
}

function EntryRow({ e, raised, icon, actions }: { e: BookEntryView; raised?: boolean; icon?: string; actions?: ReactNode }) {
  return (
    <tr data-entry-id={e.id} data-item-key={e.item_key} data-rate={e.rate_aed} className={`border-b border-bp-line-hairline ${raised ? "bg-bp-surface-raised" : ""}`}>
      <td className="px-3 py-3">
        <p className="t-body-sm flex items-center gap-2">
          {icon ? <Icon name={icon} size={18} className="text-bp-ink-secondary" /> : null}
          {e.label}
        </p>
        <p className="t-label-md text-bp-ink-tertiary">
          {e.item_key}
          {e.grade ? ` · ${e.grade}` : ""}
        </p>
      </td>
      <td className="t-label-md px-3 py-3 text-bp-ink-secondary">{KIND_LABEL[e.kind] ?? e.kind}</td>
      <td className="t-label-md px-3 py-3 text-bp-ink-secondary">{unitText(e.unit)}</td>
      <td className="px-3 py-3 text-right">
        <span className="inline-flex items-center gap-1.5">
          <span className="t-num-md">{formatAED(e.rate_aed)}</span>
          <ProvenanceMark tier="measured" />
          <span className="sr-only">
            AED {formatAED(e.rate_aed)} per {unitText(e.unit)}, own basis
          </span>
        </span>
      </td>
      <td className="px-3 py-3 text-right">
        {e.shadow ? (
          e.shadow.builtin ? (
            <span className="t-label-md text-bp-ink-tertiary">built-in</span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <span className="t-num-md text-bp-ink-secondary">{formatAED(e.shadow.rate_aed)}</span>
              <ProvenanceMark tier="market" />
              <span className="sr-only">AED {formatAED(e.shadow.rate_aed)}, market reference</span>
            </span>
          )
        ) : (
          <span className="t-label-md text-bp-ink-tertiary">no reference</span>
        )}
      </td>
      <td className="t-label-md px-3 py-3 text-right text-bp-ink-secondary">{e.vsRef}</td>
      <td className="t-label-md px-3 py-3 text-bp-ink-secondary">{e.originLabel}</td>
      <td className="px-3 py-3">{actions}</td>
    </tr>
  );
}

function AddEntry({
  firmId,
  vocab,
  vocabError,
  byKey,
  entries,
  onDone,
  onCancel,
}: {
  firmId: string;
  vocab: VocabularyItem[] | null;
  vocabError: string | null;
  byKey: Map<string, VocabularyItem>;
  entries: BookEntryView[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const ids = useId();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<string[]>([]);
  const [outlier, setOutlier] = useState(false);
  const [saving, setSaving] = useState(false);
  const sections = useMemo(() => groupBySection(vocab ?? []), [vocab]);
  const item = byKey.get(draft.item_key) ?? null;
  function pickItem(item_key: string) {
    const v = byKey.get(item_key);
    setDraft((d) => ({ ...d, item_key, unit: v?.unit ?? d.unit, kind: v && !v.kinds.includes(d.kind) ? v.default_kind : d.kind }));
    setErrors([]);
  }
  // K3: "Add to my book" from the BoQ inspector — ?add=<item_key>&rate=<n>
  // prefills this form (nothing is saved until the member presses Add).
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !vocab) return;
    const q = new URLSearchParams(window.location.search);
    const key = q.get("add");
    if (!key || !byKey.has(key)) return;
    prefilled.current = true;
    // One-time prefill from the URL, once the vocabulary it needs has arrived (guarded by the ref).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    pickItem(key);
    const rate = q.get("rate");
    if (rate && Number.isFinite(Number(rate))) setDraft((d) => ({ ...d, rate_aed: rate }));
    document.getElementById("new-entry")?.scrollIntoView({ block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vocab, byKey]);
  const magnitude = useMemo(() => {
    const r = Number(draft.rate_aed);
    return draft.item_key && draft.rate_aed.trim() !== "" && Number.isFinite(r) ? checkMagnitude(r, shadowFigure(item)) : null;
  }, [draft, item]);
  const replaces = draft.item_key ? (entries.find((e) => e.item_key === draft.item_key && (e.grade ?? null) === (draft.grade || null)) ?? null) : null;
  const live = useMemo(() => (draft.item_key ? validateDraftAgainst(item, { item_key: draft.item_key, unit: draft.unit, kind: draft.kind, rate_aed: Number(draft.rate_aed) }) : []), [draft, item]);

  async function add(confirmOutlier = false) {
    const errs = [...(draft.item_key ? [] : ["Choose an item."]), ...(draft.rate_aed.trim() === "" ? ["Enter a rate."] : []), ...live];
    if (errs.length) {
      setErrors(errs);
      return;
    }
    setSaving(true);
    setErrors([]);
    try {
      const res = await fetch(`/api/firms/${firmId}/rates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ item_key: draft.item_key, grade: draft.grade || null, unit: draft.unit, kind: draft.kind, rate_aed: Number(draft.rate_aed), note: draft.note.trim() || null, ...(confirmOutlier ? { confirm_outlier: true } : {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as ApiError;
      if (!res.ok) {
        setErrors(inlineErrors(res.status, body));
        setOutlier(res.status === 409 && body.code === "rate_outlier");
        return;
      }
      setOutlier(false);
      setDraft(EMPTY);
      onDone();
    } finally {
      setSaving(false);
    }
  }

  const field = "t-body-sm mt-1 h-10 w-full rounded-none border border-bp-line-control bg-bp-surface-base px-3 text-bp-ink-primary";
  return (
    <section id="new-entry" aria-labelledby={`${ids}-h`} className="mb-8 border border-bp-line-strong bg-bp-surface-raised p-5">
      <h2 id={`${ids}-h`} className="t-heading-sm">
        Add a rate
      </h2>
      {vocabError ? (
        <p role="alert" className="t-body-sm mt-2">
          {vocabError}
        </p>
      ) : null}
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-6">
        <label className="md:col-span-3">
          <span className="t-label-caps text-bp-ink-tertiary">ITEM</span>
          <select value={draft.item_key} onChange={(e) => pickItem(e.target.value)} aria-label="Item" disabled={!vocab} className={field}>
            <option value="">{vocab ? "Choose an item the take-off prices…" : "Loading vocabulary…"}</option>
            {sections.map((s) => (
              <optgroup key={s.section} label={s.section}>
                {s.items.map((it) => (
                  <option key={it.item_key} value={it.item_key}>
                    {it.label} ({it.item_key}
                    {it.unit ? ` · ${it.unit}` : ""})
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label>
          <span className="t-label-caps text-bp-ink-tertiary">GRADE</span>
          <select value={draft.grade} onChange={(e) => setDraft((d) => ({ ...d, grade: e.target.value as Grade | "" }))} aria-label="Grade" className={field}>
            <option value="">all grades</option>
            <option value="economy">economy</option>
            <option value="standard">standard</option>
            <option value="premium">premium</option>
          </select>
        </label>
        <label>
          <span className="t-label-caps text-bp-ink-tertiary">UNIT</span>
          <input value={draft.unit} onChange={(e) => setDraft((d) => ({ ...d, unit: e.target.value }))} aria-label="Unit" readOnly={!!item?.unit} placeholder="m2" className={field} />
        </label>
        <label>
          <span className="t-label-caps text-bp-ink-tertiary">KIND</span>
          <select value={draft.kind} onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value as EntryKind }))} aria-label="Kind" className={field}>
            {(item?.kinds ?? ENTRY_KINDS).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="md:col-span-2">
          <span className="t-label-caps text-bp-ink-tertiary">RATE (AED PER UNIT)</span>
          <input value={draft.rate_aed} onChange={(e) => setDraft((d) => ({ ...d, rate_aed: e.target.value }))} inputMode="decimal" aria-label="Rate AED" placeholder="0.00" className={`${field} t-num-md text-right`} />
        </label>
        <label className="md:col-span-3">
          <span className="t-label-caps text-bp-ink-tertiary">NOTE (OPTIONAL)</span>
          <input value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} aria-label="Note" className={field} />
        </label>
      </div>
      {item ? (
        <p className="t-label-md mt-3 text-bp-ink-tertiary">
          Shadows{" "}
          {item.reference.kind === "market"
            ? `market reference AED ${formatAED(item.reference.rate_aed)} / ${unitText(item.reference.unit)}`
            : item.reference.kind === "builtin"
              ? `built-in pricing${item.reference.rate_aed != null ? ` AED ${formatAED(item.reference.rate_aed)}` : ""}`
              : "no reference rate (a QS-to-price item)"}{" "}
          · accepts {item.kinds.map((k) => KIND_LABEL[k]).join(" / ")}
        </p>
      ) : null}
      {magnitude?.outlier ? (
        <p className="t-body-sm mt-2 text-bp-ink-primary" data-testid="magnitude-warning">
          {magnitude.reason}
        </p>
      ) : null}
      {replaces ? (
        <p className="t-label-md mt-2 text-bp-ink-secondary" data-testid="replaces-hint">
          Saving replaces the current entry — AED {replaces.rate_aed} / {unitText(replaces.unit)} ({replaces.originLabel}); it stays in the item&apos;s history.
        </p>
      ) : null}
      {errors.length > 0 || (draft.item_key && live.length > 0) ? (
        <ul role="alert" className="t-body-sm mt-2 text-bp-ink-primary" data-testid="add-errors">
          {(errors.length ? errors : live).map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-5 flex flex-wrap items-center gap-6">
        <Button kind="primary" onClick={saving || !vocab ? undefined : () => add()}>
          {saving ? "Adding…" : "Add entry"}
        </Button>
        <Button kind="quiet" onClick={onCancel}>
          Cancel
        </Button>
        {outlier ? (
          <Button kind="quiet" onClick={() => add(true)} testId="add-confirm-outlier">
            Save anyway — my confirmation is recorded
          </Button>
        ) : null}
      </div>
    </section>
  );
}
