// =============================================================================
// lib/firms/store.ts — firms, their private rate books, and promotion (L1 + U1).
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
// U1 — who is asking. Every firm-scoped operation takes the `Caller` the route
// resolved (lib/auth/caller.ts) and enters through `requireFirm`, which answers
//   401 unauthenticated   nobody is signed in
//   404 firm_not_found    the firm does not exist
//   403 not_a_member      it exists and the caller is not one of its members
// in that order — an anonymous call learns nothing about which firms exist, and
// a signed-in user of firm A reaching for firm B is refused on AUTHENTICATION
// grounds, not lost in scoping. The check is application code on purpose: the
// routes run on the service role, which RLS never sees.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Caller } from "@/lib/auth/caller";
import {
  FIRM_ENTRY_COLUMNS,
  FIRM_ENTRY_COLUMNS_PRE045,
  isMissingSchema,
  toFirmEntry,
  type FirmEntryKind,
  type FirmRateEntry,
} from "@/lib/rates/firm";
import type { RateGrade } from "@/lib/rates/reference";

import { recordPilotEvent } from "@/lib/pilot/events";

import { itemVocabulary, validateEntry } from "./vocabulary";

import { StoreError } from "@/lib/store-error";

export { StoreError };

export interface Firm {
  id: string;
  name: string;
  private: boolean;
  created_by: string | null;
  created_at: string;
}

export type BookStatus = "draft" | "reviewed";

export interface FirmSummary extends Firm {
  book_id: string | null;
  ohp_pct: number;
  entry_count: number;
  /** U2: draft until a member marks it reviewed; any later change returns it to draft. */
  status: BookStatus;
  reviewed_at: string | null;
}

const FIRM_COLUMNS = "id, name, private, created_by, created_at";

function fail(error: { message: string; code?: string } | null, what: string): never {
  if (error?.code === "23505") throw new StoreError(409, "conflict", `${what}: already exists`);
  throw new StoreError(500, "db_error", `${what}: ${error?.message ?? "unknown error"}`);
}

// --- Who is asking -------------------------------------------------------------

function requireCaller(caller: Caller | null): Caller {
  if (!caller) throw new StoreError(401, "unauthenticated", "Sign in to work with a firm.");
  return caller;
}

async function isMember(db: SupabaseClient, firmId: string, userId: string): Promise<boolean> {
  const { data, error } = await db
    .from("firm_members")
    .select("firm_id")
    .eq("firm_id", firmId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) fail(error, "read membership");
  return !!data;
}

async function addMember(db: SupabaseClient, firmId: string, userId: string): Promise<void> {
  const { error } = await db.from("firm_members").insert({ firm_id: firmId, user_id: userId });
  // Already a member is not an error.
  if (error && error.code !== "23505") fail(error, "add member");
}

/** The firm ids the caller belongs to. */
async function memberFirmIds(db: SupabaseClient, userId: string): Promise<string[]> {
  const { data, error } = await db.from("firm_members").select("firm_id").eq("user_id", userId);
  if (error) fail(error, "list memberships");
  return ((data ?? []) as { firm_id: string }[]).map((r) => r.firm_id);
}

// --- Firms -------------------------------------------------------------------

/** The CALLER's firms — never everyone's. */
export async function listFirms(db: SupabaseClient, caller: Caller | null): Promise<Firm[]> {
  const who = requireCaller(caller);
  const ids = await memberFirmIds(db, who.id);
  if (ids.length === 0) return [];
  const { data, error } = await db.from("firms").select(FIRM_COLUMNS).in("id", ids).order("name");
  if (error) fail(error, "list firms");
  return (data ?? []) as Firm[];
}

/**
 * The one entry point for every firm-scoped operation: 401 nobody signed in,
 * 404 no such firm, 403 not a member — in that order.
 */
export async function requireFirm(db: SupabaseClient, firmId: string, caller: Caller | null): Promise<Firm> {
  const who = requireCaller(caller);
  const { data, error } = await db.from("firms").select(FIRM_COLUMNS).eq("id", firmId).maybeSingle();
  if (error) fail(error, "read firm");
  if (!data) throw new StoreError(404, "firm_not_found", "Firm not found.");
  if (!(await isMember(db, firmId, who.id))) {
    throw new StoreError(403, "not_a_member", "You are not a member of this firm.");
  }
  return data as Firm;
}

