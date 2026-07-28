// =============================================================================
// lib/drawings/persist.ts — best-effort persistence of a drawing set (P1 / S5).
//
// Uploads each sheet (SVG + PDF) to Supabase Storage under
// projects/{id}/drawings/ and records a drawing_sets row. Entirely best-effort:
// if the `drawings` bucket or the drawing_sets table (migration 014) don't
// exist yet, this logs and returns null without breaking the caller (e.g. the
// design-lock flow). The Drawings UI itself generates live and does not depend
// on this.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { generateDrawingSet, renderSheetPdf, type SheetKind } from "./export";

const BUCKET = "drawings";

export interface PersistedSheet {
  kind: SheetKind;
  title: string;
  sheet_number: string;
  svg_url: string | null;
  pdf_url: string | null;
}

export async function persistDrawingSet(
  projectId: string,
): Promise<PersistedSheet[] | null> {
  try {
    const set = await generateDrawingSet(projectId);
    const supabase = getSupabaseAdmin();
    const storage = supabase.storage.from(BUCKET);
    const sheets: PersistedSheet[] = [];

    for (const s of set.sheets) {
      const base = `projects/${projectId}/drawings/${s.kind}`;
      let svg_url: string | null = null;
      let pdf_url: string | null = null;
      try {
        await storage.upload(`${base}.svg`, new Blob([s.svg], { type: "image/svg+xml" }), {
          upsert: true,
          contentType: "image/svg+xml",
        });
        svg_url = storage.getPublicUrl(`${base}.svg`).data.publicUrl;
      } catch (e) {
        console.warn(`[drawings/persist] svg upload skipped (${s.kind}):`, e instanceof Error ? e.message : e);
      }
      try {
        const pdf = await renderSheetPdf(s.svg);
        await storage.upload(`${base}.pdf`, new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), {
          upsert: true,
          contentType: "application/pdf",
        });
        pdf_url = storage.getPublicUrl(`${base}.pdf`).data.publicUrl;
      } catch (e) {
        console.warn(`[drawings/persist] pdf upload skipped (${s.kind}):`, e instanceof Error ? e.message : e);
      }
      sheets.push({ kind: s.kind, title: s.title, sheet_number: s.sheetNumber, svg_url, pdf_url });
    }

    const untyped = supabase as unknown as SupabaseClient;
    const { error } = await untyped
      .from("drawing_sets")
      .insert({ project_id: projectId, sheet_urls: sheets });
    if (error) {
      console.warn("[drawings/persist] drawing_sets insert skipped:", error.message);
    }
    return sheets;
  } catch (e) {
    console.warn("[drawings/persist] best-effort persist failed:", e instanceof Error ? e.message : e);
    return null;
  }
}
