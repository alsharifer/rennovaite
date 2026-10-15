// =============================================================================
// lib/boq/revision-causes.ts — what was RECORDED between two BoQ revisions (U4).
//
// The diff attaches a cause to a line only when a record names it. The records:
//
//   boq_corrections     a typed correction (rate / quantity / scope / design /
//                       confirm) naming an item_key or a line description;
//   firm_rate_entries   a rate the project's firm entered, imported or promoted
//                       (and one it retired) — a rate movement's likely cause;
//   pilot_events        boq_generated for the LATER revision (what produced it:
//                       its `source` / `stage`), plan edits and saves (aggregated
//                       per layer — a window-level cause), session decisions.
//
// Everything is best-effort: a table that does not exist yields nothing. Every
// free-text string is curated by the caller (lib/boq/revisions.ts) before it
// reaches a page or a PDF.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { formatAed } from "@/lib/format/aed";
import { isMissingSchema } from "@/lib/rates/firm";

import { OPENING_NET_ITEM_KEYS, OPENINGS_CONFIRMED_CAUSE } from "@/lib/plan/openings-vocab";
import { netScopeChange, scopeChangeSummary } from "@/lib/plan/scope";

import { appliedHeadline, basisText, type BasisKind, type CorrectionOrigin } from "./own-basis-vocab";

import type { RecordedCause } from "./revision-diff";

type Row = Record<string, unknown>;