/** Create a firm; the caller becomes its first member. */
export async function createFirm(
  db: SupabaseClient,
  input: { name: string; private?: boolean; created_by?: string | null },
  caller: Caller | null,
): Promise<Firm> {
  const who = requireCaller(caller);
  const { data, error } = await db
    .from("firms")
    .insert({
      name: input.name.trim(),
      private: input.private ?? true,
      created_by: input.created_by ?? who.email ?? who.id,
    })
    .select(FIRM_COLUMNS)
    .single();
  if (error) fail(error, `firm "${input.name}"`);
  const firm = data as Firm;
  await addMember(db, firm.id, who.id);
  return firm;
}

/**
 * Normalise free-text attribution (040's `boq_corrections.attributed_to`) to a
 * firm row the CALLER belongs to: match case- and whitespace-insensitively (403
 * if the match is not the caller's firm), create when absent (the caller
 * becomes a member).
 */
export async function findOrCreateFirmByName(
  db: SupabaseClient,
  name: string,
  createdBy: string,
  caller: Caller | null,
): Promise<Firm> {
  const who = requireCaller(caller);
  const wanted = name.trim().toLowerCase();
  const { data, error } = await db.from("firms").select(FIRM_COLUMNS);
  if (error) fail(error, "list firms");
  const hit = ((data ?? []) as Firm[]).find((f) => f.name.trim().toLowerCase() === wanted);
  if (hit) {
    if (!(await isMember(db, hit.id, who.id))) {
      throw new StoreError(403, "not_a_member", `A firm named "${hit.name}" exists and you are not a member of it.`);
    }
    return hit;
  }
  try {
    return await createFirm(db, { name: name.trim(), private: true, created_by: createdBy }, who);
  } catch (e) {
    // Lost a race to another writer: read it back — and it must still be ours.
    if (e instanceof StoreError && e.status === 409) {
      const again = await db.from("firms").select(FIRM_COLUMNS);
      const f = ((again.data ?? []) as Firm[]).find((x) => x.name.trim().toLowerCase() === wanted);
      if (f) {
        if (!(await isMember(db, f.id, who.id))) throw new StoreError(403, "not_a_member", `A firm named "${f.name}" exists and you are not a member of it.`);
        return f;
      }
    }
    throw e;
  }
}

interface BookRow {
  id: string;
  ohp_pct: number;
  status: BookStatus;
  reviewed_at: string | null;
}

function toBookRow(data: Record<string, unknown>): BookRow {
  return {
    id: String(data.id),
    ohp_pct: Number(data.ohp_pct) || 0,
    status: data.status === "reviewed" ? "reviewed" : "draft",
    reviewed_at: (data.reviewed_at as string | null | undefined) ?? null,
  };
}

async function readBook(db: SupabaseClient, firmId: string): Promise<BookRow | null> {
  const { data, error } = await db.from("firm_rate_books").select("id, ohp_pct, status, reviewed_at").eq("firm_id", firmId).maybeSingle();
  if (error) fail(error, "read book");
  return data ? toBookRow(data as Record<string, unknown>) : null;
}

/**
 * U2: a change to the book's CONTENT (an entry or the OH&P) returns it to
 * draft — a review of a book that has since changed is a review of a
 * different book. Called after every mutation; a no-op on a draft.
 */
export async function touchBook(db: SupabaseClient, firmId: string): Promise<void> {
  const { error } = await db
    .from("firm_rate_books")
    .update({ status: "draft", reviewed_at: null, updated_at: new Date().toISOString() })
    .eq("firm_id", firmId)
    .eq("status", "reviewed");
  if (error) fail(error, "return book to draft");
}

/** A firm's book, created on first use. A firm with no entries and no OH&P has no book at all. */
export async function ensureBook(db: SupabaseClient, firmId: string): Promise<BookRow> {
  const existing = await readBook(db, firmId);
  if (existing) return existing;
  const { data, error } = await db
    .from("firm_rate_books")
    .insert({ firm_id: firmId, ohp_pct: 0 })
    .select("id, ohp_pct, status, reviewed_at")
    .single();
  if (error) {
    if (error.code === "23505") {
      const again = await readBook(db, firmId);
      if (again) return again;
    }
    fail(error, "create book");
  }
  return toBookRow(data as Record<string, unknown>);
}

