import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { LOW_CONFIDENCE_FLAG } from "@/lib/parse/constants";
import { getParseProvider, type ParseAsset } from "@/lib/parse/providers";
import { repairOverlaps } from "@/lib/parse/repair";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function loadAssetFromUrl(url: string): Promise<ParseAsset> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch source asset (${res.status}): ${url.slice(0, 200)}`);
  }
  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  const bytes = Buffer.from(await res.arrayBuffer());
  const lower = url.toLowerCase();

  if (contentType.includes("pdf") || lower.endsWith(".pdf")) {
    return { kind: "pdf", data: bytes.toString("base64") };
  }
  if (contentType.includes("png") || lower.endsWith(".png")) {
    return { kind: "image", data: bytes.toString("base64"), mediaType: "image/png" };
  }
  if (contentType.includes("jpeg") || contentType.includes("jpg") || /\.(jpe?g)$/.test(lower)) {
    return { kind: "image", data: bytes.toString("base64"), mediaType: "image/jpeg" };
  }
  throw new Error(`Unsupported source type (${contentType || "unknown"}); expected PDF, PNG, or JPG.`);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { plan_id?: unknown } | null;
    const planId = typeof body?.plan_id === "string" ? body.plan_id : null;
    if (!planId) {
      return NextResponse.json({ success: false, error: "plan_id is required" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const sb = supabase as unknown as SupabaseClient; // untyped: rooms.confidence + parse_metrics

    const { data: plan, error: planErr } = await supabase
      .from("plans")
      .select("id, project_id, pdf_url")
      .eq("id", planId)
      .single();
    if (planErr || !plan) {
      return NextResponse.json({ success: false, error: "Plan not found." }, { status: 404 });
    }
    if (!plan.pdf_url) {
      return NextResponse.json({ success: false, error: "Plan has no source URL." }, { status: 400 });
    }

    // Provider-agnostic parse → deterministic overlap repair. Nothing below
    // depends on which provider produced the rooms.
    const asset = await loadAssetFromUrl(plan.pdf_url);
    const provider = getParseProvider();
    const raw = await provider.parse(asset);

    const { rooms: repaired, summary } = repairOverlaps(
      raw.rooms.map((r) => ({
        id: r.id,
        polygon: r.polygon,
        area_m2: r.area_m2,
        confidence: r.confidence,
        name_en: r.name_en,
        name_ar: r.name_ar,
        room_type: r.room_type,
      })),
      { totalAreaM2: raw.total_area_m2 },
    );

    const parsedJson = {
      scale: raw.scale,
      units: raw.units,
      total_area_m2: raw.total_area_m2,
      rooms: repaired,
      parse: { provider: provider.name, ...summary },
    };

    const { error: updErr } = await supabase
      .from("plans")
      .update({ parsed_json: parsedJson, total_area_m2: raw.total_area_m2 })
      .eq("id", planId);
    if (updErr) throw updErr;

    if (repaired.length > 0) {
      const rows = repaired.map((r) => ({
        plan_id: planId,
        name_en: r.name_en,
        name_ar: r.name_ar,
        room_type: r.room_type,
        area_m2: r.area_m2,
        polygon: r.polygon,
        confidence: r.confidence,
      }));
      // Insert with confidence; if the column isn't applied yet (pre-025), retry
      // without it so parsing still works.
      const { error: roomsErr } = await sb.from("rooms").insert(rows);
      if (roomsErr) {
        const rowsNoConf = rows.map((r) => ({
          plan_id: r.plan_id,
          name_en: r.name_en,
          name_ar: r.name_ar,
          room_type: r.room_type,
          area_m2: r.area_m2,
          polygon: r.polygon,
        }));
        const { error: retryErr } = await sb.from("rooms").insert(rowsNoConf);
        if (retryErr) throw retryErr;
      }
    }

    // Persist provider-supplied openings (source='parsed'). The in-house
    // provider supplies none today — forward-looking for a hosted/vector
    // provider. Best-effort (plan_openings may be absent pre-026).
    if (raw.openings && raw.openings.length > 0) {
      try {
        await sb.from("plan_openings").insert(
          raw.openings.map((o) => ({
            plan_id: planId,
            room_id: null,
            wall_ref: o.wall_ref ?? null,
            kind: o.type,
            width_mm: o.width_mm ?? null,
            height_mm: o.height_mm ?? null,
            sill_mm: o.sill_mm ?? null,
            position: o.position,
            along_offset: o.along_offset ?? null,
            source: "parsed",
            derived: o.derived ?? (o.width_mm == null || o.height_mm == null),
          })),
        );
      } catch {
        /* plan_openings not applied yet — non-fatal */
      }
    }

    // Best-effort parse metrics (table may be absent pre-025).
    try {
      const confs = repaired.map((r) => r.confidence);
      const mean = confs.length ? confs.reduce((s, c) => s + c, 0) / confs.length : null;
      await sb.from("parse_metrics").insert({
        project_id: plan.project_id,
        plan_id: planId,
        kind: "parse",
        provider: provider.name,
        room_count: repaired.length,
        mean_confidence: mean,
        low_confidence_count: confs.filter((c) => c < LOW_CONFIDENCE_FLAG).length,
        detail: summary,
      });
    } catch {
      /* parse_metrics not applied yet — non-fatal */
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[api/parse-plan] error", err);
    const message = err instanceof Error ? err.message : "Parse failed.";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
