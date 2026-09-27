"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// U3 — the firm's quotations: download the template, upload a filled one
// (→ review), and see what has been imported. Every request is to
// /api/firms/${firmId}/quotes… — the same privacy rule as the editor.

interface Quote {
  id: string;
  supplier_label: string;
  supplier_role: string;
  quote_ref: string | null;
  quote_date: string | null;
  valid_until: string | null;
  status: "review" | "accepted" | "superseded";
  version: number;
  created_at: string;
}

const STATUS_LABEL: Record<Quote["status"], string> = { review: "In review", accepted: "Accepted", superseded: "Superseded" };

export function QuotesPanel({ firmId }: { firmId: string }) {
  const router = useRouter();
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState({ supplier_label: "", supplier_role: "supplier", quote_ref: "", quote_date: "", valid_until: "", currency: "AED", vat_treatment: "excl", rates_are: "net", discount_pct: "0" });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/firms/${firmId}/quotes`)
      .then((r) => r.json() as Promise<{ quotes?: Quote[] }>)
      .then((b) => !cancelled && setQuotes(b.quotes ?? []))
      .catch(() => !cancelled && setQuotes([]));
    return () => {
      cancelled = true;
    };
  }, [firmId]);

  async function upload() {
    if (!file) {
      setError("Attach the filled template (.xlsx).");
      return;
    }
    if (!meta.supplier_label.trim()) {
      setError("Name the supplier or contractor the quote is from.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      for (const [k, v] of Object.entries(meta)) fd.append(k, v);
      const res = await fetch(`/api/firms/${firmId}/quotes`, { method: "POST", body: fd });
      const body = (await res.json().catch(() => ({}))) as { quote?: { id: string }; error?: string; code?: string };
      if (!res.ok || !body.quote) {
        setError(body.error ?? `Upload failed (${res.status}).`);
        return;
      }
      router.push(`/firms/${firmId}/quotes/${body.quote.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-ink-100 bg-paper p-md" aria-label="Quotations">
      <div className="flex flex-wrap items-baseline justify-between gap-sm">
        <p className="label-caps text-ink-500">Quotations — supplier and contractor prices, reviewed before they become rates</p>
        <div className="flex items-center gap-sm">
          <a href={`/api/firms/${firmId}/quotes/template`} className="focus-ring inline-flex items-center gap-xs rounded-lg border border-ink-100 bg-paper px-sm py-xs text-body-sm text-ink-700 hover:border-brass-600">
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
              download
            </span>
            Template (.xlsx)
          </a>
          <button type="button" onClick={() => setOpen((o) => !o)} className="focus-ring rounded-lg bg-brass-600 px-sm py-xs text-body-sm font-semibold text-white">
            {open ? "Close" : "Import a quote"}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-sm grid grid-cols-1 gap-sm rounded-lg border border-ink-100 bg-canvas p-sm md:grid-cols-6" data-testid="quote-upload">
          <label className="md:col-span-3">
            <span className="label-caps text-ink-500">Supplier / contractor (your label — never printed on a document)</span>
            <input value={meta.supplier_label} onChange={(e) => setMeta((m) => ({ ...m, supplier_label: e.target.value }))} aria-label="Supplier label" className="focus-ring mt-xs w-full rounded border border-ink-100 bg-paper px-sm py-xs text-body-sm" />
          </label>
          <label>
            <span className="label-caps text-ink-500">Role</span>
            <select value={meta.supplier_role} onChange={(e) => setMeta((m) => ({ ...m, supplier_role: e.target.value }))} aria-label="Supplier role" className="focus-ring mt-xs w-full rounded border border-ink-100 bg-paper px-sm py-xs text-body-sm">
              <option value="supplier">supplier</option>
              <option value="contractor">contractor</option>
              <option value="manufacturer">manufacturer</option>
              <option value="other">other</option>
            </select>
          </label>
          <label className="md:col-span-2">
            <span className="label-caps text-ink-500">Quote reference</span>
            <input value={meta.quote_ref} onChange={(e) => setMeta((m) => ({ ...m, quote_ref: e.target.value }))} aria-label="Quote reference" className="focus-ring mt-xs w-full rounded border border-ink-100 bg-paper px-sm py-xs font-mono text-body-sm" />
          </label>
          <label>
            <span className="label-caps text-ink-500">Quote date</span>
            <input type="date" value={meta.quote_date} onChange={(e) => setMeta((m) => ({ ...m, quote_date: e.target.value }))} aria-label="Quote date" className="focus-ring mt-xs w-full rounded border border-ink-100 bg-paper px-sm py-xs text-body-sm" />
          </label>
          <label>
            <span className="label-caps text-ink-500">Valid until</span>
            <input type="date" value={meta.valid_until} onChange={(e) => setMeta((m) => ({ ...m, valid_until: e.target.value }))} aria-label="Valid until" className="focus-ring mt-xs w-full rounded border border-ink-100 bg-paper px-sm py-xs text-body-sm" />
          </label>
          <label>
            <span className="label-caps text-ink-500">Currency</span>
            <input value={meta.currency} onChange={(e) => setMeta((m) => ({ ...m, currency: e.target.value.toUpperCase() }))} aria-label="Currency" maxLength={3} className="focus-ring mt-xs w-full rounded border border-ink-100 bg-paper px-sm py-xs font-mono text-body-sm" />
          </label>
          <label>
            <span className="label-caps text-ink-500">VAT</span>
            <select value={meta.vat_treatment} onChange={(e) => setMeta((m) => ({ ...m, vat_treatment: e.target.value }))} aria-label="VAT treatment" className="focus-ring mt-xs w-full rounded border border-ink-100 bg-paper px-sm py-xs text-body-sm">
              <option value="excl">rates exclude VAT</option>
              <option value="incl">rates include VAT</option>
              <option value="unknown">not stated</option>
            </select>
          </label>
          <label>
            <span className="label-caps text-ink-500">Rates are</span>
            <select value={meta.rates_are} onChange={(e) => setMeta((m) => ({ ...m, rates_are: e.target.value }))} aria-label="Rates are" className="focus-ring mt-xs w-full rounded border border-ink-100 bg-paper px-sm py-xs text-body-sm">
              <option value="net">net (as agreed)</option>
              <option value="list">list (discount applies)</option>
            </select>
          </label>
          <label>
            <span className="label-caps text-ink-500">Discount %</span>
            <input value={meta.discount_pct} onChange={(e) => setMeta((m) => ({ ...m, discount_pct: e.target.value }))} inputMode="decimal" aria-label="Discount percent" disabled={meta.rates_are !== "list"} className="focus-ring mt-xs w-full rounded border border-ink-100 bg-paper px-sm py-xs text-right font-mono text-body-sm tabular-nums disabled:bg-canvas disabled:text-ink-500" />
          </label>
          <label className="md:col-span-3">
            <span className="label-caps text-ink-500">Filled template</span>
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Quote file" className="mt-xs block w-full text-body-sm text-ink-700" />
          </label>
          <div className="flex items-end md:col-span-2">
            <button type="button" onClick={upload} disabled={busy} className="focus-ring rounded-lg bg-brass-600 px-md py-xs text-body-sm font-semibold text-white disabled:opacity-50">
              {busy ? "Reading…" : "Upload for review"}
            </button>
          </div>
          {error && (
            <p role="alert" className="text-body-sm text-error md:col-span-6">
              {error}
            </p>
          )}
          <p className="text-[12px] text-ink-500 md:col-span-6">
            Nothing enters the book on upload. Every line is reviewed, a suggested item is confirmed by a member, and only then does a rate enter — marked
            as coming from this quotation. A re-import of the same reference replaces the earlier import&rsquo;s rates and keeps the history.
          </p>
        </div>
      )}

      {quotes === null ? (
        <p className="mt-sm text-body-sm text-ink-500">Loading…</p>
      ) : quotes.length === 0 ? (
        <p className="mt-sm text-body-sm text-ink-700">No quotations imported yet.</p>
      ) : (
        <ul className="mt-sm divide-y divide-ink-100" data-testid="quote-list">
          {quotes.map((q) => (
            <li key={q.id} className="flex flex-wrap items-center justify-between gap-sm py-sm">
              <div>
                <Link href={`/firms/${firmId}/quotes/${q.id}`} className="focus-ring text-body-md text-ink-900 hover:text-brass-600">
                  {q.supplier_label}
                  {q.quote_ref && <span className="ml-xs font-mono text-[12px] text-ink-500">{q.quote_ref}</span>}
                </Link>
                <p className="font-mono text-[12px] text-ink-500">
                  v{q.version} · {q.supplier_role}
                  {q.quote_date && ` · ${q.quote_date}`}
                  {q.valid_until && ` · valid to ${q.valid_until}`}
                </p>
              </div>
              <span className={["label-caps rounded-full border px-sm py-[3px]", q.status === "accepted" ? "border-brass-600 text-brass-600" : q.status === "review" ? "border-ink-100 text-ink-700" : "border-ink-100 text-ink-500"].join(" ")}>
                {STATUS_LABEL[q.status]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