export async function getFirmSummary(db: SupabaseClient, firmId: string, caller: Caller | null): Promise<FirmSummary> {
  const firm = await requireFirm(db, firmId, caller);
  const book = await readBook(db, firmId);
  let counted: { count: number | null; error: { code?: string; message: string } | null } = await db
    .from("firm_rate_entries")
    .select("id", { count: "exact", head: true })
    .eq("firm_id", firmId)
    .is("superseded_at", null);
  if (counted.error && isMissingSchema(counted.error)) {
    counted = await db.from("firm_rate_entries").select("id", { count: "exact", head: true }).eq("firm_id", firmId);
  }
  const { count, error } = counted;
  if (error) fail(error, "count entries");
  return {
    ...firm,
    book_id: book?.id ?? null,
    ohp_pct: book?.ohp_pct ?? 0,
    entry_count: count ?? 0,
    status: book?.status ?? "draft",
    reviewed_at: book?.reviewed_at ?? null,
  };
}

export async function updateFirm(
  db: SupabaseClient,
  firmId: string,
  patch: { name?: string; private?: boolean; ohp_pct?: number; status?: BookStatus },
  caller: Caller | null,
): Promise<FirmSummary> {
  await requireFirm(db, firmId, caller);
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
    const moved = book.ohp_pct !== patch.ohp_pct;
    const { error } = await db
      .from("firm_rate_books")
      .update({
        ohp_pct: patch.ohp_pct,
        updated_at: new Date().toISOString(),
        // A moved OH&P is a changed book (unless this same call also re-reviews it).
        ...(moved && patch.status !== "reviewed" ? { status: "draft", reviewed_at: null } : {}),
      })
      .eq("id", book.id)
      .eq("firm_id", firmId);
    if (error) fail(error, "update OH&P");
  }
  if (patch.status !== undefined) {
    // Marking reviewed is an explicit act; it needs a book to mark (created
    // empty if the firm has none yet — a reviewed empty book is a statement too).
    const book = await ensureBook(db, firmId);
    const { error } = await db
      .from("firm_rate_books")
      .update({
        status: patch.status,
        reviewed_at: patch.status === "reviewed" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", book.id)
      .eq("firm_id", firmId);
    if (error) fail(error, "update book status");
  }
  return getFirmSummary(db, firmId, caller);
}

export async function deleteFirm(db: SupabaseClient, firmId: string, caller: Caller | null): Promise<void> {
  await requireFirm(db, firmId, caller);
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

/** The firm's ACTIVE entries (U3: a superseded entry is history, listed nowhere the book is edited). */
export async function listEntries(db: SupabaseClient, firmId: string, caller: Caller | null): Promise<FirmRateEntry[]> {
  await requireFirm(db, firmId, caller);
  let res: { data: unknown; error: { code?: string; message: string } | null } = await db
    .from("firm_rate_entries")
    .select(FIRM_ENTRY_COLUMNS)
    .eq("firm_id", firmId)
    .is("superseded_at", null)
    .order("item_key");
  if (res.error && isMissingSchema(res.error)) {
    res = await db.from("firm_rate_entries").select(FIRM_ENTRY_COLUMNS_PRE045).eq("firm_id", firmId).order("item_key");
  }
  if (res.error) fail(res.error, "list entries");
  return ((res.data ?? []) as Record<string, unknown>[]).map(toFirmEntry);
}

function assertValid(d: { item_key: string; unit: string; kind: FirmEntryKind; rate_aed: number }): void {
  const errors = validateEntry(d);
  if (errors.length > 0) throw new StoreError(422, "invalid_entry", errors.join("; "));
}

async function insertEntry(
  db: SupabaseClient,
  firmId: string,
  input: EntryInput & { origin: "firm_entry"; created_by: string | null },
): Promise<FirmRateEntry> {
  assertValid(input);
  const book = await ensureBook(db, firmId);
  const row = {
    book_id: book.id,
    firm_id: firmId,
    item_key: input.item_key,
    grade: input.grade ?? null,
    unit: input.unit,
    rate_aed: input.rate_aed,
    kind: input.kind,
    origin: input.origin,
    correction_id: null,
    note: input.note ?? null,
    created_by: input.created_by,
  };
  let res = await db.from("firm_rate_entries").insert(row).select(FIRM_ENTRY_COLUMNS).single();
  if (res.error && isMissingSchema(res.error)) {
    // Pre-046: no created_by column yet.
    const { created_by: _drop, ...pre046 } = row;
    void _drop;
    res = await db.from("firm_rate_entries").insert(pre046).select(FIRM_ENTRY_COLUMNS_PRE045).single();
  }
  if (res.error) fail(res.error, `entry ${input.item_key}${input.grade ? `/${input.grade}` : ""} (${input.origin})`);
  return toFirmEntry(res.data as Record<string, unknown>);
}

export async function createEntry(db: SupabaseClient, firmId: string, input: EntryInput, caller: Caller | null): Promise<FirmRateEntry> {
  await requireFirm(db, firmId, caller);
  const entry = await insertEntry(db, firmId, { ...input, origin: "firm_entry", created_by: caller!.id });
  await touchBook(db, firmId);
  // L5: a rate-book change is a firm event (no project).
  await recordPilotEvent(db, null, "rate_book_change", { action: "entry", item_key: entry.item_key, grade: entry.grade, entry_id: entry.id }, { actor: caller!.id, firmId });
  return entry;
}

/** Origins whose figures are DERIVED from another record and must not drift from it (U4). */
const LOCKED_ORIGINS = new Set(["promoted_correction", "quote_import"]);

export const FIRM_ENTRY_HISTORY_COLUMNS =
  "id, firm_id, book_id, item_key, grade, unit, rate_aed, kind, origin, correction_id, quote_id, quote_line_id, note, created_by, created_at, updated_at, superseded_at, superseded_by, retired_by, retire_reason";

export interface FirmEntryHistoryRow extends FirmRateEntry {
  quote_line_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  superseded_by: string | null;
  retired_by: string | null;
  retire_reason: string | null;
}

/**
 * U4 — the trail for one item: every entry ever made for it in this firm's
 * book, active first then history, newest first — who made it, who retired it,
 * what replaced it, and which correction or quotation it came from.
 */
export async function listEntryHistory(db: SupabaseClient, firmId: string, itemKey: string, caller: Caller | null): Promise<FirmEntryHistoryRow[]> {
  await requireFirm(db, firmId, caller);
  const { data, error } = await db
    .from("firm_rate_entries")
    .select(FIRM_ENTRY_HISTORY_COLUMNS)
    .eq("firm_id", firmId)
    .eq("item_key", itemKey)
    .order("created_at", { ascending: false });
  if (error) fail(error, "read entry history");
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...toFirmEntry(r),
    quote_line_id: (r.quote_line_id ?? null) as string | null,
    note: (r.note ?? null) as string | null,
    created_by: (r.created_by ?? null) as string | null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at ?? r.created_at),
    superseded_by: (r.superseded_by ?? null) as string | null,
    retired_by: (r.retired_by ?? null) as string | null,
    retire_reason: (r.retire_reason ?? null) as string | null,
  }));
  return rows.sort((a, b) => Number(!!a.superseded_at) - Number(!!b.superseded_at) || b.created_at.localeCompare(a.created_at));
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
  caller: Caller | null,
): Promise<FirmRateEntry> {
  await requireFirm(db, firmId, caller);
  const current = await readEntry(db, firmId, entryId);
  if (current.superseded_at) throw new StoreError(409, "entry_retired", "This entry is history; it cannot be edited.");
  // U4 origin guard: a promoted rate is its correction's figure and an imported
  // rate is its quotation's — editing either here would let the book drift from
  // the record it cites. Only the note may change; a new figure is a new
  // promotion or a new import.
  if (LOCKED_ORIGINS.has(current.origin)) {
    const locked = (["rate_aed", "unit", "kind", "grade"] as const).filter((k) => patch[k] !== undefined && patch[k] !== current[k]);
    if (locked.length > 0) {
      throw new StoreError(
        409,
        "entry_locked",
        `A ${current.origin === "promoted_correction" ? "promoted correction's" : "quotation's"} ${locked.join(", ")} cannot be edited — promote a new correction or import a new quotation instead.`,
      );
    }
  }
  const next = { ...current, ...patch };
  assertValid(next);
  // UV: a FIGURE edit (rate / unit / kind / grade) is a rate movement, and the
  // revision diff and the history row name a movement only from a record — so
  // it supersedes like a promotion does: the old row is retired with the
  // figure it carried, a new row takes the book, and a rate_book_change event
  // is written. Editing in place had left no trail and no cause. A note-only
  // edit stays in place (a note is not a figure).
  const figureKeys = (["rate_aed", "unit", "kind", "grade"] as const).filter((k) => patch[k] !== undefined && patch[k] !== current[k]);
  if (figureKeys.length === 0) {
    const { data, error } = await db
      .from("firm_rate_entries")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", entryId)
      .eq("firm_id", firmId)
      .select(FIRM_ENTRY_COLUMNS)
      .maybeSingle();
    if (error) fail(error, "update entry");
    if (!data) throw new StoreError(404, "entry_not_found", "Rate entry not found in this firm's book.");
    await touchBook(db, firmId);
    return toFirmEntry(data as Record<string, unknown>);
  }
  const now = new Date().toISOString();
  const was = `was ${current.rate_aed} per ${current.unit}${current.grade ? ` (${current.grade})` : ""}`;
  const { data: noteRow } = await db.from("firm_rate_entries").select("note").eq("id", entryId).eq("firm_id", firmId).maybeSingle<{ note: string | null }>();
  const retired = await db
    .from("firm_rate_entries")
    .update({ superseded_at: now, retired_by: caller!.id, retire_reason: `edited by a member — ${was}`, updated_at: now })
    .eq("id", entryId)
    .eq("firm_id", firmId)
    .is("superseded_at", null)
    .select("id")
    .maybeSingle();
  if (retired.error) fail(retired.error, "retire edited entry");
  if (!retired.data) throw new StoreError(409, "entry_retired", "This entry was changed by someone else; reload the book.");
  const entry = await insertEntry(db, firmId, {
    item_key: current.item_key,
    grade: next.grade ?? null,
    unit: next.unit,
    rate_aed: next.rate_aed,
    kind: next.kind,
    note: patch.note !== undefined ? patch.note : (noteRow?.note ?? null),
    origin: "firm_entry",
    created_by: caller!.id,
  });
  await db.from("firm_rate_entries").update({ superseded_by: entry.id }).eq("id", entryId).eq("firm_id", firmId).then(() => undefined, () => undefined);
  await touchBook(db, firmId);
  await recordPilotEvent(
    db,
    null,
    "rate_book_change",
    { action: "edit", item_key: entry.item_key, grade: entry.grade, entry_id: entry.id, superseded_entry_id: entryId, fields: figureKeys, from_rate_aed: current.rate_aed, to_rate_aed: entry.rate_aed },
    { actor: caller!.id, firmId },
  );
  return entry;
}

