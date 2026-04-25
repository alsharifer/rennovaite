"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  AlertTriangle,
  FileText,
  Mail,
  RotateCcw,
  UploadCloud,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const MAX_SIZE_BYTES = 20 * 1024 * 1024;
const ACCEPT = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
};

const PARSE_STEPS = [
  "Extracting walls",
  "Identifying rooms",
  "Measuring areas",
] as const;
const PARSE_STEP_INTERVAL_MS = 3000;

const SUPPORT_EMAIL = "founders@rennovaite.ai";

type Status = "idle" | "uploading" | "parsing" | "error";
type ErrorKind = "validation" | "upload" | "parse";

type UploadResponse = {
  project_id: string;
  plan_id: string;
  pdf_url: string;
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

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress((event.loaded / event.total) * 100);
      }
    };

    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        reject(
          new Error(
            `Upload failed (${xhr.status}). The server did not return JSON — check the dev server logs.`,
          ),
        );
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as UploadResponse);
      } else {
        const message =
          body && typeof body === "object" && "error" in body
            ? String((body as { error: unknown }).error)
            : `Upload failed (${xhr.status}).`;
        reject(new Error(message));
      }
    };

    xhr.onerror = () =>
      reject(new Error("Network error — check your connection and try again."));
    xhr.onabort = () => reject(new Error("Upload was cancelled."));

    xhr.send(form);
  });
}

