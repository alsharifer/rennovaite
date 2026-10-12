// =============================================================================
// components/blueprint/ProvenanceMark.tsx — the 12 px provenance glyph
// (R7 §1.4 / §2, Figma 3:29).
//
//   measured  ●  solid        validated ◕ ring + ¾ (upper-left open)
//   market    ◑  ring + ½     derived   ○ ring        unpriced ◌ dashed ring
//
// 12×12 box, 10 px circle, 1.25 px ring drawn inside it. Hue AND fill level
// always change together (R2, colour-blind safe); the colour is the tier's
// --color-prov-*-mark token, so light / dark / warm come from tokens.css.
// Decorative: aria-hidden — the figure it sits beside carries the tier in its
// accessible description (spec §4.2 #1). Non-interactive.
// =============================================================================

import type { ProvTier } from "@/lib/provenance/tier-vocab";

const MARK_CLASS: Record<ProvTier, string> = {
  measured: "text-bp-prov-measured-mark",
  validated: "text-bp-prov-validated-mark",
  market: "text-bp-prov-market-mark",
  derived: "text-bp-prov-derived-mark",
  unpriced: "text-bp-prov-unpriced-mark",
};

// Ring centred on the 10 px circle, stroke kept inside it: r = 5 − 1.25 / 2.
const RING_R = 4.375;
const STROKE = 1.25;
// Eight dashes round the ring, centred on 12 / 3 / 6 / 9 o'clock as drawn in 3:29.
const DASH = (2 * Math.PI * RING_R) / 16;

export function ProvenanceMark({ tier, className }: { tier: ProvTier; className?: string }) {
  return (
    <svg
      viewBox="0 0 12 12"
      width={12}
      height={12}
      aria-hidden="true"
      focusable="false"
      data-prov-mark={tier}
      className={`inline-block shrink-0 align-[-1px] ${MARK_CLASS[tier]}${className ? ` ${className}` : ""}`}
    >
      {tier === "measured" && <circle cx={6} cy={6} r={5} fill="currentColor" />}
      {tier !== "measured" && (
        <circle
          cx={6}
          cy={6}
          r={RING_R}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          {...(tier === "unpriced" ? { strokeDasharray: `${DASH} ${DASH}`, strokeDashoffset: DASH / 2 } : {})}
        />
      )}
      {/* ¾: from 12 o'clock clockwise to 9 o'clock — the upper-left quadrant stays open. */}
      {tier === "validated" && <path d="M6 6 L6 1 A5 5 0 1 1 1 6 Z" fill="currentColor" />}
      {/* ½: the right half. */}
      {tier === "market" && <path d="M6 1 A5 5 0 0 1 6 11 Z" fill="currentColor" />}
    </svg>
  );
}
