"use client";

// =============================================================================
// components/blueprint/design/ReferencesView.tsx — 02 Design · References
// (K8 #4, spec §6.3, Figma 56:434). Replaces /moodboard.
//
// "Your board": six slots — a pinned reference shows its order number, label
// and remove; an empty slot is a dashed control box ("Pin from below" — the
// absent/unpriced convention). Order matters (the first references weigh most
// in every render, B3), so the board reorders by drag AND by keyboard
// (Alt + arrow keys on a focused reference).
//
// The library below: a segmented source control (Direction library · Your
// renders · Upload — the same three sources the B2 builder had) and, for the
// library, a room filter built from the art that exists. A pinned reference
// shows a check, not a colour. Uploads go straight to Storage (H9) into the
// asset library as reference images; a refused upload is the inverse block
// with the H9 sentence.
// =============================================================================

import { useCallback, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";

import type { AssetLite } from "@/lib/assets/types";
import { compressImage, ImageProcessingError } from "@/lib/image/compress";
import { STYLE_ROOM_LABEL, type MoodboardItem, type StyleRoom } from "@/lib/moodboard/types";
import { UploadFailed, uploadFile } from "@/lib/uploads/client";

import { Icon } from "../Icon";
import { StateBlock } from "../StateBlock";

export type StyleOption = { style_key: string; style_name: string; room: StyleRoom; label: string; image_url: string };
export type RenderOption = { id: string; image_url: string; room_name: string | null };

/** The board's slots (spec §6.3: pin 3–6). */
export const BOARD_SLOTS = 6;

type Source = "style" | "renders" | "upload";

/** Room filter groups — "Bedroom" takes both bedroom images. */
const ROOM_GROUP: Record<StyleRoom, string> = { living: "Living", bedroom: "Bedroom", "secondary-bedroom": "Bedroom", bathroom: "Bath" };

function itemLabel(item: MoodboardItem, renders: RenderOption[], assets: AssetLite[]): string {
  if (item.kind === "style") return item.style_room ? STYLE_ROOM_LABEL[item.style_room as StyleRoom] ?? "Reference" : "Reference";
  if (item.kind === "render") {
    const room = renders.find((r) => r.id === item.render_id)?.room_name;
    return `Your render${room ? ` · ${room.toLowerCase()}` : ""}`;
  }
  return assets.find((a) => a.id === item.asset_id)?.filename ?? "Your upload";
}

export function ReferencesView(props: { projectId: string; initialItems: MoodboardItem[]; initialAssets: AssetLite[]; styleOptions: StyleOption[]; renderOptions: RenderOption[]; lockedStyleKey: string | null }) {
  const { projectId, styleOptions, renderOptions, lockedStyleKey } = props;
  const [items, setItems] = useState<MoodboardItem[]>(props.initialItems);
  const [assets, setAssets] = useState<AssetLite[]>(props.initialAssets);
  const [source, setSource] = useState<Source>("style");
  const [room, setRoom] = useState<string>("All");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; text: string } | null>(null);
  const [announce, setAnnounce] = useState("");
  const dragFrom = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const full = items.length >= BOARD_SLOTS;

  const pinnedStyle = useMemo(() => new Map(items.filter((i) => i.kind === "style").map((i) => [`${i.style_key}:${i.style_room}`, i.id])), [items]);
  const pinnedRender = useMemo(() => new Map(items.filter((i) => i.kind === "render").map((i) => [i.render_id, i.id])), [items]);
  const pinnedAsset = useMemo(() => new Map(items.filter((i) => i.kind === "asset").map((i) => [i.asset_id, i.id])), [items]);

  // The locked direction's art first — the references most likely wanted.
  const library = useMemo(() => {
    const sorted = lockedStyleKey ? [...styleOptions].sort((a, b) => Number(b.style_key === lockedStyleKey) - Number(a.style_key === lockedStyleKey)) : styleOptions;
    return room === "All" ? sorted : sorted.filter((o) => ROOM_GROUP[o.room] === room);
  }, [styleOptions, lockedStyleKey, room]);
  const rooms = useMemo(() => ["All", ...new Set(styleOptions.map((o) => ROOM_GROUP[o.room]))], [styleOptions]);

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/moodboard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId, ...body }) });
        const json = await res.json();
        if (!res.ok || json.error) throw new Error(json.error ?? "That reference wasn't pinned.");
        if (Array.isArray(json.items)) setItems(json.items);
        setAnnounce("Pinned to your board.");
      } catch (e) {
        setError({ title: "That reference wasn't pinned", text: e instanceof Error ? e.message : "Please try again." });
      } finally {
        setBusy(false);
      }
    },
    [projectId],
  );

  const remove = async (id: string) => {
    const prev = items;
    setItems((cur) => cur.filter((i) => i.id !== id));
    setError(null);
    try {
      const res = await fetch(`/api/moodboard?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Please try again.");
      setAnnounce("Removed from your board.");
    } catch (e) {
      setItems(prev);
      setError({ title: "That reference wasn't removed", text: e instanceof Error ? e.message : "Please try again." });
    }
  };

  const move = async (id: string, to: number) => {
    const from = items.findIndex((i) => i.id === id);
    if (from === -1 || to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    setItems(next);
    setAnnounce(`Moved to position ${to + 1} of ${next.length}.`);
    try {
      const res = await fetch("/api/moodboard", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId, id, to_index: to }) });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? "Please try again.");
      if (Array.isArray(json.items)) setItems(json.items);
    } catch (e) {
      setItems(items);
      setError({ title: "The new order wasn't saved", text: e instanceof Error ? e.message : "Please try again." });
    }
  };

  const onKey = (e: KeyboardEvent<HTMLLIElement>, id: string, idx: number) => {
    if (!e.altKey) return;
    const d = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : 0;
    if (!d) return;
    e.preventDefault();
    void move(id, idx + d);
    // Keep focus on the moved reference.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-board-item="${id}"]`)?.focus());
  };

  const toggle = (pinnedId: string | undefined, body: Record<string, unknown>) => {
    if (pinnedId) return void remove(pinnedId);
    if (full || busy) return;
    void post(body);
  };

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      let toUpload = file;
      try {
        toUpload = (await compressImage(file)).file;
      } catch (err) {
        setError({ title: "That image can't be used", text: err instanceof ImageProcessingError ? err.message : "We couldn't read that image. Please try a JPG or PNG." });
        return;
      }
      // H9: straight to Storage, then verified + registered (lib/uploads/client.ts).
      const json = await uploadFile<{ asset_id?: string; public_url?: string }>(toUpload, { kind: "project_asset", projectId, assetKind: "reference_image" }, { asset_kind: "reference_image", source: "moodboard", filename: file.name });
      if (!json?.asset_id) throw new UploadFailed("upload_failed", "project_asset", "The upload didn't complete. Please try again.");
      setAssets((cur) => [{ id: json.asset_id!, kind: "reference_image", url: json.public_url ?? "", filename: file.name, room_id: null, bytes: toUpload.size }, ...cur]);
      if (!full) await post({ kind: "asset", asset_id: json.asset_id });
    } catch (e) {
      setError({ title: "The upload didn't work", text: e instanceof Error ? e.message : "Please try again." });
    } finally {
      setBusy(false);
    }
  };

  const slots = Math.max(BOARD_SLOTS, items.length);

  return (
    <div>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      {/* Your board */}
      <section aria-labelledby="board-h">
        <div className="flex flex-wrap items-baseline gap-x-4">
          <h2 id="board-h" className="t-heading-md flex-1 text-bp-ink-primary">
            Your board
          </h2>
          <p className="t-label-md font-bp-mono text-bp-ink-tertiary" id="board-help">
            {items.length} of {BOARD_SLOTS} · drag or Alt + arrows to reorder — first is weighted most
          </p>
        </div>
        <ol className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6" aria-describedby="board-help">
          {Array.from({ length: slots }, (_, idx) => {
            const item = items[idx];
            if (!item) {
              return (
                <li key={`empty-${idx}`} aria-hidden="true" className="flex aspect-[3/2] flex-col items-center justify-center gap-1 border border-dashed border-bp-line-control text-bp-ink-tertiary">
                  <Icon name="add" className="text-[20px]" />
                  <span className="t-body-sm">Pin from below</span>
                </li>
              );
            }
            const label = itemLabel(item, renderOptions, assets);
            return (
              <li
                key={item.id}
                tabIndex={0}
                draggable
                data-board-item={item.id}
                aria-label={`${idx + 1}. ${label}`}
                onKeyDown={(e) => onKey(e, item.id, idx)}
                onDragStart={() => (dragFrom.current = item.id)}
                onDragOver={(e: DragEvent) => e.preventDefault()}
                onDrop={(e: DragEvent) => {
                  e.preventDefault();
                  if (dragFrom.current) void move(dragFrom.current, idx);
                  dragFrom.current = null;
                }}
                className="cursor-grab outline-offset-2"
              >
                {item.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a stored reference image
                  <img src={item.image_url} alt="" className="aspect-[3/2] w-full border border-bp-line-hairline object-cover" loading="lazy" draggable={false} />
                ) : (
                  <span className="flex aspect-[3/2] w-full items-center justify-center border border-bp-line-hairline bg-bp-surface-sunken text-bp-ink-tertiary">
                    <Icon name="broken_image" className="text-[20px]" />
                  </span>
                )}
                <div className="mt-1.5 flex items-start gap-2">
                  <span className="t-label-md font-bp-mono text-bp-ink-tertiary">{String(idx + 1).padStart(2, "0")}</span>
                  <span className="t-body-sm min-w-0 flex-1 text-bp-ink-primary">{label}</span>
                  <button type="button" onClick={() => void remove(item.id)} aria-label={`Remove ${label} from your board`} className="flex h-6 w-6 items-center justify-center text-bp-ink-secondary hover:text-bp-ink-primary">
                    <Icon name="close" className="text-[18px]" />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {error ? (
        <div className="mt-6 max-w-[720px]">
          <StateBlock kind="error" title={error.title} afterUserAction>
            {error.text}
          </StateBlock>
        </div>
      ) : null}

      {/* The library */}
      <section aria-label="Find references" className="mt-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div role="group" aria-label="Where the references come from" className="inline-flex border border-bp-line-control">
            {(
              [
                ["style", "Direction library"],
                ["renders", `Your renders · ${renderOptions.length}`],
                ["upload", "Upload"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={source === key}
                onClick={() => setSource(key)}
                className={`t-body-sm min-h-9 px-3.5 ${source === key ? "bg-bp-ink-primary text-bp-ink-on-inverse" : "text-bp-ink-primary hover:bg-bp-surface-sunken"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {source === "style" ? (
            <div role="group" aria-label="Room" className="flex items-center gap-4">
              <span className="t-label-caps text-bp-ink-tertiary">ROOM</span>
              {rooms.map((r) => (
                <button key={r} type="button" aria-pressed={room === r} onClick={() => setRoom(r)} className={`t-body-sm min-h-9 ${room === r ? "t-nav-item-active text-bp-ink-primary" : "text-bp-ink-secondary hover:text-bp-ink-primary"}`}>
                  {r}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {full ? (
          <p className="t-body-sm mt-3 text-bp-ink-secondary" id="board-full">
            Your board holds {BOARD_SLOTS} — remove one to pin another.
          </p>
        ) : null}

        {source === "style" ? (
          <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
            {library.map((o) => {
              const pinned = pinnedStyle.get(`${o.style_key}:${o.room}`);
              return (
                <li key={`${o.style_key}-${o.room}`}>
                  <LibraryTile image={o.image_url} eyebrow={o.style_name} label={STYLE_ROOM_LABEL[o.room]} pinned={!!pinned} full={full} busy={busy} onToggle={() => toggle(pinned, { kind: "style", style_key: o.style_key, style_room: o.room })} />
                </li>
              );
            })}
          </ul>
        ) : null}

        {source === "renders" ? (
          renderOptions.length === 0 ? (
            <div className="mt-4 max-w-[720px]">
              <StateBlock kind="empty" icon="photo_library" title="No renders yet">
                Once a room is rendered you can pin it here as a reference for the rest of the villa.
              </StateBlock>
            </div>
          ) : (
            <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
              {renderOptions.map((r) => {
                const pinned = pinnedRender.get(r.id);
                return (
                  <li key={r.id}>
                    <LibraryTile image={r.image_url} eyebrow="YOUR RENDER" label={r.room_name ?? "Render"} pinned={!!pinned} full={full} busy={busy} onToggle={() => toggle(pinned, { kind: "render", render_id: r.id })} />
                  </li>
                );
              })}
            </ul>
          )
        ) : null}

        {source === "upload" ? (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) void upload(f);
              }}
              disabled={busy}
              className="flex w-full max-w-[720px] flex-col items-center justify-center gap-1 border border-dashed border-bp-line-control px-6 py-8 text-bp-ink-secondary hover:bg-bp-surface-raised"
            >
              <Icon name="upload" className="text-[20px]" />
              <span className="t-body-sm text-bp-ink-primary">{busy ? "Uploading…" : "Drop an image here, or choose one"}</span>
              <span className="t-label-md font-bp-mono text-bp-ink-tertiary">JPG or PNG · kept in your project files</span>
            </button>
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/heic,image/heif" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void upload(f);
            }} />
            {assets.length ? (
              <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
                {assets.map((a) => {
                  const pinned = pinnedAsset.get(a.id);
                  return (
                    <li key={a.id}>
                      <LibraryTile image={a.url} eyebrow="YOUR UPLOAD" label={a.filename ?? "Image"} pinned={!!pinned} full={full} busy={busy} onToggle={() => toggle(pinned, { kind: "asset", asset_id: a.id })} />
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function LibraryTile({ image, eyebrow, label, pinned, full, busy, onToggle }: { image: string; eyebrow: string; label: string; pinned: boolean; full: boolean; busy: boolean; onToggle: () => void }) {
  const blocked = !pinned && full;
  return (
    <button
      type="button"
      aria-pressed={pinned}
      aria-disabled={blocked || busy ? true : undefined}
      aria-describedby={blocked ? "board-full" : undefined}
      onClick={onToggle}
      aria-label={`${eyebrow.toLowerCase()} — ${label}: ${pinned ? "pinned, press to remove" : "pin to your board"}`}
      className="group block w-full text-left outline-offset-2"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- static art or a stored image */}
      <img src={image} alt="" className="aspect-[3/2] w-full border border-bp-line-hairline object-cover group-hover:opacity-90" loading="lazy" />
      <span className="mt-1.5 flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className="t-label-caps block truncate text-bp-ink-secondary">{eyebrow}</span>
          <span className="t-body-sm block truncate text-bp-ink-primary">{label}</span>
        </span>
        <Icon name={pinned ? "check" : "push_pin"} className={`text-[20px] ${pinned ? "text-bp-ink-primary" : blocked ? "text-bp-ink-tertiary" : "text-bp-ink-secondary"}`} />
      </span>
    </button>
  );
}
