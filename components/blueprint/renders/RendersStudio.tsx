"use client";

// =============================================================================
// components/blueprint/renders/RendersStudio.tsx — 03 Renders (K8 #5, spec
// §6.4, Figma 57:612 · phone 66:1443). Replaces the Atelier "AI Studio".
//
// Left 288 — ALL VIEWS (n / m locked) + Secondary "Render remaining N" (the G4
// batch: day views, then evening views wherever lighting is on the plan), the
// room/view list with each view's status as icon + label/caps (LOCKED · READY
// · RENDERING · QUEUED · WAITING · NOT YET · N/A — never a colour), then ROOM
// PHOTO and DIRECTION (links 02). Centre — eyebrow (room · view · version),
// the render (object-fit cover, hairline), "This room in your cost" (≈ +
// derived mark, links 04), the DESIGN CHECK block from the stored QA verdict,
// Lock this view · Render again · version thumbnails, "Ask for a change".
// Right 300 — the material palette, Include furniture, Material details.
// Top bar — Secondary "3D view" · Primary "Continue to cost" (replaces the
// floating "Cost it").
//
// No model or vendor names, no fake knobs: the lighting slider and the detail
// density switch of the old studio changed nothing and are gone.
// Every call is the one the old studio made (/api/render, /api/render-iterate,
// /api/approve-design, /api/render/evening, the batch runner).
// =============================================================================

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { AnalyticsEvent, track } from "@/lib/analytics";
import type { AssetLite } from "@/lib/assets/types";
import { formatAED } from "@/lib/format/aed";
import { resolveRender, runBatch, type GenerateResponse } from "@/lib/render-batch/client";
import type { BatchJob, RenderView, SceneOutcome } from "@/lib/render-batch/plan";
import { roomTypeFromDb } from "@/lib/render-prompts";
import { getStagingSet, stagingRoomTypeFromDb } from "@/lib/staging/sets";
import type { Style } from "@/lib/styles";

import { Button } from "../Button";
import { Icon } from "../Icon";
import { ProvenanceMark } from "../ProvenanceMark";
import { StateBlock } from "../StateBlock";
import { TopBarActions } from "../shell/TopBar";
import { MaterialPalette } from "./MaterialPalette";
import { RoomPhoto } from "./RoomPhoto";

export type StudioRoom = { id: string; name_en: string | null; room_type: string | null };
export type StudioRender = { id: string; imageUrl: string; prompt: string; qa?: "passed" | "failed" | null; qaReason?: string | null; outcome?: SceneOutcome | null };

type RowState = "locked" | "ready" | "rendering" | "queued" | "waiting" | "not_yet" | "failed" | "na";
/** One view in the list. A garden zone can have several cameras, so a scene row is keyed by its camera. */
type Row = { id: string; roomId: string; cameraId: string | null; roomName: string; view: RenderView; state: RowState; note: string | null; outcome: SceneOutcome | null; renderId: string | null };

const STATE: Record<RowState, { icon: string; label: string }> = {
  locked: { icon: "check", label: "LOCKED" },
  ready: { icon: "visibility", label: "READY" },
  rendering: { icon: "progress_activity", label: "RENDERING" },
  queued: { icon: "schedule", label: "QUEUED" },
  waiting: { icon: "hourglass_empty", label: "WAITING" },
  not_yet: { icon: "radio_button_unchecked", label: "NOT YET" },
  failed: { icon: "error", label: "FAILED" },
  na: { icon: "remove", label: "N/A" },
};

/** The tweak count after which the studio suggests locking (unchanged from the old studio). */
export const MAX_TWEAKS = 4;

const rowIdOf = (roomId: string, cameraId: string | null | undefined, view: RenderView) => (cameraId ? `cam:${cameraId}:${view}` : `${roomId}:${view}`);
const viewLabel = (v: RenderView) => (v === "evening" ? "Evening" : "Day");

