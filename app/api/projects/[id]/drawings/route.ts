import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { generateDrawingSet, renderSheetPdf, type SheetKind } from "@/lib/drawings/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const IdSchema = z.string().uuid();
const KINDS: SheetKind[] = [
  "as_built",
  "proposed",
  "finish_schedule",
  "electrical",
  "plumbing",
];

function flagOn(): boolean {
  return process.env.DRAWINGS_ENABLED === "true";
}

/**
 * GET /api/projects/:id/drawings
 *   default            → JSON { sheets:[{kind,title,sheetNumber,svg}], derivedNotes }
 *   ?format=pdf&sheet= → single-sheet A3 PDF (true 1:100). sheet defaults to as_built.
 * Gated by DRAWINGS_ENABLED (404 when off, so the surface is invisible).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!flagOn()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  try {
    const { id } = await params;
    const parsed = IdSchema.safeParse(id);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid project id." }, { status: 400 });
    }
    const projectId = parsed.data;
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format");

    const set = await generateDrawingSet(projectId);

    if (format === "pdf") {
      const kindParam = (searchParams.get("sheet") as SheetKind) ?? "as_built";
      const kind = KINDS.includes(kindParam) ? kindParam : "as_built";
      const sheet = set.sheets.find((s) => s.kind === kind);
      if (!sheet) {
        return NextResponse.json({ error: "Sheet not found." }, { status: 404 });
      }
      const pdf = await renderSheetPdf(sheet.svg);
      return new NextResponse(new Uint8Array(pdf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${sheet.sheetNumber}-${kind}.pdf"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json({
      projectId: set.projectId,
      planId: set.planId,
      sheets: set.sheets,
      derivedNotes: set.derivedNotes,
    });
  } catch (err) {
    console.error("[api/projects/:id/drawings] error", err);
    const message = err instanceof Error ? err.message : "Drawing generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
