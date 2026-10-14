"use client";

// =============================================================================
// components/blueprint/plan/RoomsInScope.tsx — "Rooms in this renovation"
// (K12, spec §7.4, Figma 81:716 / dark 82:2244).
//
// The 01 Plan right-panel checklist: every room with its area, "11 of 13",
// Select all / Clear. A tick saves at once (PATCH /api/plan-scope) and tells the
// canvas (window event `rv:plan-scope`) to draw the room dashed with "NOT IN
// THIS RENOVATION" — or solid again. Nothing is priced until the next
// regenerate (a new revision, so nothing is lost); the page refreshes so the
// rail, the Regenerate control and the Overview read the new scope.
// =============================================================================

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { SCOPE_NOTE, SCOPE_REGENERATE_NOTE } from "@/lib/plan/scope";

export interface ScopeRoom {
  id: string;
  name: string;
  area_m2: number | null;
  in_scope: boolean;
}

const m2 = (n: number | null) => (n == null ? "—" : `${n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m²`);

export function RoomsInScope({ planId, rooms: initial, zones = false }: { planId: string; rooms: ScopeRoom[]; zones?: boolean }) {
  const router = useRouter();
  const ids = useId();
  const [rooms, setRooms] = useState(initial);
  // Saves in flight. A tick never waits for another: each change is its own PATCH.
  const [saving, setSaving] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inScope = rooms.filter((r) => r.in_scope).length;

  async function save(changes: { id: string; in_scope: boolean }[]) {
    const real = changes.filter((c) => rooms.find((r) => r.id === c.id)?.in_scope !== c.in_scope);
    if (real.length === 0) return;
    const apply = (list: { id: string; in_scope: boolean }[]) => setRooms((cur) => cur.map((r) => ({ ...r, in_scope: list.find((c) => c.id === r.id)?.in_scope ?? r.in_scope })));
    apply(real);
    setSaving((n) => n + 1);
    setError(null);
    try {
      const res = await fetch("/api/plan-scope", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan_id: planId, rooms: real }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Not saved (${res.status}).`);
      for (const v of [true, false]) {
        const list = real.filter((c) => c.in_scope === v).map((c) => c.id);
        if (list.length) window.dispatchEvent(new CustomEvent("rv:plan-scope", { detail: { ids: list, in_scope: v } }));
      }
      router.refresh();
    } catch (e) {
      // Undo only this change; anything saved meanwhile stands.
      apply(real.map((c) => ({ id: c.id, in_scope: !c.in_scope })));
      setError(e instanceof Error ? e.message : "Not saved.");
    } finally {
      setSaving((n) => n - 1);
    }
  }

  return (
    <section aria-labelledby={`${ids}-h`} aria-busy={saving > 0} data-rooms-in-scope="" data-in-scope-count={inScope} data-total={rooms.length} data-saving={saving > 0 ? "true" : "false"}>
      <div className="flex items-baseline justify-between gap-3 border-b border-bp-line-strong pb-2">
        <h2 id={`${ids}-h`} className="t-heading-sm text-bp-ink-primary">
          {zones ? "Zones in this renovation" : "Rooms in this renovation"}
        </h2>
        <span className="t-label-md font-bp-mono text-bp-ink-secondary" aria-live="polite">
          {inScope} of {rooms.length}
        </span>
      </div>
      <div className="mt-2 flex gap-5">
        <button type="button" onClick={() => void save(rooms.map((r) => ({ id: r.id, in_scope: true })))} className="t-body-sm text-bp-ink-secondary hover:text-bp-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring" data-scope-all="">
          Select all
        </button>
        <button type="button" onClick={() => void save(rooms.map((r) => ({ id: r.id, in_scope: false })))} className="t-body-sm text-bp-ink-secondary hover:text-bp-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring" data-scope-clear="">
          Clear
        </button>
      </div>
      <ul className="mt-1 max-h-[440px] overflow-y-auto" aria-label={zones ? "Zones in this renovation" : "Rooms in this renovation"}>
        {rooms.map((r) => (
          <li key={r.id} className="border-b border-bp-line-hairline">
            <label className="flex cursor-pointer items-center gap-3 py-2.5">
              <input type="checkbox" checked={r.in_scope} onChange={(e) => void save([{ id: r.id, in_scope: e.target.checked }])} className="size-4 shrink-0 accent-bp-ink-primary" data-scope-room={r.id} />
              <span className={`t-body-sm min-w-0 flex-1 truncate ${r.in_scope ? "text-bp-ink-primary" : "text-bp-ink-tertiary"}`}>{r.name}</span>
              <span className={`t-num-sm shrink-0 ${r.in_scope ? "text-bp-ink-secondary" : "text-bp-ink-tertiary"}`}>{m2(r.area_m2)}</span>
            </label>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="surface-inverse t-body-sm mt-3 bg-bp-alert-surface px-4 py-3 text-bp-alert-ink">
          {error}
        </p>
      ) : null}
      <div className="t-body-sm mt-4 space-y-2 bg-bp-surface-sunken p-4 text-bp-ink-secondary">
        <p>{SCOPE_NOTE}</p>
        <p>{SCOPE_REGENERATE_NOTE}</p>
      </div>
    </section>
  );
}
