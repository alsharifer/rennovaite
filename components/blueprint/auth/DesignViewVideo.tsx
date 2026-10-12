"use client";

// =============================================================================
// components/blueprint/auth/DesignViewVideo.tsx — the sign-in page's design
// view (K6, R7 §3.9a). Decorative: aria-hidden, muted, no controls, no audio.
//
// The poster is what renders first (and what a phone shows, as a band above
// the form). The video only loads and plays when nothing argues against it:
// not under prefers-reduced-motion, not with Save-Data, not on a 2G / 3G
// connection — then the poster simply stays. No live WebGL here: the files are
// captured once from our own stage (scripts/k6-capture-villa.mjs).
// =============================================================================

import { useEffect, useRef } from "react";

type Conn = { saveData?: boolean; effectiveType?: string };

export function DesignViewVideo({ className }: { className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const conn = (navigator as Navigator & { connection?: Conn }).connection;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const slow = !!conn?.saveData || /(^|-)2g$|^3g$/.test(conn?.effectiveType ?? "");
    if (reduced || slow) return;
    v.preload = "auto";
    v.play().catch(() => {
      /* autoplay refused: the poster stays */
    });
  }, []);
  return (
    <video
      ref={ref}
      className={className}
      poster="/design-view/villa-orbit-poster.webp"
      muted
      loop
      playsInline
      preload="none"
      aria-hidden="true"
      tabIndex={-1}
      disablePictureInPicture
      data-design-view
    >
      <source src="/design-view/villa-orbit.webm" type="video/webm" />
      <source src="/design-view/villa-orbit.mp4" type="video/mp4" />
    </video>
  );
}
