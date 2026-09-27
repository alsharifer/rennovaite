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

import { isMissingSchema } from "@/lib/rates/firm";

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

export async function loadRecordedCauses(db: SupabaseClient, projectId: string, fromISO: string, toISO: string, toBoqId: string): Promise<RecordedCause[]> {
  const out: RecordedCause[] = [];

  // Corrections — line-level.
  for (const c of await rows(db, () => db.from("boq_corrections").select("item_key, line_description, correction_type, field, old_value, new_value, note, recorded_at").eq("project_id", projectId).gt("recorded_at", fromISO).lte("recorded_at", toISO))) {
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
        summary: `contractor rate book: ${str(e.item_key)}${e.grade ? ` / ${str(e.grade)}` : ""} at ${num(e.rate_aed)} per ${str(e.unit)} (${ORIGIN[str(e.origin)] ?? str(e.origin)})`,
        item_keys: [str(e.item_key)],
      });
    }
    for (const e of await rows(db, () => db.from("firm_rate_entries").select("item_key, grade, retire_reason, superseded_at").eq("firm_id", firmId).gt("superseded_at", fromISO).lte("superseded_at", toISO))) {
      out.push({
        kind: "firm_rate",
        at: str(e.superseded_at),
        summary: `contractor rate book: ${str(e.item_key)}${e.grade ? ` / ${str(e.grade)}` : ""} retired${e.retire_reason ? ` — ${str(e.retire_reason)}` : ""}`,
        item_keys: [str(e.item_key)],
      });
    }
  }

  // Pilot events — the generation that produced the later revision, plan edits, decisions.
  const events = await rows(db, () => db.from("pilot_events").select("kind, recorded_at, detail").eq("project_id", projectId).gt("recorded_at", fromISO).lte("recorded_at", new Date(Date.parse(toISO) + 5_000).toISOString()).order("recorded_at"));
  const edits = new Map<string, { n: number; last: string }>();
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
  for (const [layer, { n, last }] of edits) {
    out.push({ kind: "plan_edit", at: last, summary: `plan edited — ${layer} × ${n}` });
  }

  return out.sort((a, b) => a.at.localeCompare(b.at));
}
