"use client";

// =============================================================================
// components/blueprint/renders/PhotoViewRender.tsx — one photo view, rendered
// and checked (bathroom pilot B2).
//
// "Photo N · your photo" restyled to the client's references, beside the photo
// it came from. Its design checks: "Layout follows your photo ✓" — or, when the
// placement check failed after its one retry, the honest failure ("The render
// moved the vanity — see what differs.") in the inverse block, with "See what
// differs" drawing where each checked item is in the photo and in the render.
// Below: the style line, the perceptual difference vs the photo, attempts and
// what the view cost (the cost guard).
// =============================================================================

import { useId, useState } from "react";

import { FITTINGS_NOTE, FITTINGS_NOTE_FULL } from "@/lib/render/photo-check-vocab";
import type { PhotoViewGate } from "@/lib/render/photo-view-run";
import type { PhotoView } from "@/lib/render/photo-views";

import { Icon } from "../Icon";

export interface PhotoViewRenderInfo {
  render_id: string;
  image_url: string | null;
  gate: PhotoViewGate;
}

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring";
const AED = (usd: number) => `AED ${(usd * 3.6725).toFixed(2)}`;

type Box = [number, number, number, number];

function Boxes({ boxes }: { boxes: { ref: string; label: string; box: Box; bad: boolean }[] }) {
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
      {boxes.map((b) => (
        <g key={b.ref}>
          <rect x={b.box[0]} y={b.box[1]} width={b.box[2] - b.box[0]} height={b.box[3] - b.box[1]} fill="none" stroke={b.bad ? "var(--color-alert-surface)" : "var(--color-ink-on-inverse)"} strokeWidth={b.bad ? 0.9 : 0.5} strokeDasharray={b.bad ? undefined : "1.5 1"} vectorEffect="non-scaling-stroke" />
        </g>
      ))}
    </svg>
  );
}

