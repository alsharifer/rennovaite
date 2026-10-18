"use client";

// =============================================================================
// components/blueprint/plan/CeilingHeights.tsx — "Ceiling heights" on 01 Plan
// (bathroom pilot B1, migration 061).
//
// Every roofed room with its ceiling height: a typed height is MEASURED (the
// measured mark), a room with none keeps the 2.90 m default (the derived mark).
// A change saves at once (PATCH /api/plan-ceiling) on Enter or leaving the
// field — like a scope tick — and the page refreshes so the plan rules and the
// rail read it. Wall areas follow on the next regenerate (a new revision).
// =============================================================================

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { ProvenanceMark } from "@/components/blueprint/ProvenanceMark";
import { CEILING_BOUNDS_M } from "@/lib/plan/ceiling";
import { DEFAULT_CEILING_H_M } from "@/lib/plan/geometry";

export interface CeilingRoom {
  id: string;
  name: string;
  ceiling_h_m: number | null;
  source: "measured" | "derived" | null;
}

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring";

export function CeilingHeights({ planId, rooms: initial }: { planId: string; rooms: CeilingRoom[] }) {
  const router = useRouter();
  const ids = useId();
  const [rooms, setRooms] = useState(initial);
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(initial.map((r) => [r.id, r.ceiling_h_m == null ? "" : r.ceiling_h_m.toFixed(2)])));
  const [saving, setSaving] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const measured = rooms.filter((r) => r.ceiling_h_m != null).length;

  async function save(id: string, value: number | null) {
    const room = rooms.find((r) => r.id === id);
    if (!room || room.ceiling_h_m === value) return;
    setSaving((n) => n + 1);
    setError(null);
    try {
      const res = await fetch("/api/plan-ceiling", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan_id: planId, rooms: [{ id, ceiling_h_m: value }] }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Not saved (${res.status}).`);
      setRooms((cur) => cur.map((r) => (r.id === id ? { ...r, ceiling_h_m: value, source: value == null ? null : "measured" } : r)));
      setDrafts((d) => ({ ...d, [id]: value == null ? "" : value.toFixed(2) }));
      router.refresh();
    } catch (e) {
      setDrafts((d) => ({ ...d, [id]: room.ceiling_h_m == null ? "" : room.ceiling_h_m.toFixed(2) }));
      setError(e instanceof Error ? e.message : "Not saved.");
    } finally {
      setSaving((n) => n - 1);
    }
  }

  function commit(id: string) {
    const raw = (drafts[id] ?? "").trim();
    if (raw === "") return void save(id, null);
    const n = Number(raw);
    if (!Number.isFinite(n) || n < CEILING_BOUNDS_M[0] || n > CEILING_BOUNDS_M[1]) {
      setError(`A ceiling height is ${CEILING_BOUNDS_M[0].toFixed(2)}–${CEILING_BOUNDS_M[1].toFixed(2)} m.`);
      return;
    }
    void save(id, Math.round(n * 100) / 100);
  }

  return (
    <section aria-labelledby={`${ids}-h`} aria-busy={saving > 0} data-ceiling-heights="" data-saving={saving > 0 ? "true" : "false"}>
      <div className="flex items-baseline justify-between gap-3 border-b border-bp-line-strong pb-2">
        <h2 id={`${ids}-h`} className="t-heading-sm text-bp-ink-primary">
          Ceiling heights
        </h2>
        <span className="t-label-md font-bp-mono text-bp-ink-secondary" aria-live="polite">
          {measured} of {rooms.length} measured
        </span>
      </div>
      <ul className="mt-1 max-h-[440px] overflow-y-auto" aria-label="Ceiling heights">
        {rooms.map((r) => {
          const isMeasured = r.ceiling_h_m != null && r.source !== "derived";
          return (
            <li key={r.id} className="flex items-center gap-3 border-b border-bp-line-hairline py-2" data-ceiling-room={r.id} data-ceiling-source={r.ceiling_h_m == null ? "default" : r.source ?? "measured"}>
              <label htmlFor={`${ids}-${r.id}`} className="t-body-sm min-w-0 flex-1 truncate text-bp-ink-primary">
                {r.name}
              </label>
              <span className="flex shrink-0 items-center gap-1.5">
                <input
                  id={`${ids}-${r.id}`}
                  type="number"
                  inputMode="decimal"
                  step={0.01}
                  min={CEILING_BOUNDS_M[0]}
                  max={CEILING_BOUNDS_M[1]}
                  value={drafts[r.id] ?? ""}
                  placeholder={DEFAULT_CEILING_H_M.toFixed(2)}
                  onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                  onBlur={() => commit(r.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commit(r.id);
                  }}
                  aria-describedby={`${ids}-${r.id}-src`}
                  className={`h-9 w-[84px] rounded-none border border-bp-line-control bg-bp-surface-raised px-2 text-right t-num-sm text-bp-ink-primary placeholder:text-bp-ink-tertiary ${FOCUS}`}
                  data-ceiling-input={r.id}
                />
                <span className="t-label-md text-bp-ink-tertiary">m</span>
              </span>
              <span id={`${ids}-${r.id}-src`} className="flex w-[92px] shrink-0 items-center gap-1.5 t-label-md text-bp-ink-secondary">
                <ProvenanceMark tier={isMeasured ? "measured" : "derived"} />
                {isMeasured ? "measured" : r.ceiling_h_m != null ? "derived" : "default"}
              </span>
            </li>
          );
        })}
      </ul>
      {error ? (
        <p role="alert" className="surface-inverse t-body-sm mt-3 bg-bp-alert-surface px-4 py-3 text-bp-alert-ink">
          {error}
        </p>
      ) : null}
      <p className="t-body-sm mt-4 bg-bp-surface-sunken p-4 text-bp-ink-secondary">
        Wall areas — tiling, plaster and paint — are measured to each room&rsquo;s ceiling. A room with no height typed uses {DEFAULT_CEILING_H_M.toFixed(2)} m. Clear a height to go back to it. The BoQ follows on the next regenerate.
      </p>
    </section>
  );
}
