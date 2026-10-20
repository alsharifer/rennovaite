"use client";

// =============================================================================
// components/blueprint/renders/PhotoViewStudio.tsx — the renders studio for a
// room's photo views (bathroom pilot B4, spec §7.5, Figma 82:48 / dark 82:2438).
//
// Every photo of a room is a view ("Photo 2 · your photo"), restyled with its
// layout held (B2/B2b). The first view the user locks ANCHORS the room: every
// other view renders against it and says so ("Finishes follow Photo 2 (locked)
// ✓"); when the anchor changes, the others say they no longer follow — they are
// never re-rendered on their own.
//
//   usePhotoViews     the state and every call (render, lock, ask for a change,
//                     place on the plan, add photos, read the references,
//                     render remaining — the cost guard's default scope).
//   PhotoViewCentre   eyebrow · image · views strip (+ Add photos, Add a view) ·
//                     design checks · Lock / Render again / versions · Ask for a
//                     change + the last change.
//   PhotoViewSide     VIEWS ON THE PLAN (room, door, window, fixtures, P markers;
//                     press + drag to place the view) · design checks per view ·
//                     render spend · style from the references.
// =============================================================================

import { useCallback, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { RefusedChange } from "@/lib/render/photo-view-change";

import { compressImage, ImageProcessingError } from "@/lib/image/compress";
import { footprintCorners, footprintOf } from "@/lib/overlays/footprint";
import { approvalDrift, MATERIAL_LABEL_TEXT, type MaterialRow } from "@/lib/render/material-labels";
import { FITTINGS_NOTE, FITTINGS_NOTE_FULL } from "@/lib/render/photo-check-vocab";
import type { PhotoViewChange, PhotoViewGate } from "@/lib/render/photo-view-run";
import { compassWord, headingBetween, type PhotoCamera, type PhotoView } from "@/lib/render/photo-views";
import type { MiniPlan } from "@/lib/render/photo-views-load";
import { followsLine, followsStateOf, specFieldsChanged, viewsToRender, type FollowsState, type RoomAnchor } from "@/lib/render/room-spec-vocab";
import { uploadFile } from "@/lib/uploads/client";

import { Button } from "../Button";
import { Icon } from "../Icon";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring";
const AED = (n: number) => `AED ${n.toFixed(2)}`;
type Pt = [number, number];
type Box = [number, number, number, number];

export interface PhotoViewVersionLite {
  render_id: string;
  image_url: string | null;
  gate: PhotoViewGate;
  created_at: string;
  parent_render_id: string | null;
  anchor_render_id: string | null;
}

export interface PhotoViewsInitial {
  byRoom: Record<string, PhotoView[]>;
  plans: Record<string, MiniPlan>;
  versions: Record<string, PhotoViewVersionLite[]>;
  locked: Record<string, string>;
  anchors: Record<string, RoomAnchor>;
  spendAed: number | null;
  referenceStyle: { text: string; at: string } | null;
  /** What one view costs to render (AED): one attempt … two (the cost guard's estimate). */
  costPerView: { low: number; high: number };
  /** B7 6: each view's latest refused change (image + reading), newer than its kept version. */
  refused?: Record<string, RefusedChange>;
  /** C5 #1: per room with an anchor, every material its design shows, labelled. */
  materials?: Record<string, MaterialRow[]>;
  /** C5 #1: per room, the design fingerprint now — a locked view made under another is "changed since approval". */
  designNow?: Record<string, string>;
}

type Busy = "render" | "lock" | "change" | "place";
export type PhotoRowState = "changed" | "locked" | "anchor" | "ready" | "rendering" | "not_yet" | "not_placed" | "failed" | "stale";

export const PHOTO_STATE: Record<PhotoRowState, { icon: string; label: string }> = {
  changed: { icon: "update", label: "CHANGED SINCE APPROVAL" },
  anchor: { icon: "anchor", label: "ANCHOR" },
  locked: { icon: "check", label: "LOCKED" },
  ready: { icon: "visibility", label: "READY" },
  rendering: { icon: "progress_activity", label: "RENDERING" },
  not_yet: { icon: "radio_button_unchecked", label: "NOT YET" },
  not_placed: { icon: "push_pin", label: "NOT PLACED" },
  failed: { icon: "error", label: "CHECK FAILED" },
  stale: { icon: "update", label: "TO UPDATE" },
};

async function postJson<T>(url: string, body: unknown): Promise<{ ok: boolean; status: number; json: (T & { error?: string; code?: string; plan_href?: string }) | null }> {
  const res = await fetch(url, { method: url.includes("room-photos") ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { ok: res.ok, status: res.status, json: (await res.json().catch(() => null)) as never };
}

// --- state + calls -------------------------------------------------------------------------

export function usePhotoViews(projectId: string, initial: PhotoViewsInitial | null) {
  const [byRoom, setByRoom] = useState(initial?.byRoom ?? {});
  const [versions, setVersions] = useState(initial?.versions ?? {});
  const [locked, setLocked] = useState(initial?.locked ?? {});
  const [anchors, setAnchors] = useState(initial?.anchors ?? {});
  const [refused, setRefused] = useState<Record<string, RefusedChange>>(initial?.refused ?? {});
  const [spend, setSpend] = useState(initial?.spendAed ?? null);
  const [refStyle, setRefStyle] = useState(initial?.referenceStyle ?? null);
  const [readingRefs, setReadingRefs] = useState(false);
  const [busy, setBusy] = useState<Record<string, Busy>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [notice, setNotice] = useState<Record<string, { text: string; href: string | null; kind: "info" | "error" }>>({});
  const [versionIdx, setVersionIdx] = useState<Record<string, number>>({});
  const [running, setRunning] = useState(false);
  const plans = initial?.plans ?? {};
  const materials = initial?.materials ?? {};
  const designNow = initial?.designNow ?? {};

  const roomOf = useCallback((photoId: string) => Object.entries(byRoom).find(([, vs]) => vs.some((v) => v.id === photoId))?.[0] ?? null, [byRoom]);
  const setBusyFor = (id: string, b: Busy | null) => setBusy((p) => { const n = { ...p }; if (b) n[id] = b; else delete n[id]; return n; });
  const say = (id: string, n: { text: string; href?: string | null; kind?: "info" | "error" } | null) => setNotice((p) => { const c = { ...p }; if (n) c[id] = { text: n.text, href: n.href ?? null, kind: n.kind ?? "info" }; else delete c[id]; return c; });
  const addVersion = (photoId: string, v: PhotoViewVersionLite) => {
    setVersions((p) => ({ ...p, [photoId]: [...(p[photoId] ?? []), v] }));
    setRefused((p) => { const n = { ...p }; delete n[photoId]; return n; });
    setVersionIdx((p) => { const n = { ...p }; delete n[photoId]; return n; });
  };

  /** Where each view stands: its row state, current version and follows. */
  const viewInfo = useCallback((photo: PhotoView) => {
    const vs = versions[photo.id] ?? [];
    // A locked view stands at its locked version (shown by default; its state and checks are that version's).
    const lockedIdx = locked[photo.id] ? vs.findIndex((v) => v.render_id === locked[photo.id]) : -1;
    const idx = versionIdx[photo.id] ?? (lockedIdx >= 0 ? lockedIdx : vs.length - 1);
    const current = vs[idx] ?? null;
    const latest = (lockedIdx >= 0 ? vs[lockedIdx] : vs.at(-1)) ?? null;
    const anchor = anchors[photo.room_id] ?? null;
    const isLocked = !!locked[photo.id];
    const g = latest?.gate ?? null;
    const follows: FollowsState | null = followsStateOf({
      viewPhotoId: photo.id,
      anchor,
      renderAnchorId: latest?.anchor_render_id ?? null,
      followsPassed: g?.anchor && g.outcome === "passed" ? !!g.attempts.at(-1)?.style?.passed : null,
      changedSpec: g?.change ? specFieldsChanged(g.change.changed) : null,
    });
    // C5 #1: a locked view whose render was made under another design than the room's now.
    const drift = isLocked ? approvalDrift(latest?.gate?.design_key, designNow[photo.room_id]) : null;
    const state: PhotoRowState = busy[photo.id] === "render" || busy[photo.id] === "change"
      ? "rendering"
      : drift
        ? "changed"
        : anchor?.room_photo_id === photo.id
        ? "anchor"
        : isLocked
          ? "locked"
          : !latest
            ? photo.camera ? "not_yet" : "not_placed"
            : g?.outcome !== "passed"
              ? "failed"
              : follows === "stale" || (follows === "unchecked" && !!anchor && !latest.anchor_render_id)
                ? "stale"
                : "ready";
    return { versions: vs, idx, current, latest, anchor, isLocked, follows, state, drift };
  }, [versions, versionIdx, anchors, locked, busy, designNow]);

  async function render(photo: PhotoView): Promise<boolean> {
    if (busy[photo.id]) return false;
    setBusyFor(photo.id, "render");
    say(photo.id, null);
    try {
      const { ok, status, json } = await postJson<{ render_id: string; image_url: string | null; gate: PhotoViewGate; spend?: { render_spend_aed: number } }>("/api/render/photo-view", { room_photo_id: photo.id });
      if (!ok || !json?.gate) throw new Error(json?.error ?? `The view did not render (${status}).`);
      addVersion(photo.id, { render_id: json.render_id, image_url: json.image_url, gate: json.gate, created_at: new Date().toISOString(), parent_render_id: null, anchor_render_id: json.gate.anchor?.render_id ?? null });
      if (json.spend) setSpend(json.spend.render_spend_aed);
      return true;
    } catch (e) {
      say(photo.id, { text: e instanceof Error ? e.message : "The view did not render.", kind: "error" });
      return false;
    } finally {
      setBusyFor(photo.id, null);
    }
  }

  async function lock(photo: PhotoView, renderId: string) {
    if (busy[photo.id]) return;
    setBusyFor(photo.id, "lock");
    say(photo.id, null);
    try {
      const { ok, status, json } = await postJson<{ locked_render_id: string; anchor: RoomAnchor; anchored_now: boolean; spend?: { render_spend_aed: number } }>("/api/render/photo-view/lock", { render_id: renderId });
      if (!ok || !json?.anchor) throw new Error(json?.error ?? `Not locked (${status}).`);
      setLocked((p) => ({ ...p, [photo.id]: json.locked_render_id }));
      setAnchors((p) => ({ ...p, [photo.room_id]: json.anchor }));
      if (json.spend) setSpend(json.spend.render_spend_aed);
      say(photo.id, { text: json.anchored_now ? `${photo.label.split(" · ")[0]} is locked and anchors the room — the other views follow its finishes when rendered again.` : `${photo.label.split(" · ")[0]} is locked.` });
    } catch (e) {
      say(photo.id, { text: e instanceof Error ? e.message : "Not locked.", kind: "error" });
    } finally {
      setBusyFor(photo.id, null);
    }
  }

  async function change(photo: PhotoView, renderId: string, request: string): Promise<boolean> {
    if (busy[photo.id]) return false;
    setBusyFor(photo.id, "change");
    say(photo.id, null);
    try {
      const { ok, status, json } = await postJson<{ kind: "version" | "unchanged" | "moved"; render_id: string; image_url?: string; gate?: PhotoViewGate; change?: PhotoViewChange; anchor?: RoomAnchor | null; message?: string; refused?: RefusedChange; spend?: { render_spend_aed: number } }>("/api/render/photo-view/change", { render_id: renderId, request });
      if (json?.spend) setSpend(json.spend.render_spend_aed);
      if (status === 422 && json?.code === "structural_change") {
        say(photo.id, { text: json.error ?? "Walls and windows come from your plan — adjust them there", href: json.plan_href ?? null });
        return false;
      }
      if (!ok || !json) throw new Error(json?.error ?? `The change did not render (${status}).`);
      if (json.kind !== "version") {
        if (json.kind === "moved" && json.refused) setRefused((p) => ({ ...p, [photo.id]: json.refused! }));
        say(photo.id, { text: json.message ?? "That change didn't come through." });
        return false;
      }
      const parentAnchor = (versions[photo.id] ?? []).find((v) => v.render_id === renderId)?.anchor_render_id ?? null;
      addVersion(photo.id, { render_id: json.render_id, image_url: json.image_url ?? null, gate: json.gate!, created_at: new Date().toISOString(), parent_render_id: renderId, anchor_render_id: parentAnchor });
      if (locked[photo.id] === renderId) setLocked((p) => ({ ...p, [photo.id]: json.render_id }));
      if (json.anchor) {
        setAnchors((p) => ({ ...p, [photo.room_id]: json.anchor! }));
        say(photo.id, { text: "The anchor changed — the room's other views no longer follow it until they are rendered again." });
      }
      return true;
    } catch (e) {
      say(photo.id, { text: e instanceof Error ? e.message : "The change did not render.", kind: "error" });
      return false;
    } finally {
      setBusyFor(photo.id, null);
    }
  }

  async function place(photo: PhotoView, camera: { position: Pt; toward: Pt } | { position: Pt; heading_deg: number } | null) {
    setBusyFor(photo.id, "place");
    say(photo.id, null);
    try {
      const { ok, status, json } = await postJson<{ views?: PhotoView[] }>("/api/room-photos", { id: photo.id, camera });
      if (!ok || !json?.views) throw new Error(json?.error ?? `Not saved (${status}).`);
      setByRoom((p) => ({ ...p, [photo.room_id]: json.views! }));
    } catch (e) {
      say(photo.id, { text: e instanceof Error ? e.message : "Not saved.", kind: "error" });
    } finally {
      setBusyFor(photo.id, null);
    }
  }

  async function addPhotos(roomId: string, files: FileList | null): Promise<PhotoView | null> {
    if (!files || files.length === 0 || uploading) return null;
    setUploading(roomId);
    say(roomId, null);
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
      const res = await fetch(`/api/room-photos?room_id=${roomId}`);
      const body = (await res.json().catch(() => null)) as { views?: PhotoView[] } | null;
      if (body?.views) setByRoom((p) => ({ ...p, [roomId]: body.views! }));
      return body?.views?.at(-1) ?? null;
    } catch (e) {
      say(roomId, { text: e instanceof Error ? e.message : "The upload didn't work.", kind: "error" });
      return null;
    } finally {
      setUploading(null);
    }
  }

  async function readRefs() {
    if (readingRefs) return;
    setReadingRefs(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/reference-style`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { reference_style?: { text: string; at: string }; error?: string } | null;
      if (!res.ok || !body?.reference_style) throw new Error(body?.error ?? `Not read (${res.status}).`);
      setRefStyle(body.reference_style);
    } catch (e) {
      say("refs", { text: e instanceof Error ? e.message : "The references could not be read.", kind: "error" });
    } finally {
      setReadingRefs(false);
    }
  }

  /** The cost guard's default scope: positioned, unlocked views not rendered under the room's current anchor. */
  const remaining = useMemo(() => {
    const out: PhotoView[] = [];
    for (const [roomId, vs] of Object.entries(byRoom)) {
      const ids = viewsToRender(
        vs.map((v) => ({ id: v.id, positioned: !!v.camera, locked: !!locked[v.id], latestAnchorId: (versions[v.id] ?? []).length ? (versions[v.id]!.at(-1)!.anchor_render_id ?? null) : undefined })),
        anchors[roomId] ?? null,
      );
      out.push(...vs.filter((v) => ids.includes(v.id)));
    }
    return out;
  }, [byRoom, locked, versions, anchors]);

  /** Render the remaining views, two at a time (each is up to two renders and its checks). */
  async function renderRemaining(): Promise<void> {
    if (running) return;
    setRunning(true);
    try {
      const queue = [...remaining];
      const worker = async () => {
        for (let v = queue.shift(); v; v = queue.shift()) await render(v);
      };
      await Promise.all([worker(), worker()]);
    } finally {
      setRunning(false);
    }
  }

  return { byRoom, plans, materials, versions, locked, anchors, refused, spend, refStyle, readingRefs, busy, uploading, notice, running, remaining, costPerView: initial?.costPerView ?? null, roomOf, viewInfo, setVersionIdx, render, lock, change, place, addPhotos, readRefs, renderRemaining, say };
}

export type PhotoViewsApi = ReturnType<typeof usePhotoViews>;

const shortLabel = (v: PhotoView) => v.label.split(" · ")[0]!;

function designHead(info: ReturnType<PhotoViewsApi["viewInfo"]>): string {
  const g = info.current?.gate;
  if (!g) return "DESIGN CHECK · NOT RENDERED";
  if (g.outcome !== "passed") return "DESIGN CHECK · LAYOUT NOT KEPT";
  const anchor = info.anchor?.label.toUpperCase();
  if (!anchor) return "MATCHES YOUR PHOTO";
  if (info.follows === "anchor") return "MATCHES YOUR PHOTO · ANCHORS THIS ROOM";
  if (info.follows === "follows") return `MATCHES YOUR PHOTO · SAME DESIGN AS ${anchor}`;
  if (info.follows === "differs") return `MATCHES YOUR PHOTO · DIFFERS FROM ${anchor}`;
  return `MATCHES YOUR PHOTO · ${anchor} HAS CHANGED SINCE`;
}

/** The design check lines of one view (the centre block and the side list share them). */
export function checkLines(info: ReturnType<PhotoViewsApi["viewInfo"]>): { text: string; ok: boolean }[] {
  const g = info.current?.gate;
  if (!g) return [];
  const lines = [{ text: g.line, ok: g.outcome === "passed" }];
  if (info.anchor && info.follows) {
    const off = info.follows === "differs" ? (g.attempts.at(-1)?.style?.elements ?? []).filter((e) => e.verdict !== "yes").map((e) => e.element) : info.follows === "changed" ? (g.change?.changed ?? []) : [];
    lines.push({ text: followsLine(info.follows, info.anchor.label, off), ok: info.follows === "follows" || info.follows === "anchor" });
  } else if (g.outcome === "passed") lines.push({ text: g.style_line, ok: g.style_line.endsWith("✓") });
  return lines;
}

function Boxes({ boxes }: { boxes: { ref: string; box: Box; bad: boolean }[] }) {
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
      {boxes.map((b) => (
        <rect key={b.ref} x={b.box[0]} y={b.box[1]} width={b.box[2] - b.box[0]} height={b.box[3] - b.box[1]} fill="none" stroke={b.bad ? "var(--color-alert-surface)" : "var(--color-ink-on-inverse)"} strokeWidth={b.bad ? 0.9 : 0.5} strokeDasharray={b.bad ? undefined : "1.5 1"} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

/**
 * B7 6: a change the check refused, beside the version that was kept — the
 * refused image with what the check read on it (the boxes it failed are solid),
 * and why, in its own words.
 */
function RefusedBeside({ refusal, kept }: { refusal: RefusedChange; kept: { url: string; version: number } }) {
  const bad = new Set(refusal.failures.map((x) => x.ref));
  const boxes = refusal.after.filter((l) => l.present && l.box).map((l) => ({ ref: l.ref, box: l.box as Box, bad: bad.has(l.ref) }));
  return (
    <section className="mt-4 border border-bp-line-hairline bg-bp-surface-raised p-3" aria-label="The last change that was not kept" data-refused-change={refusal.render_id}>
      <p className="t-label-caps text-bp-ink-tertiary">LAST CHANGE NOT KEPT</p>
      <p className="t-body-sm mt-1 text-bp-ink-primary">“{refusal.request}”</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <figure className="min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element -- the kept restyle */}
          <img src={kept.url} alt={`Kept — version ${kept.version}`} className="block w-full" />
          <figcaption className="t-label-md mt-1 font-bp-mono text-bp-ink-secondary">Kept · version {kept.version}</figcaption>
        </figure>
        <figure className="min-w-0">
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- the refused edit, as the check read it */}
            <img src={refusal.image_url} alt="Refused — the edit the layout check did not keep" className="block w-full" data-refused-image="" />
            <Boxes boxes={boxes} />
          </div>
          <figcaption className="t-label-md mt-1 font-bp-mono text-bp-ink-secondary">Refused · what the check read</figcaption>
        </figure>
      </div>
      <ul className="mt-3 space-y-1" aria-label="Why it was not kept">
        {refusal.failures.map((x, i) => (
          <li key={`${x.ref}-${i}`} className="t-body-sm text-bp-ink-primary">
            {x.message.replace(/^the render /, "The edit ").replace(/^./, (c) => c.toUpperCase())}.
          </li>
        ))}
      </ul>
    </section>
  );
}

// --- centre ------------------------------------------------------------------------------------

export function PhotoViewCentre({ api, roomName, photo, onSelect }: { api: PhotoViewsApi; roomName: string; photo: PhotoView; onSelect: (photoId: string) => void }) {
  const ids = useId();
  const file = useRef<HTMLInputElement>(null);
  const [ask, setAsk] = useState("");
  const [show, setShow] = useState<"render" | "photo">("render");
  const [diff, setDiff] = useState(false);
  const views = api.byRoom[photo.room_id] ?? [];
  const info = api.viewInfo(photo);
  const g = info.current?.gate ?? null;
  const busy = api.busy[photo.id] ?? null;
  const n = api.notice[photo.id] ?? api.notice[photo.room_id] ?? null;
  const lastChange = [...info.versions.slice(0, info.idx + 1)].reverse().find((v) => v.gate.change)?.gate.change ?? null;
  const failed = !!g && g.outcome !== "passed";
  const last = g?.attempts.at(-1) ?? null;
  const bad = new Set((last?.failures ?? []).map((f) => f.ref));
  const checked = new Set(g?.checked ?? []);
  const beforeBoxes = (g?.before ?? []).filter((l) => l.present && l.box && (checked.has(l.ref) || bad.has(l.ref))).map((l) => ({ ref: l.ref, box: l.box as Box, bad: bad.has(l.ref) }));
  const afterBoxes = (last?.after ?? []).filter((l) => l.present && l.box && (checked.has(l.ref) || bad.has(l.ref))).map((l) => ({ ref: l.ref, box: l.box as Box, bad: bad.has(l.ref) }));
  const showPhoto = show === "photo" || !info.current?.image_url;
  const lockedHere = info.isLocked && api.locked[photo.id] === info.current?.render_id;
  const lines = checkLines(info);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const req = ask.trim();
    if (!req || !info.current || busy) return;
    setAsk("");
    const ok = await api.change(photo, info.current.render_id, req);
    if (!ok) setAsk(req);
  }

  const lockReason = lockedHere ? "Locked — this view is in your design" : !info.current ? "Render this view first" : g?.outcome !== "passed" ? "Only a version that keeps your photo's layout can be locked" : busy ? "Wait for the render to finish" : null;
  const againReason = info.isLocked ? "Locked — ask for a change to it instead" : busy ? "Rendering now" : null;

  return (
    <div data-photo-view-render={photo.id} data-outcome={g?.outcome ?? "none"} data-follows={info.follows ?? "none"}>
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="t-label-caps text-bp-ink-tertiary" data-view-eyebrow="">
            {roomName.toUpperCase()} · {shortLabel(photo).toUpperCase()} OF {views.length} · FROM YOUR PHOTO
            {info.versions.length ? ` · VERSION ${info.idx + 1}` : ""}
          </p>
          <h1 className="t-heading-lg mt-1 text-bp-ink-primary">{roomName}</h1>
        </div>
        {info.current?.image_url ? (
          <div className="flex items-center gap-1 pt-1">
            <a href={info.current.image_url} target="_blank" rel="noreferrer" aria-label="Open full size" className={`flex h-9 w-9 items-center justify-center text-bp-ink-secondary hover:text-bp-ink-primary ${FOCUS}`}>
              <Icon name="zoom_in" className="text-[20px]" />
            </a>
            <a href={info.current.image_url} download aria-label="Download the render" className={`flex h-9 w-9 items-center justify-center text-bp-ink-secondary hover:text-bp-ink-primary ${FOCUS}`}>
              <Icon name="download" className="text-[20px]" />
            </a>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-col items-center border border-bp-line-hairline bg-bp-surface-sunken" aria-busy={busy === "render" || busy === "change" || undefined}>
        <div className="relative w-full max-w-[360px]">
          {/* eslint-disable-next-line @next/next/no-img-element -- the client's photo or its restyle */}
          <img key={showPhoto ? photo.url : info.current!.image_url!} src={showPhoto ? photo.url : info.current!.image_url!} alt={showPhoto ? `${photo.label} — ${roomName} as it is` : `${shortLabel(photo)} restyled — ${failed ? "did not keep the photo's layout" : "layout follows the photo"}`} className={`block w-full ${busy === "render" || busy === "change" ? "opacity-40" : ""}`} data-view-image={showPhoto ? "photo" : "render"} />
          {diff && g ? <Boxes boxes={showPhoto ? beforeBoxes : afterBoxes} /> : null}
          {busy === "render" || busy === "change" ? (
            <p className="t-label-md absolute inset-x-0 bottom-0 bg-bp-surface-raised px-3 py-1.5 font-bp-mono text-bp-ink-secondary">{busy === "change" ? "Making the change and checking the layout…" : "Restyling and checking every fixture — about a minute per attempt"}</p>
          ) : null}
        </div>
      </div>
      {api.refused[photo.id] && info.latest?.image_url ? (
        <RefusedBeside refusal={api.refused[photo.id]!} kept={{ url: info.latest.image_url, version: info.versions.length }} />
      ) : null}
      {info.current?.image_url ? (
        <div className="mt-2 flex items-center gap-1" role="group" aria-label="Show">
          {(["render", "photo"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)} className={`t-label-md min-h-9 border px-3 ${FOCUS} ${show === k ? "border-bp-ink-primary text-bp-ink-primary" : "border-bp-line-hairline text-bp-ink-secondary hover:text-bp-ink-primary"}`}>
              {k === "render" ? "Restyled" : "Your photo"}
            </button>
          ))}
        </div>
      ) : null}

      {/* Views strip: every view of the room, Add photos, Add a view. */}
      <ul className="mt-4 flex flex-wrap gap-3" aria-label={`Views of ${roomName}`} data-views-strip="">
        {views.map((v) => {
          const vi = api.viewInfo(v);
          const img = vi.latest?.image_url ?? v.url;
          const on = v.id === photo.id;
          return (
            <li key={v.id}>
              <button type="button" onClick={() => onSelect(v.id)} aria-pressed={on} aria-label={`${v.label} — ${PHOTO_STATE[vi.state].label.toLowerCase()}`} className={`block w-[72px] text-left ${FOCUS}`} data-photo-view={v.id} data-placed={v.camera ? "true" : "false"}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a view's thumbnail */}
                <img src={img} alt="" className={`h-[96px] w-[72px] object-cover ${on ? "outline outline-2 outline-offset-0 outline-bp-ink-primary" : "border border-bp-line-hairline"}`} />
                <span className="t-label-md mt-1 block font-bp-mono text-bp-ink-secondary">P{v.n}{vi.isLocked ? " · locked" : ""}</span>
              </button>
            </li>
          );
        })}
        <li>
          <button type="button" onClick={() => file.current?.click()} disabled={!!api.uploading} className={`flex h-[96px] w-[96px] flex-col items-center justify-center gap-1 border border-dashed border-bp-line-control text-bp-ink-secondary hover:text-bp-ink-primary disabled:text-bp-ink-tertiary ${FOCUS}`} data-add-photos="">
            <Icon name="add_photo_alternate" size={20} />
            <span className="t-label-md font-bp-mono">{api.uploading ? "Uploading…" : "Add photos"}</span>
          </button>
          <input ref={file} type="file" accept="image/jpeg,image/png,image/heic,image/heif" multiple className="sr-only" aria-label={`Add photos of ${roomName}`} onChange={async (e) => { const v = await api.addPhotos(photo.room_id, e.target.files); if (v) onSelect(v.id); if (file.current) file.current.value = ""; }} />
        </li>
        <li>
          <span aria-disabled="true" aria-describedby={`${ids}-addview`} className="flex h-[96px] w-[96px] cursor-not-allowed flex-col items-center justify-center gap-1 border border-dashed border-bp-line-hairline text-bp-ink-tertiary" data-add-view="">
            <Icon name="camera" size={20} />
            <span className="t-label-md font-bp-mono">Add a view</span>
          </span>
        </li>
      </ul>
      <p id={`${ids}-addview`} className="t-label-md mt-1 text-bp-ink-tertiary">A view from where you have no photo needs the room in 3D — not in this pilot. Add a photo from there instead.</p>

      {info.drift ? (
        <div role="status" className="surface-inverse mt-4 bg-bp-alert-surface px-4 py-3 text-bp-alert-ink" data-view-changed-since-approval="">
          <p className="t-label-caps">CHANGED SINCE RENDER APPROVAL</p>
          <p className="t-body-sm mt-1">This view was approved before {info.drift}. It no longer shows the design the BoQ prices, so the client pack leaves it out until a version showing today&rsquo;s design is locked.</p>
        </div>
      ) : null}

      {/* Design checks */}
      {g ? (
        failed ? (
          <div role="status" className="surface-inverse mt-4 bg-bp-alert-surface px-4 py-3 text-bp-alert-ink" data-design-check="failed">
            <p className="t-label-caps">{designHead(info)}</p>
            <p className="t-body-sm mt-1" data-check-line="layout">
              {g.line} <span title={FITTINGS_NOTE_FULL}>· {FITTINGS_NOTE}</span>
            </p>
            <button type="button" onClick={() => setDiff((v) => !v)} aria-pressed={diff} className={`t-nav-item-active mt-2 underline underline-offset-2 ${FOCUS}`}>
              {diff ? "Hide what differs" : "See what differs"}
            </button>
            {diff ? (
              <ul className="t-body-sm mt-2 list-disc pl-5">
                {(last?.failures ?? []).map((f) => (
                  <li key={`${f.ref}${f.reason}`}>{f.message.replace(/^./, (c) => c.toUpperCase())}.</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <div className="mt-4 flex items-start gap-3 bg-bp-surface-sunken px-4 py-3" data-design-check="passed">
            <Icon name="task_alt" className="text-[20px] text-bp-ink-primary" />
            <div>
              <p className="t-label-caps text-bp-ink-primary">{designHead(info)}</p>
              <ul className="mt-1 space-y-0.5">
                {lines.map((l, i) => (
                  <li key={i} className={`t-body-sm ${l.ok ? "text-bp-ink-primary" : "text-bp-ink-secondary"}`} data-check-line={i === 0 ? "layout" : info.anchor ? "follows" : "style"}>
                    {l.ok ? "✓ " : "· "}
                    {l.text.replace(/ ✓$/, "")}
                    {i === 0 ? <span className="text-bp-ink-secondary" title={FITTINGS_NOTE_FULL}> · {FITTINGS_NOTE}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )
      ) : (
        <div className="mt-4 bg-bp-surface-sunken px-4 py-3" data-design-check="none">
          <p className="t-body-sm text-bp-ink-secondary">{photo.camera ? `Not rendered yet. ${info.anchor && info.anchor.room_photo_id !== photo.id ? `It will follow ${info.anchor.label}'s finishes.` : "Restyled from your photo, so it keeps your real layout."}` : "Place this photo on the plan first — where you stood, and which way the phone faced."}</p>
        </div>
      )}

      {n ? (
        <p role="status" className={`t-body-sm mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 ${n.kind === "error" ? "surface-inverse bg-bp-alert-surface text-bp-alert-ink" : "border-l-2 border-bp-brass bg-bp-surface-raised text-bp-ink-primary"}`} data-render-notice="">
          <span>{n.text}</span>
          {n.href ? (
            <a href={n.href} className="t-nav-item-active underline underline-offset-2" data-render-notice-link="">
              Open the plan&rsquo;s openings
            </a>
          ) : null}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
        <Button kind="secondary" onClick={() => info.current && void api.lock(photo, info.current.render_id)} disabled={lockReason ? { reason: lockReason, reasonId: `${ids}-lock`, showReason: true } : false} testId="lock-photo-view">
          {lockedHere ? (info.anchor?.room_photo_id === photo.id ? "Locked · anchors the room" : "View locked") : busy === "lock" ? "Locking…" : "Lock this view"}
        </Button>
        <Button kind="quiet" onClick={() => void api.render(photo)} disabled={againReason ? { reason: againReason, reasonId: `${ids}-again`, showReason: !!info.isLocked } : false} testId="render-photo-view">
          {info.versions.length ? "Render again" : "Render this view"}
        </Button>
        {info.versions.length > 1 ? (
          <div className="ml-auto flex items-center gap-2">
            <span className="t-label-caps text-bp-ink-tertiary">VERSIONS</span>
            <ul className="flex gap-2">
              {info.versions.map((v, i) => (
                <li key={v.render_id}>
                  <button type="button" aria-pressed={i === info.idx} aria-label={`Version ${i + 1}${api.locked[photo.id] === v.render_id ? ", locked" : ""}`} title={v.gate.change?.request ?? (i === 0 ? "First render" : "Rendered again")} onClick={() => api.setVersionIdx((p) => ({ ...p, [photo.id]: i }))} className={`block ${FOCUS} ${i === info.idx ? "outline outline-2 outline-offset-0 outline-bp-ink-primary" : ""}`} data-version={i + 1}>
                    {v.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a stored version
                      <img src={v.image_url} alt="" className="h-12 w-9 border border-bp-line-hairline object-cover" />
                    ) : (
                      <span className="flex h-12 w-9 items-center justify-center border border-bp-line-hairline t-label-md">{i + 1}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {info.current?.image_url && g?.outcome === "passed" ? (
        <>
          <form onSubmit={submit} className="mt-4 flex min-h-12 items-center gap-3 border border-bp-line-control px-3 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-bp-focus-ring" data-ask-change="">
            <Icon name="edit" className="text-[20px] text-bp-ink-secondary" />
            <label className="min-w-0 flex-1">
              <span className="sr-only">Ask for a change to this view</span>
              <input value={ask} onChange={(e) => setAsk(e.target.value)} disabled={!!busy} placeholder="Ask for a change — “lighter oak vanity”, “remove the towel”" className="t-body-sm h-11 w-full bg-transparent text-bp-ink-primary outline-none placeholder:text-bp-ink-tertiary" />
            </label>
            <button type="submit" aria-label="Send the change" disabled={!!busy || !ask.trim()} className={`flex h-9 w-9 items-center justify-center text-bp-ink-primary disabled:text-bp-ink-tertiary ${FOCUS}`}>
              <Icon name="arrow_upward" className="text-[20px]" />
            </button>
          </form>
          {lastChange ? (
            <p className="t-label-md mt-2 flex items-center gap-2 font-bp-mono text-bp-ink-secondary" data-last-change="">
              <Icon name="history" size={18} />
              {lastChange.line}
            </p>
          ) : null}
        </>
      ) : null}

      {g ? (
        <p className="t-label-md mt-3 font-bp-mono tabular-nums text-bp-ink-tertiary" data-scores="">
          {last?.ssim != null ? `vs your photo: SSIM ${last.ssim.toFixed(3)} · ${last.changed_pct?.toFixed(1)}% of pixels changed · ` : ""}
          {g.attempts.length} {g.attempts.length === 1 ? "attempt" : "attempts"} · this view {AED(g.cost_usd * 3.6725)}
        </p>
      ) : null}
    </div>
  );
}

// --- right column --------------------------------------------------------------------------------

const VB_W = 260;
const PAD = 22;
const FOV_DRAW_DEG = 80;

export function PhotoViewSide({ api, roomName, photo, onSelect }: { api: PhotoViewsApi; roomName: string; photo: PhotoView; onSelect: (photoId: string) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ from: Pt; to: Pt } | null>(null);
  const plan = api.plans[photo.room_id] ?? null;
  const views = api.byRoom[photo.room_id] ?? [];
  const mPerU = plan?.m_per_u ?? null;
  const refNotice = api.notice.refs ?? null;

  const fit = useMemo(() => {
    const poly = plan?.polygon ?? [];
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    const minX = Math.min(...xs, 0), minY = Math.min(...ys, 0), maxX = Math.max(...xs, 1e-6), maxY = Math.max(...ys, 1e-6);
    const s = (VB_W - 2 * PAD) / Math.max(maxX - minX, maxY - minY);
    const h = (maxY - minY) * s + 2 * PAD;
    return { s, h, to: (p: Pt): Pt => [PAD + (p[0] - minX) * s, PAD + (p[1] - minY) * s], from: (v: Pt): Pt => [(v[0] - PAD) / s + minX, (v[1] - PAD) / s + minY] };
  }, [plan]);

  const edgeMarks = useMemo(() => {
    const poly = plan?.polygon ?? [];
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
  }, [plan, mPerU]);

  const toPlan = (e: ReactPointerEvent<SVGSVGElement>): Pt => {
    const r = svg.current!.getBoundingClientRect();
    return fit.from([((e.clientX - r.left) / r.width) * VB_W, ((e.clientY - r.top) / r.height) * fit.h]);
  };
  const arrow = (c: PhotoCamera, len = 26) => {
    const [x, y] = fit.to(c.position);
    const th = (c.heading_deg * Math.PI) / 180;
    return { x, y, tx: x + Math.sin(th) * len, ty: y - Math.cos(th) * len };
  };
  const wedge = (c: PhotoCamera, r = 40) => {
    const [x, y] = fit.to(c.position);
    const pts = [-FOV_DRAW_DEG / 2, FOV_DRAW_DEG / 2].map((d) => {
      const th = ((c.heading_deg + d) * Math.PI) / 180;
      return `${(x + Math.sin(th) * r).toFixed(1)},${(y - Math.cos(th) * r).toFixed(1)}`;
    });
    return `${x.toFixed(1)},${y.toFixed(1)} ${pts.join(" ")}`;
  };
  const live: PhotoCamera | null = drag ? { position: drag.from, heading_deg: headingBetween(drag.from, drag.to) } : null;
  const placing = api.busy[photo.id] === "place";

  return (
    <div className="space-y-8">
      <section aria-labelledby="vop-h">
        <h2 id="vop-h" className="t-label-caps text-bp-ink-tertiary">VIEWS ON THE PLAN</h2>
        {plan && plan.polygon.length >= 3 ? (
          <svg
            ref={svg}
            viewBox={`0 0 ${VB_W} ${fit.h.toFixed(1)}`}
            className="mt-2 block w-full touch-none select-none border border-bp-line-hairline bg-bp-surface-sunken"
            role="img"
            aria-label={`${roomName} plan with its views placed on it`}
            data-photo-plan=""
            onPointerDown={(e) => {
              if (placing) return;
              const p = toPlan(e);
              (e.currentTarget as Element).setPointerCapture(e.pointerId);
              setDrag({ from: p, to: p });
            }}
            onPointerMove={(e) => drag && setDrag({ from: drag.from, to: toPlan(e) })}
            onPointerUp={(e) => {
              if (!drag) return;
              const to = toPlan(e);
              const a = fit.to(drag.from), b = fit.to(to);
              const moved = Math.hypot(b[0] - a[0], b[1] - a[1]) > 8;
              setDrag(null);
              if (moved) void api.place(photo, { position: drag.from, toward: to });
              else if (photo.camera) void api.place(photo, { position: drag.from, heading_deg: photo.camera.heading_deg });
              else api.say(photo.id, { text: "Drag from where the photo was taken toward what it looks at.", kind: "info" });
            }}
          >
            <polygon points={plan.polygon.map((p) => fit.to(p).map((v) => v.toFixed(1)).join(",")).join(" ")} fill="var(--color-surface-base)" stroke="var(--color-ink-primary)" strokeWidth={2} />
            {mPerU
              ? plan.fixtures.map((f) => {
                  const fp = footprintOf(f.type, f.spec);
                  if (!fp) {
                    const [x, y] = fit.to(f.position);
                    return <circle key={f.id} cx={x} cy={y} r={2.5} fill="var(--color-ink-tertiary)" />;
                  }
                  return <polygon key={f.id} points={footprintCorners(f.position, fp, mPerU).map((p) => fit.to(p).map((v) => v.toFixed(1)).join(",")).join(" ")} fill="var(--color-surface-raised)" stroke="var(--color-ink-tertiary)" strokeWidth={1} />;
                })
              : null}
            {edgeMarks.map((o) => {
              const a = fit.to(o.a), b = fit.to(o.b);
              return <line key={o.id} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="var(--color-ink-primary)" strokeWidth={o.kind === "window" ? 3 : 6} strokeDasharray={o.kind === "window" ? "3 2" : undefined} />;
            })}
            {views.map((v) => {
              const c = v.id === photo.id && live ? live : v.camera;
              if (!c) return null;
              const a = arrow(c);
              const sel = v.id === photo.id;
              return (
                <g key={v.id} data-photo-marker={`P${v.n}`} pointerEvents="none">
                  {sel ? <polygon points={wedge(c)} fill="var(--color-ink-primary)" fillOpacity={0.07} stroke="none" /> : null}
                  <line x1={a.x} y1={a.y} x2={a.tx} y2={a.ty} stroke={sel ? "var(--color-active-brass)" : "var(--color-ink-secondary)"} strokeWidth={sel ? 2.5 : 1.5} />
                  <rect x={a.x - 11} y={a.y - 8} width={22} height={16} fill={sel ? "var(--color-ink-primary)" : "var(--color-surface-raised)"} stroke="var(--color-ink-primary)" strokeWidth={1} />
                  <text x={a.x} y={a.y + 3.5} textAnchor="middle" fontSize={9} fontWeight={600} fill={sel ? "var(--color-ink-on-inverse)" : "var(--color-ink-primary)"} style={{ fontFamily: "var(--font-mono)" }}>
                    P{v.n}
                  </text>
                </g>
              );
            })}
          </svg>
        ) : (
          <p className="t-body-sm mt-2 text-bp-ink-secondary">This room has no outline on the plan yet — draw it on 01 Plan to place photos.</p>
        )}
        <p className="t-label-md mt-2 font-bp-mono text-bp-ink-tertiary">
          {photo.camera ? `P${photo.n} · ${Math.round(photo.camera.heading_deg)}° ${compassWord(photo.camera.heading_deg)} — press where it was taken, drag toward what it shows` : `Place ${shortLabel(photo)}: press where it was taken, drag toward what it shows`}
        </p>
        <CameraFields key={`${photo.id}:${photo.camera?.heading_deg ?? "-"}:${photo.camera?.position.join(",") ?? "-"}`} view={photo} mPerU={mPerU} disabled={placing} onSave={(c) => void api.place(photo, c)} />
      </section>

      <section aria-labelledby="dc-h">
        <h2 id="dc-h" className="t-label-caps text-bp-ink-tertiary">DESIGN CHECKS</h2>
        <ul className="mt-2 border-t border-bp-line-hairline" data-design-checks="">
          {views.map((v) => {
            const vi = api.viewInfo(v);
            const ls = checkLines(vi);
            return (
              <li key={v.id} className="border-b border-bp-line-hairline">
                <button type="button" onClick={() => onSelect(v.id)} aria-current={v.id === photo.id ? "true" : undefined} className={`flex w-full items-start gap-3 px-1 py-2 text-left hover:bg-bp-surface-raised ${FOCUS}`} data-check-view={`P${v.n}`} data-view-state={vi.state}>
                  <span className="t-label-md w-7 shrink-0 font-bp-mono text-bp-ink-primary">P{v.n}</span>
                  <span className="min-w-0 flex-1">
                    {ls.length ? (
                      ls.map((l, i) => (
                        <span key={i} className={`t-body-sm block ${l.ok ? "text-bp-ink-primary" : "text-bp-ink-secondary"}`}>
                          {l.ok ? "✓ " : "· "}
                          {l.text.replace(/ ✓$/, "")}
                        </span>
                      ))
                    ) : (
                      <span className="t-body-sm block text-bp-ink-tertiary">{v.camera ? "Not rendered yet" : "Not placed on the plan"}</span>
                    )}
                  </span>
                  <Icon name={PHOTO_STATE[vi.state].icon} className="text-[18px] text-bp-ink-secondary" />
                </button>
              </li>
            );
          })}
        </ul>
        <p className="t-label-md mt-2 text-bp-ink-tertiary" title={FITTINGS_NOTE_FULL}>
          Layout is checked fixture by fixture against your photo; {FITTINGS_NOTE}.
        </p>
      </section>

      {api.materials[photo.room_id]?.length ? (
        <section aria-labelledby="mat-h" data-material-labels="">
          <h2 id="mat-h" className="t-label-caps text-bp-ink-tertiary">MATERIALS IN THIS DESIGN</h2>
          <ul className="mt-2 border-t border-bp-line-hairline">
            {api.materials[photo.room_id]!.map((m) => (
              <li key={m.field} className="border-b border-bp-line-hairline px-1 py-2" data-material={m.field} data-material-label={m.label} title={m.why}>
                <span className="flex items-baseline gap-3">
                  <span className="t-body-sm min-w-0 flex-1 text-bp-ink-primary">
                    <span className="capitalize">{m.element}</span>
                    <span className="text-bp-ink-secondary"> · {m.finish}</span>
                  </span>
                  <span className={`t-label-caps shrink-0 ${m.label === "changed" ? "text-bp-ink-primary underline decoration-bp-brass underline-offset-4" : "text-bp-ink-tertiary"}`}>{MATERIAL_LABEL_TEXT[m.label]}</span>
                </span>
                <span className="t-label-md block text-bp-ink-tertiary">{m.why}</span>
              </li>
            ))}
          </ul>
          <p className="t-label-md mt-2 text-bp-ink-tertiary">Read from the locked view&rsquo;s design, the room&rsquo;s product choices and the current BoQ.</p>
        </section>
      ) : null}

      <section aria-labelledby="rs-h">
        <h2 id="rs-h" className="t-label-caps text-bp-ink-tertiary">RENDER SPEND</h2>
        <p className="t-num-md mt-1 tabular-nums text-bp-ink-primary" data-render-spend={api.spend != null ? api.spend.toFixed(2) : ""}>
          {api.spend != null ? AED(api.spend) : "—"}
        </p>
        <p className="t-label-md text-bp-ink-tertiary">Every render and check this project has paid for.</p>
      </section>

      <section aria-labelledby="ref-h" data-reference-style={api.refStyle ? "set" : "none"}>
        <h2 id="ref-h" className="t-label-caps text-bp-ink-tertiary">STYLE FROM YOUR REFERENCES</h2>
        <p className="t-body-sm mt-1 text-bp-ink-primary">{api.refStyle ? api.refStyle.text : "Not read yet — add your reference photos on 02 Design, then read them here."}</p>
        <button type="button" onClick={() => void api.readRefs()} aria-disabled={api.readingRefs} className={`t-nav-item-active mt-1 text-bp-ink-primary underline underline-offset-2 ${FOCUS}`} data-read-references="">
          {api.readingRefs ? "Reading your references…" : api.refStyle ? "Read the references again" : "Read my references"}
        </button>
        {refNotice ? <p role="alert" className="surface-inverse t-body-sm mt-2 bg-bp-alert-surface px-3 py-2 text-bp-alert-ink">{refNotice.text}</p> : null}
        {api.anchors[photo.room_id] ? <p className="t-label-md mt-2 text-bp-ink-tertiary">Once a view is locked, the room&rsquo;s other views follow it rather than the references.</p> : null}
      </section>
    </div>
  );
}

/** The keyboard way to place a photo: where it was taken from (m from the plan's top-left) and its heading. */
function CameraFields({ view, mPerU, disabled, onSave }: { view: PhotoView; mPerU: number | null; disabled: boolean; onSave: (c: { position: Pt; heading_deg: number } | null) => void }) {
  const k = mPerU ?? 1;
  const [x, setX] = useState(view.camera ? (view.camera.position[0] * k).toFixed(2) : "");
  const [y, setY] = useState(view.camera ? (view.camera.position[1] * k).toFixed(2) : "");
  const [h, setH] = useState(view.camera ? String(Math.round(view.camera.heading_deg)) : "");
  const ok = [x, y, h].every((v) => v.trim() !== "" && Number.isFinite(Number(v)));
  const field = "h-9 w-[64px] rounded-none border border-bp-line-control bg-bp-surface-raised px-2 text-right t-num-sm text-bp-ink-primary";
  return (
    <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (ok) onSave({ position: [Number(x) / k, Number(y) / k], heading_deg: Number(h) }); }} data-camera-fields={view.id}>
      {(
        [
          ["X (m)", x, setX],
          ["Y (m)", y, setY],
          ["Heading °", h, setH],
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
    </form>
  );
}
