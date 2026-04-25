"use client";

import { useState } from "react";
import { Loader2, Send, Sparkles } from "lucide-react";

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
  rooms: RoomLite[];
  style: Style | null;
};

const FAKE_GENERATION_MS = 3000;

export function RenderInteractive({ rooms, style }: Props) {
  // Default selection: master bedroom if present, otherwise first room.
  const defaultSelectedId =
    rooms.find((r) => r.room_type === "master_bedroom")?.id ??
    rooms[0]?.id ??
    null;

  const [selectedId, setSelectedId] = useState<string | null>(defaultSelectedId);
  // Map of roomId → render placeholder marker. In a real implementation
  // this would be the URL returned by Replicate; for now any non-null
  // value means "this room has been rendered".
  const [renders, setRenders] = useState<Record<string, true>>({});
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [chat, setChat] = useState("");

  const selectedRoom = rooms.find((r) => r.id === selectedId) ?? null;
  const hasRender = selectedRoom ? renders[selectedRoom.id] === true : false;
  const isGeneratingThis =
    selectedRoom !== null && generatingId === selectedRoom.id;

  const handleGenerate = () => {
    if (!selectedRoom) return;
    const id = selectedRoom.id;
    setGeneratingId(id);
    setTimeout(() => {
      setRenders((prev) => ({ ...prev, [id]: true }));
      setGeneratingId((current) => (current === id ? null : current));
    }, FAKE_GENERATION_MS);
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
      <RoomList
        rooms={rooms}
        selectedId={selectedId}
        onSelect={setSelectedId}
        renders={renders}
      />
      <div className="flex flex-col gap-4">
        <RenderCanvas
          room={selectedRoom}
          style={style}
          rendered={hasRender}
          generating={isGeneratingThis}
          onGenerate={handleGenerate}
        />
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            // No-op for now; real flow lands tomorrow.
            setChat("");
          }}
        >
          <Input
            value={chat}
            onChange={(e) => setChat(e.target.value)}
            placeholder="Tell me how to change it…"
            disabled={!hasRender}
            className="flex-1 border-bg-border bg-bg-elevated text-text-primary placeholder:text-text-tertiary disabled:opacity-50"
          />
          <Button
            type="submit"
            size="lg"
            disabled={!hasRender || chat.trim().length === 0}
            className="shrink-0"
          >
            <Send />
            Send
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
  renders: Record<string, true>;
}) {
  return (
    <aside className="flex flex-col gap-2">
      <p className="px-1 text-xs uppercase tracking-widest text-text-tertiary">
        Rooms
      </p>
      <div className="flex flex-col gap-1.5">
        {rooms.map((room) => {
          const active = selectedId === room.id;
          const done = renders[room.id] === true;
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
  rendered,
  generating,
  onGenerate,
}: {
  room: RoomLite | null;
  style: Style | null;
  rendered: boolean;
  generating: boolean;
  onGenerate: () => void;
}) {
  if (!room) {
    return (
      <div className="flex aspect-[16/10] items-center justify-center rounded-xl border border-bg-border bg-bg-elevated/60 backdrop-blur-sm">
        <p className="text-sm text-text-tertiary">Select a room to render.</p>
      </div>
    );
  }

  const c1 = style?.palette[0] ?? "#1F1830";
  const c2 = style?.palette[1] ?? "#0B0712";

  return (
    <div className="overflow-hidden rounded-xl border border-bg-border bg-bg-elevated/60 backdrop-blur-sm">
      <div className="relative aspect-[16/10] w-full">
        {rendered ? (
          <div
            className="flex h-full w-full items-center justify-center"
            style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
          >
            <div className="text-center text-white">
              {style && (
                <p className="text-xs uppercase tracking-[0.2em] opacity-80">
                  {style.name_en}
                </p>
              )}
              <p className="mt-2 font-display text-3xl font-semibold tracking-tight">
                {room.name_en?.trim() || "Room"}
              </p>
              <p className="mt-1 text-xs opacity-60">
                Render placeholder · Replicate wires up tomorrow
              </p>
            </div>
          </div>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-5 px-6 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-brand-primary/15 text-brand-primary">
              <Sparkles className="size-6" />
            </div>
            <div>
              <p className="font-display text-xl font-semibold text-text-primary">
                Ready to render
              </p>
              <p className="mt-1 text-sm text-text-secondary">
                We'll generate a {style?.name_en ?? "default-style"} render of{" "}
                {room.name_en?.trim() || "this room"}.
              </p>
            </div>
            <Button
              size="lg"
              onClick={onGenerate}
              disabled={generating}
              className="min-w-[180px]"
            >
              {generating ? (
                <>
                  <Loader2 className="animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <Sparkles />
                  Generate render
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
