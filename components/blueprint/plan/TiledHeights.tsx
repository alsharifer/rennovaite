"use client";

// =============================================================================
// components/blueprint/plan/TiledHeights.tsx — "Tiled height" on 01 Plan
// (bathroom pilot B5, migration 065).
//
// Every wet room with how high its walls are tiled: empty = full height (the
// default — walls tiled to the ceiling, no wall paint); a number is a dado —
// tiling to it, paint above it. Saves on Enter or leaving the field
// (PATCH /api/plan-tiling); the BoQ follows on the next regenerate.
// =============================================================================

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { TILING_BOUNDS_M } from "@/lib/plan/tiling";

export interface TiledRoom {
  id: string;
  name: string;
  tiled_height_m: number | null;
  ceiling_h_m: number;
}

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring";

export function TiledHeights({ planId, rooms: initial }: { planId: string; rooms: TiledRoom[] }) {
  const router = useRouter();
  const ids = useId();
  const [rooms, setRooms] = useState(initial);
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(initial.map((r) => [r.id, r.tiled_height_m == null ? "" : r.tiled_height_m.toFixed(2)])));
  const [saving, setSaving] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function save(id: string, value: number | null) {
    const room = rooms.find((r) => r.id === id);
    if (!room || room.tiled_height_m === value) return;
    setSaving((n) => n + 1);
    setError(null);
    try {
      const res = await fetch("/api/plan-tiling", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan_id: planId, rooms: [{ id, tiled_height_m: value }] }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Not saved (${res.status}).`);
      setRooms((cur) => cur.map((r) => (r.id === id ? { ...r, tiled_height_m: value } : r)));
      setDrafts((d) => ({ ...d, [id]: value == null ? "" : value.toFixed(2) }));
      router.refresh();
    } catch (e) {
      setDrafts((d) => ({ ...d, [id]: room.tiled_height_m == null ? "" : room.tiled_height_m.toFixed(2) }));
      setError(e instanceof Error ? e.message : "Not saved.");
    } finally {
      setSaving((n) => n - 1);
    }
  }

  function commit(id: string) {
    const room = rooms.find((r) => r.id === id);
    const raw = (drafts[id] ?? "").trim();
    if (raw === "") return void save(id, null);
    const n = Number(raw);
    if (!Number.isFinite(n) || n < TILING_BOUNDS_M[0] || (room && n > room.ceiling_h_m)) {
      setError(`A tiled height is 0.00 m up to the room's ceiling${room ? ` (${room.ceiling_h_m.toFixed(2)} m)` : ""} — leave it empty for full height.`);
      return;
    }
    // At (or above) the ceiling it IS full height: store nothing.
    void save(id, room && n >= room.ceiling_h_m ? null : Math.round(n * 100) / 100);
  }

  return (
    <section aria-labelledby={`${ids}-h`} aria-busy={saving > 0} data-tiled-heights="">
      <div className="flex items-baseline justify-between gap-3 border-b border-bp-line-strong pb-2">
        <h2 id={`${ids}-h`} className="t-heading-sm text-bp-ink-primary">
          Tiled height
        </h2>
        <span className="t-label-md font-bp-mono text-bp-ink-secondary">wet rooms</span>
      </div>
      <ul className="mt-1" aria-label="Tiled heights">
        {rooms.map((r) => (
          <li key={r.id} className="flex items-center gap-3 border-b border-bp-line-hairline py-2" data-tiled-room={r.id}>
            <label htmlFor={`${ids}-${r.id}`} className="t-body-sm min-w-0 flex-1 truncate text-bp-ink-primary">
              {r.name}
            </label>
            <span className="flex shrink-0 items-center gap-1.5">
              <input
                id={`${ids}-${r.id}`}
                type="number"
                inputMode="decimal"
                step={0.01}
                min={0}
                max={r.ceiling_h_m}
                value={drafts[r.id] ?? ""}
                placeholder={r.ceiling_h_m.toFixed(2)}
                onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                onBlur={() => commit(r.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit(r.id);
                }}
                aria-describedby={`${ids}-${r.id}-what`}
                className={`h-9 w-[84px] rounded-none border border-bp-line-control bg-bp-surface-raised px-2 text-right t-num-sm text-bp-ink-primary placeholder:text-bp-ink-tertiary ${FOCUS}`}
                data-tiled-input={r.id}
              />
              <span className="t-label-md text-bp-ink-tertiary">m</span>
            </span>
            <span id={`${ids}-${r.id}-what`} className="w-[92px] shrink-0 t-label-md text-bp-ink-secondary">
              {r.tiled_height_m == null ? "full height" : "dado"}
            </span>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="surface-inverse t-body-sm mt-3 bg-bp-alert-surface px-4 py-3 text-bp-alert-ink">
          {error}
        </p>
      ) : null}
      <p className="t-body-sm mt-4 bg-bp-surface-sunken p-4 text-bp-ink-secondary">
        Wet rooms are tiled to the ceiling unless you type a lower height. Walls are painted only above the tiling, and the ceiling is always painted. The BoQ follows on the next regenerate.
      </p>
    </section>
  );
}
