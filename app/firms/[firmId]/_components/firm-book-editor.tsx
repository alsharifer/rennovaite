"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";

import { Figure } from "@/components/figures/Figure";
import { ENTRY_KINDS, groupBySection, validateDraftAgainst, type EntryKind, type VocabularyItem } from "@/lib/firms/vocabulary-client";

// =============================================================================
// U2 — a firm's rate book: OH&P, status, and its entries, each shown beside
// what it SHADOWS (the market-reference rate, or the built-in interior pricing).
//
// Every request goes to /api/firms/${firmId}/… or /api/rate-vocabulary — the
// static privacy test (lib/firms/__tests__/page-privacy.test.ts) asserts no
// other URL appears here, and the CDP page check watches the network for the
// same thing live. Validation is the same four rules the API enforces
// (lib/firms/vocabulary-client.ts), shown inline; an API 422 that slips past
// (a stale vocabulary, say) is shown inline too, never as a raw message dump.
// =============================================================================

type Grade = "economy" | "standard" | "premium";

interface FirmSummary {
  id: string;
  name: string;
  private: boolean;
  book_id: string | null;
  ohp_pct: number;
  entry_count: number;
  status: "draft" | "reviewed";
  reviewed_at: string | null;
}

interface Entry {
  id: string;
  firm_id: string;
  item_key: string;
  grade: Grade | null;
  unit: string;
  rate_aed: number;
  kind: EntryKind;
  origin: "firm_entry" | "quote_import" | "promoted_correction";
  note?: string | null;
  quote_id?: string | null;
  superseded_at?: string | null;
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
const KIND_LABEL: Record<EntryKind, string> = { labour: "Labour", supply: "Supply", supply_and_install: "Supply & install", lump: "Lump" };
const BUILTIN_LABEL = { catalog: "built-in — catalogue SKU pick", labour_book: "built-in — labour book", allowance: "built-in — allowance", element_def: "built-in — element rate" } as const;

type ApiError = { error?: string; code?: string };

/** U4: one row of an item's trail (GET /api/firms/:id/rates/history). */
interface HistoryRow {
  id: string;
  grade: Grade | null;
  unit: string;
  rate_aed: number;
  kind: EntryKind;
  origin: Entry["origin"];
  correction_id: string | null;
  quote_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  superseded_at: string | null;
  superseded_by: string | null;
  retired_by: string | null;
  retire_reason: string | null;
}
const ORIGIN_LABEL: Record<Entry["origin"], string> = { firm_entry: "typed", quote_import: "from a quotation", promoted_correction: "promoted correction" };
/** Only a typed rate's figures may be edited; a promoted or imported rate is its record's figure (U4 origin guard). */
const isLocked = (e: { origin: Entry["origin"] }) => e.origin !== "firm_entry";

/** Turn an API failure into the inline messages the form shows. */
function inlineErrors(status: number, body: ApiError): string[] {
  if (status === 422 && body.error) return body.error.split(/;\s*/).filter(Boolean);
  if (status === 409 && body.code === "entry_locked") return [body.error ?? "This rate's figures come from its record and cannot be edited here."];
  if (status === 409 && body.code === "entry_retired") return ["This entry is already history."];
  if (status === 409) return ["There is already an entry for this item at this grade — edit that one instead."];
  if (status === 401) return ["Your session has ended — sign in again."];
  if (status === 403) return ["You are no longer a member of this firm."];
  return [body.error ?? `The request failed (${status}).`];
}

export function FirmBookEditor({ initialFirm, initialEntries }: { initialFirm: FirmSummary; initialEntries: Entry[] }) {
  const firmId = initialFirm.id;
  const [firm, setFirm] = useState<FirmSummary>(initialFirm);
  const [entries, setEntries] = useState<Entry[]>(initialEntries);
  const [vocab, setVocab] = useState<VocabularyItem[] | null>(null);
  const [vocabError, setVocabError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  // --- vocabulary ------------------------------------------------------------
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
  const sections = useMemo(() => groupBySection(vocab ?? []), [vocab]);

  async function refresh() {
    const [f, e] = await Promise.all([
      fetch(`/api/firms/${firmId}`).then((r) => r.json() as Promise<{ firm?: FirmSummary }>),
      fetch(`/api/firms/${firmId}/rates`).then((r) => r.json() as Promise<{ entries?: Entry[] }>),
    ]);
    if (f.firm) setFirm(f.firm);
    if (e.entries) setEntries(e.entries);
  }

  // --- OH&P + status -----------------------------------------------------------
  const [ohp, setOhp] = useState(String(initialFirm.ohp_pct));
  const [ohpError, setOhpError] = useState<string | null>(null);
  const [ohpSaving, setOhpSaving] = useState(false);
  async function saveOhp() {
    const n = Number(ohp);
    if (!Number.isFinite(n) || n < 0 || n > 50) {
      setOhpError("OH&P must be a percentage between 0 and 50.");
      return;
    }
    setOhpSaving(true);
    setOhpError(null);
    try {
      const res = await fetch(`/api/firms/${firmId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ohp_pct: n }) });
      const body = (await res.json().catch(() => ({}))) as { firm?: FirmSummary } & ApiError;
      if (!res.ok || !body.firm) {
        setOhpError(inlineErrors(res.status, body).join(" "));
        return;
      }
      setFirm(body.firm);
    } finally {
      setOhpSaving(false);
    }
  }
  const [statusSaving, setStatusSaving] = useState(false);
  async function setStatus(status: "draft" | "reviewed") {
    setStatusSaving(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/firms/${firmId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
      const body = (await res.json().catch(() => ({}))) as { firm?: FirmSummary } & ApiError;
      if (!res.ok || !body.firm) {
        setBanner(inlineErrors(res.status, body).join(" "));
        return;
      }
      setFirm(body.firm);
    } finally {
      setStatusSaving(false);
    }
  }

  // --- add entry ---------------------------------------------------------------
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [draftErrors, setDraftErrors] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const draftItem = byKey.get(draft.item_key) ?? null;
  function pickItem(item_key: string) {
    const v = byKey.get(item_key);
    setDraft((d) => ({
      ...d,
      item_key,
      unit: v?.unit ?? d.unit,
      kind: v && !v.kinds.includes(d.kind) ? v.default_kind : d.kind,
    }));
    setDraftErrors([]);
  }
  const liveErrors = useMemo(() => {
    if (!draft.item_key) return [];
    return validateDraftAgainst(draftItem, { item_key: draft.item_key, unit: draft.unit, kind: draft.kind, rate_aed: Number(draft.rate_aed) });
  }, [draft, draftItem]);
  async function add() {
    const errs = [...(draft.item_key ? [] : ["Choose an item."]), ...(draft.rate_aed.trim() === "" ? ["Enter a rate."] : []), ...liveErrors];
    if (errs.length) {
      setDraftErrors(errs);
      return;
    }
    setAdding(true);
    setDraftErrors([]);
    try {
      const res = await fetch(`/api/firms/${firmId}/rates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          item_key: draft.item_key,
          grade: draft.grade || null,
          unit: draft.unit,
          kind: draft.kind,
          rate_aed: Number(draft.rate_aed),
          note: draft.note.trim() || null,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { entry?: Entry } & ApiError;
      if (!res.ok || !body.entry) {
        setDraftErrors(inlineErrors(res.status, body));
        return;
      }
      setDraft(EMPTY);
      await refresh();
    } finally {
      setAdding(false);
    }
  }

  // --- edit / delete -------------------------------------------------------------
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ rate_aed: string; kind: EntryKind; grade: Grade | ""; note: string }>({ rate_aed: "", kind: "labour", grade: "", note: "" });
  const [editErrors, setEditErrors] = useState<string[]>([]);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  function startEdit(e: Entry) {
    setEditing(e.id);
    setEdit({ rate_aed: String(e.rate_aed), kind: e.kind, grade: e.grade ?? "", note: e.note ?? "" });
    setEditErrors([]);
  }
  async function saveEdit(e: Entry) {
    const item = byKey.get(e.item_key) ?? null;
    const errs = validateDraftAgainst(item, { item_key: e.item_key, unit: e.unit, kind: edit.kind, rate_aed: Number(edit.rate_aed) });
    if (edit.rate_aed.trim() === "") errs.unshift("Enter a rate.");
    if (errs.length) {
      setEditErrors(errs);
      return;
    }
    setRowBusy(e.id);
    setEditErrors([]);
    try {
      const res = await fetch(`/api/firms/${firmId}/rates/${e.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rate_aed: Number(edit.rate_aed), kind: edit.kind, grade: edit.grade || null, note: edit.note.trim() || null }),
      });
      const body = (await res.json().catch(() => ({}))) as { entry?: Entry } & ApiError;
      if (!res.ok || !body.entry) {
        setEditErrors(inlineErrors(res.status, body));
        return;
      }
      setEditing(null);
      await refresh();
    } finally {
      setRowBusy(null);
    }
  }
  // U4: the trail of one item — every entry ever made for it, active and retired.
  const [history, setHistory] = useState<Record<string, HistoryRow[] | "loading" | "error">>({});
  const [actors, setActors] = useState<Record<string, string>>({});
  async function toggleHistory(itemKey: string) {
    if (history[itemKey]) {
      setHistory((h) => {
        const { [itemKey]: _closed, ...rest } = h;
        void _closed;
        return rest;
      });
      return;
    }
    setHistory((h) => ({ ...h, [itemKey]: "loading" }));
    try {
      const res = await fetch(`/api/firms/${firmId}/rates/history?item_key=${encodeURIComponent(itemKey)}`);
      const body = (await res.json().catch(() => ({}))) as { history?: HistoryRow[]; actors?: Record<string, string> } & ApiError;
      if (!res.ok || !body.history) {
        setHistory((h) => ({ ...h, [itemKey]: "error" }));
        return;
      }
      setActors((a) => ({ ...a, ...(body.actors ?? {}) }));
      setHistory((h) => ({ ...h, [itemKey]: body.history! }));
    } catch {
      setHistory((h) => ({ ...h, [itemKey]: "error" }));
    }
  }

  // U4: RETIRE, never delete — the entry stays in the book's history and stops pricing.
  async function remove(e: Entry) {
    if (!window.confirm(`Retire the ${e.item_key}${e.grade ? ` / ${e.grade}` : ""} rate? It stays in the book's history and stops pricing; projects priced by this book fall back to what it shadows.${e.origin === "promoted_correction" ? " The correction it came from can be promoted again." : ""}`)) return;
    setRowBusy(e.id);
    setBanner(null);
    try {
      const res = await fetch(`/api/firms/${firmId}/rates/${e.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ApiError;
        setBanner(inlineErrors(res.status, body).join(" "));
        return;
      }
      await refresh();
    } finally {
      setRowBusy(null);
    }
  }

  // --- render ----------------------------------------------------------------------
  const reviewed = firm.status === "reviewed";
  return (
    <div className="space-y-lg" data-firm-id={firmId}>
      <header className="flex flex-wrap items-end justify-between gap-md">
        <div>
          <p className="label-caps text-ink-500">
            <Link href="/firms" className="focus-ring hover:text-brass-600">
              Rate books
            </Link>{" "}
            / firm
          </p>
          <h1 className="font-display text-headline-lg text-ink-900">{firm.name}</h1>
          <p className="mt-xs text-body-sm text-ink-700">
            {firm.entry_count} {firm.entry_count === 1 ? "entry" : "entries"} · OH&amp;P {firm.ohp_pct}% · {firm.private ? "private" : "shared"} book
          </p>
        </div>
        <div className="flex items-center gap-sm" data-testid="book-status">
          <span
            className={[
              "label-caps rounded-full border px-sm py-[3px]",
              reviewed ? "border-brass-600 bg-brass-600/10 text-brass-600" : "border-ink-100 bg-canvas text-ink-500",
            ].join(" ")}
          >
            {reviewed ? "Reviewed" : "Draft"}
          </span>
          {reviewed && firm.reviewed_at && <span className="font-mono text-[12px] text-ink-500">{new Date(firm.reviewed_at).toLocaleDateString("en-GB")}</span>}
          <button
            type="button"
            onClick={() => setStatus(reviewed ? "draft" : "reviewed")}
            disabled={statusSaving}
            className="focus-ring rounded-lg border border-ink-100 bg-paper px-sm py-xs text-body-sm text-ink-700 hover:border-brass-600 disabled:opacity-50"
          >
            {reviewed ? "Back to draft" : "Mark reviewed"}
          </button>
        </div>
      </header>

      {banner && (
        <p role="alert" className="rounded-lg border border-error/40 bg-error/5 px-md py-sm text-body-sm text-error">
          {banner}
        </p>
      )}

      <p className="text-body-sm text-ink-500">
        A book is a draft until a member marks it reviewed; any later change — an entry, the OH&amp;P — puts it back to draft. Status changes nothing
        about pricing; the export gate reads it.
      </p>

      {/* OH&P */}
      <section className="rounded-xl border border-ink-100 bg-paper p-md" aria-label="Overheads and profit">
        <p className="label-caps text-ink-500">Overheads &amp; profit</p>
        <div className="mt-sm flex flex-wrap items-center gap-sm">
          <label className="flex items-center gap-xs text-body-sm text-ink-700">
            <span>OH&amp;P</span>
            <input
              value={ohp}
              onChange={(e) => {
                setOhp(e.target.value);
                setOhpError(null);
              }}
              inputMode="decimal"
              aria-label="OH&P percent"
              aria-invalid={!!ohpError}
              className="focus-ring w-20 rounded border border-ink-100 bg-paper px-sm py-xs text-right font-mono text-body-sm tabular-nums text-ink-900"
            />
            <span>%</span>
          </label>
          <button type="button" onClick={saveOhp} disabled={ohpSaving} className="focus-ring rounded-lg bg-brass-600 px-md py-xs text-body-sm font-semibold text-white disabled:opacity-50">
            {ohpSaving ? "Saving…" : "Save OH&P"}
          </button>
          <span className="text-body-sm text-ink-500">Applied once at BoQ assembly as its own line — never inside a rate. 0–50%.</span>
        </div>
        {ohpError && (
          <p role="alert" className="mt-xs text-body-sm text-error">
            {ohpError}
          </p>
        )}
      </section>

      {/* Entries */}
      <section className="rounded-xl border border-ink-100 bg-paper p-md" aria-label="Rate entries">
        <p className="label-caps text-ink-500">Entries — your rate beside what it shadows</p>
        {entries.length === 0 ? (
          <p className="mt-sm text-body-md text-ink-700">No entries yet. Every item this firm does not price falls back to what it shadows.</p>
        ) : (
          <table className="mt-sm w-full text-body-sm" data-testid="entries">
            <thead>
              <tr className="label-caps text-left text-ink-500">
                <th className="py-xs pr-sm font-normal">Item</th>
                <th className="py-xs pr-sm font-normal">Grade</th>
                <th className="py-xs pr-sm font-normal">Kind</th>
                <th className="py-xs pr-sm text-right font-normal">Your rate</th>
                <th className="py-xs pr-sm text-right font-normal">Shadows</th>
                <th className="py-xs font-normal"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {entries.map((e) => {
                const v = byKey.get(e.item_key);
                const ref = v?.reference;
                const isEditing = editing === e.id;
                const trail = history[e.item_key];
                return (
                  <Fragment key={e.id}>
                  <tr data-entry-id={e.id} data-item-key={e.item_key} className="align-top">
                    <td className="py-sm pr-sm">
                      <div className="text-ink-900">{v?.label ?? e.item_key}</div>
                      <div className="font-mono text-[12px] text-ink-500">
                        {e.item_key} · {e.unit}
                        {e.origin === "promoted_correction" && " · promoted correction"}
                        {e.origin === "quote_import" && " · from a quotation"}
                      </div>
                      {e.note && <div className="text-[12px] text-ink-500">{e.note}</div>}
                    </td>
                    <td className="py-sm pr-sm">
                      {isEditing ? (
                        <select value={edit.grade} onChange={(ev) => setEdit((d) => ({ ...d, grade: ev.target.value as Grade | "" }))} className="focus-ring rounded border border-ink-100 bg-paper px-xs py-[3px] text-body-sm">
                          <option value="">all grades</option>
                          <option value="economy">economy</option>
                          <option value="standard">standard</option>
                          <option value="premium">premium</option>
                        </select>
                      ) : (
                        <span className="text-ink-700">{e.grade ?? "all grades"}</span>
                      )}
                    </td>
                    <td className="py-sm pr-sm">
                      {isEditing ? (
                        <select value={edit.kind} onChange={(ev) => setEdit((d) => ({ ...d, kind: ev.target.value as EntryKind }))} className="focus-ring rounded border border-ink-100 bg-paper px-xs py-[3px] text-body-sm">
                          {(v?.kinds ?? ENTRY_KINDS).map((k) => (
                            <option key={k} value={k}>
                              {KIND_LABEL[k]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-ink-700">{KIND_LABEL[e.kind]}</span>
                      )}
                    </td>
                    <td className="py-sm pr-sm text-right">
                      {isEditing ? (
                        <input
                          value={edit.rate_aed}
                          onChange={(ev) => setEdit((d) => ({ ...d, rate_aed: ev.target.value }))}
                          inputMode="decimal"
                          aria-label="Rate AED"
                          className="focus-ring w-24 rounded border border-ink-100 bg-paper px-xs py-[3px] text-right font-mono text-body-sm tabular-nums"
                        />
                      ) : (
                        <span className="font-mono tabular-nums text-ink-900">
                          <Figure value={e.rate_aed} format="rate" /> / {e.unit}
                        </span>
                      )}
                    </td>
                    <td className="py-sm pr-sm text-right">
                      {!ref || ref.kind === "none" ? (
                        <span className="text-ink-500">no reference rate</span>
                      ) : ref.kind === "market" ? (
                        <span className="font-mono tabular-nums text-ink-700" title={`market reference · ${ref.provenance}${ref.grade ? ` · ${ref.grade}` : ""}`}>
                          <Figure value={ref.rate_aed} format="rate" /> / {ref.unit}
                          <span className="ml-xs font-sans text-[12px] text-ink-500">market reference</span>
                        </span>
                      ) : (
                        <span className="text-[12px] text-ink-500">{BUILTIN_LABEL[ref.how]}</span>
                      )}
                    </td>
                    <td className="py-sm text-right whitespace-nowrap">
                      {isEditing ? (
                        <>
                          <button type="button" onClick={() => saveEdit(e)} disabled={rowBusy === e.id} className="focus-ring rounded-lg bg-brass-600 px-sm py-[3px] text-[12px] font-semibold text-white disabled:opacity-50">
                            Save
                          </button>
                          <button type="button" onClick={() => setEditing(null)} className="focus-ring ml-xs rounded-lg border border-ink-100 px-sm py-[3px] text-[12px] text-ink-700">
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          {isLocked(e) ? (
                            <span className="material-symbols-outlined text-[18px] text-ink-100" aria-label={`${e.item_key} is a ${ORIGIN_LABEL[e.origin]} — its figures cannot be edited`} title="Figures come from the record this rate cites">
                              lock
                            </span>
                          ) : (
                            <button type="button" onClick={() => startEdit(e)} aria-label={`Edit ${e.item_key}`} className="focus-ring material-symbols-outlined text-[18px] text-ink-500 hover:text-brass-600">
                              edit
                            </button>
                          )}
                          <button type="button" onClick={() => toggleHistory(e.item_key)} aria-label={`History of ${e.item_key}`} aria-expanded={!!trail} className="focus-ring material-symbols-outlined ml-xs text-[18px] text-ink-500 hover:text-brass-600">
                            history
                          </button>
                          <button type="button" onClick={() => remove(e)} disabled={rowBusy === e.id} aria-label={`Retire ${e.item_key}`} title="Retire — kept in the book's history, stops pricing" className="focus-ring material-symbols-outlined ml-xs text-[18px] text-ink-500 hover:text-error disabled:opacity-50">
                            archive
                          </button>
                        </>
                      )}
                      {isEditing && editErrors.length > 0 && (
                        <ul role="alert" className="mt-xs text-left text-[12px] text-error" data-testid="edit-errors">
                          {editErrors.map((m) => (
                            <li key={m}>{m}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                  {trail && (
                    <tr data-history-for={e.item_key}>
                      <td colSpan={6} className="bg-canvas px-sm py-sm">
                        {trail === "loading" ? (
                          <p className="text-[12px] text-ink-500">Loading the trail…</p>
                        ) : trail === "error" ? (
                          <p role="alert" className="text-[12px] text-error">
                            The trail could not be loaded.
                          </p>
                        ) : (
                          <table className="w-full text-[12px]" data-testid="entry-history">
                            <thead>
                              <tr className="label-caps text-left text-ink-500">
                                <th className="py-xs pr-sm font-normal">When</th>
                                <th className="py-xs pr-sm font-normal">Rate</th>
                                <th className="py-xs pr-sm font-normal">Origin</th>
                                <th className="py-xs pr-sm font-normal">By</th>
                                <th className="py-xs font-normal">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-ink-100">
                              {trail.map((h) => (
                                <tr key={h.id} data-history-id={h.id} data-active={!h.superseded_at}>
                                  <td className="py-xs pr-sm font-mono text-ink-700">{h.created_at.slice(0, 16).replace("T", " ")}</td>
                                  <td className="py-xs pr-sm font-mono tabular-nums text-ink-900">
                                    <Figure value={h.rate_aed} format="rate" /> / {h.unit}
                                    {h.grade ? <span className="ml-xs text-ink-500">{h.grade}</span> : null}
                                  </td>
                                  <td className="py-xs pr-sm text-ink-700">
                                    {ORIGIN_LABEL[h.origin]}
                                    {h.note ? <span className="text-ink-500"> — {h.note}</span> : null}
                                  </td>
                                  <td className="py-xs pr-sm text-ink-700">{h.created_by ? actors[h.created_by] ?? "a member" : "—"}</td>
                                  <td className="py-xs text-ink-700">
                                    {h.superseded_at ? (
                                      <>
                                        retired {h.superseded_at.slice(0, 10)}
                                        {h.retired_by ? ` by ${actors[h.retired_by] ?? "a member"}` : ""}
                                        {h.retire_reason ? ` — ${h.retire_reason}` : ""}
                                        {h.superseded_by ? " · replaced" : ""}
                                      </>
                                    ) : (
                                      <span className="font-semibold text-brass-600">active</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* Add entry */}
      <section className="rounded-xl border border-ink-100 bg-paper p-md" aria-label="Add a rate entry">
        <p className="label-caps text-ink-500">Add an entry</p>
        {vocabError && (
          <p role="alert" className="mt-xs text-body-sm text-error">
            {vocabError}
          </p>
        )}
        <div className="mt-sm grid grid-cols-1 gap-sm md:grid-cols-6">
          <label className="md:col-span-3">
            <span className="label-caps text-ink-500">Item</span>
            <select
              value={draft.item_key}
              onChange={(e) => pickItem(e.target.value)}
              aria-label="Item"
              className="focus-ring mt-xs w-full rounded border border-ink-100 bg-paper px-sm py-xs text-body-sm text-ink-900"
              disabled={!vocab}
            >
              <option value="">{vocab ? "Choose an item the take-off prices…" : "Loading vocabulary…"}</option>
              {sections.map((s) => (
                <optgroup key={s.section} label={s.section}>
                  {s.items.map((it) => (
                    <option key={it.item_key} value={it.item_key}>
                      {it.label} ({it.item_key}{it.unit ? ` · ${it.unit}` : ""})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label>
            <span className="label-caps text-ink-500">Grade</span>
            <select value={draft.grade} onChange={(e) => setDraft((d) => ({ ...d, grade: e.target.value as Grade | "" }))} aria-label="Grade" className="focus-ring mt-xs w-full rounded border border-ink-100 bg-paper px-sm py-xs text-body-sm">
              <option value="">all grades</option>
              <option value="economy">economy</option>
              <option value="standard">standard</option>
              <option value="premium">premium</option>
            </select>
          </label>
          <label>
            <span className="label-caps text-ink-500">Unit</span>
            <input
              value={draft.unit}
              onChange={(e) => setDraft((d) => ({ ...d, unit: e.target.value }))}
              aria-label="Unit"
              readOnly={!!draftItem?.unit}
              placeholder="m2"
              className={["focus-ring mt-xs w-full rounded border border-ink-100 px-sm py-xs font-mono text-body-sm", draftItem?.unit ? "bg-canvas text-ink-500" : "bg-paper text-ink-900"].join(" ")}
            />
          </label>
          <label>
            <span className="label-caps text-ink-500">Kind</span>
            <select value={draft.kind} onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value as EntryKind }))} aria-label="Kind" className="focus-ring mt-xs w-full rounded border border-ink-100 bg-paper px-sm py-xs text-body-sm">
              {(draftItem?.kinds ?? ENTRY_KINDS).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="md:col-span-2">
            <span className="label-caps text-ink-500">Rate (AED per unit)</span>
            <input
              value={draft.rate_aed}
              onChange={(e) => setDraft((d) => ({ ...d, rate_aed: e.target.value }))}
              inputMode="decimal"
              aria-label="Rate AED"
              placeholder="0.00"
              className="focus-ring mt-xs w-full rounded border border-ink-100 bg-paper px-sm py-xs text-right font-mono text-body-sm tabular-nums text-ink-900"
            />
          </label>
          <label className="md:col-span-3">
            <span className="label-caps text-ink-500">Note (optional)</span>
            <input value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} aria-label="Note" className="focus-ring mt-xs w-full rounded border border-ink-100 bg-paper px-sm py-xs text-body-sm text-ink-900" />
          </label>
          <div className="flex items-end md:col-span-1">
            <button type="button" onClick={add} disabled={adding || !vocab} className="focus-ring w-full rounded-lg bg-brass-600 px-md py-xs text-body-sm font-semibold text-white disabled:opacity-50">
              {adding ? "Adding…" : "Add entry"}
            </button>
          </div>
        </div>
        {draftItem && (
          <p className="mt-xs text-[12px] text-ink-500">
            Shadows:{" "}
            {draftItem.reference.kind === "market" ? (
              <>
                market reference <span className="font-mono tabular-nums">AED {draftItem.reference.rate_aed} / {draftItem.reference.unit}</span>
              </>
            ) : draftItem.reference.kind === "builtin" ? (
              BUILTIN_LABEL[draftItem.reference.how]
            ) : (
              "no reference rate (a QS-to-price item)"
            )}
            {" · "}accepts {draftItem.kinds.map((k) => KIND_LABEL[k]).join(" / ")}
          </p>
        )}
        {(draftErrors.length > 0 || (draft.item_key && liveErrors.length > 0)) && (
          <ul role="alert" className="mt-xs text-body-sm text-error" data-testid="add-errors">
            {(draftErrors.length ? draftErrors : liveErrors).map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
