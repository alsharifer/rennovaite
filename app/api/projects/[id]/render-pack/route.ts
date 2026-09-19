import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadPackReadiness, readinessMessage } from "@/lib/documents/pack-readiness";
import { generateRenderPack } from "@/lib/documents/render-pack-pdf";
import { recordPilotEvent } from "@/lib/pilot/events";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const IdSchema = z.string().uuid();

/**
 * GET /api/projects/:id/render-pack
 *   default        → the garden render pack as an A3 PDF
 *   ?format=json   → what the pack contains (pages, zones, missing images), no PDF body
 *   ?format=pages  → the page SVGs as printed (photographs aside) — for the G5
 *                    draft and identity assertions
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
    // G5: a pack that still carries an unmade decision does not export. The JSON
    // manifest stays available, with the readiness verdict in it.
    const sb = getSupabaseAdmin() as unknown as SupabaseClient;
    const format = new URL(request.url).searchParams.get("format");
    const json = format === "json" || format === "pages";
    const readiness = await loadPackReadiness(sb, parsed.data);
    if (!readiness.ready && !json) {
      return NextResponse.json({ error: readinessMessage(readiness), code: "pack_not_ready", readiness }, { status: 409 });
    }
    const { pdf, summary, pageSvgs } = await generateRenderPack(parsed.data);
    // G5c: no pack leaves with the BoQ, the drawings and the views disagreeing.
    if (!summary.parity.clean && !json && format !== "pages") {
      const lines = summary.parity.lines.filter((l) => l.status === "fail").map((l) => `${l.rule_id} ${l.description}: ${l.reason}`);
      const els = summary.parity.elements.filter((e) => e.status === "fail").map((e) => `${e.name}: ${e.reason}`);
      return NextResponse.json({ error: `Parity failed: ${[...lines, ...els].slice(0, 6).join("; ")}`, code: "parity_failed", parity: summary.parity }, { status: 409 });
    }
    if (format === "pages") return NextResponse.json({ readiness, pages: pageSvgs });
    if (json) {
      return NextResponse.json({ ...summary, readiness, bytes: pdf.byteLength });
    }
    await recordPilotEvent(sb, parsed.data, "pack_exported", { document: "render_pack", pages: summary.pages.length, gate: summary.gate.map((g) => g.outcome) });
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
