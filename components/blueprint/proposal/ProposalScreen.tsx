"use client";

// =============================================================================
// components/blueprint/proposal/ProposalScreen.tsx — 08 Proposal (K4, R7 §3.7,
// Figma 23:689).
//
// The gate first (the same verdict the export runs): a gate-refusal block with
// both ways out while it is closed. Then SETUP — display name and logo (the
// firm's branding), client (cover only), validity, payment terms, cover note and
// "Show line rates to the client" (OFF by default) — each saved as it is left
// (validity, payment terms and the line-rate choice also become the firm's
// defaults). Right: what the client receives, from rev N, and the price summary
// as it would print. Footer: Generate proposal — through the gated export on
// 06 Documents — disabled with the reason while locked; Preview as client —
// the pages as they would print, watermarked PREVIEW · NOT ISSUED.
// =============================================================================

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import type { ProposalView } from "@/lib/documents/proposal-view";
import { formatAED } from "@/lib/format/aed";
import { UploadFailed, uploadDirect } from "@/lib/uploads/client";

import { Button } from "../Button";
import { Icon } from "../Icon";
import { StateBlock } from "../StateBlock";

const INPUT =
  "w-full rounded-none border border-bp-line-control bg-bp-surface-base px-3 t-body-sm text-bp-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring";

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; what: string } | { kind: "error"; message: string };