function buildRows(rooms: StudioRoom[], jobs: BatchJob[], locked: Set<string>): Row[] {
  const out: Row[] = [];
  for (const r of rooms) {
    const name = r.name_en?.trim() || "Room";
    const own = jobs.filter((j) => j.room_id === r.id);
    if (!roomTypeFromDb(r.room_type) || own.length === 0) {
      const base = { id: rowIdOf(r.id, null, "day"), roomId: r.id, cameraId: null, roomName: name, view: "day" as const, outcome: null, renderId: null };
      if (!roomTypeFromDb(r.room_type)) out.push({ ...base, state: "na", note: "Nothing to photograph in this room type" });
      else out.push({ ...base, state: locked.has(r.id) ? "locked" : "not_yet", note: null });
      continue;
    }
    for (const j of own) {
      const done = j.status === "done";
      const state: RowState = done ? (j.view === "day" && locked.has(r.id) ? "locked" : "ready") : j.status === "in_flight" ? "rendering" : j.status === "blocked" ? "waiting" : "not_yet";
      out.push({ id: rowIdOf(r.id, j.camera_id, j.view), roomId: r.id, cameraId: j.camera_id ?? null, roomName: j.room_name || name, view: j.view, state, note: j.reason, outcome: j.outcome ?? null, renderId: j.render_id });
    }
  }
  return out;
}