function buildSupportMailto(filename: string | null, error: string): string {
  const subject = "Help with floorplan parse";
  const lines = [
    "Hi RennovAIte team,",
    "",
    `I uploaded a floorplan${filename ? ` (${filename})` : ""} and the parser couldn't read it.`,
    "Could you take a look?",
    "",
    `Error from the app: ${error}`,
    "",
    "Please attach the original file when you reply.",
    "Thanks!",
  ];
  const body = lines.join("\n");
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function FloorplanUpload() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<ErrorKind>("validation");
  const [parseStep, setParseStep] = useState(0);

  // Cycle the parse sub-states every PARSE_STEP_INTERVAL_MS while parsing.
  useEffect(() => {
    if (status !== "parsing") {
      setParseStep(0);
      return;
    }
    setParseStep(0);
    const interval = setInterval(() => {
      setParseStep((s) => Math.min(s + 1, PARSE_STEPS.length - 1));
    }, PARSE_STEP_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [status]);

  const reset = useCallback(() => {
    setFile(null);
    setStatus("idle");
    setProgress(0);
    setError(null);
    setErrorKind("validation");
  }, []);

  const onDrop = useCallback(
    async (accepted: File[]) => {
      const next = accepted[0];
      if (!next) return;

      console.log("[floorplan] selected:", next.name);
      setFile(next);
      setError(null);
      setProgress(0);
      setStatus("uploading");

      let uploadResult: UploadResponse;
      try {
        uploadResult = await uploadWithProgress(next, setProgress);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Upload failed.";
        console.error("[floorplan] upload failed:", err);
        setStatus("error");
        setErrorKind("upload");
        setError(message);
        return;
      }

      setProgress(100);
      setStatus("parsing");

      try {
        const parseRes = await fetch("/api/parse-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan_id: uploadResult.plan_id }),
        });
        const parseBody = (await parseRes.json().catch(() => null)) as
          | { success?: boolean; error?: string }
          | null;
        if (!parseRes.ok || !parseBody?.success) {
          throw new Error(
            parseBody?.error ??
              `Parsing failed (${parseRes.status}). Please try again.`,
          );
        }
        router.push(`/project/${uploadResult.project_id}/plan`);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Parsing failed.";
        console.error("[floorplan] parse failed:", err);
        setStatus("error");
        setErrorKind("parse");
        setError(message);
      }
    },
    [router],
  );

  const onDropRejected = useCallback(() => {
    setStatus("error");
    setErrorKind("validation");
    setError("Please upload a PDF, PNG, or JPG under 20 MB.");
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected,
    accept: ACCEPT,
    maxSize: MAX_SIZE_BYTES,
    multiple: false,
    disabled: status === "uploading" || status === "parsing",
  });

  // ----- Friendly parse-failure screen ----------------------------------

  if (status === "error" && errorKind === "parse") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="rounded-xl border border-bg-border bg-bg-elevated/80 p-8 text-center backdrop-blur-sm"
      >
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-status-warning/15 text-status-warning">
          <AlertTriangle className="size-6" />
        </div>
        <h2 className="mt-5 font-display text-2xl font-semibold tracking-tight text-text-primary">
          We had trouble reading that plan
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-text-secondary">
          Try a clearer scan or higher-resolution PDF
          {file ? ` (${file.name})` : ""}, or send it to us and a human will
          help.
        </p>
        {error && (
          <p className="mx-auto mt-3 max-w-md text-xs text-text-tertiary">
            <span className="text-text-secondary">Details:</span> {error}
          </p>
        )}
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Button onClick={reset} size="lg">
            <RotateCcw />
            Try another file
          </Button>
          <Button
            variant="outline"
            size="lg"
            nativeButton={false}
            render={<a href={buildSupportMailto(file?.name ?? null, error ?? "")} />}
            className="border-bg-border bg-bg-elevated text-text-primary hover:bg-bg-overlay"
          >
            <Mail />
            Email {SUPPORT_EMAIL}
          </Button>
        </div>
      </motion.div>
    );
  }

  // ----- Uploading + parsing card ---------------------------------------

  if ((status === "uploading" || status === "parsing") && file) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="rounded-xl border border-bg-border bg-bg-elevated/80 p-5 backdrop-blur-sm"
      >
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-primary/15 text-brand-primary">
            <FileText className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-text-primary">
              {file.name}
            </p>
            <div className="mt-0.5 flex items-baseline gap-2 text-xs text-text-secondary">
              {status === "uploading" ? (
                <span>Uploading…</span>
              ) : (
                <span className="flex items-baseline gap-1.5">
                  <span>Parsing your plan…</span>
                  <span className="relative inline-block min-w-[120px] text-text-tertiary">
                    <AnimatePresence mode="wait">
                      <motion.span
                        key={parseStep}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.25, ease: "easeOut" }}
                        className="inline-block"
                      >
                        {PARSE_STEPS[parseStep]}
                      </motion.span>
                    </AnimatePresence>
                  </span>
                </span>
              )}
              <span className="text-text-tertiary">
                · {(file.size / (1024 * 1024)).toFixed(1)} MB
              </span>
            </div>
            <Progress
              value={status === "parsing" ? 100 : progress}
              className="mt-3"
            />
          </div>
        </div>
      </motion.div>
    );
  }

  // ----- Idle dropzone (with optional small validation/upload error) ----

  return (
    <div className="space-y-3">
      <div
        {...getRootProps()}
        className={cn(
          "flex h-[280px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 text-center transition-all duration-200 outline-none backdrop-blur-sm",
          "focus-visible:ring-4 focus-visible:ring-brand-primary/40",
          status === "error"
            ? "border-status-error bg-status-error/5"
            : "border-brand-primary bg-bg-elevated/40",
          isDragActive
            ? "scale-[1.01] bg-brand-primary/10 shadow-[0_0_0_6px_rgba(168,85,247,0.22)]"
            : status === "error"
              ? ""
              : "hover:bg-brand-primary/[0.08]",
        )}
      >
        <input {...getInputProps()} />
        <UploadCloud
          className={cn(
            "size-10 transition-transform duration-200",
            status === "error" ? "text-status-error" : "text-brand-primary",
            isDragActive && "-translate-y-0.5",
          )}
        />
        <p className="mt-4 text-lg font-medium text-text-primary">
          Drop your villa floorplan here
        </p>
        <p className="mt-1 text-sm text-text-secondary">
          PDF, PNG, or JPG · up to 20 MB
        </p>
      </div>

      {status === "error" && error && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-status-error/40 bg-status-error/10 px-3 py-2 text-sm text-status-error">
          <div className="flex min-w-0 items-start gap-2">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 break-words">{error}</span>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={reset}
            aria-label="Dismiss error"
            className="text-status-error hover:bg-status-error/20 hover:text-status-error"
          >
            <X />
          </Button>
        </div>
      )}
    </div>
  );
}
