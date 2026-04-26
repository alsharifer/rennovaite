"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  Loader2,
  RotateCcw,
  Send,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { Style } from "@/lib/styles";

type RoomLite = {
  id: string;
  name_en: string | null;
  room_type: string | null;
  area_m2: number | null;
};

type Props = {
  projectId: string;
  rooms: RoomLite[];
  style: Style | null;
  initialChains?: Record<string, RenderItem[]>;
};

// One render in the timeline. index 0 is the original; subsequent items are
// tweaks. The list is mutated by truncate-then-append when the user tweaks
// from a non-tip thumbnail (Notion / Figma version-history pattern).
type RenderItem = {
  id: string;
  imageUrl: string;
  prompt: string;
};

type RoomState = {
  list: RenderItem[];
  currentIndex: number;
};

type GenerateResponse = {
  render_id: string;
  image_url: string;
  prompt: string;
};

type IterateResponse = GenerateResponse;

const MAX_TWEAKS = 4;
const TIPS = [
  "Mixing the paint",
  "Placing the light fixtures",
  "Rolling out the rug",
  "Adjusting the throw pillow",
  "Telling the cat to leave",
] as const;
const TIP_INTERVAL_MS = 6000;
const PROGRESS_TARGET_MS = 30_000;

function pickDefaultRoomId(rooms: RoomLite[]): string | null {
  return (
    rooms.find((r) => r.room_type === "master_bedroom")?.id ??
    rooms.find((r) => r.room_type === "bedroom")?.id ??
    rooms[0]?.id ??
    null
  );
}

