"use client";

// =============================================================================
// components/blueprint/boq/CorrectionsTab.tsx — the inspector's corrections
// (R7 §3.2, 16:1654) and, since K11 #4, prices added on review (spec §7.3,
// 80:9042 · 80:9088). Supersedes the J3 rule "a correction never changes this
// BoQ by itself".
//
//   CaptureForm      one form, two flavours:
//     · Add a price — an unpriced line's Rate: your rate (AED / unit), its basis
//       (a supplier's quote / a contractor's price / my own estimate + note),
//       the live line effect, Primary "Apply price";
//     · Capture correction — Rate / Quantity / Scope / Design, the corrected
//       figure and basis, then "Apply to this BoQ now" (the owner's default) or
//       "Save for review only" (the firm's default; "Promote to our rate book
//       after review" unchanged). Scope and design corrections carry no figure
//       — they are saved for review.
//     Applying = POST /api/projects/:id/boq-apply: the NEXT revision, with the
//     line as your price (own basis); the page refreshes to it at once. Undo =
//     revert in Revisions.
//   CorrectionsList  this line's corrections; a saved rate / quantity one can be
//     applied from here; applied and reverted ones say so.
// =============================================================================

import { useId, useState } from "react";

import { BASIS_KINDS, BASIS_LABEL, type BasisKind } from "@/lib/boq/own-basis-vocab";
import { formatAED, formatDelta, formatQty } from "@/lib/format/aed";
import type { ReviewLine, ReviewModel } from "@/lib/boq/review-types";
import { lineTotal } from "@/lib/boq/money";

import { Button } from "../Button";
import { Icon } from "../Icon";
import { ProvenanceMark } from "../ProvenanceMark";
import { displayUnit } from "./format";

export interface Correction {
  id: string;
  correction_type: "rate" | "quantity" | "scope" | "design" | "confirm";
  line_description: string;
  item_key?: string | null;
  old_value: number | null;
  new_value: number | null;
  note: string | null;
  recorded_at: string;
  firm_id?: string | null;
  promoted_at?: string | null;
  // K11 #4 (057)
  origin?: "correction" | "add_price" | null;
  basis_kind?: BasisKind | null;
  applied_boq_id?: string | null;
  applied_at?: string | null;
  applied_by_name?: string | null;
  reverted_at?: string | null;
}

/** What boq-apply answers — the new revision. */
export interface Applied {
  boqId: string;
  rev: number;
  previousBoqId: string;
  previousTotal: number;
  total: number;
  origin: "correction" | "add_price";
  ref: string;
}

type Kind = "rate" | "quantity" | "scope" | "design";
const KINDS: { value: Kind; label: string }[] = [
  { value: "rate", label: "Rate" },
  { value: "quantity", label: "Quantity" },
  { value: "scope", label: "Scope" },
  { value: "design", label: "Design" },
];

/** How a correction names its line (the same words the review session wrote). */
export const lineLabel = (l: ReviewLine) => `${l.section} — ${l.description}`;

/** This line's corrections: by item key when both carry one, else by its description. */
export function correctionsFor(all: Correction[], l: ReviewLine): Correction[] {
  return all.filter((c) => (l.itemKey && c.item_key ? c.item_key === l.itemKey && c.line_description.includes(l.description) : c.line_description.includes(l.description)));
}

