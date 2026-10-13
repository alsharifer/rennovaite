// =============================================================================
// lib/boq/apply-correction.ts — "Add a price", "Apply to this BoQ now" and
// "Revert to rev N" (K11 #4, spec §7.3; migration 057). SERVER-ONLY.
//
//   applyCorrection   records the correction (or takes a saved one), lays every
//                     applied correction over the LATEST stored revision
//                     (lib/boq/own-basis.ts) and stores the result as the next
//                     revision — the subtotal moves by exactly the line's change
//                     and the chain recomputes to the fil; nothing else moves.
//   revertToRevision  stores an earlier revision's document as the next
//                     revision and marks the corrections applied since it as
//                     reverted (kept on record; they stop applying, so a later
//                     regeneration does not bring them back).
//   (lib/boq/own-basis-load.ts: what a regeneration re-applies.)
//
// Both write a `boq_generated` pilot event naming the revision they superseded
// (trigger apply_correction | revert) — the revision diff's revision-level cause;
// the correction row is its line-level cause ("Price added by <name>"). The
// caller is a project member (the route checked). Every write is best-effort
// reversible: a failed revision insert removes the correction it recorded.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Caller } from "@/lib/auth/caller";
import { recordPilotEvent } from "@/lib/pilot/events";
import { isMissingSchema } from "@/lib/rates/firm";
import { StoreError } from "@/lib/store-error";

import { lineItemKey } from "./line-identity";
import { applyOwnBasis, lineKeyAt, type OwnBasisDoc } from "./own-basis";
import { loadAppliedCorrections, toApplied } from "./own-basis-load";
import { appliedHeadline, type BasisKind, type CorrectionOrigin } from "./own-basis-vocab";
import type { ChainedDoc } from "./totals";

type Doc = OwnBasisDoc;
type Row = Record<string, unknown>;

const MIGRATION_057 = "Applying a correction needs migration 057 — apply it with npm run db:push.";

/** The name the revision diff prints for a member: their profile name, else their e-mail's local part. */
export async function memberName(db: SupabaseClient, caller: Caller): Promise<string> {
  try {
    const { data } = await db.auth.admin.getUserById(caller.id);
    const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
    const named = [meta.full_name, meta.name, meta.display_name].find((v): v is string => typeof v === "string" && v.trim().length > 0);
    if (named) return named.trim();
    const email = data.user?.email ?? caller.email;
    if (email) return email.split("@")[0]!;
  } catch {
    /* no auth admin (tests) — fall through */
  }
  return caller.email ? caller.email.split("@")[0]! : "a project member";
}

interface Revision {
  id: string;
  created_at: string;
  sections: Doc & { engine?: unknown };
}

async function revisions(db: SupabaseClient, projectId: string): Promise<Revision[]> {
  const { data, error } = await db.from("boqs").select("id, created_at, sections").eq("project_id", projectId).order("created_at", { ascending: true });
  if (error) throw new Error(`boqs read failed: ${error.message}`);
  return (data ?? []) as Revision[];
}

async function storeRevision(db: SupabaseClient, projectId: string, doc: Pick<ChainedDoc, "grand_total_aed">): Promise<{ id: string; created_at: string }> {
  const { data, error } = await db.from("boqs").insert({ project_id: projectId, total_aed: doc.grand_total_aed, sections: doc, locked_at: null }).select("id, created_at").single<{ id: string; created_at: string }>();
  if (error || !data) throw error ?? new Error("Failed to insert BoQ row.");
  return data;
}

export interface ApplyInput {
  /** The revision the member was looking at — must still be the latest. */
  boqId: string;
  /** Either a saved correction to apply … */
  correctionId?: string | null;
  /** … or a new one: the BoQ view's row key (`${section}-${idx}`) and the figure. */
  rowKey?: string | null;
  type?: "rate" | "quantity";
  value?: number;
  origin?: CorrectionOrigin;
  basisKind?: BasisKind | null;
  note?: string | null;
  lineRef?: string | null;
  lineDescription?: string | null;
  elementRefs?: string[] | null;
  /** A firm correction to promote later (the route checked membership). */
  firmId?: string | null;
}

export interface ApplyResult {
  boqId: string;
  rev: number;
  previousBoqId: string;
  previousTotal: number;
  total: number;
  correctionId: string;
}

