// =============================================================================
// lib/rates/firm.ts — a firm's private rate book as an OVERLAY (L1).
//
// A firm entry SHADOWS the reference rate for that firm's projects only. The
// overlay is built for ONE project from ONE firm's book, and it refuses to be
// built from anything else: a book belonging to another firm, or an entry that
// is not the book's own, throws `FirmIsolationError` instead of pricing. Firm A's
// rates therefore cannot resolve on firm B's project even if a query upstream
// were written wrongly — the loader scopes by firm, and this guard re-checks what
// it was handed.
//
// Nothing here writes, and nothing here reads `rate_book`: the reference book is
// the layer underneath, untouched (lib/rates/reference.ts).
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { RateGrade } from "./reference";

export const FIRM_ENTRY_KINDS = ["labour", "supply", "supply_and_install", "lump"] as const;
export type FirmEntryKind = (typeof FIRM_ENTRY_KINDS)[number];
export const FIRM_ENTRY_ORIGINS = ["firm_entry", "promoted_correction"] as const;
export type FirmEntryOrigin = (typeof FIRM_ENTRY_ORIGINS)[number];

export interface FirmRateEntry {
  id: string;
  firm_id: string;
  book_id: string;
  item_key: string;
  /** null = the entry applies at every grade; an exact grade beats it. */
  grade: RateGrade | null;
  unit: string;
  rate_aed: number;
  kind: FirmEntryKind;
  origin: FirmEntryOrigin;
  correction_id: string | null;
}

export interface FirmBook {
  firm_id: string;
  book_id: string;
  /** Overheads & profit, applied at BoQ assembly as its own line (lib/rates/ohp.ts). */
  ohp_pct: number;
  entries: FirmRateEntry[];
}

export interface FirmHit {
  entry: FirmRateEntry;
  tier: "firm_private" | "firm_correction";
}

export class FirmIsolationError extends Error {
  constructor(detail: string) {
    super(`Firm rate isolation violated: ${detail}`);
    this.name = "FirmIsolationError";
  }
}

export class FirmRateUnitError extends Error {
  constructor(entry: FirmRateEntry, measured: string) {
    super(
      `Firm rate entry ${entry.id} prices ${entry.item_key} per "${entry.unit}", but the take-off measures it in "${measured}". Fix the entry — a rate in the wrong unit is never applied silently.`,
    );
    this.name = "FirmRateUnitError";
  }
}

export class FirmOverlay {
  private constructor(
    /** The firm whose book this is; null = no firm (reference only). */
    readonly firmId: string | null,
    private readonly byKey: ReadonlyMap<string, readonly FirmRateEntry[]>,
    readonly ohpPct: number,
  ) {}

  /** The overlay for a project with no firm: resolves nothing, adds no OH&P. */
  static none(): FirmOverlay {
    return new FirmOverlay(null, new Map(), 0);
  }

  /**
   * The overlay for ONE project. `projectFirmId` is the project's own firm;
   * `book` must be that firm's book or null (a firm that has not written one).
   */
  static forProject(projectFirmId: string | null, book: FirmBook | null): FirmOverlay {
    if (!projectFirmId) {
      if (book) throw new FirmIsolationError(`a firm book (${book.firm_id}) was supplied for a project with no firm`);
      return FirmOverlay.none();
    }
    if (!book) return new FirmOverlay(projectFirmId, new Map(), 0);
    if (book.firm_id !== projectFirmId) {
      throw new FirmIsolationError(`book of firm ${book.firm_id} supplied for a project of firm ${projectFirmId}`);
    }
    const byKey = new Map<string, FirmRateEntry[]>();
    for (const e of book.entries) {
      if (e.firm_id !== projectFirmId || e.book_id !== book.book_id) {
        throw new FirmIsolationError(`entry ${e.id} belongs to firm ${e.firm_id} / book ${e.book_id}, not ${projectFirmId} / ${book.book_id}`);
      }
      const arr = byKey.get(e.item_key) ?? [];
      arr.push(e);
      byKey.set(e.item_key, arr);
    }
    return new FirmOverlay(projectFirmId, byKey, Number(book.ohp_pct) || 0);
  }

