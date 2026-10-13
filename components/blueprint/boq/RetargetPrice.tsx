"use client";

// =============================================================================
// components/blueprint/boq/RetargetPrice.tsx — "Re-apply to…" (K11): an
// applied price whose line no longer matches after a regenerate is pinned to a
// line the member CHOOSES (never guessed). Applying creates the next revision
// exactly like Add a price (POST /api/projects/:id/boq-apply { correction_id,
// row_key, retarget: true }).
// =============================================================================

import { useEffect, useId, useRef, useState } from "react";

import type { ReviewModel } from "@/lib/boq/review-types";

import { Button } from "../Button";
import type { Applied } from "./CorrectionsTab";
import { displayUnit } from "./format";

export function RetargetPrice({ model, correctionId, item, onClose, onApplied }: { model: ReviewModel; correctionId: string; item: string; onClose: () => void; onApplied: (a: Applied) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const selectId = useId();
  const lines = model.sections.flatMap((s) => s.lines);
  const [rowKey, setRowKey] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  async function apply() {
    if (!rowKey || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${model.projectId}/boq-apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ boq_id: model.boqId, correction_id: correctionId, row_key: rowKey, retarget: true }) });
      const out = (await res.json().catch(() => ({}))) as { error?: string; boq_id?: string; rev?: number; previous_boq_id?: string; previous_total_aed?: number; grand_total_aed?: number };
      if (!res.ok || !out.boq_id) throw new Error(out.error ?? `Not applied (${res.status}).`);
      const line = lines.find((l) => l.key === rowKey);
      onApplied({ boqId: out.boq_id, rev: out.rev!, previousBoqId: out.previous_boq_id!, previousTotal: out.previous_total_aed!, total: out.grand_total_aed!, origin: "correction", ref: line?.ref ?? "" });
      ref.current?.close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Not applied.");
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className="m-auto w-[min(544px,calc(100vw-32px))] max-h-[calc(100vh-32px)] overflow-y-auto rounded-none border border-bp-line-strong bg-bp-surface-base p-0 text-left text-bp-ink-primary backdrop:bg-black/55"
      data-testid="retarget-dialog"
    >
      <form
        className="p-8"
        onSubmit={(e) => {
          e.preventDefault();
          void apply();
        }}
      >
        <p className="t-label-caps text-bp-ink-tertiary">RE-APPLY YOUR PRICE</p>
        <h2 id={titleId} className="t-heading-lg mt-3">
          Your price for {item}
        </h2>
        <p className="t-body-md mt-4">Its line is not in this revision. Choose the line it belongs to now — it enters the next revision there as your price. Nothing is matched for you.</p>
        <label htmlFor={selectId} className="t-label-caps mt-6 block text-bp-ink-tertiary">
          LINE
        </label>
        <select id={selectId} value={rowKey} onChange={(e) => setRowKey(e.target.value)} className="t-body-sm mt-1 h-11 w-full rounded-none border border-bp-line-control bg-bp-surface-base px-3 text-bp-ink-primary" data-retarget-line="">
          <option value="">Choose a line…</option>
          {model.sections.map((s) => (
            <optgroup key={s.name} label={s.name}>
              {s.lines.map((l) => (
                <option key={l.key} value={l.key}>
                  {l.ref} · {l.description} ({displayUnit(l.unit)})
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {error ? (
          <p role="alert" className="surface-inverse t-body-sm mt-4 bg-bp-alert-surface px-4 py-3 text-bp-alert-ink">
            {error}
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap items-center justify-end gap-5">
          <Button kind="quiet" onClick={() => ref.current?.close()}>
            Cancel
          </Button>
          <Button kind="primary" type="submit" testId="retarget-apply" disabled={!rowKey || busy ? { reason: busy ? "Applying…" : "Choose a line first", reasonId: `${titleId}-why` } : false}>
            {busy ? "Applying…" : "Re-apply price"}
          </Button>
        </div>
        <p id={`${titleId}-why`} className="sr-only">
          {busy ? "Applying…" : !rowKey ? "Choose a line first" : ""}
        </p>
      </form>
    </dialog>
  );
}
