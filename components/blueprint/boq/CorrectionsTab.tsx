"use client";

// =============================================================================
// components/blueprint/boq/CorrectionsTab.tsx — the inspector's Corrections tab
// (R7 §3.2, 16:1654): this line's corrections and the capture form.
//
// A correction is RECORDED, never applied (L1): saving one changes neither this
// BoQ nor any rate book. "Promote to our rate book after review" attributes a
// RATE correction to the project's firm — that is what puts it on the book's
// list of corrections to promote; a member then promotes it there (an explicit
// act, POST /api/firms/:id/promote) and regenerates, and the diff shows the
// move with this correction as its cause.
// =============================================================================

import { useId, useState } from "react";

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

export function CorrectionsTab({
  line,
  model,
  corrections,
  capturing,
  setCapturing,
  onSaved,
}: {
  line: ReviewLine;
  model: ReviewModel;
  corrections: Correction[];
  capturing: boolean;
  setCapturing: (v: boolean) => void;
  onSaved: (c: Correction) => void;
}) {
  const [kind, setKind] = useState<Kind>("rate");
  const [value, setValue] = useState("");
  const [basis, setBasis] = useState("");
  const [promote, setPromote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = useId();
  const unit = displayUnit(line.unit);

  const n = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(n) && n >= 0;
  const effect =
    valid && kind === "rate" ? { total: lineTotal(line.quantity, n), text: `${formatQty(line.quantity)} × ${formatAED(n)}` } : valid && kind === "quantity" ? { total: lineTotal(n, line.rate), text: `${formatQty(n)} × ${formatAED(line.rate)}` } : null;
  const canPromote = model.persona === "firm" && !!model.firm && kind === "rate" && !!line.itemKey;
  const promoteWhy = model.persona !== "firm" || !model.firm ? "Only a firm's own book can take a promoted rate — this project has none." : kind !== "rate" ? "Only a rate correction can be promoted into a rate book." : !line.itemKey ? "This line has no rate-book item to promote to." : "";

  async function save(type: Kind | "confirm") {
    setBusy(true);
    setError(null);
    try {
      const numeric = type === "rate" || type === "quantity";
      const res = await fetch("/api/boq-corrections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: model.projectId,
          boq_id: model.boqId,
          item_key: line.itemKey,
          line_description: lineLabel(line),
          correction_type: type,
          field: type === "rate" ? "rate_aed" : type === "quantity" ? "quantity" : null,
          old_value: type === "rate" ? line.rate : type === "quantity" ? line.quantity : null,
          new_value: numeric && valid ? n : null,
          note: basis.trim() || null,
          element_refs: line.elementRefs.length ? line.elementRefs : null,
          ...(type === "rate" && promote && canPromote ? { firm_id: model.firm!.id } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; correction?: Correction };
      if (!res.ok || !body.correction) throw new Error(body.error ?? `The correction was not saved (${res.status}).`);
      onSaved({ ...body.correction, item_key: line.itemKey, line_description: lineLabel(line) });
      setValue("");
      setBasis("");
      setPromote(false);
      setCapturing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The correction was not saved.");
    } finally {
      setBusy(false);
    }
  }

  if (!capturing) {
    return (
      <div>
        <p className="t-label-caps text-bp-ink-tertiary">
          {line.ref} · CORRECTIONS · {corrections.length}
        </p>
        {corrections.length === 0 ? (
          <p className="t-body-sm mt-3 text-bp-ink-secondary">No corrections on this line yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-bp-line-hairline border-y border-bp-line-hairline">
            {corrections.map((c) => (
              <li key={c.id} className="py-3">
                <p className="flex items-baseline justify-between gap-3">
                  <span className="t-label-caps text-bp-ink-primary">{c.correction_type}</span>
                  <span className="t-label-md text-bp-ink-tertiary">{c.recorded_at.slice(0, 10)}</span>
                </p>
                {c.new_value != null ? (
                  <p className="t-num-sm mt-1">
                    {c.old_value != null ? formatAED(c.old_value) : "—"} → {formatAED(c.new_value)}
                  </p>
                ) : null}
                {c.note ? <p className="t-body-sm mt-1 text-bp-ink-secondary">{c.note}</p> : null}
                {c.promoted_at ? <p className="t-label-md mt-1 text-bp-ink-tertiary">promoted into the book</p> : c.firm_id ? <p className="t-label-md mt-1 text-bp-ink-tertiary">awaiting promotion in the book</p> : null}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-6">
          <Button kind="secondary" onClick={() => setCapturing(true)}>
            Capture correction
          </Button>
          <Button kind="quiet" onClick={busy ? undefined : () => save("confirm")}>
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

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        // aria-disabled keeps the button focusable (§4.2 #6), so the guard lives here.
        if (busy || ((kind === "rate" || kind === "quantity") && !valid)) return;
        void save(kind);
      }}
    >
      <p className="t-label-caps text-bp-ink-tertiary">{line.ref} · CAPTURE CORRECTION</p>
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

      {kind === "rate" || kind === "quantity" ? (
        <>
          <p className="mt-4 flex items-center gap-3">
            <span className="t-label-caps w-20 text-bp-ink-tertiary">CURRENT</span>
            <span className="t-num-sm">{kind === "rate" ? `${line.unpriced ? "—" : formatAED(line.rate)} / ${unit}` : `${formatQty(line.quantity)} ${unit}`}</span>
            <ProvenanceMark tier={kind === "rate" ? line.tiers.rate : line.tiers.qty} />
          </p>
          <label htmlFor={`${ids}-value`} className="t-label-caps mt-4 block text-bp-ink-tertiary">
            {kind === "rate" ? "CORRECTED RATE" : "CORRECTED QUANTITY"}
          </label>
          <div className="mt-1 flex items-center border border-bp-line-control bg-bp-surface-base px-3">
            <input id={`${ids}-value`} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className="t-num-md h-10 min-w-0 flex-1 bg-transparent outline-none" aria-describedby={`${ids}-effect`} />
            <span className="t-label-md text-bp-ink-tertiary">{kind === "rate" ? `AED / ${unit}` : unit}</span>
          </div>
          <p id={`${ids}-effect`} className="t-label-md mt-1 text-bp-ink-secondary" aria-live="polite">
            {effect ? (
              <>
                {effect.text} = {formatAED(effect.total)}
                <br />
                line effect {formatDelta(Math.round((effect.total - line.amount) * 100) / 100)}
              </>
            ) : (
              "Enter the corrected figure to see its effect on this line."
            )}
          </p>
        </>
      ) : null}

      <label htmlFor={`${ids}-basis`} className="t-label-caps mt-4 block text-bp-ink-tertiary">
        BASIS
      </label>
      <input
        id={`${ids}-basis`}
        value={basis}
        onChange={(e) => setBasis(e.target.value)}
        placeholder={kind === "rate" ? "Firm quote — aluminium pergola, Oct 2026" : kind === "quantity" ? "Site measurement, 12 Oct" : "What changes, and why"}
        className="t-body-sm mt-1 h-10 w-full rounded-none border border-bp-line-control bg-bp-surface-base px-3 text-bp-ink-primary"
      />

      <label className={`mt-4 flex items-center gap-3 ${canPromote ? "cursor-pointer" : ""}`}>
        <input type="checkbox" checked={promote && canPromote} onChange={() => canPromote && setPromote((p) => !p)} aria-disabled={!canPromote} aria-describedby={!canPromote ? `${ids}-promote-why` : undefined} className="size-4 accent-bp-ink-primary" />
        <span className={`t-body-sm ${canPromote ? "text-bp-ink-primary" : "text-bp-ink-tertiary"}`}>Promote to our rate book after review</span>
      </label>
      {!canPromote ? (
        <p id={`${ids}-promote-why`} className="t-label-md mt-1 pl-7 text-bp-ink-tertiary">
          {promoteWhy}
        </p>
      ) : null}

      <p className="t-body-sm mt-4 flex gap-2 bg-bp-surface-sunken p-3 text-bp-ink-secondary">
        <Icon name="info" size={18} className="shrink-0" />A correction never changes this BoQ by itself. Promote it to your book, then regenerate — the diff shows the change with this correction as its cause.
      </p>

      {error ? (
        <p role="alert" className="t-body-sm mt-3 text-bp-ink-primary">
          {error}
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap items-center gap-6 border-t border-bp-line-hairline pt-4">
        <Button kind="primary" type="submit" disabled={busy || ((kind === "rate" || kind === "quantity") && !valid) ? { reason: busy ? "Saving…" : "Enter the corrected figure first", reasonId: `${ids}-save-why` } : false}>
          {busy ? "Saving…" : "Save correction"}
        </Button>
        <Button kind="quiet" onClick={() => setCapturing(false)}>
          Cancel
        </Button>
        {(busy || ((kind === "rate" || kind === "quantity") && !valid)) && (
          <span id={`${ids}-save-why`} className="sr-only">
            {busy ? "Saving…" : "Enter the corrected figure first"}
          </span>
        )}
      </div>
    </form>
  );
}