export function PhotoViewRender({ view, roomName, initial, onSpend }: { view: PhotoView; roomName: string; initial: PhotoViewRenderInfo | null; onSpend?: (aed: number) => void }) {
  const ids = useId();
  const [info, setInfo] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diff, setDiff] = useState(false);
  const gate = info?.gate ?? null;
  const last = gate?.attempts.at(-1) ?? null;
  const failed = gate?.outcome === "failed";
  const passed = gate?.outcome === "passed";

  async function render() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/render/photo-view", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ room_photo_id: view.id }) });
      const body = (await res.json().catch(() => null)) as (PhotoViewRenderInfo & { spend?: { render_spend_aed: number }; error?: string }) | null;
      if (!res.ok || !body?.gate) throw new Error(body?.error ?? `The view did not render (${res.status}).`);
      setInfo({ render_id: body.render_id, image_url: body.image_url, gate: body.gate });
      setDiff(body.gate.outcome === "failed");
      if (body.spend) onSpend?.(body.spend.render_spend_aed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The view did not render.");
    } finally {
      setBusy(false);
    }
  }

  const name = (ref: string) => gate?.items.find((i) => i.ref === ref)?.short ?? ref;
  const bad = new Set((last?.failures ?? []).map((f) => f.ref));
  const beforeBoxes = (gate?.before ?? []).filter((l) => l.present && l.box && (gate?.checked.includes(l.ref) || bad.has(l.ref))).map((l) => ({ ref: l.ref, label: name(l.ref), box: l.box as Box, bad: bad.has(l.ref) }));
  const afterBoxes = (last?.after ?? []).filter((l) => l.present && l.box && (gate?.checked.includes(l.ref) || bad.has(l.ref))).map((l) => ({ ref: l.ref, label: name(l.ref), box: l.box as Box, bad: bad.has(l.ref) }));

  return (
    <div className="border-t border-bp-line-hairline pt-5" data-photo-view-render={view.id} data-outcome={gate?.outcome ?? "none"}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="t-heading-sm text-bp-ink-primary">
          {view.label.split(" · ")[0]} <span className="t-label-md text-bp-ink-secondary">· from your photo</span>
        </h3>
        <button type="button" onClick={() => void render()} aria-disabled={busy} aria-describedby={busy ? `${ids}-busy` : undefined} className={`inline-flex min-h-11 items-center gap-2 px-4 t-nav-item-active ${FOCUS} ${busy ? "cursor-progress bg-bp-surface-sunken text-bp-ink-tertiary" : "bg-bp-ink-primary text-bp-ink-on-inverse hover:bg-bp-ink-secondary"}`} data-render-photo-view={view.id}>
          <Icon name={busy ? "progress_activity" : info ? "refresh" : "palette"} size={18} />
          {busy ? "Rendering…" : info ? "Render again" : "Render this view"}
        </button>
      </div>
      {busy ? (
        <p id={`${ids}-busy`} className="t-body-sm mt-2 text-bp-ink-secondary" aria-live="polite">
          Restyling your photo and checking every fixture is where the photo has it — up to two attempts, about a minute each.
        </p>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <figure>
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- the client's photo */}
            <img src={view.url} alt={`${view.label} — ${roomName} as it is`} className="block w-full" />
            {diff && gate ? <Boxes boxes={beforeBoxes} /> : null}
          </div>
          <figcaption className="t-label-md mt-1 text-bp-ink-secondary">Your photo</figcaption>
        </figure>
        <figure>
          <div className="relative">
            {info?.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- the render
              <img src={info.image_url} alt={`${view.label} restyled — ${failed ? "did not pass the layout check" : "layout follows the photo"}`} className="block w-full" />
            ) : (
              <div className="flex aspect-[946/2048] w-full items-center justify-center border border-dashed border-bp-line-control t-body-sm text-bp-ink-tertiary">Not rendered yet</div>
            )}
            {diff && gate ? <Boxes boxes={afterBoxes} /> : null}
          </div>
          <figcaption className="t-label-md mt-1 text-bp-ink-secondary">{failed ? "Restyled — not passed" : "Restyled"}</figcaption>
        </figure>
      </div>

      {gate ? (
        <div className="mt-4 space-y-2" aria-live="polite">
          {passed ? (
            <p className="t-body-sm text-bp-ink-primary" data-check-line="layout">
              {gate.line} <span className="text-bp-ink-secondary" title={FITTINGS_NOTE_FULL}>· {FITTINGS_NOTE}</span>
            </p>
          ) : (
            <div role="status" className="surface-inverse bg-bp-alert-surface px-4 py-3 text-bp-alert-ink" data-check-line="layout">
              <p className="t-body-sm">
                {gate.line} <span title={FITTINGS_NOTE_FULL}>· {FITTINGS_NOTE}</span>
              </p>
              {failed ? (
                <button type="button" onClick={() => setDiff((v) => !v)} aria-pressed={diff} className={`t-nav-item-active mt-2 underline underline-offset-2 ${FOCUS}`}>
                  {diff ? "Hide what differs" : "See what differs"}
                </button>
              ) : null}
              {failed && diff ? (
                <ul className="t-body-sm mt-2 list-disc pl-5">
                  {(last?.failures ?? []).map((f) => (
                    <li key={`${f.ref}${f.reason}`}>{f.message.replace(/^./, (c) => c.toUpperCase())}.</li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
          <p className={`t-body-sm ${gate.style_line.endsWith("✓") ? "text-bp-ink-primary" : "text-bp-ink-secondary"}`} data-check-line="style" data-style-score={gate.attempts.at(-1)?.style?.score ?? ""}>
            {gate.style_line}
          </p>
          <p className="t-label-md font-bp-mono tabular-nums text-bp-ink-secondary" data-scores="">
            {last?.ssim != null ? `vs your photo: SSIM ${last.ssim.toFixed(3)} · ${last.changed_pct?.toFixed(1)}% of pixels changed · ` : ""}
            {gate.attempts.length} {gate.attempts.length === 1 ? "attempt" : "attempts"} · {AED(gate.cost_usd)} · checked: {gate.checked.map(name).join(", ") || "—"}
          </p>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="surface-inverse t-body-sm mt-3 bg-bp-alert-surface px-4 py-3 text-bp-alert-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
