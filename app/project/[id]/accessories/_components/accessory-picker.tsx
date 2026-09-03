"use client";

// =============================================================================
// accessory-picker.tsx — D1 spec picker + D1b technical comparison.
//
// Per category, per BoQ line: the rule-derived default is shown FIRST and
// labelled as what the engine assumed, then the catalogue alternatives grouped
// by spec class. Quantity is read-only and comes from the take-off — the user
// picks WHAT, the engine computes HOW MANY.
//
// Compare (D1b) is attributes-first on purpose: price is the last row, and a
// missing attribute renders "—" rather than being invented or hidden.
// =============================================================================

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import {
  ACCESSORY_CATEGORIES,
  CATEGORY_GLYPH,
  CATEGORY_ITEM_KEYS,
  CATEGORY_LABEL,
  ITEM_KEY_LABEL,
  SPEC_CLASS_LABEL,
  comparableRows,
  formatAttribute,
  selectionDeltas,
  type AccessoryCategory,
  type AccessoryItem,
  type AccessorySelections,
  type SpecClass,
} from "@/lib/accessories/types";
import { cn } from "@/lib/utils";

export type RuleDefault = {
  rate_aed: number;
  source: string;
  notes: string | null;
  kind: string;
} | null;

type Props = {
  projectId: string;
  catalog: AccessoryItem[];
  initialSelections: AccessorySelections;
  defaults: Record<string, RuleDefault>;
  quantities: Record<string, number>;
  measurements: Record<string, string>;
  noCatalogueReasons: Record<string, string>;
  nextHref: string;
  nextLabel: string;
  boqHref: string;
  degraded: boolean;
};

const aed = (n: number) => `AED ${Math.round(n).toLocaleString("en-US")}`;

