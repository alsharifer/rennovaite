import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";

import { AnalyticsIdentify } from "@/app/_components/analytics-identify";
import { AppShell } from "@/components/app/AppShell";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { cn } from "@/lib/utils";

import { PortfolioBrowser } from "./_components/portfolio-browser";
import {
  ALL_PHASES,
  PHASE_ORDER,
  type Phase,
  type PortfolioProject,
  type SortKey,
} from "./_components/portfolio-types";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

type ProjectRow = {
  id: string;
  name: string | null;
  city: string | null;
  budget_aed: number | null;
  status: string | null;
  created_at: string | null;
};
type PlanRow = { id: string; project_id: string | null; parsed_json: unknown; created_at: string | null };
type BoqRow = { id: string; project_id: string | null; total_aed: number | null; created_at: string | null };
type RenderRow = { id: string; project_id: string | null; image_url: string | null; created_at: string | null };
type SelectionRow = { id: string; project_id: string; boq_line_id: string; created_at: string | null };

// ---------------------------------------------------------------------------
// Helpers — dashboard summary
// ---------------------------------------------------------------------------

function formatAedShort(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `AED ${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `AED ${Math.round(n / 1_000)}k`;
  return `AED ${Math.round(n)}`;
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function greetingWord(): string {
  const h = new Date().getHours();
  if (h < 5) return "Good evening";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function firstNameFromUser(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
} | null): string | null {
  if (!user) return null;
  const meta = user.user_metadata ?? {};
  const full = String(meta.full_name ?? meta.name ?? "").trim();
  if (full) return full.split(/\s+/)[0]!;
  const local = (user.email ?? "").split("@")[0] ?? "";
  const token = local.split(/[._\-+]/)[0] ?? "";
  if (!token) return null;
  return token.charAt(0).toUpperCase() + token.slice(1);
}

// Impure now()s kept in helpers (react-hooks/purity flags them in the body).
function thirtyDaysAgoIso(): string {
  return new Date(Date.now() - 30 * 86_400_000).toISOString();
}
function startOfThisMonth(): number {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// ---------------------------------------------------------------------------
// Helpers — portfolio (grid/list) phase + URL params
// ---------------------------------------------------------------------------

function inferPortfolioPhase(state: {
  status: string | null;
  hasPlan: boolean;
  hasRender: boolean;
  hasBoq: boolean;
  hasSelections: boolean;
}): Phase {
  const s = (state.status ?? "").toLowerCase();
  if (s === "completed" || s === "complete" || s === "done") return "Completed";
  if (s === "on_hold" || s === "hold" || s === "paused") return "On hold";
  if (s === "construction" || s === "in_construction") return "In Construction";
  if (s === "handover") return "Handover";
  if (state.hasSelections) return "Bidding";
  if (state.hasBoq) return "BoQ";
  if (state.hasRender || state.hasPlan) return "Design";
  return "Active";
}

function latestActivityIso(
  project: ProjectRow,
  latestBoq: BoqRow | null,
  latestRender: RenderRow | null,
  latestSelection: SelectionRow | null,
  latestPlan: PlanRow | null,
): string | null {
  const candidates = [
    project.created_at,
    latestPlan?.created_at ?? null,
    latestRender?.created_at ?? null,
    latestBoq?.created_at ?? null,
    latestSelection?.created_at ?? null,
  ].filter((v): v is string => !!v);
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (a > b ? a : b));
}

function parseFilterParam(raw: string | string[] | undefined): Set<Phase> {
  if (!raw) return new Set();
  const flat = Array.isArray(raw) ? raw.join(",") : raw;
  const tokens = flat.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  const result = new Set<Phase>();
  const lookup = new Map(ALL_PHASES.map((p) => [p.toLowerCase(), p] as const));
  for (const t of tokens) {
    const matched = lookup.get(t);
    if (matched) result.add(matched);
  }
  return result;
}
function parseSortParam(raw: string | string[] | undefined): SortKey {
  const flat = Array.isArray(raw) ? raw[0] : raw;
  switch (flat) {
    case "budget":
    case "pipeline":
    case "name":
      return flat;
    default:
      return "updated";
  }
}
function parseViewParam(raw: string | string[] | undefined): "grid" | "list" {
  const flat = Array.isArray(raw) ? raw[0] : raw;
  return flat === "list" ? "list" : "grid";
}

// ---------------------------------------------------------------------------

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filter = parseFilterParam(sp.filter);
  const sort = parseSortParam(sp.sort);
  const view = parseViewParam(sp.view);

  const supabase = getSupabaseAdmin();
  const sb = supabase as unknown as SupabaseClient;

  // Auth session (anon, cookie-scoped) — drives the greeting + PostHog identify.
  const authClient = await createSupabaseServerClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  const firstName = firstNameFromUser(user);

  const thirtyDaysAgo = thirtyDaysAgoIso();

  const [
    projectsRes,
    plansRes,
    boqsRes,
    rendersRes,
    rendersLast30Res,
    selectionsRes,
  ] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, city, budget_aed, status, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("plans")
      .select("id, project_id, parsed_json, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("boqs")
      .select("id, project_id, total_aed, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("renders")
      .select("id, project_id, image_url, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("renders")
      .select("id", { count: "exact", head: true })
      .gte("created_at", thirtyDaysAgo),
    sb
      .from("vendor_selections")
      .select("id, project_id, boq_line_id, created_at")
      .order("created_at", { ascending: false })
      .returns<SelectionRow[]>(),
  ]);

  const projects: ProjectRow[] = projectsRes.data ?? [];

  // Archived projects (migration 030). Read separately through the untyped
  // client because `archived_at` is not in database.types.ts, and best-effort
  // so the list still renders — with everything visible — before 030 is
  // applied. Archiving hides a project from the list; it never deletes it.
  const archivedAt = new Map<string, string>();
  try {
    const { data } = await sb
      .from("projects")
      .select("id, archived_at")
      .not("archived_at", "is", null)
      .returns<{ id: string; archived_at: string }[]>();
    for (const r of data ?? []) archivedAt.set(r.id, r.archived_at);
  } catch {
    /* pre-030: nothing is archived yet */
  }
  const plans: PlanRow[] = (plansRes.data ?? []) as PlanRow[];
  const boqs: BoqRow[] = (boqsRes.data ?? []) as BoqRow[];
  const renders: RenderRow[] = (rendersRes.data ?? []) as RenderRow[];
  const selections: SelectionRow[] = selectionsRes.data ?? [];

  // Latest row per project (queries are pre-sorted desc by created_at).
  const latestPlanByProject = new Map<string, PlanRow>();
  for (const p of plans) if (p.project_id && !latestPlanByProject.has(p.project_id)) latestPlanByProject.set(p.project_id, p);
  const latestBoqByProject = new Map<string, BoqRow>();
  for (const b of boqs) if (b.project_id && !latestBoqByProject.has(b.project_id)) latestBoqByProject.set(b.project_id, b);
  const latestRenderByProject = new Map<string, RenderRow>();
  for (const r of renders) if (r.project_id && !latestRenderByProject.has(r.project_id)) latestRenderByProject.set(r.project_id, r);
  const latestSelectionByProject = new Map<string, SelectionRow>();
  for (const s of selections) if (!latestSelectionByProject.has(s.project_id)) latestSelectionByProject.set(s.project_id, s);

  const projectsWithSelections = new Set<string>();
  for (const s of selections) projectsWithSelections.add(s.project_id);

  // ----- Stat row --------------------------------------------------------
  // "Active" = anything not yet at vendor selection (its terminal phase here).
  const activeProjects = projects.filter((p) => !projectsWithSelections.has(p.id)).length;
  const startOfMonthMs = startOfThisMonth();
  const newThisMonth = projects.filter(
    (p) => p.created_at && new Date(p.created_at).getTime() >= startOfMonthMs,
  ).length;
  const totalBoqValue = [...latestBoqByProject.values()].reduce((sum, b) => sum + (b.total_aed ?? 0), 0);
  const rendersLast30 = rendersLast30Res.count ?? 0;
  const pendingDecisions = projects.filter(
    (p) => latestBoqByProject.has(p.id) && !projectsWithSelections.has(p.id),
  ).length;

  // ----- Activity feed ---------------------------------------------------
  type Event = { id: string; when: string; projectId: string; icon: string; description: string };
  const projectNameById = new Map(projects.map((p) => [p.id, p.name?.trim() || "Untitled"]));
  const events: Event[] = [];
  for (const r of renders.slice(0, 8)) {
    if (!r.created_at || !r.project_id) continue;
    events.push({ id: `r-${r.id}`, when: r.created_at, projectId: r.project_id, icon: "auto_fix_high", description: `Render generated for ${projectNameById.get(r.project_id) ?? "a project"}` });
  }
  for (const b of boqs.slice(0, 4)) {
    if (!b.created_at || !b.project_id) continue;
    events.push({ id: `b-${b.id}`, when: b.created_at, projectId: b.project_id, icon: "receipt_long", description: `BoQ priced at ${formatAedShort(b.total_aed)} for ${projectNameById.get(b.project_id) ?? "a project"}` });
  }
  for (const s of selections.slice(0, 4)) {
    if (!s.created_at || !s.project_id) continue;
    events.push({ id: `s-${s.id}`, when: s.created_at, projectId: s.project_id, icon: "swap_horiz", description: `Vendor swap on ${s.boq_line_id.replace(/-/g, " ")} · ${projectNameById.get(s.project_id) ?? "a project"}` });
  }
  events.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
  const activity = events.slice(0, 6);

  // ----- Portfolio (grid/list) shaping -----------------------------------
  const shaped: PortfolioProject[] = projects.map((p) => {
    const plan = latestPlanByProject.get(p.id) ?? null;
    const boq = latestBoqByProject.get(p.id) ?? null;
    const render = latestRenderByProject.get(p.id) ?? null;
    const selection = latestSelectionByProject.get(p.id) ?? null;
    return {
      id: p.id,
      name: p.name?.trim() || "Untitled",
      city: p.city ?? null,
      budget_aed: p.budget_aed ?? null,
      phase: inferPortfolioPhase({
        status: p.status,
        hasPlan: !!plan?.parsed_json,
        hasRender: !!render,
        hasBoq: !!boq,
        hasSelections: !!selection,
      }),
      archived_at: archivedAt.get(p.id) ?? null,
      hero_url: render?.image_url ?? null,
      boq_total_aed: boq?.total_aed ?? null,
      last_updated_at: latestActivityIso(p, boq, render, selection, plan),
      created_at: p.created_at,
    };
  });

  const counts: Record<"all" | Phase, number> = {
    all: shaped.length, Active: 0, Design: 0, BoQ: 0, Bidding: 0,
    "In Construction": 0, Handover: 0, "On hold": 0, Completed: 0,
  };
  for (const p of shaped) counts[p.phase]++;

  const filtered = filter.size === 0 ? shaped : shaped.filter((p) => filter.has(p.phase));
  const sorted = [...filtered];
  switch (sort) {
    case "budget":
      sorted.sort((a, b) => (b.budget_aed ?? 0) - (a.budget_aed ?? 0));
      break;
    case "pipeline":
      sorted.sort((a, b) => PHASE_ORDER.indexOf(b.phase) - PHASE_ORDER.indexOf(a.phase));
      break;
    case "name":
      sorted.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
      break;
    default:
      sorted.sort((a, b) => (b.last_updated_at ?? "").localeCompare(a.last_updated_at ?? ""));
  }

  const greeting = firstName ? `${greetingWord()}, ${firstName}.` : `${greetingWord()}.`;

  return (
    <AppShell pageName="Dashboard">
      {user && <AnalyticsIdentify distinctId={user.id} email={user.email} name={firstName} />}

      {/* Summary — welcome header, stat row, activity feed (above the grid) */}
      <div className="mx-auto max-w-[1440px]">
        <header className="mb-xl">
          <p className="label-caps mb-xs text-brass-600">Welcome back</p>
          <h1 className="mb-md font-display text-headline-lg text-ink-900">{greeting}</h1>
          <p className="max-w-[800px] font-body text-body-lg text-on-surface-variant">
            Here&apos;s what&apos;s happening across your villas.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-gutter sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Active projects"
            value={String(activeProjects)}
            delta={newThisMonth > 0 ? `+${newThisMonth} this month` : "No new projects this month"}
            deltaTone={newThisMonth > 0 ? "tertiary" : "muted"}
          />
          <StatCard label="BoQ value" value={formatAedShort(totalBoqValue)} delta="across all projects" deltaTone="muted" />
          <StatCard label="Renders generated" value={String(rendersLast30)} delta="last 30 days" deltaTone="muted" />
          <StatCard
            label="Pending decisions"
            value={String(pendingDecisions)}
            delta={pendingDecisions > 0 ? "Review now" : "All caught up"}
            deltaTone={pendingDecisions > 0 ? "brass" : "tertiary"}
          />
        </div>

        <section className="mt-xl rounded-xl border border-ink-100 bg-paper p-lg">
          <header className="mb-lg flex items-baseline justify-between">
            <h2 className="font-display text-headline-md text-ink-900">Recent activity</h2>
            <span className="label-caps text-ink-500">
              {activity.length} {activity.length === 1 ? "event" : "events"}
            </span>
          </header>
          {activity.length === 0 ? (
            <p className="font-body text-body-md text-on-surface-variant">
              Nothing has happened yet — start a project to see activity here.
            </p>
          ) : (
            <ul className="flex flex-col gap-md">
              {activity.map((e) => (
                <li key={e.id} className="flex items-center gap-md rounded-md px-sm py-sm hover:bg-surface-container-low">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-fixed text-brass-600">
                    <span className="material-symbols-outlined text-[20px]" aria-hidden="true">{e.icon}</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-body-sm text-body-sm text-ink-900">{e.description}</p>
                  </div>
                  <Link href={`/project/${e.projectId}`} className="font-mono text-[12px] text-ink-500 hover:text-brass-600">
                    {relativeTime(e.when)}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Portfolio grid/list — the working core (filters/sort/search/bulk). */}
      <PortfolioBrowser
        projects={sorted}
        counts={counts}
        filter={[...filter]}
        sort={sort}
        initialView={view}
        embedded
      />
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  delta,
  deltaTone,
}: {
  label: string;
  value: string;
  delta: string;
  deltaTone: "tertiary" | "muted" | "brass";
}) {
  return (
    <div className="flex h-full flex-col rounded-lg border border-ink-100 bg-paper p-lg">
      <p className="label-caps mb-md text-ink-500">{label}</p>
      <p className="font-display text-[40px] leading-none tabular-nums text-ink-900">{value}</p>
      <p
        className={cn(
          "mt-sm font-body-sm text-body-sm",
          deltaTone === "tertiary" && "text-tertiary",
          deltaTone === "brass" && "text-brass-600",
          deltaTone === "muted" && "text-on-surface-variant",
        )}
      >
        {delta}
      </p>
    </div>
  );
}
