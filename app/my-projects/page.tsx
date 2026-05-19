import Link from "next/link";
import { ArrowRight, FolderOpen, Plus } from "lucide-react";

import { FadeIn } from "@/app/_components/fade-in";
import { AppShell } from "@/components/app/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const PREVIEW_W = 320;
const PREVIEW_H = 200;
const PREVIEW_PAD = 16;

type RoomLite = { id: string; polygon: unknown };
type PlanLite = {
  id: string;
  total_area_m2: number | null;
  created_at: string | null;
  rooms: RoomLite[] | null;
};
type BoqLite = { total_aed: number | null; created_at: string | null };

type ProjectRow = {
  id: string;
  name: string | null;
  city: string | null;
  budget_aed: number | null;
  status: string | null;
  created_at: string | null;
  plans: PlanLite[] | null;
  boqs: BoqLite[] | null;
};

function isPointArray(v: unknown): v is number[][] {
  if (!Array.isArray(v)) return false;
  for (const p of v) {
    if (
      !Array.isArray(p) ||
      p.length < 2 ||
      typeof p[0] !== "number" ||
      typeof p[1] !== "number"
    ) {
      return false;
    }
  }
  return v.length >= 3;
}

function pickLatest<T extends { created_at: string | null }>(
  list: T[] | null,
): T | null {
  if (!list || list.length === 0) return null;
  return list
    .slice()
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0];
}

function relativeDate(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const w = Math.floor(days / 7);
    return `${w} ${w === 1 ? "week" : "weeks"} ago`;
  }
  if (days < 365) {
    const m = Math.floor(days / 30);
    return `${m} ${m === 1 ? "month" : "months"} ago`;
  }
  const y = Math.floor(days / 365);
  return `${y} ${y === 1 ? "year" : "years"} ago`;
}

function formatAED(value: number | null | undefined): string {
  if (value == null) return "Budget not set";
  return `AED ${value.toLocaleString("en-AE")}`;
}

function MiniPlanPreview({ rooms }: { rooms: RoomLite[] }) {
  const valid = rooms.filter((r) => isPointArray(r.polygon));
  if (valid.length === 0) return null;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const r of valid) {
    for (const [x, y] of r.polygon as number[][]) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const availW = PREVIEW_W - 2 * PREVIEW_PAD;
  const availH = PREVIEW_H - 2 * PREVIEW_PAD;
  const scale = Math.min(availW / spanX, availH / spanY);
  const offX = (PREVIEW_W - spanX * scale) / 2;
  const offY = (PREVIEW_H - spanY * scale) / 2;

  return (
    <svg
      viewBox={`0 0 ${PREVIEW_W} ${PREVIEW_H}`}
      preserveAspectRatio="xMidYMid meet"
      className="block h-full w-full"
    >
      <rect width={PREVIEW_W} height={PREVIEW_H} fill="#0B0712" />
      {valid.map((room, i) => {
        const pts = (room.polygon as number[][])
          .map(
            ([x, y]) =>
              `${((x - minX) * scale + offX).toFixed(1)},${(
                (y - minY) * scale +
                offY
              ).toFixed(1)}`,
          )
          .join(" ");
        return (
          <polygon
            key={i}
            points={pts}
            fill="#F5EFE6"
            fillOpacity={0.88}
            stroke="#B85042"
            strokeOpacity={0.6}
            strokeWidth={1}
          />
        );
      })}
    </svg>
  );
}

function ThumbnailFallback({ name }: { name: string | null }) {
  const letter = (name?.trim()?.[0] ?? "P").toUpperCase();
  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-primary/20 via-bg-elevated to-bg-overlay">
      <span
        className="font-display text-7xl font-semibold text-brand-primary/70"
        style={{ textShadow: "0 0 32px rgba(168, 85, 247, 0.45)" }}
      >
        {letter}
      </span>
    </div>
  );
}

