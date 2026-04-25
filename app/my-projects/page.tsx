import Link from "next/link";
import { ArrowRight, FolderOpen, Plus } from "lucide-react";

import { FadeIn } from "@/app/_components/fade-in";
import { AppShell } from "@/components/AppShell";
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
      className="group flex flex-col overflow-hidden rounded-xl border border-bg-border bg-bg-elevated/60 backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-primary/40 hover:shadow-[0_18px_40px_-18px_rgba(168,85,247,0.45)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-primary/30"
    >
      <div className="aspect-[16/10] w-full overflow-hidden bg-bg-base">
        {roomCount > 0 ? (
          <MiniPlanPreview rooms={rooms} />
        ) : (
          <ThumbnailFallback name={project.name} />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div>
          <h3 className="font-display text-xl font-semibold tracking-tight text-text-primary">
            {project.name?.trim() || "Untitled"}
          </h3>
          <p className="mt-0.5 text-xs text-text-secondary">
            {project.city ?? "—"} · {roomCount}{" "}
            {roomCount === 1 ? "room" : "rooms"} · Created{" "}
            {relativeDate(project.created_at)}
          </p>
        </div>
        <div>
          <Badge
            variant="secondary"
            className="bg-bg-overlay text-text-secondary"
          >
            Draft
          </Badge>
        </div>
        <div className="mt-auto flex items-center justify-between">
          <span className="text-xs text-text-secondary">
            {formatAED(project.budget_aed)}
          </span>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-accent group-hover:text-brand-primary">
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
    <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-6">
      <FadeIn className="text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-brand-primary/15 text-brand-primary">
          <FolderOpen className="size-7" />
        </div>
        <h1 className="mt-6 font-display text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl">
          No projects yet
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-text-secondary">
          Upload your first villa floorplan to get started.
        </p>
        <Button
          size="lg"
          nativeButton={false}
          render={<Link href="/project" />}
          className="mt-8"
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
      <main className="flex min-h-[calc(100vh-4rem)] justify-center px-6 py-16 sm:py-24">
        <FadeIn className="w-full max-w-[1200px]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-4xl font-semibold tracking-tight text-text-primary sm:text-5xl">
              My Projects
            </h1>
            <p className="mt-2 text-sm text-text-secondary">
              Resume work on an existing project, or start a new one.
            </p>
          </div>
          <Button
            size="lg"
            nativeButton={false}
            render={<Link href="/project" />}
          >
            <Plus />
            New Project
          </Button>
        </div>

          <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        </FadeIn>
      </main>
    </AppShell>
  );
}
