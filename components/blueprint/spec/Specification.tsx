"use client";

// =============================================================================
// components/blueprint/spec/Specification.tsx — 04 Cost · Specification for an
// owner, 03 Specification for a firm (K8 #6, spec §6.5, Figma 58:738).
//
// Category chips (selected = ink fill). Per BoQ line: name · the quantity,
// locked, "from the plan" · Compare. Options in equal cells — WHAT THE ENGINE
// ASSUMED first, then the catalogue by spec class as label/caps text (no
// coloured pills); the selected cell is raised + strong outline + brass left
// rule + check. Each cell: product, supplier label + ref, rate / unit + its
// mark (the engine's default is derived; a priced product is market — never
// validated, K0), and the line total. Right 320: the effect on the cost (the
// engine's own re-pricing rule, before contingency and VAT), the changed
// items, and where to regenerate.
//
// Quantities are the take-off's — the owner picks WHAT, the engine counts HOW
// MANY. Owner copy never shows an internal key ("labour_rates"): a rule price
// is "Priced by rule · no product chosen".
// =============================================================================

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import {
  ACCESSORY_CATEGORIES,
  CATEGORY_ITEM_KEYS,
  CATEGORY_LABEL,
  ITEM_KEY_LABEL,
  SPEC_CLASS_LABEL,
  comparableRows,
  effectiveRate,
  formatAttribute,
  selectionDeltas,
  type AccessoryCategory,
  type AccessoryItem,
  type AccessorySelections,
} from "@/lib/accessories/types";
import { formatAED, formatDelta } from "@/lib/format/aed";
import { tierLabel, type ProvTier } from "@/lib/provenance/tier-vocab";

import { Button } from "../Button";
import { Icon } from "../Icon";
import { ProvenanceMark } from "../ProvenanceMark";
import { StateBlock } from "../StateBlock";

export type RuleDefault = { rate_aed: number; source: string; notes: string | null; kind: string } | null;

function Rate({ rate, unit, total, tier, persona }: { rate: number | null; unit: string; total: number | null; tier: ProvTier; persona: "firm" | "owner" }) {
  if (rate == null) return <span className="t-label-md font-bp-mono text-bp-ink-tertiary">—</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2">
      <span aria-hidden="true" className="t-num-sm text-bp-ink-primary">
        {formatAED(rate)} / {unit}
      </span>
      <ProvenanceMark tier={tier} />
      {total != null ? (
        <span aria-hidden="true" className="t-num-sm text-bp-ink-secondary">
          · {formatAED(total)}
        </span>
      ) : null}
      <span className="sr-only">
        AED {formatAED(rate)} per {unit}, {tierLabel(tier, persona).toLowerCase()}
        {total != null ? `; AED ${formatAED(total)} for the line` : ""}
      </span>
    </span>
  );
}

