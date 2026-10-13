// =============================================================================
// lib/hub/overview-view.ts — 00 Overview for an owner (non-firm) project, as
// the screen reads it (K8 #2, spec §6.2, Figma 54:145). SERVER-ONLY.
//
// Left: the estimate (the stored revision's headline — lib/hub/estimate.ts,
// the same numbers the hub, the home and the BoQ page print), the client's
// own budget when they entered one, "What this number is based on" in the
// owner's words, and "Your design" (the latest locked views). Right: NEXT (≤ 3
// actions, from the rail's own Attention / Blocked reasons), the 05 Timeline
// summary (lib/timeline — the same estimate the Timeline page shows) and the
// documents with what each gate answers. Never a firm-only item (rate book,
// proposal, OH&P).
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { RevisionBoq } from "@/lib/boq/revision-diff";
import { packExportEnabled } from "@/lib/documents/pack-export/guard";
import { resolveAnyStyle } from "@/lib/garden-styles";
import { OWNER_STEPS, journeyFlagsFromEnv, ownerStepHref, type OwnerStepKey } from "@/lib/journey";
import type { RailContext, StepStatus } from "@/lib/journey-state";
import { loadProvenanceContext } from "@/lib/provenance/load";
import { getStyleByKey } from "@/lib/styles";
import { loadTimeline } from "@/lib/timeline/load";

import { estimateOf, type StoredEstimate } from "./estimate";

export interface OverviewAction {
  step: string;
  /** Blocked steps lead with the lock and offer "Why locked?" (a Quiet link). */
  blocked: boolean;
  title: string;
  sentence: string;
  action: { label: string; href: string };
}

export interface OverviewView {
  projectId: string;
  name: string;
  meta: string[];
  /** "4 Oct 2026 · 18:42" — when the latest revision was generated (Dubai). */
  costUpdated: string | null;
  viewer: boolean;
  estimate: (StoredEstimate & { rev: number; budget: number | null }) | null;
  design: { locked: number; direction: string | null; tiles: { url: string; caption: string }[] };
  next: OverviewAction[];
  timeline: { range: string | null; note: string };
  documents: { key: string; label: string; icon: string; state: string; locked: boolean; href: string | null }[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dubai(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const [y, m, day] = d.toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" }).split("-").map(Number);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Dubai" });
  return { date: `${day} ${MONTHS[m! - 1]} ${y}`, time };
}

