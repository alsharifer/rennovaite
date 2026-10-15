import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { RULE_SEVERITY, type RuleKey } from "@/lib/plan/plan-rules";
import { projectAccess } from "@/lib/projects/http";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 15 Oct — POST /api/plan-rules/keep { plan_id, rule, room_id | opening_id, keep }.
// "Keep anyway" on a SOFT plan rule (lib/plan/plan-rules.ts): the owner says the
// unusual thing is right (an archway into a utility WC, a window between two
// rooms). Recorded on the subject's own `spec.kept_rules`, so it follows the room
// or opening and goes with it; `keep: false` takes it back. A hard rule cannot be
// kept — it is fixed on the plan. Any project member.
const SOFT = (Object.keys(RULE_SEVERITY) as RuleKey[]).filter((k) => RULE_SEVERITY[k] === "soft") as [RuleKey, ...RuleKey[]];
const Body = z
  .object({
    plan_id: z.string().uuid(),
    rule: z.enum(SOFT),
    room_id: z.string().uuid().optional(),
    opening_id: z.string().uuid().optional(),
    keep: z.boolean().default(true),
  })
  .refine((b) => !!b.room_id !== !!b.opening_id, "Name exactly one of room_id or opening_id.");

export async function POST(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ success: false, error: "Body must be { plan_id, rule (a soft rule), room_id | opening_id, keep }.", code: "bad_request" }, { status: 400 });
  const db = getSupabaseAdmin() as unknown as SupabaseClient;
  const { plan_id, rule, room_id, opening_id, keep } = body.data;
  const access = await projectAccess(db, caller, { plan_id, room_id, opening_id });
  if (access.denied) return access.denied;

  const table = room_id ? "rooms" : "plan_openings";
  const id = (room_id ?? opening_id)!;
  const { data: row, error } = await db.from(table).select("id, spec").eq("id", id).eq("plan_id", plan_id).maybeSingle<{ id: string; spec: Record<string, unknown> | null }>();
  if (error) return NextResponse.json({ success: false, error: error.message, code: "read_failed" }, { status: 500 });
  if (!row) return NextResponse.json({ success: false, error: "Not on this plan.", code: "not_found" }, { status: 404 });

  const spec = { ...(row.spec ?? {}) };
  const kept = new Set(Array.isArray(spec.kept_rules) ? (spec.kept_rules as string[]) : []);
  if (keep) kept.add(rule);
  else kept.delete(rule);
  spec.kept_rules = [...kept].sort();
  const { error: upErr } = await db.from(table).update({ spec }).eq("id", id).eq("plan_id", plan_id);
  if (upErr) return NextResponse.json({ success: false, error: upErr.message, code: "write_failed" }, { status: 500 });
  return NextResponse.json({ success: true, kept_rules: spec.kept_rules });
}
