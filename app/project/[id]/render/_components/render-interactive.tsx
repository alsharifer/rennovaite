"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { AnalyticsEvent, track } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { MATERIALS, SURFACE_SPECS, type Material } from "@/lib/materials";
import { roomTypeFromDb } from "@/lib/render-prompts";
import type { Style } from "@/lib/styles";

// Rendering only covers the pilot's four room types (bedroom, bathroom,
// living). Dressing rooms, balconies, stairs, terraces, foyers etc. map to
// null and can't be rendered — gate them in the UI instead of firing a call
// that 400s.
function isRenderableRoom(roomType: string | null): boolean {
  return roomTypeFromDb(roomType) !== null;
}

// ---------------------------------------------------------------------------
// Types + constants
// ---------------------------------------------------------------------------

type RoomLite = {
  id: string;
  name_en: string | null;
  room_type: string | null;
  area_m2: number | null;
  polygon: unknown;
};

type RenderItem = {
  id: string;
  imageUrl: string;
  prompt: string;
  qa?: "passed" | "failed" | null;
  qaReason?: string | null;
};
type RoomState = { list: RenderItem[]; currentIndex: number };

type Props = {
  projectId: string;
  rooms: RoomLite[];
  style: Style | null;
  initialChains?: Record<string, RenderItem[]>;
  initialLockedRoomIds?: string[];
  /** roomId → most-recent uploaded photo public URL. */
  initialPhotosByRoom?: Record<string, string>;
  /** P4: roomId → element-mapped BoQ rollup (AED). Chip near the hero. */
  roomBoqTotals?: Record<string, number>;
};

type GenerateResponse = {
  render_id: string;
  image_url: string;
  prompt: string;
  qa?: "passed" | "failed" | null;
  qaReason?: string | null;
};

// The render + iterate routes now run async: they return a prediction_id and
// the client polls /api/render/status until the image is ready. A cache hit
// still returns image_url directly, so both shapes are handled.
async function pollRenderStatus(
  predictionId: string,
): Promise<GenerateResponse> {
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(
      `/api/render/status?prediction_id=${encodeURIComponent(predictionId)}`,
    );
    const body = (await res.json().catch(() => null)) as
      | {
          status?: string;
          image_url?: string;
          render_id?: string;
          prompt?: string;
          qa?: "passed" | "failed" | null;
          qa_reason?: string | null;
          error?: string;
        }
      | null;
    if (!res.ok || !body) {
      throw new Error(body?.error || `Status check failed (${res.status}).`);
    }
    if (body.status === "succeeded" && body.image_url && body.render_id) {
      return {
        render_id: body.render_id,
        image_url: body.image_url,
        prompt: body.prompt ?? "",
        qa: body.qa ?? null,
        qaReason: body.qa_reason ?? null,
      };
    }
    if (body.status === "failed") {
      throw new Error(body.error || "Render failed.");
    }
    // status === "processing" → keep polling.
  }
  throw new Error("Render timed out.");
}

// Normalise a POST /api/render(-iterate) response: a cache hit carries
// image_url; otherwise poll the returned prediction_id to completion.
async function resolveRender(
  body: Record<string, unknown> | null,
  status: number,
): Promise<GenerateResponse> {
  if (!body) throw new Error(`Render failed (${status}).`);
  if (typeof body.image_url === "string" && body.image_url) {
    return {
      render_id: String(body.render_id),
      image_url: body.image_url,
      prompt: typeof body.prompt === "string" ? body.prompt : "",
    };
  }
  if (typeof body.prediction_id === "string" && body.prediction_id) {
    return pollRenderStatus(body.prediction_id);
  }
  throw new Error(
    (typeof body.error === "string" && body.error) ||
      "Unexpected render response.",
  );
}

const MAX_TWEAKS = 4;
const SUBSTEPS = [
  "Interpreting tweak",
  "Regenerating geometry",
  "Relighting scene",
] as const;
const SUBSTEP_INTERVAL_MS = 2200;
const PROGRESS_TARGET_MS = 30_000;

function pickDefaultRoomId(rooms: RoomLite[]): string | null {
  return (
    rooms.find((r) => r.room_type === "master_bedroom")?.id ??
    rooms.find((r) => r.room_type === "bedroom")?.id ??
    rooms[0]?.id ??
    null
  );
}

