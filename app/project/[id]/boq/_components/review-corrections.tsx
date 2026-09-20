"use client";

import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

// G5: the review session's correction log. Every correction is typed — rate,
// quantity, scope or design — and recorded with market_fair provenance; the
// count and the mix of types are the pilot's headline metric. Nothing here edits
// the BoQ or the rate book.

type CorrectionType = "rate" | "quantity" | "scope" | "design" | "confirm";

interface LineOption {
  key: string;
  item_key: string | null;
  description: string;
  quantity: number;
  rate_aed: number;
  element_refs: string[] | null;
}

interface Correction {
  id: string;
  correction_type: CorrectionType;
  line_description: string;
  old_value: number | null;
  new_value: number | null;
  note: string | null;
  recorded_at: string;
}

const TYPES: { value: CorrectionType; label: string; hint: string }[] = [
  { value: "rate", label: "Rate", hint: "The unit rate is wrong for this market" },
  { value: "quantity", label: "Quantity", hint: "The measured quantity is wrong" },
  { value: "scope", label: "Scope", hint: "A line is missing, extra, or covers the wrong work" },
  { value: "design", label: "Design", hint: "The design itself changes (a different element or finish)" },
  // G5d: "this looks right" is a milestone, captured like any other reaction.
  { value: "confirm", label: "Confirm", hint: "The line (or the whole BoQ) is right as priced" },
];

export function ReviewCorrections({ projectId, boqId, lines }: { projectId: string; boqId: string | null; lines: LineOption[] }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Correction[]>([]);
  const [type, setType] = useState<CorrectionType>("rate");
  const [lineKey, setLineKey] = useState<string>(lines[0]?.key ?? "");
  const [newValue, setNewValue] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/boq-corrections?project_id=${projectId}`)
      .then((r) => r.json())
      .then((b) => !cancelled && setItems((b.corrections ?? []) as Correction[]))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const line = lines.find((l) => l.key === lineKey) ?? null;
  const counts = useMemo(() => {
    const c: Record<CorrectionType, number> = { rate: 0, quantity: 0, scope: 0, design: 0, confirm: 0 };
    for (const i of items) c[i.correction_type] += 1;
    return c;
  }, [items]);

  const oldValue = type === "rate" ? line?.rate_aed ?? null : type === "quantity" ? line?.quantity ?? null : null;

  const save = async () => {
    if (!line && type !== "scope" && type !== "design" && type !== "confirm") return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/boq-corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          boq_id: boqId,
          item_key: line?.item_key ?? null,
          line_description: line?.description ?? "(new line)",
          correction_type: type,
          field: type === "rate" ? "rate_aed" : type === "quantity" ? "quantity" : null,
          old_value: oldValue,
          new_value: newValue.trim() === "" ? null : Number(newValue),
          note: note.trim() || null,
          element_refs: line?.element_refs ?? null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
      setItems((cur) => [...cur, body.correction as Correction]);
      setNewValue("");
      setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mb-lg rounded-xl border border-ink-100 bg-paper p-md" aria-label="Review corrections">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="label-caps text-ink-500">Review corrections</p>
          <p className="font-mono text-[12px] tabular-nums text-ink-700">
            {items.length} captured · rate {counts.rate} · quantity {counts.quantity} · scope {counts.scope} · design {counts.design}
          </p>
        </div>
        <button type="button" onClick={() => setOpen((o) => !o)} className="focus-ring rounded-lg border border-ink-100 bg-paper px-3 py-1 text-[13px] font-semibold text-ink-900 hover:bg-surface-container">
          {open ? "Close" : "Capture a correction"}
        </button>
      </div>
      {open && (
        <div className="mt-sm space-y-2">
          <div className="inline-flex gap-0.5 rounded-lg border border-ink-100 bg-canvas p-0.5">
            {TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                title={t.hint}
                aria-pressed={type === t.value}
                onClick={() => setType(t.value)}
                className={cn("focus-ring rounded-md px-2.5 py-1 text-[12px]", type === t.value ? "bg-brass-600 text-on-primary" : "text-ink-700 hover:bg-surface-container")}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={lineKey} onChange={(e) => setLineKey(e.target.value)} className="focus-ring max-w-[480px] rounded border border-ink-100 bg-paper px-2 py-1 text-[13px]">
              {lines.map((l) => (
                <option key={l.key} value={l.key}>
                  {l.description.slice(0, 80)}
                </option>
              ))}
            </select>
            {(type === "rate" || type === "quantity") && (
              <>
                <span className="font-mono text-[12px] tabular-nums text-ink-500">now {oldValue ?? "—"}</span>
                <input value={newValue} onChange={(e) => setNewValue(e.target.value)} inputMode="decimal" placeholder={type === "rate" ? "fair rate AED" : "correct qty"} className="focus-ring w-[120px] rounded border border-ink-100 bg-paper px-2 py-1 text-right font-mono text-[13px] tabular-nums" />
              </>
            )}
          </div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="What was said, by whom (role, not name), and why" className="focus-ring w-full rounded border border-ink-100 bg-paper px-2 py-1 text-[13px]" />
          <div className="flex items-center gap-2">
            <button type="button" onClick={save} disabled={saving} className="focus-ring rounded-lg bg-brass-600 px-3 py-1 text-[13px] font-semibold text-on-primary disabled:opacity-50">
              {saving ? "Saving…" : "Record (market_fair)"}
            </button>
            {error && <span className="text-[12px] text-error">{error}</span>}
          </div>
          {items.length > 0 && (
            <ul className="divide-y divide-ink-100 text-[12px]">
              {items.map((c) => (
                <li key={c.id} className="flex flex-wrap gap-x-3 py-1">
                  <span className="font-semibold uppercase text-brass-600">{c.correction_type}</span>
                  <span className="text-ink-900">{c.line_description}</span>
                  {c.new_value != null && (
                    <span className="font-mono tabular-nums text-ink-700">
                      {c.old_value ?? "—"} → {c.new_value}
                    </span>
                  )}
                  {c.note && <span className="text-ink-500">{c.note}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