export function AccessoryPicker({
  projectId,
  catalog,
  initialSelections,
  defaults,
  quantities,
  measurements,
  noCatalogueReasons,
  nextHref,
  nextLabel,
  boqHref,
  degraded,
}: Props) {
  const [selections, setSelections] = useState<AccessorySelections>(initialSelections);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compareFor, setCompareFor] = useState<string | null>(null);
  const [category, setCategory] = useState<AccessoryCategory>("sanitary");

  const byItemKey = useMemo(() => {
    const m = new Map<string, AccessoryItem[]>();
    for (const c of catalog) {
      const list = m.get(c.item_key) ?? [];
      list.push(c);
      m.set(c.item_key, list);
    }
    return m;
  }, [catalog]);

  const byId = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog]);

  // Live total movement against the rule defaults — the number the BoQ will move by.
  const delta = useMemo(() => {
    const chosen = Object.entries(selections)
      .map(([item_key, id]) => {
        const it = byId.get(id);
        return it ? { item_key, rate_aed: it.rate_aed } : null;
      })
      .filter((x): x is { item_key: string; rate_aed: number } => x !== null);
    const defaultRates: Record<string, number> = {};
    for (const [k, d] of Object.entries(defaults)) if (d) defaultRates[k] = d.rate_aed;
    return selectionDeltas(quantities, defaultRates, chosen);
  }, [selections, byId, defaults, quantities]);

  const choose = useCallback(
    async (itemKey: string, catalogItemId: string | null) => {
      setBusy(itemKey);
      setError(null);
      try {
        const res = catalogItemId
          ? await fetch("/api/accessories", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                project_id: projectId,
                item_key: itemKey,
                catalog_item_id: catalogItemId,
              }),
            })
          : await fetch(
              `/api/accessories?project_id=${projectId}&item_key=${encodeURIComponent(itemKey)}`,
              { method: "DELETE" },
            );
        const body = await res.json();
        if (!res.ok || body.error) throw new Error(body.error ?? "Couldn't save that.");
        setSelections(body.selections ?? {});
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save that.");
      } finally {
        setBusy(null);
      }
    },
    [projectId],
  );

  const itemKeys = CATEGORY_ITEM_KEYS[category];

  return (
    <div className="space-y-xl">
      {degraded && (
        <p className="rounded-lg border border-ink-100 bg-surface-container px-lg py-md font-body-sm text-body-sm text-on-surface-variant">
          The accessory catalogue is empty — migration 028 may not be applied, or
          the seed hasn&apos;t run. Every line below is priced by its rule, exactly
          as the BoQ does today.
        </p>
      )}

      {/* Category tabs ------------------------------------------------- */}
      <div className="flex flex-wrap gap-0.5 rounded-lg border border-ink-100 bg-paper p-0.5">
        {ACCESSORY_CATEGORIES.map((c) => {
          const active = c === category;
          const chosenInCat = CATEGORY_ITEM_KEYS[c].filter((k) => selections[k]).length;
          return (
            <button
              key={c}
              type="button"
              onClick={() => {
                setCategory(c);
                setCompareFor(null);
              }}
              aria-pressed={active}
              className={cn(
                "focus-ring inline-flex items-center gap-1.5 rounded-md px-lg py-sm font-body-sm text-body-sm font-semibold transition-colors",
                active ? "bg-brass-600 text-on-primary" : "text-ink-700 hover:bg-surface-container",
              )}
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                {CATEGORY_GLYPH[c]}
              </span>
              {CATEGORY_LABEL[c]}
              {chosenInCat > 0 && (
                <span
                  className={cn(
                    "ml-1 rounded-full px-1.5 text-[11px]",
                    active ? "bg-on-primary/20" : "bg-primary-fixed text-ink-900",
                  )}
                >
                  {chosenInCat}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}

      {/* One block per BoQ line in this category ----------------------- */}
      <div className="space-y-lg">
        {itemKeys.map((itemKey) => {
          const options = byItemKey.get(itemKey) ?? [];
          const def = defaults[itemKey];
          const qty = quantities[itemKey];
          const selectedId = selections[itemKey] ?? null;
          const selected = selectedId ? byId.get(selectedId) : null;

          return (
            <section key={itemKey} className="rounded-xl border border-ink-100 bg-paper p-lg">
              <div className="mb-md flex flex-wrap items-baseline justify-between gap-sm">
                <h3 className="font-display text-headline-md text-ink-900">
                  {ITEM_KEY_LABEL[itemKey] ?? itemKey}
                </h3>
                <div className="flex items-center gap-md">
                  {/* Quantity is the take-off's, never the user's. */}
                  <span
                    className="flex items-center gap-1.5 font-mono text-data-mono tabular-nums text-ink-500"
                    title={measurements[itemKey] ?? "From the deterministic take-off"}
                  >
                    <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                      lock
                    </span>
                    {qty !== undefined ? `${qty} no` : "not in this plan"}
                  </span>
                  {options.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setCompareFor(compareFor === itemKey ? null : itemKey)}
                      className="focus-ring rounded-lg border border-ink-100 px-md py-1 font-body-sm text-body-sm text-ink-900 hover:bg-surface-container"
                    >
                      {compareFor === itemKey ? "Hide comparison" : "Compare"}
                    </button>
                  )}
                </div>
              </div>

              {qty === undefined && (
                <p className="mb-md font-body-sm text-body-sm italic text-on-surface-variant">
                  The take-off produced no quantity for this item on this plan, so
                  it carries no BoQ line — a selection here would price nothing.
                </p>
              )}

              <ul className="grid gap-sm md:grid-cols-2 lg:grid-cols-3">
                {/* The rule-derived default, always first. */}
                <li>
                  <OptionCard
                    title="Engine default"
                    subtitle={def ? def.source : "No rule for this item"}
                    rate={def?.rate_aed ?? null}
                    qty={qty}
                    specClass={null}
                    selected={selectedId === null}
                    isDefault
                    busy={busy === itemKey}
                    qsValidated={false}
                    note={def?.notes ?? null}
                    onClick={() => void choose(itemKey, null)}
                  />
                </li>

                {options.map((o) => (
                  <li key={o.id}>
                    <OptionCard
                      title={o.name}
                      subtitle={[o.brand, o.model_code].filter(Boolean).join(" · ") || (o.source ?? "")}
                      rate={o.rate_aed}
                      qty={qty}
                      specClass={o.spec_class}
                      selected={selectedId === o.id}
                      isDefault={o.is_rule_default}
                      busy={busy === itemKey}
                      qsValidated={o.qs_validated}
                      note={o.source}
                      onClick={() => void choose(itemKey, o.id)}
                    />
                  </li>
                ))}
              </ul>

              {options.length === 0 && noCatalogueReasons[itemKey] && (
                <p className="mt-md rounded-lg bg-surface-container-low p-md font-body-sm text-body-sm text-on-surface-variant">
                  <span className="font-semibold text-ink-900">No alternatives yet. </span>
                  {noCatalogueReasons[itemKey]}
                </p>
              )}

              {compareFor === itemKey && options.length > 1 && (
                <CompareTable
                  options={options}
                  defaultRate={def?.rate_aed ?? null}
                  selectedId={selectedId}
                  onChoose={(id) => void choose(itemKey, id)}
                />
              )}

              {selected && (
                <p className="mt-md font-body-sm text-body-sm text-on-surface-variant">
                  BoQ line will read{" "}
                  <span className="text-ink-900">{selected.name}</span> at{" "}
                  <span className="font-mono tabular-nums">{aed(selected.rate_aed)}</span>
                  {qty !== undefined && (
                    <>
                      {" "}
                      × {qty} ={" "}
                      <span className="font-mono tabular-nums text-ink-900">
                        {aed(selected.rate_aed * qty)}
                      </span>
                    </>
                  )}
                  .{" "}
                  <button
                    type="button"
                    onClick={() => void choose(itemKey, null)}
                    className="underline hover:text-ink-900"
                  >
                    Back to the engine default
                  </button>
                </p>
              )}
            </section>
          );
        })}
      </div>

      {/* Running delta + forward -------------------------------------- */}
      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-md rounded-xl border border-ink-100 bg-paper p-lg">
        <div>
          <p className="label-caps text-ink-500">Change against the engine defaults</p>
          <p
            className={cn(
              "font-mono text-headline-md tabular-nums",
              delta.total_delta_aed > 0
                ? "text-ink-900"
                : delta.total_delta_aed < 0
                  ? "text-brass-600"
                  : "text-ink-500",
            )}
          >
            {delta.total_delta_aed === 0
              ? "AED ±0"
              : `${delta.total_delta_aed > 0 ? "+" : "−"}${aed(Math.abs(delta.total_delta_aed))}`}
          </p>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            {delta.lines.length === 0
              ? "Nothing selected — every line prices by rule."
              : `${delta.lines.length} line${delta.lines.length === 1 ? "" : "s"} re-priced. Regenerate the BoQ to apply.`}
          </p>
        </div>
        <div className="flex items-center gap-md">
          <Link
            href={boqHref}
            className="focus-ring flex h-12 items-center rounded-lg border border-ink-100 px-lg font-body-sm text-body-sm font-semibold text-ink-900 hover:bg-surface-container"
          >
            Back to the BoQ
          </Link>
          <Link
            href={nextHref}
            className="focus-ring flex h-12 items-center gap-sm rounded-lg bg-brass-600 px-xl font-body-sm text-body-sm font-semibold text-on-primary hover:bg-primary"
          >
            {nextLabel}
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
              arrow_forward
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function OptionCard({
  title,
  subtitle,
  rate,
  qty,
  specClass,
  selected,
  isDefault,
  busy,
  qsValidated,
  note,
  onClick,
}: {
  title: string;
  subtitle: string;
  rate: number | null;
  qty: number | undefined;
  specClass: SpecClass | null;
  selected: boolean;
  isDefault: boolean;
  busy: boolean;
  qsValidated: boolean;
  note: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-pressed={selected}
      title={note ?? undefined}
      className={cn(
        "focus-ring flex h-full w-full flex-col gap-xs rounded-lg border p-md text-left transition-all",
        selected
          ? "border-2 border-brass-600 bg-surface-container-low"
          : "border-ink-100 bg-paper hover:-translate-y-0.5 hover:shadow-level-1",
        busy && "opacity-60",
      )}
    >
      <span className="flex flex-wrap items-center gap-xs">
        {specClass && (
          <span className="rounded-full bg-primary-fixed px-sm py-0.5 text-[11px] font-semibold text-ink-900">
            {SPEC_CLASS_LABEL[specClass]}
          </span>
        )}
        {isDefault && (
          <span className="rounded-full border border-ink-100 px-sm py-0.5 text-[11px] text-ink-500">
            what the engine assumed
          </span>
        )}
        {/* Terracotta dot — the existing unvalidated-rate convention. */}
        {rate !== null && !qsValidated && (
          <span
            className="inline-block size-2 rounded-full bg-[#C4633A]"
            title="Rate not QS-validated"
            aria-label="Rate not QS-validated"
          />
        )}
      </span>

      <span className="font-body text-body-md font-semibold text-ink-900">{title}</span>
      <span className="line-clamp-2 font-body-sm text-body-sm text-on-surface-variant">
        {subtitle}
      </span>

      <span className="mt-auto pt-xs font-mono text-data-mono tabular-nums text-ink-900">
        {rate === null ? "—" : aed(rate)}
        {rate !== null && qty !== undefined && (
          <span className="text-ink-500"> · {aed(rate * qty)} total</span>
        )}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------

/**
 * D1b comparison. Attributes come FIRST and price is the final row, so the
 * decision is made on specification rather than on cost. Anything the source
 * did not carry shows "—".
 */
function CompareTable({
  options,
  defaultRate,
  selectedId,
  onChoose,
}: {
  options: AccessoryItem[];
  defaultRate: number | null;
  selectedId: string | null;
  onChoose: (id: string) => void;
}) {
  // Two or three at a time keeps the table readable.
  const shown = options.slice(0, 3);
  const rows = comparableRows(shown);

  return (
    <div className="mt-lg overflow-x-auto rounded-lg border border-ink-100">
      <table className="w-full min-w-[560px] border-collapse text-left">
        <thead>
          <tr className="border-b border-ink-100 bg-surface-container-low">
            <th className="p-md font-body-sm text-body-sm font-semibold text-ink-500">
              Specification
            </th>
            {shown.map((o) => (
              <th key={o.id} className="p-md align-top">
                <span className="block font-body-sm text-body-sm font-semibold text-ink-900">
                  {o.name}
                </span>
                <span className="block text-[11px] text-ink-500">
                  {SPEC_CLASS_LABEL[o.spec_class]}
                  {o.brand ? ` · ${o.brand}` : ""}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={shown.length + 1}
                className="p-md font-body-sm text-body-sm italic text-on-surface-variant"
              >
                No technical attributes have been ingested for these items yet.
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={String(r.key)} className="border-b border-ink-100 last:border-0">
              <td className="p-md font-body-sm text-body-sm text-ink-500">{r.label}</td>
              {shown.map((o) => (
                <td
                  key={o.id}
                  className="p-md font-body-sm text-body-sm text-ink-700"
                >
                  {formatAttribute(o.attributes, r.key)}
                </td>
              ))}
            </tr>
          ))}

          {/* Source, then price — deliberately the last two rows. */}
          <tr className="border-b border-ink-100">
            <td className="p-md font-body-sm text-body-sm text-ink-500">Source</td>
            {shown.map((o) => (
              <td key={o.id} className="p-md font-body-sm text-[12px] text-on-surface-variant">
                {o.source ?? "—"}
                {o.provenance === "actual_transaction" && (
                  <span className="ml-1 rounded-full bg-primary-fixed px-1.5 py-0.5 text-[10px] font-semibold text-ink-900">
                    real quotation
                  </span>
                )}
              </td>
            ))}
          </tr>
          <tr className="bg-surface-container-low">
            <td className="p-md font-body-sm text-body-sm text-ink-500">
              Rate
              {defaultRate !== null && (
                <span className="block text-[11px]">
                  engine default {aed(defaultRate)}
                </span>
              )}
            </td>
            {shown.map((o) => (
              <td key={o.id} className="p-md">
                <span className="block font-mono text-data-mono tabular-nums text-ink-900">
                  {aed(o.rate_aed)}
                </span>
                <button
                  type="button"
                  onClick={() => onChoose(o.id)}
                  className={cn(
                    "focus-ring mt-xs rounded px-sm py-0.5 text-[11px] font-semibold transition-colors",
                    selectedId === o.id
                      ? "bg-brass-600 text-on-primary"
                      : "border border-ink-100 text-ink-900 hover:bg-surface-container",
                  )}
                >
                  {selectedId === o.id ? "Selected" : "Select"}
                </button>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
