"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";

import { AnalyticsEvent, track } from "@/lib/analytics";
import {
  DRAWING_DISCIPLINES,
  KIND_LABEL,
  type AssetKind,
} from "@/lib/assets/types";
import { compressImage, ImageProcessingError } from "@/lib/image/compress";
import { cn } from "@/lib/utils";

// The existing /api/upload only accepts PDF/PNG/JPG. The design copy mentions
// DWG/RVT but the data flow is unchanged, so the picker is restricted to what
// the API can actually ingest.
const PLAN_ACCEPT = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
};
const PHOTO_ACCEPT = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/heic": [".heic"],
  "image/heif": [".heif"],
};
// Existing drawings: PDF/DWG/DXF + images. DWG/DXF rarely carry a reliable MIME
// (often octet-stream), so they're matched by extension too.
const DRAWING_ACCEPT = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "application/acad": [".dwg"],
  "image/vnd.dwg": [".dwg"],
  "application/dxf": [".dxf"],
  "application/octet-stream": [".dwg", ".dxf"],
};
const MAX_SIZE_BYTES = 25 * 1024 * 1024;

const CITIES = ["Dubai", "Abu Dhabi", "Sharjah", "Ras Al Khaimah", "Ajman"];

type UploadResponse = {
  project_id: string;
  plan_id: string;
  pdf_url: string;
};

type PlanState =
  | { kind: "idle" }
  | { kind: "uploading"; name: string; progress: number }
  | { kind: "ready"; name: string; size: number; res: UploadResponse }
  | { kind: "error"; message: string };

// A queued/in-flight/finished library upload (photo or drawing). Photos and
// drawings need a project, which is created when the plan uploads — items
// dropped before that are "queued" and flushed once the project exists.
type AssetStatus = "queued" | "uploading" | "done" | "error";
type AssetItem = {
  id: string;
  file: File;
  name: string;
  kind: AssetKind;
  previewUrl?: string;
  status: AssetStatus;
  error?: string;
};

function uploadWithProgress(
  file: File,
  onProgress: (pct: number) => void,
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress((e.loaded / e.total) * 100);
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        reject(new Error(`Upload failed (${xhr.status}).`));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as UploadResponse);
      } else {
        const msg =
          body && typeof body === "object" && "error" in body
            ? String((body as { error: unknown }).error)
            : `Upload failed (${xhr.status}).`;
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error("Network error — try again."));
    xhr.send(form);
  });
}

