// =============================================================================
// lib/quotes/store.ts — quotation → review → private rates (L2 / U3).
//
// The path, and what each step refuses to do:
//
//   importQuote      parse the upload into a quote RECORD and one line per row,
//                    each with a SUGGESTED item_key — never a confirmed one. A
//                    re-import of the same quote (same firm + reference, or the
//                    same file) is a new VERSION that names the one it replaces.
//   updateQuoteLine  a member confirms (or rejects) the item for a line; the
//                    line is `matched` only when the entry it would create is
//                    valid by the book's own rules (unit, kind, rate).
//   acceptQuote      the only step that touches the book: one entry per
//                    matched line, origin `quote_import`, traced to the quote
//                    and the row. An earlier quote_import entry for the same
//                    key/grade is SUPERSEDED (superseded_at / superseded_by),
//                    never deleted. Unmatched and rejected lines stay on the
//                    record, visibly held. Entries of any other origin — a rate a
//                    member typed, a promoted correction — are not touched.
//
// Nothing here deletes a rate entry — no delete call exists in this module; a
// test asserts it. The supplier's label lives on the quote record and reaches
// no BoQ line: the line says "contractor rate book (supplier quotation)"
// (lib/rates/tiers.ts).
// =============================================================================

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Caller } from "@/lib/auth/caller";
import { StoreError, ensureBook, requireFirm, touchBook } from "@/lib/firms/store";
import { recordPilotEvent } from "@/lib/pilot/events";
import { itemVocabulary, listVocabulary, validateEntry } from "@/lib/firms/vocabulary";
import type { EntryKind, VocabularyItem } from "@/lib/firms/vocabulary-client";
import { FIRM_ENTRY_COLUMNS, isMissingSchema, toFirmEntry, type FirmRateEntry } from "@/lib/rates/firm";
import type { RateGrade } from "@/lib/rates/reference";

import { deriveRate, type QuoteTerms } from "./derive";
import { indexVocabulary, suggestItemKey } from "./match";
import { QuoteParseError, parseQuoteWorkbook, type ParsedLine } from "./template";

export type SupplierRole = "supplier" | "contractor" | "manufacturer" | "other";
export type QuoteStatus = "review" | "accepted" | "superseded";
export type LineStatus = "matched" | "unmatched" | "rejected" | "accepted";

export interface QuoteMeta extends QuoteTerms {
  supplier_label: string;
  supplier_role: SupplierRole;
  quote_ref?: string | null;
  quote_date?: string | null;
  valid_until?: string | null;
}

export interface Quote extends QuoteMeta {
  id: string;
  firm_id: string;
  source_filename: string | null;
  source_sha256: string | null;
  status: QuoteStatus;
  version: number;
  supersedes_quote_id: string | null;
  created_at: string;
  accepted_at: string | null;
}

export interface QuoteLine {
  id: string;
  quote_id: string;
  firm_id: string;
  row_no: number;
  description: string;
  item_key_given: string | null;
  suggested_item_key: string | null;
  suggestion_score: number | null;
  item_key: string | null;
  grade: RateGrade | null;
  kind: EntryKind | null;
  qty: number | null;
  unit: string | null;
  rate_raw: number | null;
  currency: string | null;
  rate_aed: number | null;
  status: LineStatus;
  hold_reason: string | null;
  entry_id: string | null;
}

const QUOTE_COLUMNS =
  "id, firm_id, supplier_label, supplier_role, quote_ref, quote_date, valid_until, currency, vat_treatment, rates_are, discount_pct, source_filename, source_sha256, status, version, supersedes_quote_id, created_at, accepted_at";
const LINE_COLUMNS =
  "id, quote_id, firm_id, row_no, description, item_key_given, suggested_item_key, suggestion_score, item_key, grade, kind, qty, unit, rate_raw, currency, rate_aed, status, hold_reason, entry_id";

function fail(error: { message: string; code?: string } | null, what: string): never {
  if (error?.code === "23505") throw new StoreError(409, "conflict", `${what}: already exists`);
  throw new StoreError(500, "db_error", `${what}: ${error?.message ?? "unknown error"}`);
}
const toQuote = (r: Record<string, unknown>): Quote =>
  ({ ...r, discount_pct: Number(r.discount_pct) || 0, version: Number(r.version) || 1 }) as unknown as Quote;
