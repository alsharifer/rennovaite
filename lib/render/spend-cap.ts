// =============================================================================
// lib/render/spend-cap.ts — a HARD spend cap for a render session (B10).
//
// B8 was estimated at ~US$3 and spent US$6.85: the budget was a number in the
// brief, checked before each photo, and the readings were never counted. The
// owner's rule since: every render session gets a hard cap, in code, covering
// images AND readings, never raised mid-session.
//
// Before every paid call the session asks `reserve(worst)`: what this session
// has spent (its render_spend rows, tagged detail.session_ref) + what is
// reserved and not yet recorded + this call's WORST-CASE price must stay at or
// under the cap, or the call is refused (SpendCapReached) and nothing is spent.
// After the call the actual rows are recorded with the tag and the reservation
// is released.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { recordSpend, type SpendRow } from "./render-spend";

/** Worst-case US$ per paid call, for the reservation (the recorded row carries the actual). */
export const WORST_CASE_USD = {
  "google/nano-banana-pro": 0.15,
  "google/nano-banana": 0.039,
  "black-forest-labs/flux-fill-pro": 0.05,
  /** An agreed reading: two readings, a third on disagreement, two images each. */
  reading: 0.3,
  /** A style / follows / describe check: one reading. */
  check: 0.08,
} as const;

export class SpendCapReached extends Error {
  constructor(public spent: number, public worst: number, public cap: number, public what: string) {
    super(`spend cap: ${what} (worst case US$${worst.toFixed(2)}) would take the session from US$${spent.toFixed(2)} past its US$${cap.toFixed(2)} cap — not run`);
  }
}

/** Pure: may a call of this worst-case price run? */
export function capAllows(spentUsd: number, reservedUsd: number, worstUsd: number, capUsd: number): boolean {
  return spentUsd + reservedUsd + worstUsd <= capUsd + 1e-9;
}

export class SpendCap {
  private reserved = 0;
  private recorded = 0;
  private base: number | null = null;

  constructor(private db: SupabaseClient, private projectId: string, public readonly sessionRef: string, public readonly capUsd: number) {}

  /** What this session has recorded so far (read once from render_spend, then counted locally). */
  async spent(): Promise<number> {
    if (this.base == null) {
      const { data, error } = await this.db.from("render_spend").select("cost_usd").eq("project_id", this.projectId).eq("detail->>session_ref", this.sessionRef);
      if (error) throw new Error(`spend cap: cannot read the session's spend (${error.message}) — refusing to spend blind`);
      this.base = ((data ?? []) as { cost_usd: number | null }[]).reduce((t, r) => t + Number(r.cost_usd ?? 0), 0);
    }
    return this.base + this.recorded;
  }

  /** Reserve a call's worst case, or throw SpendCapReached. Returns the release function. */
  async reserve(what: string, worstUsd: number): Promise<() => void> {
    const spent = await this.spent();
    if (!capAllows(spent, this.reserved, worstUsd, this.capUsd)) throw new SpendCapReached(spent + this.reserved, worstUsd, this.capUsd, what);
    this.reserved += worstUsd;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.reserved -= worstUsd;
    };
  }

  /** Record what a call actually cost, tagged with the session. */
  async record(rows: SpendRow[]): Promise<void> {
    const tagged = rows.map((r) => ({ ...r, detail: { ...(r.detail ?? {}), session_ref: this.sessionRef } }));
    await recordSpend(this.db, tagged);
    this.recorded += tagged.reduce((t, r) => t + Number(r.cost_usd ?? 0), 0);
  }

  /** Reserve, run, record, release — the one way a paid call runs under the cap. */
  async run<T>(what: string, worstUsd: number, call: () => Promise<{ value: T; spend: SpendRow[] }>): Promise<T> {
    const release = await this.reserve(what, worstUsd);
    try {
      const { value, spend } = await call();
      await this.record(spend);
      return value;
    } finally {
      release();
    }
  }
}
