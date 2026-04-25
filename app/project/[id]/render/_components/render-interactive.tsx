"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ChevronDown,
  Loader2,
  RotateCcw,
  Send,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
};

type RenderResult = { imageUrl: string; prompt: string };

type RenderResponse = {
  render_id: string;
  image_url: string;
  prompt: string;
};

const TIPS = [
  "Mixing the paint",
  "Placing the light fixtures",
  "Rolling out the rug",
  "Adjusting the throw pillow",
  "Telling the cat to leave",
] as const;
const TIP_INTERVAL_MS = 6000;

// Default selection: first bedroom-type room (master first, then secondary).
function pickDefaultRoomId(rooms: RoomLite[]): string | null {
  return (
    rooms.find((r) => r.room_type === "master_bedroom")?.id ??
    rooms.find((r) => r.room_type === "bedroom")?.id ??
    rooms[0]?.id ??
    null
  );
}

export function RenderInteractive({ projectId, rooms, style }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    pickDefaultRoomId(rooms),
  );
  const [renders, setRenders] = useState<Record<string, RenderResult>>({});
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chat, setChat] = useState("");
  const [tipIndex, setTipIndex] = useState(0);
  const [promptExpanded, setPromptExpanded] = useState(false);

  const selectedRoom = rooms.find((r) => r.id === selectedId) ?? null;
  const result = selectedRoom ? (renders[selectedRoom.id] ?? null) : null;
  const isGeneratingThis =
    selectedRoom !== null && generatingId === selectedRoom.id;

  // Rotate the humorous tip while a render is in flight.
  useEffect(() => {
    if (!generatingId) return;
    setTipIndex(0);
    const interval = setInterval(() => {
      setTipIndex((i) => (i + 1) % TIPS.length);
    }, TIP_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [generatingId]);

  // Reset the prompt expansion when the selection or render changes.
  useEffect(() => {
    setPromptExpanded(false);
  }, [selectedId, result?.imageUrl]);

  const callRender = async (
    roomId: string,
    tweak?: string,
  ): Promise<RenderResponse> => {
    const res = await fetch("/api/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: projectId,
        room_id: roomId,
        ...(tweak ? { tweak } : {}),
      }),
    });
    const body = (await res.json().catch(() => null)) as
      | RenderResponse
      | { error?: string }
      | null;
    if (!res.ok || !body || !("image_url" in body)) {
      const msg =
        body && typeof body === "object" && "error" in body && body.error
          ? body.error
          : `Render failed (${res.status}).`;
      throw new Error(msg);
    }
    return body;
  };

  const runRender = async (roomId: string, tweak?: string) => {
    setGeneratingId(roomId);
    setError(null);
    try {
      const result = await callRender(roomId, tweak);
      setRenders((prev) => ({
        ...prev,
        [roomId]: { imageUrl: result.image_url, prompt: result.prompt },
      }));
    } catch (err) {
      console.error("[render] error", err);
      setError(err instanceof Error ? err.message : "Render failed.");
    } finally {
      setGeneratingId((current) => (current === roomId ? null : current));
    }
  };

  const handleGenerate = () => {
    if (!selectedRoom) return;
    void runRender(selectedRoom.id);
  };

  const handleRetry = () => {
    if (!selectedRoom) return;
    void runRender(selectedRoom.id);
  };

  const handleSendTweak = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRoom) return;
    const tweak = chat.trim();
    if (!tweak) return;
    setChat("");
    void runRender(selectedRoom.id, tweak);
  };

  const hasRender = result !== null;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
      <RoomList
        rooms={rooms}
        selectedId={selectedId}
        onSelect={(id) => {
          setSelectedId(id);
          setError(null);
        }}
        renders={renders}
      />
      <div className="flex flex-col gap-4">
        <RenderCanvas
          room={selectedRoom}
          style={style}
          result={result}
          generating={isGeneratingThis}
          error={error}
          tipIndex={tipIndex}
          onGenerate={handleGenerate}
          onRetry={handleRetry}
        />

        {result && (
          <PromptToggle
            prompt={result.prompt}
            expanded={promptExpanded}
            onToggle={() => setPromptExpanded((e) => !e)}
          />
        )}

        <form className="flex items-center gap-2" onSubmit={handleSendTweak}>
          <Input
            value={chat}
            onChange={(e) => setChat(e.target.value)}
            placeholder="Tell me how to change it…"
            disabled={!hasRender || isGeneratingThis}
            className="flex-1 border-bg-border bg-bg-elevated text-text-primary placeholder:text-text-tertiary disabled:opacity-50"
          />
          <Button
            type="submit"
            size="lg"
            disabled={
              !hasRender || isGeneratingThis || chat.trim().length === 0
            }
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
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function RoomList({
  rooms,
  selectedId,
  onSelect,
  renders,
}: {
  rooms: RoomLite[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  renders: Record<string, RenderResult>;
}) {
  return (
    <aside className="flex flex-col gap-2">
      <p className="px-1 text-xs uppercase tracking-widest text-text-tertiary">
        Rooms
      </p>
      <div className="flex flex-col gap-1.5">
        {rooms.map((room) => {
          const active = selectedId === room.id;
          const done = renders[room.id] !== undefined;
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
  result,
  generating,
  error,
  tipIndex,
  onGenerate,
  onRetry,
}: {
  room: RoomLite | null;
  style: Style | null;
  result: RenderResult | null;
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
        {generating ? (
          <GeneratingState tipIndex={tipIndex} />
        ) : error ? (
          <ErrorState onRetry={onRetry} />
        ) : result ? (
          <motion.img
            key={result.imageUrl}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            src={result.imageUrl}
            alt={`${style?.name_en ?? "Style"} render of ${room.name_en?.trim() || "room"}`}
            className="h-full w-full object-cover"
          />
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
