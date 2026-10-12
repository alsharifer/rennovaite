import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";

import { BoqReview } from "@/components/blueprint/boq/BoqReview";
import type { FurnitureView, RoomRollup } from "@/components/blueprint/boq/Extras";
import { GenerateFirst } from "@/components/blueprint/boq/GenerateFirst";
import { getPageCaller } from "@/lib/auth/caller";
import { findComponentDuplicates } from "@/lib/boq/component-dedupe";
import { roomRollup } from "@/lib/boq/elements";
import type { TakeoffItem, WorkItemKey } from "@/lib/boq/quantify";
import { elementPricer } from "@/lib/boq/rates";
import { resolveRef } from "@/lib/boq/refs";
import { regenerateReadiness } from "@/lib/boq/regenerate";
import { changesSinceRevision } from "@/lib/boq/changes-since";
import { buildReviewModel, type ReviewBoq } from "@/lib/boq/review-model";
import { sortSections } from "@/lib/boq/section-order";
import { runPermitCheck } from "@/lib/compliance/check";
import { packExportEnabled } from "@/lib/documents/pack-export/guard";
import { loadProposalGate, type ProposalGate } from "@/lib/documents/proposal-gate";
import { itemVocabulary } from "@/lib/firms/vocabulary";
import { curateBoq } from "@/lib/identity/curation";
import { recordBoqView } from "@/lib/pilot/views";
import { buildBoqProvenance } from "@/lib/provenance/boq";
import { loadProvenanceContext } from "@/lib/provenance/load";
import { loadFirmBook, loadProjectFirmOverlay } from "@/lib/rates/firm";
import { collectFurnitureSection } from "@/lib/staging/collect";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { hasTakeoffProvenance, type ScenarioBoq } from "@/lib/whatif/engine";
import { loadLatestScenario, loadRateBook } from "@/lib/whatif/rate-book";
import type { WhatIfEngine } from "@/components/blueprint/boq/WhatIfTab";


export const dynamic = "force-dynamic";

// =============================================================================
// /project/[id]/boq — BoQ & Review (K3, R7 §3.2), firm step 05.
//
// The server builds ONE view model from the STORED revision (curated for
// identity on its way out, in canonical section order, every mark from
// tierOf(), every chain from the I4 provenance source) and the client screen
// renders it. Nothing on this page re-prices: what-if is a scenario, never the
// BoQ.
// =============================================================================

const CONSEQUENCE: Record<string, string> = {
  permit_required: "permit required",
  noc_required: "NOC required",
  approval_likely: "approval likely",
  no_permit: "no permit",
};

function isBoq(value: unknown): value is ReviewBoq {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.sections) && typeof v.subtotal_aed === "number" && typeof v.grand_total_aed === "number";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "22 Sep 2026" (Dubai date) — the rail and the frames print it this way. */
function revDate(iso: string): string {
  const [y, m, d] = new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" }).split("-").map(Number);
  return `${d} ${MONTHS[m! - 1]} ${y}`;
}

