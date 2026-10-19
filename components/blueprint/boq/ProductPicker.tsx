"use client";

// =============================================================================
// components/blueprint/boq/ProductPicker.tsx — "Choose a cheaper product" in the
// BoQ inspector's Line tab (bathroom pilot B7 5).
//
// A line in a product group (shower glass, shower valve, vanity, fittings grade,
// waste removal, shower niche — lib/boq/product-swaps.ts) offers the group's
// products. Choosing one writes the room's choice (POST
// /api/projects/:id/product-swap) and regenerates the BoQ: a new revision whose
// cause reads "Product changed by <name>". The quantity never moves; the
// product, its line and its rate do.
// =============================================================================

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { Button } from "@/components/blueprint/Button";
import { formatAED } from "@/lib/format/aed";
import type { ReviewLine } from "@/lib/boq/review-types";

export function ProductPicker({ projectId, product }: { projectId: string; product: NonNullable<ReviewLine["product"]> }) {
  const router = useRouter();
  const ids = useId();
  const [pick, setPick] = useState<string | boolean>(product.current);
  const [state, setState] = useState<{ kind: "idle" } | { kind: "running" } | { kind: "done"; text: string } | { kind: "error"; text: string }>({ kind: "idle" });
  const chosen = product.options.find((o) => o.value === pick)!;

  async function use() {
    setState({ kind: "running" });
    try {
      const swap = await fetch(`/api/projects/${projectId}/product-swap`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ field: product.field, value: pick }) });
      const s = (await swap.json().catch(() => ({}))) as { error?: string };
      if (!swap.ok) throw new Error(s.error ?? `Not changed (${swap.status}).`);
      const gen = await fetch("/api/generate-boq", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project_id: projectId }) });
      const g = (await gen.json().catch(() => ({}))) as { grand_total_aed?: number; previous_total_aed?: number | null; error?: string };
      if (!gen.ok || typeof g.grand_total_aed !== "number") throw new Error(g.error ?? "The product is changed — regenerate the BoQ to price it.");
      const delta = typeof g.previous_total_aed === "number" ? g.grand_total_aed - g.previous_total_aed : null;
      setState({ kind: "done", text: `New revision: AED ${formatAED(g.grand_total_aed)}${delta != null ? ` (${delta < 0 ? "−" : "+"}AED ${formatAED(Math.abs(delta))})` : ""}` });
      router.refresh();
    } catch (e) {
      setState({ kind: "error", text: e instanceof Error ? e.message : "Not changed." });
    }
  }

  return (
    <div data-product-picker={product.field}>
      <p className="flex items-center gap-2">
        <span className="t-label-caps text-bp-ink-tertiary">PRODUCT · {product.group.toUpperCase()}</span>
      </p>
      <fieldset className="mt-2" aria-describedby={`${ids}-note`}>
        <legend className="t-body-sm text-bp-ink-secondary">Choose a cheaper product</legend>
        {product.options.map((o) => {
          const id = `${ids}-${String(o.value)}`;
          return (
            <label key={id} htmlFor={id} className="mt-2 flex items-start gap-2">
              <input id={id} type="radio" name={`${ids}-p`} checked={pick === o.value} onChange={() => setPick(o.value)} className="mt-1 accent-bp-ink-primary" data-product-option={String(o.value)} />
              <span className="min-w-0 flex-1">
                <span className="t-body-sm text-bp-ink-primary">{o.label}</span>
                {o.value === product.current ? <span className="t-label-md ml-2 text-bp-ink-tertiary">in this BoQ</span> : null}
                <span className="t-num-sm block text-bp-ink-secondary">{o.rate != null ? `AED ${formatAED(o.rate)} / ${o.unit} · ${o.basis === "catalogue" ? "catalogue price" : o.basis === "calibrated" ? "reference-villa price" : "estimate (allowance)"}` : "market rate — priced on regenerate"}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      <p id={`${ids}-note`} className="t-body-sm mt-2 text-bp-ink-secondary">
        Changing the product makes a new revision; the drawings and renders follow the new design.
      </p>
      <div className="mt-3">
        <Button kind="secondary" onClick={() => void use()} disabled={pick === product.current || state.kind === "running" ? { reason: pick === product.current ? "This is the product in the BoQ — choose another to change it." : "Changing the product…", reasonId: `${ids}-why`, showReason: true } : false} testId="product-use">
          {state.kind === "running" ? "Changing and regenerating…" : `Use ${chosen.label.charAt(0).toLowerCase()}${chosen.label.slice(1)}`}
        </Button>
      </div>
      {state.kind === "done" ? <p className="t-body-sm mt-2 text-bp-ink-primary" role="status" data-product-result="">{state.text}</p> : null}
      {state.kind === "error" ? (
        <p role="alert" className="surface-inverse t-body-sm mt-2 bg-bp-alert-surface px-3 py-2 text-bp-alert-ink">
          {state.text}
        </p>
      ) : null}
    </div>
  );
}
