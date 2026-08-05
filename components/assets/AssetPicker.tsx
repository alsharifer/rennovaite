"use client";

// =============================================================================
// components/assets/AssetPicker.tsx — reusable image-asset picker.
//
// A thumbnail grid of a project's image assets with a single active selection,
// plus an "upload new" secondary tile. Generic over asset kind: the render step
// uses it to pick a room photo; the future moodboard step (B2) reuses it for
// reference images. It owns no upload/compression logic — the parent handles
// `onAssign` (assign an existing asset) and `onUploadNew` (a picked File) so the
// same component serves any endpoint.
// =============================================================================

import { useRef } from "react";

import type { AssetLite } from "@/lib/assets/types";
import { cn } from "@/lib/utils";

export type AssetPickerProps = {
  assets: AssetLite[];
  /** Id of the asset currently active for the target (e.g. the room's photo). */
  selectedAssetId?: string | null;
  onAssign: (assetId: string) => void;
  onUploadNew: (file: File) => void;
  busy?: boolean;
  /** File input accept string. Defaults to JPG/PNG/HEIC. */
  accept?: string;
  /** Copy for the empty state above the upload tile. */
  emptyHint?: string;
  uploadLabel?: string;
};

export function AssetPicker({
  assets,
  selectedAssetId = null,
  onAssign,
  onUploadNew,
  busy = false,
  accept = "image/png,image/jpeg,image/heic,image/heif,.heic,.heif",
  emptyHint = "No images yet — upload your first below.",
  uploadLabel = "Upload new",
}: AssetPickerProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) onUploadNew(file);
  }

  return (
    <div className="flex flex-col gap-sm">
      {assets.length === 0 ? (
        <p className="font-body-sm text-body-sm text-on-surface-variant">{emptyHint}</p>
      ) : (
        <ul className="grid grid-cols-3 gap-sm">
          {assets.map((a) => {
            const selected = a.id === selectedAssetId;
            return (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => onAssign(a.id)}
                  disabled={busy}
                  aria-pressed={selected}
                  title={a.filename ?? "Photo"}
                  className={cn(
                    "focus-ring relative block aspect-square w-full overflow-hidden rounded-md border transition-colors",
                    selected
                      ? "border-2 border-brass-600"
                      : "border-ink-100 hover:border-brass-600",
                    busy && "cursor-not-allowed opacity-60",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={a.url}
                    alt={a.filename ?? "Room photo"}
                    className="size-full object-cover"
                    onError={(e) => {
                      const el = e.currentTarget;
                      el.alt = "";
                      el.removeAttribute("src");
                    }}
                  />
                  {selected && (
                    <span
                      aria-hidden="true"
                      className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-brass-600 text-on-primary"
                    >
                      <span
                        className="material-symbols-outlined text-[14px]"
                        style={{ fontVariationSettings: "'FILL' 1" }}
                      >
                        check
                      </span>
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={onPick}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="focus-ring flex h-10 items-center justify-center gap-sm rounded-lg border border-dashed border-ink-100 font-body-sm text-body-sm font-semibold text-ink-900 transition-colors hover:border-brass-600 hover:bg-primary-fixed/30 disabled:opacity-50"
      >
        <span className="material-symbols-outlined text-[18px] text-brass-600" aria-hidden="true">
          add_photo_alternate
        </span>
        {busy ? "Working…" : uploadLabel}
      </button>
    </div>
  );
}