export function RendersStudio(props: {
  projectId: string;
  rooms: StudioRoom[];
  style: Style | null;
  initialChains: Record<string, StudioRender[]>;
  initialLockedRoomIds: string[];
  /** ?room= (the 3D view's "Render this room"): open on that room's first row. */
  initialRoomId?: string | null;
  initialPhotosByRoom: Record<string, string>;
  initialPhotoAssets: AssetLite[];
  roomCost: Record<string, number>;
  stagingEnabled: boolean;
  initialFurnitureOptIns: string[];
  batchJobs: BatchJob[];
  initialEvenings: Record<string, { id: string; imageUrl: string }>;
  /** Every finished render's image and check verdict, by id (scene and evening views show their own). */
  renderInfo: Record<string, StudioRender>;
  viewerHref: string | null;
  costHref: string;
}) {
  const { projectId, rooms, style } = props;
  const [locked, setLocked] = useState<Set<string>>(() => new Set(props.initialLockedRoomIds));
  const [rows, setRows] = useState<Row[]>(() => buildRows(rooms, props.batchJobs, new Set(props.initialLockedRoomIds)));
  const [chains, setChains] = useState<Record<string, { list: StudioRender[]; index: number }>>(() =>
    Object.fromEntries(Object.entries(props.initialChains).map(([k, list]) => [k, { list, index: list.length - 1 }])),
  );
  const [evenings, setEvenings] = useState(props.initialEvenings);
  const [info, setInfo] = useState(props.renderInfo);
  const [photos, setPhotos] = useState(props.initialPhotosByRoom);
  const [photoAssets, setPhotoAssets] = useState(props.initialPhotoAssets);
  const [upscaled, setUpscaled] = useState<Record<string, string>>({});
  const [keepGoing, setKeepGoing] = useState<Set<string>>(() => new Set());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [locking, setLocking] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState("");
  const [announce, setAnnounce] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const image = useRef<HTMLImageElement>(null);
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const firstRow = (props.initialRoomId ? rows.find((r) => r.roomId === props.initialRoomId) : undefined) ?? rows.find((r) => r.state !== "na" && rooms.find((x) => x.id === r.roomId)?.room_type === "master_bedroom") ?? rows.find((r) => r.state !== "na") ?? rows[0] ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(firstRow?.id ?? null);
  const row = selectedId ? (rows.find((r) => r.id === selectedId) ?? null) : null;
  const selected = row ? { roomId: row.roomId, view: row.view } : null;
  const room = row ? (rooms.find((r) => r.id === row.roomId) ?? null) : null;
  const roomName = room?.name_en?.trim() || "Room";
  const isEvening = selected?.view === "evening";
  const isScene = !!row?.cameraId;
  // The version chain belongs to a room's day view; a camera or an evening shows its own render.
  const chain = room && !isEvening && !isScene ? chains[room.id] : undefined;
  const current: StudioRender | null = chain
    ? (chain.list[chain.index] ?? null)
    : row?.renderId && info[row.renderId]
      ? info[row.renderId]!
      : isEvening && room && evenings[room.id] && !isScene
        ? { id: evenings[room.id]!.id, imageUrl: evenings[room.id]!.imageUrl, prompt: "", qa: null }
        : null;
  const renderable = !!room && roomTypeFromDb(room.room_type) !== null;
  const isLocked = !!room && locked.has(room.id);
  const busy = !!row && busyKey === row.id;
  const tweaks = chain ? chain.list.length - 1 : 0;
  const atCap = !!room && !isEvening && tweaks >= MAX_TWEAKS && !keepGoing.has(room.id);
  const lockedCount = rows.filter((r) => r.state === "locked").length;
  const views = rows.filter((r) => r.state !== "na");
  const outstanding = views.filter((r) => r.state !== "ready" && r.state !== "locked").length;
  const stagingAvailable = !!(props.stagingEnabled && style && room && isLocked && !isEvening && (() => {
    const t = stagingRoomTypeFromDb(room.room_type);
    return t != null && getStagingSet(style.key, t) != null;
  })());

  useEffect(() => {
    if (!busyKey) return;
    const start = Date.now();
    const t = setInterval(() => setElapsed(Date.now() - start), 500);
    return () => clearInterval(t);
  }, [busyKey]);

  const setRow = (id: string, patch: Partial<Row>) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  function landed(target: Row, result: GenerateResponse, mode: "new" | "tweak") {
    const { roomId, view } = target;
    const item: StudioRender = { id: result.render_id, imageUrl: result.image_url, prompt: result.prompt, qa: result.qa ?? null, qaReason: result.qaReason ?? null, outcome: result.outcome ?? null };
    setInfo((p) => ({ ...p, [item.id]: item }));
    if (target.cameraId) {
      /* a scene view shows its own render */
    } else if (view === "evening") setEvenings((p) => ({ ...p, [roomId]: { id: item.id, imageUrl: item.imageUrl } }));
    else
      setChains((p) => {
        if (mode === "tweak" && p[roomId]) {
          const cur = p[roomId]!;
          const list = [...cur.list.slice(0, cur.index + 1), item];
          return { ...p, [roomId]: { list, index: list.length - 1 } };
        }
        return p[roomId]?.list.some((x) => x.id === item.id) ? p : { ...p, [roomId]: { list: [item], index: 0 } };
      });
    setRow(target.id, { state: view === "day" && locked.has(roomId) ? "locked" : "ready", note: null, outcome: item.outcome ?? null, renderId: item.id });
  }

  async function post(url: string, body: Record<string, unknown>): Promise<GenerateResponse> {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId, ...body }) });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) throw new Error((json && typeof json.error === "string" && json.error) || "The render didn't finish. Please try again.");
    return resolveRender(json, res.status);
  }

  async function renderAgain() {
    if (!room || !row || busy || !renderable) return;
    const target = row;
    const k = target.id;
    setBusyKey(k);
    setError(null);
    setRow(k, { state: "rendering" });
    setAnnounce(`Rendering ${target.roomName}, ${viewLabel(target.view).toLowerCase()} view.`);
    try {
      const result = target.cameraId
        ? await post("/api/render/scene", { camera_id: target.cameraId, view: target.view })
        : await post(target.view === "evening" ? "/api/render/evening" : "/api/render", { room_id: room.id });
      landed(target, result, "new");
      setAnnounce(`${roomName} rendered.`);
      track(AnalyticsEvent.RenderGenerated, { project_id: projectId, room_id: room.id, render_id: result.render_id });
    } catch (e) {
      setRow(k, { state: "failed", note: e instanceof Error ? e.message : null });
      setError(e instanceof Error ? e.message : "The render didn't finish.");
    } finally {
      setBusyKey((c) => (c === k ? null : c));
    }
  }

  async function askForChange(e: React.FormEvent) {
    e.preventDefault();
    const tweak = ask.trim();
    if (!room || !row || !current || !tweak || busy || atCap || isEvening) return;
    const target = row;
    const k = target.id;
    setAsk("");
    setBusyKey(k);
    setError(null);
    setRow(k, { state: "rendering" });
    setAnnounce(`Changing ${roomName}: ${tweak}`);
    try {
      const result = await post("/api/render-iterate", { room_id: room.id, parent_render_id: current.id, tweak });
      landed(target, result, "tweak");
      setAnnounce(`${roomName} updated.`);
      track(AnalyticsEvent.RenderIterated, { project_id: projectId, room_id: room.id, render_id: result.render_id, parent_render_id: current.id });
    } catch (err) {
      setRow(k, { state: locked.has(room.id) ? "locked" : "ready" });
      setError(err instanceof Error ? err.message : "The change didn't render.");
    } finally {
      setBusyKey((c) => (c === k ? null : c));
    }
  }

  async function lock() {
    if (!room || !current || locking || isEvening) return;
    setLocking(true);
    setError(null);
    try {
      const res = await fetch("/api/approve-design", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId, room_id: room.id, render_id: current.id }) });
      const body = (await res.json().catch(() => null)) as { id?: string; upscaled_url?: string | null; error?: string } | null;
      if (!res.ok || !body?.id) throw new Error(body?.error ?? "The view wasn't locked. Please try again.");
      setLocked((p) => new Set(p).add(room.id));
      setRows((prev) => prev.map((r) => (r.roomId === room.id && r.view === "day" && r.state === "ready" ? { ...r, state: "locked" } : r)));
      if (body.upscaled_url) setUpscaled((p) => ({ ...p, [room.id]: body.upscaled_url! }));
      setAnnounce(`${roomName} locked.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The view wasn't locked.");
    } finally {
      setLocking(false);
    }
  }

  async function renderRemaining() {
    setBatchRunning(true);
    setError(null);
    try {
      await runBatch(
        projectId,
        (plan) => setRows((prev) => {
          const fresh = buildRows(rooms, plan.jobs, locked);
          // Keep a failure visible across the re-plan.
          return fresh.map((r) => (r.state === "not_yet" && prev.find((p) => p.id === r.id)?.state === "failed" ? prev.find((p) => p.id === r.id)! : r));
        }),
        (e) => {
          const id = rowIdOf(e.room_id, e.camera_id, e.view);
          const target = rowsRef.current.find((r) => r.id === id);
          if (e.state === "done" && e.result && target) landed(target, e.result, "new");
          else setRow(id, { state: e.state === "running" ? "rendering" : e.state === "failed" ? "failed" : e.state === "blocked" ? "waiting" : "queued", note: e.error ?? null });
        },
      );
      setAnnounce("Every view has been rendered.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rendering the remaining views stopped.");
    } finally {
      setBatchRunning(false);
    }
  }

  const select = (r: Row) => {
    setSelectedId(r.id);
    setError(null);
  };

  const downloadUrl = (room && isLocked && !isEvening && upscaled[room.id]) || current?.imageUrl || null;
  const cost = room ? props.roomCost[room.id] : undefined;
  const qa = current?.outcome === "substituted"
    ? { head: "DESIGN CHECK · 3D DESIGN VIEW", text: "The styled render did not match the plan closely enough, so the 3D design view is shown in its place." }
    : current?.qa === "passed" || current?.outcome === "passed"
      ? { head: "DESIGN CHECK · PASSED", text: "Checked against this room's plan before it was kept." }
      : current?.qa === "failed"
        ? { head: "DESIGN CHECK · FLAGGED", text: `${current.qaReason ?? "It may not match the room's real geometry."} Render again or ask for a change.` }
        : current
          ? { head: "DESIGN CHECK · NOT RUN", text: "This render was made before the design check existed." }
          : null;

  const viewSelect = (
    <label className="block">
      <span className="sr-only">View</span>
      <select
        value={row?.id ?? ""}
        onChange={(e) => {
          const r = rows.find((x) => x.id === e.target.value);
          if (r) select(r);
        }}
        className="t-heading-sm min-h-12 w-full border border-bp-line-control bg-bp-surface-base px-3 text-bp-ink-primary"
      >
        {rows.map((r) => (
          <option key={r.id} value={r.id}>
            {r.roomName} · {r.view === "evening" ? "evening" : "day"} — {STATE[r.state].label.toLowerCase()}
          </option>
        ))}
      </select>
      <span className="t-label-md mt-1 block font-bp-mono text-bp-ink-tertiary">
        {chain && !isEvening ? `Version ${chain.index + 1} of ${chain.list.length} · ` : ""}
        {lockedCount} / {views.length} views locked
      </span>
    </label>
  );

  return (
    <div className="bp-renders grid grid-cols-1 lg:grid-cols-[288px_minmax(0,1fr)] xl:grid-cols-[288px_minmax(0,1fr)_300px]" data-renders>
      <TopBarActions>
        {props.viewerHref ? (
          <Button kind="secondary" href={props.viewerHref}>
            3D view
          </Button>
        ) : null}
        <span className="hidden md:inline-flex">
          <Button kind="primary" href={props.costHref}>
            Continue to cost
          </Button>
        </span>
      </TopBarActions>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      {/* Left — all views, room photo, direction */}
      <aside aria-label="Views" className="hidden border-r border-bp-line-hairline px-6 py-6 lg:block">
        <div className="flex items-baseline">
          <h2 className="t-label-caps flex-1 text-bp-ink-tertiary">ALL VIEWS</h2>
          <span className="t-label-md font-bp-mono text-bp-ink-tertiary">
            {lockedCount} / {views.length} locked
          </span>
        </div>
        <div className="mt-3">
          <Button kind="secondary" onClick={() => void renderRemaining()} disabled={batchRunning ? { reason: "Rendering now — up to three at once", reasonId: "batch-reason" } : outstanding === 0 ? { reason: "Every view is rendered", reasonId: "batch-reason" } : false} testId="render-remaining">
            {batchRunning ? "Rendering…" : `Render remaining ${outstanding}`}
          </Button>
          {batchRunning || outstanding === 0 ? (
            <p id="batch-reason" className="t-label-md mt-1.5 font-bp-mono text-bp-ink-tertiary">
              {batchRunning ? "Rendering now — up to three at once" : "Every view is rendered"}
            </p>
          ) : null}
        </div>
        <p className="t-body-sm mt-3 text-bp-ink-secondary">A day view for every room, plus an evening view where the plan has lighting. Up to three render at once.</p>
        <ul className="mt-4 border-t border-bp-line-hairline" aria-label="Rooms and views">
          {rows.map((r) => {
            const on = r.id === row?.id;
            const s = STATE[r.state];
            return (
              <li key={r.id}>
                <button
                  type="button"
                  aria-current={on ? "true" : undefined}
                  onClick={() => select(r)}
                  title={r.note ?? undefined}
                  data-view-row={r.id}
                  data-view-state={r.state}
                  className={`relative flex w-full items-center gap-3 border-b border-bp-line-hairline px-2.5 py-2.5 text-left ${on ? "bg-bp-surface-raised before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-bp-brass" : "hover:bg-bp-surface-raised"}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate ${on ? "t-heading-sm" : "t-body-sm"} ${r.state === "na" ? "text-bp-ink-tertiary" : "text-bp-ink-primary"}`}>{r.roomName}</span>
                    <span className="t-label-md block font-bp-mono text-bp-ink-tertiary">{r.state === "na" ? "—" : viewLabel(r.view)}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-bp-ink-secondary">
                    <Icon name={s.icon} className={`text-[18px]${r.state === "rendering" ? " motion-safe:animate-spin" : ""}`} />
                    <span className="t-label-caps">{r.outcome === "substituted" && (r.state === "ready" || r.state === "locked") ? "3D VIEW" : s.label}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {room && renderable ? (
          <section className="mt-6" aria-labelledby="photo-h">
            <h2 id="photo-h" className="t-label-caps text-bp-ink-tertiary">
              ROOM PHOTO
            </h2>
            <div className="mt-2">
              <RoomPhoto
                key={room.id}
                projectId={projectId}
                roomId={room.id}
                roomName={roomName}
                photoUrl={photos[room.id] ?? null}
                assets={photoAssets}
                onAssigned={(url) => setPhotos((p) => ({ ...p, [room.id]: url }))}
                onNewAsset={(a) => {
                  setPhotoAssets((p) => [a, ...p]);
                  setPhotos((p) => ({ ...p, [room.id]: a.url }));
                }}
              />
            </div>
          </section>
        ) : null}

        <section className="mt-6" aria-labelledby="direction-h">
          <h2 id="direction-h" className="t-label-caps text-bp-ink-tertiary">
            DIRECTION
          </h2>
          <Link href={`/project/${projectId}/design`} className="t-body-sm mt-2 flex min-h-11 items-center gap-3 border border-bp-line-control px-3 py-2 text-bp-ink-primary hover:bg-bp-surface-raised">
            <span className="flex-1">{style?.name_en ?? "Choose a direction"}</span>
            <Icon name="arrow_forward" className="text-[20px] text-bp-ink-secondary" />
          </Link>
        </section>
      </aside>

      {/* Centre — the view */}
      <section aria-labelledby="view-h" className="min-w-0 px-4 py-6 md:px-8">
        <div className="mb-4 lg:hidden">{viewSelect}</div>
        {room ? (
          <>
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <p className="t-label-caps text-bp-ink-tertiary">
                  {(row?.roomName ?? roomName).toUpperCase()} · {viewLabel(selected!.view).toUpperCase()}
                  {chain && !isEvening ? ` · VERSION ${chain.index + 1} OF ${chain.list.length}` : ""}
                </p>
                <h1 id="view-h" className="t-heading-lg mt-1 text-bp-ink-primary">
                  {row?.roomName ?? roomName}
                </h1>
              </div>
              {current ? (
                <div className="flex items-center gap-1 pt-1">
                  <a href={current.imageUrl} target="_blank" rel="noreferrer" aria-label="Open full size" className="flex h-9 w-9 items-center justify-center text-bp-ink-secondary hover:text-bp-ink-primary">
                    <Icon name="zoom_in" className="text-[20px]" />
                  </a>
                  {downloadUrl ? (
                    <a href={downloadUrl} download aria-label={upscaled[room.id] && isLocked ? "Download the high-resolution render" : "Download the render"} className="flex h-9 w-9 items-center justify-center text-bp-ink-secondary hover:text-bp-ink-primary">
                      <Icon name="download" className="text-[20px]" />
                    </a>
                  ) : null}
                  <button type="button" aria-label="Full screen" onClick={() => void image.current?.requestFullscreen?.()} className="flex h-9 w-9 items-center justify-center text-bp-ink-secondary hover:text-bp-ink-primary">
                    <Icon name="fullscreen" className="text-[20px]" />
                  </button>
                </div>
              ) : null}
            </div>

            <div className="relative mt-4 aspect-[3/2] w-full border border-bp-line-hairline bg-bp-surface-sunken" aria-busy={busy || undefined}>
              {current ? (
                // eslint-disable-next-line @next/next/no-img-element -- a stored render
                <img ref={image} key={current.id} src={current.imageUrl} alt={`${style?.name_en ?? "Design"} render of ${roomName}, ${viewLabel(selected!.view).toLowerCase()}`} className={`h-full w-full object-cover ${busy ? "opacity-40" : ""}`} />
              ) : (
                <div className="flex h-full items-center justify-center p-6">
                  {!renderable ? (
                    <StateBlock kind="empty" icon="hide_image" title="This room isn't rendered">
                      There is nothing to photograph in a {room.room_type?.replace(/_/g, " ") ?? "room"} — the studio renders living spaces, bedrooms, bathrooms and garden zones.
                    </StateBlock>
                  ) : isEvening && !chain ? (
                    <StateBlock kind="empty" icon="nights_stay" title="Waits for the day view">
                      The evening view is made from the day view — render that first.
                    </StateBlock>
                  ) : (
                    <StateBlock kind="empty" icon="photo_camera" title="Not rendered yet" actions={<Button kind="secondary" onClick={() => void renderAgain()}>Render this view</Button>}>
                      {photos[room.id] ? "Rendered from your photo of this room, in your direction." : "Rendered from the plan's dimensions, in your direction. Add a photo to render your own room."}
                    </StateBlock>
                  )}
                </div>
              )}
              {busy ? (
                <div className="absolute inset-x-0 bottom-0">
                  <div className="h-0.5 bg-bp-ink-primary transition-[width]" style={{ width: `${Math.min(95, Math.max(4, (elapsed / 30_000) * 95))}%` }} />
                  <p className="t-label-md bg-bp-surface-raised px-3 py-1.5 font-bp-mono text-bp-ink-secondary">Rendering · usually under a minute</p>
                </div>
              ) : null}
            </div>

            {cost != null && cost > 0 && !isEvening ? (
              <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="t-label-caps text-bp-ink-tertiary">THIS ROOM IN YOUR COST</span>
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden="true" className="t-num-md text-bp-ink-primary">
                    ≈ AED {formatAED(cost)}
                  </span>
                  <ProvenanceMark tier="derived" />
                  <span className="sr-only">approximately AED {formatAED(cost)}, estimated</span>
                </span>
                <Link href={`/project/${projectId}/boq?view=byroom&room=${room.id}`} className="t-body-sm ml-auto text-bp-ink-primary hover:underline">
                  Open in 04 Cost →
                </Link>
              </p>
            ) : null}

            {qa ? (
              <div className="mt-4 flex items-start gap-3 bg-bp-surface-sunken px-4 py-3" data-design-check>
                <Icon name={current?.qa === "failed" ? "report" : "task_alt"} className="text-[20px] text-bp-ink-primary" />
                <p>
                  <span className="t-label-caps block text-bp-ink-primary">{qa.head}</span>
                  <span className="t-body-sm block text-bp-ink-secondary">{qa.text}</span>
                </p>
              </div>
            ) : null}

            {error ? (
              <div className="mt-4">
                <StateBlock kind="error" title="That didn't work" afterUserAction actions={<Button kind="secondary" tone="inverse" onClick={() => void renderAgain()}>Try again</Button>}>
                  {error} Your earlier versions are kept.
                </StateBlock>
              </div>
            ) : null}

            {current && renderable ? (
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
                {!isEvening ? (
                  <Button kind="secondary" onClick={() => void lock()} disabled={isLocked ? { reason: "Locked — this view is in your design", reasonId: "lock-reason", showReason: true } : locking ? { reason: "Locking and preparing the high-resolution copy…", reasonId: "lock-reason", showReason: true } : busy ? { reason: "Wait for the render to finish", reasonId: "lock-reason", showReason: true } : false} testId="lock-view">
                    {isLocked ? "View locked" : "Lock this view"}
                  </Button>
                ) : null}
                <Button kind="quiet" onClick={() => void renderAgain()} disabled={busy ? { reason: "Rendering now", reasonId: "again-reason", showReason: false } : false}>
                  Render again
                </Button>
                {busy ? <span id="again-reason" className="sr-only">Rendering now</span> : null}
                {chain && chain.list.length > 1 && !isEvening ? (
                  <div className="ml-auto flex items-center gap-2">
                    <span className="t-label-caps text-bp-ink-tertiary">VERSIONS</span>
                    <ul className="flex gap-2">
                      {chain.list.map((v, i) => (
                        <li key={v.id}>
                          <button
                            type="button"
                            aria-pressed={i === chain.index}
                            aria-label={i === 0 ? "First version" : `Version ${i + 1}`}
                            title={v.prompt}
                            onClick={() => setChains((p) => ({ ...p, [room.id]: { ...p[room.id]!, index: i } }))}
                            className={`block ${i === chain.index ? "outline outline-2 outline-offset-0 outline-bp-ink-primary" : ""}`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element -- a stored render */}
                            <img src={v.imageUrl} alt="" className="h-9 w-[54px] border border-bp-line-hairline object-cover" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            {current && renderable && !isEvening ? (
              atCap ? (
                <div className="mt-4 bg-bp-surface-sunken px-4 py-3">
                  <p className="t-body-sm text-bp-ink-primary">You&apos;ve changed this view {MAX_TWEAKS} times — usually a good point to lock it.</p>
                  <div className="mt-2">
                    <Button
                      kind="quiet"
                      onClick={() => {
                        // The capped render wasn't accepted — a "rejected" signal (fire-and-forget, as before).
                        void fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId, entity_type: "render", entity_id: current.id, action: "rejected", payload: { reason: "kept_iterating_past_cap" } }) }).catch(() => {});
                        setKeepGoing((p) => new Set(p).add(room.id));
                      }}
                    >
                      Keep changing it
                    </Button>
                  </div>
                </div>
              ) : (
                <form onSubmit={askForChange} className="mt-4 flex min-h-12 items-center gap-3 border border-bp-line-control px-3 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-bp-focus-ring">
                  <Icon name="edit" className="text-[20px] text-bp-ink-secondary" />
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">Ask for a change to this view</span>
                    <input value={ask} onChange={(e) => setAsk(e.target.value)} disabled={busy} placeholder="Ask for a change — “warmer wood, less gold”, “add a reading nook”" className="t-body-sm h-11 w-full bg-transparent text-bp-ink-primary outline-none placeholder:text-bp-ink-tertiary" />
                  </label>
                  <button type="submit" aria-label="Send the change" disabled={busy || !ask.trim()} className="flex h-9 w-9 items-center justify-center text-bp-ink-primary disabled:text-bp-ink-tertiary">
                    <Icon name="arrow_upward" className="text-[20px]" />
                  </button>
                </form>
              )
            ) : null}
          </>
        ) : (
          <StateBlock kind="empty" icon="photo_camera" title="No rooms to render">
            Confirm your plan first — every room on it gets a view here.
          </StateBlock>
        )}

        {/* Below xl: the palette folds under the view (phone: "Material palette · 4"). */}
        <details className="mt-8 border-y border-bp-line-hairline xl:hidden">
          <summary className="t-heading-sm flex min-h-12 cursor-pointer list-none items-center justify-between text-bp-ink-primary [&::-webkit-details-marker]:hidden">
            Material palette · 4
            <Icon name="expand_more" className="text-[20px] text-bp-ink-secondary" />
          </summary>
          <div className="pb-4">
            <MaterialPalette projectId={projectId} furniture={stagingAvailable && room ? { roomId: room.id, optedIn: props.initialFurnitureOptIns.includes(room.id) } : null} />
          </div>
        </details>
      </section>

      {/* Right — the palette */}
      <aside aria-label="Materials" className="hidden border-l border-bp-line-hairline px-6 py-6 xl:block">
        <MaterialPalette projectId={projectId} furniture={stagingAvailable && room ? { roomId: room.id, optedIn: props.initialFurnitureOptIns.includes(room.id) } : null} />
      </aside>

      {/* Phone: the one Primary, sticky at the foot (66:1443). */}
      <div className="sticky bottom-0 border-t border-bp-line-hairline bg-bp-surface-base p-4 md:hidden">
        <Button kind="primary" href={props.costHref} className="w-full">
          Continue to cost
        </Button>
      </div>
    </div>
  );
}
