"use client";

import { useCallback, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type Props = {
  src: string | null | undefined;
  alt: string;
  /** Optional className applied to the underlying <img>. */
  className?: string;
  /** Label shown in the fallback panel (default: "Render pending"). */
  fallbackLabel?: string;
  /** Material Symbols glyph for the fallback icon (default: "image"). */
  fallbackIcon?: string;
  /**
   * Optional smaller icon size for the fallback (px). Defaults to 28. Useful
   * for tiny list-view thumbs.
   */
  fallbackIconSize?: number;
  /**
   * Optional fully-custom fallback JSX. When provided it replaces the default
   * icon + label panel; useful when the empty state needs a contextual call to
   * action (e.g. the AI Designer's "Click Regenerate this view…" copy).
   */
  fallback?: ReactNode;
};

/**
 * Renders a hero image with a graceful Atelier fallback panel when the URL is
 * missing OR when the browser fails to load it (the legacy
 * `replicate.delivery` URLs in the DB are presigned and expire after about
 * an hour — see /api/render route for the re-hosting fix).
 *
 * Three "image is broken" signals are handled:
 *   1. Network error fires `onError`.
 *   2. Server returns HTTP 200 with 0 bytes — browser fires `onLoad` but the
 *      image has zero natural dimensions.
 *   3. The image already finished loading/erroring BEFORE React attached the
 *      handlers (very fast 404s, cached failures). A ref callback runs the
 *      check at mount time to catch this race.
 */
export function HeroImage({
  src,
  alt,
  className,
  fallbackLabel = "Render pending",
  fallbackIcon = "image",
  fallbackIconSize = 28,
  fallback,
}: Props) {
  const [failed, setFailed] = useState(false);

  const checkOnMount = useCallback((img: HTMLImageElement | null) => {
    if (!img) return;
    if (img.complete && img.naturalWidth === 0) {
      setFailed(true);
    }
  }, []);

  if (!src || failed) {
    if (fallback !== undefined) return <>{fallback}</>;
    return (
      <div className="flex size-full flex-col items-center justify-center gap-xs px-md text-center">
        <span
          className="material-symbols-outlined text-ink-500"
          style={{ fontSize: fallbackIconSize }}
          aria-hidden="true"
        >
          {fallbackIcon}
        </span>
        <span className="label-caps text-ink-500">{fallbackLabel}</span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={checkOnMount}
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      onLoad={(e) => {
        const img = e.currentTarget;
        if (img.naturalWidth === 0 || img.naturalHeight === 0) {
          setFailed(true);
        }
      }}
      className={cn("size-full object-cover", className)}
    />
  );
}