function isPointArray(v: unknown): v is number[][] {
  if (!Array.isArray(v)) return false;
  for (const p of v) {
    if (!Array.isArray(p) || typeof p[0] !== "number" || typeof p[1] !== "number") {
      return false;
    }
  }
  return v.length >= 3;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function RenderInteractive({
  projectId,
  rooms,
  style,
  initialChains,
  initialLockedRoomIds = [],
  initialPhotosByRoom = {},
  roomBoqTotals = {},
}: Props) {
  const seededState = useMemo<Record<string, RoomState>>(() => {
    const result: Record<string, RoomState> = {};
    for (const [roomId, chain] of Object.entries(initialChains ?? {})) {
      if (chain.length > 0) {
        result[roomId] = { list: chain, currentIndex: chain.length - 1 };
      }
    }
    return result;
  }, [initialChains]);

  const [selectedId, setSelectedId] = useState<string | null>(() =>
    pickDefaultRoomId(rooms),
  );
  const [stateByRoom, setStateByRoom] =
    useState<Record<string, RoomState>>(seededState);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chat, setChat] = useState("");
  const [lockedRoomIds, setLockedRoomIds] = useState<Set<string>>(
    () => new Set(initialLockedRoomIds),
  );
  const [photosByRoom, setPhotosByRoom] =
    useState<Record<string, string>>(initialPhotosByRoom);
  // roomId → upscaled (HD) export URL, populated when a view is locked.
  const [upscaledByRoom, setUpscaledByRoom] = useState<Record<string, string>>(
    {},
  );
  const [keepIterating, setKeepIterating] = useState<Set<string>>(() => new Set());
  const [lastRenderMs, setLastRenderMs] = useState<number | null>(null);
  const [locking, setLocking] = useState(false);

  // Controlled-only studio knobs (no backend effect for v1).
  const [lighting, setLighting] = useState(50);
  const [density, setDensity] = useState<"sparse" | "optimal" | "maximal">(
    "optimal",
  );

  // Material palette state (4 visible slots; client-only swap).
  const [materialSlots, setMaterialSlots] = useState<Material[]>(() =>
    MATERIALS.slice(0, 4),
  );
  const [swapTarget, setSwapTarget] = useState<number | null>(null);

  // Generation progress + substep are driven by an elapsedMs state that
  // ticks only while a render is in flight. No synchronous setState in the
  // effect body, no ref reads + Date.now() during render — both prior
  // lint flags surfaced on this file's earlier implementation.
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!generatingId) return;
    const start = Date.now();
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - start);
    }, 200);
    return () => clearInterval(interval);
  }, [generatingId]);

  const selectedRoom = rooms.find((r) => r.id === selectedId) ?? null;
  const roomState = selectedRoom ? stateByRoom[selectedRoom.id] ?? null : null;
  const currentRender = roomState ? roomState.list[roomState.currentIndex] ?? null : null;
  const tweakCount = roomState ? roomState.list.length - 1 : 0;
  const atCap =
    selectedRoom !== null &&
    tweakCount >= MAX_TWEAKS &&
    !keepIterating.has(selectedRoom.id);
  const isGenerating = selectedRoom !== null && generatingId === selectedRoom.id;
  const isLocked = selectedRoom !== null && lockedRoomIds.has(selectedRoom.id);
  const selectedRenderable =
    selectedRoom !== null && isRenderableRoom(selectedRoom.room_type);

  const substepIdx =
    Math.floor(elapsedMs / SUBSTEP_INTERVAL_MS) % SUBSTEPS.length;
  const progress = Math.min(95, (elapsedMs / PROGRESS_TARGET_MS) * 95);

  // -------------------------------------------------------------------------
  // API calls (preserve the existing data flow)
  // -------------------------------------------------------------------------

  async function callGenerate(roomId: string): Promise<GenerateResponse> {
    const res = await fetch("/api/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId, room_id: roomId }),
    });
    const body = (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!res.ok) {
      throw new Error(
        (body && typeof body.error === "string" && body.error) ||
          `Render failed (${res.status}).`,
      );
    }
    return resolveRender(body, res.status);
  }

  async function callIterate(
    roomId: string,
    parentRenderId: string,
    tweak: string,
  ): Promise<GenerateResponse> {
    const res = await fetch("/api/render-iterate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: projectId,
        room_id: roomId,
        parent_render_id: parentRenderId,
        tweak,
      }),
    });
    const body = (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!res.ok) {
      throw new Error(
        (body && typeof body.error === "string" && body.error) ||
          `Iteration failed (${res.status}).`,
      );
    }
    return resolveRender(body, res.status);
  }

  async function timed<T>(fn: () => Promise<T>): Promise<T> {
    const t0 = Date.now();
    const out = await fn();
    setLastRenderMs(Date.now() - t0);
    return out;
  }

  async function handleRegenerate() {
    if (!selectedRoom || isGenerating || !selectedRenderable) return;
    const id = selectedRoom.id;
    setGeneratingId(id);
    setError(null);
    try {
      const result = await timed(() => callGenerate(id));
      const item: RenderItem = {
        id: result.render_id,
        imageUrl: result.image_url,
        prompt: result.prompt,
        qa: result.qa ?? null,
        qaReason: result.qaReason ?? null,
      };
      setStateByRoom((prev) => ({
        ...prev,
        [id]: { list: [item], currentIndex: 0 },
      }));
      track(AnalyticsEvent.RenderGenerated, {
        project_id: projectId,
        room_id: id,
        render_id: result.render_id,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Render failed.");
    } finally {
      setGeneratingId((cur) => (cur === id ? null : cur));
    }
  }

  async function handleSendTweak(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedRoom || !currentRender || atCap || isGenerating) return;
    const tweak = chat.trim();
    if (!tweak) return;
    const id = selectedRoom.id;
    const parent = currentRender;
    setChat("");
    setGeneratingId(id);
    setError(null);
    try {
      const result = await timed(() => callIterate(id, parent.id, tweak));
      const item: RenderItem = {
        id: result.render_id,
        imageUrl: result.image_url,
        prompt: result.prompt,
        qa: result.qa ?? null,
        qaReason: result.qaReason ?? null,
      };
      setStateByRoom((prev) => {
        const cur = prev[id];
        if (!cur) return prev;
        const truncated = cur.list.slice(0, cur.currentIndex + 1);
        const nextList = [...truncated, item];
        return {
          ...prev,
          [id]: { list: nextList, currentIndex: nextList.length - 1 },
        };
      });
      track(AnalyticsEvent.RenderIterated, {
        project_id: projectId,
        room_id: id,
        render_id: result.render_id,
        parent_render_id: parent.id,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Iteration failed.");
    } finally {
      setGeneratingId((cur) => (cur === id ? null : cur));
    }
  }

  async function handleLock() {
    if (!selectedRoom || !currentRender || locking) return;
    setLocking(true);
    setError(null);
    try {
      const res = await fetch("/api/approve-design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          room_id: selectedRoom.id,
          render_id: currentRender.id,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { id?: string; upscaled_url?: string | null; error?: string }
        | null;
      if (!res.ok || !body?.id) {
        throw new Error(body?.error ?? `Lock failed (${res.status}).`);
      }
      setLockedRoomIds((prev) => new Set(prev).add(selectedRoom.id));
      if (body.upscaled_url) {
        const hdUrl = body.upscaled_url;
        setUpscaledByRoom((prev) => ({ ...prev, [selectedRoom.id]: hdUrl }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't lock the view.");
    } finally {
      setLocking(false);
    }
  }

  function setCurrentIndex(idx: number) {
    if (!selectedRoom) return;
    setStateByRoom((prev) => {
      const cur = prev[selectedRoom.id];
      if (!cur) return prev;
      return { ...prev, [selectedRoom.id]: { ...cur, currentIndex: idx } };
    });
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-canvas">
      {/* LEFT COL — rooms & style picker -------------------------------- */}
      <aside className="flex w-[320px] shrink-0 flex-col overflow-y-auto border-r border-ink-100 bg-paper px-lg py-lg">
        <p className="label-caps mb-md text-ink-500">Rooms</p>
        <ul className="flex flex-col gap-xs">
          {rooms.map((room) => (
            <RoomRow
              key={room.id}
              room={room}
              selected={room.id === selectedId}
              rendered={(stateByRoom[room.id]?.list.length ?? 0) > 0}
              renderable={isRenderableRoom(room.room_type)}
              onClick={() => setSelectedId(room.id)}
            />
          ))}
        </ul>

        <div className="my-xl h-px bg-bone" />

        <p className="label-caps mb-md text-ink-500">Room photo</p>
        <RoomPhotoPanel
          key={selectedRoom?.id ?? "none"}
          roomId={selectedRoom?.id ?? null}
          roomName={selectedRoom?.name_en?.trim() || "this room"}
          photoUrl={selectedRoom ? photosByRoom[selectedRoom.id] ?? null : null}
          onUploaded={(url) => {
            if (!selectedRoom) return;
            setPhotosByRoom((prev) => ({ ...prev, [selectedRoom.id]: url }));
          }}
        />

        <div className="my-xl h-px bg-bone" />

        <p className="label-caps mb-md text-ink-500">Style</p>
        <StylePicker projectId={projectId} style={style} />

        <p className="label-caps mt-xl mb-sm text-ink-500">Lighting mood</p>
        <input
          type="range"
          min={0}
          max={100}
          value={lighting}
          onChange={(e) => setLighting(Number(e.target.value))}
          className="w-full accent-brass-600"
          aria-label="Lighting mood"
        />
        <div className="mt-xs flex justify-between font-mono text-[11px] text-ink-500">
          <span>Golden hour</span>
          <span>Midnight glow</span>
        </div>

        <p className="label-caps mt-xl mb-sm text-ink-500">Detail density</p>
        <div className="grid grid-cols-3 overflow-hidden rounded border border-ink-100">
          {(["sparse", "optimal", "maximal"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDensity(d)}
              className={cn(
                "px-sm py-xs font-body-sm text-body-sm font-semibold capitalize transition-colors",
                density === d
                  ? "bg-brass-600 text-on-primary"
                  : "bg-paper text-ink-700 hover:bg-surface-container-low",
              )}
            >
              {d}
            </button>
          ))}
        </div>
      </aside>

      {/* CENTER COL — hero render stage --------------------------------- */}
      <main className="relative flex flex-1 flex-col overflow-y-auto px-lg py-lg">
        <div className="mx-auto flex w-full max-w-[840px] flex-col items-center gap-md">
          <ActivePill />

          <HeroRender
            render={currentRender}
            roomName={selectedRoom?.name_en?.trim() || "this room"}
            styleName={style?.name_en ?? "default style"}
            generating={isGenerating}
            progress={progress}
            substepIdx={substepIdx}
            error={!currentRender ? error : null}
          />

          {/* P4: this room's element-mapped BoQ cost → deep-links to By room. */}
          {selectedRoom && (roomBoqTotals[selectedRoom.id] ?? 0) > 0 && (
            <Link
              href={`/project/${projectId}/boq?view=byroom&room=${selectedRoom.id}`}
              className="focus-ring inline-flex items-center gap-sm rounded-full border border-ink-100 bg-paper px-md py-xs font-body-sm text-body-sm text-ink-900 transition-colors hover:bg-surface-container"
            >
              <span className="material-symbols-outlined text-[16px] text-brass-600" aria-hidden="true">
                request_quote
              </span>
              This room on your BoQ ·{" "}
              <span className="font-mono tabular-nums">
                AED {(roomBoqTotals[selectedRoom.id] ?? 0).toLocaleString("en-US")}
              </span>
            </Link>
          )}

          <HeroActions
            disabled={!selectedRoom || isGenerating || !selectedRenderable}
            onRegenerate={handleRegenerate}
            downloadUrl={
              (selectedRoom &&
                isLocked &&
                upscaledByRoom[selectedRoom.id]) ||
              currentRender?.imageUrl ||
              null
            }
            downloadIsHd={
              !!(selectedRoom && isLocked && upscaledByRoom[selectedRoom.id])
            }
          />

          {selectedRoom && !selectedRenderable && (
            <p className="max-w-[560px] text-center font-body-sm text-body-sm text-on-surface-variant">
              Rendering isn&apos;t available for this room type
              {selectedRoom.room_type ? ` (${selectedRoom.room_type})` : ""}.
              The pilot renders bedrooms, bathrooms, and living areas — dressing
              rooms, balconies, stairs, terraces and the like are out of scope.
            </p>
          )}

          {currentRender?.qa === "failed" && !isGenerating && (
            <div className="flex max-w-[560px] items-start gap-sm rounded-lg border border-error/40 bg-error/5 px-md py-sm">
              <span
                className="material-symbols-outlined text-[18px] text-error"
                aria-hidden="true"
              >
                report
              </span>
              <p className="text-left font-body-sm text-body-sm text-ink-900">
                <span className="font-semibold">QA flagged this render.</span>{" "}
                {currentRender.qaReason ||
                  "It may not match the room's real geometry or contains an implausible element."}{" "}
                Try rephrasing your tweak or regenerating.
              </p>
            </div>
          )}

          <StatusRow lastRenderMs={lastRenderMs} />

          {/* Persistent lock affordance — lock a view you like without having
              to iterate to the tweak cap first. */}
          {currentRender && selectedRenderable && (
            <button
              type="button"
              onClick={handleLock}
              disabled={locking || isLocked || isGenerating}
              className="focus-ring flex h-10 items-center gap-sm rounded-lg border border-ink-100 px-lg font-body-sm text-body-sm font-semibold text-ink-900 transition-colors hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span
                className="material-symbols-outlined text-[18px]"
                aria-hidden="true"
              >
                {isLocked ? "check" : "lock"}
              </span>
              {isLocked
                ? "View locked"
                : locking
                  ? "Locking & upscaling…"
                  : "Lock this view"}
            </button>
          )}

          {roomState && roomState.list.length > 0 && (
            <ThumbStrip
              list={roomState.list}
              currentIndex={roomState.currentIndex}
              onSelect={setCurrentIndex}
              disabled={isGenerating}
            />
          )}

          {error && currentRender && (
            <p className="font-body-sm text-body-sm text-error">{error}</p>
          )}

          {atCap ? (
            <CapBanner
              onLock={handleLock}
              onKeepIterating={() => {
                if (!selectedRoom) return;
                // The capped render wasn't accepted — record a "rejected"
                // signal against it before the user keeps tweaking. The route
                // resolves its kg_bundle_id. Fire-and-forget; never blocks UI.
                if (currentRender) {
                  void fetch("/api/feedback", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      project_id: projectId,
                      entity_type: "render",
                      entity_id: currentRender.id,
                      action: "rejected",
                      payload: { reason: "kept_iterating_past_cap" },
                    }),
                  }).catch(() => {});
                }
                setKeepIterating((p) => new Set(p).add(selectedRoom.id));
              }}
              locking={locking}
              locked={isLocked}
            />
          ) : (
            <ChatInput
              value={chat}
              onChange={setChat}
              onSubmit={handleSendTweak}
              disabled={!currentRender || isGenerating}
              isGenerating={isGenerating}
              lastRenderMs={lastRenderMs}
            />
          )}
        </div>
      </main>

      {/* RIGHT COL — material palette ----------------------------------- */}
      <aside className="flex w-[320px] shrink-0 flex-col overflow-y-auto border-l border-ink-100 bg-paper px-lg py-lg">
        <p className="label-caps mb-xs text-ink-500">Material palette</p>
        <p className="mb-lg font-body-sm text-body-sm text-on-surface-variant">
          Four core finishes that anchor this style. Swap any for a vetted
          alternative.
        </p>
        <ul className="flex flex-col gap-md">
          {materialSlots.map((m, i) => (
            <MaterialCard
              key={`${m.id}-${i}`}
              material={m}
              onSwap={() => setSwapTarget(i)}
            />
          ))}
        </ul>

        <p className="label-caps mt-xl mb-md text-ink-500">Surface specs</p>
        <div className="grid grid-cols-2 gap-md rounded-lg border border-ink-100 bg-canvas p-md">
          {SURFACE_SPECS.map((s) => (
            <div key={s.label} className="flex flex-col gap-xs">
              <span className="label-caps text-ink-500">{s.label}</span>
              <span className="font-mono text-body-sm tabular-nums text-ink-900">
                {s.value}
              </span>
            </div>
          ))}
        </div>
      </aside>

      {/* Floating Cost-it CTA ------------------------------------------ */}
      {lockedRoomIds.size > 0 && (
        <Link
          href={`/project/${projectId}/boq`}
          className="focus-ring fixed bottom-lg right-lg z-30 flex h-[56px] items-center gap-sm rounded-full bg-brass-600 px-xl font-body-sm text-body-sm font-semibold text-on-primary shadow-level-2 transition-transform hover:scale-[1.02]"
        >
          <span
            className="material-symbols-outlined text-[18px]"
            aria-hidden="true"
          >
            receipt_long
          </span>
          Cost it →
        </Link>
      )}

      {/* Material swap modal ------------------------------------------- */}
      <Dialog
        open={swapTarget !== null}
        onOpenChange={(next) => {
          if (!next) setSwapTarget(null);
        }}
      >
        <DialogContent className="w-[92vw] max-w-[560px] border border-ink-100 bg-paper p-6 duration-200 sm:max-w-[560px]">
          {swapTarget !== null && materialSlots[swapTarget] && (
            <SwapPanel
              current={materialSlots[swapTarget]!}
              onPick={(alt) => {
                setMaterialSlots((prev) => {
                  const next = [...prev];
                  // Merge: keep the slot's alternates list so future swaps
                  // see the same palette of options.
                  next[swapTarget] = {
                    ...alt,
                    alternates: prev[swapTarget]!.alternates,
                  };
                  return next;
                });
                setSwapTarget(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Left column
// ---------------------------------------------------------------------------

function RoomRow({
  room,
  selected,
  rendered,
  renderable,
  onClick,
}: {
  room: RoomLite;
  selected: boolean;
  rendered: boolean;
  renderable: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className={cn(
          "relative flex h-14 w-full items-center gap-md rounded px-sm text-left transition-colors",
          selected ? "bg-surface-container-low" : "hover:bg-surface-container-low",
        )}
      >
        {selected && (
          <span
            aria-hidden="true"
            className="absolute inset-y-2 left-0 w-[3px] rounded-r-sm bg-brass-600"
          />
        )}
        <RoomThumb polygon={room.polygon} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-body-sm text-body-sm font-semibold text-ink-900">
            {room.name_en?.trim() || "Room"}
          </p>
        </div>
        <span
          className={cn(
            "rounded-full px-sm py-[2px] text-[10px] font-semibold uppercase tracking-wider",
            !renderable
              ? "bg-bone text-ink-500 opacity-60"
              : rendered
                ? "bg-primary-fixed text-ink-900"
                : "bg-bone text-ink-500",
          )}
        >
          {!renderable ? "N/A" : rendered ? "Rendered" : "Not yet"}
        </span>
      </button>
    </li>
  );
}

function RoomThumb({ polygon }: { polygon: unknown }) {
  if (!isPointArray(polygon)) {
    return <div className="size-10 shrink-0 rounded bg-bone" />;
  }
  const xs = polygon.map((p) => p[0]!);
  const ys = polygon.map((p) => p[1]!);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = Math.max(maxX - minX, 1e-6);
  const h = Math.max(maxY - minY, 1e-6);
  const PAD = 2;
  const sizes = 40 - PAD * 2;
  const scale = Math.min(sizes / w, sizes / h);
  const offX = (40 - w * scale) / 2;
  const offY = (40 - h * scale) / 2;
  const points = polygon
    .map(([x, y]) => `${((x - minX) * scale + offX).toFixed(1)},${((y - minY) * scale + offY).toFixed(1)}`)
    .join(" ");
  return (
    <svg
      viewBox="0 0 40 40"
      className="size-10 shrink-0 rounded bg-bone"
      aria-hidden="true"
    >
      <polygon points={points} fill="#0F1B2D" />
    </svg>
  );
}

function StylePicker({
  projectId,
  style,
}: {
  projectId: string;
  style: Style | null;
}) {
  if (!style) {
    return (
      <Link
        href={`/project/${projectId}/style`}
        className="focus-ring flex h-14 items-center justify-between rounded border border-dashed border-ink-100 px-md font-body-sm text-body-sm text-on-surface-variant hover:bg-surface-container-low"
      >
        Pick a style direction
        <span
          className="material-symbols-outlined text-[18px]"
          aria-hidden="true"
        >
          arrow_forward
        </span>
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-md rounded-lg border border-ink-100 p-sm">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={style.reference_images[0]}
        alt={`${style.name_en} reference`}
        className="size-12 shrink-0 rounded object-cover"
        onError={(e) => {
          // Palette fallback if the moodboard PNG is missing.
          const el = e.currentTarget;
          el.style.background = `linear-gradient(135deg, ${style.palette[0]}, ${style.palette[1]})`;
          el.removeAttribute("src");
        }}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-body-sm text-body-sm font-semibold text-ink-900">
          {style.name_en}
        </p>
        <Link
          href={`/project/${projectId}/style`}
          className="text-[12px] font-semibold text-brass-600 hover:underline"
        >
          Change
        </Link>
      </div>
    </div>
  );
}

// Room photo uploader. Shows the current photo (matte-image framed) with a
// Replace action, or an "Add room photo" affordance when none exists. Uploads
// via XHR so we can show progress; posts to /api/room-photo.
function RoomPhotoPanel({
  roomId,
  roomName,
  photoUrl,
  onUploaded,
}: {
  roomId: string | null;
  roomName: string;
  photoUrl: string | null;
  onUploaded: (publicUrl: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const MAX_BYTES = 20 * 1024 * 1024;

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be re-selected later
    if (!file || !roomId) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      setError("Please choose a PNG or JPG.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Image is larger than 20 MB.");
      return;
    }
    setError(null);
    setUploading(true);
    setProgress(0);

    const form = new FormData();
    form.append("room_id", roomId);
    form.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/room-photo");
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) setProgress((ev.loaded / ev.total) * 100);
    };
    xhr.onload = () => {
      setUploading(false);
      let body: unknown = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        // fall through to the generic error below
      }
      if (
        xhr.status >= 200 &&
        xhr.status < 300 &&
        body &&
        typeof body === "object" &&
        "public_url" in body
      ) {
        onUploaded(String((body as { public_url: unknown }).public_url));
      } else {
        const msg =
          body && typeof body === "object" && "error" in body
            ? String((body as { error: unknown }).error)
            : `Upload failed (${xhr.status}).`;
        setError(msg);
      }
    };
    xhr.onerror = () => {
      setUploading(false);
      setError("Network error — try again.");
    };
    xhr.send(form);
  }

  return (
    <div className="flex flex-col gap-sm">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg"
        onChange={onPick}
        className="hidden"
      />

      {photoUrl ? (
        <>
          <div className="matte-image">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoUrl}
              alt={`${roomName} photo`}
              className="aspect-[3/2] w-full rounded object-cover"
            />
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading || !roomId}
            className="focus-ring flex h-10 items-center justify-center gap-sm rounded-lg border border-ink-100 font-body-sm text-body-sm font-semibold text-ink-900 transition-colors hover:bg-surface-container-low disabled:opacity-50"
          >
            <span
              className="material-symbols-outlined text-[18px]"
              aria-hidden="true"
            >
              sync
            </span>
            {uploading ? "Uploading…" : "Replace photo"}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading || !roomId}
          className="focus-ring flex h-[120px] flex-col items-center justify-center gap-xs rounded-lg border-2 border-dashed border-ink-100 text-center transition-colors hover:border-brass-600 hover:bg-primary-fixed/30 disabled:opacity-50"
        >
          <span
            className="material-symbols-outlined text-[28px] text-brass-600"
            aria-hidden="true"
          >
            add_a_photo
          </span>
          <span className="font-body-sm text-body-sm text-on-surface-variant">
            {uploading ? "Uploading…" : "Add room photo"}
          </span>
          <span className="font-body-sm text-[11px] text-ink-500">
            PNG or JPG · max 20 MB
          </span>
        </button>
      )}

      {uploading && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-bone">
          <div
            className="h-full rounded-full bg-brass-600 transition-[width] duration-200"
            style={{ width: `${Math.max(4, progress)}%` }}
          />
        </div>
      )}
      {error && (
        <p className="font-body-sm text-body-sm text-error">{error}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Center column
// ---------------------------------------------------------------------------

function ActivePill() {
  return (
    <div className="flex items-center gap-sm rounded-full border border-ink-100 bg-paper px-md py-xs">
      <span className="size-2 rounded-full bg-brass-600" aria-hidden="true" />
      <span className="label-caps text-brass-600">AI Studio · Active</span>
    </div>
  );
}

function HeroRender({
  render,
  roomName,
  styleName,
  generating,
  progress,
  substepIdx,
  error,
}: {
  render: RenderItem | null;
  roomName: string;
  styleName: string;
  generating: boolean;
  progress: number;
  substepIdx: number;
  error: string | null;
}) {
  return (
    <div className="relative w-full max-w-[720px]">
      <div className="matte-image relative">
        <div className="relative aspect-[3/2] w-full overflow-hidden rounded-lg bg-bone">
          {render ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={render.id}
              src={render.imageUrl}
              alt={`${styleName} render of ${roomName}`}
              className={cn(
                "size-full object-cover transition-opacity duration-300",
                generating ? "opacity-40" : "opacity-100",
              )}
            />
          ) : (
            <div className="flex size-full items-center justify-center text-center">
              {error ? (
                <p className="font-body-sm text-body-sm text-error">{error}</p>
              ) : (
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  Click <span className="font-semibold">Regenerate this view</span>{" "}
                  to render {roomName} in {styleName}.
                </p>
              )}
            </div>
          )}
          {generating && (
            <>
              <div
                aria-hidden="true"
                className="absolute bottom-0 left-0 h-[2px] bg-brass-600 transition-[width] duration-200"
                style={{ width: `${Math.max(4, progress)}%` }}
              />
              <div className="absolute inset-x-0 bottom-[10px] flex justify-center">
                <AnimatePresence mode="wait">
                  <motion.p
                    key={substepIdx}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.3 }}
                    className="font-display text-body-lg italic text-ink-900"
                  >
                    {SUBSTEPS[substepIdx]}…
                  </motion.p>
                </AnimatePresence>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function HeroActions({
  disabled,
  onRegenerate,
  downloadUrl,
  downloadIsHd = false,
}: {
  disabled: boolean;
  onRegenerate: () => void;
  downloadUrl: string | null;
  downloadIsHd?: boolean;
}) {
  return (
    <div className="flex items-center gap-md">
      <button
        type="button"
        aria-label="Zoom in"
        className="focus-ring flex size-12 items-center justify-center rounded-full border border-ink-100 text-ink-700 hover:bg-surface-container-low"
      >
        <span className="material-symbols-outlined">zoom_in</span>
      </button>
      <button
        type="button"
        onClick={onRegenerate}
        disabled={disabled}
        className="focus-ring flex h-12 items-center gap-sm rounded-lg bg-brass-600 px-lg font-body-sm text-body-sm font-semibold text-on-primary transition-colors hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
          auto_fix_high
        </span>
        Regenerate this view
      </button>
      {downloadUrl ? (
        <a
          href={downloadUrl}
          download
          aria-label={downloadIsHd ? "Download HD render" : "Download render"}
          title={downloadIsHd ? "Download HD (2× upscaled) render" : "Download render"}
          className="focus-ring relative flex size-12 items-center justify-center rounded-full border border-ink-100 text-ink-700 hover:bg-surface-container-low"
        >
          <span className="material-symbols-outlined">download</span>
          {downloadIsHd && (
            <span className="absolute -right-1 -top-1 rounded-full bg-brass-600 px-1 text-[9px] font-semibold leading-4 text-on-primary">
              HD
            </span>
          )}
        </a>
      ) : (
        <button
          type="button"
          aria-label="Download render"
          disabled
          className="flex size-12 cursor-not-allowed items-center justify-center rounded-full border border-ink-100 text-ink-500 opacity-50"
        >
          <span className="material-symbols-outlined">download</span>
        </button>
      )}
    </div>
  );
}

function StatusRow({ lastRenderMs }: { lastRenderMs: number | null }) {
  const seconds = lastRenderMs ? Math.round(lastRenderMs / 1000) : null;
  return (
    <p className="label-caps text-on-surface-variant">
      4K render · {seconds ? `${seconds} sec` : "—"} · nano-banana
    </p>
  );
}

function ThumbStrip({
  list,
  currentIndex,
  onSelect,
  disabled,
}: {
  list: RenderItem[];
  currentIndex: number;
  onSelect: (i: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex w-full max-w-[720px] gap-sm overflow-x-auto pb-xs">
      {list.map((item, i) => {
        const active = i === currentIndex;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(i)}
            disabled={disabled}
            title={item.prompt}
            aria-pressed={active}
            className={cn(
              "shrink-0 overflow-hidden rounded transition-shadow",
              active ? "border-2 border-brass-600" : "border border-ink-100 opacity-70 hover:opacity-100",
              disabled && "cursor-not-allowed",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.imageUrl}
              alt={i === 0 ? "Original render" : `Tweak ${i}`}
              className="h-[66px] w-[100px] object-cover"
            />
          </button>
        );
      })}
    </div>
  );
}

function ChatInput({
  value,
  onChange,
  onSubmit,
  disabled,
  isGenerating,
  lastRenderMs,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  disabled: boolean;
  isGenerating: boolean;
  lastRenderMs: number | null;
}) {
  return (
    <div className="w-full max-w-[720px]">
      {!isGenerating && lastRenderMs != null && (
        <p className="mb-xs text-center font-body-sm text-body-sm italic text-on-surface-variant">
          Rendered in {Math.round(lastRenderMs / 1000)}s
        </p>
      )}
      <form
        onSubmit={onSubmit}
        className="flex h-14 items-center gap-sm rounded-lg border border-ink-100 bg-paper px-md focus-within:border-brass-600 focus-within:ring-1 focus-within:ring-brass-600"
      >
        <span
          className="material-symbols-outlined text-brass-600"
          aria-hidden="true"
        >
          auto_awesome
        </span>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder='Try: "warmer wood, less gold" or "add a reading nook"'
          className="h-full flex-1 bg-transparent font-body-sm text-body-sm text-ink-900 outline-none placeholder:text-ink-500"
        />
        <button
          type="submit"
          disabled={disabled || value.trim().length === 0}
          aria-label="Send tweak"
          className="focus-ring flex size-10 items-center justify-center rounded-full bg-brass-600 text-on-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[20px]">arrow_upward</span>
        </button>
      </form>
    </div>
  );
}

function CapBanner({
  onLock,
  onKeepIterating,
  locking,
  locked,
}: {
  onLock: () => void;
  onKeepIterating: () => void;
  locking: boolean;
  locked: boolean;
}) {
  return (
    <div className="w-full max-w-[720px] rounded-lg border border-brass-600/40 bg-primary-fixed/40 p-md text-center">
      <p className="mb-md font-body text-body-md text-ink-900">
        You&apos;ve iterated 4 times on this view — usually a good place to lock
        it. Want to render a different room?
      </p>
      <div className="flex flex-wrap items-center justify-center gap-md">
        <button
          type="button"
          onClick={onLock}
          disabled={locking || locked}
          className="focus-ring flex h-12 items-center gap-sm rounded-lg bg-brass-600 px-lg font-body-sm text-body-sm font-semibold text-on-primary transition-colors hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
            {locked ? "check" : "lock"}
          </span>
          {locked ? "View locked" : locking ? "Locking…" : "Lock this view"}
        </button>
        <button
          type="button"
          onClick={onKeepIterating}
          className="focus-ring flex h-12 items-center rounded-lg border border-ink-100 px-lg font-body-sm text-body-sm font-semibold text-ink-900 transition-colors hover:bg-surface-container-low"
        >
          Keep iterating
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Right column
// ---------------------------------------------------------------------------

function MaterialCard({
  material,
  onSwap,
}: {
  material: Material;
  onSwap: () => void;
}) {
  return (
    <li className="flex h-20 items-center gap-md rounded-lg border border-ink-100 bg-canvas p-sm">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={material.swatch_url}
        alt={`${material.name} swatch`}
        className="size-16 shrink-0 rounded-md object-cover"
        onError={(e) => {
          const el = e.currentTarget;
          el.style.background =
            "linear-gradient(135deg, #C9B79A 0%, #6B5B3E 100%)";
          el.removeAttribute("src");
        }}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-body-md text-body-md font-semibold text-ink-900">
          {material.name}
        </p>
        <p className="truncate font-body-sm text-body-sm text-on-surface-variant">
          {material.source} — {material.unit_label}
        </p>
      </div>
      <button
        type="button"
        onClick={onSwap}
        aria-label={`Swap ${material.name}`}
        className="focus-ring flex size-10 items-center justify-center rounded-full text-brass-600 hover:bg-surface-container-low"
      >
        <span className="material-symbols-outlined">swap_horiz</span>
      </button>
    </li>
  );
}

function SwapPanel({
  current,
  onPick,
}: {
  current: Material;
  onPick: (alt: Material) => void;
}) {
  return (
    <div>
      <DialogTitle className="mb-xs font-display text-headline-md text-ink-900">
        Swap {current.name}
      </DialogTitle>
      <DialogDescription className="mb-lg font-body text-body-md text-on-surface-variant">
        Three vetted alternates in the same finish family.
      </DialogDescription>
      <ul className="flex flex-col gap-md">
        {current.alternates.map((alt) => (
          <li key={alt.id}>
            <button
              type="button"
              onClick={() =>
                onPick({
                  id: alt.id,
                  name: alt.name,
                  source: alt.source,
                  unit_label: alt.unit_label,
                  swatch_url: alt.swatch_url,
                  alternates: current.alternates,
                })
              }
              className="focus-ring flex h-20 w-full items-center gap-md rounded-lg border border-ink-100 bg-canvas p-sm text-left transition-colors hover:bg-surface-container-low"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={alt.swatch_url}
                alt={`${alt.name} swatch`}
                className="size-16 shrink-0 rounded-md object-cover"
                onError={(e) => {
                  const el = e.currentTarget;
                  el.style.background =
                    "linear-gradient(135deg, #C9B79A 0%, #6B5B3E 100%)";
                  el.removeAttribute("src");
                }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-body-md text-body-md font-semibold text-ink-900">
                  {alt.name}
                </p>
                <p className="truncate font-body-sm text-body-sm text-on-surface-variant">
                  {alt.source} — {alt.unit_label}
                </p>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