  get isEmpty(): boolean {
    return this.byKey.size === 0;
  }

  /**
   * Tiers 1 and 2 of the resolution order (lib/rates/tiers.ts). A firm's own
   * entry beats its promoted correction; within each, an exact grade beats a
   * grade-less entry. With `unit`, an entry in a different unit THROWS.
   */
  lookup(item_key: string, grade: RateGrade, unit?: string): FirmHit | null {
    const entries = this.byKey.get(item_key);
    if (!entries) return null;
    const pick = (origin: FirmEntryOrigin) =>
      entries.find((e) => e.origin === origin && e.grade === grade) ??
      entries.find((e) => e.origin === origin && e.grade === null);
    const own = pick("firm_entry");
    const promoted = own ? null : pick("promoted_correction");
    const entry = own ?? promoted;
    if (!entry) return null;
    if (unit !== undefined && entry.unit !== unit) throw new FirmRateUnitError(entry, unit);
    return { entry, tier: own ? "firm_private" : "firm_correction" };
  }
}

// --- Loading -----------------------------------------------------------------

export const FIRM_ENTRY_COLUMNS =
  "id, firm_id, book_id, item_key, grade, unit, rate_aed, kind, origin, correction_id";

/** A missing table / column (pre-041) reads as "no firm", like every other additive migration. */
export function isMissingSchema(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    /does not exist|could not find the .* (table|column)/i.test(error.message ?? "")
  );
}

export function toFirmEntry(r: Record<string, unknown>): FirmRateEntry {
  return {
    id: String(r.id),
    firm_id: String(r.firm_id),
    book_id: String(r.book_id),
    item_key: String(r.item_key),
    grade: (r.grade ?? null) as RateGrade | null,
    unit: String(r.unit),
    rate_aed: Number(r.rate_aed),
    kind: r.kind as FirmEntryKind,
    origin: r.origin as FirmEntryOrigin,
    correction_id: (r.correction_id ?? null) as string | null,
  };
}

/** One firm's book, scoped by firm id on BOTH reads. null = the firm has no book yet. */
export async function loadFirmBook(supabase: SupabaseClient, firmId: string): Promise<FirmBook | null> {
  const bookRes = await supabase
    .from("firm_rate_books")
    .select("id, firm_id, ohp_pct")
    .eq("firm_id", firmId)
    .maybeSingle();
  if (bookRes.error) throw new Error(`firm_rate_books read failed: ${bookRes.error.message}`);
  const book = bookRes.data as { id: string; firm_id: string; ohp_pct: number } | null;
  if (!book) return null;
  const entRes = await supabase
    .from("firm_rate_entries")
    .select(FIRM_ENTRY_COLUMNS)
    .eq("firm_id", firmId)
    .eq("book_id", book.id);
  if (entRes.error) throw new Error(`firm_rate_entries read failed: ${entRes.error.message}`);
  return {
    firm_id: String(book.firm_id),
    book_id: String(book.id),
    ohp_pct: Number(book.ohp_pct) || 0,
    entries: ((entRes.data ?? []) as Record<string, unknown>[]).map(toFirmEntry),
  };
}

/**
 * The overlay that prices `projectId`. A project with no firm (every project
 * before L1) gets `FirmOverlay.none()`. A project WITH a firm whose book cannot
 * be read throws — pricing a firm's project at reference rates without saying
 * so would be a silent wrong number.
 */
export async function loadProjectFirmOverlay(supabase: SupabaseClient, projectId: string): Promise<FirmOverlay> {
  const proj = await supabase.from("projects").select("firm_id").eq("id", projectId).maybeSingle();
  if (proj.error) {
    if (isMissingSchema(proj.error)) return FirmOverlay.none();
    throw new Error(`project firm read failed: ${proj.error.message}`);
  }
  const firmId = (proj.data as { firm_id: string | null } | null)?.firm_id ?? null;
  if (!firmId) return FirmOverlay.none();
  return FirmOverlay.forProject(firmId, await loadFirmBook(supabase, firmId));
}
