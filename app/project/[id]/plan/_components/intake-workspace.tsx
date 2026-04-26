"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { CorrectionModal } from "./correction-modal";
import { EditablePlanViewer } from "./editable-plan-viewer";

type RoomLite = {
  id: string;
  name_en: string | null;
  name_ar: string | null;
  room_type: string | null;
  area_m2: number | null;
  polygon: unknown;
};

type Props = {
  projectId: string;
  planId: string;
  planFilename: string;
  planSizeMb: string; // formatted, e.g. "4.2 MB" or "—"
  totalAreaM2: number | null;
  parsedComplete: boolean;
  rooms: RoomLite[];
  expectedRooms?: number;
};

const EXPECTED_ROOMS_DEFAULT = 6;

export function IntakeWorkspace({
  projectId,
  planId,
  planFilename,
  planSizeMb,
  totalAreaM2,
  parsedComplete,
  rooms,
  expectedRooms = EXPECTED_ROOMS_DEFAULT,
}: Props) {
  const router = useRouter();
  const [editorOpen, setEditorOpen] = useState(false);

  const vectorizationPct = parsedComplete ? 85 : 0;
  const taggingPct = Math.min(
    100,
    Math.round((rooms.length / Math.max(expectedRooms, 1)) * 100),
  );

  const launchEnabled = taggingPct >= 60;

  return (
    <div className="grid grid-cols-12 gap-6">
      {/* LEFT COLUMN ---------------------------------------------------- */}
      <div className="col-span-12 space-y-6 lg:col-span-8">
        {/* Upload grid */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <FloorplansCard
            filename={planFilename}
            sizeMb={planSizeMb}
            parsedComplete={parsedComplete}
          />
          <SitePhotographyCard />
        </div>

        {/* Active Analysis Pipeline */}
        <section className="neo-raised rounded-xl border border-slate-900/50 bg-surface-container p-6">
          <div className="mb-6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="block size-3 animate-pulse rounded-full bg-indigo-500 shadow-[0_0_8px_#6366f1]" />
              <h2 className="text-h3 text-on-surface">Active Analysis Pipeline</h2>
            </div>
            <span className="hidden text-label-sm italic text-slate-500 sm:inline">
              Processing via DeepSpatial v4.2
            </span>
          </div>

          <div className="space-y-6">
            <ProgressRow
              icon="polyline"
              label="Vectorization engine"
              percent={vectorizationPct}
              barClass="bg-indigo-500 glow-indigo"
              valueClass="text-indigo-400"
            />
            <ProgressRow
              icon="label"
              label="Semantic room tagging"
              percent={taggingPct}
              barClass="bg-secondary"
              valueClass="text-secondary"
            />
          </div>

          <div className="mt-8 grid grid-cols-3 gap-4">
            <StatCard label="Compute Load" value="1.2 TFLOPS" />
            <StatCard label="Inference Latency" value="240ms" />
            <StatCard label="Queue Position" value="01" />
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-2 text-label-sm text-slate-500">
            <span>
              {rooms.length}/{expectedRooms} rooms tagged
              {totalAreaM2 != null && (
                <>
                  {" · "}
                  <span className="text-on-surface-variant">
                    {Math.round(totalAreaM2)} m²
                  </span>
                </>
              )}
            </span>
            <CorrectionModal planId={planId} initialNotes={null} />
          </div>
        </section>
      </div>

      {/* RIGHT COLUMN --------------------------------------------------- */}
      <div className="col-span-12 space-y-6 lg:col-span-4">
        {/* AI Geometry Parsing */}
        <section className="neo-raised rounded-xl border border-slate-900/50 bg-surface-container p-6">
          <div className="mb-6 flex items-center gap-3 border-b border-slate-800/50 pb-4">
            <span className="material-symbols-outlined text-indigo-400">
              psychology
            </span>
            <h3 className="text-label-md text-on-surface">AI Geometry Parsing</h3>
          </div>

          <p className="px-1 text-label-sm text-slate-500">Detected Entities:</p>

          <div className="mt-4 space-y-3">
            <EntityRow
              icon="foundation"
              label="Load-bearing Walls"
              value={`${rooms.length} rooms detected`}
              active
            />
            <EntityRow
              icon="hvac"
              label="HVAC Inlets"
              value="Pending…"
            />
            <EntityRow
              icon="electrical_services"
              label="Panel Locations"
              value="Pending…"
            />
            <EntityRow
              icon="plumbing"
              label="Plumbing Stacks"
              value="Pending…"
            />
          </div>

          <div className="mt-8">
            <Button
              type="button"
              size="lg"
              onClick={() => router.push(`/project/${projectId}/style`)}
              disabled={!launchEnabled}
              className="neo-raised glow-indigo flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-4 text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              <span
                className="material-symbols-outlined"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                play_arrow
              </span>
              Launch 3D Reconstruct
            </Button>
            <p className="mt-4 px-6 text-center text-[10px] text-slate-600">
              Reconstruction available once semantic tagging exceeds 60%
            </p>
          </div>
        </section>

        {/* Visualization Teaser → opens the editable plan modal */}
        <button
          type="button"
          onClick={() => setEditorOpen(true)}
          className="group neo-pressed relative h-48 w-full overflow-hidden rounded-xl border border-slate-800 text-left transition-shadow hover:shadow-[0_0_24px_rgba(99,102,241,0.2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
          aria-label="Open editable plan"
        >
          <div
            className="absolute inset-0 opacity-40 transition-opacity group-hover:opacity-50"
            style={{
              background:
                "radial-gradient(circle at 30% 40%, rgba(99,102,241,0.4), transparent 60%), linear-gradient(135deg, #0b1326, #1e293b)",
            }}
            aria-hidden="true"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 to-transparent" />
          <div className="absolute inset-0 grid grid-cols-12 gap-1 p-6 opacity-30">
            {/* faux mesh lines, decorative */}
            {Array.from({ length: 12 }).map((_, i) => (
              <span
                key={i}
                className="border-l border-indigo-500/30"
                aria-hidden="true"
              />
            ))}
          </div>
          <div className="absolute left-4 right-4 top-4 flex items-start justify-between">
            <div className="flex items-center gap-2 text-label-sm text-indigo-300">
              <span className="block size-1.5 animate-pulse rounded-full bg-indigo-400" />
              Editable plan
            </div>
            <span className="material-symbols-outlined text-indigo-300">
              open_in_full
            </span>
          </div>
          <div className="absolute bottom-4 left-4">
            <p className="text-label-sm text-indigo-300">Live Spatial Feed</p>
            <div className="mt-1 flex gap-1">
              <span className="h-3 w-1 bg-indigo-500" />
              <span className="h-5 w-1 bg-indigo-500" />
              <span className="h-2 w-1 bg-indigo-500" />
              <span className="h-4 w-1 bg-indigo-500" />
            </div>
          </div>
        </button>
      </div>

      {/* Editable plan modal ------------------------------------------- */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto border border-slate-900 bg-surface-container text-on-surface sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle className="text-on-surface">Editable plan</DialogTitle>
            <DialogDescription className="text-on-surface-variant">
              Drag any room to move it, drag a corner to resize, double-click
              the name to rename. Click Save to write changes back.
            </DialogDescription>
          </DialogHeader>
          <EditablePlanViewer
            planId={planId}
            initialRooms={rooms}
            initialTotalAreaM2={totalAreaM2}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------

function FloorplansCard({
  filename,
  sizeMb,
  parsedComplete,
}: {
  filename: string;
  sizeMb: string;
  parsedComplete: boolean;
}) {
  return (
    <article className="neo-raised flex flex-col gap-4 rounded-xl border border-slate-900/50 bg-surface-container p-4">
      <header className="flex items-center justify-between">
        <h3 className="text-label-md text-on-surface">Floorplans &amp; CAD</h3>
        <span className="material-symbols-outlined text-indigo-400">
          description
        </span>
      </header>
      <div className="neo-pressed flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-800 bg-surface-container-lowest p-6">
        <span className="material-symbols-outlined mb-2 text-4xl text-slate-600">
          upload_file
        </span>
        <p className="text-label-sm text-slate-500">Drop DWG, RVT, or PDF</p>
      </div>
      <div className="neo-raised flex items-center justify-between rounded-lg border border-indigo-500/20 bg-slate-900/80 p-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="material-symbols-outlined shrink-0 text-indigo-400">
            architecture
          </span>
          <div className="min-w-0">
            <p
              className="truncate text-label-sm text-on-surface"
              title={filename}
            >
              {filename}
            </p>
            <p className="text-[10px] text-slate-500">
              Vector data detected · {sizeMb}
            </p>
          </div>
        </div>
        {parsedComplete && (
          <span
            className="material-symbols-outlined shrink-0 text-sm text-indigo-400"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            check_circle
          </span>
        )}
      </div>
    </article>
  );
}

function SitePhotographyCard() {
  // No site photos in the schema yet — shows the empty-state dropzone with
  // greyed thumbnail placeholders so the design reads even before that data.
  return (
    <article className="neo-raised flex flex-col gap-4 rounded-xl border border-slate-900/50 bg-surface-container p-4">
      <header className="flex items-center justify-between">
        <h3 className="text-label-md text-on-surface-variant">
          Site Photography
        </h3>
        <span className="material-symbols-outlined text-on-surface-variant">
          photo_camera
        </span>
      </header>
      <div className="neo-pressed flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-800 bg-surface-container-lowest p-6">
        <span className="material-symbols-outlined mb-2 text-4xl text-slate-600">
          add_a_photo
        </span>
        <p className="text-label-sm text-slate-500">Drop JPG, PNG, or HEIC</p>
      </div>
      <div className="flex gap-2">
        <span className="neo-raised h-12 w-12 rounded bg-slate-900/40" />
        <span className="neo-raised h-12 w-12 rounded bg-slate-900/40" />
        <span className="neo-pressed flex h-12 w-12 items-center justify-center rounded bg-slate-900 text-[10px] text-slate-500">
          +0
        </span>
      </div>
    </article>
  );
}

function ProgressRow({
  icon,
  label,
  percent,
  barClass,
  valueClass,
}: {
  icon: string;
  label: string;
  percent: number;
  barClass: string;
  valueClass: string;
}) {
  const pct = Math.max(0, Math.min(100, percent));
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-2 text-label-md text-on-surface-variant">
          <span className="material-symbols-outlined text-xs">{icon}</span>
          {label}
        </span>
        <span className={cn("text-label-md", valueClass)}>{pct}%</span>
      </div>
      <div className="neo-pressed h-2 w-full overflow-hidden rounded-full bg-slate-900">
        <div
          className={cn("h-full rounded-full transition-[width]", barClass)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="neo-pressed rounded-lg bg-surface-container-low p-4">
      <p className="mb-1 text-[10px] uppercase tracking-tight text-slate-500">
        {label}
      </p>
      <p className="text-h3 text-on-surface">{value}</p>
    </div>
  );
}

function EntityRow({
  icon,
  label,
  value,
  active = false,
}: {
  icon: string;
  label: string;
  value: string;
  active?: boolean;
}) {
  return (
    <div
      className={cn(
        "neo-pressed flex items-center justify-between rounded-lg bg-slate-950/40 p-3",
        !active && "opacity-60",
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "material-symbols-outlined text-lg",
            active ? "text-indigo-500" : "text-slate-600",
          )}
        >
          {icon}
        </span>
        <span className="text-label-md text-on-surface-variant">{label}</span>
      </div>
      <span
        className={cn(
          "text-label-sm",
          active ? "font-bold text-indigo-400" : "text-slate-500",
        )}
      >
        {value}
      </span>
    </div>
  );
}
