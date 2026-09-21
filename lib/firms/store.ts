// =============================================================================
// lib/firms/store.ts — firms, their private rate books, and promotion (L1).
//
// Every entry read or write is scoped by `firm_id` IN THE QUERY: an entry id
// from another firm's book is simply not found through this firm's path, so a
// caller cannot read, change or delete firm B's rate by addressing it from firm
// A's. A correction can be promoted only into the book of the firm that made it.
//
// Nothing here touches `rate_book`. The reference book is the layer every firm
// overlays; it is never written by an overlay operation (asserted in
// lib/firms/__tests__/store.test.ts).
//
// There is no user-level auth in this app's API yet (every route runs with the
// service role), so "firm A cannot see firm B" is enforced by scoping — the id
// in the path — not by who is asking. When auth lands, the check belongs in
// `requireFirm` below, the one place every firm route enters through.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  FIRM_ENTRY_COLUMNS,
  toFirmEntry,
  type FirmEntryKind,
  type FirmRateEntry,
} from "@/lib/rates/firm";
import type { RateGrade } from "@/lib/rates/reference";

import { itemVocabulary, validateEntry } from "./vocabulary";

export class StoreError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 422 | 500,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "StoreError";
  }
}

export interface Firm {
  id: string;
  name: string;
  private: boolean;
  created_by: string | null;
  created_at: string;
}

export interface FirmSummary extends Firm {
  book_id: string | null;
  ohp_pct: number;
  entry_count: number;
}

const FIRM_COLUMNS = "id, name, private, created_by, created_at";

function fail(error: { message: string; code?: string } | null, what: string): never {
  if (error?.code === "23505") throw new StoreError(409, "conflict", `${what}: already exists`);
  throw new StoreError(500, "db_error", `${what}: ${error?.message ?? "unknown error"}`);
}

// --- Firms -------------------------------------------------------------------

export async function listFirms(db: SupabaseClient): Promise<Firm[]> {
  const { data, error } = await db.from("firms").select(FIRM_COLUMNS).order("name");
  if (error) fail(error, "list firms");
  return (data ?? []) as Firm[];
}

/** The one entry point for every firm-scoped operation. 404 when the firm does not exist. */
export async function requireFirm(db: SupabaseClient, firmId: string): Promise<Firm> {
  const { data, error } = await db.from("firms").select(FIRM_COLUMNS).eq("id", firmId).maybeSingle();
  if (error) fail(error, "read firm");
  if (!data) throw new StoreError(404, "firm_not_found", "Firm not found.");
  return data as Firm;
}

export async function createFirm(
  db: SupabaseClient,
  input: { name: string; private?: boolean; created_by?: string | null },
): Promise<Firm> {
  const { data, error } = await db
    .from("firms")
    .insert({ name: input.name.trim(), private: input.private ?? true, created_by: input.created_by ?? null })
    .select(FIRM_COLUMNS)
    .single();
  if (error) fail(error, `firm "${input.name}"`);
  return data as Firm;
}

/**
 * Normalise free-text attribution (040's `boq_corrections.attributed_to`) to a
 * firm row: match case- and whitespace-insensitively, create when absent.
 */
export async function findOrCreateFirmByName(db: SupabaseClient, name: string, createdBy: string): Promise<Firm> {
  const wanted = name.trim().toLowerCase();
  const all = await listFirms(db);
  const hit = all.find((f) => f.name.trim().toLowerCase() === wanted);
  if (hit) return hit;
  try {
    return await createFirm(db, { name: name.trim(), private: true, created_by: createdBy });
  } catch (e) {
    // Lost a race to another writer: read it back.
    if (e instanceof StoreError && e.status === 409) {
      const again = (await listFirms(db)).find((f) => f.name.trim().toLowerCase() === wanted);
      if (again) return again;
    }
    throw e;
  }
}

async function readBook(db: SupabaseClient, firmId: string): Promise<{ id: string; ohp_pct: number } | null> {
  const { data, error } = await db.from("firm_rate_books").select("id, ohp_pct").eq("firm_id", firmId).maybeSingle();
  if (error) fail(error, "read book");
  return data ? { id: String((data as { id: string }).id), ohp_pct: Number((data as { ohp_pct: number }).ohp_pct) || 0 } : null;
}

/** A firm's book, created on first use. A firm with no entries and no OH&P has no book at all. */
export async function ensureBook(db: SupabaseClient, firmId: string): Promise<{ id: string; ohp_pct: number }> {
  const existing = await readBook(db, firmId);
  if (existing) return existing;
  const { data, error } = await db
    .from("firm_rate_books")
    .insert({ firm_id: firmId, ohp_pct: 0 })
    .select("id, ohp_pct")
    .single();
  if (error) {
    if (error.code === "23505") {
      const again = await readBook(db, firmId);
      if (again) return again;
    }
    fail(error, "create book");
  }
  return { id: String((data as { id: string }).id), ohp_pct: Number((data as { ohp_pct: number }).ohp_pct) || 0 };
}

