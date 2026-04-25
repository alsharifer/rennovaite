import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { FadeIn } from "@/app/_components/fade-in";
import { AppShell } from "@/components/AppShell";
import { BackButton } from "@/components/back-button";

import { CorrectionModal } from "./_components/correction-modal";
import { EditablePlanViewer } from "./_components/editable-plan-viewer";
import { EditableProjectName } from "./_components/editable-project-name";

export const dynamic = "force-dynamic";

const PAGE_NAME = "Guided Intake";

const BEDROOM_TYPES = new Set(["bedroom", "master_bedroom"]);
const BATHROOM_TYPES = new Set(["bathroom", "ensuite", "powder"]);

function summarize(rooms: { room_type: string | null }[]) {
  const total = rooms.length;
  let bedrooms = 0;
  let bathrooms = 0;
  for (const r of rooms) {
    const t = r.room_type ?? "";
    if (BEDROOM_TYPES.has(t)) bedrooms++;
    else if (BATHROOM_TYPES.has(t)) bathrooms++;
  }
  return { total, bedrooms, bathrooms };
}

function formatTotalArea(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${Math.round(value)} m²`;
}

function CenteredMessage({
  tone,
  children,
}: {
  tone: "error" | "muted";
  children: ReactNode;
}) {
  return (
    <AppShell pageName={PAGE_NAME}>
      <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-6">
        <p
          className={
            tone === "error"
              ? "text-status-error"
              : "text-text-secondary"
          }
        >
          {children}
        </p>
      </main>
    </AppShell>
  );
}

export default async function PlanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = await params;
  const supabase = getSupabaseAdmin();

  const { data: project, error: projectErr } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .maybeSingle();

  if (projectErr) {
    return (
      <CenteredMessage tone="error">
        Error loading project: {projectErr.message}
      </CenteredMessage>
    );
  }
  if (!project) {
    return (
      <CenteredMessage tone="muted">
        Project {projectId} not found.
      </CenteredMessage>
    );
  }

  const { data: plan, error: planErr } = await supabase
    .from("plans")
    .select("id, total_area_m2, parsed_json")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (planErr) {
    return (
      <CenteredMessage tone="error">
        Error loading plan: {planErr.message}
      </CenteredMessage>
    );
  }
  if (!plan) {
    return (
      <CenteredMessage tone="muted">
        No plan attached to this project yet.
      </CenteredMessage>
    );
  }

  const { data: rooms, error: roomsErr } = await supabase
    .from("rooms")
    .select("id, name_en, name_ar, room_type, area_m2, polygon")
    .eq("plan_id", plan.id)
    .order("name_en");

  if (roomsErr) {
    return (
      <CenteredMessage tone="error">
        Error loading rooms: {roomsErr.message}
      </CenteredMessage>
    );
  }

  const summary = summarize(rooms ?? []);

  return (
    <AppShell pageName={PAGE_NAME}>
      <main className="flex min-h-[calc(100vh-4rem)] justify-center px-6 py-16 sm:py-24">
        <FadeIn className="w-full max-w-[980px]">
          <BackButton />

          <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
            <EditableProjectName
              projectId={project.id}
              initialName={project.name ?? "Untitled"}
            />
            <Badge
              variant="secondary"
              className="bg-bg-elevated text-text-secondary"
            >
              Step 2 of 6 — Confirm your plan
            </Badge>
          </div>

          <div className="mt-8 flex items-center justify-end">
            <CorrectionModal planId={plan.id} initialNotes={null} />
          </div>

          <div className="mt-2">
            <EditablePlanViewer
              planId={plan.id}
              initialRooms={rooms ?? []}
              initialTotalAreaM2={plan.total_area_m2}
            />
          </div>

          <section className="mt-10 flex flex-col items-center text-center">
            <p className="font-display text-6xl font-semibold tracking-tight text-text-primary sm:text-7xl">
              {formatTotalArea(plan.total_area_m2)}
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <Badge
                variant="outline"
                className="border-bg-border bg-bg-elevated text-text-secondary"
              >
                {summary.total} {summary.total === 1 ? "room" : "rooms"}
              </Badge>
              <Badge
                variant="outline"
                className="border-bg-border bg-bg-elevated text-text-secondary"
              >
                {summary.bedrooms}{" "}
                {summary.bedrooms === 1 ? "bedroom" : "bedrooms"}
              </Badge>
              <Badge
                variant="outline"
                className="border-bg-border bg-bg-elevated text-text-secondary"
              >
                {summary.bathrooms}{" "}
                {summary.bathrooms === 1 ? "bathroom" : "bathrooms"}
              </Badge>
            </div>
          </section>

          <div className="mt-12 flex justify-center pb-8">
            <Button
              size="lg"
              nativeButton={false}
              render={<Link href={`/project/${project.id}/style`} />}
            >
              Looks right — pick a style
              <ArrowRight />
            </Button>
          </div>
        </FadeIn>
      </main>
    </AppShell>
  );
}
