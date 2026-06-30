import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { recordFeedback } from "@/lib/analytics";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const BodySchema = z.object({
  project_id: z.string().uuid(),
  boq_id: z.string().uuid(),
  boq_line_id: z.string().min(1),
  sku_id: z.string().uuid(),
  // Optional swap detail for the feedback signal (before SKU + price delta).
  from_sku_id: z.string().uuid().nullish(),
  delta_aed: z.number().nullish(),
});

type VendorSelectionRow = {
  id: string;
  project_id: string;
  boq_id: string;
  boq_line_id: string;
  sku_id: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as unknown;
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "project_id, boq_id, boq_line_id, and sku_id are required." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();
    const sb = supabase as unknown as SupabaseClient;

    const { data, error } = await sb
      .from("vendor_selections")
      .upsert(
        {
          project_id: parsed.data.project_id,
          boq_id: parsed.data.boq_id,
          boq_line_id: parsed.data.boq_line_id,
          sku_id: parsed.data.sku_id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "project_id,boq_id,boq_line_id" },
      )
      .select("id")
      .single<{ id: string }>();

    if (error) {
      const msg = error.message ?? "Unknown error.";
      // PostgREST reports "Could not find the table 'public.vendor_selections'
      // in the schema cache" for a missing table. Surface a clear instruction.
      if (
        msg.includes("vendor_selections") &&
        (msg.includes("does not exist") || msg.includes("Could not find the table"))
      ) {
        return NextResponse.json(
          {
            success: false,
            error:
              "vendor_selections table is missing. Run scripts/migrations/007_vendor_selections.sql in the Supabase SQL editor first.",
          },
          { status: 500 },
        );
      }
      throw new Error(msg);
    }

    // Feedback: a vendor swap is a "swapped" signal against the BoQ's KG
    // bundle. Resolve the bundle from the BoQ row; before/after + delta go in
    // the payload.
    const { data: boq } = await sb
      .from("boqs")
      .select("kg_bundle_id")
      .eq("id", parsed.data.boq_id)
      .maybeSingle<{ kg_bundle_id: string | null }>();
    await recordFeedback({
      projectId: parsed.data.project_id,
      entityType: "vendor",
      entityId: parsed.data.boq_line_id,
      action: "swapped",
      kgBundleId: boq?.kg_bundle_id ?? null,
      payload: {
        from: parsed.data.from_sku_id ?? null,
        to: parsed.data.sku_id,
        delta_aed: parsed.data.delta_aed ?? null,
        boq_id: parsed.data.boq_id,
      },
    });

    return NextResponse.json({ success: true, id: data?.id ?? null });
  } catch (err) {
    console.error("[api/vendor-selections] error", err);
    const message = err instanceof Error ? err.message : "Save failed.";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// GET ?project_id=&boq_id= returns all selections for that BoQ.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const project_id = searchParams.get("project_id");
    const boq_id = searchParams.get("boq_id");
    if (!project_id || !boq_id) {
      return NextResponse.json(
        { success: false, error: "project_id and boq_id query params are required." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();
    const sb = supabase as unknown as SupabaseClient;

    const { data, error } = await sb
      .from("vendor_selections")
      .select("id, project_id, boq_id, boq_line_id, sku_id")
      .eq("project_id", project_id)
      .eq("boq_id", boq_id)
      .returns<VendorSelectionRow[]>();

    if (error) {
      // Table-missing → return empty so the page still renders, with a
      // diagnostic flag for the dev console.
      const msg = error.message ?? "";
      if (
        msg.includes("vendor_selections") &&
        (msg.includes("does not exist") || msg.includes("Could not find the table"))
      ) {
        return NextResponse.json({ success: true, selections: [], table_missing: true });
      }
      throw new Error(error.message);
    }

    return NextResponse.json({ success: true, selections: data ?? [] });
  } catch (err) {
    console.error("[api/vendor-selections GET] error", err);
    const message = err instanceof Error ? err.message : "Lookup failed.";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
