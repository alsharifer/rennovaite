// =============================================================================
// lib/documents/pack-export/types.ts — the one gated path for client documents (T5).
// =============================================================================

/** How the module reaches the app's routes. The CLI and the in-app job differ ONLY here. */
export interface PackTransport {
  get<T>(path: string): Promise<{ status: number; body: T }>;
  post(path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }>;
  bytes(path: string): Promise<{ status: number; bytes: Uint8Array }>;
  text(path: string): Promise<{ status: number; text: string }>;
}

/** Where released documents are written: a local folder (CLI) or the private `packs` bucket (app). */
export interface PackSink {
  write(name: string, bytes: Uint8Array, contentType: string): Promise<{ path: string }>;
}

export type PackStep = "readiness" | "boq" | "renders" | "photo_pairs" | "documents" | "checks" | "manifest" | "done";

export interface PackProgress {
  step: PackStep;
  pct: number;
  note: string;
}

export interface PackCheck {
  label: string;
  ok: boolean;
  detail: string;
}

export interface PackExportOptions {
  /**
   * full   — render every view through the faithfulness + consistency gates
   *          (cached views return at once, new ones are rendered);
   * cached — use existing renders only: a view that would need rendering is
   *          reported missing and no render is spent (a consistency verdict not
   *          yet recorded for the anchor is still computed);
   * skip   — no render step (interior projects, or a documents-only re-run).
   */
  renders: "full" | "cached" | "skip";
  /** Before/after photo pairs to attempt (one per zone). */
  pairs: number;
  /** Regenerate the BoQ first (the script's behaviour). */
  regenerateBoq: boolean;
  /**
   * Produce the BoQ PDF. Always true in the app; false only for a CLI reference
   * pack, whose rates are negotiated and never leave as a BoQ document.
   */
  boqPdf: boolean;
  /** Pilot-event stage for what this run causes ("verification" is excluded from metrics). */
  stage?: string | null;
}

export const DEFAULT_PACK_OPTIONS: PackExportOptions = { renders: "full", pairs: 3, regenerateBoq: true, boqPdf: true, stage: null };

export interface PackOutput {
  name: string;
  path: string;
  bytes: number;
  sha256: string;
  content_type: string;
}

export interface ChecklistItem {
  key: string;
  ok: boolean;
  title: string;
  detail: string;
  /** The specific things to fix (names of counters, items, rooms, lines). */
  items: string[];
  /** Where to fix it. */
  fix: { label: string; href: string } | null;
}

export type PackScope = "garden" | "interior" | "mixed";

export interface PackExportResult {
  status: "passed" | "blocked" | "failed";
  scope: PackScope;
  checklist: ChecklistItem[];
  checks: PackCheck[];
  outputs: PackOutput[];
  manifest: Record<string, unknown>;
}
