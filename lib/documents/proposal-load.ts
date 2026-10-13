// =============================================================================
// lib/documents/proposal-load.ts — one project's proposal input, read once for
// the gated document route AND the in-app preview (K4). Server-only.
//
// The BoQ is the gate's revision, curated; the scope is the plan's rooms; the
// brand, logo and terms are the firm's; the setup (053) adds client, validity,
// payment terms, cover note and the line-rate choice. Every page built from it
// is scanned for withheld identities by `proposalLeaks` before it is served.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { BoqPdfInput } from "@/lib/documents/boq-pdf";
import { loadDocumentProject } from "@/lib/documents/project-name";
import type { ProposalInput, ProposalScopeRoom } from "@/lib/documents/proposal";
import type { ProposalGate } from "@/lib/documents/proposal-gate";
import { loadProposalSetup, validityText } from "@/lib/documents/proposal-setup";
import { loadLogoDataUri } from "@/lib/firms/branding";
import { INTERNAL_REF } from "@/lib/ground-truth/villa94-garden";
import { curateBoq, findWithheldIdentities, loadWithheldNames } from "@/lib/identity/curation";

export async function loadProposalInput(sb: SupabaseClient, projectId: string, gate: ProposalGate, opts: { preview?: boolean } = {}): Promise<{ input: ProposalInput; boqId: string; withheld: string[] } | null> {
  if (!gate.firm || !gate.boq) return null;
  const withheld = await loadWithheldNames(sb, projectId);
  const [project, boqRow, logo, plan, setup, revs] = await Promise.all([
    loadDocumentProject(sb, projectId, "Untitled project"),
    sb.from("boqs").select("id, sections").eq("id", gate.boq.id).maybeSingle<{ id: string; sections: BoqPdfInput["boq"] }>(),
    loadLogoDataUri(sb, gate.firm.logo_path),
    sb.from("plans").select("id").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle<{ id: string }>(),
    loadProposalSetup(sb, projectId),
    // K8: "Based on — Bill of quantities, revision N" (oldest = rev 1, as 07 Revisions numbers them).
    sb.from("boqs").select("id").eq("project_id", projectId).order("created_at", { ascending: true }).then((r) => (r.data ?? []) as { id: string }[], () => [] as { id: string }[]),
  ]);
  if (!boqRow.data) return null;
  const { data: roomRows } = plan.data ? await sb.from("rooms").select("name_en, room_type, area_m2").eq("plan_id", plan.data.id).order("name_en") : { data: [] };
  const rooms: ProposalScopeRoom[] = ((roomRows ?? []) as { name_en: string | null; room_type: string | null; area_m2: number | null }[]).map((r) => ({
    name: r.name_en ?? "Area",
    kind: r.room_type ?? "",
    area_m2: r.area_m2 == null ? null : Number(r.area_m2),
  }));
  const dateISO = new Date().toISOString().slice(0, 10);
  return {
    boqId: boqRow.data.id,
    withheld,
    input: {
      brand: gate.firm.brand,
      logoDataUri: logo,
      termsText: gate.firm.terms_text,
      projectName: project.name,
      community: project.city,
      dateISO,
      rooms,
      boq: curateBoq(boqRow.data.sections, withheld),
      revision: revs.findIndex((r) => r.id === boqRow.data!.id) + 1 || null,
      clientLabel: setup?.clientLabel ?? null,
      validity: validityText(setup?.validityDays ?? null, dateISO),
      paymentTerms: setup?.paymentTerms ?? null,
      coverNote: setup?.coverNote ?? null,
      showLineRates: setup?.showLineRates ?? false,
      preview: opts.preview === true,
    },
  };
}

/** Withheld identities on printed pages. The firm's OWN brand is allowed (withheld names exclude the project's firm). */
export function proposalLeaks(pages: string[], withheld: string[]): string[] {
  const tokens = [String(INTERNAL_REF).split(/[^A-Za-z0-9]+/)[0]!, String(INTERNAL_REF)].filter((x) => x.length >= 3);
  return [...findWithheldIdentities(pages, withheld), ...tokens.filter((tok) => pages.some((p) => p.toLowerCase().includes(tok.toLowerCase())))];
}