export async function applyCorrection(db: SupabaseClient, projectId: string, caller: Caller, input: ApplyInput): Promise<ApplyResult> {
  const revs = await revisions(db, projectId);
  const latest = revs.at(-1);
  if (!latest) throw new StoreError(409, "no_boq", "This project has no BoQ yet — generate it first.");
  if (latest.id !== input.boqId) throw new StoreError(409, "stale_revision", `The BoQ has moved on to rev ${revs.length} — reload to see it, then try again.`);
  const doc = latest.sections;
  const name = await memberName(db, caller);
  const now = new Date().toISOString();

  // The correction: a saved one, or a new one recorded now.
  let correctionId: string;
  let created = false;
  if (input.correctionId) {
    const { data: c, error } = await db.from("boq_corrections").select("*").eq("id", input.correctionId).eq("project_id", projectId).maybeSingle<Row>();
    if (error) throw isMissingSchema(error) ? new StoreError(500, "migration_required", MIGRATION_057) : new Error(error.message);
    if (!c) throw new StoreError(404, "correction_not_found", "No such correction on this project.");
    if (c.correction_type !== "rate" && c.correction_type !== "quantity") throw new StoreError(422, "not_applicable", "Only a rate or a quantity correction changes a figure — this one stays a note.");
    if (c.new_value == null) throw new StoreError(422, "not_applicable", "This correction carries no figure to apply.");
    if (c.applied_boq_id && !c.reverted_at) throw new StoreError(409, "already_applied", "This correction already applies to the BoQ.");
    // A correction saved before 057 names its line only by description: the member's row key pins it.
    const lineKey = (c.line_key as string | null) ?? (input.rowKey ? lineKeyAt(doc, input.rowKey) : null);
    if (!lineKey) throw new StoreError(422, "line_unknown", "Open the line this correction belongs to and apply it from there.");
    const { error: upErr } = await db.from("boq_corrections").update({ line_key: lineKey, reverted_at: null, reverted_by: null, reverted_by_boq_id: null }).eq("id", input.correctionId);
    if (upErr) throw isMissingSchema(upErr) ? new StoreError(500, "migration_required", MIGRATION_057) : new Error(upErr.message);
    correctionId = input.correctionId;
  } else {
    const rowKey = input.rowKey ?? "";
    const lineKey = lineKeyAt(doc, rowKey);
    const [section, idx] = [rowKey.slice(0, rowKey.lastIndexOf("-")), Number(rowKey.slice(rowKey.lastIndexOf("-") + 1))];
    const line = doc.sections.find((s) => s.work_section === section)?.lines[idx];
    if (!lineKey || !line) throw new StoreError(404, "line_not_found", "That line is not in the latest revision — reload and try again.");
    const type = input.type ?? "rate";
    const value = Number(input.value);
    if (!Number.isFinite(value) || value < 0 || (input.origin === "add_price" && value <= 0)) throw new StoreError(422, "bad_value", input.origin === "add_price" ? "Enter a rate above zero." : "Enter a figure of zero or more.");
    const row = {
      project_id: projectId,
      boq_id: latest.id,
      item_key: lineItemKey(line),
      line_description: input.lineDescription?.trim() || `${section} — ${line.description}`,
      correction_type: type,
      field: type === "rate" ? "rate_aed" : "quantity",
      old_value: type === "rate" ? Number(line.rate_aed) : Number(line.quantity),
      new_value: value,
      note: input.note?.trim() || null,
      element_refs: input.elementRefs?.length ? input.elementRefs : null,
      provenance: "market_fair",
      origin: input.origin ?? "correction",
      basis_kind: input.basisKind ?? null,
      line_key: lineKey,
      line_ref: input.lineRef ?? null,
      firm_id: input.firmId ?? null,
    };
    const { data: ins, error } = await db.from("boq_corrections").insert(row).select("id").single<{ id: string }>();
    if (error || !ins) throw error && isMissingSchema(error) ? new StoreError(500, "migration_required", MIGRATION_057) : (error ?? new Error("The correction was not saved."));
    correctionId = ins.id;
    created = true;
  }

  // Every applied correction, this one included, over the latest revision.
  const active = (await loadAppliedCorrections(db, projectId)).filter((c) => c.id !== correctionId);
  const { data: mine } = await db.from("boq_corrections").select("id, correction_type, line_key, new_value, origin, basis_kind, note").eq("id", correctionId).single<Row>();
  const self = toApplied({ ...mine!, applied_by_name: name, applied_at: now });
  const out = applyOwnBasis(doc, [...active, self]);
  if (!out.applied.includes(correctionId)) {
    if (created) await db.from("boq_corrections").delete().eq("id", correctionId);
    throw new StoreError(422, "line_unknown", "That line is not in the latest revision — reload and try again.");
  }

  let stored: { id: string; created_at: string };
  try {
    stored = await storeRevision(db, projectId, out.boq);
  } catch (e) {
    if (created) await db.from("boq_corrections").delete().eq("id", correctionId);
    throw e;
  }
  const { error: markErr } = await db
    .from("boq_corrections")
    .update({ applied_boq_id: stored.id, applied_from_boq_id: latest.id, applied_at: now, applied_by: caller.id, applied_by_name: name })
    .eq("id", correctionId);
  if (markErr) {
    // The revision must not outlive the record that explains it.
    await db.from("boqs").delete().eq("id", stored.id);
    if (created) await db.from("boq_corrections").delete().eq("id", correctionId);
    throw new Error(`boq_corrections update failed: ${markErr.message}`);
  }

  const firmId = input.firmId ?? null;
  if (created) {
    await recordPilotEvent(db, projectId, "correction", { correction_type: self.type, origin: self.origin, applied: true, correction_id: correctionId, line_key: self.lineKey }, { actor: caller.id, firmId });
  }
  await recordPilotEvent(
    db,
    projectId,
    "boq_generated",
    { boq_id: stored.id, previous_boq_id: latest.id, trigger: "apply_correction", source: appliedHeadline(self.origin, name).toLowerCase(), correction_id: correctionId, grand_total_aed: out.boq.grand_total_aed, full: true },
    { actor: caller.id },
  );
  return { boqId: stored.id, rev: revs.length + 1, previousBoqId: latest.id, previousTotal: Number(doc.grand_total_aed), total: out.boq.grand_total_aed, correctionId };
}

