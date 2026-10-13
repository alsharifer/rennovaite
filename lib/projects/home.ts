// =============================================================================
// lib/projects/home.ts — the Projects home's pure rules (K8 #1, spec §6.1,
// Figma 53:65 · phone 66:1343). Client-safe: data in, rows out.
//
//   stage   one word per project, icon + label/caps (no coloured badges):
//           the project's own status first (completed / on hold / in
//           progress), then how far its work has got, read from the rail's
//           step states — never a rule of its own.
//   next    the first Attention / Blocked step of the project's journey, in
//           journey order: "04 · RATES & BASIS" + the rail's reason + its fix.
//   tabs    All · Design · Costing · Approval · In progress · Completed, with
//           counts; Design takes PLAN as well, Approval takes DOCUMENTS.
//
// No KPI tiles: a portfolio sum mixes provenance (R1).
// =============================================================================

import { FIRM_STEPS, OWNER_STEPS, type JourneyPersona } from "@/lib/journey";
import type { StepStatus } from "@/lib/journey-state";
import type { ProvTier } from "@/lib/provenance/tier-vocab";

export type HomeStage = "plan" | "design" | "costing" | "approval" | "documents" | "in_progress" | "on_hold" | "completed";
export type HomeTab = "all" | "design" | "costing" | "approval" | "in_progress" | "completed";

export const STAGE_LABEL: Record<HomeStage, string> = {
  plan: "Plan",
  design: "Design",
  costing: "Costing",
  approval: "Approval",
  documents: "Documents",
  in_progress: "In progress",
  on_hold: "On hold",
  completed: "Completed",
};

export const STAGE_ICON: Record<HomeStage, string> = {
  plan: "architecture",
  design: "palette",
  costing: "request_quote",
  approval: "approval",
  documents: "folder_zip",
  in_progress: "construction",
  on_hold: "pause_circle",
  completed: "task_alt",
};

export const HOME_TABS: { key: HomeTab; label: string; stages: HomeStage[] | null }[] = [
  { key: "all", label: "All", stages: null },
  { key: "design", label: "Design", stages: ["plan", "design"] },
  { key: "costing", label: "Costing", stages: ["costing"] },
  { key: "approval", label: "Approval", stages: ["approval", "documents"] },
  { key: "in_progress", label: "In progress", stages: ["in_progress"] },
  { key: "completed", label: "Completed", stages: ["completed"] },
];

export interface HomeRow {
  id: string;
  name: string;
  /** "Interior refit · Dubai" — what the project covers, where. */
  scope: string | null;
  stage: HomeStage;
  rev: { n: number; date: string } | null;
  estimate: { total: number; estimate: boolean; excludes: number; tier: ProvTier | null } | null;
  next: { state: "attention" | "blocked"; step: string; reason: string; href: string } | null;
  /** ISO of the latest thing that happened on the project. */
  updatedAt: string;
  /** The latest locked view's image, if any. */
  thumb: string | null;
  archived: boolean;
  /** K10 (§6.12): may THIS caller delete it — with the reason the menu shows when not. */
  deletable: { allowed: boolean; reason: string | null };
}

/** K10: a project in Recently deleted (lib/projects/lifecycle.ts listRecentlyDeleted). */
export interface HomeDeleted {
  id: string;
  name: string;
  deletedAt: string;
  deletedBy: string | null;
  purgeOn: string;
  canDeleteNow: boolean;
}

export interface HomeActivity {
  text: string;
  project: string;
  projectId: string;
  at: string;
}

export interface HomeView {
  rows: HomeRow[];
  counts: { active: number; onHold: number; completed: number; archived: number };
  activity: HomeActivity[];
  /** K10: Recently deleted — the caller's projects deleted in the last 30 days. */
  deleted: HomeDeleted[];
}

/** The project's own status word (projects.status), when it says more than "draft". */
function statusStage(status: string | null): HomeStage | null {
  const s = (status ?? "").toLowerCase();
  if (s === "completed" || s === "complete" || s === "done") return "completed";
  if (s === "on_hold" || s === "hold" || s === "paused") return "on_hold";
  if (s === "construction" || s === "in_construction" || s === "in_progress") return "in_progress";
  return null;
}

export function homeStage(input: { status: string | null; persona: JourneyPersona; statuses: Record<string, StepStatus>; hasBoq: boolean }): HomeStage {
  const own = statusStage(input.status);
  if (own) return own;
  const st = input.statuses;
  const plan = input.persona === "firm" ? st.scope : st.plan;
  if (!plan || plan.state !== "done") return "plan";
  if (!input.hasBoq) return "design";
  if (input.persona === "firm") {
    const rev = st.revisions;
    if (rev?.state === "done") return "documents";
    if (rev?.state === "attention" && /client/i.test(rev.reason ?? "")) return "approval";
  }
  return "costing";
}

/** The first Attention / Blocked step, in journey order. */
export function homeNext(projectId: string, persona: JourneyPersona, statuses: Record<string, StepStatus>, href: (key: string) => string): HomeRow["next"] {
  const steps: readonly { key: string; number: string; label: string }[] = persona === "firm" ? FIRM_STEPS : OWNER_STEPS;
  for (const s of steps) {
    const st = statuses[s.key];
    if (!st || (st.state !== "attention" && st.state !== "blocked")) continue;
    return { state: st.state, step: `${s.number} · ${s.label.toUpperCase()}`, reason: st.reason ?? "", href: st.fix?.href ?? href(s.key) };
  }
  return null;
}

export function tabCounts(rows: HomeRow[]): Record<HomeTab, number> {
  const out = {} as Record<HomeTab, number>;
  for (const t of HOME_TABS) out[t.key] = t.stages ? rows.filter((r) => t.stages!.includes(r.stage)).length : rows.length;
  return out;
}

export function inTab(row: HomeRow, tab: HomeTab): boolean {
  const t = HOME_TABS.find((x) => x.key === tab);
  return !t?.stages || t.stages.includes(row.stage);
}

/** "2 h", "1 d", "2 w" — the frames' compact ages. */
export function age(iso: string, now: number): string {
  const m = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (m < 60) return m < 1 ? "now" : `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d} d`;
  const w = Math.floor(d / 7);
  if (w < 9) return `${w} w`;
  return `${Math.floor(d / 30)} mo`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "4 Oct" (Dubai), the frames' revision date — fixed three-letter months (ICU prints "Sept"). */
export function shortDate(iso: string): string {
  const [, m, d] = new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" }).split("-").map(Number);
  return `${d} ${MONTHS[m! - 1]}`;
}

export type HomeSort = "updated" | "name" | "estimate";

export function sortRows(rows: HomeRow[], sort: HomeSort): HomeRow[] {
  const out = [...rows];
  if (sort === "name") out.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  else if (sort === "estimate") out.sort((a, b) => (b.estimate?.total ?? -1) - (a.estimate?.total ?? -1));
  else out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out;
}
