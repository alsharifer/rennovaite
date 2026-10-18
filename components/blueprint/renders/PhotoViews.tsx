"use client";

// =============================================================================
// components/blueprint/renders/PhotoViews.tsx — "Your photos" in the renders
// studio (bathroom pilot B2, behind MULTIVIEW_RENDERS_ENABLED).
//
// Every photo of the room is a view of its own — "Photo 1 · your photo", … —
// listed in full (the single-photo control above still feeds the room's
// one-photo render). Add photos takes several at once (compressed on the client,
// straight to Storage, H9). Each photo is placed on the room plan: press where
// it was taken from and drag toward what it looks at (or type X, Y and the
// heading) → PATCH /api/room-photos. The plan shows the room, its door and
// window, its fixtures, and every placed photo as P1, P2, … with its direction.
// =============================================================================

import { useCallback, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { compressImage, ImageProcessingError } from "@/lib/image/compress";
import { footprintCorners, footprintOf } from "@/lib/overlays/footprint";
import { compassWord, headingBetween, type PhotoView } from "@/lib/render/photo-views";
import type { MiniPlan } from "@/lib/render/photo-views-load";
import { uploadFile } from "@/lib/uploads/client";

import { Icon } from "../Icon";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring";
const VB_W = 320;
const PAD = 26;
/** The phone's field of view drawn on the plan (portrait, ultrawide-ish). */
const FOV_DRAW_DEG = 80;

type Pt = [number, number];

export function PhotoViews({ projectId, roomId, roomName, plan, initialViews, spendAed = null, referenceStyle = null, children }: { projectId: string; /** B2: the look the client's references share, in words. */ referenceStyle?: { text: string; at: string } | null; roomId: string; roomName: string; plan: MiniPlan | null; initialViews: PhotoView[]; /** The cost guard: this project's render spend so far (AED). */ spendAed?: number | null; /** The render controls for the selected view. */ children?: (view: PhotoView, setSpend: (aed: number) => void) => React.ReactNode }) {
  const ids = useId();
  const [views, setViews] = useState(initialViews);
  const [selected, setSelected] = useState<string | null>(initialViews[0]?.id ?? null);
  const [busy, setBusy] = useState<null | "upload" | "place">(null);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ from: Pt; to: Pt } | null>(null);
  const [spend, setSpend] = useState(spendAed);
  const [refStyle, setRefStyle] = useState(referenceStyle);
  const [reading, setReading] = useState(false);

  async function readReferences() {
    if (reading) return;
    setReading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/reference-style`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { reference_style?: { text: string; at: string }; error?: string } | null;
      if (!res.ok || !body?.reference_style) throw new Error(body?.error ?? `Not read (${res.status}).`);
      setRefStyle(body.reference_style);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The references could not be read.");
    } finally {
      setReading(false);
    }
  }
  const file = useRef<HTMLInputElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const view = views.find((v) => v.id === selected) ?? null;

  // The room in a fixed-width box, y down, uniform scale.
  const fit = useMemo(() => {
    const poly = plan?.polygon ?? [];
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    const minX = Math.min(...xs, 0), minY = Math.min(...ys, 0), maxX = Math.max(...xs, 1e-6), maxY = Math.max(...ys, 1e-6);
    const s = (VB_W - 2 * PAD) / Math.max(maxX - minX, maxY - minY);
    const h = (maxY - minY) * s + 2 * PAD;
    return { s, h, to: (p: Pt): Pt => [PAD + (p[0] - minX) * s, PAD + (p[1] - minY) * s], from: (v: Pt): Pt => [(v[0] - PAD) / s + minX, (v[1] - PAD) / s + minY] };
  }, [plan]);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/room-photos?room_id=${roomId}`);
    const body = (await res.json().catch(() => null)) as { views?: PhotoView[] } | null;
    if (body?.views) setViews(body.views);
    return body?.views ?? null;
  }, [roomId]);

  async function addPhotos(files: FileList | null) {
    if (!files || files.length === 0 || busy) return;
    setBusy("upload");
    setError(null);
    try {
      for (const f of Array.from(files)) {
        let up = f;
        try {
          up = (await compressImage(f)).file;
        } catch (err) {
          throw new Error(err instanceof ImageProcessingError ? err.message : `We couldn't read ${f.name}. Please try a JPG or PNG.`);
        }
        const body = await uploadFile<{ asset_id?: string }>(up, { kind: "project_asset", projectId, assetKind: "photo" }, { asset_kind: "photo", source: "render", room_id: roomId, filename: f.name });
        if (!body?.asset_id) throw new Error(`${f.name} didn't upload. Please try again.`);
      }
      const list = await reload();
      if (list && list.length) setSelected(list[list.length - 1]!.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The upload didn't work.");
    } finally {
      setBusy(null);
      if (file.current) file.current.value = "";
    }
  }

  async function place(camera: { position: Pt; toward: Pt } | { position: Pt; heading_deg: number } | null) {
    if (!view) return;
    setBusy("place");
    setError(null);
    try {
      const res = await fetch("/api/room-photos", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: view.id, camera }) });
      const body = (await res.json().catch(() => null)) as { views?: PhotoView[]; error?: string } | null;
      if (!res.ok || !body?.views) throw new Error(body?.error ?? `Not saved (${res.status}).`);
      setViews(body.views);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Not saved.");
    } finally {
      setBusy(null);
    }
  }

  const toPlan = (e: ReactPointerEvent<SVGSVGElement>): Pt => {
    const r = svg.current!.getBoundingClientRect();
    return fit.from([((e.clientX - r.left) / r.width) * VB_W, ((e.clientY - r.top) / r.height) * fit.h]);
  };

  // Openings as short thick marks along the nearest edge of the room.
  const edgeMarks = useMemo(() => {
    const poly = plan?.polygon ?? [];
    const mPerU = plan?.m_per_u ?? null;
    return (plan?.openings ?? []).map((o) => {
      let best: { a: Pt; b: Pt; d: number } | null = null;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((o.position[0] - a[0]) * dx + (o.position[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
        const d = Math.hypot(a[0] + t * dx - o.position[0], a[1] + t * dy - o.position[1]);
        if (!best || d < best.d) best = { a, b, d };
      }
      if (!best || !mPerU) return null;
      const len = Math.hypot(best.b[0] - best.a[0], best.b[1] - best.a[1]) || 1;
      const ux = (best.b[0] - best.a[0]) / len, uy = (best.b[1] - best.a[1]) / len;
      const half = o.width_mm / 2000 / mPerU;
      return { id: o.id, kind: o.kind, a: [o.position[0] - ux * half, o.position[1] - uy * half] as Pt, b: [o.position[0] + ux * half, o.position[1] + uy * half] as Pt };
    }).filter(Boolean) as { id: string; kind: string; a: Pt; b: Pt }[];
  }, [plan]);

  const arrow = (c: { position: Pt; heading_deg: number }, len = 34) => {
    const [x, y] = fit.to(c.position);
    const th = (c.heading_deg * Math.PI) / 180;
    return { x, y, tx: x + Math.sin(th) * len, ty: y - Math.cos(th) * len, th };
  };
  const wedge = (c: { position: Pt; heading_deg: number }, r = 46) => {
    const [x, y] = fit.to(c.position);
    const pts = [-FOV_DRAW_DEG / 2, FOV_DRAW_DEG / 2].map((d) => {
      const th = ((c.heading_deg + d) * Math.PI) / 180;
      return `${(x + Math.sin(th) * r).toFixed(1)},${(y - Math.cos(th) * r).toFixed(1)}`;
    });
    return `${x.toFixed(1)},${y.toFixed(1)} ${pts.join(" ")}`;
  };

  const live = drag ? { position: drag.from, heading_deg: headingBetween(drag.from, drag.to) } : null;
  const mPerU = plan?.m_per_u ?? null;

  return (
    <section className="mt-10 border-t border-bp-line-hairline pt-6" aria-labelledby={`${ids}-h`} data-photo-views={views.length}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id={`${ids}-h`} className="t-heading-sm text-bp-ink-primary">
          Your photos <span className="t-label-md font-bp-mono text-bp-ink-secondary">· {views.length}</span>
        </h2>
        {spend != null ? (
          <span className="t-label-md font-bp-mono tabular-nums text-bp-ink-secondary" data-render-spend={spend.toFixed(2)}>
            Render spend · AED {spend.toFixed(2)}
          </span>
        ) : null}
        <button type="button" onClick={() => file.current?.click()} disabled={busy !== null} className={`inline-flex min-h-11 items-center gap-2 border border-bp-line-control px-4 t-nav-item-active text-bp-ink-primary hover:bg-bp-surface-raised disabled:text-bp-ink-tertiary ${FOCUS}`} data-add-photos="">
          <Icon name="add_photo_alternate" size={18} />
          {busy === "upload" ? "Uploading…" : "Add photos"}
        </button>
        <input ref={file} type="file" accept="image/jpeg,image/png,image/heic,image/heif" multiple className="sr-only" aria-label={`Add photos of ${roomName}`} onChange={(e) => void addPhotos(e.target.files)} />
      </div>
      <div className="mt-3 border-l-2 border-bp-line-strong pl-3" data-reference-style={refStyle ? "set" : "none"}>
        <p className="t-label-caps text-bp-ink-tertiary">STYLE FROM YOUR REFERENCES</p>
        <p className="t-body-sm mt-1 text-bp-ink-primary">{refStyle ? refStyle.text : "Not read yet — add your reference photos on 02 Design, then read them here. Until then views follow your chosen direction."}</p>
        <button type="button" onClick={() => void readReferences()} aria-disabled={reading} className={`t-nav-item-active mt-1 text-bp-ink-primary underline underline-offset-2 ${FOCUS}`} data-read-references="">
          {reading ? "Reading your references…" : refStyle ? "Read the references again" : "Read my references"}
        </button>
      </div>
      <p className="t-body-sm mt-3 text-bp-ink-secondary">Each photo becomes a view of {roomName} — restyled from the photo, so it keeps your real layout. Place each one on the plan: where you stood, and which way the phone faced.</p>

      {views.length === 0 ? (
        <p className="t-body-sm mt-4 border border-dashed border-bp-line-control px-4 py-6 text-bp-ink-secondary">No photos of {roomName} yet. Add the photos you have — one per corner, looking across the room, covers it.</p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_360px]">
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-3 self-start" aria-label={`Photos of ${roomName}`}>
            {views.map((v) => (
              <li key={v.id}>
                <button type="button" onClick={() => setSelected(v.id)} aria-pressed={v.id === selected} className={`relative block w-full border text-left ${FOCUS} ${v.id === selected ? "border-bp-brass" : "border-bp-line-hairline hover:border-bp-line-control"}`} data-photo-view={v.id} data-placed={v.camera ? "true" : "false"}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- the client's own photo, at its own size */}
                  <img src={v.url} alt={`${v.label} — ${roomName}`} className="aspect-[3/4] w-full object-cover" />
                  <span className="block px-2 py-1.5">
                    <span className="t-label-md block text-bp-ink-primary">{v.label}</span>
                    <span className="t-label-md block font-bp-mono text-bp-ink-secondary">{v.camera ? `P${v.n} · ${Math.round(v.camera.heading_deg)}° ${compassWord(v.camera.heading_deg)}` : "Not placed"}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="max-w-[440px]">
            <p className="t-label-caps text-bp-ink-tertiary">{view ? `WHERE ${view.label.split(" · ")[0]!.toUpperCase()} WAS TAKEN` : "THE ROOM"}</p>
            {plan && plan.polygon.length >= 3 ? (
              <svg
                ref={svg}
                viewBox={`0 0 ${VB_W} ${fit.h.toFixed(1)}`}
                className="mt-2 block w-full touch-none select-none border border-bp-line-hairline bg-bp-surface-raised"
                role="img"
                aria-label={`${roomName} plan with the photos placed on it`}
                data-photo-plan=""
                onPointerDown={(e) => {
                  if (!view || busy) return;
                  const p = toPlan(e);
                  (e.currentTarget as Element).setPointerCapture(e.pointerId);
                  setDrag({ from: p, to: p });
                }}
                onPointerMove={(e) => drag && setDrag({ from: drag.from, to: toPlan(e) })}
                onPointerUp={(e) => {
                  if (!drag) return;
                  const to = toPlan(e);
                  const moved = Math.hypot(...fit.to(to).map((v, i) => v - fit.to(drag.from)[i]!) as [number, number]) > 8;
                  setDrag(null);
                  if (moved) void place({ position: drag.from, toward: to });
                  else if (view?.camera) void place({ position: drag.from, heading_deg: view.camera.heading_deg });
                  else setError("Drag from where the photo was taken toward what it looks at.");
                }}
              >
                <polygon points={plan.polygon.map((p) => fit.to(p).map((v) => v.toFixed(1)).join(",")).join(" ")} fill="var(--color-surface-base)" stroke="var(--color-ink-primary)" strokeWidth={2} />
                {mPerU
                  ? plan.fixtures.map((f) => {
                      const fp = footprintOf(f.type, f.spec);
                      if (!fp || typeof f.spec?.width_mm !== "number") {
                        const [x, y] = fit.to(f.position);
                        return <circle key={f.id} cx={x} cy={y} r={3} fill="var(--color-ink-tertiary)" />;
                      }
                      return <polygon key={f.id} points={footprintCorners(f.position, fp, mPerU).map((p) => fit.to(p).map((v) => v.toFixed(1)).join(",")).join(" ")} fill="var(--color-surface-sunken)" stroke="var(--color-ink-tertiary)" strokeWidth={1} />;
                    })
                  : null}
                {edgeMarks.map((o) => {
                  const a = fit.to(o.a), b = fit.to(o.b);
                  return <line key={o.id} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="var(--color-ink-primary)" strokeWidth={o.kind === "window" ? 3 : 6} strokeDasharray={o.kind === "window" ? "3 2" : undefined} />;
                })}
                {views.map((v) => {
                  const c = v.id === view?.id && live ? live : v.camera;
                  if (!c) return null;
                  const a = arrow(c);
                  const sel = v.id === view?.id;
                  return (
                    <g key={v.id} data-photo-marker={`P${v.n}`} pointerEvents="none">
                      {sel ? <polygon points={wedge(c)} fill="var(--color-ink-primary)" fillOpacity={0.07} stroke="none" /> : null}
                      <line x1={a.x} y1={a.y} x2={a.tx} y2={a.ty} stroke={sel ? "var(--color-active-brass)" : "var(--color-ink-secondary)"} strokeWidth={sel ? 2.5 : 1.5} />
                      <circle cx={a.x} cy={a.y} r={9} fill="var(--color-surface-raised)" stroke={sel ? "var(--color-active-brass)" : "var(--color-ink-secondary)"} strokeWidth={sel ? 2 : 1.2} />
                      <text x={a.x} y={a.y + 3.5} textAnchor="middle" fontSize={9} fontWeight={600} fill="var(--color-ink-primary)" style={{ fontFamily: "var(--font-mono)" }}>
                        P{v.n}
                      </text>
                    </g>
                  );
                })}
              </svg>
            ) : (
              <p className="t-body-sm mt-2 text-bp-ink-secondary">This room has no outline on the plan yet — draw it on 01 Plan to place photos.</p>
            )}
            {view ? <CameraFields key={`${view.id}:${view.camera?.heading_deg ?? "-"}:${view.camera?.position.join(",") ?? "-"}`} view={view} mPerU={mPerU} disabled={busy !== null} onSave={(c) => void place(c)} /> : null}
            {error ? (
              <p role="alert" className="surface-inverse t-body-sm mt-3 bg-bp-alert-surface px-4 py-3 text-bp-alert-ink">
                {error}
              </p>
            ) : null}
          </div>
        </div>
      )}
      {view && children ? <div className="mt-6">{children(view, setSpend)}</div> : null}
    </section>
  );
}

/** The keyboard way to place a photo: where it was taken from (m from the plan's top-left) and its heading. */
function CameraFields({ view, mPerU, disabled, onSave }: { view: PhotoView; mPerU: number | null; disabled: boolean; onSave: (c: { position: Pt; heading_deg: number } | null) => void }) {
  const k = mPerU ?? 1;
  const [x, setX] = useState(view.camera ? (view.camera.position[0] * k).toFixed(2) : "");
  const [y, setY] = useState(view.camera ? (view.camera.position[1] * k).toFixed(2) : "");
  const [h, setH] = useState(view.camera ? String(Math.round(view.camera.heading_deg)) : "");
  const ok = [x, y, h].every((v) => v.trim() !== "" && Number.isFinite(Number(v)));
  const field = "h-9 w-[76px] rounded-none border border-bp-line-control bg-bp-surface-raised px-2 text-right t-num-sm text-bp-ink-primary";
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onSave({ position: [Number(x) / k, Number(y) / k], heading_deg: Number(h) });
      }}
      data-camera-fields={view.id}
    >
      {(
        [
          ["X (m)", x, setX],
          ["Y (m)", y, setY],
          ["Heading (°)", h, setH],
        ] as const
      ).map(([label, v, set]) => (
        <label key={label} className="flex flex-col gap-1">
          <span className="t-label-md text-bp-ink-tertiary">{label}</span>
          <input type="number" step="any" value={v} onChange={(e) => set(e.target.value)} disabled={disabled} className={`${field} ${FOCUS}`} />
        </label>
      ))}
      <button type="submit" disabled={disabled || !ok} className={`inline-flex h-9 items-center border border-bp-line-control px-3 t-nav-item-active text-bp-ink-primary disabled:text-bp-ink-tertiary ${FOCUS}`}>
        Place
      </button>
      {view.camera ? (
        <button type="button" onClick={() => onSave(null)} disabled={disabled} className={`inline-flex h-9 items-center px-2 t-body-sm text-bp-ink-secondary hover:text-bp-ink-primary ${FOCUS}`}>
          Clear
        </button>
      ) : null}
      <span className="t-label-md w-full text-bp-ink-tertiary">X across, Y down from the plan&rsquo;s top-left corner · heading 0° = up the plan, 90° = right.</span>
    </form>
  );
}