async function rows(db: SupabaseClient, build: () => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>): Promise<Row[]> {
  try {
    const { data, error } = await build();
    if (error) {
      if (isMissingSchema(error)) return [];
      throw new Error(error.message);
    }
    return (data ?? []) as Row[];
  } catch (e) {
    if (isMissingSchema(e as { code?: string; message?: string })) return [];
    throw e;
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const num = (v: unknown) => (v == null ? null : Number(v));

/**
 * 15 Oct: the openings each revision left out as "Needs a wall" are recorded on
 * it (`openings_need_wall`; absent = none — every revision before the plan
 * rules). When the set differs, the lines net of openings (plaster, paint, wet
 * tiling) carry "N openings need a wall" / "N openings back on a wall".
 */
export function needsWallCause(from: unknown, to: unknown, atISO: string): RecordedCause | null {
  const ids = (d: unknown) => new Set(Array.isArray((d as { openings_need_wall?: unknown } | null)?.openings_need_wall) ? ((d as { openings_need_wall: unknown[] }).openings_need_wall.map(String)) : []);
  const a = ids(from), b = ids(to);
  const out = [...b].filter((x) => !a.has(x)).length;
  const back = [...a].filter((x) => !b.has(x)).length;
  if (!out && !back) return null;
  const parts = [out ? `${out} ${out === 1 ? "opening needs" : "openings need"} a wall` : null, back ? `${back} ${back === 1 ? "opening" : "openings"} back on a wall` : null].filter(Boolean);
  return { kind: "openings_need_wall", at: atISO, summary: parts.join("; "), item_keys: [...OPENING_NET_ITEM_KEYS] };
}

export async function loadRecordedCauses(db: SupabaseClient, projectId: string, fromISO: string, toISO: string, toBoqId: string): Promise<RecordedCause[]> {
  const out: RecordedCause[] = [];

  // K11 #4 (057): corrections APPLIED to the BoQ in the window — line-level by their
  // stable line key: "Price added by <name> — …" / "Correction by <name> — …"; and
  // the ones a revert in the window undid.
  const applied = await rows(db, () => db.from("boq_corrections").select("id, correction_type, old_value, new_value, note, origin, basis_kind, line_key, applied_by_name, applied_at, reverted_at").eq("project_id", projectId).gt("applied_at", fromISO).lte("applied_at", toISO));
  const appliedIds = new Set(applied.map((c) => str(c.id)));
  for (const c of applied) {
    const o = num(c.old_value);
    const n = num(c.new_value);
    const isRate = str(c.correction_type) === "rate";
    const fig = (v: number | null) => (v == null ? "—" : isRate ? formatAed(v, "money") : String(v));
    const figures = isRate && (o == null || o === 0) && str(c.origin) === "add_price" ? ` — ${fig(n)}` : ` — ${isRate ? "rate" : "quantity"} ${fig(o)} → ${fig(n)}`;
    const basis = basisText(c.basis_kind as BasisKind | null, c.note as string | null);
    out.push({
      kind: "applied_correction",
      at: str(c.applied_at),
      summary: `${appliedHeadline(str(c.origin) as CorrectionOrigin, c.applied_by_name as string | null)}${figures}${basis ? ` (${basis})` : ""}`,
      line_keys: c.line_key ? [str(c.line_key)] : [],
    });
  }
  for (const c of await rows(db, () => db.from("boq_corrections").select("id, origin, line_key, applied_by_name, reverted_at").eq("project_id", projectId).gt("reverted_at", fromISO).lte("reverted_at", toISO))) {
    out.push({ kind: "reverted_correction", at: str(c.reverted_at), summary: `${appliedHeadline(str(c.origin) as CorrectionOrigin, c.applied_by_name as string | null)} — reverted`, line_keys: c.line_key ? [str(c.line_key)] : [] });
  }

  // Corrections — line-level.
  for (const c of await rows(db, () => db.from("boq_corrections").select("id, item_key, line_description, correction_type, field, old_value, new_value, note, recorded_at").eq("project_id", projectId).gt("recorded_at", fromISO).lte("recorded_at", toISO))) {
    if (appliedIds.has(str(c.id))) continue; // its application above names the line exactly
    const type = str(c.correction_type);
    const o = num(c.old_value);
    const n = num(c.new_value);
    const figures = o != null || n != null ? ` ${o ?? "—"} → ${n ?? "—"}` : "";
    const field = c.field ? ` (${str(c.field)})` : "";
    const note = c.note ? ` — ${str(c.note)}` : "";
    out.push({
      kind: "correction",
      at: str(c.recorded_at),
      summary: `${type} correction${field}${figures}${note}`,
      item_keys: c.item_key ? [str(c.item_key)] : [],
      descriptions: c.line_description ? [str(c.line_description)] : [],
    });
  }

  // The project's firm's rate book — line-level, by item key.
  const proj = await rows(db, () => db.from("projects").select("firm_id").eq("id", projectId));
  const firmId = (proj[0]?.firm_id ?? null) as string | null;
  if (firmId) {
    const ORIGIN: Record<string, string> = { firm_entry: "typed by a member", quote_import: "from a supplier quotation", promoted_correction: "promoted correction" };
    for (const e of await rows(db, () => db.from("firm_rate_entries").select("item_key, grade, unit, rate_aed, origin, created_at").eq("firm_id", firmId).gt("created_at", fromISO).lte("created_at", toISO))) {
      out.push({
        kind: "firm_rate",
        at: str(e.created_at),
        summary: `${str(e.item_key)}${e.grade ? ` / ${str(e.grade)}` : ""} at ${num(e.rate_aed)} per ${str(e.unit)} (${ORIGIN[str(e.origin)] ?? str(e.origin)})`,
        item_keys: [str(e.item_key)],
      });
    }
    for (const e of await rows(db, () => db.from("firm_rate_entries").select("item_key, grade, retire_reason, superseded_at").eq("firm_id", firmId).gt("superseded_at", fromISO).lte("superseded_at", toISO))) {
      out.push({
        kind: "firm_rate",
        at: str(e.superseded_at),
        summary: `${str(e.item_key)}${e.grade ? ` / ${str(e.grade)}` : ""} retired${e.retire_reason ? ` — ${str(e.retire_reason)}` : ""}`,
        item_keys: [str(e.item_key)],
      });
    }
  }

  // Pilot events — the generation that produced the later revision, plan edits, decisions.
  const events = await rows(db, () => db.from("pilot_events").select("kind, recorded_at, detail").eq("project_id", projectId).gt("recorded_at", fromISO).lte("recorded_at", new Date(Date.parse(toISO) + 5_000).toISOString()).order("recorded_at"));
  const edits = new Map<string, { n: number; last: string }>();
  // K12: scope edits (design_edit, layer "scope") are their own cause — the NET change in the window.
  const scopeEvents: { at: string; added: string[]; removed: string[] }[] = [];
  // R10b: openings confirmed on 01 Plan (design_edit, layer "openings_confirmed") — one cause for the window.
  const confirmed = { n: 0, last: "" };
  for (const e of events) {
    const d = (e.detail ?? {}) as Row;
    const at = str(e.recorded_at);
    switch (str(e.kind)) {
      case "boq_generated": {
        // The event is written just after the row; it names the row it belongs to.
        if (str(d.boq_id) !== toBoqId) break;
        const src = d.source ? str(d.source) : d.stage ? `stage: ${str(d.stage)}` : "regenerated";
        out.push({ kind: "regeneration", at: toISO, summary: `this revision was generated — ${src}`, revision_level: true });
        break;
      }
      case "plan_saved":
      case "design_edit": {
        if (at > toISO) break;
        const layer = d.layer ? str(d.layer) : "plan";
        if (layer === "openings_confirmed") {
          confirmed.n += typeof d.count === "number" ? d.count : 1;
          confirmed.last = at;
          break;
        }
        if (layer === "scope") {
          scopeEvents.push({ at, added: Array.isArray(d.added) ? d.added.map(str) : [], removed: Array.isArray(d.removed) ? d.removed.map(str) : [] });
          break;
        }
        const cur = edits.get(layer) ?? { n: 0, last: at };
        edits.set(layer, { n: cur.n + 1, last: at });
        break;
      }
      case "session_decision": {
        if (at > toISO) break;
        const q = str(d.question);
        const applied = str(d.applied) || str(d.answer);
        out.push({ kind: "session_decision", at, summary: q ? `${q}: ${applied}` : applied });
        break;
      }
      default:
        break;
    }
  }
  if (scopeEvents.length > 0) {
    const net = netScopeChange(scopeEvents);
    if (net.added.length || net.removed.length) out.push({ kind: "scope_change", at: scopeEvents.at(-1)!.at, summary: scopeChangeSummary(net.added.length, net.removed.length) });
  }
  if (confirmed.n > 0) {
    out.push({ kind: "openings_confirmed", at: confirmed.last, summary: `${OPENINGS_CONFIRMED_CAUSE} — ${confirmed.n} ${confirmed.n === 1 ? "opening" : "openings"}`, item_keys: [...OPENING_NET_ITEM_KEYS] });
  }
  for (const [layer, { n, last }] of edits) {
    out.push({ kind: "plan_edit", at: last, summary: `plan edited — ${layer} × ${n}` });
  }

  return out.sort((a, b) => a.at.localeCompare(b.at));
}
