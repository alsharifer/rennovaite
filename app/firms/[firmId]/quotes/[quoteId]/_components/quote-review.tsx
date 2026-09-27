"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Figure } from "@/components/figures/Figure";
import { ENTRY_KINDS, groupBySection, type EntryKind, type VocabularyItem } from "@/lib/firms/vocabulary-client";

// =============================================================================
// U3 — the review screen. Every line the sheet had, with its suggested item,
// for a member to confirm or reject; matched lines show the rate that would
// enter the book (derived from the quote's terms) beside what it shadows;
// unmatched lines are held, visibly, with the reason. "Accept" is the only
// action that creates rates. Fetches only /api/firms/${firmId}/quotes/… and the
// vocabulary.
// =============================================================================

type Grade = "economy" | "standard" | "premium";
interface Quote {
  id: string;
  supplier_label: string;
  supplier_role: string;
  quote_ref?: string | null;
  quote_date?: string | null;
  valid_until?: string | null;
  currency: string;
  vat_treatment: "excl" | "incl" | "unknown";
  rates_are: "net" | "list";
  discount_pct: number;
  source_filename?: string | null;
  status: "review" | "accepted" | "superseded";
  version: number;
  supersedes_quote_id?: string | null;
  accepted_at?: string | null;
}
interface Line {
  id: string;
  row_no: number;
  description: string;
  item_key_given: string | null;
  suggested_item_key: string | null;
  suggestion_score: number | null;
  item_key: string | null;
  grade: Grade | null;
  kind: EntryKind | null;
  qty: number | null;
  unit: string | null;
  rate_raw: number | null;
  currency: string | null;
  rate_aed: number | null;
  status: "matched" | "unmatched" | "rejected" | "accepted";
  hold_reason: string | null;
  entry_id: string | null;
}

const KIND_LABEL: Record<EntryKind, string> = { labour: "Labour", supply: "Supply", supply_and_install: "Supply & install", lump: "Lump" };
const STATUS: Record<Line["status"], { label: string; cls: string }> = {
  matched: { label: "Matched", cls: "border-brass-600 text-brass-600" },
  unmatched: { label: "Held", cls: "border-ink-100 text-ink-500" },
  rejected: { label: "Rejected", cls: "border-ink-100 text-ink-500 line-through" },
  accepted: { label: "In book", cls: "border-brass-600 bg-brass-600/10 text-brass-600" },
};