async function safe<T>(fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/**
 * NEXT, in the owner's words, from the rail's reasons (max 3, journey order).
 * The words name what the reason is about; the reason itself is the rail's.
 */
export function overviewNext(projectId: string, statuses: Record<string, StepStatus>, ctx: { direction: string | null; unpriced: string[] }): OverviewAction[] {
  const flags = journeyFlagsFromEnv();
  const out: OverviewAction[] = [];
  for (const s of OWNER_STEPS) {
    const st = statuses[s.key];
    if (!st || (st.state !== "attention" && st.state !== "blocked")) continue;
    const href = st.fix?.href ?? ownerStepHref(s.key as OwnerStepKey, projectId, flags);
    const step = `${s.number} · ${s.label.toUpperCase()}`;
    const blocked = st.state === "blocked";
    const n = ctx.unpriced.length;
    let title = blocked ? `${s.label} is blocked` : `${s.label} needs a look`;
    let sentence = st.reason ?? "";
    let label = blocked ? "Why locked?" : `Open ${s.label.toLowerCase()}`;
    if (s.key === "design") {
      title = "Add references for your design";
      sentence = `${ctx.direction ? `Your direction is ${ctx.direction}. ` : ""}Pin 3–6 images you like so every render is checked against them.`;
      label = "Open design";
    } else if (s.key === "cost" && !blocked) {
      title = `${n === 1 ? "One item isn't" : `${n} items aren't`} priced yet`;
      sentence = `${n ? `${list(ctx.unpriced)} ${n === 1 ? "has" : "have"} no price, so ${n === 1 ? "it is" : "they are"} left out of the total. ` : ""}Ask for a price or pick a product.`;
      label = "Review cost";
    } else if (s.key === "tender" && /^Price /.test(st.reason ?? "")) {
      title = "Tender pack is locked";
      sentence = "It unlocks once every item has a price — contractors bid on a complete list.";
    } else if (s.key === "plan" || /overlap|plan/i.test(st.reason ?? "")) {
      title = "Your plan can't be priced yet";
      label = blocked ? "Why locked?" : "Open plan";
    }
    out.push({ step, blocked, title, sentence: sentence.charAt(0).toUpperCase() + sentence.slice(1), action: { label, href } });
    if (out.length === 3) break;
  }
  return out;
}

export async function loadOverviewView(db: SupabaseClient, projectId: string, rail: RailContext): Promise<OverviewView> {
  const [{ data: project }, latest, plan, style, approved, timeline] = await Promise.all([
    db.from("projects").select("name, display_name, city, budget_aed, firm_id, created_at").eq("id", projectId).maybeSingle<{ name: string | null; display_name: string | null; city: string | null; budget_aed: number | null; firm_id: string | null; created_at: string }>(),
    safe(null as { id: string; created_at: string; sections: RevisionBoq } | null, async () => (await db.from("boqs").select("id, created_at, sections").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle()).data as { id: string; created_at: string; sections: RevisionBoq } | null),
    safe(null as { id: string } | null, async () => (await db.from("plans").select("id").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle()).data as { id: string } | null),
    safe(null as string | null, async () => ((await db.from("style_choices").select("style_key").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle()).data as { style_key: string | null } | null)?.style_key ?? null),
    safe([] as { room_id: string | null; render_id: string | null; created_at: string }[], async () => ((await db.from("approved_designs").select("room_id, render_id, created_at").eq("project_id", projectId).order("created_at", { ascending: false })).data ?? []) as { room_id: string | null; render_id: string | null; created_at: string }[]),
    safe(null as Awaited<ReturnType<typeof loadTimeline>> | null, () => loadTimeline(projectId)),
  ]);

  // The latest lock per room — one view per room.
  const perRoom = new Map<string, { render_id: string; created_at: string }>();
  for (const a of approved) if (a.room_id && a.render_id && !perRoom.has(a.room_id)) perRoom.set(a.room_id, { render_id: a.render_id, created_at: a.created_at });
  const top = [...perRoom.entries()].slice(0, 3);

  const [rooms, renders, revCount, estimate] = await Promise.all([
    plan ? safe([] as { id: string; name_en: string | null; unroofed: boolean | null }[], async () => ((await db.from("rooms").select("id, name_en, unroofed").eq("plan_id", plan.id)).data ?? []) as { id: string; name_en: string | null; unroofed: boolean | null }[]) : Promise.resolve([]),
    top.length ? safe([] as { id: string; image_url: string | null; view: string | null }[], async () => ((await db.from("renders").select("id, image_url, view").in("id", top.map(([, v]) => v.render_id))).data ?? []) as { id: string; image_url: string | null; view: string | null }[]) : Promise.resolve([]),
    safe(0, async () => (await db.from("boqs").select("id", { count: "exact", head: true }).eq("project_id", projectId)).count ?? 0),
    latest ? safe(null as StoredEstimate | null, async () => estimateOf(latest.sections, await loadProvenanceContext(db, projectId))) : Promise.resolve(null),
  ]);

  const roomName = new Map(rooms.map((r) => [r.id, r.name_en ?? "Room"]));
  const renderById = new Map(renders.map((r) => [r.id, r]));
  const tiles = top
    .map(([roomId, v]) => {
      const r = renderById.get(v.render_id);
      return r?.image_url ? { url: r.image_url, caption: `${roomName.get(roomId) ?? "Room"} · ${r.view === "evening" ? "evening" : "day"}` } : null;
    })
    .filter((t): t is { url: string; caption: string } => !!t);

  const outdoor = rooms.filter((r) => r.unroofed).length;
  const scope = rooms.length === 0 ? null : outdoor === 0 ? "Interior refit" : outdoor === rooms.length ? "Garden" : "Interior and garden";
  const budget = !project?.firm_id && project?.budget_aed ? Number(project.budget_aed) : null;
  const meta = [scope, rooms.length ? `${rooms.length} ${rooms.length === 1 ? "area" : "areas"}` : null, project?.city ?? null, budget ? `budget AED ${budget.toLocaleString("en-US")}` : null, project?.created_at ? `started ${dubai(project.created_at).date}` : null].filter((x): x is string => !!x);

  const direction = resolveAnyStyle(style, getStyleByKey)?.name_en ?? null;
  const st = rail.statuses;
  const tenderLocked = st.tender?.state === "blocked";
  const drawings = process.env.DRAWINGS_ENABLED === "true";
  const pack = packExportEnabled();
  const rev = revCount || null;
  const documents: OverviewView["documents"] = estimate
    ? [
        { key: "drawings", label: "Drawing set", icon: "description", state: drawings ? `Ready · rev ${rev}` : "Not available yet", locked: !drawings, href: drawings ? `/project/${projectId}/drawings` : null },
        { key: "boq_pdf", label: "Cost breakdown (PDF)", icon: "request_quote", state: pack ? `Ready · rev ${rev}` : "Not available yet", locked: !pack, href: pack ? `/project/${projectId}/drawings?export=1` : null },
        { key: "tender", label: "Tender pack", icon: "folder_zip", state: tenderLocked ? "Locked" : pack ? "Ready" : "Not available yet", locked: tenderLocked || !pack, href: tenderLocked ? ownerStepHref("tender", projectId, journeyFlagsFromEnv()) : pack ? `/project/${projectId}/drawings?export=1` : null },
      ]
    : [];

  const t = timeline?.estimate;
  return {
    projectId,
    name: (project?.display_name || project?.name || "Project").trim(),
    meta,
    costUpdated: latest ? `${dubai(latest.created_at).date} · ${dubai(latest.created_at).time}` : null,
    viewer: process.env.VIEWER_3D_ENABLED === "true" && rooms.length > 0,
    estimate: estimate && rev ? { ...estimate, rev, budget } : null,
    design: { locked: perRoom.size, direction, tiles },
    next: overviewNext(projectId, st, { direction, unpriced: (estimate?.excluded ?? []).map((x) => x.description.toLowerCase()) }),
    timeline: t
      ? { range: `${t.total_weeks_low}–${t.total_weeks_high} weeks`, note: "Estimated from one calibrated Dubai project — a range, not a promise." }
      : { range: null, note: timeline?.blocked ?? "Generate your cost first — the phases scale off its quantities." },
    documents,
  };
}
