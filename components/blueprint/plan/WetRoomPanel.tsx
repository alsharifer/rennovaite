"use client";

// =============================================================================
// components/blueprint/plan/WetRoomPanel.tsx — "Wet room" on 01 Plan
// (bathroom pilot B7 4).
//
// One bathroom's bulkhead, water heater, shower niche, shower valve wall and
// extractor — the things the pilot set by script. Each change saves at once
// (PATCH /api/plan-wet-room) and the BoQ follows on the next regenerate: the
// bulkhead's cove light, the heater's box-in or relocation line, the niche and
// the extractor lines, and the elevations draw them.
// =============================================================================

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { HEATER_DEFAULT_HEIGHT_MM, NICHE_DEFAULT, WALLS, type Wall, type WetRoomSetup } from "@/lib/plan/wet-room-setup";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring";
const FIELD = `h-9 rounded-none border border-bp-line-control bg-bp-surface-raised px-2 t-body-sm text-bp-ink-primary ${FOCUS}`;
const NUM = `h-9 w-[84px] rounded-none border border-bp-line-control bg-bp-surface-raised px-2 text-right t-num-sm text-bp-ink-primary ${FOCUS}`;
const WALL_NAME: Record<Wall, string> = { N: "North wall", E: "East wall", S: "South wall", W: "West wall" };

