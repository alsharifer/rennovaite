// =============================================================================
// components/blueprint/boq/Extras.tsx — what the BoQ page shows after the
// summary chain, each OUTSIDE the project total:
//
//   • Indicative delivery programme (G5d) — never a line, never a commitment
//   • Cost by room (P4) — a read-only roll-up of the element take-off; the POMI
//     sections stay the export format (deep link ?view=byroom&room=)
//   • Furniture (optional) (P7) — indicative retail, never in contractor scope;
//     it never enters the pinned total (a what-if scenario can add it)
// =============================================================================

import { formatAED, formatQty } from "@/lib/format/aed";
import type { ReviewModel } from "@/lib/boq/review-types";

import { displayUnit } from "./format";

export interface RoomRollup {
  roomId: string;
  roomName: string;
  total_aed: number;
  items: { description: string; qty: number; unit: string; total_aed: number }[];
}

export interface FurnitureView {
  total: number;
  lines: { description: string; quantity: number; rate_aed: number; total_aed: number }[];
}

export function Programme({ programme }: { programme: NonNullable<ReviewModel["programme"]> }) {
  return (
    <section aria-labelledby="boq-programme" className="mt-10 border-t border-bp-line-hairline pt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h2 id="boq-programme" className="t-label-caps text-bp-ink-tertiary">
          INDICATIVE DELIVERY PROGRAMME
        </h2>
        <span className="t-label-md text-bp-ink-secondary">≈ {programme.total_days} days · indicative · derived — never a line</span>
      </div>
      <ul className="mt-4 space-y-2">
        {programme.phases.map((p) => (
          <li key={p.name} className="grid grid-cols-[minmax(0,200px)_56px_minmax(0,1fr)] items-center gap-4">
            <span className="t-body-sm text-bp-ink-primary">{p.name}</span>
            <span className="t-num-sm text-right text-bp-ink-secondary">{p.days} d</span>
            <span className="relative h-2 bg-bp-surface-sunken" aria-hidden="true">
              <span
                className="absolute inset-y-0 bg-bp-ink-tertiary"
                style={{ left: `${((p.start_day - 1) / programme.total_days) * 100}%`, width: `${Math.max(1, (p.days / programme.total_days) * 100)}%` }}
              />
            </span>
          </li>
        ))}
      </ul>
      <p className="t-label-md mt-3 text-bp-ink-tertiary">{programme.basis}</p>
    </section>
  );
}

export function ByRoom({ rooms, open, highlightRoom }: { rooms: RoomRollup[]; open: boolean; highlightRoom: string | null }) {
  return (
    <details id="boq-by-room" open={open} className="mt-10 border-t border-bp-line-hairline pt-6">
      <summary className="t-label-caps cursor-pointer text-bp-ink-tertiary">COST BY ROOM — READ-ONLY ROLL-UP OF THE ELEMENT TAKE-OFF (EXCL. OH&amp;P, CONTINGENCY, VAT)</summary>
      <ul className="mt-4">
        {rooms.map((r) => (
          <li key={r.roomId} id={`boq-room-${r.roomId}`} className="border-b border-bp-line-hairline">
            <details open={highlightRoom === r.roomId}>
              <summary className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3">
                <span className="t-body-sm text-bp-ink-primary">{r.roomName}</span>
                <span className="t-num-md text-bp-ink-primary">{formatAED(r.total_aed)}</span>
              </summary>
              <table className="mb-3 w-full">
                <tbody>
                  {r.items.map((w, i) => (
                    <tr key={i} className="border-t border-bp-line-hairline">
                      <td className="t-body-sm px-4 py-2 pl-10 text-bp-ink-secondary">{w.description}</td>
                      <td className="t-num-sm px-4 py-2 text-right text-bp-ink-secondary">
                        {formatQty(w.qty)} {displayUnit(w.unit)}
                      </td>
                      <td className="t-num-sm px-4 py-2 text-right text-bp-ink-primary">{formatAED(w.total_aed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function Furniture({ furniture }: { furniture: FurnitureView }) {
  return (
    <section aria-labelledby="boq-furniture" className="mt-10 border border-dashed border-bp-line-strong p-4" data-furniture-optional="true">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <p className="t-label-caps text-bp-ink-tertiary">OPTIONAL — NOT IN CONTRACTOR SCOPE · NOT IN THE PROJECT TOTAL</p>
          <h2 id="boq-furniture" className="t-heading-md mt-1 text-bp-ink-primary">
            Furniture (optional)
          </h2>
          <p className="t-body-sm mt-1 text-bp-ink-secondary">Indicative Dubai retail for the staged renders. Add it to a scenario in What-if.</p>
        </div>
        <span className="t-num-lg text-bp-ink-primary">{formatAED(furniture.total)}</span>
      </div>
      <table className="mt-4 w-full">
        <tbody>
          {furniture.lines.map((l, i) => (
            <tr key={i} className="border-t border-bp-line-hairline">
              <td className="t-body-sm py-2 pr-4 text-bp-ink-primary">{l.description}</td>
              <td className="t-num-sm py-2 pr-4 text-right text-bp-ink-secondary">{formatQty(l.quantity)}</td>
              <td className="t-num-sm py-2 pr-4 text-right text-bp-ink-secondary">{formatAED(l.rate_aed)}</td>
              <td className="t-num-sm py-2 text-right text-bp-ink-primary">{formatAED(l.total_aed)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
