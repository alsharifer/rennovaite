"use client";

// =============================================================================
// components/blueprint/plan/OpeningsCheckPanel.tsx — "We found 2 windows and an
// opening to the kitchen — correct?" (R10b, spec §7.5).
//
// The plan-check pattern (PlanCheckPanel): a sentence, the list, and choosing a
// row highlights that opening on the canvas (the Openings layer opens with it
// selected — drag it or change its size there to adjust; adjusting confirms
// it). Confirm all / Confirm / Remove per row; Re-detect on demand.
//
// Detection runs once per plan by itself: right after the plan is read, or —
// for a plan read before R10b — the first time this page (or Renders) opens.
// The panel starts that lazy run and shows it running.
//
// Events (the editor is a separate client tree inside PlanLayers):
//   rv:openings-focus   { id }   select an opening on the Openings layer
//   rv:openings-changed { from } re-read the openings (both directions)
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { detectionRunning, isUnconfirmedDetected, openingRowLabel, openingsSentence, openingWidthLabel, widthsToCheck, OPENINGS_RULE, type DetectionMeta, type DetectionRun } from "@/lib/plan/openings-vocab";

import { Button } from "../Button";
import { Icon } from "../Icon";
import { ProvenanceMark } from "../ProvenanceMark";

export const OPENINGS_FOCUS_EVENT = "rv:openings-focus";
export const OPENINGS_CHANGED_EVENT = "rv:openings-changed";

interface Row {
  id: string;
  kind: string;
  room_id: string | null;
  source: string | null;
  confirmed_at: string | null;
  detection: DetectionMeta | null;
  width_mm: number | null;
  derived?: boolean | null;
}

export interface OpeningsCheckPanelProps {
  planId: string;
  rooms: { id: string; name: string }[];
  /** A drawing exists to read (a parsed plan with a source file). */
  canDetect: boolean;
  detectedAt: string | null;
  run: DetectionRun | null;
}

const GLYPH: Record<string, string> = { window: "window", door: "door_front", archway: "meeting_room", gate: "fence" };
const POLL_MS = 4000;