export function Specification(props: {
  projectId: string;
  persona: "firm" | "owner";
  catalog: AccessoryItem[];
  initialSelections: AccessorySelections;
  defaults: Record<string, RuleDefault>;
  quantities: Record<string, number>;
  measurements: Record<string, string>;
  noCatalogueReasons: Record<string, string>;
  degraded: boolean;
  /** "rev 3" — the revision a regeneration would supersede. */
  rev: number | null;
  boqHref: string;
}) {
  const { projectId, persona, catalog, defaults, quantities, measurements } = props;
  const [selections, setSelections] = useState<AccessorySelections>(props.initialSelections);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compareFor, setCompareFor] = useState<string | null>(null);
  const [category, setCategory] = useState<AccessoryCategory>("sanitary");

  const byItemKey = useMemo(() => {
    const m = new Map<string, AccessoryItem[]>();
    for (const c of catalog) m.set(c.item_key, [...(m.get(c.item_key) ?? []), c]);
    return m;
  }, [catalog]);
  const byId = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog]);
  const defaultSupply = useMemo(() => Object.fromEntries(catalog.filter((c) => c.is_rule_default).map((c) => [c.item_key, c.rate_aed])) as Record<string, number>, [catalog]);

  // The engine's own re-pricing (effectiveRate mirrors applyAccessory).
  const delta = useMemo(() => {
    const chosen = Object.entries(selections)
      .map(([item_key, id]) => {
        const it = byId.get(id);
        return it ? { item_key, rate_aed: it.rate_aed, default_supply_aed: (defaultSupply[item_key] ?? null) as number | null } : null;
      })
      .filter((x): x is { item_key: string; rate_aed: number; default_supply_aed: number | null } => x !== null);
    const defs: Record<string, { rate_aed: number; kind: string }> = {};
    for (const [k, d] of Object.entries(defaults)) if (d) defs[k] = { rate_aed: d.rate_aed, kind: d.kind };
    return selectionDeltas(quantities, defs, chosen);
  }, [selections, byId, defaults, quantities, defaultSupply]);

  const choose = useCallback(
    async (itemKey: string, catalogItemId: string | null) => {
      setBusy(itemKey);
      setError(null);
      try {
        const res = catalogItemId
          ? await fetch("/api/accessories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId, item_key: itemKey, catalog_item_id: catalogItemId }) })
          : await fetch(`/api/accessories?project_id=${projectId}&item_key=${encodeURIComponent(itemKey)}`, { method: "DELETE" });
        const body = await res.json();
        if (!res.ok || body.error) throw new Error(body.error ?? "Your choice wasn't saved.");
        setSelections(body.selections ?? {});
      } catch (e) {
        setError(e instanceof Error ? e.message : "Your choice wasn't saved.");
      } finally {
        setBusy(null);
      }
    },
    [projectId],
  );

  const chosenCount = Object.keys(selections).length;
  const effectTier: ProvTier = chosenCount > 0 ? "market" : "derived";

  return (
    <div className="grid grid-cols-1 gap-10 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0">
        {props.degraded ? (
          <p className="t-body-sm mb-6 bg-bp-surface-sunken px-4 py-3 text-bp-ink-secondary">The product catalogue is empty on this deployment, so every line below is priced by its rule — exactly as the cost is today.</p>
        ) : null}

        <div role="group" aria-label="Category" className="flex flex-wrap gap-3">
          {ACCESSORY_CATEGORIES.map((c) => {
            const on = c === category;
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setCategory(c);
                  setCompareFor(null);
                }}
                className={`t-body-sm inline-flex min-h-9 items-center gap-2 border px-2.5 ${on ? "border-bp-ink-primary bg-bp-ink-primary text-bp-ink-on-inverse" : "border-bp-line-control text-bp-ink-primary hover:bg-bp-surface-sunken"}`}
              >
                {CATEGORY_LABEL[c]}
                <span className={`t-label-md font-bp-mono ${on ? "" : "text-bp-ink-tertiary"}`}>{CATEGORY_ITEM_KEYS[c].length}</span>
              </button>
            );
          })}
        </div>

        {error ? (
          <div className="mt-6 max-w-[720px]">
            <StateBlock kind="error" title="That choice wasn't saved" afterUserAction>
              {error} The line keeps its previous price.
            </StateBlock>
          </div>
        ) : null}

        {CATEGORY_ITEM_KEYS[category].map((itemKey) => {
          const options = byItemKey.get(itemKey) ?? [];
          const def = defaults[itemKey];
          const qty = quantities[itemKey];
          const selectedId = selections[itemKey] ?? null;
          const label = ITEM_KEY_LABEL[itemKey] ?? itemKey;
          const cells = [
            { id: null as string | null, eyebrow: "WHAT THE ENGINE ASSUMED", title: def ? `Rule rate — ${label.toLowerCase()}` : `No rule for ${label.toLowerCase()}`, sub: "Priced by rule · no product chosen", rate: def?.rate_aed ?? null, supply: null as number | null, tier: "derived" as ProvTier, unit: "no" },
            ...options.map((o) => ({
              id: o.id as string | null,
              eyebrow: SPEC_CLASS_LABEL[o.spec_class].toUpperCase(),
              title: o.name,
              sub: [o.brand, o.model_code ? `ref ${o.model_code}` : null].filter(Boolean).join(" · ") || "Catalogue product",
              rate: def ? effectiveRate(def.rate_aed, def.kind, o.rate_aed, defaultSupply[itemKey] ?? null) : o.rate_aed,
              supply: o.rate_aed,
              tier: "market" as ProvTier,
              unit: o.unit || "no",
            })),
          ];
          return (
            <section key={itemKey} aria-labelledby={`item-${itemKey}`} className="mt-8" data-spec-item={itemKey}>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b-2 border-bp-line-strong pb-2.5">
                <h2 id={`item-${itemKey}`} className="t-heading-md flex-1 text-bp-ink-primary">
                  {label}
                </h2>
                <span className="t-label-md inline-flex items-center gap-1.5 font-bp-mono text-bp-ink-secondary" title={measurements[itemKey] ?? undefined}>
                  <Icon name="lock" className="text-[18px]" />
                  {qty !== undefined ? `${qty} no · quantity from the plan` : "not in this plan"}
                </span>
                {options.length > 1 ? (
                  <Button kind="quiet" onClick={() => setCompareFor(compareFor === itemKey ? null : itemKey)}>
                    {compareFor === itemKey ? "Hide comparison" : "Compare"}
                  </Button>
                ) : null}
              </div>
              {qty === undefined ? <p className="t-body-sm mt-2 text-bp-ink-secondary">Your plan produces no quantity for this item, so it carries no cost line — a choice here would price nothing.</p> : null}

              <ul className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 min-[1400px]:grid-cols-3">
                {cells.map((c) => {
                  const on = c.id === selectedId;
                  return (
                    <li key={c.id ?? "default"}>
                      <button
                        type="button"
                        aria-pressed={on}
                        disabled={busy === itemKey}
                        onClick={() => void choose(itemKey, c.id)}
                        className={`relative flex h-full w-full flex-col gap-1 border p-3.5 text-left outline-offset-2 ${on ? "border-bp-line-strong bg-bp-surface-raised before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-bp-brass" : "border-bp-line-hairline hover:bg-bp-surface-raised"}`}
                      >
                        <span className="t-label-caps flex items-center gap-1.5 text-bp-ink-secondary">
                          {on ? <Icon name="check" className="text-[18px] text-bp-ink-primary" /> : null}
                          {c.eyebrow}
                        </span>
                        <span className="t-heading-sm text-bp-ink-primary">{c.title}</span>
                        <span className="t-body-sm text-bp-ink-secondary">{c.sub}</span>
                        <span className="mt-auto pt-2">
                          <Rate rate={c.rate} unit={c.unit} total={c.rate != null && qty !== undefined ? Math.round(c.rate * qty * 100) / 100 : null} tier={c.tier} persona={persona} />
                        </span>
                        {c.supply != null && c.rate != null && Math.abs(c.supply - c.rate) > 0.005 ? <span className="t-label-md font-bp-mono text-bp-ink-tertiary">{formatAED(c.supply)} supply · rest of the rule rate kept</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>

              {options.length === 0 && props.noCatalogueReasons[itemKey] ? (
                <p className="t-body-sm mt-3 bg-bp-surface-sunken px-4 py-3 text-bp-ink-secondary">
                  <span className="t-heading-sm text-bp-ink-primary">No alternatives yet. </span>
                  {props.noCatalogueReasons[itemKey]}
                </p>
              ) : null}

              {compareFor === itemKey && options.length > 1 ? (
                <div className="relative mt-4 overflow-x-auto border border-bp-line-hairline">
                  <table className="w-full min-w-[560px] border-collapse text-left" aria-label={`Compare ${label}`}>
                    <thead>
                      <tr className="bg-bp-surface-sunken">
                        <th scope="col" className="t-label-caps px-3 py-2.5 font-normal text-bp-ink-tertiary">
                          SPECIFICATION
                        </th>
                        {options.slice(0, 3).map((o) => (
                          <th key={o.id} scope="col" className="px-3 py-2.5 align-top">
                            <span className="t-heading-sm block text-bp-ink-primary">{o.name}</span>
                            <span className="t-label-md block font-bp-mono text-bp-ink-tertiary">
                              {SPEC_CLASS_LABEL[o.spec_class]}
                              {o.brand ? ` · ${o.brand}` : ""}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {comparableRows(options.slice(0, 3)).map((r) => (
                        <tr key={String(r.key)} className="border-t border-bp-line-hairline">
                          <th scope="row" className="t-body-sm px-3 py-2.5 font-normal text-bp-ink-secondary">
                            {r.label}
                          </th>
                          {options.slice(0, 3).map((o) => (
                            <td key={o.id} className="t-body-sm px-3 py-2.5 text-bp-ink-primary">
                              {formatAttribute(o.attributes, r.key)}
                            </td>
                          ))}
                        </tr>
                      ))}
                      <tr className="border-t border-bp-line-strong">
                        <th scope="row" className="t-body-sm px-3 py-2.5 font-normal text-bp-ink-secondary">
                          Supply price
                        </th>
                        {options.slice(0, 3).map((o) => (
                          <td key={o.id} className="t-num-sm px-3 py-2.5 text-bp-ink-primary">
                            {formatAED(o.rate_aed)}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>
          );
        })}

        <p className="t-body-sm mt-8 text-bp-ink-secondary">Products are shown with the label the catalogue or your firm gives them. Choosing a product moves the rate only — its supply price replaces the rule&apos;s, the rest of the rule rate is kept.</p>
      </div>

      {/* Effect on your cost */}
      <aside aria-labelledby="effect-h" className="h-fit border border-bp-line-hairline p-4 xl:sticky xl:top-[calc(var(--bp-topbar-h)+24px)]" data-spec-effect={delta.total_delta_aed}>
        <h2 id="effect-h" className="t-label-caps text-bp-ink-tertiary">
          EFFECT ON YOUR COST
        </h2>
        <p className="mt-2 flex items-center gap-2">
          <span aria-hidden="true" className="t-num-lg text-bp-ink-primary">
            {delta.total_delta_aed === 0 ? "±AED 0.00" : `${formatDelta(delta.total_delta_aed).replace(/^([+−])/, "$1AED ")}`}
          </span>
          {chosenCount > 0 ? <ProvenanceMark tier={effectTier} /> : null}
          <span className="sr-only" aria-live="polite">
            {delta.total_delta_aed === 0 ? "No change" : `${delta.total_delta_aed > 0 ? "Plus" : "Minus"} AED ${formatAED(Math.abs(delta.total_delta_aed))}`} against the engine&apos;s assumption{chosenCount > 0 ? `, ${tierLabel(effectTier, persona).toLowerCase()}` : ""}
          </span>
        </p>
        <p className="t-body-sm mt-2 text-bp-ink-secondary">
          {chosenCount === 0 ? "Nothing chosen — every line is priced by its rule." : `${chosenCount} product${chosenCount === 1 ? "" : "s"} chosen vs the engine's assumption.`} Line prices, before contingency and VAT.
          {chosenCount > 0 ? ` Applied${props.rev ? ` to the cost after rev ${props.rev}` : ""} when you regenerate.` : ""}
        </p>
        {delta.lines.length ? (
          <ul className="mt-3">
            {delta.lines.map((l) => {
              const item = byId.get(selections[l.item_key] ?? "");
              return (
                <li key={l.item_key} className="flex items-baseline gap-3 border-b border-bp-line-hairline py-2.5">
                  <span className="t-body-sm min-w-0 flex-1 text-bp-ink-primary">
                    {ITEM_KEY_LABEL[l.item_key] ?? l.item_key} · {item ? SPEC_CLASS_LABEL[item.spec_class].toLowerCase() : "engine"}
                  </span>
                  <span className="t-num-sm text-bp-ink-primary">{l.delta_aed === 0 ? "±0.00" : formatDelta(l.delta_aed)}</span>
                </li>
              );
            })}
          </ul>
        ) : null}
        <div className="mt-4">
          <Button kind="secondary" href={props.boqHref}>
            Regenerate cost
          </Button>
        </div>
        <p className="t-label-md mt-2 font-bp-mono text-bp-ink-tertiary">
          Regenerate on the{" "}
          <Link href={props.boqHref} className="underline underline-offset-2">
            bill of quantities
          </Link>
          .
        </p>
      </aside>
    </div>
  );
}
