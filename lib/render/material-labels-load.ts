// =============================================================================
// lib/render/material-labels-load.ts — the studio's material labels and each
// room's design fingerprint now (C5 #1). Server-side: reads rooms.spec.wet_room
// and the latest BoQ's lines; the labels themselves are pure (material-labels.ts).
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { designKey } from "@/lib/documents/render-consistency";

import { materialLabels, type MaterialRow } from "./material-labels";
import type { MiniPlan } from "./photo-views-load";
import type { RoomAnchor, SpecField } from "./room-spec-vocab";

type Gateish = { gate?: { design_key?: string } | null; render_id: string };

export interface MaterialState {
  /** Per room with an anchor: every element its design shows, labelled. */
  materials: Record<string, MaterialRow[]>;
  /** Per room: the design fingerprint now (fixtures + product choices) — a locked view whose render was made under another is "changed since approval". */
  designNow: Record<string, string>;
}

export async function loadMaterialState(
  db: SupabaseClient,
  projectId: string,
  roomIds: string[],
  input: { plans: Record<string, MiniPlan>; anchors: Record<string, RoomAnchor>; versions: Record<string, Gateish[]> },
): Promise<MaterialState> {
  const out: MaterialState = { materials: {}, designNow: {} };
  if (!roomIds.length) return out;
  const [roomsRes, boqRes] = await Promise.all([
    db.from("rooms").select("id, spec").in("id", roomIds),
    db.from("boqs").select("sections").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const choicesOf = new Map(((roomsRes.data ?? []) as { id: string; spec: { wet_room?: Record<string, unknown> } | null }[]).map((r) => [r.id, r.spec?.wet_room ?? null]));
  const sections = ((boqRes.data as { sections?: unknown } | null)?.sections ?? null) as { lines?: unknown[] }[] | { sections?: { lines?: unknown[] }[] } | null;
  const secs = Array.isArray(sections) ? sections : (sections?.sections ?? []);
  const lines = secs.flatMap((s) => (s.lines ?? []) as Parameters<typeof materialLabels>[0]["lines"][number][]);
  for (const id of roomIds) {
    const choices = choicesOf.get(id) ?? null;
    out.designNow[id] = designKey(input.plans[id]?.fixtures ?? [], choices);
    const anchor = input.anchors[id];
    if (!anchor) continue;
    const approved = (anchor.room_photo_id ? (input.versions[anchor.room_photo_id] ?? []) : []).find((v) => v.render_id === anchor.render_id)?.gate?.design_key ?? null;
    out.materials[id] = materialLabels({ spec: anchor.spec, choices, approvedKey: approved, lines });
  }
  return out;
}

/**
 * Project-wide: for each design element, why it changed since a locked view
 * was approved (any room) — the Specification's "changed since render
 * approval" (C5 #1). Best-effort: no anchors (or tables) → nothing changed.
 */
export async function loadApprovalChanges(db: SupabaseClient, projectId: string): Promise<Partial<Record<SpecField, string>>> {
  try {
    const { data: plans } = await db.from("plans").select("id").eq("project_id", projectId);
    const planIds = ((plans ?? []) as { id: string }[]).map((p) => p.id);
    if (!planIds.length) return {};
    const { data: rooms } = await db.from("rooms").select("id, spec").in("plan_id", planIds);
    const roomRows = (rooms ?? []) as { id: string; spec: { wet_room?: Record<string, unknown> } | null }[];
    const ids = roomRows.map((r) => r.id);
    if (!ids.length) return {};
    const { data: anchors } = await db.from("room_anchors").select("room_id, render_id, spec").in("room_id", ids);
    const anchorRows = (anchors ?? []) as { room_id: string; render_id: string; spec: RoomAnchor["spec"] }[];
    if (!anchorRows.length) return {};
    const { data: renders } = await db.from("renders").select("id, gate").in("id", anchorRows.map((a) => a.render_id));
    const keyOf = new Map(((renders ?? []) as { id: string; gate: { design_key?: string } | null }[]).map((r) => [r.id, r.gate?.design_key ?? null]));
    const out: Partial<Record<SpecField, string>> = {};
    for (const a of anchorRows) {
      const choices = roomRows.find((r) => r.id === a.room_id)?.spec?.wet_room ?? null;
      for (const row of materialLabels({ spec: a.spec, choices, approvedKey: keyOf.get(a.render_id) ?? null, lines: [] })) if (row.label === "changed") out[row.field] ??= row.why;
    }
    return out;
  } catch {
    return {};
  }
}
