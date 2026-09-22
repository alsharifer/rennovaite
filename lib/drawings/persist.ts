// =============================================================================
// lib/drawings/persist.ts — best-effort persistence of a drawing set (P1 / S5).
//
// Uploads each sheet (SVG + PDF) to the PRIVATE Supabase Storage bucket
// `drawings` under projects/{id}/drawings/ and records a drawing_sets row.
// The bucket is private and this is an ARCHIVE of the set at design lock, not a
// release: since T5 no client document leaves the app except through Export pack
// (lib/documents/pack-export), so sheet_urls record storage PATHS and no signed
// URL is minted here (it used to mint year-long ones). Entirely best-effort: if the bucket or the drawing_sets table
// (migration 014) don't exist yet, this logs and returns null without breaking
// the caller (e.g. the design-lock flow). The Drawings UI itself generates live
// and does not depend on this.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { generateDrawingSet, renderSheetPdf, type SheetKind } from "./export";

const BUCKET = "drawings";

export interface PersistedSheet {
  kind: SheetKind;
  title: string;
  sheet_number: string;
  /** Storage path in the private `drawings` bucket (never a URL — see header). */
  svg_path: string | null;
  pdf_path: string | null;
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
      let svg_path: string | null = null;
      let pdf_path: string | null = null;
      try {
        await storage.upload(`${base}.svg`, new Blob([s.svg], { type: "image/svg+xml" }), {
          upsert: true,
          contentType: "image/svg+xml",
        });
        svg_path = `${base}.svg`;
      } catch (e) {
        console.warn(`[drawings/persist] svg upload skipped (${s.kind}):`, e instanceof Error ? e.message : e);
      }
      try {
        const pdf = await renderSheetPdf(s.svg);
        await storage.upload(`${base}.pdf`, new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), {
          upsert: true,
          contentType: "application/pdf",
        });
        pdf_path = `${base}.pdf`;
      } catch (e) {
        console.warn(`[drawings/persist] pdf upload skipped (${s.kind}):`, e instanceof Error ? e.message : e);
      }
      sheets.push({ kind: s.kind, title: s.title, sheet_number: s.sheetNumber, svg_path, pdf_path });
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
