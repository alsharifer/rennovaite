// =============================================================================
// lib/firms/book-view.ts — one firm's rate book as the Rates & Basis screen
// shows it (K4, R7 §3.3, frame 19:48). SERVER-ONLY; every read is scoped by
// firm id and starts with requireFirm (members only, U1).
//
//   attention   what stops "Mark book reviewed" (H8): a rate outside 0.33–3×
//               the figure it shadows that nobody confirmed — a UNIT CHECK
//               when the quote line's dimensions offer a conversion, an
//               OUTLIER otherwise — and a CONFLICT (two active entries for one
//               item / grade; 051 makes it impossible, so the group renders
//               only if one ever appears)
//   in use      every other active entry, beside what it shadows (vs ref)
//   history     every entry ever made, newest first (retired ones kept, U4)
//   candidates  rate corrections attributed to this firm, not yet promoted
//   project     in a project's context (step 04): how many of its BoQ lines
//               price from this book, and the reference-basis status
//
// The "confirmed" test is the record: an outlier_confirmed rate_book_change
// event naming the entry, or the quote line it was accepted from carrying
// outlier_confirmed_at (H8).
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Caller } from "@/lib/auth/caller";
import { referenceBasisOf } from "@/lib/documents/reference-basis";
import { lineItemKey } from "@/lib/boq/line-identity";
import { formatAED, formatQty, formatRatio } from "@/lib/format/aed";

import { checkMagnitude, conversionOffer } from "./magnitude";
import { loadShadowRates, type ShadowRate } from "./shadow-rate";
import { getFirmSummary } from "./store";
import { itemVocabulary } from "./vocabulary";

export type Origin = "firm_entry" | "quote_import" | "promoted_correction";

export interface BookEntryView {
  id: string;
  item_key: string;
  label: string;
  kind: string;
  unit: string;
  grade: string | null;
  rate_aed: number;
  origin: Origin;
  originLabel: string;
  created_at: string;
  note: string | null;
  /** A promoted or imported rate's figures are its record's (U4 origin guard). */
  locked: boolean;
  shadow: { rate_aed: number; unit: string; builtin: boolean } | null;
  /** "+2.3%", "−9.1%", "×17.9", or "—". */
  vsRef: string;
  attention:
    | null
    | {
        kind: "unit_check" | "outlier";
        headline: string;
        sentence: string;
        offer: { rate_aed: number; unit: string; kind: string; note: string } | null;
      };
}

export interface ConflictView {
  item_key: string;
  label: string;
  grade: string | null;
  options: BookEntryView[];
}

export interface HistoryView {
  id: string;
  item_key: string;
  label: string;
  rate_aed: number;
  unit: string;
  grade: string | null;
  origin: Origin;
  created_at: string;
  superseded_at: string | null;
  retire_reason: string | null;
}

export interface CandidateView {
  id: string;
  item_key: string;
  label: string;
  line_description: string;
  old_value: number | null;
  new_value: number | null;
  note: string | null;
  recorded_at: string;
  unit: string | null;
}

export interface BookView {
  firm: { id: string; name: string; ohp_pct: number; status: "draft" | "reviewed"; reviewed_at: string | null; private: boolean };
  entries: BookEntryView[];
  attention: BookEntryView[];
  conflicts: ConflictView[];
  inUse: BookEntryView[];
  history: HistoryView[];
  candidates: CandidateView[];
  quotes: number;
  lastChange: string | null;
  /** "Resolve 2 conflicts and confirm 2 outliers first" — null when the book may be marked reviewed. */
  reviewBlock: string | null;
  project: null | {
    id: string;
    boqId: string | null;
    rev: number;
    firmLines: number;
    totalLines: number;
    referenceLines: number;
    unpricedLines: number;
    basis: "open" | "accepted" | "book_reviewed" | "no_boq";
    acceptedOn: string | null;
  };
  /** Projects attached to this firm (outside a project's context). */
  projectCount: number;
}

