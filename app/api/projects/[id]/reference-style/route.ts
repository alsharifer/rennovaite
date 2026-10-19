import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { loadMoodboard } from "@/lib/moodboard/load";
import { projectAccess } from "@/lib/projects/http";
import { describeReferences, type ReferenceStyle } from "@/lib/render/reference-style";
import { recordSpend } from "@/lib/render/render-spend";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// B2 — the look the client's references share, in words.
//   GET  /api/projects/:id/reference-style  the stored style brief (or null)
//   POST /api/projects/:id/reference-style  read the project's References (the
//        uploaded images on its 02 Design board, in board order, up to 10) and
//        write one style brief — style words only, never layout — onto
//        project_briefs.reference_style. Photo views are prompted with it
//        ("Style follows your references"). Any project member.

const MAX_REFERENCES = 10;
const db = () => getSupabaseAdmin() as unknown as SupabaseClient;

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  const { id } = await ctx.params;
  const access = await projectAccess(db(), caller, { project_id: id });
  if (access.denied) return access.denied;
  const { data } = await db().from("project_briefs").select("reference_style").eq("project_id", id).maybeSingle<{ reference_style: ReferenceStyle | null }>();
  return NextResponse.json({ reference_style: data?.reference_style ?? null });
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  const { id } = await ctx.params;
  const access = await projectAccess(db(), caller, { project_id: id });
  if (access.denied) return access.denied;
  const refs = (await loadMoodboard(id)).filter((m) => m.kind === "asset" && m.image_url).slice(0, MAX_REFERENCES);
  if (refs.length === 0) return NextResponse.json({ error: "Add reference photos on 02 Design (References) first.", code: "no_references" }, { status: 409 });
  try {
    const out = await describeReferences(refs.map((r) => ({ url: r.image_url! })));
    const style: ReferenceStyle = { text: out.text, elements: out.elements, item_ids: refs.map((r) => r.asset_id!).filter(Boolean), model: out.model, at: new Date().toISOString() };
    const { error } = await db().from("project_briefs").upsert({ project_id: id, reference_style: style }, { onConflict: "project_id" });
    if (error) {
      const missing = /reference_style|schema cache|does not exist/i.test(error.message);
      return NextResponse.json({ error: missing ? "Reference styles need migration 063 — apply it with npm run db:push." : error.message, code: missing ? "migration_required" : "write_failed" }, { status: 500 });
    }
    await recordSpend(db(), { project_id: id, purpose: "reference_style", model: out.model, cost_usd: out.usd, detail: { references: refs.length, actor: caller.id } });
    return NextResponse.json({ reference_style: style, references: refs.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "The references could not be read." }, { status: 500 });
  }
}