const toLine = (r: Record<string, unknown>): QuoteLine =>
  ({
    ...r,
    row_no: Number(r.row_no),
    suggestion_score: r.suggestion_score == null ? null : Number(r.suggestion_score),
    qty: r.qty == null ? null : Number(r.qty),
    rate_raw: r.rate_raw == null ? null : Number(r.rate_raw),
    rate_aed: r.rate_aed == null ? null : Number(r.rate_aed),
  }) as unknown as QuoteLine;

const terms = (q: QuoteMeta): QuoteTerms => ({ currency: q.currency, vat_treatment: q.vat_treatment, rates_are: q.rates_are, discount_pct: q.discount_pct });

// --- Import ------------------------------------------------------------------

export interface ImportSummary {
  lines: number;
  suggested: number;
  held: number;
  version: number;
  supersedes_quote_id: string | null;
}

export async function importQuote(
  db: SupabaseClient,
  firmId: string,
  caller: Caller | null,
  meta: QuoteMeta,
  file: { name: string; bytes: Uint8Array },
  vocab: readonly VocabularyItem[] = listVocabulary().map((v) => ({ ...v, reference: { kind: "none" as const } })),
): Promise<{ quote: Quote; lines: QuoteLine[]; summary: ImportSummary }> {
  const who = await requireFirm(db, firmId, caller).then(() => caller!);
  if (!meta.supplier_label.trim()) throw new StoreError(422, "supplier_required", "Name the supplier or contractor the quote is from.");
  let parsed;
  try {
    parsed = parseQuoteWorkbook(file.bytes);
  } catch (e) {
    if (e instanceof QuoteParseError) throw new StoreError(422, "unreadable_quote", e.message);
    throw new StoreError(422, "unreadable_quote", `The file could not be read as a workbook (${e instanceof Error ? e.message : "unknown error"}).`);
  }
  if (parsed.lines.length === 0) throw new StoreError(422, "empty_quote", "The sheet has a header row but no lines under it.");

  const sha = createHash("sha256").update(file.bytes).digest("hex");
  // A re-import of the SAME quote: same reference, or the very same file.
  const prev = await findPrevious(db, firmId, meta.quote_ref ?? null, sha);
  const { data: qrow, error: qerr } = await db
    .from("firm_quotes")
    .insert({
      firm_id: firmId,
      supplier_label: meta.supplier_label.trim(),
      supplier_role: meta.supplier_role,
      quote_ref: meta.quote_ref?.trim() || null,
      quote_date: meta.quote_date || null,
      valid_until: meta.valid_until || null,
      currency: meta.currency.toUpperCase(),
      vat_treatment: meta.vat_treatment,
      rates_are: meta.rates_are,
      discount_pct: meta.discount_pct,
      source_filename: file.name,
      source_sha256: sha,
      status: "review",
      version: prev ? prev.version + 1 : 1,
      supersedes_quote_id: prev?.id ?? null,
      created_by: who.id,
    })
    .select(QUOTE_COLUMNS)
    .single();
  if (qerr) fail(qerr, "create quote");
  const quote = toQuote(qrow as Record<string, unknown>);

  const index = indexVocabulary(vocab);
  const t = terms(quote);
  const rows = parsed.lines.map((l: ParsedLine) => {
    const s = suggestItemKey(l.description, l.item_key_given, index);
    const d = deriveRate(l.rate_raw, { ...t, currency: l.currency ?? t.currency });
    return {
      quote_id: quote.id,
      firm_id: firmId,
      row_no: l.row_no,
      description: l.description,
      item_key_given: l.item_key_given,
      suggested_item_key: s?.item_key ?? null,
      suggestion_score: s?.score ?? null,
      item_key: null, // never confirmed by the machine
      grade: null,
      kind: null,
      qty: l.qty,
      unit: l.unit,
      rate_raw: l.rate_raw,
      currency: l.currency ?? t.currency,
      rate_aed: d.rate_aed,
      status: "unmatched",
      hold_reason: l.parse_note ?? d.hold_reason ?? (s ? null : "no matching item — choose one or reject the line"),
    };
  });
  const { data: lrows, error: lerr } = await db.from("firm_quote_lines").insert(rows).select(LINE_COLUMNS);
  if (lerr) fail(lerr, "create quote lines");
  const lines = ((lrows ?? []) as Record<string, unknown>[]).map(toLine).sort((a, b) => a.row_no - b.row_no);
  return {
    quote,
    lines,
    summary: {
      lines: lines.length,
      suggested: lines.filter((l) => l.suggested_item_key).length,
      held: lines.filter((l) => l.hold_reason).length,
      version: quote.version,
      supersedes_quote_id: quote.supersedes_quote_id,
    },
  };
}