export default async function BoqPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ highlight?: string; view?: string; room?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const sb = getSupabaseAdmin() as unknown as SupabaseClient;

  const [projectRes, boqRes, countRes] = await Promise.all([
    sb.from("projects").select("id, budget_aed, firm_id").eq("id", id).maybeSingle<{ id: string; budget_aed: number | null; firm_id: string | null }>(),
    sb.from("boqs").select("id, sections, created_at").eq("project_id", id).order("created_at", { ascending: false }).limit(1),
    sb.from("boqs").select("id", { count: "exact", head: true }).eq("project_id", id),
  ]);
  if (projectRes.error || !projectRes.data) notFound();
  const project = projectRes.data;
  const latest = (boqRes.data?.[0] ?? null) as { id: string; sections: unknown; created_at: string } | null;

  if (!latest || !isBoq(latest.sections)) {
    return (
      <div className="bp-boq px-6 py-8 md:px-8">
        <h1 className="sr-only">BoQ &amp; Review</h1>
        <GenerateFirst projectId={id} />
      </div>
    );
  }

  // Everything below reads independently — fetched together (the page used to
  // await a dozen round-trips one after another).
  const rev = countRes.count ?? 1;
  const [caller, ctx, gate] = await Promise.all([
    // A page request carries a cookie session or (scripts) a Bearer token.
    getPageCaller(),
    loadProvenanceContext(sb, id),
    // L4: where the rates came from and whether a client proposal may export on them.
    loadProposalGate(sb, id).catch((): ProposalGate | null => null),
  ]);
  const curated = curateBoq(latest.sections, ctx.withheldNames) as ReviewBoq;
  const boq: ReviewBoq = { ...curated, sections: sortSections(curated.sections) };
  const provenance = buildBoqProvenance(boq as Parameters<typeof buildBoqProvenance>[0], ctx);

  // P5 what-if: the grade engine when the BoQ has take-off provenance (legacy
  // LLM-path BoQs are refused) — wrapped, unchanged, in the inspector's What-if tab.
  const scenarioBoq: ScenarioBoq = {
    sections: boq.sections.map((s) => ({ work_section: s.work_section, lines: s.lines.map((l) => ({ rule_id: l.rule_id, quantity: l.quantity, rate_aed: l.rate_aed, total_aed: l.total_aed, description: l.description })) })),
    grand_total_aed: boq.grand_total_aed,
    subtotal_aed: boq.subtotal_aed,
    contingency_pct: boq.contingency_pct,
    vat_pct: boq.vat_pct,
    ohp_pct: boq.ohp_pct,
  };

  const [firm, regenerateBlock, changed, rooms, permits, furniture, engine] = await Promise.all([
    // Persona: a member of the firm this project is attached to works the firm journey.
    (async (): Promise<Parameters<typeof buildReviewModel>[0]["firm"]> => {
      if (!project.firm_id || !caller) return null;
      const { data: member } = await sb.from("firm_members").select("firm_id").eq("firm_id", project.firm_id).eq("user_id", caller.id).maybeSingle();
      if (!member) return null;
      const book = await loadFirmBook(sb, project.firm_id).catch(() => null);
      return {
        id: project.firm_id,
        brand: gate?.firm?.brand ?? "your firm",
        bookItemKeys: new Set((book?.entries ?? []).map((e) => e.item_key)),
        vocabulary: (k: string) => {
          const v = itemVocabulary(k);
          return v ? { unit: v.unit } : null;
        },
      };
    })(),
    // H4: may this viewer regenerate, and if not, why — the route's own answer.
    regenerateReadiness(sb, id, caller)
      .then((r) => r.block)
      .catch(() => null /* the route still enforces */),
    // K2/K3: "changed since rev N" is ONE function — the rail's attention reason
    // and this control's Ready / Unchanged never disagree.
    changesSinceRevision(sb, id, { id: latest.id, created_at: latest.created_at }, rev)
      .then((c) => c.summary)
      .catch(() => null),
    // P4: cost by room (best-effort; empty when the take-off was not stored).
    (async (): Promise<RoomRollup[]> => {
      try {
        const { data: tRows } = await sb.from("takeoff_items").select("work_item_key, room_id, element_id, qty, unit, wet_area").eq("project_id", id);
        const items: TakeoffItem[] = ((tRows ?? []) as { work_item_key: string; room_id: string | null; element_id: string | null; qty: number; unit: string; wet_area: boolean }[]).map((r) => ({
          work_item_key: r.work_item_key as WorkItemKey,
          room_id: r.room_id,
          element_id: r.element_id ?? "",
          qty: Number(r.qty),
          unit: r.unit,
          wet_area: !!r.wet_area,
        }));
        if (items.length === 0) return [];
        const overlay = await loadProjectFirmOverlay(sb, id);
        const tier = (curated as { engine?: { tier?: "value" | "mid" | "premium" } }).engine?.tier ?? "mid";
        const rollups = roomRollup(items, elementPricer(overlay, tier));
        const { data: roomRows } = await sb.from("rooms").select("id, name_en").in("id", rollups.map((r) => r.room_id));
        const names = new Map(((roomRows ?? []) as { id: string; name_en: string | null }[]).map((r) => [r.id, r.name_en ?? "Room"]));
        return rollups.map((r) => ({ roomId: r.room_id, roomName: names.get(r.room_id) ?? "Room", total_aed: r.total_aed, items: r.items.map((w) => ({ description: w.description, qty: w.qty, unit: w.unit, total_aed: w.total_aed })) }));
      } catch {
        return []; // no take-off table → no room view
      }
    })(),
    // P6: permit triggers over the plan diff (flagged).
    process.env.PERMIT_CHECK_ENABLED === "true"
      ? runPermitCheck(id)
          .then((r) => r.fired.map((f) => ({ title: f.title_en, consequence: CONSEQUENCE[f.consequence] ?? f.consequence })))
          .catch(() => null)
      : Promise.resolve(null),
    // P7: optional furniture — never in boqs.sections, never in the project total.
    collectFurnitureSection(id, sb)
      .then((f): FurnitureView | null => (f ? { total: f.section_total_aed, lines: f.lines.map((l) => ({ description: l.description, quantity: l.quantity, rate_aed: l.rate_aed, total_aed: l.total_aed })) } : null))
      .catch(() => null),
    process.env.WHATIF_ENABLED === "true" && hasTakeoffProvenance(scenarioBoq)
      ? Promise.all([loadRateBook(sb), loadLatestScenario(sb, id)]).then(([rateBook, scenario]): WhatIfEngine => ({ rateBook, boq: scenarioBoq, initialSelections: scenario?.selections ?? {} }))
      : Promise.resolve(null),
  ]);
  const persona: "firm" | "owner" = firm ? "firm" : "owner";

  const duplicates = findComponentDuplicates(
    boq.sections.flatMap((s) => s.lines.map((l) => ({ work_section: s.work_section, description: l.description, rule_id: l.rule_id ?? null, item_key: null, quantity: l.quantity, total_aed: l.total_aed }))),
  ).map((f) => ({
    label: f.label,
    detail: `${f.owner_key} in ${f.owner_line.work_section} is also priced as ${f.duplicate_key} in ${f.duplicate_line.work_section}${f.duplicate_total_aed > 0 ? "" : " (unpriced today)"}`,
  }));

  const model = buildReviewModel({
    projectId: id,
    boqId: latest.id,
    rev,
    revDate: revDate(latest.created_at),
    persona,
    boq,
    provenance,
    tierCtx: { qsValidated: ctx.qsValidated },
    firm,
    projectHasFirm: !!project.firm_id,
    basis: gate?.boq ? { basis: gate.boq.basis, verdict: gate.verdict, acceptance: gate.acceptance, bookReviewed: gate.firm?.book_status === "reviewed" } : null,
    duplicates,
    budget: project.firm_id ? null : (project.budget_aed ?? null),
  });

  // L5: a signed-in view of the BoQ is the checking signal (deduped per actor per 10 min).
  if (caller) await recordBoqView(sb, id, latest.id, caller.id);

  const highlightRef = sp.highlight ? resolveRef(boq.sections, sp.highlight) : null;

  return (
    <>
      <h1 className="sr-only">BoQ &amp; Review</h1>
      <BoqReview
        model={model}
        rooms={rooms}
        furniture={furniture}
        permits={permits}
        packExport={packExportEnabled()}
        highlightRef={highlightRef}
        view={sp.view === "byroom" ? "byroom" : "sections"}
        highlightRoom={sp.room ?? null}
        regen={{ rev, block: regenerateBlock, changed }}
        engine={engine}
      />
    </>
  );
}