function ProjectCard({ project }: { project: ProjectRow }) {
  const latestPlan = pickLatest(project.plans);
  const rooms = latestPlan?.rooms ?? [];
  const roomCount = rooms.length;

  return (
    <Link
      href={`/project/${project.id}/plan`}
      // Card hover follows principle 5: 4 px lift (translate-y-1) at 150 ms,
      // soft shadow expansion. Hairline border (principle 7) provides
      // weight without a heavy shadow at rest.
      className="group flex flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface-container transition-all duration-150 hover:-translate-y-1 hover:border-indigo-500/40 hover:shadow-[0_24px_48px_-20px_rgba(99,102,241,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
    >
      <div className="aspect-[16/10] w-full overflow-hidden bg-surface">
        {roomCount > 0 ? (
          <MiniPlanPreview rooms={rooms} />
        ) : (
          <ThumbnailFallback name={project.name} />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-4 p-6">
        <div>
          <h3 className="text-h3 text-on-surface">
            {project.name?.trim() || "Untitled"}
          </h3>
          <p className="mt-1 text-label-sm text-on-surface-variant">
            {project.city ?? "—"} · {roomCount}{" "}
            {roomCount === 1 ? "room" : "rooms"} · Created{" "}
            {relativeDate(project.created_at)}
          </p>
        </div>
        <div>
          <Badge
            variant="secondary"
            className="bg-surface-container-high text-on-surface-variant"
          >
            Draft
          </Badge>
        </div>
        <div className="mt-auto flex items-center justify-between">
          <span className="text-label-sm text-on-surface-variant">
            {formatAED(project.budget_aed)}
          </span>
          {/* "Resume" is a quiet affordance, not a CTA — kept on slate to
              honour the "≤3 indigo elements per viewport" rule. */}
          <span className="inline-flex items-center gap-1 text-label-sm font-medium text-on-surface-variant transition-colors group-hover:text-on-surface">
            Resume
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>
    </Link>
  );
}

function EmptyState() {
  return (
    <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-6 md:px-12">
      <FadeIn className="text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-indigo-500/15 text-indigo-400">
          <FolderOpen className="size-7" />
        </div>
        <h1 className="mt-8 text-h2 text-on-surface">No projects yet</h1>
        <p className="mx-auto mt-4 max-w-[480px] text-body-md text-on-surface-variant">
          Upload your first villa floorplan to get started.
        </p>
        <Button
          size="lg"
          nativeButton={false}
          render={<Link href="/project" />}
          className="mt-10 transition-transform duration-150 hover:scale-[1.02] active:scale-[0.98]"
        >
          <Plus />
          Start your first project
        </Button>
      </FadeIn>
    </main>
  );
}

export default async function MyProjectsPage() {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("projects")
    .select(
      `
      id, name, city, budget_aed, status, created_at,
      plans ( id, total_area_m2, created_at, rooms ( id, polygon ) ),
      boqs ( total_aed, created_at )
      `,
    )
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <AppShell pageName="My Projects">
        <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-6">
          <p className="text-status-error">
            Error loading projects: {error.message}
          </p>
        </main>
      </AppShell>
    );
  }

  const projects = (data as unknown as ProjectRow[] | null) ?? [];

  if (projects.length === 0) {
    return (
      <AppShell pageName="My Projects">
        <EmptyState />
      </AppShell>
    );
  }

  return (
    <AppShell pageName="My Projects">
      <main className="flex min-h-[calc(100vh-4rem)] justify-center px-6 py-12 md:px-12 md:py-20">
        <FadeIn className="w-full max-w-[1200px]">
          {/*
            Header rhythm follows principle 1 (whitespace) + 2 (typography
            is the star) + 3 (one hero — here, the H1). Badge-style chip
            removed; "+ New Project" is the single primary CTA on the
            page (principle 4: one indigo CTA per viewport).
          */}
          <header className="flex flex-wrap items-center justify-between gap-6">
            <div className="max-w-[720px]">
              <h1 className="text-h1 text-on-surface">My Projects</h1>
              <p className="mt-3 text-body-md text-on-surface-variant">
                Resume work on an existing project, or start a new one.
              </p>
            </div>
            <Button
              size="lg"
              nativeButton={false}
              render={<Link href="/project" />}
              className="shrink-0 transition-transform duration-150 hover:scale-[1.02] active:scale-[0.98]"
            >
              <Plus />
              New Project
            </Button>
          </header>

          <div className="mt-12 grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        </FadeIn>
      </main>
    </AppShell>
  );
}