export function QuoteReview({ firmId, initialQuote, initialLines }: { firmId: string; initialQuote: Quote; initialLines: Line[] }) {
  const [quote, setQuote] = useState(initialQuote);
  const [lines, setLines] = useState(initialLines);
  const [vocab, setVocab] = useState<VocabularyItem[] | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ accepted: number; held: number; rejected: number; superseded: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/rate-vocabulary")
      .then((r) => r.json() as Promise<{ items?: VocabularyItem[] }>)
      .then((b) => !cancelled && setVocab(b.items ?? []))
      .catch(() => !cancelled && setVocab([]));
    return () => {
      cancelled = true;
    };
  }, []);
  const byKey = useMemo(() => new Map((vocab ?? []).map((v) => [v.item_key, v])), [vocab]);
  const sections = useMemo(() => groupBySection(vocab ?? []), [vocab]);
  const readOnly = quote.status !== "review";
  // Cheap enough to derive every render (a quote has tens of lines, not thousands).
  const counts = {
    matched: lines.filter((l) => l.status === "matched").length,
    unmatched: lines.filter((l) => l.status === "unmatched").length,
    rejected: lines.filter((l) => l.status === "rejected").length,
    accepted: lines.filter((l) => l.status === "accepted").length,
    suggested: lines.filter((l) => l.status === "unmatched" && !l.item_key && l.suggested_item_key && (l.suggestion_score ?? 0) >= 0.5).length,
  };

  async function refresh() {
    const b = (await fetch(`/api/firms/${firmId}/quotes/${quote.id}`).then((r) => r.json())) as { quote?: Quote; lines?: Line[] };
    if (b.quote) setQuote(b.quote);
    if (b.lines) setLines(b.lines);
  }
  async function patch(line: Line, body: Record<string, unknown>) {
    setBusy(line.id);
    setBanner(null);
    try {
      const res = await fetch(`/api/firms/${firmId}/quotes/${quote.id}/lines/${line.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const b = (await res.json().catch(() => ({}))) as { line?: Line; error?: string };
      if (!res.ok || !b.line) {
        setBanner(b.error ?? `Update failed (${res.status}).`);
        return;
      }
      setLines((ls) => ls.map((l) => (l.id === b.line!.id ? b.line! : l)));
    } finally {
      setBusy(null);
    }
  }
  async function act(action: "confirm_suggestions" | "accept") {
    if (action === "accept" && !window.confirm(`Accept this quotation? ${counts.matched} matched line(s) become rates in the book; ${counts.unmatched} held and ${counts.rejected} rejected line(s) stay on the record.`)) return;
    setBusy(action);
    setBanner(null);
    try {
      const res = await fetch(`/api/firms/${firmId}/quotes/${quote.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      const b = (await res.json().catch(() => ({}))) as { error?: string; accepted?: number; held?: number; rejected?: number; superseded?: number; confirmed?: number };
      if (!res.ok) {
        setBanner(b.error ?? `${action} failed (${res.status}).`);
        return;
      }
      if (action === "accept") setResult({ accepted: b.accepted ?? 0, held: b.held ?? 0, rejected: b.rejected ?? 0, superseded: b.superseded ?? 0 });
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  const terms = `${quote.currency} · ${quote.rates_are === "list" ? `list − ${quote.discount_pct}%` : "net"} · ${quote.vat_treatment === "incl" ? "incl. VAT (÷1.05)" : quote.vat_treatment === "excl" ? "excl. VAT" : "VAT not stated"}`;

  return (
    <div className="space-y-lg" data-quote-id={quote.id}>
      <header className="flex flex-wrap items-end justify-between gap-md">
        <div>
          <p className="label-caps text-ink-500">
            <Link href="/firms" className="focus-ring hover:text-brass-600">
              Rate books
            </Link>{" "}
            /{" "}
            <Link href={`/firms/${firmId}`} className="focus-ring hover:text-brass-600">
              firm
            </Link>{" "}
            / quotation
          </p>
          <h1 className="font-display text-headline-lg text-ink-900">
            {quote.supplier_label}
            {quote.quote_ref && <span className="ml-sm font-mono text-headline-md text-ink-500">{quote.quote_ref}</span>}
          </h1>
          <p className="mt-xs text-body-sm text-ink-700">
            {quote.supplier_role} · v{quote.version}
            {quote.quote_date && ` · dated ${quote.quote_date}`}
            {quote.valid_until && ` · valid to ${quote.valid_until}`} · {terms}
            {quote.source_filename && <span className="font-mono text-[12px] text-ink-500"> · {quote.source_filename}</span>}
          </p>
        </div>
        <div className="flex items-center gap-sm" data-testid="quote-status">
          <span className={["label-caps rounded-full border px-sm py-[3px]", quote.status === "accepted" ? "border-brass-600 bg-brass-600/10 text-brass-600" : "border-ink-100 bg-canvas text-ink-500"].join(" ")}>
            {quote.status === "review" ? "In review" : quote.status === "accepted" ? "Accepted" : "Superseded"}
          </span>
        </div>
      </header>

      {banner && (
        <p role="alert" className="rounded-lg border border-error/40 bg-error/5 px-md py-sm text-body-sm text-error">
          {banner}
        </p>
      )}
      {result && (
        <p role="status" className="rounded-lg border border-brass-600/40 bg-brass-600/5 px-md py-sm text-body-sm text-ink-900" data-testid="accept-result">
          Accepted: <strong>{result.accepted}</strong> rate{result.accepted === 1 ? "" : "s"} entered the book
          {result.superseded > 0 && <> (replacing {result.superseded} earlier import{result.superseded === 1 ? "" : "s"}, kept as history)</>}; <strong>{result.held}</strong> held, <strong>{result.rejected}</strong> rejected — still on this record.
        </p>
      )}

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-sm">
          <button type="button" onClick={() => act("confirm_suggestions")} disabled={!!busy || counts.suggested === 0} className="focus-ring rounded-lg border border-ink-100 bg-paper px-md py-xs text-body-sm text-ink-700 hover:border-brass-600 disabled:opacity-50">
            Confirm {counts.suggested} suggestion{counts.suggested === 1 ? "" : "s"} scoring ≥ 0.5
          </button>
          <button type="button" onClick={() => act("accept")} disabled={!!busy || counts.matched === 0} className="focus-ring rounded-lg bg-brass-600 px-md py-xs text-body-sm font-semibold text-white disabled:opacity-50">
            Accept quotation — {counts.matched} matched line{counts.matched === 1 ? "" : "s"} → book
          </button>
          <span className="text-body-sm text-ink-500">
            {counts.unmatched} held · {counts.rejected} rejected. Held lines never enter the book; they stay here.
          </span>
        </div>
      )}

      <section className="rounded-xl border border-ink-100 bg-paper p-md" aria-label="Quotation lines">
        <table className="w-full text-body-sm" data-testid="quote-lines">
          <thead>
            <tr className="label-caps text-left text-ink-500">
              <th className="py-xs pr-sm font-normal">#</th>
              <th className="py-xs pr-sm font-normal">Quoted line</th>
              <th className="py-xs pr-sm text-right font-normal">Quoted</th>
              <th className="py-xs pr-sm font-normal">Item (confirm)</th>
              <th className="py-xs pr-sm font-normal">Grade · kind</th>
              <th className="py-xs pr-sm text-right font-normal">Enters book as</th>
              <th className="py-xs pr-sm text-right font-normal">Shadows</th>
              <th className="py-xs font-normal">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {lines.map((l) => {
              const v = l.item_key ? byKey.get(l.item_key) : null;
              const ref = v?.reference;
              const st = STATUS[l.status];
              return (
                <tr key={l.id} data-line-id={l.id} data-status={l.status} className="align-top">
                  <td className="py-sm pr-sm font-mono text-[12px] text-ink-500">{l.row_no}</td>
                  <td className="py-sm pr-sm">
                    <div className="text-ink-900">{l.description}</div>
                    <div className="font-mono text-[12px] text-ink-500">
                      {l.qty != null && `${l.qty} `}
                      {l.unit ?? "—"}
                      {l.item_key_given && ` · key given: ${l.item_key_given}`}
                    </div>
                  </td>
                  <td className="py-sm pr-sm text-right font-mono tabular-nums text-ink-700">
                    {l.rate_raw != null ? `${l.rate_raw} ${l.currency ?? quote.currency}` : <span className="text-ink-500">—</span>}
                  </td>
                  <td className="py-sm pr-sm">
                    {readOnly ? (
                      <span className="font-mono text-[12px] text-ink-900">{l.item_key ?? "—"}</span>
                    ) : (
                      <>
                        <select
                          value={l.item_key ?? ""}
                          onChange={(e) => patch(l, { item_key: e.target.value || null })}
                          disabled={!vocab || busy === l.id || l.status === "rejected"}
                          aria-label={`Item for row ${l.row_no}`}
                          className="focus-ring w-full max-w-[320px] rounded border border-ink-100 bg-paper px-xs py-[3px] text-[12px]"
                        >
                          <option value="">{l.suggested_item_key ? "— confirm the suggestion or pick —" : "— pick an item —"}</option>
                          {sections.map((s) => (
                            <optgroup key={s.section} label={s.section}>
                              {s.items.map((it) => (
                                <option key={it.item_key} value={it.item_key}>
                                  {it.label} ({it.item_key})
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        {l.suggested_item_key && !l.item_key && l.status !== "rejected" && (
                          <button type="button" onClick={() => patch(l, { item_key: l.suggested_item_key })} disabled={busy === l.id} className="focus-ring mt-xs block text-[12px] text-brass-600 hover:underline" data-testid="confirm-suggestion">
                            Suggested: <span className="font-mono">{l.suggested_item_key}</span> ({Math.round((l.suggestion_score ?? 0) * 100)}%) — confirm
                          </button>
                        )}
                      </>
                    )}
                  </td>
                  <td className="py-sm pr-sm">
                    {readOnly || !l.item_key ? (
                      <span className="text-ink-700">
                        {l.grade ?? "all grades"}
                        {l.kind && ` · ${KIND_LABEL[l.kind]}`}
                      </span>
                    ) : (
                      <div className="flex flex-col gap-xs">
                        <select value={l.grade ?? ""} onChange={(e) => patch(l, { grade: (e.target.value || null) as Grade | null })} aria-label={`Grade for row ${l.row_no}`} className="focus-ring rounded border border-ink-100 bg-paper px-xs py-[3px] text-[12px]">
                          <option value="">all grades</option>
                          <option value="economy">economy</option>
                          <option value="standard">standard</option>
                          <option value="premium">premium</option>
                        </select>
                        <select value={l.kind ?? ""} onChange={(e) => patch(l, { kind: (e.target.value || null) as EntryKind | null })} aria-label={`Kind for row ${l.row_no}`} className="focus-ring rounded border border-ink-100 bg-paper px-xs py-[3px] text-[12px]">
                          {(v?.kinds ?? ENTRY_KINDS).map((k) => (
                            <option key={k} value={k}>
                              {KIND_LABEL[k]}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </td>
                  <td className="py-sm pr-sm text-right">
                    {l.rate_aed != null ? (
                      <span className="font-mono tabular-nums text-ink-900">
                        <Figure value={l.rate_aed} format="rate" /> / {l.unit ?? v?.unit ?? "?"}
                      </span>
                    ) : (
                      <span className="text-ink-500">—</span>
                    )}
                  </td>
                  <td className="py-sm pr-sm text-right">
                    {!ref || ref.kind === "none" ? (
                      <span className="text-[12px] text-ink-500">{l.item_key ? "no reference rate" : ""}</span>
                    ) : ref.kind === "market" ? (
                      <span className="font-mono tabular-nums text-ink-700">
                        <Figure value={ref.rate_aed} format="rate" /> / {ref.unit}
                        <span className="ml-xs font-sans text-[12px] text-ink-500">market reference</span>
                      </span>
                    ) : (
                      <span className="text-[12px] text-ink-500">built-in interior pricing</span>
                    )}
                  </td>
                  <td className="py-sm">
                    <span className={`label-caps inline-block rounded-full border px-sm py-[2px] ${st.cls}`}>{st.label}</span>
                    {l.hold_reason && l.status !== "accepted" && (
                      <div className="mt-xs max-w-[220px] text-[12px] text-error" data-testid="hold-reason">
                        {l.hold_reason}
                      </div>
                    )}
                    {!readOnly && l.status !== "rejected" && (
                      <button type="button" onClick={() => patch(l, { status: "rejected" })} disabled={busy === l.id} className="focus-ring mt-xs block text-[12px] text-ink-500 hover:text-error">
                        reject line
                      </button>
                    )}
                    {!readOnly && l.status === "rejected" && (
                      <button type="button" onClick={() => patch(l, { status: "unmatched" })} disabled={busy === l.id} className="focus-ring mt-xs block text-[12px] text-ink-500 hover:text-brass-600">
                        restore
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
