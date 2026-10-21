// lib/render/render-spend.ts — the cost guard's ledger (bathroom pilot B2,
// migration 063). One row per paid model call a render makes: the image model
// (per output image) and the vision check (per token). render_spend_aed for a
// project = Σ cost_aed. Best-effort: a missing table never stops a render.

import type { SupabaseClient } from "@supabase/supabase-js";

/** USD → AED (the dirham's peg). */
export const USD_TO_AED = 3.6725;

/** Replicate list prices per output image (model pages, 18 Oct 2026). */
export const IMAGE_PRICE_USD: Record<string, number> = {
  "google/nano-banana": 0.039,
  // 1K / 2K output (4K is $0.30).
  "google/nano-banana-pro": 0.15,
  "black-forest-labs/flux-depth-pro": 0.05,
  "black-forest-labs/flux-canny-pro": 0.05,
  "black-forest-labs/flux-kontext-pro": 0.04,
  // B10: masked inpainting (per image).
  "black-forest-labs/flux-fill-pro": 0.05,
};

export interface SpendRow {
  project_id: string;
  purpose: "photo_view" | "photo_check" | "reference_style" | "eval";
  model: string;
  size?: string | null;
  units?: number;
  cost_usd: number | null;
  render_id?: string | null;
  room_photo_id?: string | null;
  detail?: Record<string, unknown>;
}

export const toAed = (usd: number | null) => (usd == null ? null : Math.round(usd * USD_TO_AED * 10000) / 10000);

export async function recordSpend(db: SupabaseClient, rows: SpendRow | SpendRow[]): Promise<void> {
  const list = (Array.isArray(rows) ? rows : [rows]).map((r) => ({ ...r, units: r.units ?? 1, cost_aed: toAed(r.cost_usd), size: r.size ?? null, render_id: r.render_id ?? null, room_photo_id: r.room_photo_id ?? null, detail: r.detail ?? null }));
  if (list.length === 0) return;
  try {
    const { error } = await db.from("render_spend").insert(list);
    if (error) console.warn("[render-spend] not recorded:", error.message);
  } catch (e) {
    console.warn("[render-spend] not recorded:", e instanceof Error ? e.message : e);
  }
}

/** render_spend_aed for a project: total, and per model. */
export async function projectRenderSpend(db: SupabaseClient, projectId: string): Promise<{ render_spend_aed: number; by_model: Record<string, { calls: number; aed: number }> } | null> {
  const { data, error } = await db.from("render_spend").select("model, units, cost_aed").eq("project_id", projectId);
  if (error) return null;
  const by: Record<string, { calls: number; aed: number }> = {};
  let total = 0;
  for (const r of (data ?? []) as { model: string; units: number; cost_aed: number | null }[]) {
    const aed = Number(r.cost_aed ?? 0);
    total += aed;
    by[r.model] = { calls: (by[r.model]?.calls ?? 0) + (r.units ?? 1), aed: Math.round(((by[r.model]?.aed ?? 0) + aed) * 100) / 100 };
  }
  return { render_spend_aed: Math.round(total * 100) / 100, by_model: by };
}
