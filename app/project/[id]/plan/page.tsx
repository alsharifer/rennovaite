import type { ReactNode } from "react";

import { FadeIn } from "@/app/_components/fade-in";
import { AppShell } from "@/components/app/AppShell";
import { BackButton } from "@/components/back-button";
import { Badge } from "@/components/ui/badge";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { IntakeWorkspace } from "./_components/intake-workspace";

export const dynamic = "force-dynamic";

const PAGE_NAME = "Plan Analysis";

function Shell({ children }: { children: ReactNode }) {
  return <AppShell pageName={PAGE_NAME}>{children}</AppShell>;
}

function CenteredMessage({
  tone,
  children,
}: {
  tone: "error" | "muted";
  children: ReactNode;
}) {
  return (
    <Shell>
      <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-6">
        <p
          className={
            tone === "error"
              ? "text-status-error"
              : "text-on-surface-variant"
          }
        >
          {children}
        </p>
      </main>
    </Shell>
  );
}

function pdfFilename(
  pdfUrl: string | null | undefined,
  projectName: string | null | undefined,
): string {
  if (pdfUrl) {
    try {
      const u = new URL(pdfUrl);
      const last = decodeURIComponent(u.pathname.split("/").pop() ?? "");
      if (last) return last;
    } catch {
      /* fall through */
    }
  }
  const safeName = projectName?.trim() || "plan";
  return `${safeName}.pdf`;
}

function formatMb(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return "—";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function fetchContentLength(url: string | null): Promise<number | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (!res.ok) return null;
    const len = res.headers.get("content-length");
    if (!len) return null;
    const n = Number.parseInt(len, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
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
    .select("id, total_area_m2, parsed_json, pdf_url")
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

  const roomList = rooms ?? [];
  const parsedComplete = plan.parsed_json !== null && roomList.length > 0;
  const filename = pdfFilename(plan.pdf_url, project.name);
  const sizeBytes = await fetchContentLength(plan.pdf_url);
  const planSizeMb = formatMb(sizeBytes);

  return (
    <Shell>
      <main className="flex min-h-[calc(100vh-4rem)] flex-col px-8 py-10">
        <FadeIn className="mx-auto w-full max-w-7xl">
          <BackButton />

          <header className="mt-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-h1 text-on-surface">Data Ingestion Workspace</h1>
              <p className="mt-2 max-w-2xl text-body-md text-on-surface-variant">
                Upload architectural assets for deep semantic parsing and
                vectorization. Our AI engine is currently processing your
                villa data.
              </p>
            </div>
            <Badge
              variant="secondary"
              className="bg-surface-container text-on-surface-variant"
            >
              Step 2 of 6 — Confirm your plan
            </Badge>
          </header>

          <div className="mt-10">
            <IntakeWorkspace
              projectId={project.id}
              planId={plan.id}
              planFilename={filename}
              planSizeMb={planSizeMb}
              totalAreaM2={plan.total_area_m2}
              parsedComplete={parsedComplete}
              rooms={roomList}
            />
          </div>
        </FadeIn>
      </main>
    </Shell>
  );
}
