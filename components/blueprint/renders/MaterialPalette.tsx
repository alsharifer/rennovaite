"use client";

// =============================================================================
// components/blueprint/renders/MaterialPalette.tsx — the studio's right column
// (K8 #5, spec §6.4): MATERIAL PALETTE rows (sunken 44 px swatch, name,
// role · supplier label from the catalogue, swap), "Include furniture" (P7's
// optional BoQ line) and "Material details" (the surface-spec numbers).
//
// Honest about what it does: the palette is the studio's catalogue
// (lib/materials) and a swap is not saved and moves no cost — products are
// chosen, and priced, in 04 Cost · Specification. The copy says so.
// =============================================================================

import Link from "next/link";
import { useState } from "react";

import { MATERIALS, SURFACE_SPECS, type Material } from "@/lib/materials";

import { Icon } from "../Icon";

/** What each palette slot is for. */
const ROLE: Record<string, string> = { walnut: "Joinery", stone: "Floor", metal: "Fittings", textile: "Soft furnishing" };
const roleOf = (id: string) => ROLE[id.split("-")[0]!] ?? "Finish";

function Swatch({ src }: { src: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- self-hosted swatch
  return <img src={src} alt="" className="h-11 w-11 shrink-0 border border-bp-line-hairline bg-bp-surface-sunken object-cover" />;
}

export function MaterialPalette({
  projectId,
  furniture,
}: {
  projectId: string;
  /** P7: offered when staging is on, the view is locked and the room has a staging set. */
  furniture: { roomId: string; optedIn: boolean } | null;
}) {
  const [slots, setSlots] = useState<Material[]>(() => MATERIALS.slice(0, 4));
  const [open, setOpen] = useState<number | null>(null);
  const [optedIn, setOptedIn] = useState<Record<string, boolean>>({});
  const [optError, setOptError] = useState<string | null>(null);
  const included = furniture ? (optedIn[furniture.roomId] ?? furniture.optedIn) : false;

  async function includeFurniture() {
    if (!furniture || included) return;
    setOptError(null);
    try {
      const res = await fetch("/api/furniture-opt-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId, room_id: furniture.roomId }) });
      if (!res.ok) throw new Error("Please try again.");
      setOptedIn((p) => ({ ...p, [furniture.roomId]: true }));
    } catch (e) {
      setOptError(e instanceof Error ? e.message : "Please try again.");
    }
  }

  return (
    <div>
      <h2 className="t-label-caps text-bp-ink-tertiary">MATERIAL PALETTE</h2>
      <p className="t-body-sm mt-2 text-bp-ink-secondary">Four finishes that anchor this direction. A swap shows an alternative here; the products you are priced for are chosen in 04 Cost.</p>
      <ul className="mt-3">
        {slots.map((m, i) => (
          <li key={`${m.id}-${i}`} className="border-b border-bp-line-hairline py-3" data-material={m.id}>
            <div className="flex items-center gap-3">
              <Swatch src={m.swatch_url} />
              <span className="min-w-0 flex-1">
                <span className="t-heading-sm block truncate text-bp-ink-primary">{m.name}</span>
                <span className="t-body-sm block truncate text-bp-ink-secondary">
                  {roleOf(m.id)} · {m.source}
                </span>
              </span>
              <button type="button" aria-expanded={open === i} aria-label={`Swap ${m.name}`} onClick={() => setOpen(open === i ? null : i)} className="flex h-9 w-9 items-center justify-center text-bp-ink-secondary hover:text-bp-ink-primary">
                <Icon name="swap_horiz" className="text-[20px]" />
              </button>
            </div>
            {open === i ? (
              <ul className="mt-2 bg-bp-surface-raised" aria-label={`Alternatives to ${m.name}`}>
                {m.alternates.map((alt) => (
                  <li key={alt.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSlots((prev) => prev.map((s, j) => (j === i ? { ...alt, alternates: prev[i]!.alternates } : s)));
                        setOpen(null);
                      }}
                      className="flex w-full items-center gap-3 px-2 py-2 text-left hover:bg-bp-surface-sunken"
                    >
                      <Swatch src={alt.swatch_url} />
                      <span className="min-w-0 flex-1">
                        <span className="t-body-sm block truncate text-bp-ink-primary">{alt.name}</span>
                        <span className="t-label-md block truncate font-bp-mono text-bp-ink-tertiary">{alt.source}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>

      {furniture ? (
        <div className="mt-4">
          <label className="flex items-start gap-3">
            <input type="checkbox" checked={included} disabled={included} onChange={() => void includeFurniture()} className="mt-0.5 h-5 w-5 accent-[var(--color-ink-primary)]" aria-describedby="furniture-note" />
            <span>
              <span className="t-heading-sm block text-bp-ink-primary">Include furniture</span>
              <span id="furniture-note" className="t-body-sm block text-bp-ink-secondary">
                {included ? (
                  <>
                    Added to your cost as an optional line — switch it off any time in{" "}
                    <Link href={`/project/${projectId}/boq`} className="text-bp-ink-primary underline underline-offset-2">
                      04 Cost
                    </Link>
                    .
                  </>
                ) : (
                  "Adds this room's furniture to your cost as an optional line, outside the contractor's scope."
                )}
              </span>
            </span>
          </label>
          {optError ? <p className="t-body-sm mt-2 text-bp-ink-primary">That wasn&apos;t saved — {optError}</p> : null}
        </div>
      ) : null}

      <details className="mt-4">
        <summary className="t-body-sm flex min-h-9 cursor-pointer list-none items-center gap-2 text-bp-ink-primary [&::-webkit-details-marker]:hidden">
          <Icon name="expand_more" className="text-[20px]" />
          Material details
        </summary>
        <dl className="mt-2 grid grid-cols-2 gap-3 bg-bp-surface-sunken p-3">
          {SURFACE_SPECS.map((s) => (
            <div key={s.label}>
              <dt className="t-label-caps text-bp-ink-tertiary">{s.label.toUpperCase()}</dt>
              <dd className="t-num-sm text-bp-ink-primary">{s.value}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
