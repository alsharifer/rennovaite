"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { AnalyticsEvent, track } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import type { Style } from "@/lib/styles";

const BASELINE_BUDGET_AED = 850_000;

type Props = {
  styles: Style[];
  projectId: string;
  initialSelectedKey?: string | null;
};

function formatDelta(delta: number): { label: string; emphatic: boolean } {
  if (delta === 0) return { label: "AED ±0 vs baseline", emphatic: false };
  const abs = Math.abs(delta);
  const k = Math.round(abs / 1000);
  const sign = delta > 0 ? "+" : "−";
  return {
    label: `AED ${sign}${k}k vs baseline`,
    emphatic: Math.abs(delta) >= 100_000,
  };
}

function formatAed(n: number): string {
  return `AED ${Math.round(n).toLocaleString("en-US")}`;
}

export function StyleGrid({
  styles,
  projectId,
  initialSelectedKey = null,
}: Props) {
  const [selectedKey, setSelectedKey] = useState<string | null>(
    initialSelectedKey,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [budgetOpen, setBudgetOpen] = useState(false);

  const selected = useMemo(
    () => styles.find((s) => s.key === selectedKey) ?? null,
    [styles, selectedKey],
  );
  const indicativeTotal = BASELINE_BUDGET_AED + (selected?.cost_delta_aed ?? 0);

  async function pickStyle(key: string) {
    if (saving) return;
    setError(null);
    setSelectedKey(key); // optimistic
    setSaving(true);
    try {
      const res = await fetch("/api/style-choice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, style_key: key }),
      });
      const body = (await res.json().catch(() => null)) as
        | { success?: boolean; error?: string }
        | null;
      if (!res.ok || !body?.success) {
        throw new Error(body?.error ?? `Save failed (${res.status}).`);
      }
      track(AnalyticsEvent.StyleSelected, {
        project_id: projectId,
        style_key: key,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the pick.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* 3 × 2 grid -------------------------------------------------- */}
      <section className="grid grid-cols-1 gap-gutter md:grid-cols-2 lg:grid-cols-3">
        {styles.map((style) => (
          <StyleCard
            key={style.key}
            style={style}
            selected={style.key === selectedKey}
            onClick={() => pickStyle(style.key)}
          />
        ))}
      </section>

      {error && (
        <p className="mt-md font-body-sm text-body-sm text-error">{error}</p>
      )}

      {/* Sticky bottom action bar ------------------------------------ */}
      <div className="fixed inset-x-0 bottom-0 z-10 h-[88px] border-t border-ink-100 bg-paper">
        <div className="ml-60 flex h-full items-center justify-between px-margin">
          <Link
            href={`/project/${projectId}/plan`}
            className="focus-ring flex h-12 items-center rounded-lg border border-ink-100 px-lg font-body-sm text-body-sm font-semibold text-ink-900 transition-colors hover:bg-surface-container"
          >
            Back to plan
          </Link>
          <p className="hidden font-body text-body-sm italic text-on-surface-variant md:block">
            {selected
              ? `${selected.name_en} · indicative total ${formatAed(indicativeTotal)}`
              : "Pick a direction to continue."}
          </p>
          {selected ? (
            <Link
              href={`/project/${projectId}/render`}
              className="focus-ring flex h-12 items-center gap-sm rounded-lg bg-brass-600 px-xl font-body-sm text-body-sm font-semibold text-on-primary transition-colors hover:bg-primary"
            >
              Generate my first render
              <span
                className="material-symbols-outlined text-[18px]"
                aria-hidden="true"
              >
                arrow_forward
              </span>
            </Link>
          ) : (
            <button
              type="button"
              disabled
              className="flex h-12 cursor-not-allowed items-center gap-sm rounded-lg bg-brass-600/50 px-xl font-body-sm text-body-sm font-semibold text-on-primary"
            >
              Generate my first render
              <span
                className="material-symbols-outlined text-[18px]"
                aria-hidden="true"
              >
                arrow_forward
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Right-edge Budget panel ------------------------------------- */}
      <BudgetTab open={budgetOpen} onToggle={() => setBudgetOpen((v) => !v)} />
      <BudgetPanel
        open={budgetOpen}
        selected={selected}
        indicativeTotal={indicativeTotal}
        onClose={() => setBudgetOpen(false)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

function StyleCard({
  style,
  selected,
  onClick,
}: {
  style: Style;
  selected: boolean;
  onClick: () => void;
}) {
  const delta = formatDelta(style.cost_delta_aed);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "focus-ring group flex flex-col gap-md rounded-xl bg-paper p-lg text-left transition-all duration-200",
        selected
          ? "border-2 border-brass-600 shadow-level-1"
          : "border border-ink-100 hover:-translate-y-0.5 hover:shadow-level-1",
      )}
    >
      {/* 2 × 2 image grid */}
      <div className="grid grid-cols-2 gap-xs">
        {style.reference_images.map((src, i) => (
          <ImageTile
            key={src}
            src={src}
            alt={`${style.name_en} reference ${i + 1}`}
            palette={style.palette}
            index={i}
          />
        ))}
      </div>

      {/* Name + brass underline (selected) */}
      <div className="mt-xs">
        <p className="label-caps text-ink-500">{style.name_en}</p>
        <span
          aria-hidden="true"
          className={cn(
            "mt-xs block h-px transition-all duration-200",
            selected ? "w-12 bg-brass-600" : "w-0 bg-transparent",
          )}
        />
      </div>

      <p className="font-body text-body-lg text-on-surface-variant">
        {style.one_line}
      </p>

      <div className="mt-auto flex items-end justify-between gap-md">
        <span
          className={cn(
            "inline-flex items-center rounded-full bg-primary-fixed px-md py-xs font-body-sm text-body-sm font-semibold",
            delta.emphatic ? "text-on-primary-fixed-variant" : "text-ink-900",
          )}
        >
          {delta.label}
        </span>
        <span
          className={cn(
            "flex size-10 items-center justify-center rounded-full transition-all duration-200",
            selected
              ? "bg-brass-600 text-on-primary"
              : "border border-brass-600 text-brass-600 group-hover:bg-brass-600 group-hover:text-on-primary",
          )}
          aria-hidden="true"
        >
          <span className="material-symbols-outlined text-[22px]">
            {selected ? "check" : "add"}
          </span>
        </span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------

function ImageTile({
  src,
  alt,
  palette,
  index,
}: {
  src: string;
  alt: string;
  palette: string[];
  index: number;
}) {
  const [errored, setErrored] = useState(false);
  if (errored) {
    const a = palette[index % palette.length];
    const b = palette[(index + 1) % palette.length];
    return (
      <div
        className="aspect-square w-full rounded-md"
        style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}
        aria-label={alt}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setErrored(true)}
      className="aspect-square w-full rounded-md object-cover"
    />
  );
}

// ---------------------------------------------------------------------------

function BudgetTab({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls="budget-panel"
      className={cn(
        "focus-ring fixed z-30 flex h-32 w-9 items-center justify-center rounded-l-lg bg-brass-600 text-on-primary transition-transform duration-300",
        // Sit just above the sticky bottom action bar (88px) and vertically
        // mid-ish in the remaining viewport.
        "top-1/2 -translate-y-1/2",
        open ? "right-[320px]" : "right-0",
      )}
    >
      <span
        className="rotate-90 whitespace-nowrap font-label-caps text-label-caps uppercase tracking-widest"
        style={{ writingMode: "horizontal-tb" }}
      >
        Budget
      </span>
    </button>
  );
}

function BudgetPanel({
  open,
  selected,
  indicativeTotal,
  onClose,
}: {
  open: boolean;
  selected: Style | null;
  indicativeTotal: number;
  onClose: () => void;
}) {
  return (
    <aside
      id="budget-panel"
      aria-hidden={!open}
      className={cn(
        "fixed right-0 top-16 bottom-[88px] z-20 flex w-[320px] flex-col border-l border-ink-100 bg-paper transition-transform duration-300",
        open ? "translate-x-0" : "translate-x-full",
      )}
    >
      <header className="flex items-center justify-between border-b border-ink-100 px-lg py-md">
        <p className="label-caps text-ink-500">Budget</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close budget panel"
          className="focus-ring flex size-7 items-center justify-center rounded text-on-surface-variant hover:text-ink-900"
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-lg py-lg">
        {selected ? (
          <>
            <p className="label-caps text-ink-500">Chosen direction</p>
            <p className="mb-lg mt-xs font-display text-headline-md text-ink-900">
              {selected.name_en}
            </p>

            <p className="label-caps text-ink-500">Indicative project total</p>
            <p className="mb-lg mt-xs font-mono text-[28px] tabular-nums text-ink-900">
              {formatAed(indicativeTotal)}
            </p>
            <p className="-mt-md mb-xl font-body-sm text-body-sm text-on-surface-variant">
              Baseline {formatAed(BASELINE_BUDGET_AED)}
              {selected.cost_delta_aed === 0
                ? " · no delta"
                : ` · ${selected.cost_delta_aed > 0 ? "+" : "−"}${formatAed(
                    Math.abs(selected.cost_delta_aed),
                  ).replace("AED ", "")}`}
            </p>

            <p className="label-caps mb-md text-ink-500">What changes</p>
            <div className="flex flex-col gap-md">
              {selected.what_changes.map((line) => (
                <p
                  key={line}
                  className="font-body text-body-md text-on-surface-variant"
                >
                  {line}
                </p>
              ))}
            </div>
          </>
        ) : (
          <p className="font-body text-body-md text-on-surface-variant">
            Pick a direction on the left to see the indicative total and the
            three biggest material changes it implies.
          </p>
        )}
      </div>
    </aside>
  );
}
