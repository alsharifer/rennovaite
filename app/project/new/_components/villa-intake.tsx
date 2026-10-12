"use client";

// =============================================================================
// app/project/new/_components/villa-intake.tsx — 01 Intake (K6, R7 §3.9,
// Figma 29:1016). The owner front door's working half, in Blueprint (warm skin).
//
// "How would you like to start?" — three ways in, as option tiles (a radio
// group; selected = brass left rule + raised): Upload a drawing · Draw it
// yourself · Start from photos (the last two need the garden pilot, which owns
// /api/draw-plan). The way chosen shows its zone; a file that is too large is
// the inverse block saying what to do instead (never a raw 413). Site photos
// and existing drawings stay optional, queued until the project exists — and
// flushed BEFORE leaving when the project is created by drawing. Continue is
// disabled, with its reason, until a way to start is valid.
//
// The data flow is unchanged: H9 direct uploads (lib/uploads/client.ts) →
// /api/uploads/complete creates the project; /api/parse-plan reads it;
// /api/draw-plan creates an authored plan.
// =============================================================================

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";

import { Icon } from "@/components/blueprint/Icon";
import { EMPTY_PLOT, parsePlot, PlotSizeFields, type PlotDraft } from "@/components/plan/plot-size-fields";
import { AnalyticsEvent, track } from "@/lib/analytics";
import { DRAWING_DISCIPLINES, KIND_LABEL, type AssetKind } from "@/lib/assets/types";
import { compressImage, ImageProcessingError } from "@/lib/image/compress";
import { completeUpload, uploadDirect, uploadFile } from "@/lib/uploads/client";
import { UPLOAD_LIMITS } from "@/lib/uploads/limits";

// The plan route ingests PDF / PNG / JPG only (the picker says what it accepts).
const PLAN_ACCEPT = { "application/pdf": [".pdf"], "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"] };
const PHOTO_ACCEPT = { "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"], "image/heic": [".heic"], "image/heif": [".heif"] };
// DWG/DXF rarely carry a reliable MIME (often octet-stream), so they're matched by extension too.
const DRAWING_ACCEPT = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "application/acad": [".dwg"],
  "image/vnd.dwg": [".dwg"],
  "application/dxf": [".dxf"],
  "application/octet-stream": [".dwg", ".dxf"],
};
// Size limits are lib/uploads/limits.ts (H9) — the table the sign and complete routes read.
const PLAN_MAX_BYTES = UPLOAD_LIMITS.plan.maxBytes;
const ASSET_MAX_BYTES = UPLOAD_LIMITS.project_asset.maxBytes;
const CITIES = ["Dubai", "Abu Dhabi", "Sharjah", "Ras Al Khaimah", "Ajman"];

type Way = "upload" | "draw" | "photos";
type UploadResponse = { project_id: string; plan_id: string; pdf_url: string };
type PlanState =
  | { kind: "idle" }
  | { kind: "uploading"; name: string; progress: number }
  | { kind: "ready"; name: string; size: number; res: UploadResponse }
  | { kind: "too_large"; name: string; size: number }
  | { kind: "error"; message: string };
type AssetStatus = "queued" | "uploading" | "done" | "error";
type AssetItem = { id: string; file: File; name: string; kind: AssetKind; previewUrl?: string; status: AssetStatus; error?: string };

/** H9: the plan goes straight to Storage on a signed URL, then /complete verifies it and creates the project. */
async function uploadWithProgress(file: File, onProgress: (pct: number) => void): Promise<UploadResponse> {
  const { path } = await uploadDirect(file, { kind: "plan", onProgress });
  return completeUpload<UploadResponse>(path, "plan", { filename: file.name });
}

const mb = (b: number) => `${(b / (1024 * 1024)).toFixed(1)} MB`;
const isImageType = (t: string) => /^image\/(png|jpeg)$/.test(t);
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring";
const INPUT = `h-11 w-full rounded-none border border-bp-line-control bg-bp-surface-raised px-3 t-body-sm text-bp-ink-primary placeholder:text-bp-ink-tertiary ${FOCUS}`;

const WAYS: { key: Way; icon: string; title: string; body: string; garden: boolean }[] = [
  { key: "upload", icon: "upload_file", title: "Upload a drawing", body: "A PDF or image of your floor plan. We read rooms, openings and dimensions — then you confirm them.", garden: false },
  { key: "draw", icon: "draw", title: "Draw it yourself", body: "No drawing? Sketch rooms or garden zones on a grid with your own measurements.", garden: true },
  { key: "photos", icon: "photo_camera", title: "Start from photos", body: "For gardens: photos of each side. We draw the zones with you.", garden: true },
];