export function ProposalScreen({ view, eyebrow }: { view: ProposalView; eyebrow: string }) {
  const router = useRouter();
  const { projectId, firm, setup, gate } = view;
  const [displayName, setDisplayName] = useState(firm?.displayName ?? firm?.brand ?? "");
  const [client, setClient] = useState(setup?.clientLabel ?? "");
  const [validity, setValidity] = useState(setup?.validityDays != null ? String(setup.validityDays) : "");
  const [terms, setTerms] = useState(setup?.paymentTerms ?? "");
  const [note, setNote] = useState(setup?.coverNote ?? "");
  const [rates, setRates] = useState(setup?.showLineRates ?? false);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [preview, setPreview] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const genReason = useId();

  async function put(patch: Record<string, unknown>, what: string) {
    setSave({ kind: "saving" });
    const res = await fetch(`/api/projects/${projectId}/proposal-setup`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return setSave({ kind: "error", message: res.status === 403 ? "Only a member of this project's firm can change its proposal." : (body.error ?? `Not saved (${res.status}).`) });
    setSave({ kind: "saved", what });
    router.refresh();
  }

  async function saveBrand() {
    if (!firm || displayName.trim() === (firm.displayName ?? firm.brand)) return;
    setSave({ kind: "saving" });
    const res = await fetch(`/api/firms/${firm.id}/branding`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ display_name: displayName.trim() || null }) });
    if (!res.ok) return setSave({ kind: "error", message: `The display name was not saved (${res.status}).` });
    setSave({ kind: "saved", what: "Display name" });
    router.refresh();
  }

  async function uploadLogo(f: File) {
    if (!firm) return;
    setSave({ kind: "saving" });
    try {
      const { path } = await uploadDirect(f, { kind: "logo", firmId: firm.id });
      const res = await fetch(`/api/firms/${firm.id}/branding`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }) });
      if (!res.ok) return setSave({ kind: "error", message: `The logo was not saved (${res.status}).` });
      setSave({ kind: "saved", what: "Logo" });
      router.refresh();
    } catch (e) {
      setSave({ kind: "error", message: e instanceof UploadFailed ? e.message : "The upload didn't complete. Please try again." });
    }
  }

  const locked = !gate.ok;
  const lockedReason = gate.noFirm
    ? "Locked — this project has no firm attached"
    : gate.noBoq
      ? "Locked — generate the BoQ first"
      : "Locked — review your rate book or accept the market basis (above)";

  return (
    <div className="mx-auto max-w-[1344px] px-6 py-8 pb-16 lg:px-10" data-proposal data-gate={gate.ok ? "open" : "locked"} ref={(el) => el?.setAttribute("data-hydrated", "")}>
      <p className="t-label-caps text-bp-brass-text">{eyebrow}</p>
      <h1 className="t-heading-lg mt-2 text-bp-ink-primary">Client proposal</h1>
      <p className="t-body-md mt-2 max-w-[760px] text-bp-ink-secondary">Your firm&rsquo;s deliverable to its client — under your name, from the current revision, through the reference-basis gate.</p>

      {locked ? (
        <div className="mt-8">
          {gate.noFirm ? (
            <StateBlock kind="gate" title="Client proposal locked" options={["Attach your firm to this project on the project hub"]} actions={<Button kind="secondary" tone="inverse" href={`/project/${projectId}`}>Open the project hub</Button>}>
              A client proposal is the firm&rsquo;s document — this project has no firm attached.
            </StateBlock>
          ) : gate.noBoq ? (
            <StateBlock kind="gate" title="Client proposal locked" options={["Generate the BoQ from the plan"]} actions={<Button kind="secondary" tone="inverse" href={`/project/${projectId}/boq`}>Open BoQ &amp; Review</Button>}>
              There is no priced BoQ to propose yet.
            </StateBlock>
          ) : (
            <StateBlock
              kind="gate"
              title="Client proposal locked"
              options={[
                view.bookOpen && view.bookOpen.conflicts + view.bookOpen.outliers > 0
                  ? `Review your rate book (${view.bookOpen.conflicts} conflict${view.bookOpen.conflicts === 1 ? "" : "s"}, ${view.bookOpen.outliers} outlier${view.bookOpen.outliers === 1 ? "" : "s"} open)`
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
              {view.basis ? `${view.basis.referenceLines} of ${view.basis.totalLines} lines are priced from the market reference, not your book. ` : ""}A client document can&rsquo;t be priced from market reference without your say-so. One of these unlocks it:
            </StateBlock>
          )}
        </div>
      ) : null}

      {firm ? (
        <div className="mt-8 grid grid-cols-1 gap-10 xl:grid-cols-[minmax(0,1fr)_440px]">
          <section aria-labelledby="setup-h" className="min-w-0">
            <h2 id="setup-h" className="t-label-caps text-bp-ink-tertiary">
              SETUP · SAVED TO YOUR FIRM, REUSED ON EVERY PROPOSAL
            </h2>
            <div className="mt-4 space-y-5">
              <Field id="pp-name" label="DISPLAY NAME" hint="What your client sees as the sender. Your registered name stays as it is.">
                <input id="pp-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} onBlur={() => void saveBrand()} className={`${INPUT} h-10`} autoComplete="organization" />
              </Field>

              <div className="flex flex-col gap-1.5">
                <span className="t-label-caps text-bp-ink-tertiary" id="pp-logo-l">
                  LOGO
                </span>
                <div className="flex flex-wrap items-center gap-4 border border-dashed border-bp-line-control px-4 py-4" aria-labelledby="pp-logo-l">
                  <Icon name={firm.logo ? "image" : "upload"} className="text-bp-ink-secondary" />
                  <div className="min-w-0 flex-1">
                    <p className="t-body-sm text-bp-ink-primary">{firm.logo ? "Logo uploaded — shown on the cover and page headers" : "No logo yet — your display name is set as type until you add one"}</p>
                    <p className="t-label-md text-bp-ink-tertiary">PNG or JPG · up to 1 MB · shown on the cover and page headers</p>
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg"
                    className="sr-only"
                    tabIndex={-1}
                    aria-hidden="true"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadLogo(f);
                      e.target.value = "";
                    }}
                  />
                  <Button kind="secondary" onClick={() => fileRef.current?.click()}>
                    {firm.logo ? "Replace" : "Upload"}
                  </Button>
                </div>
              </div>

              <Field id="pp-client" label="CLIENT" hint="Shown on the cover. Never shared with anyone else.">
                <input id="pp-client" value={client} onChange={(e) => setClient(e.target.value)} onBlur={() => client !== (setup?.clientLabel ?? "") && void put({ client_label: client.trim() || null }, "Client")} placeholder="e.g. Private homeowner — Villa garden" className={`${INPUT} h-10`} autoComplete="off" />
              </Field>

              <Field id="pp-valid" label="VALIDITY · DAYS FROM ISSUE" hint="The cover and the terms print the date it runs to.">
                <input
                  id="pp-valid"
                  type="number"
                  min={1}
                  max={365}
                  inputMode="numeric"
                  value={validity}
                  onChange={(e) => setValidity(e.target.value)}
                  onBlur={() => {
                    const n = validity.trim() ? Math.round(Number(validity)) : null;
                    if (n !== null && (!Number.isFinite(n) || n < 1 || n > 365)) return setSave({ kind: "error", message: "Validity is 1 to 365 days." });
                    if (n !== (setup?.validityDays ?? null)) void put({ validity_days: n }, "Validity");
                  }}
                  className={`${INPUT} h-10 max-w-[200px] font-bp-mono`}
                />
              </Field>

              <Field id="pp-terms" label="PAYMENT TERMS">
                <textarea id="pp-terms" rows={3} value={terms} onChange={(e) => setTerms(e.target.value)} onBlur={() => terms !== (setup?.paymentTerms ?? "") && void put({ payment_terms: terms.trim() || null }, "Payment terms")} placeholder="e.g. 30% on signing · 40% on completion of hardscape · 30% on handover" className={`${INPUT} py-2`} />
              </Field>

              <Field id="pp-note" label="COVER NOTE" hint="Opens the scope page, in your words.">
                <textarea id="pp-note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (setup?.coverNote ?? "") && void put({ cover_note: note.trim() || null }, "Cover note")} className={`${INPUT} py-2`} />
              </Field>

              <label className="t-body-sm flex items-start gap-3 text-bp-ink-primary" data-testid="show-line-rates">
                <input
                  type="checkbox"
                  checked={rates}
                  onChange={(e) => {
                    setRates(e.target.checked);
                    void put({ show_line_rates: e.target.checked }, "Line rates");
                  }}
                  className="mt-0.5 h-4 w-4 rounded-none accent-bp-ink-primary"
                />
                <span>Show line rates to the client (off — section totals only; your book stays private)</span>
              </label>

              <p aria-live="polite" className="t-label-md min-h-5 text-bp-ink-tertiary" data-testid="setup-status">
                {save.kind === "saving" ? "Saving…" : save.kind === "saved" ? `${save.what} saved.` : ""}
              </p>
              {save.kind === "error" ? (
                <div role="alert" className="surface-inverse bg-bp-alert-surface px-4 py-3 text-bp-alert-ink">
                  <p className="t-body-sm">{save.message}</p>
                </div>
              ) : null}
            </div>
          </section>

          <aside className="min-w-0" aria-label="What the client receives">
            {view.receives.length ? (
              <>
                <h2 className="t-label-caps text-bp-ink-tertiary">WHAT THE CLIENT RECEIVES{view.rev ? ` · FROM REV ${view.rev}` : ""}</h2>
                <ol className="mt-3" data-testid="proposal-receives">
                  {view.receives.map((r) => (
                    <li key={r.n} className="grid grid-cols-[28px_minmax(0,1fr)] gap-2 border-b border-bp-line-hairline py-3">
                      <span className="t-num-sm text-bp-ink-tertiary">{r.n}</span>
                      <span>
                        <span className="t-heading-sm block text-bp-ink-primary">{r.title}</span>
                        <span className="t-label-md block text-bp-ink-secondary">{r.detail}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </>
            ) : null}
            {view.price ? <PricePreview price={view.price} /> : null}
          </aside>
        </div>
      ) : null}

      {firm ? (
        <div className="mt-10 flex flex-wrap items-center gap-4 border-t border-bp-line-hairline pt-5">
          <Button kind="primary" disabled={locked ? { reason: lockedReason, reasonId: genReason, showReason: true } : false} href={`/project/${projectId}/drawings?export=1&proposal=1`} testId="generate-proposal">
            Generate proposal
          </Button>
          {!locked ? <span className="t-label-md text-bp-ink-tertiary">Generated with the export pack on 06 Documents — every check runs first.</span> : null}
          <Button kind="quiet" onClick={() => setPreview(true)} testId="preview-as-client" disabled={gate.noBoq ? { reason: "Nothing to preview until the BoQ is generated", reasonId: `${genReason}-p`, showReason: true } : false}>
            Preview as client
          </Button>
        </div>
      ) : null}

      {preview ? <PreviewDialog projectId={projectId} onClose={() => setPreview(false)} /> : null}
    </div>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="t-label-caps text-bp-ink-tertiary">
        {label}
      </label>
      {children}
      {hint ? <span className="t-label-md text-bp-ink-tertiary">{hint}</span> : null}
    </div>
  );
}

function Row({ label, value, strong, muted, data }: { label: string; value: string; strong?: boolean; muted?: boolean; data?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 border-b border-bp-line-hairline py-2 ${strong ? "border-t border-t-bp-line-strong" : ""}`} data-price-row={data}>
      <span className={`${strong ? "t-heading-sm" : "t-body-sm"} ${muted ? "text-bp-ink-tertiary" : "text-bp-ink-primary"}`}>{label}</span>
      <span className={`${strong ? "t-num-lg" : "t-num-sm"} ${muted ? "text-bp-ink-tertiary" : "text-bp-ink-primary"}`}>{value}</span>
    </div>
  );
}

function PricePreview({ price }: { price: NonNullable<ProposalView["price"]> }) {
  return (
    <section className="mt-6" aria-labelledby="price-h" data-testid="price-preview">
      <h2 id="price-h" className="t-label-caps text-bp-ink-tertiary">
        03 · PRICE SUMMARY PREVIEW
      </h2>
      <div className="mt-2">
        {price.rows.map((r) => (
          <Row key={r.section} label={r.section} value={r.total == null ? "to be priced" : formatAED(r.total)} muted={r.total == null} />
        ))}
        <Row label="Subtotal" value={formatAED(price.subtotal)} data="subtotal" />
        {price.ohp ? <Row label={`OH&P ${price.ohp.pct}%`} value={formatAED(price.ohp.amount)} data="ohp" /> : null}
        <Row label={`Contingency ${price.contingency.pct}%`} value={formatAED(price.contingency.amount)} data="contingency" />
        <Row label={`VAT ${price.vat.pct}%`} value={formatAED(price.vat.amount)} data="vat" />
        <Row label="Total" value={price.totalText} strong data="total" />
      </div>
      {price.excludes || price.note ? (
        <p className="t-label-md mt-2 text-bp-ink-secondary">
          {price.excludes ? `* ${price.excludes}. ` : ""}
          {price.note ?? ""}
        </p>
      ) : null}
    </section>
  );
}

function PreviewDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [pages, setPages] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    closeRef.current?.focus();
    let live = true;
    fetch(`/api/projects/${projectId}/proposal-preview`, { cache: "no-store" })
      .then(async (r) => {
        const b = (await r.json().catch(() => ({}))) as { pages?: string[]; error?: string };
        if (!live) return;
        if (!r.ok || !b.pages) setError(b.error ?? `The preview could not be drawn (${r.status}).`);
        else setPages(b.pages);
      })
      .catch(() => live && setError("The preview could not be drawn."));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      live = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [projectId, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="proposal-preview">
      <div className="flex max-h-full w-full max-w-[880px] flex-col border border-bp-line-strong bg-bp-surface-base">
        <div className="flex items-center justify-between gap-4 border-b border-bp-line-hairline px-5 py-3">
          <h2 id={titleId} className="t-heading-sm text-bp-ink-primary">
            Preview as client · not issued
          </h2>
          <button ref={closeRef} type="button" onClick={onClose} className="t-label-md inline-flex h-9 items-center gap-1 px-2 text-bp-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring">
            <Icon name="close" size={18} />
            Close
          </button>
        </div>
        <div className="overflow-y-auto p-5" aria-busy={!pages && !error}>
          {error ? (
            <div role="alert" className="surface-inverse bg-bp-alert-surface px-4 py-3 text-bp-alert-ink">
              <p className="t-body-sm">{error}</p>
            </div>
          ) : !pages ? (
            <p className="t-body-sm text-bp-ink-secondary">Drawing the pages…</p>
          ) : (
            <ol className="space-y-6">
              {pages.map((p, i) => (
                <li key={i}>
                  <p className="t-label-md mb-1 text-bp-ink-tertiary">Page {i + 1}</p>
                  {/* Server-built SVG: every string escaped by the page primitives, identity-scanned by the route. */}
                  <div className="border border-bp-line-hairline bg-white" role="img" aria-label={`Proposal page ${i + 1}, preview`} dangerouslySetInnerHTML={{ __html: p.replace(/width="[\d.]+mm" height="[\d.]+mm"/, 'width="100%" height="auto" style="display:block"') }} />
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