async function findPrevious(db: SupabaseClient, firmId: string, ref: string | null, sha: string): Promise<Quote | null> {
  const { data, error } = await db.from("firm_quotes").select(QUOTE_COLUMNS).eq("firm_id", firmId).neq("status", "superseded").order("created_at");
  if (error) fail(error, "read quotes");
  const all = ((data ?? []) as Record<string, unknown>[]).map(toQuote);
  const wanted = ref?.trim().toLowerCase() || null;
  const hits = all.filter((q) => (wanted && q.quote_ref && q.quote_ref.trim().toLowerCase() === wanted) || q.source_sha256 === sha);
  return hits.length ? hits.reduce((a, b) => (b.version > a.version ? b : a)) : null;
}

// --- Read --------------------------------------------------------------------

export async function listQuotes(db: SupabaseClient, firmId: string, caller: Caller | null): Promise<Quote[]> {
  await requireFirm(db, firmId, caller);
  const { data, error } = await db.from("firm_quotes").select(QUOTE_COLUMNS).eq("firm_id", firmId).order("created_at");
  if (error) fail(error, "list quotes");
  return ((data ?? []) as Record<string, unknown>[]).map(toQuote).reverse();
}

export async function getQuote(db: SupabaseClient, firmId: string, quoteId: string, caller: Caller | null): Promise<{ quote: Quote; lines: QuoteLine[] }> {
  await requireFirm(db, firmId, caller);
  const { data, error } = await db.from("firm_quotes").select(QUOTE_COLUMNS).eq("id", quoteId).eq("firm_id", firmId).maybeSingle();
  if (error) fail(error, "read quote");
  // Another firm's quote id reads as NOT FOUND through this firm's path.
  if (!data) throw new StoreError(404, "quote_not_found", "Quote not found in this firm.");
  const { data: lrows, error: lerr } = await db.from("firm_quote_lines").select(LINE_COLUMNS).eq("quote_id", quoteId).eq("firm_id", firmId).order("row_no");
  if (lerr) fail(lerr, "read quote lines");
  return { quote: toQuote(data as Record<string, unknown>), lines: ((lrows ?? []) as Record<string, unknown>[]).map(toLine) };
}

// --- Review ------------------------------------------------------------------

export interface LinePatch {
  /** null clears the confirmation (back to unmatched). */
  item_key?: string | null;
  grade?: RateGrade | null;
  kind?: EntryKind | null;
  unit?: string | null;
  status?: "rejected" | "unmatched";
}

/** What a line's entry would be, and every reason it cannot be one yet. */
function assessLine(l: QuoteLine): { status: LineStatus; hold_reason: string | null; kind: EntryKind | null; unit: string | null } {
  if (l.status === "rejected") return { status: "rejected", hold_reason: l.hold_reason, kind: l.kind, unit: l.unit };
  if (!l.item_key) return { status: "unmatched", hold_reason: l.hold_reason ?? "no item confirmed", kind: l.kind, unit: l.unit };
  const v = itemVocabulary(l.item_key);
  if (!v) return { status: "unmatched", hold_reason: `"${l.item_key}" is not an item any take-off prices`, kind: l.kind, unit: l.unit };
  const unit = l.unit ?? v.unit;
  const kind = l.kind ?? v.default_kind;
  if (l.rate_aed === null) return { status: "unmatched", hold_reason: l.hold_reason ?? "no usable rate", kind, unit };
  if (!unit) return { status: "unmatched", hold_reason: "unit required for this item", kind, unit };
  const errors = validateEntry({ item_key: l.item_key, unit, kind, rate_aed: l.rate_aed });
  if (errors.length) return { status: "unmatched", hold_reason: errors.join("; "), kind, unit };
  return { status: "matched", hold_reason: null, kind, unit };
}