export function RenderInteractive({
  projectId,
  rooms,
  style,
  initialChains,
}: Props) {
  const router = useRouter();

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
  const [tipIndex, setTipIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [approving, setApproving] = useState(false);

  const selectedRoom = rooms.find((r) => r.id === selectedId) ?? null;
  const roomState = selectedRoom
    ? (stateByRoom[selectedRoom.id] ?? null)
    : null;
  const currentRender = roomState
    ? (roomState.list[roomState.currentIndex] ?? null)
    : null;
  const tweakCount = roomState ? roomState.list.length - 1 : 0;
  const atCap = tweakCount >= MAX_TWEAKS;
  const hasRender = currentRender !== null;
  const isGeneratingThis =
    selectedRoom !== null && generatingId === selectedRoom.id;
  const inputDisabled = !hasRender || atCap || isGeneratingThis;

  // Rotate the humorous tip while a render is in flight.
  useEffect(() => {
    if (!generatingId) return;
    setTipIndex(0);
    const interval = setInterval(() => {
      setTipIndex((i) => (i + 1) % TIPS.length);
    }, TIP_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [generatingId]);

  // Animate the progress bar 0 → 95% over PROGRESS_TARGET_MS while
  // generating. Stays at 95% if the call runs longer than expected.
  useEffect(() => {
    if (!generatingId) {
      setProgress(0);
      return;
    }
    setProgress(0);
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      setProgress(Math.min(95, (elapsed / PROGRESS_TARGET_MS) * 95));
    }, 200);
    return () => clearInterval(interval);
  }, [generatingId]);

  // Collapse the prompt toggle when the displayed render changes.
  useEffect(() => {
    setPromptExpanded(false);
  }, [currentRender?.id]);

  const callGenerate = async (roomId: string): Promise<GenerateResponse> => {
    const res = await fetch("/api/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId, room_id: roomId }),
    });
    const body = (await res.json().catch(() => null)) as
      | GenerateResponse
      | { error?: string }
      | null;
    if (!res.ok || !body || !("image_url" in body)) {
      throw new Error(
        (body && typeof body === "object" && "error" in body && body.error) ||
          `Render failed (${res.status}).`,
      );
    }
    return body;
  };

  const callIterate = async (
    roomId: string,
    parentRenderId: string,
    tweak: string,
  ): Promise<IterateResponse> => {
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
    const body = (await res.json().catch(() => null)) as
      | IterateResponse
      | { error?: string }
      | null;
    if (!res.ok || !body || !("image_url" in body)) {
      throw new Error(
        (body && typeof body === "object" && "error" in body && body.error) ||
          `Iteration failed (${res.status}).`,
      );
    }
    return body;
  };

  const handleGenerate = async () => {
    if (!selectedRoom) return;
    const id = selectedRoom.id;
    setGeneratingId(id);
    setError(null);
    try {
      const result = await callGenerate(id);
      const item: RenderItem = {
        id: result.render_id,
        imageUrl: result.image_url,
        prompt: result.prompt,
      };
      setStateByRoom((prev) => ({
        ...prev,
        [id]: { list: [item], currentIndex: 0 },
      }));
    } catch (err) {
      console.error("[render] generate error", err);
      setError(err instanceof Error ? err.message : "Render failed.");
    } finally {
      setGeneratingId((current) => (current === id ? null : current));
    }
  };

  const handleSendTweak = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRoom || !currentRender || atCap) return;
    const tweak = chat.trim();
    if (!tweak) return;
    const id = selectedRoom.id;
    const parent = currentRender;
    setChat("");
    setGeneratingId(id);
    setError(null);
    try {
      const result = await callIterate(id, parent.id, tweak);
      const item: RenderItem = {
        id: result.render_id,
        imageUrl: result.image_url,
        prompt: result.prompt,
      };
      // Truncate at the current viewing position, then append. This means
      // tweaking off a thumbnail mid-history starts a new branch from there
      // and discards anything later in the previous chain.
      setStateByRoom((prev) => {
        const current = prev[id];
        if (!current) return prev;
        const truncated = current.list.slice(0, current.currentIndex + 1);
        const nextList = [...truncated, item];
        return {
          ...prev,
          [id]: { list: nextList, currentIndex: nextList.length - 1 },
        };
      });
    } catch (err) {
      console.error("[render] iterate error", err);
      setError(err instanceof Error ? err.message : "Iteration failed.");
    } finally {
      setGeneratingId((current) => (current === id ? null : current));
    }
  };

  const handleReset = () => {
    if (!selectedRoom || !roomState || roomState.list.length === 0) return;
    setStateByRoom((prev) => ({
      ...prev,
      [selectedRoom.id]: {
        list: [roomState.list[0]],
        currentIndex: 0,
      },
    }));
    setError(null);
  };

  const setCurrentIndex = (idx: number) => {
    if (!selectedRoom) return;
    setStateByRoom((prev) => {
      const current = prev[selectedRoom.id];
      if (!current) return prev;
      return { ...prev, [selectedRoom.id]: { ...current, currentIndex: idx } };
    });
    setError(null);
  };

  const handleApprove = async () => {
    if (!selectedRoom || !currentRender) return;
    setApproving(true);
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
        | { id?: string; error?: string }
        | null;
      if (!res.ok || !body?.id) {
        throw new Error(
          (body && typeof body === "object" && "error" in body && body.error) ||
            `Approve failed (${res.status}).`,
        );
      }
      router.push(`/project/${projectId}/boq`);
    } catch (err) {
      console.error("[render] approve error", err);
      setApproving(false);
      setError(err instanceof Error ? err.message : "Approve failed.");
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
      <RoomList
        rooms={rooms}
        selectedId={selectedId}
        onSelect={(id) => {
          setSelectedId(id);
          setError(null);
        }}
        stateByRoom={stateByRoom}
      />
      <div className="flex flex-col gap-4">
        <RenderCanvas
          room={selectedRoom}
          style={style}
          render={currentRender}
          generating={isGeneratingThis && !hasRender}
          error={error && !hasRender ? error : null}
          tipIndex={tipIndex}
          onGenerate={handleGenerate}
          onRetry={handleGenerate}
        />

        {(isGeneratingThis || error) && hasRender && (
          <div className="space-y-2">
            {isGeneratingThis && (
              <div className="space-y-1">
                <Progress value={progress} className="h-1" />
                <p className="text-xs text-text-tertiary">
                  Rendering…{" "}
                  <AnimatePresence mode="wait">
                    <motion.span
                      key={tipIndex}
                      initial={{ opacity: 0, y: 2 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -2 }}
                      transition={{ duration: 0.3, ease: "easeOut" }}
                      className="inline-block"
                    >
                      {TIPS[tipIndex]}…
                    </motion.span>
                  </AnimatePresence>
                </p>
              </div>
            )}
            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-status-error/40 bg-status-error/10 px-3 py-2 text-xs text-status-error">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span className="min-w-0 break-words">{error}</span>
              </div>
            )}
          </div>
        )}

        {roomState && roomState.list.length > 0 && (
          <ThumbnailStrip
            list={roomState.list}
            currentIndex={roomState.currentIndex}
            onSelect={setCurrentIndex}
            disabled={isGeneratingThis}
          />
        )}

        {roomState && roomState.list.length > 0 && (
          <div className="flex items-center justify-between text-xs">
            <span
              className={cn(
                "text-text-tertiary",
                atCap && "text-status-warning",
              )}
            >
              {tweakCount === 0
                ? "Original"
                : `Tweak ${tweakCount} of ${MAX_TWEAKS}`}
              {atCap && " — limit reached"}
            </span>
            {tweakCount > 0 && (
              <button
                type="button"
                onClick={handleReset}
                disabled={isGeneratingThis}
                className="inline-flex items-center gap-1 text-text-tertiary transition-colors hover:text-text-secondary disabled:opacity-50"
              >
                <RotateCcw className="size-3" />
                Reset to original
              </button>
            )}
          </div>
        )}

        {currentRender && (
          <PromptToggle
            prompt={currentRender.prompt}
            expanded={promptExpanded}
            onToggle={() => setPromptExpanded((e) => !e)}
          />
        )}

        <form className="flex items-center gap-2" onSubmit={handleSendTweak}>
          <Input
            value={chat}
            onChange={(e) => setChat(e.target.value)}
            placeholder={
              atCap
                ? "Limit reached — click Reset to start over"
                : "Tell me how to change it…"
            }
            disabled={inputDisabled}
            className="flex-1 border-bg-border bg-bg-elevated text-text-primary placeholder:text-text-tertiary disabled:opacity-50"
            aria-label="Tweak the render"
          />
          <Button
            type="submit"
            size="lg"
            disabled={inputDisabled || chat.trim().length === 0}
            className="shrink-0"
          >
            {isGeneratingThis ? (
              <>
                <Loader2 className="animate-spin" />
                Sending…
              </>
            ) : (
              <>
                <Send />
                Send
              </>
            )}
          </Button>
        </form>

        <div className="mt-2 flex justify-end border-t border-bg-border pt-4">
          <Button
            type="button"
            size="lg"
            onClick={handleApprove}
            disabled={!hasRender || approving || isGeneratingThis}
          >
            {approving ? (
              <>
                <Loader2 className="animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Check />
                Approve &amp; continue
                <ArrowRight />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function RoomList({
  rooms,
  selectedId,
  onSelect,
  stateByRoom,
}: {
  rooms: RoomLite[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  stateByRoom: Record<string, RoomState>;
}) {
  return (
    <aside className="flex flex-col gap-2">
      <p className="px-1 text-xs uppercase tracking-widest text-text-tertiary">
        Rooms
      </p>
      <div className="flex flex-col gap-1.5">
        {rooms.map((room) => {
          const active = selectedId === room.id;
          const done = (stateByRoom[room.id]?.list.length ?? 0) > 0;
          return (
            <button
              key={room.id}
              type="button"
              onClick={() => onSelect(room.id)}
              className={cn(
                "flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-all",
                "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-primary/30",
                active
                  ? "border-brand-primary/60 bg-brand-primary/10 text-text-primary shadow-[0_0_24px_-12px_rgba(168,85,247,0.55)]"
                  : "border-bg-border bg-bg-elevated/60 text-text-secondary hover:border-bg-border hover:bg-bg-elevated/80 hover:text-text-primary",
              )}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {room.name_en?.trim() || "Room"}
                </p>
                {typeof room.area_m2 === "number" && (
                  <p className="text-xs text-text-tertiary">
                    {Math.round(room.area_m2 * 10) / 10} m²
                  </p>
                )}
              </div>
              {done && (
                <span className="text-xs font-medium text-status-success">
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------

function RenderCanvas({
  room,
  style,
  render,
  generating,
  error,
  tipIndex,
  onGenerate,
  onRetry,
}: {
  room: RoomLite | null;
  style: Style | null;
  render: RenderItem | null;
  generating: boolean;
  error: string | null;
  tipIndex: number;
  onGenerate: () => void;
  onRetry: () => void;
}) {
  if (!room) {
    return (
      <div className="flex aspect-[16/10] items-center justify-center rounded-xl border border-bg-border bg-bg-elevated/60 backdrop-blur-sm">
        <p className="text-sm text-text-tertiary">Select a room to render.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-bg-border bg-bg-elevated/60 backdrop-blur-sm">
      <div className="relative aspect-[16/10] w-full">
        {render ? (
          // The render is shown even when generating a follow-up. The
          // progress bar below the canvas signals the in-flight tweak.
          // eslint-disable-next-line jsx-a11y/alt-text
          <motion.img
            key={render.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            src={render.imageUrl}
            alt={`${style?.name_en ?? "Style"} render of ${room.name_en?.trim() || "room"}`}
            className="h-full w-full object-cover"
          />
        ) : generating ? (
          <GeneratingState tipIndex={tipIndex} />
        ) : error ? (
          <ErrorState onRetry={onRetry} />
        ) : (
          <ReadyState
            roomName={room.name_en?.trim() || "this room"}
            styleName={style?.name_en ?? "default-style"}
            onGenerate={onGenerate}
          />
        )}
      </div>
    </div>
  );
}

function GeneratingState({ tipIndex }: { tipIndex: number }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-5 px-6 text-center">
      <Loader2 className="size-10 animate-spin text-brand-primary" />
      <div>
        <p className="font-display text-xl font-semibold text-text-primary">
          Rendering… (this takes 30 seconds)
        </p>
        <div className="mt-2 h-5 text-sm text-text-secondary">
          <AnimatePresence mode="wait">
            <motion.span
              key={tipIndex}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="inline-block"
            >
              {TIPS[tipIndex]}…
            </motion.span>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-status-warning/15 text-status-warning">
        <AlertTriangle className="size-6" />
      </div>
      <p className="font-display text-xl font-semibold text-text-primary">
        We couldn&rsquo;t render that one. Try again?
      </p>
      <Button size="lg" onClick={onRetry} className="min-w-[160px]">
        <RotateCcw />
        Retry
      </Button>
    </div>
  );
}

function ReadyState({
  roomName,
  styleName,
  onGenerate,
}: {
  roomName: string;
  styleName: string;
  onGenerate: () => void;
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-brand-primary/15 text-brand-primary">
        <Sparkles className="size-6" />
      </div>
      <div>
        <p className="font-display text-xl font-semibold text-text-primary">
          Ready to render
        </p>
        <p className="mt-1 text-sm text-text-secondary">
          We&rsquo;ll generate a {styleName} render of {roomName}.
        </p>
      </div>
      <Button size="lg" onClick={onGenerate} className="min-w-[180px]">
        <Sparkles />
        Generate render
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ThumbnailStrip({
  list,
  currentIndex,
  onSelect,
  disabled,
}: {
  list: RenderItem[];
  currentIndex: number;
  onSelect: (idx: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {list.map((item, i) => {
        const active = i === currentIndex;
        const label = i === 0 ? "Original" : `Tweak ${i}`;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(i)}
            disabled={disabled}
            className={cn(
              "flex shrink-0 flex-col items-center gap-1 rounded-md p-1 transition-opacity",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40",
              !active && "opacity-60 hover:opacity-100",
              disabled && "cursor-not-allowed",
            )}
            aria-pressed={active}
            aria-label={`View ${label}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.imageUrl}
              alt={label}
              className={cn(
                "h-12 w-20 rounded-md border object-cover transition-shadow",
                active
                  ? "border-brand-primary ring-2 ring-brand-primary/40"
                  : "border-bg-border",
              )}
            />
            <span
              className={cn(
                "text-[10px] font-medium",
                active ? "text-text-primary" : "text-text-tertiary",
              )}
            >
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------

function PromptToggle({
  prompt,
  expanded,
  onToggle,
}: {
  prompt: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="text-xs text-text-tertiary">
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex items-center gap-1 rounded-md text-text-tertiary transition-colors hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/30"
      >
        <ChevronDown
          className={cn(
            "size-3.5 transition-transform duration-200",
            expanded && "rotate-180",
          )}
        />
        {expanded ? "Hide prompt" : "Show prompt"}
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="mt-2 leading-relaxed"
          >
            {prompt}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
