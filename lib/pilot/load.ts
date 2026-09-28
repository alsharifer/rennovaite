// =============================================================================
// lib/pilot/load.ts — the three-firms evidence, loaded (L5). Server-only.
//
// Reads firms, their projects (by projects.firm_id OR by the firm their
// corrections name), every event, correction and pack export those projects
// have, resolves each correction's POMI section from its item key, and hands
// the rows to the pure rollup. Pre-048 rows come back with null in the new
// columns; the rollup reports them as gaps.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { GARDEN_ITEM_SECTION } from "@/lib/boq/garden-takeoff";
import { RATE_RULES } from "@/lib/boq/rules";
import { isOutdoorType } from "@/lib/plan/zones";

import { sectionOfItem, threeFirmsEvidence, type CorrectionRow, type EventRow, type FirmRow, type PackRow, type ProjectRow, type ThreeFirmsEvidence } from "./metrics";

const INTERIOR_SECTIONS: Record<string, string> = Object.fromEntries(
  Object.entries(RATE_RULES).map(([k, r]) => {
    const withSection = Object.values(r as Record<string, unknown>).find((v): v is { work_section: string } => !!v && typeof v === "object" && "work_section" in (v as object));
    return [k, withSection?.work_section ?? ""];
  }).filter(([, s]) => !!s),
);

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? null : String(v));

export async function loadFirmEvidence(db: SupabaseClient, firmIds?: readonly string[]): Promise<ThreeFirmsEvidence> {
  let firmQ = db.from("firms").select("id, name");
  if (firmIds?.length) firmQ = firmQ.in("id", [...firmIds]);
  const { data: firmRows, error: firmErr } = await firmQ;
  if (firmErr) throw new Error(`firms read failed: ${firmErr.message}`);
  const firms: FirmRow[] = ((firmRows ?? []) as Row[]).map((f) => ({ id: String(f.id), name: String(f.name) }));

  const { data: corrRows } = await db.from("boq_corrections").select("id, project_id, firm_id, correction_type, item_key, promoted_at, recorded_at, session_ref");
  const corrections: CorrectionRow[] = ((corrRows ?? []) as Row[]).map((c) => ({
    project_id: String(c.project_id),
    firm_id: str(c.firm_id),
    correction_type: String(c.correction_type),
    item_key: str(c.item_key),
    section: sectionOfItem(str(c.item_key), GARDEN_ITEM_SECTION as Record<string, string>, INTERIOR_SECTIONS),
    promoted_at: str(c.promoted_at),
    recorded_at: String(c.recorded_at),
    session_ref: str(c.session_ref),
  }));

  // Projects: the firms' own, plus any their corrections name.
  const firmSet = new Set(firms.map((f) => f.id));
  const viaCorrections = new Set(corrections.filter((c) => c.firm_id && firmSet.has(c.firm_id)).map((c) => c.project_id));
  const { data: projRows } = await db.from("projects").select("id, name, display_name, firm_id, created_at");
  const projects: ProjectRow[] = [];
  for (const p of (projRows ?? []) as Row[]) {
    const id = String(p.id);
    const firmId = str(p.firm_id);
    if (!(firmId && firmSet.has(firmId)) && !viaCorrections.has(id) && firmIds?.length) continue;
    const { data: plan } = await db.from("plans").select("id").eq("project_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle<{ id: string }>();
    const { data: rooms } = plan ? await db.from("rooms").select("room_type").eq("plan_id", plan.id) : { data: [] };
    const types = ((rooms ?? []) as { room_type: string | null }[]).map((r) => r.room_type ?? "");
    const g = types.some((t) => isOutdoorType(t));
    const i = types.some((t) => !isOutdoorType(t));
    projects.push({ id, name: str(p.display_name) ?? str(p.name) ?? id.slice(0, 8), firm_id: firmId, created_at: String(p.created_at), scope: g && i ? "mixed" : g ? "garden" : i ? "interior" : "none" });
  }
  const projectIds = projects.map((p) => p.id);

  const { data: evRows } = projectIds.length ? await db.from("pilot_events").select("project_id, firm_id, kind, actor, session_ref, duration_ms, stage, recorded_at, detail").or(`project_id.in.(${projectIds.join(",")}),firm_id.in.(${[...firmSet].join(",") || "00000000-0000-0000-0000-000000000000"})`) : { data: [] };
  const events: EventRow[] = ((evRows ?? []) as Row[]).map((e) => ({
    project_id: str(e.project_id),
    firm_id: str(e.firm_id),
    kind: String(e.kind),
    actor: str(e.actor),
    session_ref: str(e.session_ref),
    duration_ms: e.duration_ms == null ? null : Number(e.duration_ms),
    stage: str(e.stage),
    recorded_at: String(e.recorded_at),
    detail: (e.detail ?? null) as Record<string, unknown> | null,
  }));

  const { data: packRows } = projectIds.length ? await db.from("pack_exports").select("project_id, source, status, options, actor, created_at, finished_at").in("project_id", projectIds) : { data: [] };
  const packs: PackRow[] = ((packRows ?? []) as Row[]).map((p) => {
    const o = (p.options ?? {}) as Record<string, unknown>;
    return { project_id: String(p.project_id), source: String(p.source), status: String(p.status), stage: str(o.stage), actor: str(p.actor), created_at: String(p.created_at), finished_at: str(p.finished_at), proposal: o.proposal === true };
  });

  return threeFirmsEvidence(firms, projects, events, corrections, packs);
}
