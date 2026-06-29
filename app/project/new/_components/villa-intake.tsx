"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";

import { AnalyticsEvent, track } from "@/lib/analytics";
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
};
const MAX_SIZE_BYTES = 20 * 1024 * 1024;

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

export function VillaIntake() {
  const router = useRouter();
  const [plan, setPlan] = useState<PlanState>({ kind: "idle" });
  const [photos, setPhotos] = useState<{ name: string; url: string }[]>([]);
  const [projectName, setProjectName] = useState("");
  const [city, setCity] = useState("Dubai");
  const [budget, setBudget] = useState(850_000);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const photoUrls = useRef<string[]>([]);

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

  const onPhotoDrop = useCallback((accepted: File[]) => {
    const next = accepted.map((f) => {
      const url = URL.createObjectURL(f);
      photoUrls.current.push(url);
      return { name: f.name, url };
    });
    setPhotos((p) => [...p, ...next]);
  }, []);

  const planDz = useDropzone({
    onDrop: onPlanDrop,
    onDropRejected: () =>
      setPlan({
        kind: "error",
        message: "Please upload a PDF, PNG, or JPG under 20 MB.",
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
              {photos.slice(0, 3).map((p, i) => (
                <div
                  key={`${p.url}-${i}`}
                  className="aspect-square overflow-hidden rounded-md border border-ink-100"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.url}
                    alt={p.name}
                    className="size-full object-cover"
                  />
                </div>
              ))}
              {photos.length > 3 && (
                <div className="flex aspect-square items-center justify-center rounded-md bg-bone font-body-sm text-body-sm font-semibold text-ink-700">
                  +{photos.length - 3} more
                </div>
              )}
            </div>
          )}
        </section>
      </div>

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
          onClick={() => router.push("/my-projects")}
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
