import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { memberName } from "@/lib/boq/apply-correction";
import { groupLineKeys, isProductValue, PRODUCT_GROUPS } from "@/lib/boq/product-swaps";
import { wetRoomChoicesOf, WET_ROOM_TYPES } from "@/lib/boq/wet-room";
import { recordPilotEvent } from "@/lib/pilot/events";
import { projectAccess } from "@/lib/projects/http";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// B7 5 — POST /api/projects/:id/product-swap { field, value }: "Choose a
// cheaper product" on a BoQ line. Writes the wet room's product choice
// (rooms.spec.wet_room[field], lib/boq/product-swaps.ts) and records it as a
// design edit (layer "product") naming who changed what — the revision diff's
// cause "Product changed by <name>". The caller then regenerates (a new
// revision). Members only. "Add a price" stays rate-only.
const Body = z.object({ field: z.string().min(1).max(40), value: z.union([z.string().max(40), z.boolean()]) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated();
  const projectId = (await params).id;
  const body = Body.safeParse(await request.json().catch(() => null));
  const db = getSupabaseAdmin() as unknown as SupabaseClient;
  const access = await projectAccess(db, caller, { project_id: projectId });
  if (access.denied) return access.denied;
  if (!body.success || !isProductValue(body.data.field, body.data.value)) return NextResponse.json({ success: false, error: "Choose one of the products this line offers.", code: "bad_request" }, { status: 400 });
  const { field, value } = body.data;

  const { data: plan } = await db.from("plans").select("id").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle<{ id: string }>();
  const { data: rooms } = plan ? await db.from("rooms").select("id, room_type, spec, in_scope").eq("plan_id", plan.id) : { data: null };
  const wet = ((rooms ?? []) as { id: string; room_type: string | null; spec: Record<string, unknown> | null; in_scope: boolean | null }[]).filter((r) => r.in_scope !== false && WET_ROOM_TYPES.has(r.room_type ?? ""));
  if (wet.length !== 1) return NextResponse.json({ success: false, error: "Product choices are for a project that is one bathroom.", code: "not_a_wet_room" }, { status: 422 });
  const room = wet[0]!;

  const group = PRODUCT_GROUPS.find((g) => g.field === field)!;
  const before = wetRoomChoicesOf(room.spec);
  const from = group.options.find((o) => o.value === before[field]) ?? group.options[0]!;
  const to = group.options.find((o) => o.value === value)!;
  if (from.value === to.value) return NextResponse.json({ success: true, changed: false });

  const wetRoom = { ...((room.spec?.wet_room as Record<string, unknown> | undefined) ?? {}), [field]: value };
  const { error } = await db.from("rooms").update({ spec: { ...(room.spec ?? {}), wet_room: wetRoom } }).eq("id", room.id);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  const by_name = await memberName(db, caller);
  await recordPilotEvent(db, projectId, "design_edit", { layer: "product", room_id: room.id, field, from: from.value, to: to.value, group: group.label, from_label: from.label, to_label: to.label, by_name, line_keys: groupLineKeys(group) }, { actor: caller.id });
  return NextResponse.json({ success: true, changed: true, field, value });
}
