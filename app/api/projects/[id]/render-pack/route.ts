import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { generateRenderPack } from "@/lib/documents/render-pack-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const IdSchema = z.string().uuid();

/**
 * GET /api/projects/:id/render-pack
 *   default        → the garden render pack as an A3 PDF
 *   ?format=json   → what the pack contains (pages, zones, missing images), no PDF body
 * Gated by DRAWINGS_ENABLED with the drawing set it is assembled alongside.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.DRAWINGS_ENABLED !== "true") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const parsed = IdSchema.safeParse((await params).id);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid project id." }, { status: 400 });
  }
  try {
    const { pdf, summary } = await generateRenderPack(parsed.data);
    if (new URL(request.url).searchParams.get("format") === "json") {
      return NextResponse.json({ ...summary, bytes: pdf.byteLength });
    }
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="render-pack-${parsed.data.slice(0, 8)}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[api/render-pack] error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Render pack failed." },
      { status: 500 },
    );
  }
}