export function WetRoomPanel({ roomId, roomName, initial, hasShower }: { roomId: string; roomName: string; initial: WetRoomSetup; hasShower: boolean }) {
  const router = useRouter();
  const ids = useId();
  const [setup, setSetup] = useState<WetRoomSetup>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: WetRoomSetup) {
    const prev = setup;
    setSetup(next);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/plan-wet-room", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ room_id: roomId, setup: next }) });
      const body = (await res.json().catch(() => ({}))) as { setup?: WetRoomSetup; error?: string };
      if (!res.ok || !body.setup) throw new Error(body.error ?? `Not saved (${res.status}).`);
      setSetup(body.setup);
      router.refresh();
    } catch (e) {
      setSetup(prev);
      setError(e instanceof Error ? e.message : "Not saved.");
    } finally {
      setSaving(false);
    }
  }

  const row = "flex flex-wrap items-center gap-2 border-b border-bp-line-hairline py-2.5";
  const label = "t-body-sm min-w-[120px] flex-1 text-bp-ink-primary";
  const num = (v: string, d: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : d);

  return (
    <section aria-labelledby={`${ids}-h`} aria-busy={saving} data-wet-room-panel={roomId}>
      <div className="flex items-baseline justify-between gap-3 border-b border-bp-line-strong pb-2">
        <h2 id={`${ids}-h`} className="t-heading-sm text-bp-ink-primary">
          Wet room
        </h2>
        <span className="t-label-md font-bp-mono text-bp-ink-secondary">{roomName}</span>
      </div>

      <div className={row}>
        <label htmlFor={`${ids}-bh`} className={label}>Bulkhead</label>
        <select id={`${ids}-bh`} className={FIELD} value={setup.bulkhead?.over ?? ""} data-wet="bulkhead" onChange={(e) => void save({ ...setup, bulkhead: e.target.value ? { over: e.target.value as NonNullable<WetRoomSetup["bulkhead"]>["over"] } : null })}>
          <option value="">None — flat ceiling</option>
          <option value="shower">Over the shower</option>
          <option value="bath">Over the bath</option>
          <option value="vanity">Over the vanity</option>
          <option value="wc">Over the WC</option>
        </select>
      </div>

      <div className={row}>
        <label htmlFor={`${ids}-wh`} className={label}>Water heater</label>
        <select id={`${ids}-wh`} className={FIELD} value={setup.heater?.wall ?? ""} data-wet="heater-wall" onChange={(e) => void save({ ...setup, heater: e.target.value ? { wall: e.target.value as Wall, height_mm: setup.heater?.height_mm ?? HEATER_DEFAULT_HEIGHT_MM, action: setup.heater?.action ?? "box_in" } : null })}>
          <option value="">None in this room</option>
          {WALLS.map((w) => (
            <option key={w} value={w}>{WALL_NAME[w]}</option>
          ))}
        </select>
        {setup.heater && (
          <>
            <label className="flex items-center gap-1.5">
              <span className="t-label-md text-bp-ink-tertiary">at</span>
              <input key={`h-${setup.heater.height_mm}`} type="number" step={50} defaultValue={setup.heater.height_mm} className={NUM} aria-label="Water heater height (mm, bottom of the tank)" data-wet="heater-height" onBlur={(e) => { const h = num(e.target.value, setup.heater!.height_mm); if (h !== setup.heater!.height_mm) void save({ ...setup, heater: { ...setup.heater!, height_mm: h } }); }} />
              <span className="t-label-md text-bp-ink-tertiary">mm</span>
            </label>
            <select className={FIELD} value={setup.heater.action} aria-label="What happens to the water heater" data-wet="heater-action" onChange={(e) => void save({ ...setup, heater: { ...setup.heater!, action: e.target.value as "box_in" | "relocate" } })}>
              <option value="box_in">Box it in</option>
              <option value="relocate">Relocate it locally</option>
            </select>
          </>
        )}
      </div>

      {hasShower && (
        <>
          <div className={row}>
            <label htmlFor={`${ids}-vw`} className={label}>Shower valve wall</label>
            <select id={`${ids}-vw`} className={FIELD} value={setup.valve_wall ?? ""} data-wet="valve-wall" onChange={(e) => void save({ ...setup, valve_wall: (e.target.value || null) as Wall | null })}>
              <option value="">The shower&apos;s back wall</option>
              {WALLS.map((w) => (
                <option key={w} value={w}>{WALL_NAME[w]}</option>
              ))}
            </select>
          </div>
          <div className={row}>
            <label htmlFor={`${ids}-ni`} className={label}>Shower niche</label>
            <select id={`${ids}-ni`} className={FIELD} value={setup.niche?.wall ?? ""} data-wet="niche-wall" onChange={(e) => void save({ ...setup, niche: e.target.value ? { wall: e.target.value as Wall, width_mm: setup.niche?.width_mm ?? NICHE_DEFAULT.width_mm, height_mm: setup.niche?.height_mm ?? NICHE_DEFAULT.height_mm } : null })}>
              <option value="">No niche</option>
              {WALLS.map((w) => (
                <option key={w} value={w}>{WALL_NAME[w]}</option>
              ))}
            </select>
            {setup.niche && (
              <span className="flex items-center gap-1.5">
                <input key={`nw-${setup.niche.width_mm}`} type="number" step={50} defaultValue={setup.niche.width_mm} className={NUM} aria-label="Niche width (mm)" data-wet="niche-width" onBlur={(e) => { const v = num(e.target.value, setup.niche!.width_mm); if (v !== setup.niche!.width_mm) void save({ ...setup, niche: { ...setup.niche!, width_mm: v } }); }} />
                <span className="t-label-md text-bp-ink-tertiary">×</span>
                <input key={`nh-${setup.niche.height_mm}`} type="number" step={50} defaultValue={setup.niche.height_mm} className={NUM} aria-label="Niche height (mm)" data-wet="niche-height" onBlur={(e) => { const v = num(e.target.value, setup.niche!.height_mm); if (v !== setup.niche!.height_mm) void save({ ...setup, niche: { ...setup.niche!, height_mm: v } }); }} />
                <span className="t-label-md text-bp-ink-tertiary">mm</span>
              </span>
            )}
          </div>
        </>
      )}

      <div className={row}>
        <label htmlFor={`${ids}-ex`} className={label}>Extractor fan</label>
        <input id={`${ids}-ex`} type="checkbox" checked={setup.extractor} data-wet="extractor" onChange={(e) => void save({ ...setup, extractor: e.target.checked })} className={`h-4 w-4 rounded-none accent-bp-ink-primary ${FOCUS}`} />
      </div>

      {error ? (
        <p role="alert" className="surface-inverse t-body-sm mt-3 bg-bp-alert-surface px-4 py-3 text-bp-alert-ink">
          {error}
        </p>
      ) : null}
      <p className="t-body-sm mt-4 bg-bp-surface-sunken p-4 text-bp-ink-secondary">
        Each change saves at once. The bill of quantities follows on the next regenerate: the bulkhead&apos;s cove light, the heater&apos;s box-in or move, the niche and the extractor. The elevations draw the niche and the heater at these heights.
      </p>
    </section>
  );
}