export async function updateQuoteLine(
  db: SupabaseClient,
  firmId: string,
  quoteId: string,
  lineId: string,
  patch: LinePatch,
  caller: Caller | null,
): Promise<QuoteLine> {
  const { quote, lines } = await getQuote(db, firmId, quoteId, caller);
  if (quote.status !== "review") throw new StoreError(409, "quote_closed", `This quote is ${quote.status}; its lines are read-only.`);
  const current = lines.find((l) => l.id === lineId);
  if (!current) throw new StoreError(404, "line_not_found", "Line not found on this quote.");
  const next: QuoteLine = {
    ...current,
    item_key: patch.item_key === undefined ? current.item_key : patch.item_key,
    grade: patch.grade === undefined ? current.grade : patch.grade,
    kind: patch.kind === undefined ? current.kind : patch.kind,
    unit: patch.unit === undefined ? current.unit : patch.unit,
    status: patch.status === "rejected" ? "rejected" : patch.status === "unmatched" ? "unmatched" : current.status === "rejected" ? "unmatched" : current.status,
  };
  if (next.item_key && !itemVocabulary(next.item_key)) throw new StoreError(422, "invalid_entry", `"${next.item_key}" is not an item any take-off prices`);
  // A freshly confirmed item takes the vocabulary's unit when the sheet's unit is not usable for it.
  if (next.item_key && patch.item_key !== undefined && patch.unit === undefined) {
    const v = itemVocabulary(next.item_key)!;
    if (v.unit && next.unit !== v.unit) next.unit = v.unit;
  }
  const a = assessLine(next);
  const { data, error } = await db
    .from("firm_quote_lines")
    .update({ item_key: next.item_key, grade: next.grade, kind: a.kind, unit: a.unit, status: a.status, hold_reason: a.hold_reason, updated_at: new Date().toISOString() })
    .eq("id", lineId)
    .eq("firm_id", firmId)
    .eq("quote_id", quoteId)
    .select(LINE_COLUMNS)
    .single();
  if (error) fail(error, "update quote line");
  return toLine(data as Record<string, unknown>);
}

/** Confirm every suggestion at or above `minScore` — an explicit act by a member, once, for the whole sheet. */
export async function confirmSuggestions(db: SupabaseClient, firmId: string, quoteId: string, caller: Caller | null, minScore = 0.5): Promise<{ confirmed: number }> {
  const { quote, lines } = await getQuote(db, firmId, quoteId, caller);
  if (quote.status !== "review") throw new StoreError(409, "quote_closed", `This quote is ${quote.status}.`);
  let confirmed = 0;
  for (const l of lines) {
    if (l.status !== "unmatched" || l.item_key || !l.suggested_item_key || (l.suggestion_score ?? 0) < minScore) continue;
    await updateQuoteLine(db, firmId, quoteId, l.id, { item_key: l.suggested_item_key }, caller);
    confirmed++;
  }
  return { confirmed };
}

// --- Accept ------------------------------------------------------------------

export interface AcceptResult {
  accepted: number;
  held: number;
  rejected: number;
  superseded: number;
  entries: FirmRateEntry[];
}

