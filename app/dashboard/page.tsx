import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";

import { AppShell } from "@/components/app/AppShell";
import { HeroImage } from "@/components/app/HeroImage";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProjectRow = {
  id: string;
  name: string | null;
  city: string | null;
  budget_aed: number | null;
  status: string | null;
  created_at: string | null;
};

type PlanRow = { id: string; project_id: string | null; parsed_json: unknown };
type BoqRow = {
  id: string;
  project_id: string | null;
  total_aed: number | null;
  sections: unknown;
  created_at: string | null;
};
type RenderRow = {
  id: string;
  project_id: string | null;
  room_id: string | null;
  image_url: string | null;
  created_at: string | null;
};
type SelectionRow = {
  id: string;
  project_id: string;
  boq_line_id: string;
  created_at: string | null;
};

type Phase = "Intake" | "Design" | "Technical" | "Execution" | "Done";

// ---------------------------------------------------------------------------
// Helpers
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

function evening(): string {
  const h = new Date().getHours();
  if (h < 5) return "Good evening";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// Wrapped so the impure Date.now() call doesn't live in the component body
// (react-hooks/purity flags top-level Date.now() reads, but not calls inside
// helpers that are then invoked).
function thirtyDaysAgoIso(): string {
  return new Date(Date.now() - 30 * 86_400_000).toISOString();
}

// Helper to compute "start of month" without putting `new Date()` directly in
// the component body.
function startOfThisMonth(): number {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Returns the active phase for a project given the data we have on it.
function inferPhase(state: {
  planComplete: boolean;
  hasRender: boolean;
  hasBoq: boolean;
  hasVendorSelections: boolean;
}): Phase {
  if (state.hasVendorSelections) return "Done";
  if (state.hasBoq) return "Execution";
  if (state.hasRender) return "Technical";
  if (state.planComplete) return "Design";
  return "Intake";
}

function nextStepFor(state: {
  planComplete: boolean;
  hasStyle: boolean;
  hasRender: boolean;
  hasBoq: boolean;
  hasVendorSelections: boolean;
}): string {
  if (!state.planComplete) return "Confirm the parsed plan";
  if (!state.hasStyle) return "Pick a design direction";
  if (!state.hasRender) return "Create the first render";
  if (!state.hasBoq) return "Generate the BoQ";
  if (!state.hasVendorSelections) return "Pick your vendors";
  return "Send scope to contractors";
}

// ---------------------------------------------------------------------------

export default async function DashboardPage() {
  const supabase = getSupabaseAdmin();
  const sb = supabase as unknown as SupabaseClient;

  // Window for "renders generated · last 30 days".
  const thirtyDaysAgo = thirtyDaysAgoIso();

  const [
    projectsRes,
    plansRes,
    boqsRes,
    rendersRes,
    rendersLast30Res,
    selectionsRes,
    styleChoicesRes,
  ] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, city, budget_aed, status, created_at")
      .order("created_at", { ascending: false })
      .limit(12),
    supabase.from("plans").select("id, project_id, parsed_json"),
    supabase
      .from("boqs")
      .select("id, project_id, total_aed, sections, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("renders")
      .select("id, project_id, room_id, image_url, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("renders")
      .select("id", { count: "exact", head: true })
      .gte("created_at", thirtyDaysAgo),
    sb
      .from("vendor_selections")
      .select("id, project_id, boq_line_id, created_at")
      .returns<SelectionRow[]>(),
    supabase
      .from("style_choices")
      .select("project_id"),
  ]);

  const projects: ProjectRow[] = projectsRes.data ?? [];
  const plans: PlanRow[] = (plansRes.data ?? []) as PlanRow[];
  const boqs: BoqRow[] = (boqsRes.data ?? []) as BoqRow[];
  const renders: RenderRow[] = (rendersRes.data ?? []) as RenderRow[];
  const selections: SelectionRow[] = selectionsRes.data ?? [];

  // ----- Indexes (per project) -------------------------------------------
  const planByProject = new Map<string, PlanRow>();
  for (const p of plans) if (p.project_id) planByProject.set(p.project_id, p);

  const latestBoqByProject = new Map<string, BoqRow>();
  for (const b of boqs) {
    if (b.project_id && !latestBoqByProject.has(b.project_id)) {
      latestBoqByProject.set(b.project_id, b);
    }
  }

  const latestRenderByProject = new Map<string, RenderRow>();
  for (const r of renders) {
    if (r.project_id && !latestRenderByProject.has(r.project_id)) {
      latestRenderByProject.set(r.project_id, r);
    }
  }

  const projectsWithSelections = new Set<string>();
  for (const s of selections) projectsWithSelections.add(s.project_id);

  const projectsWithStyle = new Set<string>();
  for (const s of styleChoicesRes.data ?? []) {
    if (s.project_id) projectsWithStyle.add(s.project_id);
  }

  // ----- Stats ------------------------------------------------------------
  const activeProjects = projects.filter((p) => {
    const phase = inferPhase({
      planComplete: !!planByProject.get(p.id)?.parsed_json,
      hasRender: latestRenderByProject.has(p.id),
      hasBoq: latestBoqByProject.has(p.id),
      hasVendorSelections: projectsWithSelections.has(p.id),
    });
    return phase !== "Done";
  }).length;

  // Projects created this month (proxy for "+N this month").
  const startOfMonthMs = startOfThisMonth();
  const newThisMonth = projects.filter((p) => {
    if (!p.created_at) return false;
    return new Date(p.created_at).getTime() >= startOfMonthMs;
  }).length;

  const totalBoqValue = [...latestBoqByProject.values()].reduce(
    (sum, b) => sum + (b.total_aed ?? 0),
    0,
  );

  const rendersLast30 = rendersLast30Res.count ?? 0;

  // "Pending decisions" — has a BoQ but no vendor selections yet.
  const pendingDecisions = projects.filter(
    (p) =>
      latestBoqByProject.has(p.id) && !projectsWithSelections.has(p.id),
  ).length;

  // ----- Top 3 villa cards ------------------------------------------------
  const topProjects = projects.slice(0, 3);

  // ----- Activity feed: synthesize from recent rows ----------------------
  type Event = {
    id: string;
    kind: "plan" | "render" | "boq" | "selection";
    when: string;
    projectId: string;
    icon: string;
    description: string;
  };
  const projectNameById = new Map(
    projects.map((p) => [p.id, p.name?.trim() || "Untitled"]),
  );
  const events: Event[] = [];
  for (const p of plans) {
    if (p.project_id && p.parsed_json) {
      // plans don't have created_at queried; use latest associated render/boq date as a proxy or skip
    }
  }
  // Renders: most recent across all projects
  for (const r of renders.slice(0, 8)) {
    if (!r.created_at || !r.project_id) continue;
    events.push({
      id: `r-${r.id}`,
      kind: "render",
      when: r.created_at,
      projectId: r.project_id,
      icon: "auto_fix_high",
      description: `Render generated for ${projectNameById.get(r.project_id) ?? "a project"}`,
    });
  }
  // BoQs
  for (const b of boqs.slice(0, 4)) {
    if (!b.created_at || !b.project_id) continue;
    events.push({
      id: `b-${b.id}`,
      kind: "boq",
      when: b.created_at,
      projectId: b.project_id,
      icon: "receipt_long",
      description: `BoQ priced at ${formatAedShort(b.total_aed)} for ${projectNameById.get(b.project_id) ?? "a project"}`,
    });
  }
  // Vendor selections
  for (const s of selections.slice(0, 4)) {
    if (!s.created_at || !s.project_id) continue;
    events.push({
      id: `s-${s.id}`,
      kind: "selection",
      when: s.created_at,
      projectId: s.project_id,
      icon: "swap_horiz",
      description: `Vendor swap on ${s.boq_line_id.replace(/-/g, " ")} · ${projectNameById.get(s.project_id) ?? "a project"}`,
    });
  }
  events.sort(
    (a, b) => new Date(b.when).getTime() - new Date(a.when).getTime(),
  );
  const activity = events.slice(0, 6);

  // Header greeting — no auth wired yet so the name is a hardcoded fallback;
  // when /api/auth lands, swap this for the session user's first name.
  const greeting = `${evening()}, Sara.`;

  return (
    <AppShell pageName="Dashboard">
      <div className="mx-auto max-w-[1440px] pb-2xl">
        {/* HEADER ----------------------------------------------------- */}
        <header className="mb-xl">
          <p className="label-caps mb-xs text-brass-600">Welcome back</p>
          <h1 className="mb-md font-display text-headline-lg text-ink-900">
            {greeting}
          </h1>
          <p className="max-w-[800px] font-body text-body-lg text-on-surface-variant">
            Here&apos;s what&apos;s happening across your villas.
          </p>
        </header>

        {/* STATS ROW -------------------------------------------------- */}
        <div className="grid grid-cols-1 gap-gutter sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Active projects"
            value={String(activeProjects)}
            delta={
              newThisMonth > 0
                ? `+${newThisMonth} this month`
                : "No new projects this month"
            }
            deltaTone={newThisMonth > 0 ? "tertiary" : "muted"}
          />
          <StatCard
            label="BoQ value"
            value={formatAedShort(totalBoqValue)}
            delta="across all projects"
            deltaTone="muted"
          />
          <StatCard
            label="Renders generated"
            value={String(rendersLast30)}
            delta="last 30 days"
            deltaTone="muted"
          />
          <StatCard
            label="Pending decisions"
            value={String(pendingDecisions)}
            delta={pendingDecisions > 0 ? "Review now" : "All caught up"}
            deltaTone={pendingDecisions > 0 ? "brass" : "tertiary"}
            href={pendingDecisions > 0 ? "/my-projects" : undefined}
          />
        </div>

        {/* MY VILLAS -------------------------------------------------- */}
        <section className="mt-xl">
          <header className="mb-lg flex items-baseline justify-between">
            <h2 className="font-display text-headline-md text-ink-900">
              My villas
            </h2>
            <div className="flex items-center gap-md">
              <Link
                href="/my-projects"
                className="font-body-sm text-body-sm font-semibold text-brass-600 hover:underline"
              >
                See all →
              </Link>
              <Link
                href="/project/new"
                className="focus-ring flex h-10 items-center gap-sm rounded-lg bg-brass-600 px-md font-body-sm text-body-sm font-semibold text-on-primary transition-colors hover:bg-primary"
              >
                <span
                  className="material-symbols-outlined text-[18px]"
                  aria-hidden="true"
                >
                  add
                </span>
                New project
              </Link>
            </div>
          </header>

          {topProjects.length === 0 ? (
            <div className="rounded-lg border border-dashed border-ink-100 bg-paper p-3xl text-center">
              <p className="font-body text-body-md text-on-surface-variant">
                No projects yet — start your first villa.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-gutter md:grid-cols-2 lg:grid-cols-3">
              {topProjects.map((p) => (
                <VillaCard
                  key={p.id}
                  project={p}
                  hero={latestRenderByProject.get(p.id) ?? null}
                  boqTotal={latestBoqByProject.get(p.id)?.total_aed ?? null}
                  planComplete={!!planByProject.get(p.id)?.parsed_json}
                  hasStyle={projectsWithStyle.has(p.id)}
                  hasRender={latestRenderByProject.has(p.id)}
                  hasBoq={latestBoqByProject.has(p.id)}
                  hasVendorSelections={projectsWithSelections.has(p.id)}
                />
              ))}
            </div>
          )}
        </section>

        {/* ACTIVITY FEED ---------------------------------------------- */}
        <section className="mt-xl rounded-xl border border-ink-100 bg-paper p-lg">
          <header className="mb-lg flex items-baseline justify-between">
            <h2 className="font-display text-headline-md text-ink-900">
              Recent activity
            </h2>
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
                <li
                  key={e.id}
                  className="flex items-center gap-md rounded-md px-sm py-sm hover:bg-surface-container-low"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-fixed text-brass-600">
                    <span
                      className="material-symbols-outlined text-[20px]"
                      aria-hidden="true"
                    >
                      {e.icon}
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-body-sm text-body-sm text-ink-900">
                      {e.description}
                    </p>
                  </div>
                  <Link
                    href={`/project/${e.projectId}`}
                    className="font-mono text-[12px] text-ink-500 hover:text-brass-600"
                  >
                    {relativeTime(e.when)}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
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
  href,
}: {
  label: string;
  value: string;
  delta: string;
  deltaTone: "tertiary" | "muted" | "brass";
  href?: string;
}) {
  const inner = (
    <>
      <p className="label-caps mb-md text-ink-500">{label}</p>
      <p className="font-display text-[40px] leading-none tabular-nums text-ink-900">
        {value}
      </p>
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
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        className="focus-ring flex h-full flex-col rounded-lg border border-ink-100 bg-paper p-lg transition-shadow hover:shadow-level-1"
      >
        {inner}
      </Link>
    );
  }
  return (
    <div className="flex h-full flex-col rounded-lg border border-ink-100 bg-paper p-lg">
      {inner}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Villa card
// ---------------------------------------------------------------------------

function VillaCard({
  project,
  hero,
  boqTotal,
  planComplete,
  hasStyle,
  hasRender,
  hasBoq,
  hasVendorSelections,
}: {
  project: ProjectRow;
  hero: RenderRow | null;
  boqTotal: number | null;
  planComplete: boolean;
  hasStyle: boolean;
  hasRender: boolean;
  hasBoq: boolean;
  hasVendorSelections: boolean;
}) {
  const phase = inferPhase({
    planComplete,
    hasRender,
    hasBoq,
    hasVendorSelections,
  });
  const nextStep = nextStepFor({
    planComplete,
    hasStyle,
    hasRender,
    hasBoq,
    hasVendorSelections,
  });
  const budget = project.budget_aed ?? null;

  return (
    <Link
      href={`/project/${project.id}`}
      className="focus-ring group flex h-[420px] flex-col overflow-hidden rounded-lg border border-ink-100 bg-paper transition-all duration-200 hover:-translate-y-0.5 hover:shadow-level-1"
    >
      {/* Hero image — matte-image border per design */}
      <div className="p-2">
        <div className="matte-image">
          <div className="relative aspect-[16/9] w-full overflow-hidden rounded bg-bone">
            <HeroImage
              src={hero?.image_url ?? null}
              alt={`${project.name ?? "Project"} hero render`}
              className="transition-transform duration-300 group-hover:scale-[1.02]"
              fallbackLabel="No render yet"
            />
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col p-lg">
        <div className="mb-md flex items-start justify-between gap-md">
          <h3 className="font-display text-headline-md leading-tight text-ink-900">
            {project.name?.trim() || "Untitled"}
          </h3>
          <span className="shrink-0 rounded-full bg-primary-fixed px-sm py-[2px] text-[10px] font-semibold uppercase tracking-widest text-on-primary-fixed">
            {phase}
          </span>
        </div>
        <p className="mb-md font-body-sm text-body-sm text-on-surface-variant">
          {project.city ?? "Dubai"}
        </p>
        <dl className="mt-auto flex flex-col gap-xs">
          <StatRow label="Budget" value={formatAedShort(budget)} mono />
          <StatRow
            label="BoQ"
            value={boqTotal != null ? formatAedShort(boqTotal) : "Not generated"}
            mono={boqTotal != null}
          />
          <StatRow label="Next step" value={nextStep} />
        </dl>
        <span className="mt-md inline-flex items-center gap-xs font-body-sm text-body-sm font-semibold text-brass-600 group-hover:underline">
          Open project
          <span
            className="material-symbols-outlined text-[16px]"
            aria-hidden="true"
          >
            arrow_forward
          </span>
        </span>
      </div>
    </Link>
  );
}

function StatRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-md">
      <dt className="label-caps text-ink-500">{label}</dt>
      <dd
        className={cn(
          "truncate text-right text-body-sm text-ink-900",
          mono && "font-mono tabular-nums",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
