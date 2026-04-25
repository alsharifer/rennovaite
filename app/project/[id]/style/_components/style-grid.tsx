"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Style } from "@/lib/styles";

type Props = {
  styles: Style[];
  projectId: string;
};

type SubmitStatus = "idle" | "submitting" | "error";

// Cost delta is rounded to the nearest thousand AED for display ("AED +60k").
// Deltas of zero render as a neutral "Baseline" pill.
function formatCostDelta(delta: number): {
  label: string;
  tone: "neutral" | "positive" | "negative";
} {
  if (delta === 0) return { label: "Baseline", tone: "neutral" };
  const abs = Math.abs(delta);
  const k = Math.round(abs / 1000);
  const sign = delta > 0 ? "+" : "−";
  return { label: `AED ${sign}${k}k`, tone: delta > 0 ? "positive" : "negative" };
}

export function StyleGrid({ styles, projectId }: Props) {
  const router = useRouter();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const opened = styles.find((s) => s.key === openKey) ?? null;

  const close = () => {
    setOpenKey(null);
    setStatus("idle");
    setError(null);
  };

  const submit = async (styleKey: string) => {
    setStatus("submitting");
    setError(null);
    try {
      const res = await fetch("/api/style-choice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, style_key: styleKey }),
      });
      const body = (await res.json().catch(() => null)) as
        | { success?: boolean; error?: string }
        | null;
      if (!res.ok || !body?.success) {
        throw new Error(body?.error ?? `Save failed (${res.status}).`);
      }
      router.push(`/project/${projectId}/render`);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Save failed.");
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        {styles.map((style) => (
          <StyleCard
            key={style.key}
            style={style}
            onClick={() => setOpenKey(style.key)}
          />
        ))}
      </div>

      <Dialog
        open={!!opened}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <DialogContent className="border border-bg-border bg-bg-overlay text-text-primary backdrop-blur-md sm:max-w-2xl">
          {opened && (
            <StyleDetail
              style={opened}
              status={status}
              error={error}
              onSubmit={() => submit(opened.key)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------

function StyleCard({
  style,
  onClick,
}: {
  style: Style;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex flex-col gap-4 rounded-xl border border-bg-border bg-bg-elevated/60 p-4 text-left backdrop-blur-sm",
        "transition-all duration-200 outline-none",
        "hover:-translate-y-0.5 hover:border-brand-primary/40 hover:bg-bg-elevated/80 hover:shadow-[0_18px_40px_-18px_rgba(168,85,247,0.45)]",
        "focus-visible:ring-4 focus-visible:ring-brand-primary/30",
      )}
    >
      <div className="grid grid-cols-2 gap-1.5">
        {style.reference_images.map((src, i) => (
          <ImageTile
            key={src}
            src={src}
            alt={`${style.name_en} reference ${i + 1}`}
            palette={style.palette}
            index={i}
          />
        ))}
      </div>

      <div className="flex flex-col gap-0.5">
        <h3 className="font-serif text-2xl leading-tight text-text-primary">
          {style.name_en}
        </h3>
        <p
          className="text-sm text-text-tertiary"
          dir="rtl"
          lang="ar"
        >
          {style.name_ar}
        </p>
      </div>

      <p className="text-sm leading-relaxed text-text-secondary">
        {style.one_line}
      </p>

      <div className="mt-auto flex items-center justify-between gap-3">
        <CostChip delta={style.cost_delta_aed} />
        <PaletteDots colors={style.palette} />
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------

function StyleDetail({
  style,
  status,
  error,
  onSubmit,
}: {
  style: Style;
  status: SubmitStatus;
  error: string | null;
  onSubmit: () => void;
}) {
  return (
    <>
      <DialogHeader className="text-left">
        <DialogTitle className="font-serif text-3xl leading-tight text-text-primary">
          {style.name_en}
        </DialogTitle>
        <DialogDescription
          className="text-base text-text-tertiary"
          dir="rtl"
          lang="ar"
        >
          {style.name_ar}
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-2 gap-2">
        {style.reference_images.map((src, i) => (
          <ImageTile
            key={src}
            src={src}
            alt={`${style.name_en} reference ${i + 1}`}
            palette={style.palette}
            index={i}
          />
        ))}
      </div>

      <p className="text-sm leading-relaxed text-text-secondary">
        {style.one_line}
      </p>

      <div className="flex items-center justify-between gap-3">
        <CostChip delta={style.cost_delta_aed} />
        <PaletteDots colors={style.palette} />
      </div>

      {status === "error" && error && (
        <p className="text-xs text-status-error">{error}</p>
      )}

      <DialogFooter>
        <DialogClose
          render={
            <Button
              variant="ghost"
              className="text-text-secondary hover:text-text-primary"
            />
          }
        >
          Cancel
        </DialogClose>
        <Button onClick={onSubmit} disabled={status === "submitting"}>
          {status === "submitting" ? (
            <>
              <Loader2 className="animate-spin" />
              Saving…
            </>
          ) : (
            <>Use this style</>
          )}
        </Button>
      </DialogFooter>
    </>
  );
}

// ---------------------------------------------------------------------------

function ImageTile({
  src,
  alt,
  palette,
  index,
}: {
  src: string;
  alt: string;
  palette: string[];
  index: number;
}) {
  const [errored, setErrored] = useState(false);
  if (errored) {
    // Fallback gradient using two adjacent palette colors so cards still
    // feel "of the style" while moodboard PNGs are missing.
    const a = palette[index % palette.length];
    const b = palette[(index + 1) % palette.length];
    return (
      <div
        className="aspect-square rounded-md border border-bg-border"
        style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}
        aria-label={alt}
      />
    );
  }
  return (
    // Using a plain <img> instead of next/image so we don't have to register
    // the Supabase host in next.config.ts and so loading="lazy" works
    // identically across the moodboards bucket.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setErrored(true)}
      className="aspect-square w-full rounded-md object-cover"
    />
  );
}

function CostChip({ delta }: { delta: number }) {
  const cost = formatCostDelta(delta);
  const cls =
    cost.tone === "neutral"
      ? "border-bg-border bg-bg-overlay text-text-secondary"
      : cost.tone === "positive"
        ? "border-[#B85042]/40 bg-[#B85042]/15 text-[#E9B7B0]"
        : "border-status-success/40 bg-status-success/15 text-status-success";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        cls,
      )}
    >
      {cost.label}
    </span>
  );
}

function PaletteDots({ colors }: { colors: string[] }) {
  return (
    <div className="flex items-center gap-1">
      {colors.map((c, i) => (
        <span
          key={i}
          className="size-3.5 rounded-full border border-bg-border ring-1 ring-bg-base/40"
          style={{ backgroundColor: c }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}
