// lib/documents/proposal-pdf.ts — the proposal rasterised (L4). Server-only.
import { rasteriseA4Pages } from "./boq-pdf";
import { buildProposalPages, type ProposalInput } from "./proposal";

export async function renderProposalPdf(input: ProposalInput): Promise<{ pdf: Uint8Array; pages: string[] }> {
  const pages = buildProposalPages(input);
  return { pdf: await rasteriseA4Pages(pages, `${input.brand} — Proposal — ${input.projectName}`), pages };
}