export interface RevertResult {
  boqId: string;
  rev: number;
  toRev: number;
  previousBoqId: string;
  total: number;
  reverted: string[];
}

export async function revertToRevision(db: SupabaseClient, projectId: string, caller: Caller, toBoqId: string): Promise<RevertResult> {
  const revs = await revisions(db, projectId);
  const latest = revs.at(-1);
  const i = revs.findIndex((r) => r.id === toBoqId);
  if (i < 0 || !latest) throw new StoreError(404, "boq_not_found", "No such revision on this project.");
  if (i === revs.length - 1) throw new StoreError(409, "already_current", "That revision is already the current BoQ.");
  const target = revs[i]!;
  const name = await memberName(db, caller);
  const stored = await storeRevision(db, projectId, target.sections);

  // Corrections applied in the revisions after the target stop applying (kept on record).
  const after = revs.slice(i + 1).map((r) => r.id);
  let reverted: string[] = [];
  try {
    const { data, error } = await db.from("boq_corrections").select("id").eq("project_id", projectId).in("applied_boq_id", after).is("reverted_at", null);
    if (error && !isMissingSchema(error)) throw new Error(error.message);
    reverted = ((data ?? []) as { id: string }[]).map((r) => r.id);
    if (reverted.length > 0) {
      const { error: upErr } = await db.from("boq_corrections").update({ reverted_at: new Date().toISOString(), reverted_by: caller.id, reverted_by_boq_id: stored.id }).in("id", reverted);
      if (upErr) throw new Error(upErr.message);
    }
  } catch (e) {
    await db.from("boqs").delete().eq("id", stored.id);
    throw e;
  }
  await recordPilotEvent(
    db,
    projectId,
    "boq_generated",
    { boq_id: stored.id, previous_boq_id: latest.id, trigger: "revert", source: `reverted to rev ${i + 1} by ${name}`, reverted_to_boq_id: target.id, reverted_corrections: reverted, grand_total_aed: target.sections.grand_total_aed, full: true },
    { actor: caller.id },
  );
  return { boqId: stored.id, rev: revs.length + 1, toRev: i + 1, previousBoqId: latest.id, total: Number(target.sections.grand_total_aed), reverted };
}