export async function acceptQuote(db: SupabaseClient, firmId: string, quoteId: string, caller: Caller | null): Promise<AcceptResult> {
  const { quote, lines } = await getQuote(db, firmId, quoteId, caller);
  if (quote.status === "accepted") throw new StoreError(409, "already_accepted", "This quote has already been accepted.");
  if (quote.status === "superseded") throw new StoreError(409, "quote_closed", "This quote was superseded by a later import.");
  const book = await ensureBook(db, firmId);
  const now = new Date().toISOString();
  const result: AcceptResult = { accepted: 0, held: 0, rejected: 0, superseded: 0, entries: [] };
  for (const l of lines) {
    const a = assessLine(l);
    if (a.status === "rejected") { result.rejected++; continue; }
    if (a.status !== "matched" || !l.item_key || l.rate_aed === null || !a.unit || !a.kind) {
      result.held++;
      if (a.hold_reason !== l.hold_reason || a.status !== l.status) {
        await db.from("firm_quote_lines").update({ status: a.status, hold_reason: a.hold_reason, updated_at: now }).eq("id", l.id).eq("firm_id", firmId);
      }
      continue;
    }
    // Supersede the active quote_import entry for this key/grade (from any earlier
    // quote, including an earlier version of this one) — history stays.
    const { data: olds, error: oerr } = await db
      .from("firm_rate_entries")
      .select("id")
      .eq("firm_id", firmId)
      .eq("item_key", l.item_key)
      .eq("origin", "quote_import")
      .is("superseded_at", null);
    if (oerr) fail(oerr, "read prior quote entries");
    const priorIds = ((olds ?? []) as { id: string }[]).map((o) => o.id);
    const sameGrade: string[] = [];
    for (const id of priorIds) {
      const { data: row } = await db.from("firm_rate_entries").select("id, grade").eq("id", id).eq("firm_id", firmId).maybeSingle();
      if (row && ((row as { grade: string | null }).grade ?? null) === (l.grade ?? null)) sameGrade.push(id);
    }
    for (const id of sameGrade) {
      // U4: who retired it and why, alongside when (046 columns; a pre-046 db takes the fallback).
      let sup = await db
        .from("firm_rate_entries")
        .update({ superseded_at: now, updated_at: now, retired_by: caller?.id ?? null, retire_reason: "superseded by a later quotation" })
        .eq("id", id)
        .eq("firm_id", firmId);
      if (sup.error && isMissingSchema(sup.error)) {
        sup = await db.from("firm_rate_entries").update({ superseded_at: now, updated_at: now }).eq("id", id).eq("firm_id", firmId);
      }
      if (sup.error) fail(sup.error, "supersede prior entry");
    }
    const { data: erow, error: eerr } = await db
      .from("firm_rate_entries")
      .insert({
        created_by: caller?.id ?? null,
        book_id: book.id,
        firm_id: firmId,
        item_key: l.item_key,
        grade: l.grade,
        unit: a.unit,
        rate_aed: l.rate_aed,
        kind: a.kind,
        origin: "quote_import",
        quote_id: quote.id,
        quote_line_id: l.id,
        note: `quotation ${quote.quote_ref ?? quote.id.slice(0, 8)} (${quote.supplier_role}) · row ${l.row_no}: ${deriveRate(l.rate_raw, terms(quote)).explanation}`,
      })
      .select(FIRM_ENTRY_COLUMNS)
      .single();
    if (eerr) fail(eerr, `entry ${l.item_key}${l.grade ? `/${l.grade}` : ""} (quote_import)`);
    const entry = toFirmEntry(erow as Record<string, unknown>);
    for (const id of sameGrade) {
      await db.from("firm_rate_entries").update({ superseded_by: entry.id }).eq("id", id).eq("firm_id", firmId);
      result.superseded++;
    }
    await db.from("firm_quote_lines").update({ status: "accepted", entry_id: entry.id, hold_reason: null, updated_at: now }).eq("id", l.id).eq("firm_id", firmId);
    result.entries.push(entry);
    result.accepted++;
  }
  const { error: qerr } = await db.from("firm_quotes").update({ status: "accepted", accepted_at: now }).eq("id", quote.id).eq("firm_id", firmId);
  if (qerr) fail(qerr, "mark quote accepted");
  if (quote.supersedes_quote_id) {
    await db.from("firm_quotes").update({ status: "superseded" }).eq("id", quote.supersedes_quote_id).eq("firm_id", firmId);
  }
  if (result.accepted > 0) {
    await touchBook(db, firmId);
    // L5: an accepted quotation is a rate-book change (one event, the counts inside).
    await recordPilotEvent(db, null, "rate_book_change", { action: "quote_accept", quote_id: quote.id, accepted: result.accepted, superseded: result.superseded, held: result.held }, { actor: caller?.id ?? null, firmId });
  }
  return result;
}