export function VillaIntake({ gardenPilot = false }: { gardenPilot?: boolean }) {
  const router = useRouter();
  const ids = useId();
  const [way, setWay] = useState<Way>("upload");
  const [plan, setPlan] = useState<PlanState>({ kind: "idle" });
  const [plot, setPlot] = useState<PlotDraft>(EMPTY_PLOT);
  const [photos, setPhotos] = useState<AssetItem[]>([]);
  const [drawings, setDrawings] = useState<AssetItem[]>([]);
  const [discipline, setDiscipline] = useState<AssetKind>("drawing_mep");
  const [projectName, setProjectName] = useState("");
  const [city, setCity] = useState("Dubai");
  const [busy, setBusy] = useState<null | "parse" | "draw">(null);
  const [error, setError] = useState<string | null>(null);

  const ways = WAYS.filter((w) => !w.garden || gardenPilot);
  const projectId = plan.kind === "ready" ? plan.res.project_id : null;

  const patchPhoto = useCallback((id: string, p: Partial<AssetItem>) => setPhotos((prev) => prev.map((it) => (it.id === id ? { ...it, ...p } : it))), []);
  const patchDrawing = useCallback((id: string, p: Partial<AssetItem>) => setDrawings((prev) => prev.map((it) => (it.id === id ? { ...it, ...p } : it))), []);

  const uploadAssetItem = useCallback(async (item: AssetItem, pid: string, patch: (id: string, p: Partial<AssetItem>) => void) => {
    patch(item.id, { status: "uploading", error: undefined });
    try {
      let file = item.file;
      // Photos are compressed client-side (S1): a 12 MP phone shot lands ~1 MB.
      if (item.kind === "photo") {
        try {
          file = (await compressImage(item.file)).file;
        } catch (err) {
          patch(item.id, { status: "error", error: err instanceof ImageProcessingError ? err.message : "We couldn’t read that image. Please try a JPG or PNG." });
          return;
        }
      }
      const body = await uploadFile<{ asset_id?: string }>(file, { kind: "project_asset", projectId: pid, assetKind: item.kind }, { asset_kind: item.kind, source: "intake" });
      patch(item.id, body?.asset_id ? { status: "done" } : { status: "error", error: "The upload didn't complete. Please try again." });
    } catch (err) {
      patch(item.id, { status: "error", error: err instanceof Error ? err.message : "Upload failed." });
    }
  }, []);

  // Flush queued items once an uploaded plan has created the project (each exactly once — guarded on status).
  useEffect(() => {
    if (!projectId) return;
    for (const it of photos) if (it.status === "queued") void uploadAssetItem(it, projectId, patchPhoto);
    for (const it of drawings) if (it.status === "queued") void uploadAssetItem(it, projectId, patchDrawing);
  }, [projectId, photos, drawings, uploadAssetItem, patchPhoto, patchDrawing]);

  const onPlanDrop = useCallback(async (accepted: File[]) => {
    const f = accepted[0];
    if (!f) return;
    setError(null);
    setPlan({ kind: "uploading", name: f.name, progress: 0 });
    try {
      const res = await uploadWithProgress(f, (pct) => setPlan({ kind: "uploading", name: f.name, progress: pct }));
      setPlan({ kind: "ready", name: f.name, size: f.size, res });
      track(AnalyticsEvent.ProjectStarted, { project_id: res.project_id });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed.";
      setPlan(/too large|413|payload/i.test(message) ? { kind: "too_large", name: f.name, size: f.size } : { kind: "error", message });
    }
  }, []);

  const onPlanRejected = useCallback((rejections: FileRejection[]) => {
    const r = rejections[0];
    if (r?.errors.some((e) => e.code === "file-too-large")) setPlan({ kind: "too_large", name: r.file.name, size: r.file.size });
    else setPlan({ kind: "error", message: "That file can't be used as a plan — upload a PDF, PNG or JPG." });
  }, []);

  const addAssets = useCallback(
    (accepted: File[], kind: AssetKind, setList: typeof setPhotos, patch: typeof patchPhoto) => {
      const items: AssetItem[] = accepted.map((f) => ({
        id: crypto.randomUUID(),
        file: f,
        name: f.name,
        kind,
        previewUrl: kind === "photo" || isImageType(f.type) ? URL.createObjectURL(f) : undefined,
        status: projectId ? "uploading" : "queued",
      }));
      setList((p) => [...p, ...items]);
      if (projectId) for (const it of items) void uploadAssetItem(it, projectId, patch);
    },
    [projectId, uploadAssetItem],
  );

  const planDz = useDropzone({ onDrop: onPlanDrop, onDropRejected: onPlanRejected, accept: PLAN_ACCEPT, maxSize: PLAN_MAX_BYTES, multiple: false, disabled: plan.kind === "uploading" });
  const photoDz = useDropzone({ onDrop: (f) => addAssets(f, "photo", setPhotos, patchPhoto), accept: PHOTO_ACCEPT, maxSize: ASSET_MAX_BYTES, multiple: true });
  const drawingDz = useDropzone({ onDrop: (f) => addAssets(f, discipline, setDrawings, patchDrawing), accept: DRAWING_ACCEPT, maxSize: ASSET_MAX_BYTES, multiple: true });

  async function analyze() {
    if (plan.kind !== "ready" || busy) return;
    setBusy("parse");
    setError(null);
    try {
      const r = await fetch("/api/parse-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan_id: plan.res.plan_id }) });
      const b = (await r.json().catch(() => null)) as { success?: boolean; error?: string } | null;
      if (!r.ok || !b?.success) throw new Error(b?.error ?? `Reading the plan failed (${r.status}).`);
      track(AnalyticsEvent.PlanParsed, { project_id: plan.res.project_id });
      router.push(`/project/${plan.res.project_id}/plan`);
    } catch (err) {
      setBusy(null);
      setError(err instanceof Error ? err.message : "Reading the plan failed.");
    }
  }

  /** G1: a project with nothing to parse — the plot is its scale. Queued photos and drawings upload before we leave. */
  async function startDrawnPlan() {
    const size = parsePlot(plot);
    if (!size || busy) return;
    setBusy("draw");
    setError(null);
    try {
      const res = await fetch("/api/draw-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...size, name: projectName.trim() || undefined, city }) });
      const body = (await res.json().catch(() => null)) as { project_id?: string; error?: string } | null;
      if (!res.ok || !body?.project_id) throw new Error(body?.error ?? `Could not start a drawn plan (${res.status}).`);
      const pid = body.project_id;
      await Promise.all([...photos.filter((p) => p.status === "queued").map((p) => uploadAssetItem(p, pid, patchPhoto)), ...drawings.filter((d) => d.status === "queued").map((d) => uploadAssetItem(d, pid, patchDrawing))]);
      router.push(`/project/${pid}/plan`);
    } catch (err) {
      setBusy(null);
      setError(err instanceof Error ? err.message : "Could not start a drawn plan.");
    }
  }

  // Continue: one action per way, disabled with the reason until that way is valid.
  const plotOk = !!parsePlot(plot);
  const blockReason =
    busy === "parse"
      ? "Reading your plan…"
      : busy === "draw"
        ? "Opening the canvas…"
        : way === "upload"
          ? plan.kind === "ready"
            ? null
            : plan.kind === "uploading"
              ? "Wait for the upload to finish"
              : "Add a plan file that uploads, or choose another way to start"
          : way === "photos" && photos.length === 0
            ? "Add at least one photo of the garden"
            : !plotOk
              ? "Enter the plot's width and depth in metres"
              : null;
  const onContinue = () => (blockReason ? undefined : way === "upload" ? void analyze() : void startDrawnPlan());

  return (
    <div className="flex flex-col gap-10" data-intake>
      <div role="radiogroup" aria-label="How would you like to start?" className={`grid grid-cols-1 gap-4 ${ways.length === 3 ? "md:grid-cols-3" : ways.length === 2 ? "md:grid-cols-2" : ""}`}>
        {ways.map((w) => {
          const on = way === w.key;
          return (
            <button
              key={w.key}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setWay(w.key)}
              className={`flex flex-col items-start gap-3 border p-5 text-left ${FOCUS} ${on ? "border-bp-line-hairline border-l-2 border-l-bp-brass bg-bp-surface-raised" : "border-bp-line-control hover:bg-bp-surface-raised"}`}
              data-way={w.key}
            >
              <Icon name={w.icon} size={20} className="text-bp-ink-secondary" />
              <span className="t-heading-md text-bp-ink-primary">{w.title}</span>
              <span className="t-body-sm text-bp-ink-secondary">{w.body}</span>
            </button>
          );
        })}
      </div>

      {way === "upload" ? (
        <section aria-label="Your plan file" className="flex flex-col gap-3">
          {plan.kind === "ready" ? (
            <div className="flex flex-wrap items-center gap-4 border border-dashed border-bp-line-control px-5 py-4" data-plan-ready>
              <Icon name="description" size={20} className="text-bp-ink-secondary" />
              <span className="min-w-0 flex-1">
                <span className="t-body-sm block truncate text-bp-ink-primary">{plan.name}</span>
                <span className="t-label-md block font-bp-mono text-bp-ink-secondary">{mb(plan.size)} · uploaded</span>
              </span>
              <button type="button" onClick={() => setPlan({ kind: "idle" })} className={`inline-flex h-11 items-center border border-bp-line-control px-4 t-nav-item-active text-bp-ink-primary hover:bg-bp-surface-sunken ${FOCUS}`}>
                Choose another file
              </button>
            </div>
          ) : plan.kind === "uploading" ? (
            <div className="border border-dashed border-bp-line-control px-5 py-6" aria-live="polite" aria-busy="true">
              <p className="t-body-sm text-bp-ink-primary">Uploading {plan.name}…</p>
              <div className="mt-3 h-1 w-full max-w-[420px] bg-bp-surface-sunken" aria-hidden="true">
                <div className="h-1 bg-bp-ink-primary transition-[width]" style={{ width: `${Math.max(4, plan.progress)}%` }} />
              </div>
            </div>
          ) : (
            <div {...planDz.getRootProps({ "aria-label": "Upload your floor plan — PDF, PNG or JPG" })} className={`flex min-h-[140px] cursor-pointer flex-col items-center justify-center gap-2 border border-dashed px-6 text-center ${FOCUS} ${planDz.isDragActive ? "border-bp-ink-primary bg-bp-surface-raised" : "border-bp-line-control hover:bg-bp-surface-raised"}`}>
              <input {...planDz.getInputProps({ "aria-label": "Floor plan file" })} />
              <Icon name="upload_file" size={24} className="text-bp-ink-secondary" />
              <p className="t-body-sm text-bp-ink-primary">Drop your floor plan here, or choose a file</p>
              <p className="t-label-md font-bp-mono text-bp-ink-secondary">PDF, PNG or JPG · up to {mb(PLAN_MAX_BYTES)}</p>
            </div>
          )}
          {plan.kind === "too_large" ? (
            <div role="alert" className="surface-inverse flex gap-3 bg-bp-alert-surface px-5 py-4 text-bp-alert-ink" data-plan-too-large>
              <Icon name="error" size={20} />
              <div>
                <p className="t-label-caps">THAT FILE IS TOO LARGE TO UPLOAD</p>
                <p className="t-body-sm mt-1">
                  {plan.name} is {mb(plan.size)}. Export just the floor-plan sheet (one page, PDF or image) and try again — the rest of the set isn&rsquo;t needed to price your plan.
                </p>
              </div>
            </div>
          ) : plan.kind === "error" ? (
            <div role="alert" className="surface-inverse flex gap-3 bg-bp-alert-surface px-5 py-4 text-bp-alert-ink">
              <Icon name="error" size={20} />
              <p className="t-body-sm">{plan.message}</p>
            </div>
          ) : null}
        </section>
      ) : (
        <section aria-label="Your plot" className="flex flex-col gap-3">
          <p className="t-body-sm text-bp-ink-secondary">{way === "draw" ? "The canvas is your plot, so what you draw comes out in real metres." : "The canvas is your plot; your photos stay with the project and we draw the zones with you."}</p>
          <div className="max-w-[560px]">
            <PlotSizeFields value={plot} onChange={setPlot} idPrefix="intake" disabled={busy === "draw"} />
          </div>
        </section>
      )}

      <section aria-labelledby={`${ids}-more`} className="flex flex-col gap-4">
        <h2 id={`${ids}-more`} className="t-label-caps text-bp-ink-tertiary">
          {way === "photos" ? "PHOTOS OF THE GARDEN" : "ADD MORE · OPTIONAL"}
        </h2>
        <div className={`grid grid-cols-1 gap-4 ${way === "photos" ? "" : "lg:grid-cols-2"}`}>
          <div>
            <div {...photoDz.getRootProps({ "aria-label": "Add site photos — JPG, PNG or HEIC" })} className={`flex min-h-[110px] cursor-pointer flex-col items-center justify-center gap-1 border border-dashed px-6 text-center ${FOCUS} ${photoDz.isDragActive ? "border-bp-ink-primary bg-bp-surface-raised" : "border-bp-line-control hover:bg-bp-surface-raised"}`}>
              <input {...photoDz.getInputProps({ "aria-label": "Site photos" })} />
              <Icon name="add_photo_alternate" size={22} className="text-bp-ink-secondary" />
              <p className="t-body-sm text-bp-ink-primary">Site photos</p>
              <p className="t-label-md font-bp-mono text-bp-ink-secondary">JPG, PNG or HEIC</p>
            </div>
            {photos.length > 0 ? (
              <ul className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6">
                {photos.map((p) => (
                  <li key={p.id} className="relative aspect-square overflow-hidden border border-bp-line-hairline" title={p.error ?? p.status}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the user's own file */}
                    {p.previewUrl ? <img src={p.previewUrl} alt={p.name} className="size-full object-cover" /> : null}
                    <span className="t-label-md absolute inset-x-0 bottom-0 bg-bp-surface-base/90 px-1 text-bp-ink-primary">{STATUS[p.status]}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          {way !== "photos" ? (
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2" role="group" aria-label="File the next drawings under">
                {DRAWING_DISCIPLINES.map((d) => (
                  <button key={d.kind} type="button" aria-pressed={discipline === d.kind} onClick={() => setDiscipline(d.kind)} className={`inline-flex min-h-9 items-center border-b-2 px-1 t-label-md ${FOCUS} ${discipline === d.kind ? "border-bp-brass text-bp-ink-primary" : "border-transparent text-bp-ink-secondary"}`}>
                    {d.label}
                  </button>
                ))}
              </div>
              <div {...drawingDz.getRootProps({ "aria-label": `Add existing drawings as ${KIND_LABEL[discipline]}` })} className={`flex min-h-[110px] cursor-pointer flex-col items-center justify-center gap-1 border border-dashed px-6 text-center ${FOCUS} ${drawingDz.isDragActive ? "border-bp-ink-primary bg-bp-surface-raised" : "border-bp-line-control hover:bg-bp-surface-raised"}`}>
                <input {...drawingDz.getInputProps({ "aria-label": "Existing drawings" })} />
                <Icon name="description" size={22} className="text-bp-ink-secondary" />
                <p className="t-body-sm text-bp-ink-primary">Existing drawings · {KIND_LABEL[discipline]}</p>
                <p className="t-label-md font-bp-mono text-bp-ink-secondary">PDF, DWG, DXF or images · stored with the project</p>
              </div>
              {drawings.length > 0 ? (
                <ul className="mt-3">
                  {drawings.map((d) => (
                    <li key={d.id} className="flex items-center gap-3 border-b border-bp-line-hairline py-2">
                      <span className="t-body-sm min-w-0 flex-1 truncate text-bp-ink-primary">{d.name}</span>
                      <span className="t-label-md text-bp-ink-secondary">{KIND_LABEL[d.kind]}</span>
                      <span className="t-label-md text-bp-ink-secondary" title={d.error}>
                        {STATUS[d.status]}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
        {!projectId && (photos.length > 0 || drawings.length > 0) ? <p className="t-label-md text-bp-ink-secondary">Saved to your project once it exists.</p> : null}
      </section>

      <section aria-labelledby={`${ids}-about`} className="flex flex-col gap-4">
        <h2 id={`${ids}-about`} className="t-label-caps text-bp-ink-tertiary">
          ABOUT THE PROJECT
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${ids}-name`} className="t-label-caps text-bp-ink-tertiary">
              PROJECT NAME
            </label>
            <input id={`${ids}-name`} value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="e.g. Our villa — ground floor" className={INPUT} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${ids}-city`} className="t-label-caps text-bp-ink-tertiary">
              CITY
            </label>
            <select id={`${ids}-city`} value={city} onChange={(e) => setCity(e.target.value)} className={INPUT}>
              {CITIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {error ? (
        <div role="alert" className="surface-inverse bg-bp-alert-surface px-5 py-4 text-bp-alert-ink">
          <p className="t-body-sm">{error}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={onContinue}
          aria-disabled={!!blockReason}
          aria-describedby={blockReason ? `${ids}-why` : undefined}
          className={`inline-flex h-11 items-center px-5 t-nav-item-active rounded-none ${FOCUS} ${blockReason ? "cursor-not-allowed bg-bp-surface-sunken text-bp-ink-tertiary" : "bg-bp-ink-primary text-bp-ink-on-inverse hover:bg-bp-ink-secondary"}`}
          data-testid="intake-continue"
        >
          Continue
        </button>
        {blockReason ? (
          <span id={`${ids}-why`} className="t-label-md font-bp-mono text-bp-ink-secondary" aria-live="polite">
            {blockReason}
          </span>
        ) : null}
      </div>
    </div>
  );
}

const STATUS: Record<AssetStatus, string> = { queued: "Queued", uploading: "Uploading…", done: "Saved", error: "Failed" };