export async function getFirmSummary(db: SupabaseClient, firmId: string): Promise<FirmSummary> {
  const firm = await requireFirm(db, firmId);
  const book = await readBook(db, firmId);
  const { count, error } = await db
    .from("firm_rate_entries")
    .select("id", { count: "exact", head: true })
    .eq("firm_id", firmId);
  if (error) fail(error, "count entries");
  return { ...firm, book_id: book?.id ?? null, ohp_pct: book?.ohp_pct ?? 0, entry_count: count ?? 0 };
}

export async function updateFirm(
  db: SupabaseClient,
  firmId: string,
  patch: { name?: string; private?: boolean; ohp_pct?: number },
): Promise<FirmSummary> {
  await requireFirm(db, firmId);
  const firmPatch: Record<string, unknown> = {};
  if (patch.name !== undefined) firmPatch.name = patch.name.trim();
  if (patch.private !== undefined) firmPatch.private = patch.private;
  if (Object.keys(firmPatch).length > 0) {
    const { error } = await db.from("firms").update(firmPatch).eq("id", firmId);
    if (error) fail(error, "update firm");
  }
  if (patch.ohp_pct !== undefined) {
    if (!(patch.ohp_pct >= 0 && patch.ohp_pct <= 50)) throw new StoreError(422, "invalid_ohp", "ohp_pct must be between 0 and 50.");
    const book = await ensureBook(db, firmId);
    const { error } = await db
      .from("firm_rate_books")
      .update({ ohp_pct: patch.ohp_pct, updated_at: new Date().toISOString() })
      .eq("id", book.id)
      .eq("firm_id", firmId);
    if (error) fail(error, "update OH&P");
  }
  return getFirmSummary(db, firmId);
}

export async function deleteFirm(db: SupabaseClient, firmId: string): Promise<void> {
  await requireFirm(db, firmId);
  const { error } = await db.from("firms").delete().eq("id", firmId);
  if (error) fail(error, "delete firm");
}

// --- Entries -----------------------------------------------------------------

export interface EntryInput {
  item_key: string;
  grade?: RateGrade | null;
  unit: string;
  rate_aed: number;
  kind: FirmEntryKind;
  note?: string | null;
}

export async function listEntries(db: SupabaseClient, firmId: string): Promise<FirmRateEntry[]> {
  await requireFirm(db, firmId);
  const { data, error } = await db
    .from("firm_rate_entries")
    .select(FIRM_ENTRY_COLUMNS)
    .eq("firm_id", firmId)
    .order("item_key");
  if (error) fail(error, "list entries");
  return ((data ?? []) as Record<string, unknown>[]).map(toFirmEntry);
}

function assertValid(d: { item_key: string; unit: string; kind: FirmEntryKind; rate_aed: number }): void {
  const errors = validateEntry(d);
  if (errors.length > 0) throw new StoreError(422, "invalid_entry", errors.join("; "));
}

async function insertEntry(
  db: SupabaseClient,
  firmId: string,
  input: EntryInput & { origin: "firm_entry" | "promoted_correction"; correction_id?: string | null },
): Promise<FirmRateEntry> {
  assertValid(input);
  const book = await ensureBook(db, firmId);
  const { data, error } = await db
    .from("firm_rate_entries")
    .insert({
      book_id: book.id,
      firm_id: firmId,
      item_key: input.item_key,
      grade: input.grade ?? null,
      unit: input.unit,
      rate_aed: input.rate_aed,
      kind: input.kind,
      origin: input.origin,
      correction_id: input.correction_id ?? null,
      note: input.note ?? null,
    })
    .select(FIRM_ENTRY_COLUMNS)
    .single();
  if (error) fail(error, `entry ${input.item_key}${input.grade ? `/${input.grade}` : ""} (${input.origin})`);
  return toFirmEntry(data as Record<string, unknown>);
}

export async function createEntry(db: SupabaseClient, firmId: string, input: EntryInput): Promise<FirmRateEntry> {
  await requireFirm(db, firmId);
  return insertEntry(db, firmId, { ...input, origin: "firm_entry" });
}

async function readEntry(db: SupabaseClient, firmId: string, entryId: string): Promise<FirmRateEntry> {
  const { data, error } = await db
    .from("firm_rate_entries")
    .select(FIRM_ENTRY_COLUMNS)
    .eq("id", entryId)
    .eq("firm_id", firmId)
    .maybeSingle();
  if (error) fail(error, "read entry");
  // Another firm's entry id reads as NOT FOUND here, not forbidden: this path
  // does not confirm that the id exists anywhere else.
  if (!data) throw new StoreError(404, "entry_not_found", "Rate entry not found in this firm's book.");
  return toFirmEntry(data as Record<string, unknown>);
}

