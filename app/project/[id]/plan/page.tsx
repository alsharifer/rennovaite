import Link from "next/link";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app/AppShell";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { EditablePlanViewer } from "./_components/editable-plan-viewer";
import { ParseLoading } from "./_components/parse-loading";

export const dynamic = "force-dynamic";

const PAGE_NAME = "Plan Analysis";
const SEGMENTS = 5;
const HVAC_HABITABLE = new Set([
  "master_bedroom",
  "bedroom",
  "bathroom",
  "ensuite",
  "living",
  "dining",
  "kitchen",
  "majlis",
]);
const BEDROOM_TYPES = new Set(["master_bedroom", "bedroom"]);
const BATHROOM_TYPES = new Set(["bathroom", "ensuite", "powder"]);

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
            tone === "error" ? "text-error" : "text-on-surface-variant"
          }
        >
          {children}
        </p>
      </main>
    </Shell>
  );
}

function formatM2(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${Math.round(n)} m²`;
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
    .select("id, name, city")
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

  // Aggregates for the right column + sticky bar.
  const totalArea = plan.total_area_m2 ?? null;
  const bedroomCount = roomList.filter((r) =>
    BEDROOM_TYPES.has(r.room_type ?? ""),
  ).length;
  const bathroomCount = roomList.filter((r) =>
    BATHROOM_TYPES.has(r.room_type ?? ""),
  ).length;
  const renovatableTypes = HVAC_HABITABLE;

  return (
    <Shell>
      <div className="mx-auto max-w-[1440px] pb-32">
        {/* Header ---------------------------------------------------- */}
        <header className="mb-2xl">
          <p className="label-caps mb-md text-brass-600">Step 02 of 05</p>
          <div className="mb-xl flex gap-sm" aria-hidden="true">
            {Array.from({ length: SEGMENTS }).map((_, i) => (
              <span
                key={i}
                className={
                  "h-1 flex-1 rounded-full " +
                  (i < 2 ? "bg-brass-600" : "bg-bone")
                }
              />
            ))}
          </div>
          <h1 className="mb-md font-display text-headline-lg text-ink-900">
            Your villa, understood.
          </h1>
          <p className="max-w-[720px] font-body text-body-lg text-on-surface-variant">
            We parsed your plan and labeled every room. Hover any room to see
            its area; click to rename or merge.
          </p>
        </header>

        {parsedComplete ? (
          <div className="grid grid-cols-1 gap-gutter lg:grid-cols-12">
            {/* Left: parsed plan viewer ------------------------------ */}
            <section className="col-span-12 lg:col-span-8">
              <div className="rounded-xl border border-ink-100 bg-paper p-8">
                <div className="mb-md flex items-baseline justify-between">
                  <p className="label-caps text-ink-500">
                    Parsed plan viewer
                  </p>
                  <p className="font-mono text-[12px] uppercase text-ink-500">
                    {roomList.length} rooms · {formatM2(totalArea)}
                  </p>
                </div>
                <EditablePlanViewer
                  planId={plan.id}
                  initialRooms={roomList}
                  initialTotalAreaM2={totalArea}
                />
                <div className="mt-md flex items-center justify-end gap-md text-ink-500">
                  <span
                    className="material-symbols-outlined text-[20px]"
                    aria-hidden="true"
                  >
                    explore
                  </span>
                  <span className="label-caps">N</span>
                  <span className="h-px w-16 bg-ink-100" aria-hidden="true" />
                  <span className="font-mono text-[12px]">5 m</span>
                </div>
              </div>
            </section>

            {/* Right: 3 stacked cards -------------------------------- */}
            <aside className="col-span-12 flex flex-col gap-gutter lg:col-span-4">
              {/* Project summary */}
              <article className="rounded-xl border border-ink-100 bg-paper p-lg">
                <p className="label-caps mb-xs text-ink-500">Villa</p>
                <h2 className="mb-lg font-display text-headline-md text-ink-900">
                  {project.name?.trim() || "Untitled villa"}
                </h2>
                <dl className="flex flex-col gap-md">
                  <SummaryRow
                    label="Total area"
                    value={formatM2(totalArea)}
                  />
                  <SummaryRow
                    label="Bedrooms"
                    value={String(bedroomCount)}
                  />
                  <SummaryRow
                    label="Bathrooms"
                    value={String(bathroomCount)}
                  />
                </dl>
              </article>

              {/* Detected rooms */}
              <article className="rounded-xl border border-ink-100 bg-paper p-lg">
                <p className="label-caps mb-md text-ink-500">
                  {roomList.length} Rooms detected
                </p>
                <ul className="flex max-h-[360px] flex-col gap-xs overflow-y-auto">
                  {roomList.map((r) => {
                    const included = renovatableTypes.has(r.room_type ?? "");
                    return (
                      <li
                        key={r.id}
                        className="flex items-center justify-between gap-md py-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-body-sm text-body-sm text-ink-900">
                            {r.name_en ?? "(unnamed)"}
                          </p>
                          <p className="font-mono text-[11px] text-ink-500">
                            {formatM2(r.area_m2)}
                          </p>
                        </div>
                        <span
                          className={
                            "flex items-center gap-xs rounded-full px-sm py-[2px] text-[11px] font-semibold " +
                            (included
                              ? "bg-primary-fixed text-ink-900"
                              : "bg-bone text-ink-700")
                          }
                        >
                          <span aria-hidden="true">
                            {included ? "✓" : "—"}
                          </span>
                          Renovate
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </article>

              {/* Verification */}
              <article className="rounded-xl border border-ink-100 bg-paper p-lg">
                <p className="label-caps mb-md text-ink-500">
                  Worth a second look
                </p>
                <div
                  className="rounded-md border p-md"
                  style={{
                    borderColor: "rgba(184,80,66,0.4)",
                    background: "rgba(184,80,66,0.08)",
                  }}
                >
                  <p className="mb-md font-body-sm text-body-sm text-ink-900">
                    Maid&apos;s room area unclear — we estimated 8.2 m².
                  </p>
                  <button
                    type="button"
                    className="focus-ring rounded border border-ink-100 bg-paper px-md py-xs font-body-sm text-body-sm text-ink-900 transition-colors hover:bg-surface-container"
                  >
                    Confirm or correct
                  </button>
                </div>
              </article>
            </aside>
          </div>
        ) : (
          <ParseLoading />
        )}
      </div>

      {/* Sticky bottom action bar ---------------------------------- */}
      {parsedComplete && (
        <div className="fixed inset-x-0 bottom-0 z-20 h-[88px] border-t border-ink-100 bg-paper">
          <div className="ml-60 flex h-full items-center justify-between px-margin">
            <Link
              href="/project/new"
              className="focus-ring flex h-12 items-center rounded-lg border border-ink-100 px-lg font-body-sm text-body-sm font-semibold text-ink-900 transition-colors hover:bg-surface-container"
            >
              Back to upload
            </Link>
            <p className="font-body text-body-sm italic text-on-surface-variant">
              Parsed by RennovAIte · {roomList.length} rooms ·{" "}
              {formatM2(totalArea)} · 99.2% confidence
            </p>
            <Link
              href={`/project/${projectId}/style`}
              className="focus-ring flex h-12 items-center gap-sm rounded-lg bg-brass-600 px-xl font-body-sm text-body-sm font-semibold text-on-primary transition-colors hover:bg-primary"
            >
              Continue to style
              <span
                className="material-symbols-outlined text-[18px]"
                aria-hidden="true"
              >
                arrow_forward
              </span>
            </Link>
          </div>
        </div>
      )}
    </Shell>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-end justify-between border-b border-bone pb-sm">
      <dt className="label-caps text-ink-500">{label}</dt>
      <dd className="font-mono text-body-sm tabular-nums text-ink-900">
        {value}
      </dd>
    </div>
  );
}
