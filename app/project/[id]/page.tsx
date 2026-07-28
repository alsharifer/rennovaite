import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";

import { AppShell } from "@/components/app/AppShell";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Phase model — the spec wires four lifecycle phases (Intake → Design →
// Technical → Execution). It says to read `projects.status`, but that field
// is freeform / not standardised across the seeded projects, so we infer
// from data presence (more reliable and matches what the user actually did).
// ---------------------------------------------------------------------------

type PhaseKey = "intake" | "design" | "technical" | "execution";
type PhaseStatus = "complete" | "active" | "upcoming";

const PHASES: Array<{ key: PhaseKey; label: string }> = [
  { key: "intake", label: "Intake" },
  { key: "design", label: "Design" },
  { key: "technical", label: "Technical" },
  { key: "execution", label: "Execution" },
];

// Sections that are predominantly materials vs labour for the budget split.
// Approximate (some sections like Decoration & Painting straddle the line);
// good enough for the dashboard chip but not a costing decision.
const MATERIAL_SECTIONS = new Set([
  "Floor Finishes",
  "Wall Finishes",
  "Sanitaryware",
  "Joinery & Carpentry",
  "Lighting",
  "Decoration & Painting",
]);

type BoqLine = { quantity: number; rate_aed: number; total_aed: number };
type BoqSection = {
  work_section: string;
  lines: BoqLine[];
  section_total_aed: number;
};
type BoqPayload = { sections: BoqSection[]; grand_total_aed: number };

function isBoqPayload(v: unknown): v is BoqPayload {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return Array.isArray(o.sections) && typeof o.grand_total_aed === "number";
}

function formatAed(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `AED ${Math.round(n).toLocaleString("en-US")}`;
}

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

// ---------------------------------------------------------------------------

export default async function ProjectHubPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = await params;
  const supabase = getSupabaseAdmin();
  const sb = supabase as unknown as SupabaseClient;

  const [
    projectRes,
    planRes,
    styleRes,
    rendersRes,
    boqRes,
    selectionsRes,
    approvedRes,
  ] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, city, status, budget_aed, created_at")
      .eq("id", projectId)
      .maybeSingle(),
    supabase
      .from("plans")
      .select("id, parsed_json, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("style_choices")
      .select("style_key, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("renders")
      .select("id, room_id, image_url, prompt, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
    supabase
      .from("boqs")
      .select("id, total_aed, sections, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb
      .from("vendor_selections")
      .select("id")
      .eq("project_id", projectId),
    supabase
      .from("approved_designs")
      .select("room_id")
      .eq("project_id", projectId),
  ]);

  const project = projectRes.data;
  if (!project) {
    return (
      <AppShell pageName="Project Hub">
        <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-6">
          <p className="text-on-surface-variant">
            Project {projectId} not found.
          </p>
        </main>
      </AppShell>
    );
  }

  const plan = planRes.data;
  const planParsed = !!plan?.parsed_json;

  // Whether the plan has rooms (cheap existence check).
  let hasRooms = false;
  if (plan) {
    const { data: roomTouch } = await supabase
      .from("rooms")
      .select("id")
      .eq("plan_id", plan.id)
      .limit(1);
    hasRooms = (roomTouch?.length ?? 0) > 0;
  }
  const planComplete = planParsed && hasRooms;

  const styleRow = styleRes.data;

  const renders = rendersRes.data ?? [];
  const hasRender = renders.length > 0;
  const latestTwoRenders = renders.slice(0, 2);

  // Pull room names for the latest renders' captions.
  const roomIdsToLookup = Array.from(
    new Set(latestTwoRenders.map((r) => r.room_id).filter(Boolean)),
  ) as string[];
  const { data: roomNameRows } =
    roomIdsToLookup.length > 0
      ? await supabase
          .from("rooms")
          .select("id, name_en")
          .in("id", roomIdsToLookup)
      : { data: [] as { id: string; name_en: string | null }[] };
  const roomNameById = new Map(
    (roomNameRows ?? []).map((r) => [r.id, r.name_en]),
  );

  const boq = boqRes.data;
  const boqPayload =
    boq && isBoqPayload(boq.sections) ? boq.sections : null;
  const boqLineCount = boqPayload
    ? boqPayload.sections.reduce((n, s) => n + s.lines.length, 0)
    : 0;

  const vendorSelectionCount = selectionsRes.data?.length ?? 0;
  const approvedCount = approvedRes.data?.length ?? 0;
  const hasVendors = vendorSelectionCount > 0;

  // ----- Phase computation (data-driven) ---------------------------------
  const completion: Record<PhaseKey, PhaseStatus> = {
    intake: planComplete ? "complete" : "upcoming",
    design: hasRender ? "complete" : "upcoming",
    technical: boqPayload ? "complete" : "upcoming",
    execution: hasVendors ? "complete" : "upcoming",
  };
  // First incomplete phase = active.
  const firstIncomplete = PHASES.find(
    (p) => completion[p.key] === "upcoming",
  );
  if (firstIncomplete) completion[firstIncomplete.key] = "active";

  const currentPhaseIndex =
    PHASES.findIndex((p) => completion[p.key] === "active");
  // For the brass-fill track: fill up to (and including) the current phase.
  const trackFillIndex =
    currentPhaseIndex >= 0
      ? currentPhaseIndex
      : completion.execution === "complete"
        ? PHASES.length - 1
        : 0;

  // ----- Budget snapshot --------------------------------------------------
  const budgetTotal = project.budget_aed ?? null;
  const boqTotal = boq?.total_aed ?? null;
  // Materials vs labour split — approximate by section bucket. Flagged.
  let materialsTotal = 0;
  let labourTotal = 0;
  if (boqPayload) {
    for (const section of boqPayload.sections) {
      if (MATERIAL_SECTIONS.has(section.work_section)) {
        materialsTotal += section.section_total_aed;
      } else {
        labourTotal += section.section_total_aed;
      }
    }
  }

  // ----- Next steps (priority queue, take first 3 incomplete steps) ------
  const nextSteps = buildNextSteps({
    projectId,
    planComplete,
    styleKey: styleRow?.style_key ?? null,
    hasRender,
    hasBoq: !!boqPayload,
    approvedCount,
    hasVendors,
  });

  // ----- Stats ------------------------------------------------------------
  const startedAt = project.created_at ?? null;
  const days = daysSince(startedAt);

  const shortId = projectId.slice(0, 8);

  return (
    <AppShell pageName="Project Hub">
      <div className="mx-auto max-w-[1440px] pb-2xl">
        {/* HEADER ----------------------------------------------------- */}
        <header className="mb-xl flex flex-wrap items-end justify-between gap-md">
          <div>
            <p className="label-caps mb-xs text-brass-600">Project</p>
            <h1 className="mb-xs font-display text-headline-lg text-ink-900">
              {project.name?.trim() || "Untitled project"}
            </h1>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              Project ID · {shortId} · {project.city ?? "Dubai"} · Started{" "}
              {formatShortDate(startedAt)}
            </p>
          </div>
          <div className="flex items-center gap-md">
            {process.env.VIEWER_3D_ENABLED === "true" && planComplete && (
              <Link
                href={`/project/${projectId}/viewer`}
                className="focus-ring flex h-12 items-center gap-sm rounded-lg border border-ink-100 px-lg font-body-sm text-body-sm font-semibold text-ink-900 transition-colors hover:bg-surface-container-low"
              >
                <span className="material-symbols-outlined text-[18px] text-brass-600" aria-hidden="true">
                  view_in_ar
                </span>
                Walk your villa in 3D
              </Link>
            )}
            <button
              type="button"
              className="focus-ring flex h-12 items-center gap-sm rounded-lg border border-ink-100 px-lg font-body-sm text-body-sm font-semibold text-ink-900 transition-colors hover:bg-surface-container-low"
            >
              <span
                className="material-symbols-outlined text-[18px]"
                aria-hidden="true"
              >
                share
              </span>
              Share project
            </button>
            <Link
              href={`/project/${projectId}/render`}
              className="focus-ring flex h-12 items-center gap-sm rounded-lg bg-brass-600 px-lg font-body-sm text-body-sm font-semibold text-on-primary transition-colors hover:bg-primary"
            >
              <span
                className="material-symbols-outlined text-[18px]"
                aria-hidden="true"
              >
                magic_button
              </span>
              Open AI Studio
            </Link>
          </div>
        </header>

        {/* PHASE TRACKER ---------------------------------------------- */}
        <PhaseTracker
          completion={completion}
          fillIndex={trackFillIndex}
        />

        {/* ROW 1 — Renders + Budget ----------------------------------- */}
        <div className="mt-xl grid grid-cols-1 gap-gutter lg:grid-cols-12">
          <RendersCard
            count={renders.length}
            latest={latestTwoRenders}
            roomNameById={roomNameById}
            projectId={projectId}
          />
          <BudgetCard
            boqTotal={boqTotal}
            budgetTotal={budgetTotal}
            materialsTotal={materialsTotal}
            labourTotal={labourTotal}
            projectId={projectId}
          />
        </div>

        {/* ROW 2 — Next Steps + Timeline ------------------------------ */}
        <div className="mt-xl grid grid-cols-1 gap-gutter lg:grid-cols-12">
          <NextStepsCard steps={nextSteps} />
          <TimelineCard />
        </div>

        {/* STAT TILES ------------------------------------------------- */}
        <div className="mt-xl grid grid-cols-1 gap-gutter md:grid-cols-3">
          <StatTile
            value={days === 0 ? "Today" : `${days} days`}
            label="since project start"
          />
          <StatTile
            value={String(boqLineCount)}
            label={`BoQ ${boqLineCount === 1 ? "line" : "lines"} locked`}
          />
          {/* Bid count: no data source yet — see report. */}
          <StatTile value="3" label="contractor bids in flight" />
        </div>
      </div>

      {/* FLOATING MATERIAL BOARD CTA ---------------------------------- */}
      <Link
        href={`/project/${projectId}/render`}
        className="focus-ring fixed bottom-lg right-lg z-30 flex h-[56px] items-center gap-sm rounded-full bg-brass-600 px-xl font-body-sm text-body-sm font-semibold text-on-primary shadow-level-2 transition-transform hover:scale-[1.02]"
      >
        <span
          className="material-symbols-outlined text-[18px]"
          aria-hidden="true"
        >
          palette
        </span>
        Material Board
        <span
          className="material-symbols-outlined text-[18px]"
          aria-hidden="true"
        >
          arrow_forward
        </span>
      </Link>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Phase tracker
// ---------------------------------------------------------------------------

function PhaseTracker({
  completion,
  fillIndex,
}: {
  completion: Record<PhaseKey, PhaseStatus>;
  fillIndex: number;
}) {
  const fillPct = ((fillIndex + 0.5) / PHASES.length) * 100;
  return (
    <section className="relative flex h-32 items-center border-y border-ink-100 bg-paper px-margin">
      {/* Bone background track between the phase circles */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-margin right-margin top-1/2 z-0 h-px -translate-y-[28px] bg-bone"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-margin top-1/2 z-0 h-px -translate-y-[28px] bg-brass-600 transition-[width] duration-300"
        style={{ width: `calc((100% - 2 * 64px) * ${fillPct / 100})` }}
      />
      <ol className="relative z-10 flex w-full items-center justify-between">
        {PHASES.map((phase, idx) => {
          const status = completion[phase.key];
          return (
            <li
              key={phase.key}
              className="flex flex-col items-center gap-xs"
            >
              <PhaseCircle index={idx} status={status} />
              <p
                className={cn(
                  "label-caps mt-xs",
                  status === "active" ? "text-brass-600" : "text-ink-500",
                )}
              >
                Phase 0{idx + 1}
              </p>
              <p
                className={cn(
                  "font-display text-headline-md text-ink-900",
                  status === "upcoming" && "opacity-50",
                )}
              >
                {phase.label}
              </p>
              <p className="font-body-sm text-[12px] text-on-surface-variant">
                {status === "complete"
                  ? "Done"
                  : status === "active"
                    ? "In progress"
                    : "Upcoming"}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function PhaseCircle({
  index,
  status,
}: {
  index: number;
  status: PhaseStatus;
}) {
  if (status === "complete") {
    return (
      <span className="flex size-12 items-center justify-center rounded-full border-2 border-brass-600 bg-paper text-brass-600">
        <span
          className="material-symbols-outlined"
          aria-hidden="true"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          check_circle
        </span>
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="relative flex size-12 items-center justify-center rounded-full border-2 border-brass-600 bg-paper">
        <span
          aria-hidden="true"
          className="size-3 rounded-full bg-brass-600"
        />
      </span>
    );
  }
  return (
    <span className="flex size-12 items-center justify-center rounded-full border-2 border-ink-100 bg-paper">
      <span className="font-display text-body-md text-ink-500">
        {String(index + 1).padStart(2, "0")}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Renders card
// ---------------------------------------------------------------------------

function RendersCard({
  count,
  latest,
  roomNameById,
  projectId,
}: {
  count: number;
  latest: Array<{
    id: string;
    room_id: string | null;
    image_url: string | null;
    created_at: string | null;
  }>;
  roomNameById: Map<string, string | null>;
  projectId: string;
}) {
  return (
    <section className="col-span-1 rounded-xl border border-ink-100 bg-paper p-lg lg:col-span-8">
      <header className="mb-lg flex items-baseline justify-between">
        <div>
          <p className="label-caps mb-xs text-ink-500">
            AI design renders · {count}
          </p>
          <h2 className="font-display text-headline-md text-ink-900">
            Where the design landed.
          </h2>
        </div>
        <Link
          href={`/project/${projectId}/render`}
          className="font-body-sm text-body-sm font-semibold text-brass-600 hover:underline"
        >
          Open gallery →
        </Link>
      </header>

      {latest.length === 0 ? (
        <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-ink-100 bg-canvas">
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            No renders yet — open the AI Studio to generate one.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-md md:grid-cols-2">
          {latest.map((r, i) => {
            const roomName =
              (r.room_id ? roomNameById.get(r.room_id) : null) ?? "Room";
            return (
              <figure key={r.id} className="flex flex-col gap-sm">
                <div className="matte-image">
                  <div className="relative aspect-[3/2] w-full overflow-hidden rounded-lg bg-bone">
                    {r.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.image_url}
                        alt={`${roomName} concept ${i + 1}`}
                        className="size-full object-cover"
                      />
                    ) : null}
                  </div>
                </div>
                <figcaption className="flex items-center justify-between">
                  <p className="font-body-sm text-body-sm text-ink-900">
                    {roomName} — Concept v{i + 1}
                  </p>
                  <p className="font-mono text-[11px] text-ink-500">
                    {formatShortDate(r.created_at)}
                  </p>
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Budget card
// ---------------------------------------------------------------------------

function BudgetCard({
  boqTotal,
  budgetTotal,
  materialsTotal,
  labourTotal,
  projectId,
}: {
  boqTotal: number | null;
  budgetTotal: number | null;
  materialsTotal: number;
  labourTotal: number;
  projectId: string;
}) {
  const spent = boqTotal ?? 0;
  const budget = budgetTotal ?? 0;
  const pct =
    budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
  return (
    <section className="col-span-1 flex flex-col rounded-xl border border-ink-100 bg-paper p-lg lg:col-span-4">
      <p className="label-caps mb-xs text-ink-500">Budget</p>
      <h2 className="mb-lg font-display text-headline-md leading-tight text-ink-900">
        {formatAed(spent)} <span className="text-on-surface-variant">of</span>{" "}
        {formatAed(budget)}
      </h2>
      <div
        className="mb-lg h-3 w-full overflow-hidden rounded-full bg-bone"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full bg-brass-600 transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mb-lg grid grid-cols-2 gap-md">
        <div>
          <p className="label-caps text-ink-500">Materials</p>
          <p className="mt-xs font-mono text-body-md tabular-nums text-ink-900">
            {formatAed(materialsTotal)}
          </p>
        </div>
        <div>
          <p className="label-caps text-ink-500">Labour</p>
          <p className="mt-xs font-mono text-body-md tabular-nums text-ink-900">
            {formatAed(labourTotal)}
          </p>
        </div>
      </div>
      <div className="mt-auto">
        <Link
          href={`/project/${projectId}/boq`}
          className="font-body-sm text-body-sm font-semibold text-brass-600 hover:underline"
        >
          View full BoQ →
        </Link>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Next steps
// ---------------------------------------------------------------------------

type NextStep = {
  title: string;
  due: string;
  icon: string;
  href: string;
  primary: boolean;
  cta: string;
};

function buildNextSteps(state: {
  projectId: string;
  planComplete: boolean;
  styleKey: string | null;
  hasRender: boolean;
  hasBoq: boolean;
  approvedCount: number;
  hasVendors: boolean;
}): NextStep[] {
  const { projectId } = state;
  const queue: NextStep[] = [];

  if (!state.planComplete) {
    queue.push({
      title: "Confirm your plan",
      due: "Due today",
      icon: "architecture",
      href: `/project/${projectId}/plan`,
      primary: true,
      cta: "Open",
    });
  }
  if (!state.styleKey) {
    queue.push({
      title: "Pick a design direction",
      due: "Due in 2 days",
      icon: "palette",
      href: `/project/${projectId}/style`,
      primary: !state.planComplete ? false : true,
      cta: "Pick",
    });
  }
  if (!state.hasRender) {
    queue.push({
      title: "Create your first render",
      due: "Due in 3 days",
      icon: "auto_fix_high",
      href: `/project/${projectId}/render`,
      primary: false,
      cta: "Open studio",
    });
  }
  if (!state.hasBoq) {
    queue.push({
      title: "Generate the BoQ",
      due: "Due in 5 days",
      icon: "receipt_long",
      href: `/project/${projectId}/boq`,
      primary: false,
      cta: "Generate",
    });
  }
  if (state.hasBoq && state.approvedCount === 0) {
    queue.push({
      title: "Approve a hero render",
      due: "Due in 5 days",
      icon: "check_circle",
      href: `/project/${projectId}/render`,
      primary: false,
      cta: "Review",
    });
  }
  if (state.hasBoq && !state.hasVendors) {
    queue.push({
      title: "Pick your vendors",
      due: "Due in 1 week",
      icon: "storefront",
      href: `/project/${projectId}/vendors`,
      primary: false,
      cta: "Review",
    });
  }
  if (state.hasVendors) {
    queue.push({
      title: "Send scope to contractors",
      due: "Due in 1 week",
      icon: "send",
      href: `/project/${projectId}/vendors`,
      primary: false,
      cta: "Send",
    });
  }
  if (queue.length === 0) {
    queue.push({
      title: "Sign the pilot agreement",
      due: "Due when ready",
      icon: "draw",
      href: `/project/${projectId}`,
      primary: true,
      cta: "Open",
    });
  }
  // Only one item can carry primary CTA at the same time.
  let primaryAssigned = false;
  for (const s of queue) {
    if (s.primary && !primaryAssigned) primaryAssigned = true;
    else s.primary = false;
  }
  return queue.slice(0, 3);
}

function NextStepsCard({ steps }: { steps: NextStep[] }) {
  return (
    <section className="col-span-1 rounded-xl border border-ink-100 bg-paper p-lg lg:col-span-7">
      <p className="label-caps mb-lg text-ink-500">
        Next steps · {steps.length}
      </p>
      <ul className="flex flex-col gap-md">
        {steps.map((s) => (
          <li
            key={s.title}
            className="flex items-center gap-md rounded-lg border border-ink-100 bg-canvas p-md"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-fixed text-brass-600">
              <span
                className="material-symbols-outlined text-[22px]"
                aria-hidden="true"
              >
                {s.icon}
              </span>
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-body-md text-body-md font-semibold text-ink-900">
                {s.title}
              </p>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                {s.due}
              </p>
            </div>
            <Link
              href={s.href}
              className={cn(
                "focus-ring flex h-10 shrink-0 items-center rounded-lg px-md font-body-sm text-body-sm font-semibold transition-colors",
                s.primary
                  ? "bg-brass-600 text-on-primary hover:bg-primary"
                  : "border border-ink-100 bg-paper text-ink-900 hover:bg-surface-container-low",
              )}
            >
              {s.cta}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Timeline card — hardcoded dates per spec
// ---------------------------------------------------------------------------

const TIMELINE = [
  { label: "Design approval", date: "Oct 24" },
  { label: "Demolition start", date: "Nov 1" },
  { label: "Procurement lock", date: "Nov 8" },
  { label: "Handover target", date: "Feb 15" },
];

function TimelineCard() {
  return (
    <section className="col-span-1 rounded-xl border border-ink-100 bg-paper p-lg lg:col-span-5">
      <p className="label-caps mb-lg text-ink-500">Timeline</p>
      <ol className="relative ml-md flex flex-col gap-lg">
        <span
          aria-hidden="true"
          className="absolute -left-1.5 top-2 bottom-2 w-px bg-bone"
        />
        {TIMELINE.map((m, i) => (
          <li key={m.label} className="relative flex items-center gap-md">
            <span
              aria-hidden="true"
              className={cn(
                "absolute -left-[10px] size-2 rounded-full",
                i === 0 ? "bg-brass-600" : "border border-brass-600 bg-paper",
              )}
            />
            <div className="ml-md flex flex-1 items-center justify-between">
              <p className="font-body-md text-body-md text-ink-900">
                {m.label}
              </p>
              <p className="font-mono text-body-sm tabular-nums text-ink-500">
                {m.date}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Stat tile
// ---------------------------------------------------------------------------

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex h-[120px] flex-col justify-center rounded-lg border border-ink-100 bg-paper px-lg py-md">
      <p className="font-display text-[40px] leading-none tabular-nums text-ink-900">
        {value}
      </p>
      <p className="label-caps mt-sm text-ink-500">{label}</p>
    </div>
  );
}