/** Apply a correction (new or saved) as the next revision. Throws with the route's own words. */
async function postApply(model: ReviewModel, body: Record<string, unknown>): Promise<{ boq_id: string; rev: number; previous_boq_id: string; previous_total_aed: number; grand_total_aed: number }> {
  const res = await fetch(`/api/projects/${model.projectId}/boq-apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ boq_id: model.boqId, ...body }) });
  const out = (await res.json().catch(() => ({}))) as { error?: string; boq_id?: string; rev?: number; previous_boq_id?: string; previous_total_aed?: number; grand_total_aed?: number };
  if (!res.ok || !out.boq_id) throw new Error(out.error ?? `The BoQ was not updated (${res.status}).`);
  return out as { boq_id: string; rev: number; previous_boq_id: string; previous_total_aed: number; grand_total_aed: number };
}

const toApplied = (r: Awaited<ReturnType<typeof postApply>>, origin: Applied["origin"], ref: string): Applied => ({ boqId: r.boq_id, rev: r.rev, previousBoqId: r.previous_boq_id, previousTotal: r.previous_total_aed, total: r.grand_total_aed, origin, ref });

export function CorrectionsList({ line, model, corrections, onCapture, onApplied }: { line: ReviewLine; model: ReviewModel; corrections: Correction[]; onCapture: () => void; onApplied: (a: Applied) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function confirmLine() {
    setBusy("confirm");
    setError(null);
    try {
      const res = await fetch("/api/boq-corrections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project_id: model.projectId, boq_id: model.boqId, item_key: line.itemKey, line_description: lineLabel(line), correction_type: "confirm", row_key: line.key, line_ref: line.ref }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Not saved (${res.status}).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Not saved.");
    } finally {
      setBusy(null);
    }
  }
  async function applySaved(c: Correction) {
    setBusy(c.id);
    setError(null);
    try {
      onApplied(toApplied(await postApply(model, { correction_id: c.id, row_key: line.key }), "correction", line.ref));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The BoQ was not updated.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <p className="t-label-caps text-bp-ink-tertiary">
        {line.ref} · CORRECTIONS · {corrections.length}
      </p>
      {corrections.length === 0 ? (
        <p className="t-body-sm mt-3 text-bp-ink-secondary">No corrections on this line yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-bp-line-hairline border-y border-bp-line-hairline">
          {corrections.map((c) => {
            const applied = !!c.applied_boq_id && !c.reverted_at;
            const applicable = (c.correction_type === "rate" || c.correction_type === "quantity") && c.new_value != null && !applied;
            return (
              <li key={c.id} className="py-3" data-correction={c.id} data-applied={applied ? "true" : "false"}>
                <p className="flex items-baseline justify-between gap-3">
                  <span className="t-label-caps text-bp-ink-primary">{c.origin === "add_price" ? "price added" : c.correction_type}</span>
                  <span className="t-label-md text-bp-ink-tertiary">{(c.applied_at ?? c.recorded_at).slice(0, 10)}</span>
                </p>
                {c.new_value != null ? (
                  <p className="t-num-sm mt-1">
                    {c.old_value != null && !(c.origin === "add_price" && c.old_value === 0) ? `${c.correction_type === "rate" ? formatAED(c.old_value) : formatQty(c.old_value)} → ` : ""}
                    {c.correction_type === "rate" ? formatAED(c.new_value) : formatQty(c.new_value)}
                  </p>
                ) : null}
                {c.basis_kind || c.note ? <p className="t-body-sm mt-1 text-bp-ink-secondary">{[c.basis_kind ? BASIS_LABEL[c.basis_kind] : null, c.note].filter(Boolean).join(" — ")}</p> : null}
                {applied ? (
                  <p className="t-label-md mt-1 text-bp-ink-tertiary">applied to the BoQ{c.applied_by_name ? ` by ${c.applied_by_name}` : ""} — undo it from Revisions</p>
                ) : c.reverted_at ? (
                  <p className="t-label-md mt-1 text-bp-ink-tertiary">reverted {c.reverted_at.slice(0, 10)} — no longer applies</p>
                ) : c.promoted_at ? (
                  <p className="t-label-md mt-1 text-bp-ink-tertiary">promoted into the book</p>
                ) : c.firm_id ? (
                  <p className="t-label-md mt-1 text-bp-ink-tertiary">awaiting promotion in the book</p>
                ) : null}
                {applicable ? (
                  <div className="mt-2">
                    <Button kind="quiet" onClick={busy ? undefined : () => void applySaved(c)} testId="apply-saved-correction">
                      {busy === c.id ? "Applying…" : "Apply to this BoQ"}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-6">
        <Button kind="secondary" onClick={onCapture}>
          Capture correction
        </Button>
        <Button kind="quiet" onClick={busy ? undefined : () => void confirmLine()}>
          This line is right
        </Button>
      </div>
      {error ? (
        <p role="alert" className="t-body-sm mt-3 text-bp-ink-primary">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function CaptureForm({
  line,
  model,
  onCancel,
  onSaved,
  onApplied,
}: {
  line: ReviewLine;
  model: ReviewModel;
  onCancel: () => void;
  onSaved: (c: Correction) => void;
  onApplied: (a: Applied) => void;
}) {
  const firm = model.persona === "firm";
  const [kind, setKind] = useState<Kind>("rate");
  const [value, setValue] = useState("");
  const [basisKind, setBasisKind] = useState<BasisKind>("supplier_quote");
  const [basis, setBasis] = useState("");
  const [promote, setPromote] = useState(false);
  // Spec §7.3: owners apply by default; firms save for review by default.
  const [apply, setApply] = useState(!firm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = useId();
  const unit = displayUnit(line.unit);

  // An unpriced line's rate is a price added, not a correction of one.
  const pricing = line.unpriced && kind === "rate";
  const figure = kind === "rate" || kind === "quantity";
  const applying = pricing || (figure && apply);
  const n = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(n) && (pricing ? n > 0 : n >= 0);
  const effect =
    valid && kind === "rate" ? { total: lineTotal(line.quantity, n), text: `${formatQty(line.quantity)} × ${formatAED(n)}` } : valid && kind === "quantity" ? { total: lineTotal(n, line.rate), text: `${formatQty(n)} × ${formatAED(line.rate)}` } : null;
  const canPromote = firm && !!model.firm && kind === "rate" && !!line.itemKey;
  const promoteWhy = !firm || !model.firm ? "Only a firm's own book can take a promoted rate — this project has none." : kind !== "rate" ? "Only a rate correction can be promoted into a rate book." : !line.itemKey ? "This line has no rate-book item to promote to." : "";
  const blockedWhy = busy ? (applying ? "Applying…" : "Saving…") : figure && !valid ? (pricing ? "Enter your rate above zero first" : "Enter the corrected figure first") : null;
  const nextRev = model.rev + 1;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (applying) {
        const r = await postApply(model, {
          row_key: line.key,
          correction_type: kind,
          new_value: n,
          origin: pricing ? "add_price" : "correction",
          basis_kind: pricing ? basisKind : null,
          note: basis.trim() || null,
          line_ref: line.ref,
          line_description: lineLabel(line),
          element_refs: line.elementRefs.length ? line.elementRefs : null,
          ...(promote && canPromote ? { firm_id: model.firm!.id } : {}),
        });
        onApplied(toApplied(r, pricing ? "add_price" : "correction", line.ref));
        return;
      }
      const res = await fetch("/api/boq-corrections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: model.projectId,
          boq_id: model.boqId,
          item_key: line.itemKey,
          line_description: lineLabel(line),
          correction_type: kind,
          field: kind === "rate" ? "rate_aed" : kind === "quantity" ? "quantity" : null,
          old_value: kind === "rate" ? line.rate : kind === "quantity" ? line.quantity : null,
          new_value: figure && valid ? n : null,
          note: basis.trim() || null,
          element_refs: line.elementRefs.length ? line.elementRefs : null,
          row_key: line.key,
          line_ref: line.ref,
          ...(kind === "rate" && promote && canPromote ? { firm_id: model.firm!.id } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; correction?: Correction };
      if (!res.ok || !body.correction) throw new Error(body.error ?? `The correction was not saved (${res.status}).`);
      onSaved({ ...body.correction, item_key: line.itemKey, line_description: lineLabel(line) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The correction was not saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        // aria-disabled keeps the button focusable (§4.2 #6), so the guard lives here.
        if (blockedWhy) return;
        void submit();
      }}
      data-capture={pricing ? "price" : "correction"}
    >
      <p className="t-label-caps text-bp-ink-tertiary">
        {line.ref} · {pricing ? "ADD A PRICE" : "CAPTURE CORRECTION"}
      </p>
      <fieldset className="mt-3">
        <legend className="sr-only">Correction type</legend>
        <div className="flex gap-5 border-b border-bp-line-hairline">
          {KINDS.map((k) => (
            <label key={k.value} className={`t-nav-item -mb-px cursor-pointer border-b-2 pb-2 ${kind === k.value ? "border-bp-brass t-nav-item-active text-bp-ink-primary" : "border-transparent text-bp-ink-secondary"}`}>
              <input type="radio" name={`${ids}-kind`} value={k.value} checked={kind === k.value} onChange={() => setKind(k.value)} className="sr-only" />
              {k.label}
            </label>
          ))}
        </div>
      </fieldset>

      {figure ? (
        <>
          <p className="mt-4 flex items-center gap-3">
            <span className="t-label-caps w-20 text-bp-ink-tertiary">CURRENT</span>
            <span className="t-num-sm">{kind === "rate" ? (line.unpriced ? "Not priced — excluded" : `${formatAED(line.rate)} / ${unit}`) : `${formatQty(line.quantity)} ${unit}`}</span>
            <ProvenanceMark tier={kind === "rate" ? line.tiers.rate : line.tiers.qty} />
          </p>
          <label htmlFor={`${ids}-value`} className="t-label-caps mt-4 block text-bp-ink-tertiary">
            {pricing ? "YOUR RATE" : kind === "rate" ? "CORRECTED RATE" : "CORRECTED QUANTITY"}
          </label>
          <div className="mt-1 flex items-center border border-bp-line-control bg-bp-surface-base px-3">
            <input id={`${ids}-value`} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className="t-num-md h-10 min-w-0 flex-1 bg-transparent outline-none" aria-describedby={`${ids}-effect`} data-capture-value="" />
            <span className="t-label-md text-bp-ink-tertiary">{kind === "rate" ? `AED / ${unit}` : unit}</span>
          </div>
          <p id={`${ids}-effect`} className="t-label-md mt-1 font-bp-mono text-bp-ink-secondary" aria-live="polite" data-capture-effect="">
            {effect ? (
              <>
                {effect.text} = {formatAED(effect.total)}
                <br />
                {pricing || line.unpriced ? `adds ${formatAED(effect.total)} to the subtotal` : `line effect ${formatDelta(Math.round((effect.total - line.amount) * 100) / 100)}`}
              </>
            ) : pricing ? (
              "Enter your rate to see what it adds to the subtotal."
            ) : (
              "Enter the corrected figure to see its effect on this line."
            )}
          </p>
        </>
      ) : null}

      <label htmlFor={pricing ? `${ids}-basis-kind` : `${ids}-basis`} className="t-label-caps mt-4 block text-bp-ink-tertiary">
        BASIS
      </label>
      {pricing ? (
        <select id={`${ids}-basis-kind`} value={basisKind} onChange={(e) => setBasisKind(e.target.value as BasisKind)} className="t-body-sm mt-1 h-10 w-full rounded-none border border-bp-line-control bg-bp-surface-base px-3 text-bp-ink-primary" data-basis-kind="">
          {BASIS_KINDS.map((k) => (
            <option key={k} value={k}>
              {BASIS_LABEL[k]}
            </option>
          ))}
        </select>
      ) : null}
      <input
        id={`${ids}-basis`}
        aria-label={pricing ? "Basis note" : undefined}
        value={basis}
        onChange={(e) => setBasis(e.target.value)}
        placeholder={pricing ? "Note — e.g. Oct 2026, ref Q-114" : kind === "rate" ? "Firm quote — aluminium pergola, Oct 2026" : kind === "quantity" ? "Site measurement, 12 Oct" : "What changes, and why"}
        className="t-body-sm mt-2 h-10 w-full rounded-none border border-bp-line-control bg-bp-surface-base px-3 text-bp-ink-primary"
      />

      {!pricing ? (
        <>
          <label className={`mt-4 flex items-center gap-3 ${canPromote ? "cursor-pointer" : ""}`}>
            <input type="checkbox" checked={promote && canPromote} onChange={() => canPromote && setPromote((p) => !p)} aria-disabled={!canPromote} aria-describedby={!canPromote ? `${ids}-promote-why` : undefined} className="size-4 accent-bp-ink-primary" />
            <span className={`t-body-sm ${canPromote ? "text-bp-ink-primary" : "text-bp-ink-tertiary"}`}>Promote to our rate book after review</span>
          </label>
          {!canPromote ? (
            <p id={`${ids}-promote-why`} className="t-label-md mt-1 pl-7 text-bp-ink-tertiary">
              {promoteWhy}
            </p>
          ) : null}
        </>
      ) : null}

      {!pricing && figure ? (
        <fieldset className="mt-4 space-y-3" data-apply-choice="">
          <legend className="sr-only">What happens to the BoQ</legend>
          <label className="flex cursor-pointer gap-3">
            <input type="radio" name={`${ids}-apply`} checked={apply} onChange={() => setApply(true)} className="mt-1 size-4 accent-bp-ink-primary" data-apply-now="" />
            <span>
              <span className="t-nav-item-active block text-bp-ink-primary">Apply to this BoQ now</span>
              <span className="t-body-sm block text-bp-ink-secondary">
                Creates rev {nextRev} with your {kind === "rate" ? "rate" : "quantity"} on this line. Undo from Revisions.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer gap-3">
            <input type="radio" name={`${ids}-apply`} checked={!apply} onChange={() => setApply(false)} className="mt-1 size-4 accent-bp-ink-primary" data-save-only="" />
            <span>
              <span className="t-nav-item-active block text-bp-ink-primary">Save for review only</span>
              <span className="t-body-sm block text-bp-ink-secondary">Keeps it as a note; the BoQ doesn&rsquo;t change.</span>
            </span>
          </label>
        </fieldset>
      ) : null}

      <p className="t-body-sm mt-4 flex gap-2 bg-bp-surface-sunken p-3 text-bp-ink-secondary">
        <Icon name="info" size={18} className="shrink-0" />
        {pricing
          ? `It enters rev ${nextRev} as your price, with the own-basis mark. The total updates straight away; undo it from Revisions.`
          : applying
            ? `It enters rev ${nextRev} with the own-basis mark. The total updates straight away; undo it from Revisions.`
            : figure
              ? "Saved as a note on this line — the BoQ doesn’t change until it is applied (here, or later from the Corrections tab)."
              : "A scope or design correction is a note for review — it has no figure to apply."}
      </p>

      {error ? (
        <p role="alert" className="t-body-sm mt-3 text-bp-ink-primary">
          {error}
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap items-center gap-6 border-t border-bp-line-hairline pt-4">
        <Button kind="primary" type="submit" disabled={blockedWhy ? { reason: blockedWhy, reasonId: `${ids}-save-why` } : false} testId="capture-submit">
          {busy ? (applying ? "Applying…" : "Saving…") : pricing ? "Apply price" : applying ? "Apply correction" : "Save correction"}
        </Button>
        <Button kind="quiet" onClick={onCancel}>
          Cancel
        </Button>
        {blockedWhy ? (
          <span id={`${ids}-save-why`} className="sr-only">
            {blockedWhy}
          </span>
        ) : null}
      </div>
    </form>
  );
}
