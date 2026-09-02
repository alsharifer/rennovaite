"use client";

// =============================================================================
// moodboard-builder.tsx — B2. Three sources of reference in one board:
//   · the style system's built-in art
//   · renders already generated for this project
//   · the user's own uploads, through the Sprint-1 AssetPicker
//     (kind `reference_image`, straight into the project asset library)
//
// Add / remove / reorder, persisted per project on every change. The board is
// what B3 feeds to the render pipeline, so order matters: the first few items
// are the ones that actually condition a render.
// =============================================================================

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { AssetPicker } from "@/components/assets/AssetPicker";
import { compressImage, ImageProcessingError } from "@/lib/image/compress";
import type { AssetLite } from "@/lib/assets/types";
import {
  STYLE_ROOM_LABEL,
  descriptorFor,
  type MoodboardItem,
  type StyleRoom,
} from "@/lib/moodboard/types";
import { cn } from "@/lib/utils";

type StyleOption = {
  style_key: string;
  style_name: string;
  room: StyleRoom;
  label: string;
  image_url: string;
};

type RenderOption = { id: string; image_url: string; room_name: string | null };

type Props = {
  projectId: string;
  initialItems: MoodboardItem[];
  initialAssets: AssetLite[];
  styleOptions: StyleOption[];
  renderOptions: RenderOption[];
  /** Style the project has locked, so its art can be offered first. */
  lockedStyleKey: string | null;
  nextHref: string;
  nextLabel: string;
  /** true when taste-seeding is on, so we can say the board actually matters. */
  tasteSeedOn: boolean;
};

type Source = "style" | "renders" | "upload";