export function OpeningsCheckPanel({ planId, rooms, canDetect, detectedAt, run: initialRun }: OpeningsCheckPanelProps) {
  const [rows, setRows] = useState<Row[] | null>(null);
  // A plan never read for openings starts its one automatic run on mount — shown running from the first paint.
  const autoNeeded = canDetect && !detectedAt;
  const [run, setRun] = useState<DetectionRun | null>(() => (autoNeeded ? { status: "running", started_at: new Date().toISOString(), mode: "auto" } : initialRun));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const started = useRef(false);
  const names = useMemo(() => new Map(rooms.map((r) => [r.id, r.name])), [rooms]);
  const roomName = useCallback((id: string) => names.get(id) ?? null, [names]);

  const load = useCallback(
    () =>
      fetch(`/api/plan-openings?plan_id=${planId}`)
        .then((res) => res.json())
        .catch(() => null)
        .then((body: { openings?: Row[] } | null) => setRows((body?.openings ?? []).map((o) => ({ ...o, confirmed_at: o.confirmed_at ?? null, detection: o.detection ?? null })))),
    [planId],
  );

  const changed = useCallback(() => window.dispatchEvent(new CustomEvent(OPENINGS_CHANGED_EVENT, { detail: { from: "panel" } })), []);

  useEffect(() => {
    void load();
    const on = (e: Event) => {
      if ((e as CustomEvent<{ from?: string }>).detail?.from !== "panel") void load();
    };
    window.addEventListener(OPENINGS_CHANGED_EVENT, on);
    return () => window.removeEventListener(OPENINGS_CHANGED_EVENT, on);
  }, [load]);

  // The caller shows the run as running (the Re-detect button, or the initial state for "auto").
  const detect = useCallback(
    async (mode: "auto" | "redetect") => {
      try {
        const res = await fetch("/api/plan-openings/detect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan_id: planId, mode }) });
        const body = (await res.json().catch(() => null)) as { status?: string; error?: string; run?: DetectionRun | null } | null;
        if (body?.status === "failed") setError("The drawing could not be read for openings. Try Re-detect, or draw them on the Openings layer.");
        // The list first, then the state: flipping to "done" before the rows arrive
        // showed a moment of "none found" (seen live).
        const next =
          body?.status === "already" || body?.status === "running"
            ? (body.run ?? null)
            : (((await fetch(`/api/plan-openings/detect?plan_id=${planId}`).then((r) => r.json()).catch(() => null))?.run as DetectionRun | null) ?? null);
        await load();
        setRun(next);
      } catch {
        setError("The drawing could not be read for openings.");
        await load();
        setRun(null);
      }
      changed();
    },
    [planId, load, changed],
  );

  // Once per plan: a plan read before R10b is read for openings the first time it is opened.
  useEffect(() => {
    if (started.current || !autoNeeded) return;
    started.current = true;
    void detect("auto");
  }, [autoNeeded, detect]);

  const redetect = () => {
    setError(null);
    setRun({ status: "running", started_at: new Date().toISOString(), mode: "redetect" });
    void detect("redetect");
  };

  // Someone else's run (another tab, the reading step): wait for it.
  const running = detectionRunning(run);
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(async () => {
      const st = await fetch(`/api/plan-openings/detect?plan_id=${planId}`).then((r) => r.json()).catch(() => null);
      const next = (st?.run as DetectionRun | null) ?? null;
      if (!detectionRunning(next)) {
        await load();
        setRun(next);
        changed();
      }
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [running, planId, load, changed]);

  const confirm = async (ids: string[] | "all") => {
    setBusy(ids === "all" ? "all" : ids[0]!);
    setError(null);
    try {
      const res = await fetch("/api/plan-openings/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ids === "all" ? { plan_id: planId, all: true } : { plan_id: planId, ids }) });
      if (!res.ok) throw new Error();
      await load();
      changed();
    } catch {
      setError("Could not confirm — try again.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/plan-openings?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      await load();
      changed();
    } catch {
      setError("Could not remove — try again.");
    } finally {
      setBusy(null);
    }
  };

  const busyFor = (reasonId: string) => (busy ? { reason: "Saving…", reasonId, showReason: true } : (false as const));

  const focus = (id: string) => {
    setPicked(id);
    window.dispatchEvent(new CustomEvent(OPENINGS_FOCUS_EVENT, { detail: { id } }));
  };

  const pending = (rows ?? []).filter(isUnconfirmedDetected);
  const counted = (rows ?? []).filter((r) => !isUnconfirmedDetected(r));
  const toCheck = widthsToCheck(rows ?? []);
  const sentence = openingsSentence(pending, roomName);

  return (
    <section aria-labelledby="openings-h" className="border-t border-bp-line-hairline pt-4" data-openings-check={running ? "running" : pending.length ? "pending" : "settled"}>
      <h2 id="openings-h" className="t-label-caps flex items-center gap-2 text-bp-ink-tertiary">
        <Icon name="window" size={18} />
        WINDOWS &amp; DOORS
      </h2>

      {running ? (
        <p className="t-body-sm mt-3 text-bp-ink-secondary" aria-live="polite" data-testid="openings-detecting">
          Finding windows and doors… <span className="text-bp-ink-tertiary">The plan is ready to use meanwhile; they appear here when found.</span>
        </p>
      ) : rows === null ? (
        <p className="t-body-sm mt-3 text-bp-ink-tertiary">Loading…</p>
      ) : pending.length ? (
        <>
          <p className="t-body-md mt-3 text-bp-ink-primary" data-testid="openings-sentence">
            {sentence}
          </p>
          <p className="t-label-md mt-2 text-bp-ink-secondary">{OPENINGS_RULE}</p>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <Button kind="primary" onClick={() => void confirm("all")} disabled={busyFor("openings-busy-confirm")} testId="openings-confirm-all">
              Confirm all · {pending.length}
            </Button>
            {canDetect ? (
              <Button kind="quiet" onClick={redetect} disabled={busyFor("openings-busy-redetect")} testId="openings-redetect">
                Re-detect
              </Button>
            ) : null}
          </div>
          <ul className="mt-4" data-testid="openings-list" aria-label="Openings found on the drawing">
            {pending.map((o) => {
              const { title, where } = openingRowLabel(o, roomName);
              return (
                <li key={o.id} className={`flex items-center gap-1 border-b border-bp-line-hairline ${picked === o.id ? "bg-bp-surface-raised" : ""}`} data-opening={o.id}>
                  <button
                    type="button"
                    aria-pressed={picked === o.id}
                    onClick={() => focus(o.id)}
                    className="t-body-sm flex min-h-11 min-w-0 flex-1 items-center gap-3 px-1 text-left text-bp-ink-primary hover:bg-bp-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring"
                  >
                    <Icon name={GLYPH[o.kind] ?? "door_front"} size={18} className="text-bp-ink-secondary" />
                    <span className="min-w-0 flex-1">
                      <span className="block">{title}</span>
                      <span className="t-label-md block text-bp-ink-secondary">{where}</span>
                    </span>
                    <WidthText row={o} />
                  </button>
                  <button type="button" onClick={() => void confirm([o.id])} disabled={busy !== null} aria-label={`Confirm ${title.toLowerCase()} in ${where}`} className="inline-flex min-h-11 min-w-11 items-center justify-center text-bp-ink-secondary hover:text-bp-ink-primary focus-visible:outline-2 focus-visible:outline-bp-focus-ring disabled:opacity-50">
                    <Icon name="check" size={18} />
                  </button>
                  <button type="button" onClick={() => void remove(o.id)} disabled={busy !== null} aria-label={`Remove ${title.toLowerCase()} in ${where}`} className="inline-flex min-h-11 min-w-11 items-center justify-center text-bp-ink-secondary hover:text-bp-ink-primary focus-visible:outline-2 focus-visible:outline-bp-focus-ring disabled:opacity-50">
                    <Icon name="close" size={18} />
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="t-label-md mt-2 text-bp-ink-tertiary">Choose one to see it on the plan; drag it or change its size there to adjust it.</p>
        </>
      ) : (
        <>
          <p className="t-body-sm mt-3 text-bp-ink-secondary" data-testid="openings-settled">
            {counted.length
              ? `${counted.length} ${counted.length === 1 ? "opening" : "openings"} on the plan${run?.status === "done" && run.found === 0 ? " — none more found on the drawing" : ""}. They count in the BoQ.`
              : !canDetect
                ? "No drawing to read — add windows and doors on the Openings layer."
                : run?.status === "done"
                  ? "No windows or doors were found on the drawing. Add them on the Openings layer."
                  : "No windows or doors on the plan yet."}
          </p>
          {canDetect ? (
            <div className="mt-3">
              <Button kind="quiet" onClick={redetect} disabled={busyFor("openings-busy-redetect")} testId="openings-redetect">
                Re-detect
              </Button>
            </div>
          ) : null}
        </>
      )}

      {!running && toCheck.length ? (
        <div className="mt-5" data-testid="openings-widths-to-check">
          <h3 className="t-label-caps text-bp-ink-tertiary">WIDTHS TO CHECK · {toCheck.length}</h3>
          <p className="t-label-md mt-1 text-bp-ink-secondary">Confirmed where they are and what they are; their widths are estimates. Choose one and enter its width on the plan to measure it.</p>
          <ul className="mt-2" aria-label="Openings with an estimated width">
            {toCheck.map((o) => {
              const { title, where } = openingRowLabel(o, roomName);
              return (
                <li key={o.id} className="border-b border-bp-line-hairline" data-width-check={o.id}>
                  <button
                    type="button"
                    onClick={() => focus(o.id)}
                    className="t-body-sm flex min-h-11 w-full items-center gap-3 px-1 text-left text-bp-ink-primary hover:bg-bp-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring"
                  >
                    <Icon name={GLYPH[o.kind] ?? "door_front"} size={18} className="text-bp-ink-secondary" />
                    <span className="min-w-0 flex-1">
                      <span className="block">{title}</span>
                      <span className="t-label-md block text-bp-ink-secondary">{where}</span>
                    </span>
                    <WidthText row={o} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="surface-inverse mt-3 bg-bp-alert-surface px-4 py-3 text-bp-alert-ink">
          <p className="t-body-sm">{error}</p>
        </div>
      ) : null}
    </section>
  );
}

/** "≈ 1.80 m — check" (derived mark) while the size is an estimate; "1.80 m" once measured. */
function WidthText({ row }: { row: Row }) {
  const w = openingWidthLabel(row);
  if (!w) return null;
  return w.derived ? (
    <span className="inline-flex items-center gap-1 text-bp-prov-derived-text" data-width="derived">
      <ProvenanceMark tier="derived" className="text-bp-prov-derived-mark" />
      <span className="t-num-sm">{w.text}</span>
    </span>
  ) : (
    <span className="t-num-sm text-bp-ink-secondary" data-width="measured">
      {w.text}
    </span>
  );
}