const ENTRY_COLS = "id, item_key, grade, unit, rate_aed, kind, origin, quote_id, created_at, note, superseded_at, retire_reason, correction_id";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dayLabel = (iso: string) => {
  const [y, m, d] = new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" }).split("-").map(Number);
  return `${d} ${MONTHS[m! - 1]} ${y}`;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "+2.3%" within the band, "×17.9" outside it, "—" with no single reference. */
export function vsRef(rate: number, shadow: number | null | undefined): string {
  const m = checkMagnitude(rate, shadow);
  if (!m) return "—";
  if (m.outlier) return formatRatio(m.ratio);
  const pct = Math.round(((rate - shadow!) / shadow!) * 1000) / 10;
  return pct === 0 ? "±0.0%" : `${pct > 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`;
}

/** The review block sentence (spec §3.3): what stops "Mark book reviewed". */
export function reviewBlockText(conflicts: number, outliers: number): string | null {
  const parts: string[] = [];
  if (conflicts) parts.push(`resolve ${plural(conflicts, "conflict")}`);
  if (outliers) parts.push(`confirm ${plural(outliers, "outlier")}`);
  if (!parts.length) return null;
  const s = `${parts.join(" and ")} first`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

type Row = { id: string; item_key: string; grade: string | null; unit: string; rate_aed: number; kind: string; origin: Origin; quote_id: string | null; created_at: string; note: string | null; superseded_at: string | null; retire_reason: string | null };

/** Open attention for one firm — the same rule the status PATCH enforces. */
export async function loadBookAttention(db: SupabaseClient, firmId: string): Promise<{ conflicts: number; outliers: number }> {
  const { data } = await db.from("firm_rate_entries").select(ENTRY_COLS).eq("firm_id", firmId).is("superseded_at", null);
  const rows = (data ?? []) as Row[];
  const shadows = await loadShadowRates(db, [...new Set(rows.map((r) => r.item_key))]);
  const confirmed = await confirmedEntryIds(db, firmId, rows.map((r) => r.id));
  const ref = (r: Row) => {
    const s = shadows.get(r.item_key);
    return s && (s.unit == null || s.unit === r.unit) ? s.rate_aed : null;
  };
  const outliers = rows.filter((r) => !confirmed.has(r.id) && checkMagnitude(Number(r.rate_aed), ref(r))?.outlier).length;
  return { conflicts: conflictGroups(rows).length, outliers };
}

function conflictGroups(rows: Row[]): Row[][] {
  const by = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r.item_key}|${r.grade ?? "*"}`;
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  return [...by.values()].filter((g) => g.length > 1);
}

async function confirmedEntryIds(db: SupabaseClient, firmId: string, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!ids.length) return out;
  const { data: ev } = await db.from("pilot_events").select("detail").eq("firm_id", firmId).eq("kind", "rate_book_change");
  for (const e of (ev ?? []) as { detail: { action?: string; entry_id?: string } | null }[]) {
    if (e.detail?.action === "outlier_confirmed" && e.detail.entry_id) out.add(e.detail.entry_id);
  }
  const { data: ql } = await db.from("firm_quote_lines").select("entry_id, outlier_confirmed_at").eq("firm_id", firmId).in("entry_id", ids);
  for (const l of (ql ?? []) as { entry_id: string | null; outlier_confirmed_at?: string | null }[]) if (l.entry_id && l.outlier_confirmed_at) out.add(l.entry_id);
  return out;
}

export async function loadBookView(db: SupabaseClient, firmId: string, caller: Caller | null, projectId: string | null = null): Promise<BookView> {
  const summary = await getFirmSummary(db, firmId, caller); // members only (U1)

  const [entriesRes, historyRes, quotesRes, candRes, projectsRes] = await Promise.all([
    db.from("firm_rate_entries").select(ENTRY_COLS).eq("firm_id", firmId).is("superseded_at", null).order("created_at", { ascending: false }),
    db.from("firm_rate_entries").select(ENTRY_COLS).eq("firm_id", firmId).order("created_at", { ascending: false }).limit(200),
    db.from("firm_quotes").select("id, quote_ref", { count: "exact" }).eq("firm_id", firmId),
    db
      .from("boq_corrections")
      .select("id, item_key, line_description, old_value, new_value, note, recorded_at, promoted_at, correction_type")
      .eq("firm_id", firmId)
      .eq("correction_type", "rate")
      .is("promoted_at", null)
      .order("recorded_at", { ascending: false }),
    // K10: a deleted project (055) is not one of the firm's projects; before 055 the column is absent and every row counts.
    db.from("projects").select("*").eq("firm_id", firmId),
  ]);
  const rows = (entriesRes.data ?? []) as Row[];
  const quoteRef = new Map(((quotesRes.data ?? []) as { id: string; quote_ref: string | null }[]).map((q) => [q.id, q.quote_ref]));
  const keys = [...new Set([...rows, ...((historyRes.data ?? []) as Row[])].map((r) => r.item_key))];
  const shadows = await loadShadowRates(db, keys);
  const confirmed = await confirmedEntryIds(db, firmId, rows.map((r) => r.id));
  const { data: qlines } = rows.length
    ? await db.from("firm_quote_lines").select("entry_id, row_no, description, qty, unit, unit_given").eq("firm_id", firmId).in("entry_id", rows.map((r) => r.id))
    : { data: [] };
  const lineByEntry = new Map(((qlines ?? []) as { entry_id: string; row_no: number; description: string; qty: number | null; unit: string | null; unit_given?: string | null }[]).map((l) => [l.entry_id, l]));

  // In a project's context: the project's latest BoQ, for the consequence lines and the basis.
  let project: BookView["project"] = null;
  let projectLines: { item_key: string | null; quantity: number; rate_aed: number; total_aed: number; unit: string }[] = [];
  if (projectId) {
    const [{ data: boqRows }, { count }] = await Promise.all([
      db.from("boqs").select("id, sections, created_at").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1),
      db.from("boqs").select("id", { count: "exact", head: true }).eq("project_id", projectId),
    ]);
    const latest = (boqRows?.[0] ?? null) as { id: string; sections: { sections?: { work_section: string; lines: Record<string, unknown>[] }[] } | null; created_at: string } | null;
    if (latest?.sections?.sections) {
      const basis = referenceBasisOf(latest.sections as never);
      projectLines = latest.sections.sections.flatMap((s) => s.lines.map((l) => ({ item_key: lineItemKey(l as never), quantity: Number(l.quantity), rate_aed: Number(l.rate_aed), total_aed: Number(l.total_aed), unit: String(l.unit) })));
      const { data: acc } = await db.from("reference_basis_acceptances").select("created_at").eq("project_id", projectId).eq("boq_id", latest.id).order("created_at", { ascending: false }).limit(1);
      const accepted = ((acc ?? []) as { created_at: string }[])[0] ?? null;
      project = {
        id: projectId,
        boqId: latest.id,
        rev: count ?? 1,
        firmLines: basis.firm_lines,
        totalLines: basis.total_lines,
        referenceLines: basis.reference_lines,
        unpricedLines: basis.unpriced_lines,
        basis: summary.status === "reviewed" ? "book_reviewed" : accepted ? "accepted" : "open",
        acceptedOn: accepted ? dayLabel(accepted.created_at) : null,
      };
    } else {
      project = { id: projectId, boqId: null, rev: 0, firmLines: 0, totalLines: 0, referenceLines: 0, unpricedLines: 0, basis: "no_boq", acceptedOn: null };
    }
  }

  // P4 element labels read "P4 wall_plaster — Wall plaster …"; the key is shown beside it anyway.
  const label = (k: string) => (itemVocabulary(k)?.label ?? k).replace(/^P4 \S+ — /, "");
  const originLabel = (r: Row) => {
    if (r.origin === "quote_import") {
      const ql = lineByEntry.get(r.id);
      return `Quote ${quoteRef.get(r.quote_id ?? "") ?? "import"}${ql ? ` · l.${ql.row_no}` : ""}`;
    }
    return `${r.origin === "promoted_correction" ? "Promoted correction" : "Firm entry"} · ${dayLabel(r.created_at)}`;
  };

  const view = (r: Row): BookEntryView => {
    // The shadow counts only in the entry's own unit (as the H8 check does).
    const s0: ShadowRate | undefined = shadows.get(r.item_key);
    const sh = s0 && (s0.unit == null || s0.unit === r.unit) ? s0 : undefined;
    const rate = Number(r.rate_aed);
    const m = checkMagnitude(rate, sh?.rate_aed);
    let attention: BookEntryView["attention"] = null;
    if (m?.outlier && !confirmed.has(r.id)) {
      const ql = lineByEntry.get(r.id);
      const v = itemVocabulary(r.item_key);
      const offer = ql ? conversionOffer({ description: ql.description, rate_aed: rate, quantity: ql.qty, unit_given: ql.unit_given ?? ql.unit, item_unit: v?.unit ?? r.unit, reference_aed: sh?.rate_aed }) : null;
      const pl = projectLines.find((l) => l.item_key === r.item_key);
      const consequence = pl
        ? ` Left as it is, this project's ${label(r.item_key).toLowerCase()} line becomes ${formatQty(pl.quantity)} × ${formatAED(rate)} = ${formatAED(Math.round(pl.quantity * rate * 100) / 100)} instead of ${formatAED(pl.total_aed)}.`
        : "";
      attention = offer
        ? {
            kind: "unit_check",
            headline: `Unit check — the quote priced the whole ${label(r.item_key).toLowerCase()}, not one ${r.unit.replace(/m2/, "m²")}.`,
            sentence: `Quoted as ${formatQty(ql?.qty ?? 1)} × “${ql?.description}”. ${offer.note}.${consequence}`,
            offer: { rate_aed: offer.rate_aed, unit: offer.unit, kind: r.kind, note: offer.note },
          }
        : {
            kind: "outlier",
            headline: `Outlier — ${formatRatio(m.ratio)} the ${sh?.source === "market" ? "market reference" : "built-in rate"}.`,
            sentence: `${ql ? `Quoted as “${ql.description}”; c` : "C"}onfirm the spec before it prices client work.${consequence}`,
            offer: null,
          };
    }
    return {
      id: r.id,
      item_key: r.item_key,
      label: label(r.item_key),
      kind: r.kind,
      unit: r.unit,
      grade: r.grade,
      rate_aed: rate,
      origin: r.origin,
      originLabel: originLabel(r),
      created_at: r.created_at,
      note: r.note,
      locked: r.origin !== "firm_entry",
      shadow: sh ? { rate_aed: sh.rate_aed, unit: sh.unit ?? r.unit, builtin: sh.source !== "market" } : null,
      vsRef: vsRef(rate, sh?.rate_aed),
      attention,
    };
  };

  const entries = rows.map(view);
  const groups = conflictGroups(rows);
  const conflictIds = new Set(groups.flat().map((r) => r.id));
  const conflicts: ConflictView[] = groups.map((g) => ({ item_key: g[0]!.item_key, label: label(g[0]!.item_key), grade: g[0]!.grade, options: g.map(view) }));
  const attention = entries.filter((e) => e.attention && !conflictIds.has(e.id));
  const inUse = entries.filter((e) => !e.attention && !conflictIds.has(e.id));
  const history = ((historyRes.data ?? []) as Row[]).map((r) => ({ id: r.id, item_key: r.item_key, label: label(r.item_key), rate_aed: Number(r.rate_aed), unit: r.unit, grade: r.grade, origin: r.origin, created_at: r.created_at, superseded_at: r.superseded_at, retire_reason: r.retire_reason }));
  const candidates = ((candRes.data ?? []) as { id: string; item_key: string | null; line_description: string; old_value: number | null; new_value: number | null; note: string | null; recorded_at: string }[])
    .filter((c) => !!c.item_key)
    .map((c) => ({ ...c, item_key: c.item_key!, label: label(c.item_key!), unit: itemVocabulary(c.item_key!)?.unit ?? null }));

  return {
    firm: { id: summary.id, name: summary.name, ohp_pct: summary.ohp_pct, status: summary.status, reviewed_at: summary.reviewed_at, private: summary.private },
    entries,
    attention,
    conflicts,
    inUse,
    history,
    candidates,
    quotes: quotesRes.count ?? (quotesRes.data ?? []).length,
    lastChange: history[0] ? dayLabel(history.reduce((a, h) => (h.superseded_at && h.superseded_at > a ? h.superseded_at : h.created_at > a ? h.created_at : a), history[0].created_at)) : null,
    reviewBlock: reviewBlockText(conflicts.length, attention.length),
    project,
    projectCount: ((projectsRes.data ?? []) as { deleted_at?: string | null }[]).filter((p) => !p.deleted_at).length,
  };
}