export function MoodboardBuilder({
  projectId,
  initialItems,
  initialAssets,
  styleOptions,
  renderOptions,
  lockedStyleKey,
  nextHref,
  nextLabel,
  tasteSeedOn,
}: Props) {
  const [items, setItems] = useState<MoodboardItem[]>(initialItems);
  const [assets, setAssets] = useState<AssetLite[]>(initialAssets);
  const [source, setSource] = useState<Source>("style");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usedStyleImages = useMemo(
    () => new Set(items.filter((i) => i.kind === "style").map((i) => `${i.style_key}:${i.style_room}`)),
    [items],
  );
  const usedAssetIds = useMemo(
    () => new Set(items.filter((i) => i.kind === "asset").map((i) => i.asset_id)),
    [items],
  );
  const usedRenderIds = useMemo(
    () => new Set(items.filter((i) => i.kind === "render").map((i) => i.render_id)),
    [items],
  );

  // The locked style's art first — it is the most likely thing to want.
  const orderedStyleOptions = useMemo(() => {
    if (!lockedStyleKey) return styleOptions;
    return [...styleOptions].sort(
      (a, b) =>
        Number(b.style_key === lockedStyleKey) - Number(a.style_key === lockedStyleKey),
    );
  }, [styleOptions, lockedStyleKey]);

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/moodboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_id: projectId, ...body }),
        });
        const json = await res.json();
        if (!res.ok || json.error) throw new Error(json.error ?? "Couldn't add that.");
        if (Array.isArray(json.items)) setItems(json.items);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't add that.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [projectId],
  );

  const remove = async (id: string) => {
    const prev = items;
    setItems((cur) => cur.filter((i) => i.id !== id));
    try {
      const res = await fetch(`/api/moodboard?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Remove failed.");
    } catch (e) {
      setItems(prev);
      setError(e instanceof Error ? e.message : "Remove failed.");
    }
  };

  const move = async (id: string, toIndex: number) => {
    if (toIndex < 0 || toIndex >= items.length) return;
    // Optimistic local reorder so the grid doesn't wait on the round-trip.
    const from = items.findIndex((i) => i.id === id);
    if (from === -1 || from === toIndex) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(toIndex, 0, moved!);
    setItems(next);
    try {
      const res = await fetch("/api/moodboard", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, id, to_index: toIndex }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? "Reorder failed.");
      if (Array.isArray(json.items)) setItems(json.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reorder failed.");
    }
  };

  /** Upload into the asset library as a reference_image, then add to the board. */
  const uploadReference = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      // Same client-side compression the render uploader uses (S1): EXIF-baked,
      // long edge capped, so a phone photo never hits the body limit.
      let toUpload = file;
      try {
        toUpload = (await compressImage(file)).file;
      } catch (err) {
        setError(
          err instanceof ImageProcessingError
            ? err.message
            : "We couldn't read that image. Please try a JPG or PNG.",
        );
        return;
      }

      const form = new FormData();
      form.append("file", toUpload);
      form.append("project_id", projectId);
      form.append("kind", "reference_image");
      form.append("source", "moodboard");
      const res = await fetch("/api/project-asset", { method: "POST", body: form });
      const json = (await res.json().catch(() => null)) as
        | { asset_id?: string; public_url?: string; error?: string }
        | null;
      if (!res.ok || !json?.asset_id) {
        throw new Error(json?.error ?? "Upload failed.");
      }
      setAssets((cur) => [
        {
          id: json.asset_id!,
          kind: "reference_image",
          url: json.public_url ?? "",
          filename: file.name,
          room_id: null,
          bytes: toUpload.size,
        },
        ...cur,
      ]);
      await post({ kind: "asset", asset_id: json.asset_id });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-xl">
      {/* The board ------------------------------------------------------ */}
      <section>
        <div className="mb-md flex flex-wrap items-baseline justify-between gap-sm">
          <h2 className="font-display text-headline-md text-ink-900">
            Your board
          </h2>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            {items.length === 0
              ? "Empty — add a few references below."
              : tasteSeedOn
                ? `${items.length} reference${items.length === 1 ? "" : "s"} · the first 3 steer each render`
                : `${items.length} reference${items.length === 1 ? "" : "s"}`}
          </p>
        </div>

        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-100 bg-paper p-2xl text-center">
            <span
              className="material-symbols-outlined mb-sm text-[32px] text-ink-500"
              aria-hidden="true"
            >
              gallery_thumbnail
            </span>
            <p className="mb-xs font-display text-headline-md italic text-ink-900">
              Nothing pinned yet.
            </p>
            <p className="mx-auto max-w-[52ch] font-body text-body-md text-on-surface-variant">
              Pull in imagery from your chosen direction, reuse a render you
              like, or upload something you found. These become the taste
              reference for every room you render.
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-md sm:grid-cols-3 lg:grid-cols-4">
            {items.map((item, idx) => (
              <li
                key={item.id}
                className="group relative overflow-hidden rounded-xl border border-ink-100 bg-paper"
              >
                <div className="matte-image">
                  {item.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.image_url}
                      alt={descriptorFor(item) ?? "Reference"}
                      className="aspect-square w-full rounded object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center rounded bg-surface-container text-ink-500">
                      <span className="material-symbols-outlined" aria-hidden="true">
                        broken_image
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-xs px-sm pb-sm pt-xs">
                  <span className="flex items-center gap-xs font-mono text-[11px] tabular-nums text-ink-500">
                    {String(idx + 1).padStart(2, "0")}
                    <span className="rounded-full border border-ink-100 px-1.5 py-0.5 font-sans text-[10px] uppercase tracking-wider">
                      {item.kind}
                    </span>
                  </span>
                  <span className="flex items-center gap-0.5">
                    <IconButton
                      glyph="arrow_back"
                      label="Move earlier"
                      disabled={idx === 0 || busy}
                      onClick={() => void move(item.id, idx - 1)}
                    />
                    <IconButton
                      glyph="arrow_forward"
                      label="Move later"
                      disabled={idx === items.length - 1 || busy}
                      onClick={() => void move(item.id, idx + 1)}
                    />
                    <IconButton
                      glyph="close"
                      label="Remove"
                      danger
                      disabled={busy}
                      onClick={() => void remove(item.id)}
                    />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}

      {/* Sources -------------------------------------------------------- */}
      <section className="rounded-xl border border-ink-100 bg-paper p-lg">
        <div className="mb-lg inline-flex gap-0.5 rounded-lg border border-ink-100 bg-canvas p-0.5">
          {(
            [
              ["style", "Style library", "palette"],
              ["renders", "Your renders", "auto_fix_high"],
              ["upload", "Upload", "upload"],
            ] as const
          ).map(([key, label, glyph]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSource(key)}
              aria-pressed={source === key}
              className={cn(
                "focus-ring inline-flex items-center gap-1.5 rounded-md px-md py-sm font-body-sm text-body-sm font-semibold transition-colors",
                source === key
                  ? "bg-brass-600 text-on-primary"
                  : "text-ink-700 hover:bg-surface-container",
              )}
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                {glyph}
              </span>
              {label}
            </button>
          ))}
        </div>

        {source === "style" && (
          <ul className="grid grid-cols-2 gap-sm sm:grid-cols-4 lg:grid-cols-6">
            {orderedStyleOptions.map((o) => {
              const used = usedStyleImages.has(`${o.style_key}:${o.room}`);
              return (
                <li key={`${o.style_key}-${o.room}`}>
                  <button
                    type="button"
                    disabled={used || busy}
                    onClick={() =>
                      void post({ kind: "style", style_key: o.style_key, style_room: o.room })
                    }
                    title={o.label}
                    className={cn(
                      "focus-ring w-full overflow-hidden rounded-lg border p-xs text-left transition-all",
                      used
                        ? "cursor-not-allowed border-ink-100 opacity-40"
                        : "border-ink-100 hover:-translate-y-0.5 hover:shadow-level-1",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={o.image_url}
                      alt=""
                      className="mb-xs aspect-square w-full rounded object-cover"
                      loading="lazy"
                    />
                    <span className="block truncate px-xs pb-xs font-body-sm text-[11px] text-ink-700">
                      {o.style_name}
                      {o.style_key === lockedStyleKey && " ·"}
                      <span className="block text-ink-500">
                        {STYLE_ROOM_LABEL[o.room]}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {source === "renders" &&
          (renderOptions.length === 0 ? (
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              No renders yet — once you generate one you can pin it here as a
              reference for the rest of the villa.
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-sm sm:grid-cols-4 lg:grid-cols-6">
              {renderOptions.map((r) => {
                const used = usedRenderIds.has(r.id);
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      disabled={used || busy}
                      onClick={() => void post({ kind: "render", render_id: r.id })}
                      className={cn(
                        "focus-ring w-full overflow-hidden rounded-lg border p-xs text-left transition-all",
                        used
                          ? "cursor-not-allowed border-ink-100 opacity-40"
                          : "border-ink-100 hover:-translate-y-0.5 hover:shadow-level-1",
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={r.image_url}
                        alt=""
                        className="mb-xs aspect-square w-full rounded object-cover"
                        loading="lazy"
                      />
                      <span className="block truncate px-xs pb-xs font-body-sm text-[11px] text-ink-700">
                        {r.room_name ?? "Render"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ))}

        {source === "upload" && (
          <div className="max-w-[560px]">
            <p className="mb-md font-body-sm text-body-sm text-on-surface-variant">
              Uploads land in your project files as reference images, so they
              are reusable elsewhere — not stranded on this board.
            </p>
            <AssetPicker
              assets={assets}
              selectedAssetId={null}
              busy={busy}
              emptyHint="No reference images yet — upload your first below."
              uploadLabel="Upload a reference"
              onAssign={(assetId) => {
                if (usedAssetIds.has(assetId)) return;
                void post({ kind: "asset", asset_id: assetId });
              }}
              onUploadNew={(file) => void uploadReference(file)}
            />
          </div>
        )}
      </section>

      <div className="flex justify-end">
        <Link
          href={nextHref}
          className="focus-ring flex h-12 items-center gap-sm rounded-lg bg-brass-600 px-xl font-body-sm text-body-sm font-semibold text-on-primary transition-colors hover:bg-primary"
        >
          {nextLabel}
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
            arrow_forward
          </span>
        </Link>
      </div>
    </div>
  );
}

function IconButton({
  glyph,
  label,
  onClick,
  disabled,
  danger,
}: {
  glyph: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "focus-ring flex h-7 w-7 items-center justify-center rounded transition-colors",
        disabled
          ? "cursor-not-allowed text-ink-100"
          : danger
            ? "text-ink-500 hover:bg-error/10 hover:text-error"
            : "text-ink-500 hover:bg-surface-container hover:text-ink-900",
      )}
    >
      <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
        {glyph}
      </span>
    </button>
  );
}