/**
 * U4 — RETIRE, never delete. The entry stays with superseded_at / retired_by /
 * retire_reason set (history), stops pricing, and — when it was a promotion —
 * its correction's promoted_at is cleared so the correction can be promoted
 * again. Nothing in this module removes a rate entry row.
 */
export async function deleteEntry(db: SupabaseClient, firmId: string, entryId: string, caller: Caller | null): Promise<void> {
  await requireFirm(db, firmId, caller);
  const current = await readEntry(db, firmId, entryId);
  if (current.superseded_at) throw new StoreError(409, "entry_retired", "This entry is already history.");
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("firm_rate_entries")
    .update({ superseded_at: now, retired_by: caller!.id, retire_reason: "retired by a member", updated_at: now })
    .eq("id", entryId)
    .eq("firm_id", firmId)
    .is("superseded_at", null)
    .select("id");
  if (error) fail(error, "retire entry");
  if (!data || (data as unknown[]).length === 0) throw new StoreError(404, "entry_not_found", "Rate entry not found in this firm's book.");
  if (current.origin === "promoted_correction" && current.correction_id) {
    const { error: cerr } = await db
      .from("boq_corrections")
      .update({ promoted_at: null, promoted_entry_id: null })
      .eq("id", current.correction_id)
      .eq("firm_id", firmId);
    if (cerr) fail(cerr, "release correction");
  }
  await touchBook(db, firmId);
  await recordPilotEvent(db, null, "rate_book_change", { action: "retire", item_key: current.item_key, grade: current.grade, entry_id: entryId, origin: current.origin }, { actor: caller!.id, firmId });
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
 * be promoted, only by a member of the firm that made it, and only once.
 */
const PROMOTE_ERRORS: Record<string, [401 | 403 | 404 | 409 | 422, string]> = {
  correction_not_found: [404, "Correction not found."],
  not_this_firms_correction: [403, "A correction can only be promoted into the book of the firm that made it."],
  not_a_rate: [422, "Only a rate correction can become a rate."],
  no_item_key: [422, "The correction names no item_key, so there is nothing for the rate to price."],
  already_promoted: [409, "This correction has already been promoted (retire its entry to promote it again)."],
};

/**
 * U4: promote-over-existing, as ONE transaction. The validation that needs the
 * vocabulary happens here; everything that must be atomic — refuse the refusable
 * cases, supersede the active promotion for the same key/grade (kept as
 * history), insert, link the correction, return the book to draft — is the
 * `promote_correction` SQL function (migration 046). No promoted record is ever
 * deleted by this flow.
 */
export async function promoteCorrection(
  db: SupabaseClient,
  firmId: string,
  input: PromoteInput,
  caller: Caller | null,
): Promise<{ entry: FirmRateEntry; correction_id: string; superseded_entry_id: string | null }> {
  await requireFirm(db, firmId, caller);
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
  // The same refusals the function makes, made early so the message is specific
  // and no round trip is spent on a case that cannot succeed.
  if (!c) throw new StoreError(404, "correction_not_found", "Correction not found.");
  if (c.firm_id !== firmId) throw new StoreError(403, "not_this_firms_correction", PROMOTE_ERRORS.not_this_firms_correction![1]);
  if (c.promoted_at) throw new StoreError(409, "already_promoted", PROMOTE_ERRORS.already_promoted![1]);
  if (c.correction_type !== "rate") throw new StoreError(422, "not_a_rate", `Only a rate correction can become a rate (this one is "${c.correction_type}").`);
  if (!c.item_key) throw new StoreError(422, "no_item_key", PROMOTE_ERRORS.no_item_key![1]);
  const rate = input.rate_aed ?? (c.new_value == null ? null : Number(c.new_value));
  if (rate == null) throw new StoreError(422, "no_rate", "The correction carries no new_value; pass rate_aed.");
  const vocab = itemVocabulary(c.item_key);
  if (!vocab) throw new StoreError(422, "invalid_entry", `"${c.item_key}" is not an item any take-off prices`);
  const unit = input.unit ?? vocab.unit;
  if (!unit) throw new StoreError(422, "unit_required", `${c.item_key} has no fixed unit; pass unit.`);
  const kind = input.kind ?? vocab.default_kind;
  assertValid({ item_key: c.item_key, unit, kind, rate_aed: rate });

  const rpc = await db.rpc("promote_correction", {
    p_firm_id: firmId,
    p_correction_id: c.id,
    p_actor: caller!.id,
    p_rate: rate,
    p_unit: unit,
    p_kind: kind,
    p_grade: input.grade ?? null,
    p_note: input.note ?? `promoted from correction: ${c.line_description}`,
  });
  if (rpc.error) {
    const code = Object.keys(PROMOTE_ERRORS).find((k) => rpc.error!.message.includes(k));
    if (code) throw new StoreError(PROMOTE_ERRORS[code]![0], code, PROMOTE_ERRORS[code]![1]);
    fail(rpc.error, "promote correction");
  }
  const out = rpc.data as { entry_id: string; superseded_entry_id: string | null };
  const entry = await readEntry(db, firmId, out.entry_id);
  // L5: a promotion is where a correction LANDS in the book — the event names both.
  await recordPilotEvent(db, null, "rate_book_change", { action: "promote", item_key: entry.item_key, grade: entry.grade, entry_id: entry.id, correction_id: c.id, superseded_entry_id: out.superseded_entry_id ?? null }, { actor: caller!.id, firmId });
  return { entry, correction_id: c.id, superseded_entry_id: out.superseded_entry_id ?? null };
}

// --- Project assignment ------------------------------------------------------

/**
 * Attach a firm to a project (membership of that firm required), or detach the
 * current one (membership of the firm being detached required).
 */
export async function assignProjectFirm(
  db: SupabaseClient,
  projectId: string,
  firmId: string | null,
  caller: Caller | null,
): Promise<void> {
  requireCaller(caller);
  if (firmId) {
    await requireFirm(db, firmId, caller);
  } else {
    const { data: project, error } = await db.from("projects").select("firm_id").eq("id", projectId).maybeSingle();
    if (error) fail(error, "read project");
    if (!project) throw new StoreError(404, "project_not_found", "Project not found.");
    const current = (project as { firm_id: string | null }).firm_id;
    if (current) await requireFirm(db, current, caller);
  }
  const { data, error } = await db.from("projects").update({ firm_id: firmId }).eq("id", projectId).select("id");
  if (error) fail(error, "assign project firm");
  if (!data || (data as unknown[]).length === 0) throw new StoreError(404, "project_not_found", "Project not found.");
}
