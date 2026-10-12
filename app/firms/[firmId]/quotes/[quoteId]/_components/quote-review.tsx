"use client";

// =============================================================================
// Quote import review (K4, R7 §3.4, frame 20:263) — pre-accept review of one
// quotation, line by line, BEFORE anything enters the book.
//
// Each line gets one status, derived from the store's own assessment (U3 / H8):
//   READY · CONFIRM MATCH · HELD · OUTLIER · HELD · UNIT CHECK · HELD · CURRENCY
//   · HELD · NOT A NUMBER · NO MATCH · REJECTED · IN BOOK
// with the action that resolves it. "Add N ready lines to the book" (accept)
// is the only action that creates rates; held and unmatched lines stay on the
// record. Keeping an outlier as quoted is an explicit, recorded confirmation.
// Fetches only /api/firms/${firmId}/quotes/… and the vocabulary (page-privacy
// test).
// =============================================================================

import { useEffect, useId, useMemo, useState } from "react";

import { Button } from "@/components/blueprint/Button";
import { Icon } from "@/components/blueprint/Icon";
import { ProvenanceMark } from "@/components/blueprint/ProvenanceMark";
import { TopBarActions } from "@/components/blueprint/shell/TopBar";
import { formatAED, formatQty, formatRatio } from "@/lib/format/aed";
import { ENTRY_KINDS, groupBySection, type EntryKind, type VocabularyItem } from "@/lib/firms/vocabulary-client";

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
  source_sha256?: string | null;
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
  unit_given?: string | null;
  magnitude_ratio?: number | null;
  reference_rate_aed?: number | null;
  conversion_note?: string | null;
  outlier_confirmed_at?: string | null;
  replaces?: { id: string; rate_aed: number; unit: string; origin: string; created_at: string } | null;
  conversion?: { rate_aed: number; quantity: number; unit: string; ratio: number | null; note: string } | null;
}

type StatusKey = "ready" | "confirm" | "outlier" | "unit" | "currency" | "nan" | "nomatch" | "held" | "rejected" | "inbook";
const ORIGIN: Record<string, string> = { firm_entry: "firm entry", quote_import: "earlier quotation", promoted_correction: "promoted correction" };
const KIND_LABEL: Record<EntryKind, string> = { labour: "labour", supply: "supply", supply_and_install: "supply & install", lump: "lump" };
const unitText = (u: string | null | undefined) => (u ?? "—").replace(/\bm2\b/g, "m²");
const isMagnitudeHold = (l: Line) => l.status === "unmatched" && !!l.hold_reason && /× the reference — check the unit/.test(l.hold_reason);

/** One status per line, from the store's own assessment. */
function statusOf(l: Line): { key: StatusKey; label: string; icon: string } {
  if (l.status === "accepted") return { key: "inbook", label: "IN BOOK", icon: "check" };
  if (l.status === "rejected") return { key: "rejected", label: "REJECTED", icon: "block" };
  if (l.status === "matched") return { key: "ready", label: "READY", icon: "check" };
  if (isMagnitudeHold(l)) return l.conversion ? { key: "unit", label: "HELD · UNIT CHECK", icon: "pause_circle" } : { key: "outlier", label: "HELD · OUTLIER", icon: "pause_circle" };
  if (/^currency /.test(l.hold_reason ?? "") && l.rate_aed == null) return { key: "currency", label: "HELD · CURRENCY", icon: "pause_circle" };
  if (l.rate_aed == null && /not a number|no usable rate|negative/.test(l.hold_reason ?? "")) return { key: "nan", label: "HELD · NOT A NUMBER", icon: "pause_circle" };
  if (!l.item_key && l.suggested_item_key) return { key: "confirm", label: "CONFIRM MATCH", icon: "help" };
  if (!l.item_key) return { key: "nomatch", label: "NO MATCH", icon: "link_off" };
  return { key: "held", label: "HELD", icon: "pause_circle" };
}