export async function updateEntry(
  db: SupabaseClient,
  firmId: string,
  entryId: string,
  patch: Partial<Pick<EntryInput, "rate_aed" | "unit" | "kind" | "grade" | "note">>,
): Promise<FirmRateEntry> {
  await requireFirm(db, firmId);
  const current = await readEntry(db, firmId, entryId);
  const next = { ...current, ...patch };
  assertValid(next);
  const { data, error } = await db
    .from("firm_rate_entries")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", entryId)
    .eq("firm_id", firmId)
    .select(FIRM_ENTRY_COLUMNS)
    .maybeSingle();
  if (error) fail(error, "update entry");
  if (!data) throw new StoreError(404, "entry_not_found", "Rate entry not found in this firm's book.");
  return toFirmEntry(data as Record<string, unknown>);
}

export async function deleteEntry(db: SupabaseClient, firmId: string, entryId: string): Promise<void> {
  await requireFirm(db, firmId);
  const { data, error } = await db
    .from("firm_rate_entries")
    .delete()
    .eq("id", entryId)
    .eq("firm_id", firmId)
    .select("id");
  if (error) fail(error, "delete entry");
  if (!data || (data as unknown[]).length === 0) throw new StoreError(404, "entry_not_found", "Rate entry not found in this firm's book.");
}

// --- Promotion ---------------------------------------------------------------

export interface PromoteInput {
  correction_id: string;
  /** Defaults to the correction's new_value. */
  rate_aed?: number;
  /** Defaults to the vocabulary's unit for the item. */
  unit?: string;
  kind?: FirmEntryKind;
  grade?: RateGrade | null;
  note?: string | null;
}

/**
 * Promote a firm's own market_fair correction into its private book.
 *
 * Until this runs, a correction is RECORDED and NEVER APPLIED — that has been
 * true since G5 and stays true. Promotion is the explicit act that makes it a
 * rate: tier 2 of the resolution order (origin = promoted_correction), below
 * the firm's own entered rates. Only a `rate` correction with an item_key can
 * be promoted, only by the firm that made it, and only once.
 */
export async function promoteCorrection(
  db: SupabaseClient,
  firmId: string,
  input: PromoteInput,
): Promise<{ entry: FirmRateEntry; correction_id: string }> {
  await requireFirm(db, firmId);
  const { data, error } = await db
    .from("boq_corrections")
    .select("id, firm_id, correction_type, item_key, new_value, promoted_at, line_description")
    .eq("id", input.correction_id)
    .maybeSingle();
  if (error) fail(error, "read correction");
  const c = data as {
    id: string;
    firm_id: string | null;
    correction_type: string;
    item_key: string | null;
    new_value: number | null;
    promoted_at: string | null;
    line_description: string;
  } | null;
  if (!c) throw new StoreError(404, "correction_not_found", "Correction not found.");
  if (c.firm_id !== firmId) {
    throw new StoreError(403, "not_this_firms_correction", "A correction can only be promoted into the book of the firm that made it.");
  }
  if (c.promoted_at) throw new StoreError(409, "already_promoted", "This correction has already been promoted.");
  if (c.correction_type !== "rate") {
    throw new StoreError(422, "not_a_rate", `Only a rate correction can become a rate (this one is "${c.correction_type}").`);
  }
  if (!c.item_key) throw new StoreError(422, "no_item_key", "The correction names no item_key, so there is nothing for the rate to price.");
  const rate = input.rate_aed ?? (c.new_value == null ? null : Number(c.new_value));
  if (rate == null) throw new StoreError(422, "no_rate", "The correction carries no new_value; pass rate_aed.");
  const vocab = itemVocabulary(c.item_key);
  if (!vocab) throw new StoreError(422, "invalid_entry", `"${c.item_key}" is not an item any take-off prices`);
  const unit = input.unit ?? vocab.unit;
  if (!unit) throw new StoreError(422, "unit_required", `${c.item_key} has no fixed unit; pass unit.`);

  const entry = await insertEntry(db, firmId, {
    item_key: c.item_key,
    grade: input.grade ?? null,
    unit,
    rate_aed: rate,
    kind: input.kind ?? vocab.default_kind,
    note: input.note ?? `promoted from correction: ${c.line_description}`,
    origin: "promoted_correction",
    correction_id: c.id,
  });
  const upd = await db
    .from("boq_corrections")
    .update({ promoted_at: new Date().toISOString(), promoted_entry_id: entry.id })
    .eq("id", c.id)
    .eq("firm_id", firmId);
  if (upd.error) {
    // Keep the two in step: an entry with no marked correction could be promoted twice.
    await db.from("firm_rate_entries").delete().eq("id", entry.id).eq("firm_id", firmId);
    fail(upd.error, "mark correction promoted");
  }
  return { entry, correction_id: c.id };
}

// --- Project assignment ------------------------------------------------------

export async function assignProjectFirm(db: SupabaseClient, projectId: string, firmId: string | null): Promise<void> {
  if (firmId) await requireFirm(db, firmId);
  const { data, error } = await db.from("projects").update({ firm_id: firmId }).eq("id", projectId).select("id");
  if (error) fail(error, "assign project firm");
  if (!data || (data as unknown[]).length === 0) throw new StoreError(404, "project_not_found", "Project not found.");
}
