import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { FadeIn } from "@/app/_components/fade-in";
import { AppShell } from "@/components/app/AppShell";
import { BackButton } from "@/components/back-button";
import { Button } from "@/components/ui/button";
import { getStyleByKey } from "@/lib/styles";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { cn } from "@/lib/utils";

import { EditableProjectName } from "./plan/_components/editable-project-name";

export const dynamic = "force-dynamic";

const PHASES = [
  { key: "plan", label: "Plan" },
  { key: "style", label: "Style" },
  { key: "render", label: "Render" },
  { key: "boq", label: "BoQ" },
] as const;

type PhaseKey = (typeof PHASES)[number]["key"];
type PhaseStatus = "complete" | "active" | "upcoming";

type PhaseSnapshot = {
  status: PhaseStatus;
  completedAt: string | null;
};

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatAED(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `AED ${Math.round(value).toLocaleString("en-AE")}`;
}

export default async function ProjectDashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = await params;
  const supabase = getSupabaseAdmin();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, status, budget_aed")
    .eq("id", projectId)
    .maybeSingle();

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

  const { data: latestPlan } = await supabase
    .from("plans")
    .select("id, parsed_json, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const planExists = !!latestPlan;
  const parsedComplete = !!latestPlan?.parsed_json;

  const { data: roomCountRow } = latestPlan
    ? await supabase
        .from("rooms")
        .select("id", { count: "exact", head: false })
        .eq("plan_id", latestPlan.id)
        .limit(1)
    : { data: [] as { id: string }[] };
  // (Above fetches at most one row to verify rooms exist; we don't need
  // the full list on the dashboard.)
  const hasRooms = (roomCountRow?.length ?? 0) > 0;

  const planComplete = parsedComplete && hasRooms;

  const { data: styleRows } = await supabase
    .from("style_choices")
    .select("style_key, created_at")
    .eq("project_id", projectId)
    .is("room_id", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const styleRow = styleRows?.[0] ?? null;
  const styleKey = styleRow?.style_key ?? null;
  const styleObj = styleKey ? (getStyleByKey(styleKey) ?? null) : null;

  // Latest render across all rooms of the project.
  const { data: renderRows } = await supabase
    .from("renders")
    .select("id, room_id, image_url, prompt, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1);
  const latestRender = renderRows?.[0] ?? null;

  // Look up the room name for the latest render so we can caption it.
  const { data: latestRenderRoom } = latestRender?.room_id
    ? await supabase
        .from("rooms")
        .select("name_en")
        .eq("id", latestRender.room_id)
        .maybeSingle()
    : { data: null };

  const { data: boqRows } = await supabase
    .from("boqs")
    .select("id, total_aed, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1);
  const latestBoq = boqRows?.[0] ?? null;

  // ----- Phase computation -------------------------------------------------
  const completion: Record<PhaseKey, PhaseSnapshot> = {
    plan: planComplete
      ? { status: "complete", completedAt: latestPlan?.created_at ?? null }
      : { status: "upcoming", completedAt: null },
    style: styleKey
      ? { status: "complete", completedAt: styleRow?.created_at ?? null }
      : { status: "upcoming", completedAt: null },
    render: latestRender
      ? { status: "complete", completedAt: latestRender.created_at }
      : { status: "upcoming", completedAt: null },
    boq: latestBoq
      ? { status: "complete", completedAt: latestBoq.created_at }
      : { status: "upcoming", completedAt: null },
  };

  // First incomplete phase = active.
  const firstIncomplete = PHASES.find(
    (p) => completion[p.key].status === "upcoming",
  );
  if (firstIncomplete) {
    completion[firstIncomplete.key] = {
      status: "active",
      completedAt: null,
    };
  }

  // ----- Next-action CTA ---------------------------------------------------
  const nextAction = computeNextAction(projectId, {
    planExists,
    planComplete,
    styleKey,
    hasRender: !!latestRender,
    hasBoq: !!latestBoq,
  });

  // ----- Budget snapshot ---------------------------------------------------
  const budgetTotal = project.budget_aed ?? null;
  const boqTotal = latestBoq?.total_aed ?? null;
  const budgetUsedPct =
    budgetTotal && boqTotal ? Math.round((boqTotal / budgetTotal) * 100) : null;
  const overBudget = boqTotal != null && budgetTotal != null && boqTotal > budgetTotal;
  const budgetDeltaPct =
    boqTotal && budgetTotal
      ? Math.round(((boqTotal - budgetTotal) / budgetTotal) * 100)
      : null;

  return (
    <AppShell pageName="Project Hub">
      <main className="flex min-h-[calc(100vh-4rem)] justify-center px-6 py-12 md:px-12 md:py-16">
        <FadeIn className="w-full max-w-[1200px] space-y-12">
          <BackButton />

          {/* ROW 1 — Header + primary CTA. No card, full-width. */}
          <header className="flex flex-wrap items-center justify-between gap-6">
            <EditableProjectName
              projectId={project.id}
              initialName={project.name?.trim() || "Untitled"}
              className="text-h2"
            />
            <Button
              size="lg"
              nativeButton={false}
              render={<Link href={nextAction.href} />}
              className="shrink-0 transition-transform duration-150 hover:scale-[1.02] active:scale-[0.98]"
            >
              {nextAction.label}
              <ArrowRight />
            </Button>
          </header>

          {/* ROW 2 — Phase tracker. */}
          <PhaseTracker completion={completion} projectId={project.id} />

          {/*
            ROW 3 — gated. We only render this row when the project has
            either a render or a BoQ; before that, both cards would just
            be empty placeholders that work against the dashboard's
            "what's the next thing I do?" brief.

            Layout is 3fr/2fr (lg+) so the render is the dominant
            element on the row — the budget number sits as a sidebar.
          */}
          {(latestRender || latestBoq) && (
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-[3fr_2fr]">
              <LatestRenderCard
                imageUrl={latestRender?.image_url ?? null}
                roomName={latestRenderRoom?.name_en ?? null}
                styleName={styleObj?.name_en ?? null}
                projectId={project.id}
              />
              <BudgetSnapshotCard
                boqTotal={boqTotal}
                budgetTotal={budgetTotal}
                usedPct={budgetUsedPct}
                deltaPct={budgetDeltaPct}
                overBudget={overBudget}
                projectId={project.id}
              />
            </div>
          )}
        </FadeIn>
      </main>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------

function computeNextAction(
  projectId: string,
  state: {
    planExists: boolean;
    planComplete: boolean;
    styleKey: string | null;
    hasRender: boolean;
    hasBoq: boolean;
  },
): { label: string; href: string } {
  if (!state.planExists) {
    return { label: "Upload your plan", href: "/project" };
  }
  if (!state.planComplete) {
    return { label: "Confirm your plan", href: `/project/${projectId}/plan` };
  }
  if (!state.styleKey) {
    return { label: "Pick a style", href: `/project/${projectId}/style` };
  }
  if (!state.hasRender) {
    return {
      label: "Create your first render",
      href: `/project/${projectId}/render`,
    };
  }
  if (!state.hasBoq) {
    return { label: "Generate the BoQ", href: `/project/${projectId}/boq` };
  }
  return { label: "Send to contractors", href: `/project/${projectId}/vendors` };
}

// ---------------------------------------------------------------------------

function PhaseTracker({
  completion,
  projectId,
}: {
  completion: Record<PhaseKey, PhaseSnapshot>;
  projectId: string;
}) {
  return (
    <section className="neo-raised rounded-2xl border border-outline-variant bg-surface-container p-8">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-4">
        {PHASES.map((phase) => {
          const snap = completion[phase.key];
          return (
            <PhaseChip
              key={phase.key}
              label={phase.label}
              status={snap.status}
              completedAt={snap.completedAt}
              href={`/project/${projectId}/${phase.key}`}
            />
          );
        })}
      </div>
    </section>
  );
}

function PhaseChip({
  label,
  status,
  completedAt,
  href,
}: {
  label: string;
  status: PhaseStatus;
  completedAt: string | null;
  href: string;
}) {
  const labelColor =
    status === "active"
      ? "text-indigo-400"
      : status === "complete"
        ? "text-on-surface"
        : "text-slate-500";
  const dateLine =
    status === "complete"
      ? completedAt
        ? `Completed ${formatDate(completedAt)}`
        : "Completed"
      : status === "active"
        ? "In progress"
        : "Upcoming";

  const inner = (
    <>
      <div className="flex items-center gap-2">
        <PhaseIndicator status={status} />
        <span className={cn("text-label-md font-semibold", labelColor)}>
          {label}
        </span>
      </div>
      <p className="text-label-sm text-on-surface-variant">{dateLine}</p>
    </>
  );

  // Active and completed phases have a destination (their respective page).
  // Upcoming phases stay inert — there's nothing useful to click into yet.
  // The negative-margin/padding trick gives a subtle hover affordance
  // without enlarging the chip's resting footprint.
  if (status === "upcoming") {
    return <div className="flex flex-col gap-2">{inner}</div>;
  }

  return (
    <Link
      href={href}
      className="-m-2 flex flex-col gap-2 rounded-lg p-2 transition-colors duration-150 hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30"
    >
      {inner}
    </Link>
  );
}

function PhaseIndicator({ status }: { status: PhaseStatus }) {
  if (status === "complete") {
    return (
      <span
        className="material-symbols-outlined text-base text-emerald-400"
        style={{ fontVariationSettings: "'FILL' 1" }}
        aria-label="Completed"
      >
        check_circle
      </span>
    );
  }
  if (status === "active") {
    return (
      <span
        className="block size-2.5 rounded-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.6)]"
        aria-label="In progress"
      />
    );
  }
  return (
    <span
      className="block size-2.5 rounded-full border border-slate-700"
      aria-label="Upcoming"
    />
  );
}

// ---------------------------------------------------------------------------

function LatestRenderCard({
  imageUrl,
  roomName,
  styleName,
  projectId,
}: {
  imageUrl: string | null;
  roomName: string | null;
  styleName: string | null;
  projectId: string;
}) {
  return (
    <article className="flex flex-col rounded-2xl border border-outline-variant bg-surface-container p-6">
      <h2 className="text-label-md text-on-surface-variant">Latest render</h2>
      <div className="mt-4 aspect-[16/9] overflow-hidden rounded-xl bg-surface">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={`${styleName ?? "Latest"} render of ${roomName ?? "a room"}`}
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-label-sm text-on-surface-variant">
            No renders yet
          </div>
        )}
      </div>
      <div className="mt-4 flex items-end justify-between gap-3">
        <p className="text-label-md text-on-surface">
          {roomName?.trim() ? roomName : "—"}
          {styleName ? ` — ${styleName}` : ""}
        </p>
        <Link
          href={`/project/${projectId}/render`}
          className="group inline-flex shrink-0 items-center gap-1 rounded-md text-label-sm text-indigo-400 transition-colors hover:text-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
        >
          Open studio
          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------

function BudgetSnapshotCard({
  boqTotal,
  budgetTotal,
  usedPct,
  deltaPct,
  overBudget,
  projectId,
}: {
  boqTotal: number | null;
  budgetTotal: number | null;
  usedPct: number | null;
  deltaPct: number | null;
  overBudget: boolean;
  projectId: string;
}) {
  const totalDisplay = boqTotal != null ? formatAED(boqTotal) : "—";
  const totalColor = boqTotal == null
    ? "text-on-surface-variant"
    : overBudget
      ? "text-status-error"
      : "text-indigo-400";

  return (
    <article className="flex flex-col rounded-2xl border border-outline-variant bg-surface-container p-6">
      <h2 className="text-label-md text-on-surface-variant">Budget snapshot</h2>

      <p className={cn("mt-4 text-h2 leading-none", totalColor)}>
        {totalDisplay}
      </p>

      {boqTotal == null ? (
        <p className="mt-3 text-label-sm text-on-surface-variant">
          Generate the BoQ to see your spend
          {budgetTotal != null && ` against AED ${budgetTotal.toLocaleString("en-AE")}`}
          .
        </p>
      ) : (
        <p className="mt-3 text-label-sm text-on-surface-variant">
          vs target {formatAED(budgetTotal)}
          {deltaPct != null && (
            <>
              {" "}
              <span className={cn("font-medium", overBudget ? "text-status-error" : "text-indigo-400")}>
                ({deltaPct >= 0 ? "+" : ""}
                {deltaPct}%)
              </span>
            </>
          )}
        </p>
      )}

      <div
        className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-surface-container-low"
        role="progressbar"
        aria-valuenow={usedPct ?? 0}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300",
            overBudget ? "bg-status-error" : "bg-indigo-500",
          )}
          style={{ width: `${Math.min(100, usedPct ?? 0)}%` }}
        />
      </div>

      <div className="mt-auto flex items-center justify-end pt-6">
        <Link
          href={`/project/${projectId}/boq`}
          className="group inline-flex items-center gap-1 rounded-md text-label-sm text-indigo-400 transition-colors hover:text-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
        >
          Open BoQ
          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </article>
  );
}