export function QuoteReview({ firmId, initialQuote, initialLines }: { firmId: string; initialQuote: Quote; initialLines: Line[] }) {
  const ids = useId();
  const [quote, setQuote] = useState(initialQuote);
  const [lines, setLines] = useState(initialLines);
  const [vocab, setVocab] = useState<VocabularyItem[] | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [entering, setEntering] = useState<{ id: string; value: string } | null>(null);
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
  const statuses = lines.map(statusOf);
  const count = (...k: StatusKey[]) => statuses.filter((s) => k.includes(s.key)).length;
  const counts = { read: lines.length, ready: count("ready"), confirm: count("confirm"), held: count("outlier", "unit", "currency", "nan", "held"), nomatch: count("nomatch") };
  const suggested = lines.filter((l) => l.status === "unmatched" && !l.item_key && l.suggested_item_key && (l.suggestion_score ?? 0) >= 0.5).length;

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
      // H8: re-read the review — the line's hold, offer and "replaces" all follow from the change.
      await refresh();
      setPicking(null);
      setEntering(null);
    } finally {
      setBusy(null);
    }
  }
  async function act(action: "confirm_suggestions" | "accept") {
    setBusy(action);
    setBanner(null);
    try {
      const res = await fetch(`/api/firms/${firmId}/quotes/${quote.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      const b = (await res.json().catch(() => ({}))) as { error?: string; accepted?: number; held?: number; rejected?: number; superseded?: number };
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

  const terms = [quote.currency, quote.rates_are === "list" ? `list − ${quote.discount_pct}%` : "net", quote.vat_treatment === "incl" ? "incl. VAT (÷1.05)" : quote.vat_treatment === "excl" ? "excl. VAT" : "VAT not stated"];
  const select = (l: Line) => (
    <select
      value={l.item_key ?? ""}
      onChange={(e) => patch(l, { item_key: e.target.value || null })}
      disabled={!vocab || busy === l.id}
      aria-label={`Item for row ${l.row_no}`}
      className="t-body-sm mt-2 h-9 w-full max-w-[300px] rounded-none border border-bp-line-control bg-bp-surface-base px-2"
    >
      <option value="">— choose an item —</option>
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
  );

  return (
    <div className="mx-auto max-w-[1280px] px-6 pb-16 pt-8 md:px-12" data-quote-id={quote.id}>
      <TopBarActions>
        <Button kind="quiet" href={`/firms/${firmId}`}>
          Back to book
        </Button>
      </TopBarActions>

      <p className="t-label-caps text-bp-brass-text">QUOTE IMPORT · REVIEW BEFORE ANYTHING ENTERS YOUR BOOK</p>
      <h1 className="t-heading-lg mt-2 flex flex-wrap items-baseline gap-3">
        {quote.supplier_label}
        <span className="t-label-md text-bp-ink-tertiary">
          {quote.quote_ref ? `${quote.quote_ref} · ` : ""}v{quote.version}
        </span>
        <span className="t-label-caps border border-bp-line-control px-2 py-0.5 text-bp-ink-secondary" data-testid="quote-status">
          {quote.status === "review" ? "In review" : quote.status === "accepted" ? "Accepted" : "Superseded"}
        </span>
      </h1>
      <p className="t-label-md mt-1 text-bp-ink-tertiary">
        {[quote.supplier_role, quote.quote_date ? `dated ${quote.quote_date}` : null, quote.valid_until ? `valid to ${quote.valid_until}` : null, ...terms, quote.source_filename, quote.source_sha256 ? `sha256 ${quote.source_sha256.slice(0, 8)}…` : null].filter(Boolean).join(" · ")}
      </p>

      <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-3 border-y border-bp-line-strong py-4" aria-label="Summary" aria-live="polite">
        {[
          ["description", counts.read, "lines read"],
          ["check", counts.ready, "ready"],
          ["help", counts.confirm, "to confirm"],
          ["pause_circle", counts.held, "held"],
          ["link_off", counts.nomatch, "no match"],
        ].map(([icon, n, label]) => (
          <div key={label as string} className="flex items-center gap-2">
            <Icon name={icon as string} size={18} className="text-bp-ink-secondary" />
            <dt className="sr-only">{label}</dt>
            <dd className="flex items-baseline gap-2">
              <span className="t-num-lg">{n}</span>
              <span className="t-body-sm text-bp-ink-secondary">{label}</span>
            </dd>
          </div>
        ))}
      </dl>

      {banner ? (
        <p role="alert" className="surface-inverse t-body-sm mt-4 bg-bp-alert-surface px-4 py-3 text-bp-alert-ink">
          {banner}
        </p>
      ) : null}
      {result ? (
        <p role="status" className="t-body-sm mt-4 border border-bp-line-strong bg-bp-surface-raised px-4 py-3" data-testid="accept-result">
          {result.accepted} rate{result.accepted === 1 ? "" : "s"} entered the book
          {result.superseded > 0 ? ` (replacing ${result.superseded} earlier import${result.superseded === 1 ? "" : "s"}, kept as history)` : ""}; {result.held} held and {result.rejected} rejected — still on this record.
        </p>
      ) : null}
      {!readOnly && suggested > 0 ? (
        <div className="mt-4">
          <Button kind="quiet" onClick={busy ? undefined : () => act("confirm_suggestions")}>
            Confirm {suggested} suggestion{suggested === 1 ? "" : "s"} scoring ≥ 0.5
          </Button>
        </div>
      ) : null}

      <div className="relative mt-4 overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring" tabIndex={0} role="region" aria-label="Quoted lines">
        <table className="w-full min-w-[1080px]" data-testid="quote-lines">
          <thead>
            <tr className="t-label-caps bg-bp-surface-sunken text-left text-bp-ink-tertiary">
              <th className="px-3 py-3 font-normal">#</th>
              <th className="px-3 py-3 font-normal">QUOTED LINE</th>
              <th className="px-3 py-3 text-right font-normal">QUOTED</th>
              <th className="px-3 py-3 font-normal">MATCHED ITEM</th>
              <th className="px-3 py-3 text-right font-normal">ENTERS BOOK AS</th>
              <th className="px-3 py-3 text-right font-normal">MARKET REF</th>
              <th className="px-3 py-3 text-right font-normal">VS REF</th>
              <th className="w-[300px] px-3 py-3 font-normal">STATUS</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const st = statuses[i]!;
              const v = l.item_key ? byKey.get(l.item_key) : null;
              const ref = v?.reference;
              const refRate = ref && ref.kind !== "none" ? ref.rate_aed : null;
              const how = !l.item_key ? null : l.item_key_given && l.item_key_given === l.item_key ? "key given in file" : l.suggested_item_key === l.item_key ? `suggested · ${Math.round((l.suggestion_score ?? 0) * 100)}% match` : "chosen by a member";
              return (
                <tr key={l.id} data-line-id={l.id} data-status={l.status} data-review={st.key} className="border-b border-bp-line-hairline align-top">
                  <td className="t-label-md px-3 py-4 text-bp-ink-tertiary">{l.row_no}</td>
                  <td className="px-3 py-4">
                    <p className="t-body-sm">{l.description}</p>
                    <p className="t-label-md mt-1 text-bp-ink-tertiary">
                      {l.qty != null ? `${formatQty(l.qty)} ` : ""}
                      {unitText(l.unit_given ?? l.unit)}
                    </p>
                  </td>
                  <td className="t-num-md px-3 py-4 text-right">{l.rate_raw != null ? `${formatAED(l.rate_raw)}${(l.currency ?? quote.currency) !== "AED" ? ` ${l.currency ?? quote.currency}` : ""}` : <span className="t-label-md text-bp-ink-tertiary">“no price”</span>}</td>
                  <td className="px-3 py-4">
                    {l.item_key ? (
                      <>
                        <p className="t-label-md text-bp-ink-primary">{l.item_key}</p>
                        <p className="t-label-md text-bp-ink-tertiary">{how}</p>
                      </>
                    ) : l.suggested_item_key ? (
                      <>
                        <p className="t-label-md text-bp-ink-primary">{l.suggested_item_key}</p>
                        <p className="t-label-md text-bp-ink-tertiary">suggested · {Math.round((l.suggestion_score ?? 0) * 100)}% match</p>
                      </>
                    ) : (
                      <>
                        <p className="t-label-md">—</p>
                        <p className="t-label-md text-bp-ink-tertiary">no item in the vocabulary</p>
                      </>
                    )}
                    {!readOnly && l.item_key && l.status !== "rejected" ? (
                      <div className="mt-2 flex gap-2">
                        <select value={l.grade ?? ""} onChange={(e) => patch(l, { grade: (e.target.value || null) as Grade | null })} aria-label={`Grade for row ${l.row_no}`} className="t-label-md h-8 rounded-none border border-bp-line-control bg-bp-surface-base px-1">
                          <option value="">all grades</option>
                          <option value="economy">economy</option>
                          <option value="standard">standard</option>
                          <option value="premium">premium</option>
                        </select>
                        <select value={l.kind ?? ""} onChange={(e) => patch(l, { kind: (e.target.value || null) as EntryKind | null })} aria-label={`Kind for row ${l.row_no}`} className="t-label-md h-8 rounded-none border border-bp-line-control bg-bp-surface-base px-1">
                          {(v?.kinds ?? ENTRY_KINDS).map((k) => (
                            <option key={k} value={k}>
                              {KIND_LABEL[k]}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                    {picking === l.id ? select(l) : null}
                  </td>
                  <td className="px-3 py-4 text-right">
                    {l.rate_aed != null ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="t-num-md">{formatAED(l.rate_aed)}</span>
                        <ProvenanceMark tier="measured" />
                      </span>
                    ) : (
                      <span className="t-label-md text-bp-ink-tertiary">—</span>
                    )}
                    {l.rate_aed != null && l.unit ? <p className="t-label-md text-bp-ink-tertiary">/ {unitText(l.unit)}</p> : null}
                  </td>
                  <td className="px-3 py-4 text-right">
                    {ref?.kind === "market" ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="t-num-md text-bp-ink-secondary">{formatAED(ref.rate_aed)}</span>
                        <ProvenanceMark tier="market" />
                      </span>
                    ) : ref?.kind === "builtin" ? (
                      <span className="t-label-md text-bp-ink-tertiary">built-in</span>
                    ) : (
                      <span className="t-label-md text-bp-ink-tertiary">—</span>
                    )}
                  </td>
                  <td className="t-label-md px-3 py-4 text-right text-bp-ink-secondary">
                    {l.magnitude_ratio != null && isMagnitudeHold(l) ? formatRatio(l.magnitude_ratio) : l.rate_aed != null && refRate ? `${((l.rate_aed - refRate) / refRate) * 100 >= 0 ? "+" : "−"}${Math.abs(((l.rate_aed - refRate) / refRate) * 100).toFixed(1)}%` : "—"}
                  </td>
                  <td className="px-3 py-4">
                    <p className="t-label-caps flex items-center gap-2 text-bp-ink-primary">
                      <Icon name={st.icon} size={16} />
                      {st.label}
                    </p>
                    <Sentence l={l} st={st.key} />
                    {!readOnly ? (
                      <div className="mt-3 flex flex-wrap items-center gap-4">
                        {st.key === "confirm" ? (
                          <>
                            <Button kind="secondary" onClick={busy ? undefined : () => patch(l, { item_key: l.suggested_item_key })} testId="confirm-suggestion">
                              Confirm
                            </Button>
                            <Button kind="quiet" onClick={() => setPicking(picking === l.id ? null : l.id)}>
                              Change item
                            </Button>
                          </>
                        ) : null}
                        {st.key === "unit" && l.conversion ? (
                          <Button kind="primary" onClick={busy ? undefined : () => patch(l, { apply_conversion: true })} testId="apply-conversion">
                            Use {formatAED(l.conversion.rate_aed)} / {unitText(l.conversion.unit)}
                          </Button>
                        ) : null}
                        {st.key === "outlier" ? (
                          <Button
                            kind="secondary"
                            onClick={
                              busy
                                ? undefined
                                : () => {
                                    if (window.confirm(`Keep ${formatAED(l.rate_aed)} per ${unitText(l.unit)} as quoted? It is ${l.magnitude_ratio}× the reference (${l.reference_rate_aed}). Your confirmation is recorded.`)) void patch(l, { confirm_outlier: true });
                                  }
                            }
                            testId="confirm-outlier"
                          >
                            Confirm {formatAED(l.rate_aed)}
                          </Button>
                        ) : null}
                        {st.key === "currency" ? (
                          entering?.id === l.id ? (
                            <span className="flex items-center gap-2">
                              <label htmlFor={`${ids}-aed-${l.id}`} className="sr-only">
                                AED rate for row {l.row_no}
                              </label>
                              <input id={`${ids}-aed-${l.id}`} value={entering.value} onChange={(e) => setEntering({ id: l.id, value: e.target.value })} inputMode="decimal" placeholder="AED" className="t-num-md h-9 w-28 rounded-none border border-bp-line-control bg-bp-surface-base px-2 text-right" />
                              <Button kind="secondary" onClick={busy || !(Number(entering.value) > 0) ? undefined : () => patch(l, { enter_rate_aed: Number(entering.value) })}>
                                Save
                              </Button>
                            </span>
                          ) : (
                            <Button kind="secondary" onClick={() => setEntering({ id: l.id, value: "" })}>
                              Enter AED rate
                            </Button>
                          )
                        ) : null}
                        {st.key === "nomatch" ? (
                          <Button kind="secondary" onClick={() => setPicking(picking === l.id ? null : l.id)}>
                            Choose item
                          </Button>
                        ) : null}
                        {st.key === "rejected" ? (
                          <Button kind="quiet" onClick={busy ? undefined : () => patch(l, { status: "unmatched" })}>
                            Restore
                          </Button>
                        ) : st.key !== "ready" && st.key !== "inbook" ? (
                          <Button kind="quiet" onClick={busy ? undefined : () => patch(l, { status: "rejected" })}>
                            Reject line
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!readOnly ? (
        <div className="mt-8 flex flex-wrap items-center gap-6 border-t border-bp-line-hairline pt-5">
          <Button kind="primary" onClick={busy || counts.ready === 0 ? undefined : () => act("accept")} disabled={counts.ready === 0 ? { reason: "No line is ready yet", reasonId: `${ids}-none`, showReason: true } : false} testId="accept-quote">
            Add {counts.ready} ready line{counts.ready === 1 ? "" : "s"} to the book
          </Button>
          <Button kind="quiet" href={`/firms/${firmId}`}>
            Save review for later
          </Button>
          <p className="t-body-sm text-bp-ink-secondary">Held and unmatched lines never enter the book. Each acceptance is recorded with your name; nothing reprices a project until you regenerate.</p>
        </div>
      ) : null}
    </div>
  );
}

function Sentence({ l, st }: { l: Line; st: StatusKey }) {
  const cls = "t-body-sm mt-1 text-bp-ink-secondary";
  if (st === "ready")
    return (
      <p className={cls}>
        {l.replaces ? (
          <span data-testid="replaces">
            Replaces your {formatAED(l.replaces.rate_aed)} {ORIGIN[l.replaces.origin] ?? l.replaces.origin} (kept in history).
          </span>
        ) : (
          "Enters the book as a new rate."
        )}
        {l.conversion_note ? (
          <span className="mt-1 block text-bp-ink-tertiary" data-testid="conversion-note">
            converted: {l.conversion_note}
          </span>
        ) : null}
        {l.outlier_confirmed_at ? (
          <span className="mt-1 block text-bp-ink-tertiary" data-testid="outlier-confirmed">
            kept as quoted ({l.magnitude_ratio}×) — confirmed
          </span>
        ) : null}
      </p>
    );
  if (st === "inbook") return <p className={cls}>In the book.</p>;
  if (st === "rejected") return <p className={cls}>Rejected — kept on this record.</p>;
  if (st === "confirm") return <p className={cls}>{(l.suggestion_score ?? 0) < 0.6 ? "Low-confidence match — check the item before it enters the book." : "Suggested — confirm the item."}</p>;
  if (st === "unit")
    return (
      <p className={cls}>
        <span data-testid="hold-reason">{l.hold_reason}.</span> {l.conversion?.note}.
      </p>
    );
  if (st === "outlier")
    return (
      <p className={cls}>
        <span data-testid="hold-reason">{l.hold_reason}</span> — confirm the spec.
      </p>
    );
  if (st === "currency")
    return (
      <p className={cls} data-testid="hold-reason">
        {l.currency ?? "Foreign currency"} — no exchange rate is applied. Re-enter in AED.
      </p>
    );
  if (st === "nan")
    return (
      <p className={cls} data-testid="hold-reason">
        The quote gives no price. Ask the supplier or reject.
      </p>
    );
  if (st === "nomatch") return <p className={cls}>Choose an item or reject the line.</p>;
  return (
    <p className={cls} data-testid="hold-reason">
      {l.hold_reason}
    </p>
  );
}
