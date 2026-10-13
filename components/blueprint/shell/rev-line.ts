// =============================================================================
// components/blueprint/shell/rev-line.ts — "rev 4 · 12 Oct 2026", the rail's
// and the top bars' revision label. Pure, so server pages and the client rail
// share it (a "use client" module's functions cannot be called on the server).
// =============================================================================

import type { RailProject } from "@/lib/journey-state";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "12 Oct 2026" in Dubai time, fixed three-letter months. */
export function revDate(iso: string): string {
  const [y, m, d] = new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" }).split("-").map(Number);
  return `${d} ${MONTHS[m! - 1]} ${y}`;
}

export const revLine = (p: Pick<RailProject, "rev" | "revAt"> | null) => (p?.rev && p.revAt ? `rev ${p.rev} · ${revDate(p.revAt)}` : "no BoQ yet");
