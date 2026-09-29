import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { RevisionNotFound, buildProjectRevisionDiff } from "@/lib/boq/revisions";
import { renderRevisionDiffPdf } from "@/lib/documents/revision-diff-pdf";
import { findWithheldIdentities, loadWithheldNames } from "@/lib/identity/curation";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// U4 — GET /api/projects/:id/boq-diff?from=<boq_id>&to=<boq_id>[&format=pdf|pages]
//
// The diff of two revisions of the project's BoQ — the SAME object the in-app
// view renders (lib/boq/revisions.ts → buildProjectRevisionDiff). `format=pdf`
// prints it (lib/documents/revision-diff-pdf.ts); `format=pages` returns the
// printed SVG pages for checks.
//
// This is a FIRM-FACING working document, not a client pack deliverable, so it
// is not behind the pack-export job guard (T5); it is behind sign-in, and every
// printed page is scanned for withheld identities before it leaves.

const Query = z.object({ from: z.string().uuid(), to: z.string().uuid(), format: z.enum(["json", "pdf", "pages"]).default("json") });

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated("Sign in to read a BoQ revision diff.");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid project id." }, { status: 400 });
  const q = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!q.success) return NextResponse.json({ error: "from and to must be BoQ revision ids (uuid)." }, { status: 400 });
  const sb = getSupabaseAdmin() as unknown as SupabaseClient;
  try {
    const result = await buildProjectRevisionDiff(sb, id, q.data.from, q.data.to);
    if (q.data.format === "json") {
      return NextResponse.json({
        success: true,
        project: result.project,
        diff: result.diff,
        refs: { before: result.before.refs, after: result.after.refs },
        approvals: result.approvals,
        provenance: { before: result.before.provenance, after: result.after.provenance },
      });
    }
    const { pdf, pages } = await renderRevisionDiffPdf({
      projectName: result.project.name,
      community: result.project.city,
      dateISO: new Date().toISOString().slice(0, 10),
      diff: result.diff,
      refs: { before: result.before.refs, after: result.after.refs },
      approvals: { before: result.approvals.before, after: result.approvals.after },
    });
    // Identity: nothing withheld may be printed — refuse the document rather than serve it.
    const leaks = findWithheldIdentities(pages, await loadWithheldNames(sb, id));
    if (leaks.length > 0) {
      console.error("[api/boq-diff] withheld identity on a printed page", leaks);
      return NextResponse.json({ error: "The document would print a withheld identity; refused.", code: "identity_leak" }, { status: 500 });
    }
    if (q.data.format === "pages") return NextResponse.json({ success: true, pages, diff: result.diff });
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="boq-diff-${id.slice(0, 8)}-${q.data.from.slice(0, 8)}-${q.data.to.slice(0, 8)}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof RevisionNotFound) return NextResponse.json({ error: e.message, code: "revision_not_found" }, { status: 404 });
    console.error("[api/boq-diff]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Revision diff failed." }, { status: 500 });
  }
}
