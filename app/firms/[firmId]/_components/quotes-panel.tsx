"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { UploadFailed, uploadDirect } from "@/lib/uploads/client";

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

export function QuotesPanel({ firmId, open: openProp, onOpenChange }: { firmId: string; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const router = useRouter();
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [openLocal, setOpenLocal] = useState(false);
  const open = openProp ?? openLocal;
  const setOpen = (v: boolean | ((o: boolean) => boolean)) => {
    const next = typeof v === "function" ? v(open) : v;
    setOpenLocal(next);
    onOpenChange?.(next);
  };
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
      // H9: the workbook goes straight to Storage on a URL signed for THIS firm;
      // this firm's quote route then verifies it and runs the import.
      let path: string;
      try {
        path = (await uploadDirect(file, { kind: "quote", firmId })).path;
      } catch (err) {
        setError(err instanceof UploadFailed ? err.message : "The upload didn't complete. Please try again.");
        return;
      }
      const res = await fetch(`/api/firms/${firmId}/quotes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, filename: file.name, ...meta }) });
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
    <section className="border-t border-bp-line-hairline pt-4" aria-label="Quotations">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="t-label-caps text-bp-ink-tertiary">Quotations — supplier and contractor prices, reviewed before they become rates</p>
        <div className="flex items-center gap-3">
          <a href={`/api/firms/${firmId}/quotes/template`} className="inline-flex h-9 items-center gap-2 border border-bp-line-control px-4 t-nav-item-active text-bp-ink-primary hover:bg-bp-surface-sunken disabled:opacity-50">
            
            Template (.xlsx)
          </a>
          <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex h-9 items-center bg-bp-ink-primary px-4 t-nav-item-active text-bp-ink-on-inverse hover:bg-bp-ink-secondary aria-disabled:opacity-50 disabled:opacity-50">
            {open ? "Close" : "Import a quote"}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3 grid grid-cols-1 gap-3 border border-bp-line-strong bg-bp-surface-raised p-5 md:grid-cols-6" data-testid="quote-upload">
          <label className="md:col-span-3">
            <span className="t-label-caps text-bp-ink-tertiary">Supplier / contractor (your label — never printed on a document)</span>
            <input value={meta.supplier_label} onChange={(e) => setMeta((m) => ({ ...m, supplier_label: e.target.value }))} aria-label="Supplier label" className="t-body-sm mt-1 h-10 w-full rounded-none border border-bp-line-control bg-bp-surface-base px-3 text-bp-ink-primary" />
          </label>
          <label>
            <span className="t-label-caps text-bp-ink-tertiary">Role</span>
            <select value={meta.supplier_role} onChange={(e) => setMeta((m) => ({ ...m, supplier_role: e.target.value }))} aria-label="Supplier role" className="t-body-sm mt-1 h-10 w-full rounded-none border border-bp-line-control bg-bp-surface-base px-3 text-bp-ink-primary">
              <option value="supplier">supplier</option>
              <option value="contractor">contractor</option>
              <option value="manufacturer">manufacturer</option>
              <option value="other">other</option>
            </select>
          </label>
          <label className="md:col-span-2">
            <span className="t-label-caps text-bp-ink-tertiary">Quote reference</span>
            <input value={meta.quote_ref} onChange={(e) => setMeta((m) => ({ ...m, quote_ref: e.target.value }))} aria-label="Quote reference" className="t-body-sm mt-1 h-10 w-full rounded-none border border-bp-line-control bg-bp-surface-base px-3 text-bp-ink-primary font-bp-mono" />
          </label>
          <label>
            <span className="t-label-caps text-bp-ink-tertiary">Quote date</span>
            <input type="date" value={meta.quote_date} onChange={(e) => setMeta((m) => ({ ...m, quote_date: e.target.value }))} aria-label="Quote date" className="t-body-sm mt-1 h-10 w-full rounded-none border border-bp-line-control bg-bp-surface-base px-3 text-bp-ink-primary" />
          </label>
          <label>
            <span className="t-label-caps text-bp-ink-tertiary">Valid until</span>
            <input type="date" value={meta.valid_until} onChange={(e) => setMeta((m) => ({ ...m, valid_until: e.target.value }))} aria-label="Valid until" className="t-body-sm mt-1 h-10 w-full rounded-none border border-bp-line-control bg-bp-surface-base px-3 text-bp-ink-primary" />
          </label>
          <label>
            <span className="t-label-caps text-bp-ink-tertiary">Currency</span>
            <input value={meta.currency} onChange={(e) => setMeta((m) => ({ ...m, currency: e.target.value.toUpperCase() }))} aria-label="Currency" maxLength={3} className="t-body-sm mt-1 h-10 w-full rounded-none border border-bp-line-control bg-bp-surface-base px-3 text-bp-ink-primary font-bp-mono" />
          </label>
          <label>
            <span className="t-label-caps text-bp-ink-tertiary">VAT</span>
            <select value={meta.vat_treatment} onChange={(e) => setMeta((m) => ({ ...m, vat_treatment: e.target.value }))} aria-label="VAT treatment" className="t-body-sm mt-1 h-10 w-full rounded-none border border-bp-line-control bg-bp-surface-base px-3 text-bp-ink-primary">
              <option value="excl">rates exclude VAT</option>
              <option value="incl">rates include VAT</option>
              <option value="unknown">not stated</option>
            </select>
          </label>
          <label>
            <span className="t-label-caps text-bp-ink-tertiary">Rates are</span>
            <select value={meta.rates_are} onChange={(e) => setMeta((m) => ({ ...m, rates_are: e.target.value }))} aria-label="Rates are" className="t-body-sm mt-1 h-10 w-full rounded-none border border-bp-line-control bg-bp-surface-base px-3 text-bp-ink-primary">
              <option value="net">net (as agreed)</option>
              <option value="list">list (discount applies)</option>
            </select>
          </label>
          <label>
            <span className="t-label-caps text-bp-ink-tertiary">Discount %</span>
            <input value={meta.discount_pct} onChange={(e) => setMeta((m) => ({ ...m, discount_pct: e.target.value }))} inputMode="decimal" aria-label="Discount percent" disabled={meta.rates_are !== "list"} className="t-body-sm mt-1 h-10 w-full rounded-none border border-bp-line-control bg-bp-surface-base px-3 text-bp-ink-primary t-num-md text-right disabled:text-bp-ink-tertiary" />
          </label>
          <label className="md:col-span-3">
            <span className="t-label-caps text-bp-ink-tertiary">Filled template</span>
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Quote file" className="mt-1 block w-full t-body-sm text-bp-ink-secondary" />
          </label>
          <div className="flex items-end md:col-span-2">
            <button type="button" onClick={upload} disabled={busy} className="inline-flex h-9 items-center bg-bp-ink-primary px-4 t-nav-item-active text-bp-ink-on-inverse hover:bg-bp-ink-secondary aria-disabled:opacity-50 disabled:opacity-50">
              {busy ? "Reading…" : "Upload for review"}
            </button>
          </div>
          {error && (
            <p role="alert" className="t-body-sm text-bp-ink-primary md:col-span-6">
              {error}
            </p>
          )}
          <p className="t-label-md text-bp-ink-tertiary md:col-span-6">
            Nothing enters the book on upload. Every line is reviewed, a suggested item is confirmed by a member, and only then does a rate enter — marked
            as coming from this quotation. A re-import of the same reference replaces the earlier import&rsquo;s rates and keeps the history.
          </p>
        </div>
      )}

      {quotes === null ? (
        <p className="mt-3 t-body-sm text-bp-ink-tertiary">Loading…</p>
      ) : quotes.length === 0 ? (
        <p className="mt-3 t-body-sm text-bp-ink-secondary">No quotations imported yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-bp-line-hairline" data-testid="quote-list">
          {quotes.map((q) => (
            <li key={q.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <Link href={`/firms/${firmId}/quotes/${q.id}`} className="t-body-md text-bp-ink-primary underline-offset-2 hover:underline">
                  {q.supplier_label}
                  {q.quote_ref && <span className="ml-xs t-label-md text-bp-ink-tertiary">{q.quote_ref}</span>}
                </Link>
                <p className="t-label-md text-bp-ink-tertiary">
                  v{q.version} · {q.supplier_role}
                  {q.quote_date && ` · ${q.quote_date}`}
                  {q.valid_until && ` · valid to ${q.valid_until}`}
                </p>
              </div>
              <span className={["t-label-caps border px-2 py-0.5", q.status === "accepted" ? "border-bp-line-strong text-bp-ink-primary" : q.status === "review" ? "border-bp-line-control text-bp-ink-secondary" : "border-bp-line-hairline text-bp-ink-tertiary"].join(" ")}>
                {STATUS_LABEL[q.status]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