function formatBytes(b: number): string {
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function formatAed(n: number): string {
  return `AED ${n.toLocaleString("en-US")}`;
}

const isImageType = (t: string) => /^image\/(png|jpeg)$/.test(t);

export function VillaIntake() {
  const router = useRouter();
  const [plan, setPlan] = useState<PlanState>({ kind: "idle" });
  const [photos, setPhotos] = useState<AssetItem[]>([]);
  const [drawings, setDrawings] = useState<AssetItem[]>([]);
  const [discipline, setDiscipline] = useState<AssetKind>("drawing_mep");
  const [projectName, setProjectName] = useState("");
  const [city, setCity] = useState("Dubai");
  const [budget, setBudget] = useState(850_000);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // The project is created by the plan upload; assets can only be written once
  // it exists.
  const projectId = plan.kind === "ready" ? plan.res.project_id : null;

  const patchPhoto = useCallback((id: string, p: Partial<AssetItem>) => {
    setPhotos((prev) => prev.map((it) => (it.id === id ? { ...it, ...p } : it)));
  }, []);
  const patchDrawing = useCallback((id: string, p: Partial<AssetItem>) => {
    setDrawings((prev) => prev.map((it) => (it.id === id ? { ...it, ...p } : it)));
  }, []);

  const uploadAssetItem = useCallback(
    async (
      item: AssetItem,
      pid: string,
      patch: (id: string, p: Partial<AssetItem>) => void,
    ) => {
      patch(item.id, { status: "uploading", error: undefined });
      try {
        let file = item.file;
        // Photos are downscaled/compressed client-side (S1) so a 12 MP phone
        // shot lands ~1 MB. Drawings (PDF/DWG) upload as-is.
        if (item.kind === "photo") {
          try {
            file = (await compressImage(item.file)).file;
          } catch (err) {
            patch(item.id, {
              status: "error",
              error:
                err instanceof ImageProcessingError
                  ? err.message
                  : "We couldn’t read that image. Please try a JPG or PNG.",
            });
            return;
          }
        }
        const form = new FormData();
        form.append("file", file);
        form.append("project_id", pid);
        form.append("kind", item.kind);
        form.append("source", "intake");
        const res = await fetch("/api/project-asset", { method: "POST", body: form });
        const body = (await res.json().catch(() => null)) as
          | { asset_id?: string; error?: string }
          | null;
        if (!res.ok || !body?.asset_id) {
          patch(item.id, {
            status: "error",
            error: body?.error ?? `Upload failed (${res.status}).`,
          });
          return;
        }
        patch(item.id, { status: "done" });
      } catch (err) {
        patch(item.id, {
          status: "error",
          error: err instanceof Error ? err.message : "Upload failed.",
        });
      }
    },
    [],
  );

  // Flush any queued items once the project exists. Guarded on status, so items
  // already uploading/done are skipped and each is processed exactly once (no
  // loop despite `photos`/`drawings` being in the dep list).
  useEffect(() => {
    if (!projectId) return;
    for (const it of photos) {
      if (it.status === "queued") void uploadAssetItem(it, projectId, patchPhoto);
    }
    for (const it of drawings) {
      if (it.status === "queued") void uploadAssetItem(it, projectId, patchDrawing);
    }
  }, [projectId, photos, drawings, uploadAssetItem, patchPhoto, patchDrawing]);

  const onPlanDrop = useCallback(async (accepted: File[]) => {
    const f = accepted[0];
    if (!f) return;
    setPlan({ kind: "uploading", name: f.name, progress: 0 });
    try {
      const res = await uploadWithProgress(f, (pct) =>
        setPlan({ kind: "uploading", name: f.name, progress: pct }),
      );
      setPlan({ kind: "ready", name: f.name, size: f.size, res });
      // A project row is created on upload — this is the funnel entry point.
      track(AnalyticsEvent.ProjectStarted, { project_id: res.project_id });
    } catch (err) {
      setPlan({
        kind: "error",
        message: err instanceof Error ? err.message : "Upload failed.",
      });
    }
  }, []);

  const onPhotoDrop = useCallback(
    (accepted: File[]) => {
      const items: AssetItem[] = accepted.map((f) => ({
        id: crypto.randomUUID(),
        file: f,
        name: f.name,
        kind: "photo",
        previewUrl: URL.createObjectURL(f),
        status: projectId ? "uploading" : "queued",
      }));
      setPhotos((p) => [...p, ...items]);
      if (projectId) {
        for (const it of items) void uploadAssetItem(it, projectId, patchPhoto);
      }
    },
    [projectId, uploadAssetItem, patchPhoto],
  );

  const onDrawingDrop = useCallback(
    (accepted: File[]) => {
      const items: AssetItem[] = accepted.map((f) => ({
        id: crypto.randomUUID(),
        file: f,
        name: f.name,
        kind: discipline,
        previewUrl: isImageType(f.type) ? URL.createObjectURL(f) : undefined,
        status: projectId ? "uploading" : "queued",
      }));
      setDrawings((p) => [...p, ...items]);
      if (projectId) {
        for (const it of items) void uploadAssetItem(it, projectId, patchDrawing);
      }
    },
    [projectId, discipline, uploadAssetItem, patchDrawing],
  );

  const planDz = useDropzone({
    onDrop: onPlanDrop,
    onDropRejected: () =>
      setPlan({
        kind: "error",
        message: "Please upload a PDF, PNG, or JPG under 25 MB.",
      }),
    accept: PLAN_ACCEPT,
    maxSize: MAX_SIZE_BYTES,
    multiple: false,
    disabled: plan.kind === "uploading",
  });

  const photoDz = useDropzone({
    onDrop: onPhotoDrop,
    accept: PHOTO_ACCEPT,
    maxSize: MAX_SIZE_BYTES,
    multiple: true,
  });

  const drawingDz = useDropzone({
    onDrop: onDrawingDrop,
    accept: DRAWING_ACCEPT,
    maxSize: MAX_SIZE_BYTES,
    multiple: true,
  });

  async function analyze() {
    if (plan.kind !== "ready" || analyzing) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const r = await fetch("/api/parse-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: plan.res.plan_id }),
      });
      const b = (await r.json().catch(() => null)) as
        | { success?: boolean; error?: string }
        | null;
      if (!r.ok || !b?.success) {
        throw new Error(b?.error ?? `Analysis failed (${r.status}).`);
      }
      track(AnalyticsEvent.PlanParsed, { project_id: plan.res.project_id });
      router.push(`/project/${plan.res.project_id}/plan`);
    } catch (err) {
      setAnalyzing(false);
      setAnalyzeError(
        err instanceof Error ? err.message : "Analysis failed.",
      );
    }
  }

  const planReady = plan.kind === "ready";
  const queuedNote =
    !projectId && (photos.length > 0 || drawings.length > 0)
      ? "Saved to your project once the plan is added."
      : null;

  return (
    <div className="flex flex-col gap-gutter">
      {/* Dropzone grid -------------------------------------------------- */}
      <div className="grid grid-cols-1 gap-gutter lg:grid-cols-2">
        {/* Floorplans & CAD */}
        <section className="rounded-lg border border-ink-100 bg-paper p-8">
          <p className="label-caps mb-md text-ink-500">Floorplans &amp; CAD</p>

          <AnimatePresence mode="wait">
            {plan.kind === "uploading" ? (
              <motion.div
                key="uploading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.24 }}
                className="flex h-[240px] flex-col items-center justify-center gap-lg rounded-md px-8"
              >
                <p className="font-display text-body-lg italic text-ink-700">
                  Uploading {plan.name}…
                </p>
                <div className="h-2 w-full max-w-[360px] overflow-hidden rounded-full bg-bone">
                  <div
                    className="h-full rounded-full bg-brass-600 transition-[width] duration-200"
                    style={{ width: `${Math.max(4, plan.progress)}%` }}
                  />
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="dz"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.24 }}
              >
                <div
                  {...planDz.getRootProps()}
                  className={cn(
                    "flex h-[240px] cursor-pointer flex-col items-center justify-center gap-md rounded-md border-2 border-dashed px-8 text-center transition-colors duration-200 outline-none",
                    planDz.isDragActive
                      ? "border-brass-600 bg-primary-fixed/40"
                      : plan.kind === "error"
                        ? "border-error bg-error/5"
                        : "border-ink-100 hover:border-brass-600 hover:bg-primary-fixed/30",
                  )}
                >
                  <input {...planDz.getInputProps()} />
                  <span
                    className="material-symbols-outlined text-[32px] text-brass-600"
                    aria-hidden="true"
                  >
                    upload_file
                  </span>
                  <p className="font-body text-body-md text-on-surface-variant">
                    Drop your DWG, RVT, or PDF
                    <span className="text-ink-500">
                      {" "}
                      · or click to browse
                    </span>
                  </p>
                  {plan.kind === "error" && (
                    <p className="font-body-sm text-body-sm text-error">
                      {plan.message}
                    </p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {planReady && plan.kind === "ready" && (
            <div className="mt-md flex items-center gap-md rounded-md border border-ink-100 bg-canvas px-md py-sm">
              <span
                className="material-symbols-outlined text-[20px] text-on-surface-variant"
                aria-hidden="true"
              >
                description
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-body-sm text-body-sm text-ink-900">
                  {plan.name}
                </p>
                <p className="font-mono text-[12px] text-ink-500">
                  {formatBytes(plan.size)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPlan({ kind: "idle" })}
                className="focus-ring font-body-sm text-body-sm font-semibold text-brass-600 hover:underline"
              >
                Replace
              </button>
            </div>
          )}
        </section>

        {/* Site photography */}
        <section className="rounded-lg border border-ink-100 bg-paper p-8">
          <p className="label-caps mb-md text-ink-500">Site photography</p>
          <div
            {...photoDz.getRootProps()}
            className={cn(
              "flex h-[240px] cursor-pointer flex-col items-center justify-center gap-md rounded-md border-2 border-dashed px-8 text-center transition-colors duration-200 outline-none",
              photoDz.isDragActive
                ? "border-brass-600 bg-primary-fixed/40"
                : "border-ink-100 hover:border-brass-600 hover:bg-primary-fixed/30",
            )}
          >
            <input {...photoDz.getInputProps()} />
            <span
              className="material-symbols-outlined text-[32px] text-brass-600"
              aria-hidden="true"
            >
              add_photo_alternate
            </span>
            <p className="font-body text-body-md text-on-surface-variant">
              Drop JPG, PNG, or HEIC
              <span className="text-ink-500"> · or click to browse</span>
            </p>
          </div>

          {photos.length > 0 && (
            <div className="mt-md grid grid-cols-4 gap-sm">
              {photos.map((p) => (
                <AssetThumb key={p.id} item={p} />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Existing drawings (MEP · electrical · HVAC) -------------------- */}
      <section className="rounded-lg border border-ink-100 bg-paper p-8">
        <div className="mb-md flex flex-wrap items-center justify-between gap-md">
          <div>
            <p className="label-caps text-ink-500">
              Existing drawings (MEP · electrical · HVAC)
            </p>
            <p className="mt-xs font-body-sm text-body-sm text-on-surface-variant">
              Optional — stored for later. We don&apos;t process these yet.
            </p>
          </div>
          {/* Discipline the next dropped files are filed under. */}
          <div className="flex overflow-hidden rounded border border-ink-100">
            {DRAWING_DISCIPLINES.map((d) => (
              <button
                key={d.kind}
                type="button"
                onClick={() => setDiscipline(d.kind)}
                className={cn(
                  "px-md py-xs font-body-sm text-body-sm font-semibold transition-colors",
                  discipline === d.kind
                    ? "bg-brass-600 text-on-primary"
                    : "bg-paper text-ink-700 hover:bg-surface-container-low",
                )}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div
          {...drawingDz.getRootProps()}
          className={cn(
            "flex h-[160px] cursor-pointer flex-col items-center justify-center gap-md rounded-md border-2 border-dashed px-8 text-center transition-colors duration-200 outline-none",
            drawingDz.isDragActive
              ? "border-brass-600 bg-primary-fixed/40"
              : "border-ink-100 hover:border-brass-600 hover:bg-primary-fixed/30",
          )}
        >
          <input {...drawingDz.getInputProps()} />
          <span
            className="material-symbols-outlined text-[32px] text-brass-600"
            aria-hidden="true"
          >
            description
          </span>
          <p className="font-body text-body-md text-on-surface-variant">
            Drop PDF, DWG, DXF, or images as{" "}
            <span className="font-semibold text-ink-900">
              {KIND_LABEL[discipline]}
            </span>
            <span className="text-ink-500"> · or click to browse</span>
          </p>
        </div>

        {drawings.length > 0 && (
          <ul className="mt-md flex flex-col gap-xs">
            {drawings.map((d) => (
              <li
                key={d.id}
                className="flex items-center gap-md rounded-md border border-ink-100 bg-canvas px-md py-sm"
              >
                <span
                  className="material-symbols-outlined text-[20px] text-on-surface-variant"
                  aria-hidden="true"
                >
                  description
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-body-sm text-body-sm text-ink-900">
                    {d.name}
                  </p>
                  <p className="font-mono text-[11px] text-ink-500">
                    {KIND_LABEL[d.kind]}
                  </p>
                </div>
                <StatusBadge item={d} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {queuedNote && (
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          {queuedNote}
        </p>
      )}

      {/* Project basics ------------------------------------------------- */}
      <section className="rounded-lg border border-ink-100 bg-paper p-8">
        <p className="label-caps mb-lg text-ink-500">Project basics</p>
        <div className="grid grid-cols-1 gap-gutter md:grid-cols-3">
          <label className="flex flex-col gap-xs">
            <span className="label-caps text-ink-500">Project name</span>
            <input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Mudon Al Naseem villa"
              className="h-12 rounded border border-ink-100 bg-paper px-md font-body-sm text-body-sm text-ink-900 outline-none focus:border-brass-600 focus:ring-1 focus:ring-brass-600"
            />
          </label>
          <label className="flex flex-col gap-xs">
            <span className="label-caps text-ink-500">City</span>
            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="h-12 rounded border border-ink-100 bg-paper px-md font-body-sm text-body-sm text-ink-900 outline-none focus:border-brass-600 focus:ring-1 focus:ring-brass-600"
            >
              {CITIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-xs">
            <span className="label-caps text-ink-500">
              Estimated budget
            </span>
            <div className="flex h-12 items-center gap-sm rounded border border-ink-100 bg-paper px-md">
              <span className="font-mono text-body-sm text-ink-500">AED</span>
              <span className="font-mono text-body-sm tabular-nums text-ink-900">
                {budget.toLocaleString("en-US")}
              </span>
            </div>
            <input
              type="range"
              min={200_000}
              max={2_000_000}
              step={10_000}
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
              className="mt-xs accent-brass-600"
              aria-label="Estimated budget"
            />
          </label>
        </div>
      </section>

      {analyzeError && (
        <p className="font-body-sm text-body-sm text-error">{analyzeError}</p>
      )}

      {/* Action row ----------------------------------------------------- */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => router.push("/dashboard")}
          className="focus-ring flex h-12 items-center rounded-lg border border-ink-100 px-lg font-body-sm text-body-sm font-semibold text-ink-900 transition-colors hover:bg-surface-container"
        >
          Save and continue later
        </button>
        <button
          type="button"
          onClick={analyze}
          disabled={!planReady || analyzing}
          className="focus-ring flex h-12 items-center gap-sm rounded-lg bg-brass-600 px-xl font-body-sm text-body-sm font-semibold text-on-primary transition-colors hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {analyzing ? "Analyzing…" : "Analyze my villa"}
          <span
            className="material-symbols-outlined text-[18px]"
            aria-hidden="true"
          >
            arrow_forward
          </span>
        </button>
      </div>

      <p className="font-mono text-[12px] uppercase tracking-wider text-ink-500">
        {formatAed(budget)} budget · {city}
        {projectName ? ` · ${projectName}` : ""}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small status helpers
// ---------------------------------------------------------------------------

function statusMeta(status: AssetStatus): { icon: string; label: string; tone: string } {
  switch (status) {
    case "done":
      return { icon: "check_circle", label: "Saved", tone: "text-brass-600" };
    case "uploading":
      return { icon: "progress_activity", label: "Uploading…", tone: "text-ink-500" };
    case "error":
      return { icon: "error", label: "Failed", tone: "text-error" };
    default:
      return { icon: "schedule", label: "Queued", tone: "text-ink-500" };
  }
}

function AssetThumb({ item }: { item: AssetItem }) {
  const meta = statusMeta(item.status);
  return (
    <div
      className="relative aspect-square overflow-hidden rounded-md border border-ink-100"
      title={item.error ?? meta.label}
    >
      {item.previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.previewUrl}
          alt={item.name}
          className="size-full object-cover"
        />
      ) : (
        <div className="flex size-full items-center justify-center bg-bone">
          <span className="material-symbols-outlined text-ink-500" aria-hidden="true">
            description
          </span>
        </div>
      )}
      <span
        className={cn(
          "absolute inset-x-0 bottom-0 flex items-center gap-xs bg-paper/90 px-1.5 py-0.5 font-body-sm text-[10px] font-semibold",
          meta.tone,
        )}
      >
        <span className="material-symbols-outlined text-[12px]" aria-hidden="true">
          {meta.icon}
        </span>
        {meta.label}
      </span>
    </div>
  );
}

function StatusBadge({ item }: { item: AssetItem }) {
  const meta = statusMeta(item.status);
  return (
    <span
      className={cn("flex items-center gap-xs font-body-sm text-[12px] font-semibold", meta.tone)}
      title={item.error ?? meta.label}
    >
      <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
        {meta.icon}
      </span>
      {meta.label}
    </span>
  );
}
