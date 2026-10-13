"use client";

// =============================================================================
// components/blueprint/renders/RoomPhoto.tsx — the studio's ROOM PHOTO control
// (K8 #5, spec §6.4). A room with a photo renders FROM it (photo path); one
// without renders off-plan. The control opens the project's photo library —
// assign any photo to this room, or upload a new one (compressed on the client,
// straight to Storage, H9) — and the assignment is mirrored to room_photos by
// the existing route, so the render pipeline is unchanged.
// =============================================================================

import { useRef, useState } from "react";

import type { AssetLite } from "@/lib/assets/types";
import { compressImage, ImageProcessingError } from "@/lib/image/compress";
import { uploadFile } from "@/lib/uploads/client";

import { Icon } from "../Icon";
import { StateBlock } from "../StateBlock";

export function RoomPhoto({
  projectId,
  roomId,
  roomName,
  photoUrl,
  assets,
  onAssigned,
  onNewAsset,
}: {
  projectId: string;
  roomId: string;
  roomName: string;
  photoUrl: string | null;
  assets: AssetLite[];
  onAssigned: (url: string) => void;
  onNewAsset: (asset: AssetLite) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  async function assign(assetId: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/project-asset", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ asset_id: assetId, room_id: roomId }) });
      const body = (await res.json().catch(() => null)) as { public_url?: string; error?: string } | null;
      if (!res.ok || !body?.public_url) throw new Error(body?.error ?? "That photo wasn't assigned. Please try again.");
      onAssigned(body.public_url);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That photo wasn't assigned.");
    } finally {
      setBusy(false);
    }
  }

  async function upload(f: File) {
    setBusy(true);
    setError(null);
    try {
      let toUpload = f;
      try {
        toUpload = (await compressImage(f)).file;
      } catch (err) {
        setError(err instanceof ImageProcessingError ? err.message : "We couldn't read that image. Please try a JPG or PNG.");
        return;
      }
      const body = await uploadFile<{ asset_id?: string; public_url?: string }>(toUpload, { kind: "project_asset", projectId, assetKind: "photo" }, { asset_kind: "photo", source: "render", room_id: roomId, filename: f.name });
      if (!body?.asset_id || !body.public_url) throw new Error("The upload didn't complete. Please try again.");
      onNewAsset({ id: body.asset_id, url: body.public_url, kind: "photo", room_id: roomId, filename: toUpload.name, bytes: toUpload.size });
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The upload didn't work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center gap-3 border border-bp-line-control px-3 py-2 text-left hover:bg-bp-surface-raised"
      >
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- the room's stored photo
          <img src={photoUrl} alt="" className="h-8 w-12 shrink-0 border border-bp-line-hairline object-cover" />
        ) : null}
        <span className="t-body-sm min-w-0 flex-1 text-bp-ink-primary">{photoUrl ? `Rendering from your photo of ${roomName.toLowerCase()}` : "Add a photo to render from it"}</span>
        <Icon name="add_photo_alternate" className="text-[20px] text-bp-ink-secondary" />
      </button>
      {open ? (
        <div className="border border-t-0 border-bp-line-hairline bg-bp-surface-raised p-3">
          {assets.length ? (
            <ul className="grid grid-cols-3 gap-2" aria-label="Your project photos">
              {assets.map((a) => (
                <li key={a.id}>
                  <button type="button" disabled={busy} onClick={() => void assign(a.id)} aria-pressed={a.url === photoUrl} aria-label={`Use ${a.filename ?? "this photo"} for ${roomName}`} className="relative block w-full outline-offset-2">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a stored project photo */}
                    <img src={a.url} alt="" className={`aspect-[3/2] w-full object-cover ${a.url === photoUrl ? "outline outline-2 outline-bp-ink-primary" : "border border-bp-line-hairline"}`} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="t-body-sm text-bp-ink-secondary">No photos in this project yet — upload one to reuse it across rooms.</p>
          )}
          <button type="button" disabled={busy} onClick={() => file.current?.click()} className="t-nav-item-active mt-3 inline-flex min-h-9 items-center gap-2 text-bp-ink-primary underline underline-offset-4">
            <Icon name="upload" className="text-[18px]" />
            {busy ? "Uploading…" : "Upload a new photo"}
          </button>
          <p className="t-label-md mt-1 font-bp-mono text-bp-ink-tertiary">JPG, PNG or HEIC · optimised on your device</p>
          <input
            ref={file}
            type="file"
            accept="image/jpeg,image/png,image/heic,image/heif"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void upload(f);
            }}
          />
        </div>
      ) : null}
      {error ? (
        <div className="mt-2">
          <StateBlock kind="error" title="The photo didn't change" afterUserAction>
            {error}
          </StateBlock>
        </div>
      ) : null}
    </div>
  );
}
